import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { PackageReleaseManifestSchema } from "@k-nex/contracts";
import { salesUpgradeMigrations, salesUpgradeTargets } from "@k-nex/module-sales/migrations";
import { assertMigrationReadiness, executeMigrationJob, planPluginUpgrade } from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";

test("boots the supported prior release and upgrades every reviewed Sales artifact in PostgreSQL", { timeout: 180_000 }, async () => {
  const supportManifest = PackageReleaseManifestSchema.parse(JSON.parse(readFileSync(new URL("../../../releases/0.2.0/package-release-manifest.json", import.meta.url), "utf8")));
  const plan = planPluginUpgrade({
    pluginId: "module.sales", currentVersion: "1.0.0", targetVersion: "1.1.0",
    currentPlatformRelease: "0.1.0", targetPlatformRelease: "0.2.0", supportManifest,
    targets: salesUpgradeTargets, migrations: salesUpgradeMigrations
  });
  assert.equal(plan.ready, true);

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("customer_beta_prior").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await pool.query(`
      create table k_nex_release_revision (
        application_id text primary key, predecessor_revision integer not null, revision integer not null, release_revision text not null
      );
      create table k_nex_upgrade_artifacts (
        artifact_id text primary key, kind text not null, revision integer not null, document jsonb not null
      );
      insert into k_nex_release_revision values ('customer.beta', 5, 6, 'platform-0.1.0');
    `);
    for (const target of salesUpgradeTargets) {
      await pool.query("insert into k_nex_upgrade_artifacts values ($1, $2, 1, $3::jsonb)", [target.artifactId, target.kind, JSON.stringify({ revision: 1, customer: "customer-beta", preserved: target.artifactId })]);
    }

    const receipt = await executeMigrationJob({
      pool, applicationId: "customer.beta", databaseIdentity: "customer-beta-prior", expectedPredecessorRevision: 6,
      targetRevision: 7, releaseRevision: "platform-0.2.0",
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
    assert.deepEqual(receipt, { applicationId: "customer.beta", predecessorRevision: 6, revision: 7, releaseRevision: "platform-0.2.0" });
    await assertMigrationReadiness({ pool, applicationId: "customer.beta", artifactRevision: 7, releaseRevision: "platform-0.2.0" });
    const upgraded = await pool.query("select artifact_id, kind, revision, document from k_nex_upgrade_artifacts order by artifact_id");
    assert.equal(upgraded.rows.length, 8);
    for (const row of upgraded.rows) {
      assert.equal(row.revision, 2);
      assert.equal(row.document.revision, 2);
      assert.equal(row.document.customer, "customer-beta");
      assert.equal(row.document.preserved, row.artifact_id);
    }
  } finally {
    await pool.end();
    await container.stop();
  }
});
