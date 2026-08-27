import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson, supportedFrameworkTuple, type PackageReleaseManifest } from "@k-nex/contracts";
import { createReleaseProvenance, signReleaseProvenance } from "@k-nex/composition";

import {
  FleetRegistry, createDeploymentEvidenceAuthority, createDeploymentReceipt, observeRuntimeInventory,
  restoredInventoryMatches, signDeploymentReceipt, type DeploymentEvidenceAuthority
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const sha = "a".repeat(40);
const releaseWorkflow = `repo/release@${sha}`;
const deploymentWorkflow = `repo/deploy@${sha}`;
const releaseKeys = generateKeyPairSync("ed25519");
const deploymentKeys = generateKeyPairSync("ed25519");
const privatePem = (key: typeof releaseKeys.privateKey) => key.export({ format: "pem", type: "pkcs8" }).toString();
const publicPem = (key: typeof releaseKeys.publicKey) => key.export({ format: "pem", type: "spki" }).toString();
const authority = () => createDeploymentEvidenceAuthority({
  provenancePublicKey: publicPem(releaseKeys.publicKey), deploymentPublicKey: publicPem(deploymentKeys.publicKey),
  trustedReleaseWorkflow: releaseWorkflow, trustedDeploymentWorkflow: deploymentWorkflow
});
const supportManifest = {
  schemaVersion: 1, release: { version: "0.2.0", channel: "pre-v1", versioningPolicy: "semver-pre-v1", compatibilityPolicy: "exact-framework-tuple" }, framework: supportedFrameworkTuple,
  packages: [{ package: "@k-nex/module-sales", version: "1.0.0", role: "plugin", integrity: `sha512-${"a".repeat(86)}==`, peerCompatibility: supportedFrameworkTuple }],
  supportWindow: { policy: "current-and-one-prior-minor", supportedReleases: ["0.2.0", "0.1.0"], securityFixes: "all-supported-releases" }
} as const satisfies PackageReleaseManifest;
const patchManifest = {
  ...supportManifest,
  release: { ...supportManifest.release, version: "0.2.1" },
  packages: [{ ...supportManifest.packages[0], version: "1.0.1", integrity: `sha512-${"c".repeat(86)}==` }],
  supportWindow: { ...supportManifest.supportWindow, supportedReleases: ["0.2.1", "0.1.0"] }
} as const satisfies PackageReleaseManifest;

async function deployment(applicationId: "customer-alpha" | "customer-beta", release: "0.2.0" | "0.1.0", trusted: DeploymentEvidenceAuthority) {
  const provenance = createReleaseProvenance({
    subjectName: "sales.tgz", artifactDigest: digest("1"), sourceCommit: sha, workflowIdentity: releaseWorkflow,
    materials: [{ name: "application-manifest", digest: digest("2") }, { name: "lockfile", digest: digest("3") }, { name: "resolved-graph-or-plan", digest: digest("4") }, { name: "sbom", digest: digest("5") }]
  });
  const inventory = observeRuntimeInventory({
    schemaVersion: 1, applicationId, repository: `rootkeystudio/${applicationId}`, environment: "production", platformRelease: release,
    observedAt: "2026-08-27T12:00:00.000Z", artifactDigest: digest("1"), releaseEvidence: { sourceCommit: sha, workflowIdentity: releaseWorkflow, manifestDigest: digest("2"), lockfileDigest: digest("3"), resolvedGraphDigest: digest("4"), sbomDigest: digest("5"), provenanceDigest: `sha256:${createHash("sha256").update(canonicalJson(provenance)).digest("hex")}` },
    packages: [{ package: "@k-nex/module-sales", version: release === "0.2.0" ? "1.0.0" : "0.9.0", integrity: `sha512-${(release === "0.2.0" ? "a" : "b").repeat(86)}==` }],
    plugins: [{ id: "module.sales", package: "@k-nex/module-sales", version: release === "0.2.0" ? "1.0.0" : "0.9.0", enabled: true }], migrationRevision: release === "0.2.0" ? 7 : 6,
    settings: [{ id: "sales.settings", schemaVersion: 1, revision: 1 }], templates: [{ id: "sales.page.tasks", templateVersion: 1, revision: 1 }], health: { status: "ready", checks: ["sales"] }
  });
  const receipt = createDeploymentReceipt({ inventory, deploymentId: `deploy:${applicationId}:1`, deployedAt: "2026-08-27T12:05:00.000Z", approvedBy: { kind: "workflow", identity: deploymentWorkflow }, smoke: { status: "passed", checks: ["sales"] } });
  const evidence = await trusted.verify({
    observe: async () => structuredClone(inventory), receipt: signDeploymentReceipt(receipt, privatePem(deploymentKeys.privateKey)),
    provenance: signReleaseProvenance(provenance, privatePem(releaseKeys.privateKey))
  });
  return { evidence, inventory };
}

describe("fleet evidence and patch propagation", () => {
  it("ingests only authority-verified deployments and preserves current/prior release state", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(supportManifest, trusted);
    const alpha = await deployment("customer-alpha", "0.2.0", trusted);
    const beta = await deployment("customer-beta", "0.1.0", trusted);
    fleet.ingest(alpha.evidence); fleet.ingest(beta.evidence);
    expect(fleet.list().map(({ inventory }) => inventory.platformRelease)).toEqual(["0.2.0", "0.1.0"]);
    const other = authority();
    const foreign = await deployment("customer-alpha", "0.2.0", other);
    expect(() => fleet.ingest(foreign.evidence)).toThrow("trusted deployment authority");
    expect(() => fleet.ingest(({} as never))).toThrow("trusted deployment authority");
    expect(() => fleet.ingest((alpha.inventory as never))).toThrow("trusted deployment authority");
  });

  it("snapshots and deeply freezes authoritative fleet evidence", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(supportManifest, trusted);
    fleet.ingest((await deployment("customer-alpha", "0.2.0", trusted)).evidence);
    const stored = fleet.list()[0]!;
    expect(Object.isFrozen(stored.inventory.packages)).toBe(true);
    expect(Object.isFrozen(stored.inventory.packages[0])).toBe(true);
    expect(() => { (stored.inventory.packages as Array<{ version: string }>)[0]!.version = "9.9.9"; }).toThrow();
  });

  it("finds every vulnerable deployment and creates customer-specific patch updates", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(supportManifest, trusted);
    fleet.ingest((await deployment("customer-alpha", "0.2.0", trusted)).evidence);
    fleet.ingest((await deployment("customer-beta", "0.1.0", trusted)).evidence);
    expect(fleet.affected("@k-nex/module-sales", "<1.0.1")).toHaveLength(2);
    expect(fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1", patchManifest)).toEqual([
      expect.objectContaining({ repository: "rootkeystudio/customer-alpha", targetIntegrity: `sha512-${"c".repeat(86)}==`, operations: ["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"] }),
      expect.objectContaining({ repository: "rootkeystudio/customer-beta", targetIntegrity: `sha512-${"c".repeat(86)}==`, operations: ["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"] })
    ]);
  });

  it("rejects a patch target absent from the trusted release manifest", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(supportManifest, trusted);
    fleet.ingest((await deployment("customer-beta", "0.1.0", trusted)).evidence);
    expect(() => fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "9.9.9", patchManifest)).toThrow("exact version");
  });

  it("requires restore/redeploy inventory to exactly reproduce expected observed state", async () => {
    const expected = (await deployment("customer-alpha", "0.2.0", authority())).inventory;
    expect(restoredInventoryMatches(expected, structuredClone(expected))).toBe(true);
    expect(restoredInventoryMatches(expected, observeRuntimeInventory({ ...expected, migrationRevision: 8 }))).toBe(false);
  });
});
