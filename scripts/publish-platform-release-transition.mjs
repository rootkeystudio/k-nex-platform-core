#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import { createGitHubHostedAttestationVerifier, createPackageReleaseManifestAuthority } from "../packages/runtime/dist/index.js";
import { buildPlatformReleaseTransition, parseCanonicalPackageReleaseManifest, verifyPlatformReleaseTransitionArtifact } from "./lib/platform-release-transition.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
};
const sourcePath = option("--source");
const targetPath = option("--target");
const policyPath = option("--policy");
const outputPath = option("--output");
const repository = option("--repository") ?? "rootkeystudio/k-nex-platform-core";
const workflow = option("--workflow") ?? "release-evidence.yml";
const sourceAttestationBundle = option("--source-attestation-bundle");
const targetAttestationBundle = option("--target-attestation-bundle");
const transitionAttestationBundle = option("--transition-attestation-bundle");
const sourceTrustPath = option("--source-trust");
const targetAttestationSourceCommit = option("--target-attestation-source-commit");
const transitionAttestationSourceCommit = option("--transition-attestation-source-commit");
const check = args.includes("--check");
if (sourcePath === undefined || targetPath === undefined || policyPath === undefined || outputPath === undefined) {
  throw new TypeError("Usage: publish-platform-release-transition --source <package-release-manifest> --target <package-release-manifest> --policy <policy.json> --output <transition.json> [--check] [--repository <owner/repo>] [--workflow <workflow.yml>] [--source-attestation-bundle <bundle.jsonl>] [--target-attestation-bundle <bundle.jsonl>] [--transition-attestation-bundle <bundle.jsonl>] [--source-trust <trust.json>] [--target-attestation-source-commit <sha>] [--transition-attestation-source-commit <sha>]");
}
if (check && (transitionAttestationSourceCommit === undefined || !/^[0-9a-f]{40}$/u.test(transitionAttestationSourceCommit))) {
  throw new TypeError("--check requires a valid 40-hex --transition-attestation-source-commit.");
}
const releaseBundles = [sourceAttestationBundle, targetAttestationBundle];
if (releaseBundles.some((bundle) => bundle !== undefined) && releaseBundles.some((bundle) => bundle === undefined)) {
  throw new TypeError("Source and target attestation bundles must be supplied together.");
}
if (transitionAttestationBundle !== undefined && transitionAttestationSourceCommit === undefined) {
  throw new TypeError("Transition attestation source commit must be supplied with a transition attestation bundle.");
}

const absolute = (path) => resolve(path);
const sourceContent = readFileSync(absolute(sourcePath), "utf8");
const targetContent = readFileSync(absolute(targetPath), "utf8");
const policyContent = readFileSync(absolute(policyPath), "utf8");
const policy = JSON.parse(policyContent);
if (policyContent !== canonicalJson(policy)) throw new TypeError("Transition publication policy must use canonical JSON bytes.");
const sourceTrustContent = sourceTrustPath === undefined ? undefined : readFileSync(absolute(sourceTrustPath), "utf8");
const sourceTrust = sourceTrustContent === undefined ? undefined : JSON.parse(sourceTrustContent);
const acceptedHistoricalSource = Object.freeze({
  release: "1.0.0",
  manifestDigest: "sha256:1d8b40e0073fb24d42f47bc3a0fd763db0a0fb5baf706120f7fe3a2768c13eea",
  sourceCommit: "c8fe7f2518c219957297155e307768837186ec5f",
  workflowIdentity: "rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@c8fe7f2518c219957297155e307768837186ec5f"
});
if (sourceTrust !== undefined) {
  if (sourceTrustContent !== canonicalJson(sourceTrust) || canonicalJson(Object.keys(sourceTrust).sort()) !== canonicalJson(["equivalentStatementCount", "manifestDigest", "predicateType", "release", "schemaVersion", "sourceCommit", "verificationPath", "workflowIdentity"].sort())) {
    throw new TypeError("Source release trust metadata must use its exact canonical shape.");
  }
  if (sourceTrust.schemaVersion !== 1 || sourceTrust.release !== acceptedHistoricalSource.release || sourceTrust.manifestDigest !== acceptedHistoricalSource.manifestDigest || sourceTrust.sourceCommit !== acceptedHistoricalSource.sourceCommit ||
    sourceTrust.workflowIdentity !== acceptedHistoricalSource.workflowIdentity || sourceTrust.predicateType !== "https://k-nex.dev/release-manifest/v1" || sourceTrust.verificationPath !== "release-evidence/phase-8-v1/hosted/package-manifest-verification.json" ||
    !Number.isSafeInteger(sourceTrust.equivalentStatementCount) || sourceTrust.equivalentStatementCount < 1) {
    throw new TypeError("Source release trust metadata is not the accepted Phase 8 identity.");
  }
}

async function hostedRelease(path, content) {
  const parsed = parseCanonicalPackageReleaseManifest(content, path);
  const bundle = path === sourcePath ? sourceAttestationBundle : targetAttestationBundle;
  const verifyArgs = ["attestation", "verify", absolute(path)];
  if (bundle !== undefined) verifyArgs.push("--bundle", absolute(bundle));
  verifyArgs.push("--repo", repository, "--predicate-type", "https://k-nex.dev/release-manifest/v1", "--format", "json");
  const output = execFileSync("gh", verifyArgs, { encoding: "utf8" });
  const entries = JSON.parse(output);
  if (!Array.isArray(entries) || entries.length === 0) throw new Error(`${path} has no trusted hosted release attestation.`);
  const verifier = createGitHubHostedAttestationVerifier({ repository, workflow, predicateType: "https://k-nex.dev/release-manifest/v1" });
  const authority = createPackageReleaseManifestAuthority(verifier);
  for (const entry of entries) {
    try {
      const token = await authority.verify(parsed.manifest, entry);
      const verified = authority.read(token);
      if (path === sourcePath && parsed.manifest.release.version === acceptedHistoricalSource.release) {
        if (sourceTrust === undefined || sourceTrust.manifestDigest !== acceptedHistoricalSource.manifestDigest || sourceTrust.sourceCommit !== acceptedHistoricalSource.sourceCommit || sourceTrust.workflowIdentity !== acceptedHistoricalSource.workflowIdentity ||
          verified.digest !== acceptedHistoricalSource.manifestDigest || verified.attestation.sourceCommit !== acceptedHistoricalSource.sourceCommit || verified.attestation.workflowIdentity !== acceptedHistoricalSource.workflowIdentity) continue;
      }
      if (path === targetPath && parsed.manifest.release.version === "1.1.0" && verified.attestation.sourceCommit !== targetAttestationSourceCommit) continue;
      return verified;
    } catch { /* try every cryptographically verified statement */ }
  }
  throw new Error(`${path} hosted release identity is not trusted.`);
}

const source = await hostedRelease(sourcePath, sourceContent);
const target = await hostedRelease(targetPath, targetContent);
const input = { source, target, policy };
const output = absolute(outputPath);
if (!check) {
  const manifest = buildPlatformReleaseTransition(input);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, canonicalJson(manifest), "utf8");
  process.stdout.write(`PLATFORM_RELEASE_TRANSITION_GENERATED ${manifest.source.release}->${manifest.target.release}\n`);
} else {
  const content = readFileSync(output, "utf8");
  const verified = verifyPlatformReleaseTransitionArtifact(content, input);
  const verifyArgs = ["attestation", "verify", output];
  if (transitionAttestationBundle !== undefined) verifyArgs.push("--bundle", absolute(transitionAttestationBundle));
  verifyArgs.push("--repo", repository, "--predicate-type", "https://k-nex.dev/platform-release-transition/v1", "--format", "json");
  const hostedOutput = execFileSync("gh", verifyArgs, { encoding: "utf8" });
  const entries = JSON.parse(hostedOutput);
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Transition artifact has no trusted hosted attestation.");
  const verifier = createGitHubHostedAttestationVerifier({ repository, workflow, predicateType: "https://k-nex.dev/platform-release-transition/v1" });
  let trusted = false;
  for (const entry of entries) {
    try {
      const attestation = await verifier.verify(entry);
      if (attestation.subjectDigest === verified.digest && attestation.sourceCommit === transitionAttestationSourceCommit) { trusted = true; break; }
    } catch { /* try every cryptographically verified statement */ }
  }
  if (!trusted) throw new Error("Transition hosted identity or subject digest is not trusted.");
  process.stdout.write(`PLATFORM_RELEASE_TRANSITION_VERIFIED ${verified.manifest.source.release}->${verified.manifest.target.release} ${verified.digest}\n`);
}
