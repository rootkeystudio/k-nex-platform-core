import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { PackageReleaseManifestSchema } from "@k-nex/contracts";
import { applyCreateKnexApplication, planCreateKnexApplication } from "@k-nex/composition";
import { assertMigrationReadiness, executeMigrationJob, planPluginUpgrade } from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const integrity = (content) => `sha512-${createHash("sha512").update(content).digest("base64")}`;

function boot(application, applicationId, connectionString, mode = "observe") {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(process.execPath, [resolve(import.meta.dirname, "packed-customer-boot-child.mjs"), application, applicationId, mode], {
      cwd: application,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "phase-8-prior-upgrade-secret" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolveProcess({ code, stdout, stderr }));
  });
}

function installApplication(application, mirror, releaseManifest, applicationId) {
  const plan = planCreateKnexApplication({
    applicationId, applicationName: "Customer Beta Upgrade", theme: "minimal", database: "external",
    packageSource: { kind: "packed-mirror", directory: mirror, releaseManifest }
  });
  applyCreateKnexApplication(plan, application);
  for (const command of plan.installCommands) execFileSync(command[0], command.slice(1), { cwd: application, env: process.env, stdio: "pipe" });
  execFileSync("pnpm", ["build"], { cwd: application, env: process.env, stdio: "pipe" });
  return readFileSync(resolve(application, "pnpm-lock.yaml"));
}

function neutralUpgradeManifest(currentManifest, version, label) {
  return PackageReleaseManifestSchema.parse({
    ...currentManifest,
    packages: currentManifest.packages.map((entry) => entry.package === "@k-nex/module-sales"
      ? { ...entry, package: "@fixture/upgrade-module", version, integrity: integrity(label) }
      : entry)
  });
}

test("boots the current Sales package and applies a neutral fixture upgrade history in the same PostgreSQL database", { timeout: 300_000 }, async () => {
  const currentManifest = PackageReleaseManifestSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"), "utf8")));
  const priorManifest = neutralUpgradeManifest(currentManifest, "0.9.0", "fixture-prior");
  const targetManifest = neutralUpgradeManifest(currentManifest, "1.0.1", "fixture-target");
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("customer_beta_upgrade").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const generatedRoot = realpathSync(mkdtempSync(join(tmpdir(), "phase-8-continuous-upgrade-")));
  const application = resolve(generatedRoot, "customer-beta");
  const mirror = resolve(generatedRoot, "packages");
  const applicationId = "customer-beta-upgrade";
  try {
    mkdirSync(mirror);
    const packages = new Map(currentManifest.packages.map((entry) => [`${entry.package}@${entry.version}`, entry]));
    for (const entry of packages.values()) {
      const filename = `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`;
      copyFileSync(resolve(repositoryRoot, "fixtures/customer-gate-1/packages", filename), resolve(mirror, filename));
    }

    installApplication(application, mirror, currentManifest, applicationId);
    const priorBoot = await boot(application, applicationId, container.getConnectionUri(), "seed-prior");
    assert.equal(priorBoot.code, 0, `${priorBoot.stdout}\n${priorBoot.stderr}`);
    assert.equal(JSON.parse(priorBoot.stdout.match(/PACKED_CUSTOMER_BOOT (\{.*\})/u)[1]).documents, 1);

    rmSync(application, { recursive: true, force: true });
    installApplication(application, mirror, currentManifest, applicationId);
    const requireFromTarget = createRequire(resolve(application, "package.json"));
    const targetMigrations = await import(pathToFileURL(requireFromTarget.resolve("@k-nex/module-sales/migrations")));
    const plan = planPluginUpgrade({
      pluginId: "module.fixture.upgrade", packageName: "@fixture/upgrade-module", currentVersion: "0.9.0", targetVersion: "1.0.1",
      currentPlatformRelease: "1.0.0", targetPlatformRelease: "1.0.0", currentReleaseManifest: priorManifest, targetReleaseManifest: targetManifest,
      targets: targetMigrations.salesUpgradeTargets, migrations: targetMigrations.salesUpgradeMigrations
    });
    assert.equal(plan.ready, true);
    await executeMigrationJob({
      pool, applicationId: `${applicationId}-sales`, expectedPredecessorRevision: 1, targetRevision: 2, releaseRevision: "module.fixture.upgrade-1.0.1",
      async migrate(session) {
        for (const step of plan.steps) {
          const current = await session.query("select revision, document from k_nex_upgrade_artifacts where artifact_id = $1 for update", [step.artifactId]);
          assert.equal(current.rows[0]?.revision, step.fromRevision);
          const migrated = step.migrate(current.rows[0].document);
          assert.equal(step.validate(migrated), true);
          await session.query("update k_nex_upgrade_artifacts set revision = $2, document = $3::jsonb where artifact_id = $1", [step.artifactId, step.toRevision, JSON.stringify(migrated)]);
        }
      }
    });
    await assertMigrationReadiness({ pool, applicationId: `${applicationId}-sales`, artifactRevision: 2, releaseRevision: "module.fixture.upgrade-1.0.1" });

    const targetBoot = await boot(application, applicationId, container.getConnectionUri());
    assert.equal(targetBoot.code, 0, `${targetBoot.stdout}\n${targetBoot.stderr}`);
    const targetEvidence = JSON.parse(targetBoot.stdout.match(/PACKED_CUSTOMER_BOOT (\{.*\})/u)[1]);
    assert.equal(targetEvidence.documents, 1); assert.equal(targetEvidence.opportunities, 1);
    const customerData = await pool.query("select title, potential_revenue, private_note from sales_tasks");
    assert.deepEqual(customerData.rows, [{ title: "Preserve beta renewal", potential_revenue: "42000", private_note: "customer-owned" }]);
    const artifacts = await pool.query("select artifact_id, revision, document from k_nex_upgrade_artifacts order by artifact_id");
    assert.equal(artifacts.rows.length, 8);
    assert.equal(artifacts.rows.every(({ revision, document }) => revision === 2 && document.revision === 2), true);
    assert.equal(artifacts.rows.find(({ artifact_id }) => artifact_id === "sales.settings").document.values.defaultPage, "tasks");
    assert.equal(artifacts.rows.find(({ artifact_id }) => artifact_id === "sales.template").document.descriptor.id, "sales.page.tasks");
  } finally {
    await pool.end();
    await container.stop();
    rmSync(generatedRoot, { recursive: true, force: true });
  }
});
