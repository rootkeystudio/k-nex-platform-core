import { createHash } from "node:crypto";

import { canonicalJson, ExactSemverSchema, StaticCompositionChangePlanSchema, StaticDeploymentReceiptSchema, type StaticCompositionChangePlan, type StaticDeploymentReceipt } from "@k-nex/contracts";
import type {
  DurableStaticReleaseRequest,
  OperationAuthorizationDecision,
  StaticReleaseRequestAuthority,
  StaticCompositionCheckpoint,
  StaticCompositionCheckpointStore,
  StaticGenerationAuthority,
  StaticCompositionChangeResult,
  TrustedBuildDeploymentClient,
  TrustedDeploymentRequest
} from "@k-nex/runtime";

import type { RuntimeExtensionPool } from "./runtime-extension-store.js";

export class StaticReleaseAuthorityStoreError extends Error {
  constructor(readonly code: "CHECKPOINT_CONFLICT" | "AUTHORITY_MISMATCH" | "RELEASE_TRANSITION_CONFLICT", message: string) {
    super(message);
    this.name = "StaticReleaseAuthorityStoreError";
  }
}

interface CheckpointRow {
  checkpoint_id: string;
  application_id: string;
  environment: string;
  expected_source_commit: string;
  change_json: unknown;
  status: "planned" | "committed";
}

interface ReleaseRequestRow {
  request_digest: string;
  application_id: string;
  environment: string;
  version: string;
  source_commit: string;
  change_plan_digest: string;
  status: "build-requested" | "builder-attested" | "deployment-requested" | "deployed" | "rejected";
  generation_id: string | null;
  build_evidence_digest: string | null;
  application_digest: string | null;
  image_digest: string | null;
  migration_revision: number | null;
  worker_fencing_token: string | number | null;
  receipt_id: string | null;
  receipt_json: unknown | null;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function checkpoint(row: CheckpointRow): StaticCompositionCheckpoint {
  let change: StaticCompositionChangePlan;
  try { change = StaticCompositionChangePlanSchema.parse(row.change_json); }
  catch { throw new StaticReleaseAuthorityStoreError("AUTHORITY_MISMATCH", "Persisted static composition checkpoint is invalid."); }
  return Object.freeze({
    checkpointId: row.checkpoint_id,
    applicationId: row.application_id,
    environment: row.environment,
    expectedSourceCommit: row.expected_source_commit,
    change: Object.freeze(change),
    status: row.status
  });
}

function releaseRequest(row: ReleaseRequestRow): DurableStaticReleaseRequest {
  const attested = row.status === "builder-attested" || row.status === "deployment-requested" || row.status === "deployed";
  const required = [row.build_evidence_digest, row.application_digest, row.image_digest];
  if (!/^sha256:[0-9a-f]{64}$/u.test(row.request_digest) || !row.application_id || !row.environment || !ExactSemverSchema.safeParse(row.version).success || !/^[0-9a-f]{40}$/u.test(row.source_commit) ||
    !/^sha256:[0-9a-f]{64}$/u.test(row.change_plan_digest) || !["build-requested", "builder-attested", "deployment-requested", "deployed", "rejected"].includes(row.status) ||
    (attested && required.some((value) => value === null || !/^sha256:[0-9a-f]{64}$/u.test(value))) ||
    (!attested && required.some((value) => value !== null)) ||
    (row.status === "deployed" && (row.generation_id === null || row.migration_revision === null || row.worker_fencing_token === null || row.receipt_id === null || row.receipt_json === null)) ||
    (row.status !== "deployed" && (row.generation_id !== null || row.migration_revision !== null || row.worker_fencing_token !== null || row.receipt_id !== null || row.receipt_json !== null))) {
    throw new StaticReleaseAuthorityStoreError("AUTHORITY_MISMATCH", "Persisted static release request is invalid.");
  }
  let receipt: StaticDeploymentReceipt | undefined;
  if (row.receipt_json !== null) {
    try { receipt = StaticDeploymentReceiptSchema.parse(row.receipt_json); }
    catch { throw new StaticReleaseAuthorityStoreError("AUTHORITY_MISMATCH", "Persisted static release receipt is invalid."); }
  }
  if (receipt && (receipt.receiptId !== row.receipt_id || receipt.applicationId !== row.application_id || receipt.environment !== row.environment ||
    receipt.activeGenerationId !== row.generation_id || receipt.workerFencingToken !== Number(row.worker_fencing_token) ||
    (receipt.operation === "promote" && (receipt.sourceCommit !== row.source_commit || receipt.compositionChangePlanDigest !== row.change_plan_digest ||
      receipt.buildEvidenceDigest !== row.build_evidence_digest || receipt.applicationDigest !== row.application_digest || receipt.imageDigest !== row.image_digest ||
      receipt.migrationRevision !== row.migration_revision)))) {
    throw new StaticReleaseAuthorityStoreError("AUTHORITY_MISMATCH", "Persisted static release receipt does not bind its durable request.");
  }
  return Object.freeze({
    buildRequestDigest: row.request_digest,
    applicationId: row.application_id,
    environment: row.environment,
    version: row.version,
    sourceCommit: row.source_commit,
    changePlanDigest: row.change_plan_digest,
    status: row.status,
    ...(row.generation_id ? { generationId: row.generation_id } : {}),
    ...(row.build_evidence_digest ? { buildEvidenceDigest: row.build_evidence_digest } : {}),
    ...(row.application_digest ? { applicationDigest: row.application_digest } : {}),
    ...(row.image_digest ? { imageDigest: row.image_digest } : {}),
    ...(row.migration_revision !== null ? { migrationRevision: row.migration_revision } : {}),
    ...(row.worker_fencing_token !== null ? { workerFencingToken: Number(row.worker_fencing_token) } : {}),
    ...(receipt ? { receipt: Object.freeze(receipt) } : {})
  });
}

const releaseColumns = "request_digest, application_id, environment, version, source_commit, change_plan_digest, status, generation_id, build_evidence_digest, application_digest, image_digest, migration_revision, worker_fencing_token, receipt_id, receipt_json";

/**
 * The web process persists an idempotent intent only. Repository mutation is
 * performed by the separately credentialed static-release service.
 */
export class PostgresStaticCompositionCheckpointStore implements StaticCompositionCheckpointStore {
  constructor(private readonly pool: RuntimeExtensionPool) {}

  async read(checkpointId: string): Promise<StaticCompositionCheckpoint | undefined> {
    const result = await this.pool.query<CheckpointRow>(
      `select checkpoint_id, application_id, environment, expected_source_commit, change_json, status
       from runtime_static_composition_checkpoints where checkpoint_id=$1`, [checkpointId]
    );
    return result.rows[0] ? checkpoint(result.rows[0]) : undefined;
  }

  async save(value: StaticCompositionCheckpoint): Promise<StaticCompositionCheckpoint> {
    const parsed = StaticCompositionChangePlanSchema.parse(value.change);
    const inserted = await this.pool.query<CheckpointRow>(
      `insert into runtime_static_composition_checkpoints
         (checkpoint_id, application_id, environment, expected_source_commit, change_json, change_digest, status)
       values ($1,$2,$3,$4,$5::jsonb,$6,'planned')
       on conflict (checkpoint_id) do nothing
       returning checkpoint_id, application_id, environment, expected_source_commit, change_json, status`,
      [value.checkpointId, value.applicationId, value.environment, value.expectedSourceCommit, JSON.stringify(parsed), digest(parsed)]
    );
    const persisted = inserted.rows[0] ? checkpoint(inserted.rows[0]) : await this.read(value.checkpointId);
    if (!persisted || persisted.applicationId !== value.applicationId || persisted.environment !== value.environment ||
      persisted.expectedSourceCommit !== value.expectedSourceCommit || !same(persisted.change, parsed)) {
      throw new StaticReleaseAuthorityStoreError("CHECKPOINT_CONFLICT", "Static composition checkpoint already binds different authority.");
    }
    return persisted;
  }

  async commit(checkpointId: string): Promise<StaticCompositionCheckpoint> {
    const updated = await this.pool.query<CheckpointRow>(
      `update runtime_static_composition_checkpoints set status='committed', committed_at=now()
       where checkpoint_id=$1 and status='planned'
       returning checkpoint_id, application_id, environment, expected_source_commit, change_json, status`, [checkpointId]
    );
    const persisted = updated.rows[0] ? checkpoint(updated.rows[0]) : await this.read(checkpointId);
    if (!persisted || persisted.status !== "committed") {
      throw new StaticReleaseAuthorityStoreError("CHECKPOINT_CONFLICT", "Static composition checkpoint is unavailable for commit.");
    }
    return persisted;
  }
}

/** Durable request boundary between PluginManager and the source/build/deploy service. */
export class PostgresTrustedBuildDeploymentClient implements TrustedBuildDeploymentClient, StaticReleaseRequestAuthority {
  constructor(private readonly pool: RuntimeExtensionPool) {}

  async request(change: StaticCompositionChangeResult, authorization: OperationAuthorizationDecision): Promise<TrustedDeploymentRequest> {
    const parsed = StaticCompositionChangePlanSchema.parse(change.change);
    if (change.targetSourceCommit !== parsed.target.sourceCommit || change.planDigest !== digest(parsed)) {
      throw new StaticReleaseAuthorityStoreError("AUTHORITY_MISMATCH", "Static release request does not bind the deterministic source change.");
    }
    const buildRequestDigest = digest({ change, authorization });
    const result = await this.pool.query<ReleaseRequestRow>(
      `insert into runtime_static_release_requests
         (request_digest, application_id, environment, version, source_commit, change_plan_digest, change_json, authorization_json, status)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'build-requested')
       on conflict (request_digest) do nothing
       returning ${releaseColumns}`,
      [buildRequestDigest, parsed.applicationId, parsed.environment, parsed.plugin.version, parsed.target.sourceCommit, change.planDigest, JSON.stringify(parsed), JSON.stringify(authorization)]
    );
    const persisted = result.rows[0] ? releaseRequest(result.rows[0]) : await this.readRequest(buildRequestDigest);
    if (!persisted || persisted.applicationId !== parsed.applicationId || persisted.environment !== parsed.environment || persisted.version !== parsed.plugin.version ||
      persisted.sourceCommit !== change.targetSourceCommit || persisted.changePlanDigest !== change.planDigest) {
      throw new StaticReleaseAuthorityStoreError("AUTHORITY_MISMATCH", "Durable build request conflicts with the authorized source change.");
    }
    return Object.freeze({ buildRequestDigest, sourceCommit: persisted.sourceCommit, status: "build-requested" });
  }

  async readRequest(buildRequestDigest: string): Promise<DurableStaticReleaseRequest | undefined> {
    const result = await this.pool.query<ReleaseRequestRow>(
      `select ${releaseColumns} from runtime_static_release_requests where request_digest=$1`, [buildRequestDigest]
    );
    return result.rows[0] ? releaseRequest(result.rows[0]) : undefined;
  }

  async attestBuild(input: Readonly<{
    buildRequestDigest: string;
    expectedVersion: string;
    sourceCommit: string;
    buildEvidenceDigest: string;
    applicationDigest: string;
    imageDigest: string;
  }>): Promise<DurableStaticReleaseRequest> {
    const updated = await this.pool.query<ReleaseRequestRow>(
      `update runtime_static_release_requests set status='builder-attested', build_evidence_digest=$3, application_digest=$4, image_digest=$5, updated_at=now()
       where request_digest=$1 and version=$2 and source_commit=$6 and status='build-requested'
       returning ${releaseColumns}`,
      [input.buildRequestDigest, input.expectedVersion, input.buildEvidenceDigest, input.applicationDigest, input.imageDigest, input.sourceCommit]
    );
    const persisted = updated.rows[0] ? releaseRequest(updated.rows[0]) : await this.readRequest(input.buildRequestDigest);
    if (!persisted || persisted.version !== input.expectedVersion || persisted.sourceCommit !== input.sourceCommit ||
      !["builder-attested", "deployment-requested", "deployed"].includes(persisted.status) || persisted.buildEvidenceDigest !== input.buildEvidenceDigest ||
      persisted.applicationDigest !== input.applicationDigest || persisted.imageDigest !== input.imageDigest) {
      throw new StaticReleaseAuthorityStoreError("RELEASE_TRANSITION_CONFLICT", "Build attestation is stale or conflicts with the durable release request.");
    }
    return persisted;
  }

  async requestDeployment(input: Readonly<{ buildRequestDigest: string; expectedVersion: string }>): Promise<DurableStaticReleaseRequest> {
    const updated = await this.pool.query<ReleaseRequestRow>(
      `update runtime_static_release_requests set status='deployment-requested', updated_at=now()
       where request_digest=$1 and version=$2 and status='builder-attested'
       returning ${releaseColumns}`,
      [input.buildRequestDigest, input.expectedVersion]
    );
    const persisted = updated.rows[0] ? releaseRequest(updated.rows[0]) : await this.readRequest(input.buildRequestDigest);
    if (!persisted || persisted.version !== input.expectedVersion || !["deployment-requested", "deployed"].includes(persisted.status)) {
      throw new StaticReleaseAuthorityStoreError("RELEASE_TRANSITION_CONFLICT", "Deployment request is stale or conflicts with the durable release request.");
    }
    return persisted;
  }

  async recordDeployment(input: Readonly<{ buildRequestDigest: string; expectedVersion: string; receipt: StaticDeploymentReceipt }>): Promise<DurableStaticReleaseRequest> {
    const receipt = StaticDeploymentReceiptSchema.parse(input.receipt);
    if (receipt.operation !== "promote" && receipt.operation !== "rollback") {
      throw new StaticReleaseAuthorityStoreError("RELEASE_TRANSITION_CONFLICT", "Only promotion or rollback receipts can complete a release request.");
    }
    const updated = await this.pool.query<ReleaseRequestRow>(
      `update runtime_static_release_requests set status='deployed', generation_id=$3, migration_revision=$4, worker_fencing_token=$5, receipt_id=$6, receipt_json=$7::jsonb, updated_at=now()
       where request_digest=$1 and version=$2 and status='deployment-requested' and application_id=$13 and environment=$14 and
         ($15='rollback' or (source_commit=$8 and change_plan_digest=$9 and build_evidence_digest=$10 and application_digest=$11 and image_digest=$12))
       returning ${releaseColumns}`,
      [input.buildRequestDigest, input.expectedVersion, receipt.activeGenerationId, receipt.migrationRevision, receipt.workerFencingToken, receipt.receiptId,
        JSON.stringify(receipt), receipt.sourceCommit, receipt.compositionChangePlanDigest, receipt.buildEvidenceDigest, receipt.applicationDigest, receipt.imageDigest,
        receipt.applicationId, receipt.environment, receipt.operation]
    );
    const persisted = updated.rows[0] ? releaseRequest(updated.rows[0]) : await this.readRequest(input.buildRequestDigest);
    if (!persisted || persisted.version !== input.expectedVersion || persisted.status !== "deployed" || !persisted.receipt || !same(persisted.receipt, receipt)) {
      throw new StaticReleaseAuthorityStoreError("RELEASE_TRANSITION_CONFLICT", "Deployment receipt is stale or conflicts with the durable release request.");
    }
    return persisted;
  }

  async recoverDeployment(input: Readonly<{
    buildRequestDigest: string;
    expectedVersion: string;
    expectedRevision: number;
    targetGenerationId: string;
    operation: "promote" | "rollback";
  }>): Promise<DurableStaticReleaseRequest | undefined> {
    const request = await this.readRequest(input.buildRequestDigest);
    if (!request || request.version !== input.expectedVersion) return undefined;
    if (request.status === "deployed") return request;
    if (request.status !== "deployment-requested") return undefined;
    const result = await this.pool.query<{ event_json: unknown }>(
      `select event_json from runtime_static_deployment_outbox
       where application_id=$1 and environment=$2 and revision=$3`,
      [request.applicationId, request.environment, input.expectedRevision + 1]
    );
    let receipt: StaticDeploymentReceipt;
    try { receipt = StaticDeploymentReceiptSchema.parse(result.rows[0]?.event_json); }
    catch { return undefined; }
    if (receipt.operation !== input.operation || receipt.revisionBefore !== input.expectedRevision || receipt.activeGenerationId !== input.targetGenerationId) return undefined;
    return this.recordDeployment({ buildRequestDigest: input.buildRequestDigest, expectedVersion: input.expectedVersion, receipt });
  }

  async reverify(authority: StaticGenerationAuthority): Promise<boolean> {
    const result = await this.pool.query<ReleaseRequestRow>(
      `select ${releaseColumns}
       from runtime_static_release_requests
       where generation_id=$1 and version=$2 and source_commit=$3 and change_plan_digest=$4 and build_evidence_digest=$5 and application_digest=$6 and image_digest=$7 and migration_revision=$8 and worker_fencing_token=$9 and receipt_id=$10 and status='deployed'`,
      [authority.generationId, authority.version, authority.sourceCommit, authority.compositionChangePlanDigest, authority.buildEvidenceDigest, authority.applicationDigest, authority.imageDigest, authority.migrationRevision, authority.workerFencingToken, authority.receiptId]
    );
    try { return result.rows.length === 1 && releaseRequest(result.rows[0]!).receipt?.receiptId === authority.receiptId; }
    catch { return false; }
  }
}
