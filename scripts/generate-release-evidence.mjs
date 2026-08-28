import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import { createCycloneDxSbom, createReleaseProvenance, resolvePnpmLock } from "../packages/composition/dist/index.js";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const sourceCommit = value("--source-sha");
const workflowIdentity = value("--workflow-identity");
const output = resolve(value("--output"));
const customer = value("--customer");
const applicationRoot = resolve(value("--application-root") ?? resolve("fixtures", customer));
const releaseVersion = value("--release");
const migrationRevision = value("--migration-revision");
if (!/^[0-9a-f]{40}$/u.test(sourceCommit ?? "") || !workflowIdentity || !output || !customer ||
  ((releaseVersion === undefined) !== (migrationRevision === undefined)) || (migrationRevision !== undefined && !/^\d+$/u.test(migrationRevision))) {
  throw new Error("Release evidence arguments are required.");
}
const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const files = [];
const addFile = (path, bundlePath) => {
  const content = readFileSync(path);
  files.push({ path: bundlePath, mode: 0o644, digest: sha256(content), content: content.toString("base64") });
};
const addTree = (directory, prefix) => {
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name);
    const bundlePath = `${prefix}/${name}`;
    if (statSync(path).isDirectory()) addTree(path, bundlePath);
    else addFile(path, bundlePath);
  }
};

for (const name of [".env.example", ".npmrc", "k-nex.app.json", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json"]) addFile(resolve(applicationRoot, name), `application/${name}`);
for (const directory of [".k-nex", "src", "dist"]) addTree(resolve(applicationRoot, directory), `application/${directory}`);
const observation = releaseVersion === undefined ? JSON.parse(readFileSync(resolve(applicationRoot, "deployment-observation.json"), "utf8")) :
  { platformRelease: releaseVersion, migrationRevision: Number(migrationRevision) };
const releaseManifest = JSON.parse(readFileSync(resolve(`releases/${observation.platformRelease}/package-release-manifest.json`), "utf8"));
for (const entry of releaseManifest.packages) {
  const name = `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`;
  const path = resolve("fixtures/customer-gate-1/packages", name);
  const bytes = readFileSync(path);
  if (`sha512-${createHash("sha512").update(bytes).digest("base64")}` !== entry.integrity) throw new Error(`Release closure integrity mismatch for ${entry.package}.`);
  addFile(path, `packages/${name}`);
}
const lockContent = readFileSync(resolve(applicationRoot, "pnpm-lock.yaml"), "utf8");
const resolvedLock = resolvePnpmLock(lockContent);
const installedPackages = resolvedLock.components.map(({ name, version, integrity }) => ({ package: name, version, integrity }))
  .sort((left, right) => `${left.package}@${left.version}`.localeCompare(`${right.package}@${right.version}`));
const applicationPlanContent = canonicalJson(JSON.parse(readFileSync(resolve(applicationRoot, ".k-nex/application-plan.json"), "utf8")));
const baseSbom = createCycloneDxSbom(customer, resolvedLock.components, resolvedLock.dependencies, resolvedLock.rootDependencies);
const serialSuffix = createHash("sha256").update(`${customer}\u0000${sourceCommit}`).digest("hex").slice(0, 12);
const sbom = { ...baseSbom, serialNumber: `urn:uuid:00000000-0000-4000-8000-${serialSuffix}` };
const sbomContent = canonicalJson(sbom);
const closureContent = canonicalJson(installedPackages);
for (const [path, content] of [["evidence/sbom.cdx.json", sbomContent], ["evidence/pnpm-lock-runtime-closure.json", closureContent]]) {
  files.push({ path, mode: 0o644, digest: sha256(content), content: Buffer.from(content).toString("base64") });
}
files.sort((left, right) => left.path.localeCompare(right.path));
const bundle = {
  schemaVersion: 1, format: "k-nex-deployable-application-bundle/v1", applicationId: customer, sourceCommit,
  release: observation.platformRelease, releaseManifestDigest: sha256(canonicalJson(releaseManifest)),
  closureDigest: sha256(closureContent), frameworkDigest: sha256(canonicalJson(releaseManifest.framework)),
  migrationPlanDigest: sha256(applicationPlanContent), targetMigrationRevision: observation.migrationRevision,
  installedPackages, files
};
const bundleContent = canonicalJson(bundle);
const bundlePath = resolve(output, `${customer}.application-bundle.json`);
const applicationFiles = files.filter(({ path }) => path.startsWith("application/"));
const buildFiles = files.filter(({ path }) => path.startsWith("application/dist/"));
const provenance = createReleaseProvenance({
  subjectName: basename(bundlePath), artifactDigest: sha256(bundleContent), sourceCommit, workflowIdentity,
  materials: [
    { name: "application-manifest", digest: sha256(readFileSync(resolve(applicationRoot, "k-nex.app.json"))) },
    { name: "lockfile", digest: sha256(lockContent) },
    { name: "lock-runtime-closure", digest: bundle.closureDigest },
    { name: "resolved-graph-or-plan", digest: sha256(applicationPlanContent) },
    { name: "sbom", digest: sha256(sbomContent) },
    { name: "package-release-manifest", digest: bundle.releaseManifestDigest },
    { name: "release-closure", digest: bundle.closureDigest },
    { name: "generated-application-tree", digest: sha256(canonicalJson(applicationFiles)) },
    { name: "application-build-output", digest: sha256(canonicalJson(buildFiles)) }
  ]
});
mkdirSync(output, { recursive: true });
writeFileSync(bundlePath, bundleContent, "utf8");
writeFileSync(resolve(output, "sbom.cdx.json"), sbomContent, "utf8");
writeFileSync(resolve(output, "provenance.json"), canonicalJson(provenance), "utf8");
writeFileSync(resolve(output, "provenance-predicate.json"), canonicalJson(provenance.predicate), "utf8");
writeFileSync(resolve(output, "release-manifest.json"), canonicalJson(releaseManifest), "utf8");
writeFileSync(resolve(output, "release-manifest-predicate.json"), canonicalJson({
  schemaVersion: 1, sourceCommit, workflowIdentity,
  release: releaseManifest.release.version, closureDigest: bundle.closureDigest
}), "utf8");
process.stdout.write(canonicalJson({ bundle: relative(process.cwd(), bundlePath), artifactDigest: provenance.subject.digest, releaseManifestDigest: bundle.releaseManifestDigest, closureDigest: bundle.closureDigest }));
