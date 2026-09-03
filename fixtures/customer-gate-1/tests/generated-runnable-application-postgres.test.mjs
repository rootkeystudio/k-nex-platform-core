import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { applyCreateKnexApplication, planCreateKnexApplication } from "@k-nex/composition";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const repositoryRoot = resolve(import.meta.dirname, "../../..");

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.notEqual(typeof address, "string");
  const port = address.port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitFor(url, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Generated application exited early.\n${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Generated application did not become ready.\n${output()}`);
}

test("P12.2 packed application installs frozen, migrates, builds, and serves readiness", { timeout: 240_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("p12_generated").withStartupTimeout(120_000).start();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "p12-generated-application-")));
  const application = join(root, "application");
  let child;
  try {
    const releaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"), "utf8"));
    const plan = planCreateKnexApplication({
      applicationId: "p12-runnable-proof",
      applicationName: "P12 Runnable Proof",
      theme: "minimal",
      database: "external",
      packageSource: {
        kind: "packed-mirror",
        directory: resolve(repositoryRoot, "fixtures/customer-gate-1/packages"),
        releaseManifest
      }
    });
    applyCreateKnexApplication(plan, application);
    for (const command of plan.installCommands) execFileSync(command[0], command.slice(1), { cwd: application, stdio: "pipe" });

    const environment = {
      ...process.env,
      DATABASE_URL: container.getConnectionUri(),
      K_NEX_ENVIRONMENT: "test",
      PAYLOAD_SECRET: "p12-runnable-proof-payload-secret"
    };
    execFileSync("pnpm", ["knex:migrate"], { cwd: application, env: environment, stdio: "pipe" });
    execFileSync("pnpm", ["build"], { cwd: application, env: environment, stdio: "pipe" });

    const port = await unusedPort();
    child = spawn("pnpm", ["start"], { cwd: application, env: { ...environment, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    const health = await waitFor(`http://127.0.0.1:${port}/api/health`, child, () => output);
    assert.deepEqual(await health.json(), { schemaVersion: 1, status: "alive" });
    const readiness = await waitFor(`http://127.0.0.1:${port}/api/readiness`, child, () => output);
    assert.deepEqual(await readiness.json(), { schemaVersion: 1, status: "ready", applicationId: "p12-runnable-proof" });
    const workspace = await waitFor(`http://127.0.0.1:${port}/`, child, () => output);
    assert.match(await workspace.text(), /P12 Runnable Proof/u);
  } finally {
    if (child?.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolveClose) => child.once("close", resolveClose));
    }
    await container.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
