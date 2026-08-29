import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson, supportedFrameworkTuple, type PackageReleaseManifest } from "@k-nex/contracts";

import {
  FleetRegistry, createApplicationBundleAuthority, createDeploymentEvidenceAuthority, createDeploymentReceipt, createPackageReleaseManifestAuthority, observeRuntimeInventory,
  restoredInventoryMatches, signDeploymentReceipt, type DeploymentEvidenceAuthority, type VerifiedPackageReleaseManifest
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const sri = (character: string) => `sha512-${createHash("sha512").update(character).digest("base64")}`;
const sha = "a".repeat(40);
const releaseWorkflow = `repo/release@${sha}`;
const deploymentWorkflow = `repo/deploy@${sha}`;
const frameworkDigest = `sha256:${createHash("sha256").update(canonicalJson(supportedFrameworkTuple)).digest("hex")}`;
const deploymentKeys = generateKeyPairSync("ed25519");
const privatePem = (key: typeof releaseKeys.privateKey) => key.export({ format: "pem", type: "pkcs8" }).toString();
const publicPem = (key: typeof releaseKeys.publicKey) => key.export({ format: "pem", type: "spki" }).toString();
const issuedAttestations = new WeakMap<object, object>();
const releaseVerifier = { async verify(token: unknown) { const value = token !== null && typeof token === "object" ? issuedAttestations.get(token) : undefined; if (value === undefined) throw new Error("unverified hosted attestation"); return value as never; } };
const issueAttestation = (value: object) => { const token = Object.freeze({}); issuedAttestations.set(token, value); return token; };
const evidenceFile = (path: string, content: string) => ({ path, mode: 0o644, digest: `sha256:${createHash("sha256").update(content).digest("hex")}`, content: Buffer.from(content).toString("base64") });
const fullClosure = (release: "0.2.1" | "0.2.0" | "0.1.0", packages: readonly { readonly package: string; readonly version: string; readonly integrity: string }[]) => [...packages,
  ...(release === "0.2.1" ? [
    { package: "@floating-ui/react", version: "0.27.20", integrity: sri("floating-react") },
    { package: "@floating-ui/react-dom", version: "2.1.9", integrity: sri("floating-react-dom") },
    { package: "new-target-runtime", version: "1.0.0", integrity: sri("new") },
    { package: "semver", version: "7.8.6", integrity: sri("upgraded") }
  ] : [
    { package: "legacy-runtime", version: "1.0.0", integrity: sri("legacy") },
    { package: "semver", version: "7.7.3", integrity: sri("semver") }
  ])].sort((left, right) => `${left.package}@${left.version}`.localeCompare(`${right.package}@${right.version}`));
const bundleFiles = (applicationId: string, packages: ReturnType<typeof fullClosure>) => {
  const closure = canonicalJson(packages);
  const sbom = canonicalJson({ components: packages.map((entry) => ({ name: entry.package, version: entry.version, hashes: [{
    alg: entry.integrity.startsWith("sha512-") ? "SHA-512" : "SHA-256",
    content: entry.integrity.startsWith("sha512-") ? Buffer.from(entry.integrity.slice(7), "base64").toString("hex") : entry.integrity.slice(7)
  }] })) });
  return [evidenceFile("application/k-nex.app.json", canonicalJson({ applicationId })), evidenceFile("application/pnpm-lock.yaml", `lock:${applicationId}\n`),
    evidenceFile("evidence/pnpm-lock-runtime-closure.json", closure), evidenceFile("evidence/sbom.cdx.json", sbom)];
};
const releaseAuthority = createPackageReleaseManifestAuthority(releaseVerifier);
const applicationAuthority = createApplicationBundleAuthority(releaseVerifier, releaseAuthority);
const authority = () => createDeploymentEvidenceAuthority({ applicationBundleAuthority: applicationAuthority, packageReleaseAuthority: releaseAuthority, deploymentPublicKey: publicPem(deploymentKeys.publicKey), trustedDeploymentWorkflow: deploymentWorkflow });
const supportManifest = {
  schemaVersion: 1, release: { version: "0.2.0", channel: "pre-v1", versioningPolicy: "semver-pre-v1", compatibilityPolicy: "exact-framework-tuple" }, framework: supportedFrameworkTuple,
  packages: [
    { package: "@k-nex/module-sales", version: "1.0.0", role: "plugin", integrity: sri("sales-current"), peerCompatibility: supportedFrameworkTuple },
    { package: "@k-nex/runtime", version: "1.0.0", role: "core", integrity: sri("runtime-current"), peerCompatibility: supportedFrameworkTuple }
  ],
  supportWindow: { policy: "current-and-one-prior-minor", supportedReleases: ["0.2.0", "0.1.0"], securityFixes: "all-supported-releases" }
} as const satisfies PackageReleaseManifest;
const patchManifest = {
  ...supportManifest,
  release: { ...supportManifest.release, version: "0.2.1" },
  packages: [
    { ...supportManifest.packages[0], version: "1.0.1", integrity: sri("sales-target") },
    { package: "@k-nex/contracts", version: "1.0.1", role: "core", integrity: sri("contracts-target"), peerCompatibility: supportedFrameworkTuple }
  ],
  supportWindow: { ...supportManifest.supportWindow, supportedReleases: ["0.2.1", "0.1.0"] }
} as const satisfies PackageReleaseManifest;
const priorManifest = {
  ...supportManifest, release: { ...supportManifest.release, version: "0.1.0" },
  packages: [
    { ...supportManifest.packages[0], version: "0.9.0", integrity: sri("sales-prior") },
    { ...supportManifest.packages[1], version: "0.9.0", integrity: sri("runtime-prior") }
  ],
  supportWindow: { ...supportManifest.supportWindow, supportedReleases: ["0.1.0"] }
} as const satisfies PackageReleaseManifest;

async function verifiedManifest(manifest: PackageReleaseManifest): Promise<VerifiedPackageReleaseManifest> {
  const subjectDigest = `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`;
  return releaseAuthority.verify(manifest, issueAttestation({ subjectDigest, sourceCommit: sha, workflowIdentity: releaseWorkflow, materials: [] }));
}

async function deployment(applicationId: "customer-alpha" | "customer-beta", release: "0.2.1" | "0.2.0" | "0.1.0", trusted: DeploymentEvidenceAuthority, deploymentNumber = 1, deployedAt = "2026-08-27T12:05:00.000Z", revisionOverride?: number, observedPackages?: readonly { readonly package: string; readonly version: string; readonly integrity: string }[]) {
  const releaseManifest = release === "0.2.1" ? patchManifest : release === "0.2.0" ? supportManifest : priorManifest;
  const packageRelease = await verifiedManifest(releaseManifest);
  const packageReleaseDigest = releaseAuthority.read(packageRelease).digest;
  const installedPackages = fullClosure(release, releaseManifest.packages.map(({ package: packageName, version, integrity }) => ({ package: packageName, version, integrity })));
  const migrationRevision = revisionOverride ?? (release === "0.1.0" ? 6 : release === "0.2.1" ? 8 : 7);
  const files = bundleFiles(applicationId, installedPackages);
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  const bundle = {
    schemaVersion: 1 as const, format: "k-nex-deployable-application-bundle/v1" as const, applicationId, sourceCommit: sha, release,
    releaseManifestDigest: packageReleaseDigest, closureDigest: `sha256:${createHash("sha256").update(canonicalJson(installedPackages)).digest("hex")}`,
    frameworkDigest, migrationPlanDigest: digest("4"), targetMigrationRevision: migrationRevision, installedPackages, files
  };
  const attestation = {
    subjectDigest: `sha256:${createHash("sha256").update(canonicalJson(bundle)).digest("hex")}`, sourceCommit: sha, workflowIdentity: releaseWorkflow,
    materials: [{ name: "application-manifest", digest: byPath.get("application/k-nex.app.json")!.digest }, { name: "lockfile", digest: byPath.get("application/pnpm-lock.yaml")!.digest },
      { name: "lock-runtime-closure", digest: bundle.closureDigest }, { name: "resolved-graph-or-plan", digest: digest("4") },
      { name: "sbom", digest: byPath.get("evidence/sbom.cdx.json")!.digest }, { name: "package-release-manifest", digest: packageReleaseDigest },
      { name: "release-closure", digest: bundle.closureDigest }]
  };
  const inventory = observeRuntimeInventory({
    schemaVersion: 1, applicationId, repository: `rootkeystudio/${applicationId}`, environment: "production", platformRelease: release,
    observedAt: "2026-08-27T12:00:00.000Z", artifactDigest: attestation.subjectDigest, releaseEvidence: { sourceCommit: sha, workflowIdentity: releaseWorkflow,
      manifestDigest: byPath.get("application/k-nex.app.json")!.digest, lockfileDigest: byPath.get("application/pnpm-lock.yaml")!.digest,
      resolvedGraphDigest: digest("4"), frameworkDigest, sbomDigest: byPath.get("evidence/sbom.cdx.json")!.digest,
      provenanceDigest: `sha256:${createHash("sha256").update(canonicalJson(attestation)).digest("hex")}` },
    packages: observedPackages ?? installedPackages,
    plugins: [{ id: "module.sales", package: "@k-nex/module-sales", version: release === "0.1.0" ? "0.9.0" : release === "0.2.1" ? "1.0.1" : "1.0.0", enabled: true }], migrationRevision,
    settings: [{ id: "sales.settings", schemaVersion: 1, revision: 1 }], templates: [{ id: "sales.page.tasks", templateVersion: 1, revision: 1 }], health: { status: "ready", checks: ["sales"] }
  });
  const receipt = createDeploymentReceipt({ inventory, deploymentId: `deploy:${applicationId}:${deploymentNumber}`, deployedAt, approvedBy: { kind: "workflow", identity: deploymentWorkflow }, smoke: { status: "passed", checks: ["sales"] } });
  const applicationBundle = await applicationAuthority.verify(bundle, issueAttestation(attestation), packageRelease);
  const evidence = await trusted.verify({
    observe: async () => structuredClone(inventory), receipt: signDeploymentReceipt(receipt, privatePem(deploymentKeys.privateKey)),
    applicationBundle, packageRelease
  });
  return { evidence, inventory, applicationBundle };
}

describe("fleet evidence and patch propagation", () => {
  it("ingests only authority-verified deployments and preserves current/prior release state", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(await verifiedManifest(supportManifest), releaseAuthority, applicationAuthority, trusted);
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
    const fleet = new FleetRegistry(await verifiedManifest(supportManifest), releaseAuthority, applicationAuthority, trusted);
    fleet.ingest((await deployment("customer-alpha", "0.2.0", trusted)).evidence);
    const stored = fleet.list()[0]!;
    expect(Object.isFrozen(stored.inventory.packages)).toBe(true);
    expect(Object.isFrozen(stored.inventory.packages[0])).toBe(true);
    expect(() => { (stored.inventory.packages as Array<{ version: string }>)[0]!.version = "9.9.9"; }).toThrow();
  });

  it("orders RFC3339 deployment timestamps by instant across offsets", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(await verifiedManifest(supportManifest), releaseAuthority, applicationAuthority, trusted);
    fleet.ingest((await deployment("customer-alpha", "0.2.0", trusted, 1, "2026-08-27T12:00:00+02:00")).evidence);
    fleet.ingest((await deployment("customer-alpha", "0.2.0", trusted, 2, "2026-08-27T11:30:00Z")).evidence);
    expect(fleet.list()[0]?.receipt.deploymentId).toBe("deploy:customer-alpha:2");

    const regression = new FleetRegistry(await verifiedManifest(supportManifest), releaseAuthority, applicationAuthority, trusted);
    regression.ingest((await deployment("customer-beta", "0.1.0", trusted, 1, "2026-08-27T11:30:00Z")).evidence);
    const older = await deployment("customer-beta", "0.1.0", trusted, 2, "2026-08-27T12:00:00+02:00");
    expect(() => regression.ingest(older.evidence)).toThrow("cannot regress");
  });

  it("finds every vulnerable deployment and creates customer-specific patch updates", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(await verifiedManifest(supportManifest), releaseAuthority, applicationAuthority, trusted);
    fleet.ingest((await deployment("customer-alpha", "0.2.0", trusted)).evidence);
    fleet.ingest((await deployment("customer-beta", "0.1.0", trusted)).evidence);
    expect(fleet.affected("@k-nex/module-sales", "<1.0.1")).toHaveLength(2);
    const targets = [(await deployment("customer-alpha", "0.2.1", trusted)).applicationBundle, (await deployment("customer-beta", "0.2.1", trusted)).applicationBundle];
    expect(fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1", await verifiedManifest(patchManifest), targets)).toEqual([
      expect.objectContaining({ repository: "rootkeystudio/customer-alpha", targetIntegrity: sri("sales-target"), operations: ["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"] }),
      expect.objectContaining({ repository: "rootkeystudio/customer-beta", targetIntegrity: sri("sales-target"), operations: ["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"] })
    ]);
  });

  it("applies only an issued full-closure transition with a fresh verified observation", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(await verifiedManifest(supportManifest), releaseAuthority, applicationAuthority, trusted);
    fleet.ingest((await deployment("customer-alpha", "0.2.0", trusted)).evidence);
    const patched = await deployment("customer-alpha", "0.2.1", trusted, 2, "2026-08-27T13:05:00.000Z");
    const [plan] = fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1", await verifiedManifest(patchManifest), [patched.applicationBundle]);
    expect(plan?.targetClosure).toEqual(patchManifest.packages.map(({ package: packageName, version, integrity }) => ({ package: packageName, version, integrity })).sort((left, right) => left.package.localeCompare(right.package)));
    expect(plan?.targetDeploymentClosure.map(({ package: packageName }) => packageName)).toEqual(["@floating-ui/react-dom", "@floating-ui/react", "@k-nex/contracts", "@k-nex/module-sales", "new-target-runtime", "semver"]);
    expect(plan?.targetDeploymentClosure.some(({ package: packageName }) => packageName === "legacy-runtime")).toBe(false);
    expect(fleet.applySecurityPatch(plan!, patched.evidence).inventory.platformRelease).toBe("0.2.1");
    expect(fleet.affected("@k-nex/module-sales", "<1.0.1")).toHaveLength(0);
    expect(() => fleet.applySecurityPatch({ ...plan! }, patched.evidence)).toThrow("not issued");
  });

  it("rejects an unrelated migration revision instead of accepting any increase", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(await verifiedManifest(supportManifest), releaseAuthority, applicationAuthority, trusted);
    fleet.ingest((await deployment("customer-alpha", "0.2.0", trusted)).evidence);
    const target = await deployment("customer-alpha", "0.2.1", trusted, 2, "2026-08-27T13:05:00.000Z");
    const unrelated = await deployment("customer-alpha", "0.2.1", trusted, 3, "2026-08-27T13:06:00.000Z", 9);
    const [plan] = fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1", await verifiedManifest(patchManifest), [target.applicationBundle]);
    expect(() => fleet.applySecurityPatch(plan!, unrelated.evidence)).toThrow("complete verified target release transition");
  });

  it("rejects target observations that omit or preserve the wrong external lock dependency", async () => {
    const trusted = authority();
    const target = fullClosure("0.2.1", patchManifest.packages.map(({ package: packageName, version, integrity }) => ({ package: packageName, version, integrity })));
    await expect(deployment("customer-alpha", "0.2.1", trusted, 2, "2026-08-27T13:05:00.000Z", 8, target.filter(({ package: packageName }) => packageName !== "new-target-runtime"))).rejects.toThrow("does not reconcile");
    await expect(deployment("customer-alpha", "0.2.1", trusted, 2, "2026-08-27T13:05:00.000Z", 8, [...target, { package: "legacy-runtime", version: "1.0.0", integrity: sri("legacy") }])).rejects.toThrow("does not reconcile");
  });

  it("rejects a patch target absent from the trusted release manifest", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(await verifiedManifest(supportManifest), releaseAuthority, applicationAuthority, trusted);
    fleet.ingest((await deployment("customer-beta", "0.1.0", trusted)).evidence);
    const patchRelease = await verifiedManifest(patchManifest);
    expect(() => fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "9.9.9", patchRelease, [])).toThrow("absent from the trusted release manifest");
  });

  it("rejects a trusted patch target that remains vulnerable", async () => {
    const trusted = authority();
    const fleet = new FleetRegistry(await verifiedManifest(supportManifest), releaseAuthority, applicationAuthority, trusted);
    fleet.ingest((await deployment("customer-beta", "0.1.0", trusted)).evidence);
    const vulnerableRelease = await verifiedManifest(supportManifest);
    expect(() => fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.0", vulnerableRelease, [])).toThrow("remains within the vulnerable range");
  });

  it("requires restore/redeploy inventory to exactly reproduce expected observed state", async () => {
    const expected = (await deployment("customer-alpha", "0.2.0", authority())).inventory;
    expect(restoredInventoryMatches(expected, structuredClone(expected))).toBe(true);
    expect(restoredInventoryMatches(expected, observeRuntimeInventory({ ...expected, migrationRevision: 8 }))).toBe(false);
  });
});
