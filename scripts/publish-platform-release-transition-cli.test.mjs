import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import { buildPlatformReleaseTransition, parseCanonicalPackageReleaseManifest } from "./lib/platform-release-transition.mjs";

const root = resolve(import.meta.dirname, "..");
const script = resolve(root, "scripts/publish-platform-release-transition.mjs");
const policyGenerator = resolve(root, "scripts/generate-phase-13-transition-policy.mjs");
const sourcePath = resolve(root, "releases/1.0.0/package-release-manifest.json");
const targetPath = resolve(root, "releases/1.1.0/package-release-manifest.json");
const repository = "rootkeystudio/k-nex-platform-core";
const workflow = "release-evidence.yml";
const historicalCommit = "c8fe7f2518c219957297155e307768837186ec5f";
const expectedCommit = "a".repeat(40);
const wrongCommit = "b".repeat(40);

function attestation(subjectDigest, sourceCommit, predicateType, subjectName) {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: subjectName, digest: { sha256: subjectDigest.slice("sha256:".length) } }],
    predicateType,
    predicate: {
      sourceCommit,
      workflowIdentity: `${repository}/.github/workflows/${workflow}@${sourceCommit}`,
      materials: []
    }
  };
  const certificate = {
    sourceRepositoryDigest: sourceCommit,
    githubWorkflowRepository: repository,
    runnerEnvironment: "github-hosted",
    buildConfigURI: `https://github.com/${repository}/.github/workflows/${workflow}@refs/heads/main`,
    githubWorkflowRef: "refs/heads/main",
    githubWorkflowSHA: sourceCommit,
    buildConfigDigest: sourceCommit
  };
  return {
    attestation: { bundle: { dsseEnvelope: { payload: Buffer.from(canonicalJson(statement)).toString("base64") } } },
    verificationResult: { signature: { certificate }, statement }
  };
}

function runCli(args, env) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", env });
}

test("transition --check requires an exact 40-hex commit online and with a bundle", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "k-nex-transition-cli-test-"));
  try {
    const policyPath = resolve(directory, "policy.json");
    const sourceTrustPath = resolve(directory, "source-trust.json");
    const transitionPath = resolve(directory, "platform-release-transition.json");
    const policyResult = spawnSync(process.execPath, [policyGenerator, "--output", policyPath, "--source-trust-output", sourceTrustPath], { cwd: root, encoding: "utf8", env: process.env });
    assert.equal(policyResult.status, 0, policyResult.stderr);
    const source = parseCanonicalPackageReleaseManifest(readFileSync(sourcePath, "utf8"), sourcePath);
    const target = parseCanonicalPackageReleaseManifest(readFileSync(targetPath, "utf8"), targetPath);
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    writeFileSync(transitionPath, canonicalJson(buildPlatformReleaseTransition({ source, target, policy })), "utf8");

    const baseArgs = ["--check", "--source", sourcePath, "--target", targetPath, "--policy", policyPath, "--output", transitionPath, "--source-trust", sourceTrustPath, "--target-attestation-source-commit", expectedCommit];
    const missingOnline = runCli(baseArgs, process.env);
    assert.notEqual(missingOnline.status, 0);
    assert.match(missingOnline.stderr, /--check requires a valid 40-hex --transition-attestation-source-commit/u);

    const sourceBundle = resolve(directory, "source.jsonl");
    const targetBundle = resolve(directory, "target.jsonl");
    const transitionBundle = resolve(directory, "transition.jsonl");
    for (const path of [sourceBundle, targetBundle, transitionBundle]) writeFileSync(path, "", "utf8");
    const missingBundled = runCli([...baseArgs, "--source-attestation-bundle", sourceBundle, "--target-attestation-bundle", targetBundle, "--transition-attestation-bundle", transitionBundle], process.env);
    assert.notEqual(missingBundled.status, 0);
    assert.match(missingBundled.stderr, /--check requires a valid 40-hex --transition-attestation-source-commit/u);

    const malformed = runCli([...baseArgs, "--transition-attestation-source-commit", "not-a-sha"], process.env);
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /--check requires a valid 40-hex --transition-attestation-source-commit/u);

    const sourceDigest = source.digest;
    const targetDigest = target.digest;
    const transition = JSON.parse(readFileSync(transitionPath, "utf8"));
    const actualTransitionDigest = `sha256:${createHash("sha256").update(canonicalJson(transition)).digest("hex")}`;
    const fakeGh = resolve(directory, "gh");
    const entries = {
      source: [attestation(sourceDigest, historicalCommit, "https://k-nex.dev/release-manifest/v1", "package-release-manifest.json")],
      target: [attestation(targetDigest, expectedCommit, "https://k-nex.dev/release-manifest/v1", "package-release-manifest.json")],
      transition: [attestation(actualTransitionDigest, wrongCommit, "https://k-nex.dev/platform-release-transition/v1", "platform-release-transition.json")]
    };
    writeFileSync(fakeGh, [
      "#!/usr/bin/env node",
      `const entries = ${JSON.stringify(entries)};`,
      "const args = process.argv.slice(2);",
      "const subject = args[args.indexOf(\"verify\") + 1] ?? \"\";",
      "const key = subject.includes(\"/1.0.0/\") ? \"source\" : subject.includes(\"/1.1.0/\") ? \"target\" : \"transition\";",
      "process.stdout.write(JSON.stringify(entries[key]));",
      ""
    ].join("\n"), "utf8");
    chmodSync(fakeGh, 0o755);
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` };
    const wrongOnline = runCli([...baseArgs, "--transition-attestation-source-commit", expectedCommit], env);
    assert.notEqual(wrongOnline.status, 0);
    assert.match(wrongOnline.stderr, /Transition hosted identity or subject digest is not trusted/u);
    const wrongBundled = runCli([...baseArgs, "--transition-attestation-source-commit", expectedCommit, "--source-attestation-bundle", sourceBundle, "--target-attestation-bundle", targetBundle, "--transition-attestation-bundle", transitionBundle], env);
    assert.notEqual(wrongBundled.status, 0);
    assert.match(wrongBundled.stderr, /Transition hosted identity or subject digest is not trusted/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
