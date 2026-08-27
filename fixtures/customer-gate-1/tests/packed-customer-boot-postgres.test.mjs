import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { applyCreateKnexApplication, planCreateKnexApplication } from "@k-nex/composition";
import { createDeploymentReceipt, FleetRegistry } from "@k-nex/runtime";
import { createFixtureDeploymentVerifier } from "../../../scripts/lib/fixture-deployment-authority.mjs";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const repositoryRoot = resolve(import.meta.dirname, "../../..");

function bootCustomer(customerDirectory, customer, connectionString) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(process.execPath, [resolve(import.meta.dirname, "packed-customer-boot-child.mjs"), customerDirectory, customer], {
      cwd: customerDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: `phase-8-${customer}-packed-boot-secret` },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolveProcess({ code, stdout, stderr }));
  });
}

async function protectedObservation(pool, inventory) {
  const token = randomBytes(24).toString("hex");
  const server = createServer(async (request, response) => {
    if (request.url !== "/internal/k-nex/inventory" || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    try {
      const state = await pool.query(`select
        to_regclass('public.sales_tasks')::text as tasks,
        to_regclass('public.sales_opportunities')::text as opportunities,
        (select count(*)::int from payload_migrations) as migrations,
        (select revision from k_nex_release_revision where application_id = $1) as revision,
        (select count(*)::int from k_nex_default_pages) as pages`, [inventory.applicationId]);
      const row = state.rows[0];
      if (row.tasks !== "sales_tasks" || row.opportunities !== "sales_opportunities" || row.migrations !== 2 || row.revision !== 1 || row.pages !== 2) {
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(inventory));
    } catch {
      response.writeHead(503).end();
    }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/internal/k-nex/inventory`;
  return {
    close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
    observe: async () => {
      assert.equal((await fetch(url)).status, 401, "runtime inventory endpoint must reject anonymous requests");
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      return response.json();
    }
  };
}

test("boots both customer apps from packed packages and verifies protected runtime observations", { timeout: 240_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("phase8").withStartupTimeout(120_000).start();
  const administrator = new pg.Pool({ connectionString: container.getConnectionUri() });
  const supportManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/0.2.0/package-release-manifest.json"), "utf8"));
  const priorManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/0.1.0/package-release-manifest.json"), "utf8"));
  const committedAlpha = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/customer-alpha/runtime-inventory.json"), "utf8"));
  const sourceCommit = committedAlpha.releaseEvidence.sourceCommit;
  const verifier = createFixtureDeploymentVerifier(sourceCommit);
  const fleet = new FleetRegistry(supportManifest, verifier.authority);
  const pools = [];
  const generatedRoot = realpathSync(mkdtempSync(join(tmpdir(), "phase-8-generated-app-")));
  try {
    const mirror = resolve(generatedRoot, "packages");
    mkdirSync(mirror);
    const releaseEntries = new Map([...supportManifest.packages, ...priorManifest.packages].map((entry) => [`${entry.package}@${entry.version}`, entry]));
    for (const entry of releaseEntries.values()) {
      const filename = `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`;
      copyFileSync(resolve(repositoryRoot, "fixtures/customer-gate-1/packages", filename), resolve(mirror, filename));
    }
    for (const [label, releaseManifest] of [["current", supportManifest], ["prior", priorManifest]]) {
      const applicationId = `gate-eight-${label}`;
      const generatedApplication = resolve(generatedRoot, `application-${label}`);
      const generatedPlan = planCreateKnexApplication({
        applicationId, applicationName: `Gate Eight ${label}`, theme: "minimal", database: "external",
        packageSource: { kind: "packed-mirror", directory: "../packages", releaseManifest }
      });
      applyCreateKnexApplication(generatedPlan, generatedApplication);
      for (const command of generatedPlan.installCommands) {
        execFileSync(command[0], command.slice(1), { cwd: generatedApplication, env: process.env, stdio: "pipe", encoding: "utf8" });
      }
      execFileSync("pnpm", ["build"], { cwd: generatedApplication, env: process.env, stdio: "pipe", encoding: "utf8" });
      const database = `gate_eight_${label}`;
      await administrator.query(`create database ${database}`);
      const generatedUrl = new URL(container.getConnectionUri());
      generatedUrl.pathname = `/${database}`;
      const generatedBoot = await bootCustomer(generatedApplication, applicationId, generatedUrl.toString());
      assert.equal(generatedBoot.code, 0, `${generatedBoot.stdout}\n${generatedBoot.stderr}`);
      assert.ok(generatedBoot.stdout.includes("PACKED_CUSTOMER_BOOT"));
      const generatedPool = new pg.Pool({ connectionString: generatedUrl.toString() });
      pools.push(generatedPool);
      const generatedState = await generatedPool.query(`select
        to_regclass('public.sales_tasks')::text as tasks,
        to_regclass('public.sales_opportunities')::text as opportunities,
        (select count(*)::int from payload_migrations) as migrations,
        (select revision from k_nex_release_revision where application_id = $1) as revision,
        (select count(*)::int from k_nex_default_pages) as pages`, [applicationId]);
      assert.deepEqual(generatedState.rows, [{ tasks: "sales_tasks", opportunities: "sales_opportunities", migrations: 2, revision: 1, pages: 2 }]);
    }

    for (const customer of ["customer-alpha", "customer-beta"]) {
      const database = customer.replace("-", "_");
      await administrator.query(`create database ${database}`);
      const url = new URL(container.getConnectionUri());
      url.pathname = `/${database}`;
      const fixture = resolve(repositoryRoot, "fixtures", customer);
      const boot = await bootCustomer(fixture, customer, url.toString());
      assert.equal(boot.code, 0, `${boot.stdout}\n${boot.stderr}`);
      const marker = boot.stdout.match(/PACKED_CUSTOMER_BOOT (\{.*\})/u);
      assert.ok(marker, boot.stdout);
      const bootEvidence = JSON.parse(marker[1]);
      assert.deepEqual(bootEvidence.collections, ["sales-opportunities", "sales-tasks"]);
      assert.equal(bootEvidence.resolvedPackages.every((path) => path.includes(`/fixtures/${customer}/node_modules/.pnpm/`)), true);

      const pool = new pg.Pool({ connectionString: url.toString() });
      pools.push(pool);
      const committed = JSON.parse(readFileSync(resolve(repositoryRoot, `fixtures/${customer}/runtime-inventory.json`), "utf8"));
      const inventory = { ...committed, migrationRevision: 1, observedAt: "2026-08-27T15:00:00.000Z" };
      const endpoint = await protectedObservation(pool, inventory);
      try {
        const receipt = createDeploymentReceipt({
          inventory,
          deploymentId: `packed-boot:${customer}:1`,
          deployedAt: "2026-08-27T15:01:00.000Z",
          approvedBy: { kind: "workflow", identity: `rootkeystudio/k-nex-platform-core/.github/workflows/deploy.yml@${sourceCommit}` },
          smoke: { status: "passed", checks: ["protected-runtime-inventory", "sales-query"] }
        });
        fleet.ingest(await verifier.verify(inventory, receipt, endpoint.observe));
      } finally {
        await endpoint.close();
      }
    }
    assert.deepEqual(fleet.list().map(({ inventory }) => inventory.applicationId), ["customer-alpha", "customer-beta"]);
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
    await administrator.end();
    await container.stop();
    rmSync(generatedRoot, { recursive: true, force: true });
  }
});
