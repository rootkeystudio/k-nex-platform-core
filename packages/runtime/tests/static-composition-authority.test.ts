import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson, type ExtensionInstallPlan, type StaticCompositionChangePlan } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  DeterministicStaticCompositionChangeAuthority,
  TrustedStaticApplicationBuildAuthority,
  type StaticCompositionCheckpoint,
  type StaticCompositionChangeRequest
} from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/extensions/valid/static-composition-change-plan.json", import.meta.url), "utf8")) as StaticCompositionChangePlan;
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const installPlan: Extract<ExtensionInstallPlan, { deliveryClass: "platform-plugin" }> = {
  schemaVersion: 1,
  planId: "sales-static-plan-1",
  operationId: "sales-static-operation-1",
  operation: "update",
  version: fixture.plugin.version,
  artifactDigest: fixture.plugin.releaseManifestDigest,
  expectedRevision: 8,
  currentGenerationId: "customer-alpha-blue-8",
  targetGenerationId: "customer-alpha-green-9",
  approvalRequired: true,
  rollback: { available: true, windowSeconds: 604_800 },
  deliveryClass: "platform-plugin",
  id: fixture.plugin.id,
  availability: { outcome: "zero-downtime-eligible", checks: ["source-build-evidence", "migration-overlap", "worker-fence", "gateway-capacity", "rollback-window"] }
};
const request: StaticCompositionChangeRequest = {
  operationId: "operation-0123456789abcdef0123456789abcdef",
  applicationId: fixture.applicationId,
  environment: fixture.environment,
  expectedSourceCommit: fixture.base.sourceCommit,
  generationId: "customer-alpha-green-9",
  plan: installPlan
};
const authorization = { actor: { kind: "trusted-automation" as const, identity: "github-actions:phase-9" }, decisionId: fixture.authority.requestDigest };

function checkpoints() {
  const values = new Map<string, StaticCompositionCheckpoint>();
  return {
    values,
    read: vi.fn(async (checkpointId: string) => values.get(checkpointId)),
    save: vi.fn(async (checkpoint: StaticCompositionCheckpoint) => {
      const existing = values.get(checkpoint.checkpointId);
      if (existing) return existing;
      values.set(checkpoint.checkpointId, checkpoint);
      return checkpoint;
    }),
    commit: vi.fn(async (checkpointId: string) => {
      const checkpoint = values.get(checkpointId);
      if (!checkpoint) throw new Error("missing checkpoint");
      const committed = { ...checkpoint, status: "committed" as const };
      values.set(checkpointId, committed);
      return committed;
    })
  };
}

describe("static source and trusted build authority", () => {
  it("commits only an exact-base deterministic customer source change", async () => {
    const commit = vi.fn(async () => fixture.target.sourceCommit);
    const checkpoint = checkpoints();
    const authority = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: fixture.base.sourceCommit, composition: fixture.base.composition }), commit },
      { resolve: async () => fixture },
      checkpoint
    );
    const result = await authority.request(request, authorization);
    expect(result).toMatchObject({ status: "source-change-ready", targetSourceCommit: fixture.target.sourceCommit, change: fixture });
    expect(result.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(commit).toHaveBeenCalledWith(fixture.base.sourceCommit, fixture);

    const stale = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: "f".repeat(40), composition: fixture.base.composition }), commit },
      { resolve: async () => fixture },
      checkpoints()
    );
    await expect(stale.request(request, authorization)).rejects.toMatchObject({ code: "SOURCE_CONFLICT" });
    const mismatched = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: fixture.base.sourceCommit, composition: fixture.base.composition }), commit },
      { resolve: async () => ({ ...fixture, plugin: { ...fixture.plugin, id: "module.other" } }) },
      checkpoints()
    );
    await expect(mismatched.request(request, authorization)).rejects.toMatchObject({ code: "CHANGE_INVALID" });
  });

  it("rejects arbitrary repository and branch controls in a static source change", async () => {
    const authority = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: fixture.base.sourceCommit, composition: fixture.base.composition }), commit: async () => fixture.target.sourceCommit },
      { resolve: async () => ({ ...fixture, target: { ...fixture.target, repositoryUrl: "https://attacker.invalid/customer.git", branch: "main" } }) },
      checkpoints()
    );
    await expect(authority.request(request, authorization)).rejects.toMatchObject({ code: "CHANGE_INVALID" });
  });

  it("persists a checkpoint before commit and recovers a commit that crashes before manager persistence", async () => {
    const checkpoint = checkpoints();
    let sourceCommit = fixture.base.sourceCommit;
    let sourceComposition = fixture.base.composition;
    const commit = vi.fn(async () => {
      expect(checkpoint.save).toHaveBeenCalledOnce();
      sourceCommit = fixture.target.sourceCommit;
      sourceComposition = fixture.target.composition;
      return sourceCommit;
    });
    const authority = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit, composition: sourceComposition }), commit },
      { resolve: async () => fixture },
      {
        ...checkpoint,
        commit: vi.fn(async () => { throw new Error("crash after source commit"); })
      }
    );
    await expect(authority.request(request, authorization)).rejects.toThrow("crash after source commit");
    expect(commit).toHaveBeenCalledOnce();

    const recovered = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit, composition: sourceComposition }), commit },
      { resolve: vi.fn(async () => fixture) },
      checkpoint
    );
    const refreshed = { ...authorization, decisionId: digest("e") };
    await expect(recovered.request(request, refreshed)).resolves.toMatchObject({ targetSourceCommit: fixture.target.sourceCommit });
    expect(commit).toHaveBeenCalledOnce();
    expect(checkpoint.commit).toHaveBeenCalledOnce();

    const otherActor = { actor: { kind: "trusted-automation" as const, identity: "github-actions:other" }, decisionId: digest("f") };
    await expect(recovered.request(request, otherActor)).rejects.toMatchObject({ code: "SOURCE_CONFLICT" });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("serializes concurrent checkpoint recovery to one customer source commit", async () => {
    const checkpoint = checkpoints();
    let sourceCommit = fixture.base.sourceCommit;
    let sourceComposition = fixture.base.composition;
    let committedChanges = 0;
    const commit = vi.fn(async (expected: string) => {
      if (expected !== sourceCommit) throw new Error("source conflict");
      committedChanges += 1;
      sourceCommit = fixture.target.sourceCommit;
      sourceComposition = fixture.target.composition;
      return sourceCommit;
    });
    const authority = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit, composition: sourceComposition }), commit },
      { resolve: async () => fixture },
      checkpoint
    );
    await expect(Promise.all([authority.request(request, authorization), authority.request(request, authorization)])).resolves.toHaveLength(2);
    expect(committedChanges).toBe(1);
  });

  it("accepts only signed build evidence bound to the exact source, graph, application, and image", async () => {
    const source = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: fixture.base.sourceCommit, composition: fixture.base.composition }), commit: async () => fixture.target.sourceCommit },
      { resolve: async () => fixture },
      checkpoints()
    );
    const change = await source.request(request, authorization);
    const keys = generateKeyPairSync("ed25519");
    const statement = {
      schemaVersion: 1 as const,
      applicationId: fixture.applicationId,
      environment: fixture.environment,
      sourceCommit: fixture.target.sourceCommit,
      authority: { kind: "self-hosted-trusted" as const, builderIdentity: "builder:k-nex-phase-9", trustPolicyDigest: digest("1"), ref: "source-commit" as const },
      composition: fixture.target.composition,
      sbomDigest: digest("2"),
      provenanceDigest: digest("3"),
      applicationSubject: { name: "customer-alpha-application.tar.gz", digest: fixture.target.applicationSubjectDigest },
      imageSubject: { repository: "k-nex/customer-alpha", digest: fixture.target.imageSubjectDigest }
    };
    const evidence = {
      ...statement,
      signature: {
        algorithm: "ed25519" as const,
        keyId: "builder:k-nex-phase-9",
        value: sign(null, Buffer.from(canonicalJson(statement)), keys.privateKey).toString("base64")
      }
    };
    const authority = new TrustedStaticApplicationBuildAuthority({
      "builder:k-nex-phase-9": { publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), authority: statement.authority }
    });
    const token = authority.verify(change, evidence);
    expect(authority.read(token)).toMatchObject({ evidence: statement, change });
    expect(() => authority.verify(change, { ...evidence, imageSubject: { ...evidence.imageSubject, digest: digest("9") } })).toThrowError(expect.objectContaining({ code: "BUILD_EVIDENCE_INVALID" }));
    expect(() => new TrustedStaticApplicationBuildAuthority({ "builder:other": { publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), authority: statement.authority } }).verify(change, evidence))
      .toThrowError(expect.objectContaining({ code: "BUILD_EVIDENCE_INVALID" }));
  });

  it("rejects a valid signature whose trusted key is not authorized for the claimed builder identity", async () => {
    const source = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: fixture.base.sourceCommit, composition: fixture.base.composition }), commit: async () => fixture.target.sourceCommit },
      { resolve: async () => fixture },
      checkpoints()
    );
    const change = await source.request(request, authorization);
    const builder = generateKeyPairSync("ed25519");
    const unrelated = generateKeyPairSync("ed25519");
    const statement = {
      schemaVersion: 1 as const,
      applicationId: fixture.applicationId,
      environment: fixture.environment,
      sourceCommit: fixture.target.sourceCommit,
      authority: { kind: "self-hosted-trusted" as const, builderIdentity: "builder:k-nex-phase-9", trustPolicyDigest: digest("1"), ref: "source-commit" as const },
      composition: fixture.target.composition,
      sbomDigest: digest("2"),
      provenanceDigest: digest("3"),
      applicationSubject: { name: "customer-alpha-application.tar.gz", digest: fixture.target.applicationSubjectDigest },
      imageSubject: { repository: "k-nex/customer-alpha", digest: fixture.target.imageSubjectDigest }
    };
    const evidence = {
      ...statement,
      signature: {
        algorithm: "ed25519" as const,
        keyId: "builder:unrelated",
        value: sign(null, Buffer.from(canonicalJson(statement)), unrelated.privateKey).toString("base64")
      }
    };
    const authority = new TrustedStaticApplicationBuildAuthority({
      "builder:k-nex-phase-9": { publicKey: builder.publicKey.export({ type: "spki", format: "pem" }).toString(), authority: statement.authority },
      "builder:unrelated": { publicKey: unrelated.publicKey.export({ type: "spki", format: "pem" }).toString(), authority: { ...statement.authority, builderIdentity: "builder:unrelated" } }
    });

    expect(() => authority.verify(change, evidence)).toThrowError(expect.objectContaining({ code: "BUILD_EVIDENCE_INVALID" }));
  });
});
