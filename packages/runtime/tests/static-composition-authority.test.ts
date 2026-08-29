import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson, type ExtensionInstallPlan, type StaticCompositionChangePlan } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  DeterministicStaticCompositionChangeAuthority,
  TrustedStaticApplicationBuildAuthority,
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
  applicationId: fixture.applicationId,
  environment: fixture.environment,
  expectedSourceCommit: fixture.base.sourceCommit,
  generationId: "customer-alpha-green-9",
  plan: installPlan
};
const authorization = { actor: { kind: "trusted-automation" as const, identity: "github-actions:phase-9" }, decisionId: fixture.authority.requestDigest };

describe("static source and trusted build authority", () => {
  it("commits only an exact-base deterministic customer source change", async () => {
    const commit = vi.fn(async () => fixture.target.sourceCommit);
    const authority = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: fixture.base.sourceCommit, composition: fixture.base.composition }), commit },
      { resolve: async () => fixture }
    );
    const result = await authority.request(request, authorization);
    expect(result).toMatchObject({ status: "source-change-ready", targetSourceCommit: fixture.target.sourceCommit, change: fixture });
    expect(result.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(commit).toHaveBeenCalledWith(fixture.base.sourceCommit, fixture);

    const stale = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: "f".repeat(40), composition: fixture.base.composition }), commit },
      { resolve: async () => fixture }
    );
    await expect(stale.request(request, authorization)).rejects.toMatchObject({ code: "SOURCE_CONFLICT" });
    const mismatched = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: fixture.base.sourceCommit, composition: fixture.base.composition }), commit },
      { resolve: async () => ({ ...fixture, plugin: { ...fixture.plugin, id: "module.other" } }) }
    );
    await expect(mismatched.request(request, authorization)).rejects.toMatchObject({ code: "CHANGE_INVALID" });
  });

  it("accepts only signed build evidence bound to the exact source, graph, application, and image", async () => {
    const source = new DeterministicStaticCompositionChangeAuthority(
      fixture.authority.identity,
      { current: async () => ({ sourceCommit: fixture.base.sourceCommit, composition: fixture.base.composition }), commit: async () => fixture.target.sourceCommit },
      { resolve: async () => fixture }
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
    const authority = new TrustedStaticApplicationBuildAuthority({ "builder:k-nex-phase-9": keys.publicKey.export({ type: "spki", format: "pem" }).toString() });
    const token = authority.verify(change, evidence);
    expect(authority.read(token)).toMatchObject({ evidence: statement, change });
    expect(() => authority.verify(change, { ...evidence, imageSubject: { ...evidence.imageSubject, digest: digest("9") } })).toThrowError(expect.objectContaining({ code: "BUILD_EVIDENCE_INVALID" }));
    expect(() => new TrustedStaticApplicationBuildAuthority({ "builder:other": keys.publicKey.export({ type: "spki", format: "pem" }).toString() }).verify(change, evidence))
      .toThrowError(expect.objectContaining({ code: "BUILD_EVIDENCE_INVALID" }));
  });
});
