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
const check = args.includes("--check");
if (sourcePath === undefined || targetPath === undefined || policyPath === undefined || outputPath === undefined) {
  throw new TypeError("Usage: publish-platform-release-transition --source <package-release-manifest> --target <package-release-manifest> --policy <policy.json> --output <transition.json> [--check] [--repository <owner/repo>] [--workflow <workflow.yml>]");
}

const absolute = (path) => resolve(path);
const sourceContent = readFileSync(absolute(sourcePath), "utf8");
const targetContent = readFileSync(absolute(targetPath), "utf8");
const policyContent = readFileSync(absolute(policyPath), "utf8");
const policy = JSON.parse(policyContent);
if (policyContent !== canonicalJson(policy)) throw new TypeError("Transition publication policy must use canonical JSON bytes.");

async function hostedRelease(path, content) {
  const parsed = parseCanonicalPackageReleaseManifest(content, path);
  const output = execFileSync("gh", ["attestation", "verify", absolute(path), "--repo", repository, "--predicate-type", "https://k-nex.dev/release-manifest/v1", "--format", "json"], { encoding: "utf8" });
  const entries = JSON.parse(output);
  if (!Array.isArray(entries) || entries.length === 0) throw new Error(`${path} has no trusted hosted release attestation.`);
  const verifier = createGitHubHostedAttestationVerifier({ repository, workflow, predicateType: "https://k-nex.dev/release-manifest/v1" });
  const authority = createPackageReleaseManifestAuthority(verifier);
  for (const entry of entries) {
    try {
      const token = await authority.verify(parsed.manifest, entry);
      return authority.read(token);
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
  const hostedOutput = execFileSync("gh", ["attestation", "verify", output, "--repo", repository, "--predicate-type", "https://k-nex.dev/platform-release-transition/v1", "--format", "json"], { encoding: "utf8" });
  const entries = JSON.parse(hostedOutput);
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Transition artifact has no trusted hosted attestation.");
  const verifier = createGitHubHostedAttestationVerifier({ repository, workflow, predicateType: "https://k-nex.dev/platform-release-transition/v1" });
  let trusted = false;
  for (const entry of entries) {
    try {
      const attestation = await verifier.verify(entry);
      if (attestation.subjectDigest === verified.digest) { trusted = true; break; }
    } catch { /* try every cryptographically verified statement */ }
  }
  if (!trusted) throw new Error("Transition hosted identity or subject digest is not trusted.");
  process.stdout.write(`PLATFORM_RELEASE_TRANSITION_VERIFIED ${verified.manifest.source.release}->${verified.manifest.target.release} ${verified.digest}\n`);
}
