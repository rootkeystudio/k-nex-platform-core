import {
  type AuthorizationDecision,
  canonicalJson,
  ResourceIdSchema,
  ThemeProfilePublicationEventSchema,
  ThemeProfileSchema,
  type ThemeProfile,
  type ThemeProfilePublicationEvent
} from "@k-nex/contracts";

import type { RuntimeExtensionClock, RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";
import { createCurrentAuthorityTarget, type CurrentAuthorityAdapter } from "@k-nex/runtime";

export type ThemeProfileStoreErrorCode =
  | "ACCESS_DENIED"
  | "PROFILE_INVALID"
  | "REVISION_CONFLICT"
  | "DRAFT_CONFLICT"
  | "DRAFT_NOT_FOUND"
  | "SKIN_GENERATION_UNAVAILABLE"
  | "ROLLBACK_UNAVAILABLE";

export class ThemeProfileStoreError extends Error {
  constructor(readonly code: ThemeProfileStoreErrorCode, message: string) {
    super(message);
    this.name = "ThemeProfileStoreError";
  }
}

interface PublicationRow {
  revision: number;
  active_revision_id: string | null;
  active_profile: unknown | null;
  previous_revision_id: string | null;
  previous_profile: unknown | null;
  draft_revision_id: string | null;
  draft_profile: unknown | null;
  state_digest: string | null;
}

export interface ThemeProfilePublicationSnapshot {
  readonly applicationId: string;
  readonly environment: string;
  readonly profileId: string;
  readonly revision: number;
  readonly active?: ThemeProfile;
  readonly previous?: ThemeProfile;
  readonly draft?: ThemeProfile;
  readonly stateDigest?: string;
}

export type ThemeProfilePublicationReceipt = ThemeProfilePublicationEvent;

interface Owner {
  readonly applicationId: string;
  readonly environment: string;
  readonly profileId: string;
}

export interface ThemeProfileAuthorizer {
  authorize(input: Readonly<{ operation: "read" | "stage" | "publish" | "rollback"; owner: Owner }>): boolean | Promise<boolean>;
}

export interface ThemeProfileReauthenticationVerifier<TContext> {
  verify(input: Readonly<{
    context: TContext;
    owner: Owner;
    operation: "publish" | "rollback";
    decision: AuthorizationDecision;
  }>): boolean | Promise<boolean>;
}

export interface ThemeProfilePreviewValidator {
  validate(input: Readonly<{ owner: Owner; profile: ThemeProfile }>): void | Promise<void>;
}

export interface ThemeProfilePreview {
  readonly profileId: string;
  readonly profileRevisionId: string;
  readonly expectedRevision: number;
  readonly contentDigest: string;
  readonly themePackage: Readonly<{ readonly id: string; readonly version: string }>;
  readonly skinGenerationId?: string;
}

const themeReadTarget = createCurrentAuthorityTarget({
  permissionId: "system.themes.read",
  scope: { kind: "application", resource: "system.themes" },
  facts: { boundary: "theme-profile-administration" }
});
const themeManageTarget = createCurrentAuthorityTarget({
  permissionId: "system.themes.manage",
  scope: { kind: "application", resource: "system.themes" },
  facts: { boundary: "theme-profile-administration" }
});

/** All Theme Profile mutations use the fixed platform-owned theme management permission. */
export class CurrentAuthorityThemeProfileAuthorizer<TContext> implements ThemeProfileAuthorizer {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly context: (owner: Owner) => TContext,
    private readonly reauthentication: ThemeProfileReauthenticationVerifier<TContext>
  ) {}

  async authorize(input: Parameters<ThemeProfileAuthorizer["authorize"]>[0]): Promise<boolean> {
    const context = this.context(input.owner);
    const target = input.operation === "read" ? themeReadTarget : themeManageTarget;
    const decision = await this.authority.authorize(context, target);
    if (decision?.outcome !== "allow" || decision.permissionId !== target.permissionId ||
      decision.applicationId !== input.owner.applicationId || decision.environment !== input.owner.environment) return false;
    if (input.operation !== "publish" && input.operation !== "rollback") return true;
    return this.reauthentication.verify({ context, owner: input.owner, operation: input.operation, decision });
  }
}

function fail(code: ThemeProfileStoreErrorCode, message: string): never {
  throw new ThemeProfileStoreError(code, message);
}

function assertOwner(owner: Owner): void {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(owner.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(owner.environment) ||
    !ResourceIdSchema.safeParse(owner.profileId).success) fail("PROFILE_INVALID", "Theme profile publication owner is invalid.");
}

function parseProfile(value: unknown, state?: ThemeProfile["revision"]["state"]): ThemeProfile {
  const result = ThemeProfileSchema.safeParse(value);
  if (!result.success || (state && result.data.revision.state !== state)) fail("PROFILE_INVALID", `Theme profile must be a valid ${state ?? "stored"} revision.`);
  return result.data;
}

function publicationContent(profile: ThemeProfile): string {
  const { revision, ...content } = profile;
  const { state: _state, ...revisionIdentity } = revision;
  const normalizedRevision = { ...revisionIdentity } as Record<string, unknown>;
  delete normalizedRevision.publishedAt;
  delete normalizedRevision.archivedAt;
  return canonicalJson({ ...content, revision: normalizedRevision });
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function occurredAt(clock: RuntimeExtensionClock): string {
  const now = clock.now();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) fail("PROFILE_INVALID", "Theme profile publication clock is invalid.");
  return now.toISOString();
}

function snapshot(owner: Owner, row: PublicationRow): ThemeProfilePublicationSnapshot {
  return Object.freeze({
    ...owner,
    revision: row.revision,
    ...(row.active_profile ? { active: Object.freeze(parseProfile(row.active_profile)) } : {}),
    ...(row.previous_profile ? { previous: Object.freeze(parseProfile(row.previous_profile)) } : {}),
    ...(row.draft_profile ? { draft: Object.freeze(parseProfile(row.draft_profile)) } : {}),
    ...(row.state_digest ? { stateDigest: row.state_digest } : {})
  });
}

export class PostgresThemeProfileStore {
  constructor(
    private readonly pool: RuntimeExtensionPool,
    private readonly clock: RuntimeExtensionClock,
    private readonly authorizer: ThemeProfileAuthorizer,
    private readonly previewValidator: ThemeProfilePreviewValidator
  ) {}

  async read(owner: Owner): Promise<ThemeProfilePublicationSnapshot | undefined> {
    assertOwner(owner);
    await this.authorize("read", owner);
    const result = await this.pool.query<PublicationRow>(
      `select revision, active_revision_id, active_profile, previous_revision_id, previous_profile, draft_revision_id, draft_profile, state_digest
       from runtime_theme_profile_publications where application_id=$1 and environment=$2 and profile_id=$3`,
      [owner.applicationId, owner.environment, owner.profileId]
    );
    const value = result.rows[0] ? snapshot(owner, result.rows[0]) : undefined;
    await this.authorize("read", owner);
    return value;
  }

  async preview(input: Readonly<{ applicationId: string; environment: string; profile: unknown; expectedRevision: number }>): Promise<ThemeProfilePreview> {
    const profile = parseProfile(input.profile, "draft");
    const owner = { applicationId: input.applicationId, environment: input.environment, profileId: profile.id };
    assertOwner(owner);
    this.assertRevision(input.expectedRevision, true);
    await this.authorize("stage", owner);
    return this.transaction(async (session) => {
      await this.lockOwner(session, owner);
      const current = await this.readLocked(session, owner);
      if ((current?.revision ?? 0) !== input.expectedRevision) fail("REVISION_CONFLICT", "Theme profile preview revision changed.");
      await this.assertSkinGeneration(session, owner, profile);
      await this.validatePreview(owner, profile);
      await this.authorize("stage", owner);
      return Object.freeze({
        profileId: profile.id,
        profileRevisionId: profile.revision.id,
        expectedRevision: input.expectedRevision,
        contentDigest: await sha256({ ...owner, expectedRevision: input.expectedRevision, profile }),
        themePackage: Object.freeze({ id: profile.themeId, version: profile.themeVersion }),
        ...(profile.skin ? { skinGenerationId: profile.skin.generationId } : {})
      });
    });
  }

  async stageDraft(input: Readonly<{ applicationId: string; environment: string; profile: unknown }>): Promise<ThemeProfilePublicationSnapshot> {
    const profile = parseProfile(input.profile, "draft");
    const owner = { applicationId: input.applicationId, environment: input.environment, profileId: profile.id };
    assertOwner(owner);
    await this.authorize("stage", owner);
    return this.transaction(async (session) => {
      await this.lockOwner(session, owner);
      await session.query(
        `insert into runtime_theme_profile_publications (application_id, environment, profile_id) values ($1,$2,$3) on conflict do nothing`,
        [owner.applicationId, owner.environment, owner.profileId]
      );
      const current = await this.readLocked(session, owner);
      if (!current) fail("PROFILE_INVALID", "Theme profile publication row is unavailable.");
      const expectedPrevious = current.active_revision_id ?? undefined;
      if (profile.revision.previousRevisionId !== expectedPrevious) fail("REVISION_CONFLICT", "Theme profile draft does not extend the active revision.");
      const active = current.active_profile ? parseProfile(current.active_profile, "published") : undefined;
      if (profile.revision.id === expectedPrevious || profile.revision.number !== (active?.revision.number ?? 0) + 1) {
        fail("REVISION_CONFLICT", "Theme profile draft revision identity or number is not the next active revision.");
      }
      if (current.draft_revision_id === profile.revision.id && current.draft_profile && canonicalJson(current.draft_profile) !== canonicalJson(profile)) {
        fail("DRAFT_CONFLICT", "A different draft already owns this immutable revision identity.");
      }
      await this.assertSkinGeneration(session, owner, profile);
      await this.validatePreview(owner, profile);
      await this.authorize("stage", owner);
      const updated = await session.query<PublicationRow>(
        `update runtime_theme_profile_publications set draft_revision_id=$4, draft_profile=$5::jsonb, updated_at=now()
         where application_id=$1 and environment=$2 and profile_id=$3 returning *`,
        [owner.applicationId, owner.environment, owner.profileId, profile.revision.id, JSON.stringify(profile)]
      );
      return snapshot(owner, updated.rows[0]!);
    });
  }

  async publish(input: Readonly<{ applicationId: string; environment: string; profile: unknown; expectedRevision: number }>): Promise<ThemeProfilePublicationReceipt> {
    const profile = parseProfile(input.profile, "published");
    const owner = { applicationId: input.applicationId, environment: input.environment, profileId: profile.id };
    assertOwner(owner);
    await this.authorize("publish", owner);
    this.assertRevision(input.expectedRevision, true);
    return this.transaction(async (session) => {
      await this.lockOwner(session, owner);
      const current = await this.readLocked(session, owner);
      if (!current || current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Theme profile publication revision changed.");
      if (!current.draft_profile || current.draft_revision_id !== profile.revision.id) fail("DRAFT_NOT_FOUND", "The published revision has no matching staged draft.");
      const draft = parseProfile(current.draft_profile, "draft");
      if (publicationContent(draft) !== publicationContent(profile)) fail("DRAFT_CONFLICT", "Published Theme Profile content differs from its staged draft.");
      if (profile.revision.previousRevisionId !== (current.active_revision_id ?? undefined)) fail("REVISION_CONFLICT", "Theme profile publication does not extend the active revision.");
      await this.assertSkinGeneration(session, owner, profile);
      await this.validatePreview(owner, profile);
      await this.authorize("publish", owner);
      return this.commit(session, owner, current, profile, "publish");
    });
  }

  async rollback(input: Owner & Readonly<{ expectedRevision: number }>): Promise<ThemeProfilePublicationReceipt> {
    const owner = { applicationId: input.applicationId, environment: input.environment, profileId: input.profileId };
    assertOwner(owner);
    await this.authorize("rollback", owner);
    this.assertRevision(input.expectedRevision, false);
    return this.transaction(async (session) => {
      await this.lockOwner(session, owner);
      const current = await this.readLocked(session, owner);
      if (!current || current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Theme profile publication revision changed.");
      if (!current.previous_profile || !current.previous_revision_id) fail("ROLLBACK_UNAVAILABLE", "No previous Theme Profile revision is retained.");
      const target = parseProfile(current.previous_profile, "published");
      await this.assertSkinGeneration(session, owner, target);
      await this.validatePreview(owner, target);
      await this.authorize("rollback", owner);
      return this.commit(session, owner, current, target, "rollback");
    });
  }

  private async commit(
    session: RuntimeExtensionSession,
    owner: Owner,
    current: PublicationRow,
    target: ThemeProfile,
    operation: ThemeProfilePublicationReceipt["operation"]
  ): Promise<ThemeProfilePublicationReceipt> {
    const revision = current.revision + 1;
    const previous = current.active_profile;
    const previousId = current.active_revision_id;
    const state = {
      revision,
      activeRevisionId: target.revision.id,
      previousRevisionId: previousId,
      activeProfile: target,
      previousProfile: previous
    };
    const stateDigest = await sha256(state);
    const timestamp = occurredAt(this.clock);
    const eventDigest = await sha256({ ...owner, operation, revision, activeRevisionId: target.revision.id });
    const receipt = Object.freeze(ThemeProfilePublicationEventSchema.parse({
      schemaVersion: 1,
      eventId: `theme-profile-event-${eventDigest.slice(7, 39)}`,
      eventType: "theme-profile.publication",
      operation,
      ...owner,
      revisionBefore: current.revision,
      revisionAfter: revision,
      activeRevisionId: target.revision.id,
      ...(previousId ? { previousRevisionId: previousId } : {}),
      ...(target.skin ? { skinGenerationId: target.skin.generationId } : {}),
      occurredAt: timestamp,
      stateDigest
    }));
    const updated = await session.query<PublicationRow>(
      `update runtime_theme_profile_publications set revision=$4, active_revision_id=$5, active_profile=$6::jsonb,
         previous_revision_id=$7, previous_profile=$8::jsonb,
         draft_revision_id=case when $11='publish' then null else draft_revision_id end,
         draft_profile=case when $11='publish' then null else draft_profile end,
         state_digest=$9, updated_at=now()
       where application_id=$1 and environment=$2 and profile_id=$3 and revision=$10 returning *`,
      [owner.applicationId, owner.environment, owner.profileId, revision, target.revision.id, JSON.stringify(target), previousId,
        previous ? JSON.stringify(previous) : null, stateDigest, current.revision, operation]
    );
    if (!updated.rows[0]) fail("REVISION_CONFLICT", "Theme profile publication revision changed before commit.");
    await session.query(
      `insert into runtime_theme_profile_outbox (event_id, application_id, environment, profile_id, revision, event_json)
       values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [receipt.eventId, owner.applicationId, owner.environment, owner.profileId, revision, JSON.stringify(receipt)]
    );
    return receipt;
  }

  private async assertSkinGeneration(session: RuntimeExtensionSession, owner: Owner, profile: ThemeProfile): Promise<void> {
    if (!profile.skin) return;
    const result = await session.query<{ generation_id: string }>(
      `select g.generation_id from runtime_extensions e
       join runtime_extension_generations g on g.application_id=e.application_id and g.environment=e.environment
         and g.delivery_class=e.delivery_class and g.extension_id=e.extension_id and g.generation_id=e.active_generation_id
       where e.application_id=$1 and e.environment=$2 and e.delivery_class='theme-skin' and e.extension_id=$3
         and e.disposition='active' and e.active_generation_id=$4 and g.version=$5 and g.state='active' for update of e, g`,
      [owner.applicationId, owner.environment, profile.skin.id, profile.skin.generationId, profile.skin.version]
    );
    if (!result.rows[0]) fail("SKIN_GENERATION_UNAVAILABLE", "Theme Profile references a skin generation that is not exactly active.");
  }

  private async lockOwner(session: RuntimeExtensionSession, owner: Owner): Promise<void> {
    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([owner.applicationId, owner.environment, owner.profileId])]);
  }

  private async readLocked(session: RuntimeExtensionSession, owner: Owner): Promise<PublicationRow | undefined> {
    const result = await session.query<PublicationRow>(
      `select * from runtime_theme_profile_publications where application_id=$1 and environment=$2 and profile_id=$3 for update`,
      [owner.applicationId, owner.environment, owner.profileId]
    );
    return result.rows[0];
  }

  private async transaction<T>(work: (session: RuntimeExtensionSession) => Promise<T>): Promise<T> {
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      const result = await work(session);
      await session.query("commit");
      return result;
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }

  private async authorize(operation: "read" | "stage" | "publish" | "rollback", owner: Owner): Promise<void> {
    try {
      if (await this.authorizer.authorize({ operation, owner }) === true) return;
    } catch { /* fail closed */ }
    fail("ACCESS_DENIED", "Current authority denied the Theme Profile operation.");
  }

  private async validatePreview(owner: Owner, profile: ThemeProfile): Promise<void> {
    try { await this.previewValidator.validate({ owner, profile }); }
    catch { fail("PROFILE_INVALID", "Theme Profile failed installed-package, generation, or accessibility validation."); }
  }

  private assertRevision(value: number, allowZero: boolean): void {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 999_999_999) fail("REVISION_CONFLICT", "Theme profile expected revision is invalid.");
  }
}
