import {
  AdministrationActorEnvelopeSchema,
  AuthorizationStateSchema,
  AuthorizationSubjectSchema,
  CatalogRefreshObservationSchema,
  CatalogRefreshReceiptSchema,
  ResumableCatalogRefreshOperationSchema,
  canonicalJson,
  ExactSemverSchema,
  type AuthorizationSubject,
  type AuthorizationState,
  type AdministrationActorEnvelope,
  type CatalogRefreshObservation,
  type CatalogRefreshReceipt,
  type ResumableCatalogRefreshOperation
} from "@k-nex/contracts";
import { createHash } from "node:crypto";
import { SignedCatalogSchema } from "@k-nex/extension-bundler";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export interface CatalogMirrorOwner { readonly applicationId: string; readonly environment: string; }
export interface CatalogMirrorCheckpoint { readonly signerIdentity: string; readonly sequence: number; readonly payloadDigest: string; readonly highestVersions: Readonly<Record<string, string>>; }
/** Signed catalog bytes are accepted only after the caller's verifier succeeds. They are never projected by this store. */
export interface VerifiedCatalogMirrorSnapshot { readonly snapshotId: string; readonly signedCatalog: unknown; readonly signerIdentity: string; readonly sequence: number; readonly digest: string; readonly releaseCount: number; readonly observedAt: string; }
export interface CatalogMirrorRefresh { readonly refreshId: string; readonly expectedCatalogRevision: number; readonly requestedBy: AuthorizationSubject; readonly authorityEnvelope: AdministrationActorEnvelope; readonly idempotencyKey: string; }
export interface CatalogReconciliationRequirement { readonly deliveryClass: "hot-application" | "theme-skin"; readonly extensionId: string; readonly generationId: string; readonly decisionDigest: string; }

export class CatalogMirrorStoreError extends Error {
  constructor(readonly code: "INVALID" | "REVISION" | "IDEMPOTENCY" | "CHECKPOINT" | "STATE", message: string) { super(message); }
}

type Row = Record<string, unknown>;
const ownerPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const recordPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;

function fail(code: CatalogMirrorStoreError["code"], message: string): never { throw new CatalogMirrorStoreError(code, message); }
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) fail("STATE", `Persisted catalog ${label} is invalid.`);
  return result;
}
function timestamp(value: unknown): string {
  const result = value instanceof Date ? value.toISOString() : typeof value === "string" ? new Date(value).toISOString() : "";
  if (!Number.isFinite(Date.parse(result))) fail("STATE", "Persisted catalog timestamp is invalid.");
  return result;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID", "Catalog mirror input is invalid.");
  return value as Record<string, unknown>;
}
function exact<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown, code: CatalogMirrorStoreError["code"] = "INVALID"): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success || canonicalJson(parsed.data) !== canonicalJson(value)) fail(code, "Catalog mirror value is invalid.");
  return Object.freeze(parsed.data);
}
function authorityDigest(value: AdministrationActorEnvelope): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function same(left: CatalogMirrorCheckpoint | undefined, right: CatalogMirrorCheckpoint | undefined): boolean { return canonicalJson(left ?? null) === canonicalJson(right ?? null); }
function checkpoint(row: Row): CatalogMirrorCheckpoint {
  const highestVersions = object(row.highest_versions);
  if (typeof row.signer_identity !== "string" || !/^[a-z0-9][a-z0-9.-]*$/u.test(row.signer_identity) || typeof row.payload_digest !== "string" || !digestPattern.test(row.payload_digest)
    || !Object.entries(highestVersions).every(([key, value]) => key.length > 0 && ExactSemverSchema.safeParse(value).success)) fail("STATE", "Persisted catalog checkpoint is invalid.");
  return Object.freeze({ signerIdentity: row.signer_identity, sequence: integer(row.sequence, 1, Number.MAX_SAFE_INTEGER, "checkpoint sequence"), payloadDigest: row.payload_digest, highestVersions: Object.freeze({ ...highestVersions } as Record<string, string>) });
}
function snapshot(row: Row) {
  const result = { sequence: integer(row.sequence, 1, Number.MAX_SAFE_INTEGER, "snapshot sequence"), digest: String(row.payload_digest), releaseCount: integer(row.release_count, 0, 10_000, "snapshot release count"), observedAt: timestamp(row.observed_at) };
  if (!digestPattern.test(result.digest)) fail("STATE", "Persisted catalog snapshot is invalid.");
  return Object.freeze(result);
}
function operation(row: Row, staged?: ReturnType<typeof snapshot>): ResumableCatalogRefreshOperation {
  const base = {
    schemaVersion: 1, refreshId: String(row.refresh_id), expectedCatalogRevision: integer(row.expected_catalog_revision, 0, 1_000_000_000, "operation revision"),
    requestedBy: { kind: String(row.requested_by_kind), id: String(row.requested_by_id) }, idempotencyKey: String(row.idempotency_key),
    authorityDigest: String(row.authority_digest),
    revision: integer(row.revision, 1, 1_000_000_000, "operation revision"), updatedAt: timestamp(row.updated_at)
  } as const;
  return String(row.state) === "fetching" ? exact(ResumableCatalogRefreshOperationSchema, { ...base, state: "fetching" }) : exact(ResumableCatalogRefreshOperationSchema, { ...base, state: "staged-reconciliation", staged });
}

export class PostgresCatalogMirrorStore {
  private readonly owner: CatalogMirrorOwner;

  constructor(private readonly pool: RuntimeExtensionPool, owner: CatalogMirrorOwner) {
    if (!ownerPattern.test(owner.applicationId) || !environmentPattern.test(owner.environment)) throw new TypeError("Catalog mirror owner is invalid.");
    this.owner = Object.freeze({ applicationId: owner.applicationId, environment: owner.environment });
  }

  async readObservation(): Promise<CatalogRefreshObservation> {
    const result = await this.pool.query<Row>(
      `select s.catalog_revision, staged.sequence as staged_sequence, staged.payload_digest as staged_digest, staged.release_count as staged_release_count, staged.observed_at as staged_observed_at,
              accepted.sequence as accepted_sequence, accepted.payload_digest as accepted_digest, accepted.release_count as accepted_release_count, accepted.observed_at as accepted_observed_at
       from k_nex_catalog_mirror_state s left join k_nex_catalog_mirror_snapshots staged on staged.snapshot_id=s.staged_snapshot_id
       left join k_nex_catalog_mirror_snapshots accepted on accepted.snapshot_id=s.accepted_snapshot_id where s.application_id=$1 and s.environment=$2`,
      [this.owner.applicationId, this.owner.environment]
    );
    const row = result.rows[0];
    if (!row) return exact(CatalogRefreshObservationSchema, { schemaVersion: 1, catalogRevision: 0, state: "no-accepted-snapshot" });
    const catalogRevision = integer(row.catalog_revision, 0, 1_000_000_000, "revision");
    const staged = row.staged_sequence === null || row.staged_sequence === undefined ? undefined : snapshot({ sequence: row.staged_sequence, payload_digest: row.staged_digest, release_count: row.staged_release_count, observed_at: row.staged_observed_at });
    const accepted = row.accepted_sequence === null || row.accepted_sequence === undefined ? undefined : snapshot({ sequence: row.accepted_sequence, payload_digest: row.accepted_digest, release_count: row.accepted_release_count, observed_at: row.accepted_observed_at });
    if (staged) return exact(CatalogRefreshObservationSchema, { schemaVersion: 1, catalogRevision, state: "staged-reconciliation", staged, ...(accepted ? { accepted } : {}) });
    return accepted ? exact(CatalogRefreshObservationSchema, { schemaVersion: 1, catalogRevision, state: "accepted", accepted }) : exact(CatalogRefreshObservationSchema, { schemaVersion: 1, catalogRevision, state: "no-accepted-snapshot" });
  }

  async stageVerified(input: Readonly<{ refresh: CatalogMirrorRefresh; snapshot: VerifiedCatalogMirrorSnapshot; expectedCheckpoint: CatalogMirrorCheckpoint | undefined; checkpoint: CatalogMirrorCheckpoint; requirements: readonly CatalogReconciliationRequirement[] }>): Promise<ResumableCatalogRefreshOperation | CatalogRefreshReceipt> {
    const refresh = this.refresh(input.refresh); const value = this.verified(input.snapshot, input.expectedCheckpoint, input.checkpoint); const requirements = this.requirements(input.requirements);
    return this.transaction(async (session) => {
      await this.lock(session);
      await this.state(session);
      const receipt = await this.receiptByRefresh(session, refresh.refreshId, refresh);
      if (receipt) return receipt;
      const existing = await this.operationByKeys(session, refresh);
      if (existing) {
        if (!this.sameRefresh(existing, refresh)) fail("IDEMPOTENCY", "Catalog refresh idempotency key was reused with a different request.");
        if (String(existing.state) === "staged-reconciliation") {
          const stored = await session.query<Row>(`select signer_identity, sequence, payload_digest, release_count, observed_at from k_nex_catalog_mirror_snapshots where snapshot_id=$1 and application_id=$2 and environment=$3`, [String(existing.staged_snapshot_id), this.owner.applicationId, this.owner.environment]);
          const persisted = stored.rows[0];
          if (!persisted || String(persisted.signer_identity) !== value.signerIdentity || integer(persisted.sequence, 1, Number.MAX_SAFE_INTEGER, "snapshot sequence") !== value.sequence || String(persisted.payload_digest) !== value.digest || integer(persisted.release_count, 0, 10_000, "snapshot release count") !== value.releaseCount) fail("IDEMPOTENCY", "Catalog refresh idempotency key was reused with a different request.");
          return operation(existing, snapshot(persisted));
        }
      }
      const state = await this.lockedState(session);
      if (state.catalogRevision !== refresh.expectedCatalogRevision) fail("REVISION", "Catalog revision changed before refresh.");
      if (state.stagedSnapshotId) fail("STATE", "A catalog reconciliation is already staged.");
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([this.owner.applicationId, this.owner.environment, value.checkpoint.signerIdentity, "catalog-checkpoint"])]);
      const found = await session.query<Row>(`select signer_identity, sequence, payload_digest, highest_versions from runtime_catalog_checkpoints where application_id=$1 and environment=$2 and signer_identity=$3 for update`, [this.owner.applicationId, this.owner.environment, value.checkpoint.signerIdentity]);
      const actual = found.rows[0] ? checkpoint(found.rows[0]) : undefined;
      if (!same(actual, value.expectedCheckpoint)) fail("CHECKPOINT", "Catalog checkpoint changed; reverify before staging.");
      await session.query(`insert into runtime_catalog_checkpoints (application_id, environment, signer_identity, sequence, payload_digest, highest_versions) values ($1,$2,$3,$4,$5,$6::jsonb) on conflict (application_id, environment, signer_identity) do update set sequence=excluded.sequence, payload_digest=excluded.payload_digest, highest_versions=excluded.highest_versions, updated_at=now()`, [this.owner.applicationId, this.owner.environment, value.checkpoint.signerIdentity, value.checkpoint.sequence, value.checkpoint.payloadDigest, canonicalJson(value.checkpoint.highestVersions)]);
      await session.query(`insert into k_nex_catalog_mirror_snapshots (snapshot_id, application_id, environment, signer_identity, sequence, payload_digest, release_count, observed_at, snapshot_json) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [value.snapshotId, this.owner.applicationId, this.owner.environment, value.signerIdentity, value.sequence, value.digest, value.releaseCount, value.observedAt, canonicalJson(value.signedCatalog)]);
      const nextRevision = state.catalogRevision + 1;
      await session.query(`update k_nex_catalog_mirror_state set staged_snapshot_id=$3, catalog_revision=$4, updated_at=now() where application_id=$1 and environment=$2 and catalog_revision=$5`, [this.owner.applicationId, this.owner.environment, value.snapshotId, nextRevision, state.catalogRevision]);
      if (existing) await session.query(`update k_nex_catalog_refresh_operations set staged_snapshot_id=$2, state='staged-reconciliation', revision=revision+1, updated_at=now() where refresh_id=$1 and revision=$3 and state='fetching'`, [refresh.refreshId, value.snapshotId, integer(existing.revision, 1, 1_000_000_000, "operation revision")]);
      else await session.query(`insert into k_nex_catalog_refresh_operations (refresh_id, application_id, environment, expected_catalog_revision, staged_snapshot_id, requested_by_kind, requested_by_id, authority_json, authority_digest, idempotency_key, state) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'staged-reconciliation')`, [refresh.refreshId, this.owner.applicationId, this.owner.environment, refresh.expectedCatalogRevision, value.snapshotId, refresh.requestedBy.kind, refresh.requestedBy.id, canonicalJson(refresh.authorityEnvelope), authorityDigest(refresh.authorityEnvelope), refresh.idempotencyKey]);
      for (const requirement of requirements) await session.query(`insert into k_nex_catalog_reconciliation_requirements (application_id, environment, refresh_id, delivery_class, extension_id, generation_id, decision_digest) values ($1,$2,$3,$4,$5,$6,$7)`, [this.owner.applicationId, this.owner.environment, refresh.refreshId, requirement.deliveryClass, requirement.extensionId, requirement.generationId, requirement.decisionDigest]);
      const inserted = await this.operationByKeys(session, refresh);
      if (!inserted) fail("STATE", "Catalog refresh operation is unavailable.");
      return operation(inserted, snapshot({ sequence: value.sequence, payload_digest: value.digest, release_count: value.releaseCount, observed_at: value.observedAt }));
    });
  }

  async readRefresh(refreshId: string): Promise<ResumableCatalogRefreshOperation | CatalogRefreshReceipt | undefined> {
    if (!recordPattern.test(refreshId)) throw new TypeError("Catalog refresh id is invalid.");
    const operationRow = await this.pool.query<Row>(`select o.*, s.sequence, s.payload_digest, s.release_count, s.observed_at from k_nex_catalog_refresh_operations o left join k_nex_catalog_mirror_snapshots s on s.snapshot_id=o.staged_snapshot_id where o.application_id=$1 and o.environment=$2 and o.refresh_id=$3 and o.state in ('fetching','staged-reconciliation')`, [this.owner.applicationId, this.owner.environment, refreshId]);
    if (operationRow.rows[0]) return operation(operationRow.rows[0], operationRow.rows[0].staged_snapshot_id ? snapshot(operationRow.rows[0]) : undefined);
    const session = this.pool;
    const receipt = await session.query<Row>(`select receipt_json from k_nex_catalog_refresh_receipts where application_id=$1 and environment=$2 and refresh_id=$3`, [this.owner.applicationId, this.owner.environment, refreshId]);
    return receipt.rows[0] ? exact(CatalogRefreshReceiptSchema, receipt.rows[0].receipt_json, "STATE") : undefined;
  }

  async readRefreshAuthority(refreshId: string): Promise<CatalogMirrorRefresh | undefined> {
    if (!recordPattern.test(refreshId)) throw new TypeError("Catalog refresh id is invalid.");
    const result = await this.pool.query<Row>(`select o.*, s.sequence, s.payload_digest, s.release_count, s.observed_at from k_nex_catalog_refresh_operations o left join k_nex_catalog_mirror_snapshots s on s.snapshot_id=o.staged_snapshot_id where o.application_id=$1 and o.environment=$2 and o.refresh_id=$3 and o.state in ('fetching','staged-reconciliation')`, [this.owner.applicationId, this.owner.environment, refreshId]);
    const row = result.rows[0];
    if (!row) return undefined;
    const authorityEnvelope = exact(AdministrationActorEnvelopeSchema, row.authority_json, "STATE");
    const persistedDigest = String(row.authority_digest);
    const projection = operation(row, row.staged_snapshot_id ? snapshot(row) : undefined);
    if (persistedDigest !== authorityDigest(authorityEnvelope) || projection.authorityDigest !== persistedDigest) fail("STATE", "Persisted catalog refresh authority digest is invalid.");
    return this.refresh({ refreshId: projection.refreshId, expectedCatalogRevision: projection.expectedCatalogRevision, requestedBy: projection.requestedBy, authorityEnvelope, idempotencyKey: projection.idempotencyKey });
  }

  /** Replaces stale lifecycle requirements without advancing the staged catalog pointer. */
  async rebaseRequirements(input: Readonly<{ refreshId: string; expectedOperationRevision: number; expectedCatalogRevision: number; requirements: readonly CatalogReconciliationRequirement[] }>): Promise<ResumableCatalogRefreshOperation> {
    if (!recordPattern.test(input.refreshId) || !Number.isSafeInteger(input.expectedOperationRevision) || input.expectedOperationRevision < 1 || !Number.isSafeInteger(input.expectedCatalogRevision) || input.expectedCatalogRevision < 0) fail("INVALID", "Catalog reconciliation rebase input is invalid.");
    const requirements = this.requirements(input.requirements);
    return this.transaction(async (session) => {
      await this.lock(session); await this.state(session);
      const state = await this.lockedState(session);
      const operationResult = await session.query<Row>(`select * from k_nex_catalog_refresh_operations where application_id=$1 and environment=$2 and refresh_id=$3 and state='staged-reconciliation' for update`, [this.owner.applicationId, this.owner.environment, input.refreshId]);
      const operationRow = operationResult.rows[0];
      if (!operationRow || state.catalogRevision !== input.expectedCatalogRevision || integer(operationRow.revision, 1, 1_000_000_000, "operation revision") !== input.expectedOperationRevision || String(operationRow.staged_snapshot_id ?? "") !== String(state.stagedSnapshotId ?? "")) fail("REVISION", "Catalog reconciliation changed before rebase.");
      const persisted = await session.query<Row>(`select delivery_class, extension_id, generation_id, decision_digest, terminal_state from k_nex_catalog_reconciliation_requirements where application_id=$1 and environment=$2 and refresh_id=$3 order by delivery_class, extension_id, generation_id for update`, [this.owner.applicationId, this.owner.environment, input.refreshId]);
      const retained = this.requirements(persisted.rows.filter((row) => row.terminal_state === "quarantined").map((row) => ({ deliveryClass: String(row.delivery_class) as CatalogReconciliationRequirement["deliveryClass"], extensionId: String(row.extension_id), generationId: String(row.generation_id), decisionDigest: String(row.decision_digest) })));
      const current = this.requirements(persisted.rows.filter((row) => row.terminal_state !== "quarantined").map((row) => ({ deliveryClass: String(row.delivery_class) as CatalogReconciliationRequirement["deliveryClass"], extensionId: String(row.extension_id), generationId: String(row.generation_id), decisionDigest: String(row.decision_digest) })));
      const next = requirements.filter((requirement) => !retained.some((value) => value.deliveryClass === requirement.deliveryClass && value.extensionId === requirement.extensionId && value.generationId === requirement.generationId));
      if (canonicalJson(current) === canonicalJson(next)) return operation(operationRow, await this.snapshotById(session, String(operationRow.staged_snapshot_id)));
      await session.query(`delete from k_nex_catalog_reconciliation_requirements where application_id=$1 and environment=$2 and refresh_id=$3 and terminal_state<>'quarantined'`, [this.owner.applicationId, this.owner.environment, input.refreshId]);
      for (const requirement of next) await session.query(`insert into k_nex_catalog_reconciliation_requirements (application_id, environment, refresh_id, delivery_class, extension_id, generation_id, decision_digest) values ($1,$2,$3,$4,$5,$6,$7)`, [this.owner.applicationId, this.owner.environment, input.refreshId, requirement.deliveryClass, requirement.extensionId, requirement.generationId, requirement.decisionDigest]);
      const updated = await session.query<Row>(`update k_nex_catalog_refresh_operations set revision=revision+1, updated_at=now() where refresh_id=$1 and revision=$2 and state='staged-reconciliation' returning *`, [input.refreshId, input.expectedOperationRevision]);
      if (!updated.rows[0]) fail("REVISION", "Catalog reconciliation changed before rebase.");
      return operation(updated.rows[0], await this.snapshotById(session, String(updated.rows[0].staged_snapshot_id)));
    });
  }

  /** Coordinator calls this only after all impacted release reconciliations reached terminal receipts. */
  async acceptAfterTerminalReconciliation(input: Readonly<{ refresh: CatalogMirrorRefresh; authority: AuthorizationState; expectedOperationRevision: number; expectedCatalogRevision: number; expectedInventoryRevision: number; receiptId: string; auditId: string; eventId: string; reconciledReleaseCount: number; occurredAt: string }>): Promise<CatalogRefreshReceipt> {
    const refresh = this.refresh(input.refresh);
    const authority = exact(AuthorizationStateSchema, input.authority);
    if (authority.applicationId !== this.owner.applicationId || authority.environment !== this.owner.environment) fail("INVALID", "Catalog acceptance authority is invalid.");
    if (!recordPattern.test(input.receiptId) || !recordPattern.test(input.auditId) || !recordPattern.test(input.eventId) || !Number.isSafeInteger(input.expectedOperationRevision) || input.expectedOperationRevision < 1 || !Number.isSafeInteger(input.expectedCatalogRevision) || input.expectedCatalogRevision < 0 || !Number.isSafeInteger(input.expectedInventoryRevision) || input.expectedInventoryRevision < 0 || !Number.isSafeInteger(input.reconciledReleaseCount) || input.reconciledReleaseCount < 0 || input.reconciledReleaseCount > 10_000 || !Number.isFinite(Date.parse(input.occurredAt))) fail("INVALID", "Catalog acceptance input is invalid.");
    return this.transaction(async (session) => {
      await this.lock(session); await this.state(session);
      const authorityState = await session.query<Row>(`select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1 for update`, [this.owner.applicationId]);
      if (integer(authorityState.rows[0]?.authorization_revision, 0, 1_000_000_000, "authorization revision") !== authority.authorizationRevision || integer(authorityState.rows[0]?.lifecycle_revision, 0, 1_000_000_000, "lifecycle revision") !== authority.lifecycleRevision) fail("REVISION", "Catalog authority changed before acceptance.");
      const replay = await this.receiptByRefresh(session, refresh.refreshId, refresh);
      if (replay) return replay;
      const state = await this.lockedState(session);
      const active = await this.operationByKeys(session, refresh);
      if (!active || integer(active.revision, 1, 1_000_000_000, "operation revision") !== input.expectedOperationRevision || state.catalogRevision !== input.expectedCatalogRevision || String(state.stagedSnapshotId ?? "") !== String(active.staged_snapshot_id)) fail("REVISION", "Catalog refresh state changed before acceptance.");
      await session.query(`insert into runtime_extension_inventory_revisions (application_id, environment, revision) values ($1,$2,0) on conflict do nothing`, [this.owner.applicationId, this.owner.environment]);
      const inventory = await session.query<Row>(`select revision from runtime_extension_inventory_revisions where application_id=$1 and environment=$2 for update`, [this.owner.applicationId, this.owner.environment]);
      if (integer(inventory.rows[0]?.revision, 0, 1_000_000_000, "runtime inventory revision") !== input.expectedInventoryRevision) fail("REVISION", "Runtime extension inventory changed before catalog acceptance.");
      const accepted = await this.snapshotById(session, String(active.staged_snapshot_id));
      const requirements = await session.query<Row>(`select r.delivery_class, r.extension_id, r.generation_id, r.decision_digest, r.terminal_state, r.security_receipt_id, s.receipt_id as verified_receipt_id from k_nex_catalog_reconciliation_requirements r left join runtime_extension_security_receipts s on s.receipt_id=r.security_receipt_id and s.application_id=r.application_id and s.environment=r.environment and s.delivery_class=r.delivery_class and s.extension_id=r.extension_id and s.generation_id=r.generation_id and s.decision_digest=r.decision_digest where r.application_id=$1 and r.environment=$2 and r.refresh_id=$3 for update of r`, [this.owner.applicationId, this.owner.environment, refresh.refreshId]);
      if (requirements.rows.length !== input.reconciledReleaseCount || requirements.rows.some((row) => (row.terminal_state !== "clear" && row.terminal_state !== "quarantined") || (row.terminal_state === "quarantined" && !row.verified_receipt_id))) fail("STATE", "Catalog reconciliation is not terminal.");
      const catalogRevision = state.catalogRevision + 1;
      const receipt = exact(CatalogRefreshReceiptSchema, { schemaVersion: 1, receiptId: input.receiptId, refreshId: refresh.refreshId, outcome: "accepted", catalogRevision, accepted, reconciledReleaseCount: input.reconciledReleaseCount, requestedBy: refresh.requestedBy, authorityDigest: authorityDigest(refresh.authorityEnvelope), idempotencyKey: refresh.idempotencyKey, occurredAt: new Date(input.occurredAt).toISOString() });
      await session.query(`update k_nex_catalog_mirror_state set staged_snapshot_id=null, accepted_snapshot_id=$3, catalog_revision=$4, updated_at=now() where application_id=$1 and environment=$2 and catalog_revision=$5`, [this.owner.applicationId, this.owner.environment, String(active.staged_snapshot_id), catalogRevision, state.catalogRevision]);
      await session.query(`update k_nex_catalog_refresh_operations set state='terminal', revision=revision+1, updated_at=now() where refresh_id=$1 and revision=$2`, [refresh.refreshId, input.expectedOperationRevision]);
      await session.query(`insert into k_nex_catalog_refresh_receipts (receipt_id, refresh_id, application_id, environment, expected_catalog_revision, authority_digest, idempotency_key, receipt_json, occurred_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, [receipt.receiptId, refresh.refreshId, this.owner.applicationId, this.owner.environment, refresh.expectedCatalogRevision, receipt.authorityDigest, refresh.idempotencyKey, canonicalJson(receipt), receipt.occurredAt]);
      if (receipt.outcome !== "accepted") fail("STATE", "Catalog acceptance receipt is invalid.");
      await session.query(`insert into k_nex_catalog_refresh_audit (audit_id, receipt_id, application_id, environment, catalog_revision, outcome, authority_json, authority_digest, sequence, payload_digest, release_count) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`, [input.auditId, receipt.receiptId, this.owner.applicationId, this.owner.environment, catalogRevision, receipt.outcome, canonicalJson(refresh.authorityEnvelope), receipt.authorityDigest, receipt.accepted.sequence, receipt.accepted.digest, receipt.accepted.releaseCount]);
      await session.query(`insert into k_nex_catalog_refresh_outbox (event_id, receipt_id, application_id, environment, catalog_revision, occurred_at) values ($1,$2,$3,$4,$5,$6)`, [input.eventId, receipt.receiptId, this.owner.applicationId, this.owner.environment, catalogRevision, receipt.occurredAt]);
      return receipt;
    });
  }

  async begin(refreshValue: CatalogMirrorRefresh): Promise<ResumableCatalogRefreshOperation | CatalogRefreshReceipt> {
    const refresh = this.refresh(refreshValue);
    return this.transaction(async (session) => {
      await this.lock(session); await this.state(session);
      const receipt = await this.receiptByRefresh(session, refresh.refreshId); if (receipt) return receipt;
      const existing = await this.operationByKeys(session, refresh);
      if (existing) {
        if (!this.sameRequest(existing, refresh)) fail("IDEMPOTENCY", "Catalog refresh idempotency key was reused with a different request.");
        return operation(existing, existing.staged_snapshot_id ? await this.snapshotById(session, String(existing.staged_snapshot_id)) : undefined);
      }
      const state = await this.lockedState(session);
      if (state.catalogRevision !== refresh.expectedCatalogRevision) fail("REVISION", "Catalog revision changed before refresh.");
      await session.query(`insert into k_nex_catalog_refresh_operations (refresh_id, application_id, environment, expected_catalog_revision, requested_by_kind, requested_by_id, authority_json, authority_digest, idempotency_key, state) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'fetching')`, [refresh.refreshId, this.owner.applicationId, this.owner.environment, refresh.expectedCatalogRevision, refresh.requestedBy.kind, refresh.requestedBy.id, canonicalJson(refresh.authorityEnvelope), authorityDigest(refresh.authorityEnvelope), refresh.idempotencyKey]);
      const inserted = await this.operationByKeys(session, refresh); if (!inserted) fail("STATE", "Catalog refresh operation is unavailable.");
      return operation(inserted);
    });
  }

  async reject(input: Readonly<{ refresh: CatalogMirrorRefresh; expectedOperationRevision: number; receiptId: string; reason: "stale-revision" | "fetch-failed" | "snapshot-invalid" | "snapshot-replayed" | "permission-revoked"; occurredAt: string }>): Promise<CatalogRefreshReceipt> {
    const refresh = this.refresh(input.refresh);
    if (!recordPattern.test(input.receiptId) || !Number.isSafeInteger(input.expectedOperationRevision) || input.expectedOperationRevision < 1 || !Number.isFinite(Date.parse(input.occurredAt))) fail("INVALID", "Catalog rejection input is invalid.");
    return this.transaction(async (session) => {
      await this.lock(session); await this.state(session);
      const replay = await this.receiptByRefresh(session, refresh.refreshId, refresh); if (replay) return replay;
      const active = await this.operationByKeys(session, refresh);
      if (!active || !this.sameRefresh(active, refresh) || integer(active.revision, 1, 1_000_000_000, "operation revision") !== input.expectedOperationRevision) fail("REVISION", "Catalog refresh state changed before rejection.");
      const receipt = exact(CatalogRefreshReceiptSchema, { schemaVersion: 1, receiptId: input.receiptId, refreshId: refresh.refreshId, outcome: "rejected", reason: input.reason, requestedBy: refresh.requestedBy, authorityDigest: authorityDigest(refresh.authorityEnvelope), idempotencyKey: refresh.idempotencyKey, occurredAt: new Date(input.occurredAt).toISOString() });
      if (active.staged_snapshot_id) await session.query(`update k_nex_catalog_mirror_state set staged_snapshot_id=null, catalog_revision=catalog_revision+1, updated_at=now() where application_id=$1 and environment=$2 and staged_snapshot_id=$3`, [this.owner.applicationId, this.owner.environment, String(active.staged_snapshot_id)]);
      await session.query(`update k_nex_catalog_refresh_operations set state='terminal', revision=revision+1, updated_at=now() where refresh_id=$1 and revision=$2`, [refresh.refreshId, input.expectedOperationRevision]);
      await session.query(`insert into k_nex_catalog_refresh_receipts (receipt_id, refresh_id, application_id, environment, expected_catalog_revision, authority_digest, idempotency_key, receipt_json, occurred_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, [receipt.receiptId, refresh.refreshId, this.owner.applicationId, this.owner.environment, refresh.expectedCatalogRevision, receipt.authorityDigest, refresh.idempotencyKey, canonicalJson(receipt), receipt.occurredAt]);
      return receipt;
    });
  }

  private refresh(value: CatalogMirrorRefresh): CatalogMirrorRefresh {
    if (!recordPattern.test(value.refreshId) || !Number.isSafeInteger(value.expectedCatalogRevision) || value.expectedCatalogRevision < 0 || value.expectedCatalogRevision > 1_000_000_000 || !idempotencyPattern.test(value.idempotencyKey)) fail("INVALID", "Catalog refresh input is invalid.");
    const requestedBy = exact(AuthorizationSubjectSchema, value.requestedBy);
    const authorityEnvelope = exact(AdministrationActorEnvelopeSchema, value.authorityEnvelope);
    if (authorityEnvelope.applicationId !== this.owner.applicationId || authorityEnvelope.environment !== this.owner.environment
      || canonicalJson(authorityEnvelope.effectiveActor) !== canonicalJson(requestedBy)
      || !authorityEnvelope.permissions.some(({ permissionId, scope }) => permissionId === "system.catalog.refresh" && scope.kind === "application" && scope.resource === "system.catalog")) fail("INVALID", "Catalog refresh authority is invalid.");
    return Object.freeze({ ...value, requestedBy, authorityEnvelope });
  }
  private verified(snapshotValue: VerifiedCatalogMirrorSnapshot, expectedCheckpoint: CatalogMirrorCheckpoint | undefined, next: CatalogMirrorCheckpoint) {
    const snapshot = object(snapshotValue); const check = (value: CatalogMirrorCheckpoint | undefined) => value === undefined || (typeof value.signerIdentity === "string" && /^[a-z0-9][a-z0-9.-]*$/u.test(value.signerIdentity) && Number.isSafeInteger(value.sequence) && value.sequence >= 1 && digestPattern.test(value.payloadDigest) && Object.entries(object(value.highestVersions)).every(([key, version]) => key.length > 0 && ExactSemverSchema.safeParse(version).success));
    const catalog = SignedCatalogSchema.safeParse(snapshot.signedCatalog);
    const digest = catalog.success ? `sha256:${createHash("sha256").update(canonicalJson(catalog.data.payload)).digest("hex")}` : "";
    if (!recordPattern.test(String(snapshot.snapshotId)) || !catalog.success || typeof snapshot.signerIdentity !== "string" || snapshot.signerIdentity !== catalog.data.signer.identity || Number(snapshot.sequence) !== catalog.data.payload.sequence || Number(snapshot.releaseCount) !== catalog.data.payload.entries.length || String(snapshot.digest) !== digest || !Number.isFinite(Date.parse(String(snapshot.observedAt))) || !check(expectedCheckpoint) || !check(next) || next.signerIdentity !== snapshot.signerIdentity || next.sequence !== snapshot.sequence || next.payloadDigest !== snapshot.digest) fail("INVALID", "Verified catalog snapshot is invalid.");
    return { snapshotId: String(snapshot.snapshotId), signedCatalog: catalog.data, signerIdentity: snapshot.signerIdentity as string, sequence: catalog.data.payload.sequence, digest, releaseCount: catalog.data.payload.entries.length, observedAt: new Date(String(snapshot.observedAt)).toISOString(), expectedCheckpoint, checkpoint: next };
  }
  private async state(session: RuntimeExtensionSession): Promise<void> { await session.query(`insert into k_nex_catalog_mirror_state (application_id, environment) values ($1,$2) on conflict do nothing`, [this.owner.applicationId, this.owner.environment]); }
  private async lock(session: RuntimeExtensionSession): Promise<void> { await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([this.owner.applicationId, this.owner.environment, "catalog-mirror"])]); }
  private async lockedState(session: RuntimeExtensionSession): Promise<{ catalogRevision: number; stagedSnapshotId?: string }> { const result = await session.query<Row>(`select catalog_revision, staged_snapshot_id from k_nex_catalog_mirror_state where application_id=$1 and environment=$2 for update`, [this.owner.applicationId, this.owner.environment]); const row = result.rows[0]; if (!row) fail("STATE", "Catalog mirror state is unavailable."); return { catalogRevision: integer(row.catalog_revision, 0, 1_000_000_000, "revision"), ...(row.staged_snapshot_id ? { stagedSnapshotId: String(row.staged_snapshot_id) } : {}) }; }
  private async operationByKeys(session: RuntimeExtensionSession, refresh: CatalogMirrorRefresh): Promise<Row | undefined> { const result = await session.query<Row>(`select * from k_nex_catalog_refresh_operations where application_id=$1 and environment=$2 and (refresh_id=$3 or idempotency_key=$4) for update`, [this.owner.applicationId, this.owner.environment, refresh.refreshId, refresh.idempotencyKey]); if (result.rows.length > 1) fail("IDEMPOTENCY", "Catalog refresh identifiers collide."); return result.rows[0]; }
  private async snapshotById(session: RuntimeExtensionSession, snapshotId: string) { const result = await session.query<Row>(`select sequence, payload_digest, release_count, observed_at from k_nex_catalog_mirror_snapshots where snapshot_id=$1 and application_id=$2 and environment=$3`, [snapshotId, this.owner.applicationId, this.owner.environment]); if (!result.rows[0]) fail("STATE", "Catalog snapshot is unavailable."); return snapshot(result.rows[0]); }
  async markReconciliationTerminal(input: Readonly<{ refreshId: string; requirement: CatalogReconciliationRequirement; state: "clear" | "quarantined"; securityReceiptId?: string }>): Promise<void> {
    if (!recordPattern.test(input.refreshId) || (input.state === "quarantined" && !recordPattern.test(input.securityReceiptId ?? "")) || (input.state === "clear" && input.securityReceiptId !== undefined)) fail("INVALID", "Catalog reconciliation terminal input is invalid.");
    const requirement = this.requirements([input.requirement])[0]!;
    await this.transaction(async (session) => {
      await this.lock(session);
      const operation = await session.query<Row>(`select refresh_id from k_nex_catalog_refresh_operations where application_id=$1 and environment=$2 and refresh_id=$3 and state='staged-reconciliation' for update`, [this.owner.applicationId, this.owner.environment, input.refreshId]);
      if (!operation.rows[0]) fail("REVISION", "Catalog reconciliation operation changed.");
      const verified = input.state === "quarantined" ? await session.query<Row>(`select receipt_id from runtime_extension_security_receipts where receipt_id=$1 and application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5 and generation_id=$6 and decision_digest=$7`, [input.securityReceiptId, this.owner.applicationId, this.owner.environment, requirement.deliveryClass, requirement.extensionId, requirement.generationId, requirement.decisionDigest]) : { rows: [{}] };
      if (!verified.rows[0]) fail("STATE", "Catalog quarantine receipt is unavailable.");
      const updated = await session.query<Row>(`update k_nex_catalog_reconciliation_requirements set terminal_state=$8, security_receipt_id=$9, updated_at=now() where application_id=$1 and environment=$2 and refresh_id=$3 and delivery_class=$4 and extension_id=$5 and generation_id=$6 and decision_digest=$7 and terminal_state='pending' returning refresh_id`, [this.owner.applicationId, this.owner.environment, input.refreshId, requirement.deliveryClass, requirement.extensionId, requirement.generationId, requirement.decisionDigest, input.state, input.securityReceiptId ?? null]);
      if (!updated.rows[0]) fail("REVISION", "Catalog reconciliation requirement changed.");
    });
  }
  async readStaged(refreshId: string): Promise<Readonly<{ operation: ResumableCatalogRefreshOperation; snapshot: VerifiedCatalogMirrorSnapshot }> | undefined> {
    if (!recordPattern.test(refreshId)) throw new TypeError("Catalog refresh id is invalid.");
    const result = await this.pool.query<Row>(`select o.*, s.snapshot_id, s.signer_identity, s.sequence, s.payload_digest, s.release_count, s.observed_at, s.snapshot_json from k_nex_catalog_refresh_operations o join k_nex_catalog_mirror_snapshots s on s.snapshot_id=o.staged_snapshot_id and s.application_id=o.application_id and s.environment=o.environment where o.application_id=$1 and o.environment=$2 and o.refresh_id=$3 and o.state='staged-reconciliation'`, [this.owner.applicationId, this.owner.environment, refreshId]);
    const row = result.rows[0]; if (!row) return undefined;
    const stored = this.verified({ snapshotId: String(row.snapshot_id), signedCatalog: object(row.snapshot_json), signerIdentity: String(row.signer_identity), sequence: integer(row.sequence, 1, Number.MAX_SAFE_INTEGER, "snapshot sequence"), digest: String(row.payload_digest), releaseCount: integer(row.release_count, 0, 10_000, "snapshot release count"), observedAt: timestamp(row.observed_at) }, undefined, { signerIdentity: String(row.signer_identity), sequence: integer(row.sequence, 1, Number.MAX_SAFE_INTEGER, "checkpoint sequence"), payloadDigest: String(row.payload_digest), highestVersions: {} });
    return Object.freeze({ operation: operation(row, snapshot(row)), snapshot: Object.freeze({ snapshotId: stored.snapshotId, signedCatalog: stored.signedCatalog, signerIdentity: stored.signerIdentity, sequence: stored.sequence, digest: stored.digest, releaseCount: stored.releaseCount, observedAt: stored.observedAt }) });
  }
  /** Current security policy reads staged data first; a failed refresh never replaces accepted data. */
  async readSecuritySnapshot(owner: CatalogMirrorOwner): Promise<VerifiedCatalogMirrorSnapshot | undefined> {
    this.assertOwner(owner);
    return this.pointerSnapshot("coalesce(s.staged_snapshot_id, s.accepted_snapshot_id)");
  }
  async readAcceptedSnapshot(): Promise<VerifiedCatalogMirrorSnapshot | undefined> { return this.pointerSnapshot("s.accepted_snapshot_id"); }
  async readRequirements(refreshId: string): Promise<readonly Readonly<CatalogReconciliationRequirement & { terminalState: "pending" | "clear" | "quarantined"; securityReceiptId?: string }>[] > {
    if (!recordPattern.test(refreshId)) throw new TypeError("Catalog refresh id is invalid.");
    const result = await this.pool.query<Row>(`select r.delivery_class, r.extension_id, r.generation_id, r.decision_digest, r.terminal_state, r.security_receipt_id from k_nex_catalog_reconciliation_requirements r join k_nex_catalog_refresh_operations o on o.application_id=r.application_id and o.environment=r.environment and o.refresh_id=r.refresh_id where r.application_id=$1 and r.environment=$2 and r.refresh_id=$3 and o.state='staged-reconciliation' order by r.delivery_class, r.extension_id, r.generation_id`, [this.owner.applicationId, this.owner.environment, refreshId]);
    return Object.freeze(result.rows.map((row) => {
      const requirement = this.requirements([{ deliveryClass: String(row.delivery_class) as CatalogReconciliationRequirement["deliveryClass"], extensionId: String(row.extension_id), generationId: String(row.generation_id), decisionDigest: String(row.decision_digest) }])[0]!;
      const terminalState = String(row.terminal_state); if (terminalState !== "pending" && terminalState !== "clear" && terminalState !== "quarantined") fail("STATE", "Catalog reconciliation terminal state is invalid.");
      const securityReceiptId = row.security_receipt_id === null || row.security_receipt_id === undefined ? undefined : String(row.security_receipt_id);
      if ((terminalState === "quarantined") !== (securityReceiptId !== undefined)) fail("STATE", "Catalog reconciliation receipt is invalid.");
      return Object.freeze({ ...requirement, terminalState, ...(securityReceiptId ? { securityReceiptId } : {}) });
    }));
  }
  private async receiptByRefresh(session: RuntimeExtensionSession, refreshId: string, refresh?: CatalogMirrorRefresh): Promise<CatalogRefreshReceipt | undefined> { const result = await session.query<Row>(`select expected_catalog_revision, authority_digest, idempotency_key, receipt_json from k_nex_catalog_refresh_receipts where application_id=$1 and environment=$2 and refresh_id=$3 for update`, [this.owner.applicationId, this.owner.environment, refreshId]); if (!result.rows[0]) return undefined; const receipt = exact(CatalogRefreshReceiptSchema, result.rows[0].receipt_json, "STATE"); if (refresh && (integer(result.rows[0].expected_catalog_revision, 0, 1_000_000_000, "receipt revision") !== refresh.expectedCatalogRevision || String(result.rows[0].authority_digest) !== authorityDigest(refresh.authorityEnvelope) || String(result.rows[0].idempotency_key) !== refresh.idempotencyKey || canonicalJson(receipt.requestedBy) !== canonicalJson(refresh.requestedBy))) fail("IDEMPOTENCY", "Catalog refresh replay does not match its receipt."); return receipt; }
  private async pointerSnapshot(pointer: string): Promise<VerifiedCatalogMirrorSnapshot | undefined> {
    const result = await this.pool.query<Row>(`select ${pointer} as pointer_id, x.snapshot_id, x.signer_identity, x.sequence, x.payload_digest, x.release_count, x.observed_at, x.snapshot_json from k_nex_catalog_mirror_state s left join k_nex_catalog_mirror_snapshots x on x.application_id=s.application_id and x.environment=s.environment and x.snapshot_id=${pointer} where s.application_id=$1 and s.environment=$2`, [this.owner.applicationId, this.owner.environment]);
    const row = result.rows[0]; if (!row || row.pointer_id === null || row.pointer_id === undefined) return undefined;
    if (String(row.pointer_id) !== String(row.snapshot_id)) fail("STATE", "Catalog mirror pointer is invalid.");
    const stored = this.verified({ snapshotId: String(row.snapshot_id), signedCatalog: object(row.snapshot_json), signerIdentity: String(row.signer_identity), sequence: integer(row.sequence, 1, Number.MAX_SAFE_INTEGER, "snapshot sequence"), digest: String(row.payload_digest), releaseCount: integer(row.release_count, 0, 10_000, "snapshot release count"), observedAt: timestamp(row.observed_at) }, undefined, { signerIdentity: String(row.signer_identity), sequence: integer(row.sequence, 1, Number.MAX_SAFE_INTEGER, "checkpoint sequence"), payloadDigest: String(row.payload_digest), highestVersions: {} });
    return Object.freeze({ snapshotId: stored.snapshotId, signedCatalog: stored.signedCatalog, signerIdentity: stored.signerIdentity, sequence: stored.sequence, digest: stored.digest, releaseCount: stored.releaseCount, observedAt: stored.observedAt });
  }
  private requirements(values: readonly CatalogReconciliationRequirement[]): readonly CatalogReconciliationRequirement[] { const seen = new Set<string>(); return values.map((value) => { if ((value.deliveryClass !== "hot-application" && value.deliveryClass !== "theme-skin") || !/^(app|skin)\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/u.test(value.extensionId) || !recordPattern.test(value.generationId) || !digestPattern.test(value.decisionDigest)) fail("INVALID", "Catalog reconciliation requirement is invalid."); const key = canonicalJson([value.deliveryClass, value.extensionId, value.generationId]); if (seen.has(key)) fail("INVALID", "Catalog reconciliation requirement is duplicated."); seen.add(key); return Object.freeze({ ...value }); }).sort((left, right) => canonicalJson([left.deliveryClass, left.extensionId, left.generationId]).localeCompare(canonicalJson([right.deliveryClass, right.extensionId, right.generationId]))); }
  private assertOwner(owner: CatalogMirrorOwner): void { if (owner.applicationId !== this.owner.applicationId || owner.environment !== this.owner.environment) fail("INVALID", "Catalog mirror owner does not match this store."); }
  private sameRefresh(row: Row, refresh: CatalogMirrorRefresh): boolean { return String(row.refresh_id) === refresh.refreshId && integer(row.expected_catalog_revision, 0, 1_000_000_000, "operation revision") === refresh.expectedCatalogRevision && String(row.authority_digest) === authorityDigest(refresh.authorityEnvelope) && canonicalJson(row.authority_json) === canonicalJson(refresh.authorityEnvelope) && String(row.idempotency_key) === refresh.idempotencyKey && canonicalJson({ kind: row.requested_by_kind, id: row.requested_by_id }) === canonicalJson(refresh.requestedBy); }
  private sameRequest(row: Row, refresh: CatalogMirrorRefresh): boolean { return String(row.refresh_id) === refresh.refreshId && integer(row.expected_catalog_revision, 0, 1_000_000_000, "operation revision") === refresh.expectedCatalogRevision && String(row.idempotency_key) === refresh.idempotencyKey && canonicalJson({ kind: row.requested_by_kind, id: row.requested_by_id }) === canonicalJson(refresh.requestedBy); }
  private async transaction<T>(work: (session: RuntimeExtensionSession) => Promise<T>): Promise<T> { const session = await this.pool.connect(); try { await session.query("begin"); const result = await work(session); await session.query("commit"); return result; } catch (error) { try { await session.query("rollback"); } catch { /* retain cause */ } throw error; } finally { session.release(); } }
}
