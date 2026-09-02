import {
  AuthorizationPermissionDescriptorSchema,
  AuthorizationStateSchema,
  ExtensionAuthorizationGenerationSchema,
  ExtensionLifecycleEventSchema,
  ExtensionSecurityQuarantineEventSchema,
  canonicalJson,
  type AuthorizationState,
  type ExtensionAuthorizationGeneration,
  type ExtensionLifecycleEvent,
  type ExtensionSecurityQuarantineEvent,
  type PermissionCatalogSnapshot
} from "@k-nex/contracts";
import {
  AuthorizationLifecycleError,
  planAuthorizationLifecycle,
  type AuthorizationLifecyclePlan
} from "@k-nex/runtime";
import type { StaticDeploymentReceipt } from "@k-nex/contracts";

import type { RuntimeExtensionSession } from "./runtime-extension-store.js";
import { writeAuthorizationInvalidationOutbox } from "./authorization-outbox.js";

type Row = Record<string, unknown>;

export type AuthorizationLifecycleCommittedTransition = ExtensionLifecycleEvent | ExtensionSecurityQuarantineEvent;

/** Trusted host code resolves descriptors from the already verified lifecycle generation. */
export type AuthorizationLifecycleDescriptorResolver = (
  session: Pick<RuntimeExtensionSession, "query">,
  transition: AuthorizationLifecycleCommittedTransition,
  /** When present, resolve this exact pre-update generation rather than the target event evidence. */
  priorGenerationEvidence?: unknown
) => Promise<readonly unknown[]>;

export interface AuthorizationLifecycleProjectionInput {
  /** An existing Phase 9 transaction session. This projector never begins, commits, rolls back, or releases it. */
  readonly session: RuntimeExtensionSession;
  readonly transition: unknown;
  readonly runtimeGenerationIds: readonly string[];
  readonly updateCompatibility?: "compatible" | "incompatible";
  /** Immutable active-generation evidence captured while the runtime row was locked, before an update pointer mutation. */
  readonly priorGenerationEvidence?: unknown;
}

export interface AuthorizationLifecycleProjection {
  readonly plan: AuthorizationLifecyclePlan;
  readonly state: AuthorizationState;
}

export interface SharedStaticGenerationRebindInput {
  /** The runtime lifecycle transaction completing the target Platform Plugin operation. */
  readonly session: RuntimeExtensionSession;
  readonly applicationId: string;
  readonly environment: string;
  readonly previousGenerationId: string;
  readonly receipt: StaticDeploymentReceipt;
  /** The lifecycle operation's own plugin is reconciled by its terminal receipt path. */
  readonly excludeExtensionId?: string;
  readonly operationId?: string;
}

/**
 * Keeps retained Platform Plugin runtime identities coupled to the one shared
 * static application image without changing their authorization owner generation.
 */
export class SharedStaticPlatformPluginGenerationRebinder {
  async rebind(input: SharedStaticGenerationRebindInput): Promise<void> {
    await input.session.query(
      "select public.k_nex_static_shared_generation_rebind($1,$2,$3,$4::jsonb,$5,$6)",
      [input.applicationId, input.environment, input.previousGenerationId, canonicalJson(input.receipt),
        input.excludeExtensionId ?? null, input.operationId ?? null]
    );
  }
}

/**
 * Projects one already-committed Phase 9 transition into authorization state.
 * Roles, grants, assignments, and adoptions deliberately remain outside this boundary.
 */
export class AuthorizationLifecycleProjector {
  constructor(private readonly resolveDescriptors: AuthorizationLifecycleDescriptorResolver) {}

  async project(input: AuthorizationLifecycleProjectionInput): Promise<AuthorizationLifecycleProjection> {
    const transition = parseTransition(input.transition);
    const { session } = input;

    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([transition.applicationId, "authorization-state"])]);
    await session.query("insert into k_nex_authorization_state (application_id) values ($1) on conflict do nothing", [transition.applicationId]);
    const lockedState = await session.query<Row>(
      "select application_id, authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1 for update",
      [transition.applicationId]
    );
    const current = parseState(lockedState.rows[0], transition.environment);

    const lockedGenerations = await session.query<Row>(
      "select application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision from k_nex_extension_authorization_generations where application_id=$1 and delivery_class=$2 and extension_id=$3 order by authorization_generation for update",
      [transition.applicationId, transition.deliveryClass, transition.id]
    );
    const existingGenerations = Object.freeze(lockedGenerations.rows.map(parseGeneration));
    assertPriorEvidenceFence(input.priorGenerationEvidence, input.updateCompatibility, existingGenerations);
    const descriptors = transition.deliveryClass === "theme-skin" ? [] : await this.resolveDescriptors(session, transition);
    const descriptorIds = descriptors.map((descriptor) => {
      const parsed = AuthorizationPermissionDescriptorSchema.safeParse(descriptor);
      if (!parsed.success) fail("INVALID_INPUT", "Resolved authorization descriptor is invalid.");
      return parsed.data.id;
    });
    const priorGenerationDescriptors = input.priorGenerationEvidence === undefined
      ? undefined
      : await this.resolveDescriptors(session, transition, input.priorGenerationEvidence);
    const plan = planAuthorizationLifecycle({
      expected: {
        applicationId: current.applicationId,
        environment: current.environment,
        authorizationRevision: current.authorizationRevision,
        lifecycleRevision: current.lifecycleRevision
      },
      transition,
      existingGenerations,
      descriptors,
      ...(priorGenerationDescriptors === undefined ? {} : { priorGenerationDescriptors }),
      runtimeGenerationIds: input.runtimeGenerationIds,
      ...(input.updateCompatibility === undefined ? {} : { updateCompatibility: input.updateCompatibility })
    });

    if (plan.replayed) return Object.freeze({ plan, state: current });

    for (const mutation of plan.mutations) {
      if (mutation.kind === "extension-generation") await upsertGeneration(session, mutation.generation);
    }
    const mutatedOwners = [...new Set(plan.mutations
      .filter((mutation) => mutation.kind === "extension-generation")
      .map((mutation) => mutation.generation.owner.generation))]
      .sort((left, right) => left - right);
    if (!(transition.eventType === "extension.lifecycle-transition" && transition.operation === "disable") && mutatedOwners.length > 0) {
      await session.query(
        "delete from k_nex_permission_catalog_snapshots where application_id=$1 and owner_kind='extension' and owner_delivery_class=$2 and owner_extension_id=$3 and owner_generation = any($4::int[]) and state='inactive-extension-disabled'",
        [transition.applicationId, transition.deliveryClass, transition.id, mutatedOwners]
      );
    }
    const currentOwners = plan.generations.filter((generation) => generation.state === "current").map((generation) => generation.owner.generation);
    if (transition.eventType === "extension.lifecycle-transition" && transition.lifecycleState === "active" && currentOwners.length > 0 && descriptorIds.length > 0) {
      await session.query(
        "delete from k_nex_permission_catalog_snapshots where application_id=$1 and owner_kind='extension' and owner_delivery_class=$2 and owner_extension_id=$3 and owner_generation = any($4::int[]) and state='deprecated' and permission_json->>'id' = any($5::text[])",
        [transition.applicationId, transition.deliveryClass, transition.id, currentOwners, descriptorIds]
      );
    }
    for (const snapshot of plan.snapshots) await insertSnapshot(session, snapshot);

    const advanced = await session.query<Row>(
      "update k_nex_authorization_state set lifecycle_revision=$2, updated_at=now() where application_id=$1 and authorization_revision=$3 and lifecycle_revision=$4 returning application_id, authorization_revision, lifecycle_revision",
      [current.applicationId, plan.lifecycleRevision, current.authorizationRevision, current.lifecycleRevision]
    );
    if (advanced.rows.length !== 1) fail("REVISION_CONFLICT", "Authorization state revision changed before lifecycle projection.");
    const state = parseState(advanced.rows[0], transition.environment);
    await writeAuthorizationInvalidationOutbox(session, { ...state, scope: "environment" });
    return Object.freeze({ plan, state });
  }
}

function parseTransition(value: unknown): AuthorizationLifecycleCommittedTransition {
  const lifecycle = ExtensionLifecycleEventSchema.safeParse(value);
  if (lifecycle.success && canonicalJson(lifecycle.data) === canonicalJson(value)) return Object.freeze(lifecycle.data);
  const quarantine = ExtensionSecurityQuarantineEventSchema.safeParse(value);
  if (quarantine.success && canonicalJson(quarantine.data) === canonicalJson(value)) return Object.freeze(quarantine.data);
  fail("INVALID_INPUT", "Lifecycle projection requires a canonical committed Phase 9 transition.");
}

function parseState(row: Row | undefined, environment: string): AuthorizationState {
  const parsed = AuthorizationStateSchema.safeParse({
    schemaVersion: 1,
    applicationId: valueString(row?.application_id),
    environment,
    authorizationRevision: valueInteger(row?.authorization_revision),
    lifecycleRevision: valueInteger(row?.lifecycle_revision)
  });
  if (!parsed.success) fail("REVISION_CONFLICT", "Persisted authorization state is invalid.");
  return Object.freeze(parsed.data);
}

function parseGeneration(row: Row): ExtensionAuthorizationGeneration {
  const parsed = ExtensionAuthorizationGenerationSchema.safeParse({
    schemaVersion: 1,
    applicationId: valueString(row.application_id),
    owner: {
      kind: "extension",
      deliveryClass: valueString(row.delivery_class),
      extensionId: valueString(row.extension_id),
      generation: valueInteger(row.authorization_generation)
    },
    runtimeGenerationIds: row.runtime_generation_ids,
    state: valueString(row.state),
    authorizationRevision: valueInteger(row.authorization_revision),
    lifecycleRevision: valueInteger(row.lifecycle_revision)
  });
  if (!parsed.success) fail("INVALID_INPUT", "Persisted authorization generation is invalid.");
  return Object.freeze(parsed.data);
}

function assertPriorEvidenceFence(
  evidence: unknown,
  updateCompatibility: "compatible" | "incompatible" | undefined,
  generations: readonly ExtensionAuthorizationGeneration[]
): void {
  if (evidence === undefined) return;
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence) || typeof (evidence as Record<string, unknown>).generationId !== "string") {
    fail("INVALID_INPUT", "Prior generation evidence must name one immutable runtime generation.");
  }
  const generationId = (evidence as Record<string, unknown>).generationId;
  const matching = generations.filter((generation) => generation.runtimeGenerationIds.length === 1 && generation.runtimeGenerationIds[0] === generationId);
  const current = matching.filter((generation) => generation.state === "current");
  if (current.length === 1) return;
  if (updateCompatibility === "incompatible" && current.length === 0 && matching.length === 1 && matching[0]!.state === "retired") return;
  fail("IDENTITY_MISMATCH", "Prior generation evidence must exactly match the current authorization generation, or a retired generation for an incompatible update.");
}

async function upsertGeneration(session: RuntimeExtensionSession, value: ExtensionAuthorizationGeneration): Promise<void> {
  await session.query(
    "insert into k_nex_extension_authorization_generations (application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) on conflict (application_id, delivery_class, extension_id, authorization_generation) do update set runtime_generation_ids=excluded.runtime_generation_ids, state=excluded.state, authorization_revision=excluded.authorization_revision, lifecycle_revision=excluded.lifecycle_revision, updated_at=now()",
    [value.applicationId, value.owner.deliveryClass, value.owner.extensionId, value.owner.generation, canonicalJson(value.runtimeGenerationIds), value.state, value.authorizationRevision, value.lifecycleRevision]
  );
}

async function insertSnapshot(session: RuntimeExtensionSession, value: PermissionCatalogSnapshot): Promise<void> {
  if (value.owner === undefined || value.owner.kind !== "extension") fail("INVALID_INPUT", "Lifecycle snapshots must have an extension owner.");
  await session.query(
    "insert into k_nex_permission_catalog_snapshots (application_id, snapshot_id, source, permission_json, state, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, revision) values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11) on conflict (application_id, snapshot_id) do update set source=excluded.source, permission_json=excluded.permission_json, state=excluded.state, owner_kind=excluded.owner_kind, owner_namespace=excluded.owner_namespace, owner_delivery_class=excluded.owner_delivery_class, owner_extension_id=excluded.owner_extension_id, owner_generation=excluded.owner_generation, revision=excluded.revision, updated_at=now()",
    [value.applicationId, value.id, value.source, canonicalJson(value.permission), value.state, "extension", null, value.owner.deliveryClass, value.owner.extensionId, value.owner.generation, value.revision]
  );
}

function valueString(value: unknown): string {
  if (typeof value !== "string") fail("INVALID_INPUT", "Persisted authorization value is invalid.");
  return value;
}

function valueInteger(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(number)) fail("INVALID_INPUT", "Persisted authorization value is invalid.");
  return number;
}

function fail(code: "INVALID_INPUT" | "IDENTITY_MISMATCH" | "REVISION_CONFLICT", message: string): never {
  throw new AuthorizationLifecycleError(code, message);
}
