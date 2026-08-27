import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createCycloneDxSbom, createReleaseProvenance, signReleaseProvenance, verifyReleaseProvenance } from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const sourceCommit = "a".repeat(40);

describe("release evidence", () => {
  it("produces deterministic CycloneDX component inventory", () => {
    const input = [{ name: "payload", version: "3.88.0" }, { name: "@k-nex/module-sales", version: "1.0.0", sha256: digest("b") }];
    const first = createCycloneDxSbom("customer-alpha", input);
    expect(createCycloneDxSbom("customer-alpha", [...input].reverse())).toEqual(first);
    expect(first).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.6", components: [{ name: "@k-nex/module-sales" }, { name: "payload" }] });
  });

  it("binds source, full-SHA workflow, lock, graph, SBOM, and artifact digests", () => {
    const statement = createReleaseProvenance({
      subjectName: "k-nex-module-sales-1.0.0.tgz", artifactDigest: digest("1"), sourceCommit,
      workflowIdentity: `rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@${sourceCommit}`,
      materials: [{ name: "sbom", digest: digest("2") }, { name: "lockfile", digest: digest("3") }, { name: "resolved-graph", digest: digest("4") }]
    });
    expect(statement.predicate.materials.map(({ name }) => name)).toEqual(["lockfile", "resolved-graph", "sbom"]);
    expect(() => createReleaseProvenance({ ...statement.subject, subjectName: "artifact", artifactDigest: digest("1"), sourceCommit, workflowIdentity: "workflow@main", materials: [] })).toThrow("full-SHA");
  });

  it("verifies Ed25519 provenance and rejects payload or signature substitution", () => {
    const keys = generateKeyPairSync("ed25519");
    const statement = createReleaseProvenance({ subjectName: "artifact.tgz", artifactDigest: digest("1"), sourceCommit, workflowIdentity: `repo/workflow@${sourceCommit}`, materials: [] });
    const envelope = signReleaseProvenance(statement, keys.privateKey);
    expect(verifyReleaseProvenance(envelope, keys.publicKey)).toEqual(statement);
    expect(() => verifyReleaseProvenance({ ...envelope, payload: envelope.payload.replace("artifact", "tampered") }, keys.publicKey)).toThrow("signature is invalid");
  });
});
