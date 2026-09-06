import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { createFixtureDeploymentVerifier } from "../../../scripts/lib/fixture-deployment-authority.mjs";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const root = resolve(import.meta.dirname, "../../..");
const patchPath = resolve(root, "patches/@payloadcms__db-postgres@3.88.0.patch");

function environment(applicationId, connectionString) {
  return { ...process.env, DATABASE_URL: connectionString, K_NEX_ENVIRONMENT: "production", K_NEX_PUBLIC_ORIGIN: `https://${applicationId}.example.test`, PAYLOAD_SECRET: "p13-3-packed-shutdown" };
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolveClose, reject) => server.close((error) => error === undefined ? resolveClose() : reject(error)));
  return address.port;
}

function packedChild(directory, applicationId, connectionString, port) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(process.execPath, [resolve(import.meta.dirname, "p13-3-generated-packed-shutdown-child.mjs"), directory, applicationId, String(port)], { cwd: directory, env: environment(applicationId, connectionString), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (value) => { output += value; });
    child.stderr.setEncoding("utf8").on("data", (value) => { output += value; });
    child.once("error", reject);
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 210_000);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (expired) { reject(new Error(`Packed shutdown child exceeded its bounded deadline.\n${output}`)); return; }
      resolveProcess({ code, output });
    });
  });
}

test("P13.3 packed composition emits its embedded Payload patch and shuts down a generated Postgres app", { timeout: 330_000 }, async () => {
  const container = await new PostgreSqlContainer(image).withDatabase("p13_3_packed").withStartupTimeout(120_000).start();
  const administrator = new pg.Pool({ connectionString: container.getConnectionUri() });
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "p13-3-packed-")));
  try {
    const mirror = resolve(directory, "mirror");
    mkdirSync(mirror);
    const baseManifest = JSON.parse(readFileSync(resolve(root, "releases/1.0.0/package-release-manifest.json"), "utf8"));
    for (const entry of baseManifest.packages) copyFileSync(resolve(root, "fixtures/customer-gate-1/packages", `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`), resolve(mirror, `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`));
    for (const lock of Object.values(baseManifest.factoryLockTemplates)) copyFileSync(resolve(root, "fixtures/customer-gate-1/packages", `factory-lock-sales-reference-${lock.theme}-${lock.digest.slice(7)}.yaml`), resolve(mirror, `factory-lock-sales-reference-${lock.theme}-${lock.digest.slice(7)}.yaml`));
    const manifest = structuredClone(baseManifest);
    manifest.release.version = "1.0.0-p13.3.fixture";
    manifest.supportWindow.supportedReleases = [manifest.release.version];
    for (const [name, source] of [["@k-nex/composition", "packages/composition"], ["@k-nex/runtime", "packages/runtime"], ["@k-nex/payload-adapter", "packages/payload-adapter"], ["@k-nex/module-sales", "modules/sales"], ["@k-nex/provider-realtime-socketio", "packages/realtime-socketio"]]) {
      execFileSync("pnpm", ["build"], { cwd: resolve(root, source), stdio: "pipe", encoding: "utf8" });
      execFileSync("pnpm", ["pack", "--pack-destination", mirror], { cwd: resolve(root, source), stdio: "pipe", encoding: "utf8" });
      const entry = manifest.packages.find((candidate) => candidate.package === name);
      assert.ok(entry);
      entry.integrity = `sha512-${createHash("sha512").update(readFileSync(resolve(mirror, `${name.slice(1).replace("/", "-")}-1.0.0.tgz`))).digest("base64")}`;
    }
    const consumer = resolve(directory, "consumer");
    mkdirSync(consumer);
    writeFileSync(resolve(consumer, "package.json"), JSON.stringify({ name: "p13-3-packed-factory-consumer", private: true, type: "module", dependencies: { "@k-nex/composition": `file:${resolve(mirror, "k-nex-composition-1.0.0.tgz")}`, "@k-nex/contracts": `file:${resolve(mirror, "k-nex-contracts-1.0.0.tgz")}` } }));
    writeFileSync(resolve(consumer, "pnpm-workspace.yaml"), `packages:\n  - "."\n\noverrides:\n  "@k-nex/contracts": "file:${resolve(mirror, "k-nex-contracts-1.0.0.tgz")}"\n`);
    execFileSync("pnpm", ["install", "--ignore-scripts"], { cwd: consumer, stdio: "pipe", encoding: "utf8" });
    const factory = await import(pathToFileURL(resolve(consumer, "node_modules/@k-nex/composition/dist/index.js")));
    const canonicalPatch = readFileSync(patchPath, "utf8");
    assert.equal(factory.payloadPostgresPatchSource(), canonicalPatch);
    const verifier = createFixtureDeploymentVerifier("a".repeat(40));
    const provisional = await verifier.verifyManifest(manifest);
    for (const theme of ["minimal", "neobrutalism"]) {
      const lockApp = resolve(directory, `lock-app-${theme}`);
      factory.applyCreateKnexApplication(factory.planCreateKnexApplication({ applicationId: `p13-packed-lock-${theme}`, applicationName: `P13 packed lock ${theme}`, theme, database: "external", packageSource: { kind: "packed-mirror", directory: mirror, authority: verifier.packageReleaseAuthority, release: provisional } }), lockApp);
      assert.equal(readFileSync(resolve(lockApp, factory.payloadPostgresPatchFilename), "utf8"), canonicalPatch);
      execFileSync("pnpm", ["install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts"], { cwd: lockApp, stdio: "pipe", encoding: "utf8" });
      const lock = readFileSync(resolve(lockApp, "pnpm-lock.yaml"));
      const lockDigest = `sha256:${createHash("sha256").update(lock).digest("hex")}`;
      writeFileSync(resolve(mirror, `factory-lock-sales-reference-${theme}-${lockDigest.slice(7)}.yaml`), lock);
      manifest.factoryLockTemplates[theme].digest = lockDigest;
    }
    const release = await verifier.verifyManifest(manifest);
    const app = resolve(directory, "application");
    const plan = factory.planCreateKnexApplication({ applicationId: "p13-packed", applicationName: "P13 packed", theme: "minimal", database: "external", packageSource: { kind: "packed-mirror", directory: mirror, authority: verifier.packageReleaseAuthority, release } });
    assert.equal(plan.files[factory.payloadPostgresPatchFilename], canonicalPatch);
    factory.applyCreateKnexApplication(plan, app);
    execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: app, stdio: "pipe", encoding: "utf8" });
    execFileSync("pnpm", ["build"], { cwd: app, env: environment("p13-packed", container.getConnectionUri()), stdio: "pipe", encoding: "utf8" });
    await administrator.query("create database p13_packed_application");
    const url = new URL(container.getConnectionUri()); url.pathname = "/p13_packed_application";
    const result = await packedChild(app, "p13-packed", url.toString(), await unusedPort());
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /P13_3_PACKED_LISTEN_FAILURE_PASS/u);
    assert.match(result.output, /P13_3_PACKED_SHUTDOWN_PASS/u);
    assert.match(result.output, /P13_3_PACKED_WEB_PROCESS_PASS/u);
    assert.match(result.output, /P13_3_PACKED_ADMITTED_HANDLER_DRAIN_PASS/u);
    assert.match(result.output, /P13_3_PACKED_ADMITTED_HANDLER_DEADLINE_PASS/u);
    assert.match(result.output, /P13_3_PACKED_ADMITTED_HANDLER_REJECTION_PASS/u);
    assert.match(result.output, /P13_3_PACKED_OCCUPIED_PORT_CLEANUP_PASS/u);
    assert.match(result.output, /P13_3_PACKED_PRELISTEN_PRIMARY_CLEANUP_PASS/u);
    assert.match(result.output, /P13_3_PACKED_PRELISTEN_REJECTED_CLEANUP_PASS/u);
    assert.match(result.output, /P13_3_PACKED_PRELISTEN_DEADLINE_PASS/u);
    assert.match(result.output, /P13_3_PACKED_REJECTED_CLOSE_DRAIN_PASS/u);
    assert.match(result.output, /P13_3_PACKED_HANDLE_FREE_SHUTDOWN_DEADLINE_PASS/u);
    assert.match(result.output, /P13_3_PACKED_SETTLED_REJECTION_IMMEDIATE_PASS/u);
    assert.match(result.output, /P13_3_PACKED_POST_LISTEN_ERROR_PASS/u);
    const activeBackends = await administrator.query("select count(*)::int as count from pg_stat_activity where datname='p13_packed_application'");
    assert.equal(activeBackends.rows[0].count, 0, "Generated shutdown retained a Payload PostgreSQL backend.");
  } finally {
    await administrator.end();
    await container.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
