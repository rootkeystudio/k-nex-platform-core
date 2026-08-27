import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createCycloneDxSbom, createReleaseProvenance, resolvePnpmLock, signReleaseProvenance, verifyReleaseProvenance } from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const sourceCommit = "a".repeat(40);

describe("release evidence", () => {
  it("produces deterministic CycloneDX component inventory", () => {
    const input = [{ name: "payload", version: "3.88.0" }, { name: "@k-nex/module-sales", version: "1.0.0", integrity: digest("b") }];
    const first = createCycloneDxSbom("customer-alpha", input);
    expect(createCycloneDxSbom("customer-alpha", [...input].reverse())).toEqual(first);
    expect(first).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.6", components: [{ name: "@k-nex/module-sales" }, { name: "payload" }] });
  });

  it("derives transitive components, integrities, and dependency edges from the dedicated lock", () => {
    const lock = resolvePnpmLock(readFileSync(new URL("../../../fixtures/customer-alpha/pnpm-lock.yaml", import.meta.url), "utf8"));
    expect(lock.components.length).toBeGreaterThan(800);
    expect(lock.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "semver", version: "7.8.5", integrity: expect.stringMatching(/^sha512-/u) }),
      expect.objectContaining({ name: "yaml", version: "2.9.0" }),
      expect.objectContaining({ name: "zod", version: "4.4.3" })
    ]));
    expect(lock.dependencies.some(({ dependsOn }) => dependsOn.length > 0)).toBe(true);
    const sbom = createCycloneDxSbom("customer-alpha", lock.components, lock.dependencies, lock.rootDependencies);
    expect(sbom.components).toHaveLength(lock.components.length);
    expect(sbom.dependencies.length).toBeGreaterThan(1);
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
    const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
    const statement = createReleaseProvenance({ subjectName: "artifact.tgz", artifactDigest: digest("1"), sourceCommit, workflowIdentity: `repo/workflow@${sourceCommit}`, materials: [] });
    const envelope = signReleaseProvenance(statement, privateKey);
    expect(verifyReleaseProvenance(envelope, publicKey)).toEqual(statement);
    expect(() => verifyReleaseProvenance({ ...envelope, payload: envelope.payload.replace("artifact", "tampered") }, publicKey)).toThrow("signature is invalid");
  });
});
