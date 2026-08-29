import { createHash, verify } from "node:crypto";

import {
  canonicalJson,
  StaticCompositionChangePlanSchema,
  TrustedApplicationBuildEvidenceSchema,
  type StaticCompositionChangePlan,
  type TrustedApplicationBuildEvidence
} from "@k-nex/contracts";

import type {
  OperationAuthorizationDecision,
  StaticCompositionChangeAuthority,
  StaticCompositionChangeRequest,
  StaticCompositionChangeResult
} from "./plugin-manager.js";

export class StaticCompositionAuthorityError extends Error {
  constructor(readonly code: "SOURCE_CONFLICT" | "CHANGE_INVALID" | "BUILD_EVIDENCE_INVALID", message: string) {
    super(message);
    this.name = "StaticCompositionAuthorityError";
  }
}

export interface StaticCompositionSnapshot {
  readonly sourceCommit: string;
  readonly composition: StaticCompositionChangePlan["base"]["composition"];
}

export interface StaticCompositionRepository {
  current(applicationId: string, environment: string): Promise<StaticCompositionSnapshot>;
  commit(expectedSourceCommit: string, change: StaticCompositionChangePlan): Promise<string>;
}

export interface StaticCompositionCheckpoint {
  readonly checkpointId: string;
  readonly applicationId: string;
  readonly environment: string;
  readonly expectedSourceCommit: string;
  readonly change: StaticCompositionChangePlan;
  readonly status: "planned" | "committed";
}

export interface StaticCompositionCheckpointStore {
  read(checkpointId: string): Promise<StaticCompositionCheckpoint | undefined>;
  save(checkpoint: StaticCompositionCheckpoint): Promise<StaticCompositionCheckpoint>;
  commit(checkpointId: string): Promise<StaticCompositionCheckpoint>;
}

export interface StaticCompositionResolver {
  resolve(input: Readonly<{
    request: StaticCompositionChangeRequest;
    authorization: OperationAuthorizationDecision;
    base: StaticCompositionSnapshot;
    authorityIdentity: string;
  }>): Promise<unknown>;
}

export interface VerifiedStaticApplicationBuild { readonly __verifiedStaticApplicationBuild: unique symbol; }

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export class DeterministicStaticCompositionChangeAuthority implements StaticCompositionChangeAuthority {
  constructor(
    private readonly identity: string,
    private readonly repository: StaticCompositionRepository,
    private readonly resolver: StaticCompositionResolver,
    private readonly checkpoints: StaticCompositionCheckpointStore
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(identity)) throw new TypeError("Static composition authority identity is invalid.");
  }

  async request(request: StaticCompositionChangeRequest, authorization: OperationAuthorizationDecision): Promise<StaticCompositionChangeResult> {
    if (!/^[0-9a-f]{40}$/u.test(request.expectedSourceCommit)) throw new StaticCompositionAuthorityError("CHANGE_INVALID", "Expected customer source commit is invalid.");
    const checkpointId = digest({ authority: this.identity, authorization, request });
    const checkpoint = await this.checkpoints.read(checkpointId) ?? await this.createCheckpoint(checkpointId, request, authorization);
    this.assertCheckpoint(checkpoint, checkpointId, request, authorization);
    const current = await this.repository.current(request.applicationId, request.environment);
    if (current.sourceCommit === checkpoint.change.target.sourceCommit && same(current.composition, checkpoint.change.target.composition)) {
      const committed = checkpoint.status === "committed" ? checkpoint : await this.checkpoints.commit(checkpointId);
      return this.result(committed);
    }
    if (current.sourceCommit !== request.expectedSourceCommit || !same(current.composition, checkpoint.change.base.composition)) {
      throw new StaticCompositionAuthorityError("SOURCE_CONFLICT", "Customer source changed before the approved composition edit.");
    }
    try {
      const committed = await this.repository.commit(request.expectedSourceCommit, checkpoint.change);
      if (committed !== checkpoint.change.target.sourceCommit) throw new StaticCompositionAuthorityError("SOURCE_CONFLICT", "Customer source authority did not commit the exact resolved target.");
    } catch (error) {
      const recovered = await this.repository.current(request.applicationId, request.environment);
      if (recovered.sourceCommit !== checkpoint.change.target.sourceCommit || !same(recovered.composition, checkpoint.change.target.composition)) throw error;
    }
    return this.result(await this.checkpoints.commit(checkpointId));
  }

  private async createCheckpoint(
    checkpointId: string,
    request: StaticCompositionChangeRequest,
    authorization: OperationAuthorizationDecision
  ): Promise<StaticCompositionCheckpoint> {
    const base = await this.repository.current(request.applicationId, request.environment);
    if (base.sourceCommit !== request.expectedSourceCommit) throw new StaticCompositionAuthorityError("SOURCE_CONFLICT", "Customer source changed before the approved composition edit.");
    let change: StaticCompositionChangePlan;
    try { change = StaticCompositionChangePlanSchema.parse(await this.resolver.resolve({ request, authorization, base, authorityIdentity: this.identity })); }
    catch { throw new StaticCompositionAuthorityError("CHANGE_INVALID", "Resolved static composition change is invalid."); }
    if (change.applicationId !== request.applicationId || change.environment !== request.environment || change.deliveryClass !== "platform-plugin" ||
      change.plugin.id !== request.plan.id || change.plugin.version !== request.plan.version || change.plugin.releaseManifestDigest !== request.plan.artifactDigest ||
      change.authority.identity !== this.identity || change.authority.requestDigest !== authorization.decisionId ||
      change.base.sourceCommit !== request.expectedSourceCommit || !same(change.base.composition, base.composition) ||
      change.target.sourceCommit !== change.migration.targetSourceCommit || change.base.sourceCommit !== change.migration.sourceCommit ||
      change.migration.applicationId !== request.applicationId || change.migration.environment !== request.environment) {
      throw new StaticCompositionAuthorityError("CHANGE_INVALID", "Static composition change does not bind the authorized request and exact source graph.");
    }
    return this.checkpoints.save(Object.freeze({
      checkpointId,
      applicationId: request.applicationId,
      environment: request.environment,
      expectedSourceCommit: request.expectedSourceCommit,
      change: Object.freeze(structuredClone(change)),
      status: "planned"
    }));
  }

  private assertCheckpoint(
    checkpoint: StaticCompositionCheckpoint,
    checkpointId: string,
    request: StaticCompositionChangeRequest,
    authorization: OperationAuthorizationDecision
  ): void {
    if (checkpoint.checkpointId !== checkpointId || checkpoint.applicationId !== request.applicationId || checkpoint.environment !== request.environment ||
      checkpoint.expectedSourceCommit !== request.expectedSourceCommit) {
      throw new StaticCompositionAuthorityError("CHANGE_INVALID", "Persisted static composition checkpoint does not bind the authorized request.");
    }
    const change = checkpoint.change;
    if (change.applicationId !== request.applicationId || change.environment !== request.environment || change.deliveryClass !== "platform-plugin" ||
      change.plugin.id !== request.plan.id || change.plugin.version !== request.plan.version || change.plugin.releaseManifestDigest !== request.plan.artifactDigest ||
      change.authority.identity !== this.identity || change.authority.requestDigest !== authorization.decisionId ||
      change.base.sourceCommit !== request.expectedSourceCommit || change.target.sourceCommit !== change.migration.targetSourceCommit ||
      change.base.sourceCommit !== change.migration.sourceCommit) {
      throw new StaticCompositionAuthorityError("CHANGE_INVALID", "Persisted static composition checkpoint does not bind the authorized source graph.");
    }
  }

  private result(checkpoint: StaticCompositionCheckpoint): StaticCompositionChangeResult {
    return Object.freeze({
      status: "source-change-ready",
      planDigest: digest(checkpoint.change),
      targetSourceCommit: checkpoint.change.target.sourceCommit,
      change: Object.freeze(structuredClone(checkpoint.change))
    });
  }
}

export class TrustedStaticApplicationBuildAuthority {
  readonly #evidence = new WeakMap<object, Readonly<{ change: StaticCompositionChangeResult; evidence: TrustedApplicationBuildEvidence; evidenceDigest: string }>>();
  readonly #keys: ReadonlyMap<string, string>;

  constructor(keys: Readonly<Record<string, string>>) {
    this.#keys = new Map(Object.entries(keys));
    if (this.#keys.size === 0) throw new TypeError("At least one trusted application builder key is required.");
  }

  verify(change: StaticCompositionChangeResult, value: unknown): VerifiedStaticApplicationBuild {
    let evidence: TrustedApplicationBuildEvidence;
    try { evidence = TrustedApplicationBuildEvidenceSchema.parse(value); }
    catch { throw new StaticCompositionAuthorityError("BUILD_EVIDENCE_INVALID", "Trusted application build evidence is invalid."); }
    const key = this.#keys.get(evidence.signature.keyId);
    const { signature, ...statement } = evidence;
    let signatureValid = false;
    try { signatureValid = key !== undefined && verify(null, Buffer.from(canonicalJson(statement)), key, Buffer.from(signature.value, "base64")); } catch { signatureValid = false; }
    const plan = change.change;
    if (!signatureValid || evidence.applicationId !== plan.applicationId || evidence.environment !== plan.environment ||
      evidence.sourceCommit !== plan.target.sourceCommit || !same(evidence.composition, plan.target.composition) ||
      evidence.applicationSubject.digest !== plan.target.applicationSubjectDigest || evidence.imageSubject.digest !== plan.target.imageSubjectDigest) {
      throw new StaticCompositionAuthorityError("BUILD_EVIDENCE_INVALID", "Build evidence signature or exact target materials do not match the authorized source change.");
    }
    const token = Object.freeze({}) as VerifiedStaticApplicationBuild;
    this.#evidence.set(token, Object.freeze({ change, evidence: Object.freeze(structuredClone(evidence)), evidenceDigest: digest(evidence) }));
    return token;
  }

  read(token: VerifiedStaticApplicationBuild): Readonly<{ change: StaticCompositionChangeResult; evidence: TrustedApplicationBuildEvidence; evidenceDigest: string }> {
    const value = this.#evidence.get(token);
    if (!value) throw new StaticCompositionAuthorityError("BUILD_EVIDENCE_INVALID", "Application build token was not issued by this trusted authority.");
    return value;
  }
}
