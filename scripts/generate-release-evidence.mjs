import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import { createCycloneDxSbom, createReleaseProvenance, resolvePnpmLock } from "../packages/composition/dist/index.js";

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const sourceCommit = value("--source-sha");
const workflowIdentity = value("--workflow-identity");
const output = resolve(value("--output"));
const artifactPath = resolve(value("--artifact"));
const customer = value("--customer");
if (!sourceCommit || !workflowIdentity || !output || !artifactPath || !customer) throw new Error("Release evidence arguments are required.");
const fixtureRoot = resolve("fixtures", customer);
const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const lockContent = readFileSync(resolve(fixtureRoot, "pnpm-lock.yaml"));
const resolvedLock = resolvePnpmLock(lockContent.toString("utf8"));
const artifactContent = readFileSync(artifactPath);
const subjectRef = "pkg:npm/%40k-nex/module-sales@1.0.0";
const sbom = createCycloneDxSbom(customer, resolvedLock.components, resolvedLock.dependencies, [...resolvedLock.rootDependencies, subjectRef]);
const sbomContent = `${canonicalJson(sbom)}\n`;
const manifestContent = readFileSync(resolve(fixtureRoot, "k-nex.app.json"));
const graphPath = resolve(fixtureRoot, ".k-nex/generated/k-nex.resolved.json");
let graphContent;
try { graphContent = readFileSync(graphPath); } catch { graphContent = Buffer.from(canonicalJson(JSON.parse(readFileSync(resolve(fixtureRoot, ".k-nex/application-plan.json"), "utf8")))); }
const provenance = createReleaseProvenance({
  subjectName: basename(artifactPath), artifactDigest: sha256(artifactContent), sourceCommit, workflowIdentity,
  materials: [
    { name: "application-manifest", digest: sha256(manifestContent) },
    { name: "lockfile", digest: sha256(lockContent) },
    { name: "resolved-graph-or-plan", digest: sha256(graphContent) },
    { name: "sbom", digest: sha256(sbomContent) }
  ]
});
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "sbom.cdx.json"), sbomContent, "utf8");
writeFileSync(resolve(output, "provenance.json"), `${canonicalJson(provenance)}\n`, "utf8");
writeFileSync(resolve(output, "provenance-predicate.json"), `${canonicalJson(provenance.predicate)}\n`, "utf8");
process.stdout.write(`${canonicalJson({ artifactDigest: provenance.subject.digest, sbomDigest: sha256(sbomContent) })}\n`);
