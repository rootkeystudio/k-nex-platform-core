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
    private readonly resolver: StaticCompositionResolver
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(identity)) throw new TypeError("Static composition authority identity is invalid.");
  }

  async request(request: StaticCompositionChangeRequest, authorization: OperationAuthorizationDecision): Promise<StaticCompositionChangeResult> {
    if (!/^[0-9a-f]{40}$/u.test(request.expectedSourceCommit)) throw new StaticCompositionAuthorityError("CHANGE_INVALID", "Expected customer source commit is invalid.");
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
    const committed = await this.repository.commit(request.expectedSourceCommit, change);
    if (committed !== change.target.sourceCommit) throw new StaticCompositionAuthorityError("SOURCE_CONFLICT", "Customer source authority did not commit the exact resolved target.");
    return Object.freeze({ status: "source-change-ready", planDigest: digest(change), targetSourceCommit: committed, change: Object.freeze(structuredClone(change)) });
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
