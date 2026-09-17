import assert from "node:assert/strict";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { assertMigrationReadiness, executeMigrationJob } from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";

test("proves advisory-lock concurrency, rollback, release receipt, and stale readiness against PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("migration_fence").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const equivalentPool = new pg.Pool({ connectionString: container.getConnectionUri(), application_name: "equivalent-description" });
  try {
    await pool.query(`
      create table k_nex_release_revision (
        application_id text primary key,
        predecessor_revision integer not null,
        revision integer not null,
        release_revision text not null
      );
      insert into k_nex_release_revision values ('customer.alpha', 5, 6, 'release-6');
    `);

    let entered;
    const migrationEntered = new Promise((resolve) => { entered = resolve; });
    let continueFirst;
    const allowFirst = new Promise((resolve) => { continueFirst = resolve; });
    const first = executeMigrationJob({
      pool, applicationId: "customer.alpha", expectedPredecessorRevision: 6,
      targetRevision: 7, releaseRevision: "release-7",
      async migrate(session) {
        await session.query("create table sales_upgrade_marker (id integer primary key)");
        entered();
        await allowFirst;
      }
    });
    await migrationEntered;

    await assert.rejects(executeMigrationJob({
      pool: equivalentPool,
      applicationId: "customer.alpha", expectedPredecessorRevision: 6,
      targetRevision: 7, releaseRevision: "release-7", migrate: async () => {}
    }), { code: "LOCK_UNAVAILABLE" });
    continueFirst();
    assert.deepEqual(await first, { applicationId: "customer.alpha", predecessorRevision: 6, revision: 7, releaseRevision: "release-7" });

    await assert.rejects(executeMigrationJob({
      pool, applicationId: "customer.alpha", expectedPredecessorRevision: 7,
      targetRevision: 8, releaseRevision: "release-8",
      async migrate(session) {
        await session.query("create table interrupted_marker (id integer primary key)");
        throw new Error("injected interruption");
      }
    }), /injected interruption/u);
    const state = await pool.query(`
      select predecessor_revision, revision, release_revision,
        to_regclass('public.sales_upgrade_marker')::text as committed_marker,
        to_regclass('public.interrupted_marker')::text as interrupted_marker
      from k_nex_release_revision where application_id = 'customer.alpha'
    `);
    assert.deepEqual(state.rows, [{ predecessor_revision: 6, revision: 7, release_revision: "release-7", committed_marker: "sales_upgrade_marker", interrupted_marker: null }]);

    await assert.rejects(assertMigrationReadiness({ pool, applicationId: "customer.alpha", artifactRevision: 6, releaseRevision: "release-6" }), { code: "STALE_ARTIFACT" });
    assert.deepEqual(await assertMigrationReadiness({ pool, applicationId: "customer.alpha", artifactRevision: 7, releaseRevision: "release-7" }), {
      applicationId: "customer.alpha", predecessorRevision: 6, revision: 7, releaseRevision: "release-7"
    });
  } finally {
    await equivalentPool.end();
    await pool.end();
    await container.stop();
  }
});

/**
 * A database upgraded from 1.0 keeps the bootstrap migration it already ran,
 * and that migration names the release it was generated for, so without a
 * release-revision step the upgraded database still reads platform-1.0.0 and
 * the 1.1 application can never report ready. This proves the step exists,
 * that it converges an upgraded database and a fresh one onto the same
 * identity, that the readiness contract accepts exactly that identity, and
 * that it refuses to run twice.
 */
test("the release-revision migration converges upgraded and fresh databases onto the release the application runs", { timeout: 180_000 }, async () => {
  const { planCreateKnexApplication, platformAcceptedPredecessors, platformReleaseIdentity, platformReleaseRevision } = await import("@k-nex/composition");
  const applicationId = "release-revision-proof";
  const plan = planCreateKnexApplication({ applicationId, applicationName: "Release Revision Proof", theme: "minimal", database: "external", primaryCurrency: "USD" });
  const rawStatement = (path, label) => {
    const source = plan.files[path];
    assert.ok(source, `The factory must emit ${label}.`);
    const [, statement] = /sql\.raw\(`([\s\S]+?)`\)\);/u.exec(source) ?? [];
    assert.ok(statement, `${label} must carry one raw statement.`);
    return statement;
  };
  const statement = rawStatement("src/migrations/20260909_000036_release_revision.ts", "a release-revision migration");
  const preflight = rawStatement("src/migrations/20260905_000026_release_preflight.ts", "a release preflight migration");
  const targetRevision = platformReleaseRevision("1.1.0");
  const targetIdentity = platformReleaseIdentity("1.1.0");

  // The transition mutates customer schema before its final step, so the
  // preflight must run before the first target migration; otherwise an
  // unsupported source database is mutated and only then inspected.
  const registry = [...plan.files["src/migrations/index.ts"].matchAll(/name: "([^"\n]+)"/gu)].map(([, name]) => name);
  const preflightIndex = registry.indexOf("20260905_000026_release_preflight");
  const revisionIndex = registry.indexOf("20260909_000036_release_revision");
  assert.ok(preflightIndex > 0, "The generated registry must contain the release preflight.");
  assert.equal(revisionIndex, registry.length - 1, "The release-revision step must be the last migration.");
  for (const target of ["20260905_000027_crm_core", "20260906_000029_attachment_upload_admissions", "20260908_000034_reports"]) {
    assert.ok(registry.indexOf(target) > preflightIndex, `The preflight must precede the target migration ${target}.`);
  }

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("release_revision").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    const bootstrap = async (release) => {
      await pool.query("drop table if exists k_nex_release_revision");
      await pool.query(`create table k_nex_release_revision (
        application_id varchar primary key not null, predecessor_revision integer not null,
        revision integer not null, release_revision varchar not null
      )`);
      await pool.query("insert into k_nex_release_revision values ($1, 0, 1, $2)", [applicationId, `platform-${release}-bootstrap`]);
    };
    const row = async () => (await pool.query(
      "select predecessor_revision, revision, release_revision from k_nex_release_revision where application_id = $1", [applicationId]
    )).rows;

    // Upgraded: the preserved 1.0 bootstrap ran, and this release advances it.
    await bootstrap("1.0.0");
    await assert.rejects(assertMigrationReadiness({ pool, applicationId, artifactRevision: targetRevision, releaseRevision: targetIdentity }),
      { code: "REVISION_MISMATCH" }, "An unupgraded database must not satisfy this release's readiness.");
    await pool.query(statement);
    const upgraded = await row();
    assert.deepEqual(upgraded, [{ predecessor_revision: 1, revision: targetRevision, release_revision: targetIdentity }]);
    assert.deepEqual(await assertMigrationReadiness({ pool, applicationId, artifactRevision: targetRevision, releaseRevision: targetIdentity }),
      { applicationId, predecessorRevision: 1, revision: targetRevision, releaseRevision: targetIdentity });
    await assert.rejects(pool.query(statement), /did not advance/u, "The release-revision migration must fail closed rather than advance twice.");
    assert.deepEqual(await row(), upgraded, "A refused replay must leave the recorded release untouched.");

    // Fresh install of this release must land on the identical row.
    await bootstrap("1.1.0");
    await pool.query(preflight);
    await pool.query(statement);
    assert.deepEqual(await row(), upgraded, "A fresh install and an upgraded database must record the same release.");

    // Only the declared predecessors are admitted. Everything else must be
    // refused by the preflight, before any target migration runs, and must
    // also be refused by the final step so a mutated database cannot have an
    // invalid release identity normalized into a ready-looking one.
    const accepted = platformAcceptedPredecessors("1.1.0").map(({ revision, identity }) => `${revision}:${identity}`);
    assert.deepEqual([...accepted].sort(), ["1:platform-1.0.0-bootstrap", "1:platform-1.1.0-bootstrap"].sort());
    for (const [name, seed] of [
      ["zero revision", { predecessor: 0, revision: 0, identity: "platform-1.0.0-bootstrap" }],
      ["unknown identity", { predecessor: 0, revision: 1, identity: "platform-0.9.0-bootstrap" }],
      ["corrupt identity", { predecessor: 0, revision: 1, identity: "" }],
      ["already advanced", { predecessor: 1, revision: targetRevision, identity: targetIdentity }],
      ["skipped release", { predecessor: 2, revision: 3, identity: "platform-1.2.0-release" }]
    ]) {
      await pool.query("delete from k_nex_release_revision where application_id = $1", [applicationId]);
      await pool.query("insert into k_nex_release_revision values ($1, $2, $3, $4)", [applicationId, seed.predecessor, seed.revision, seed.identity]);
      const before = await row();
      await assert.rejects(pool.query(preflight), /does not record an accepted predecessor release/u, `The preflight admitted a ${name} source.`);
      await assert.rejects(pool.query(statement), /from an accepted predecessor/u, `The release-revision step advanced a ${name} source.`);
      assert.deepEqual(await row(), before, `A refused ${name} source must be left exactly as it was.`);
    }

    // A missing row is not a predecessor either.
    await pool.query("delete from k_nex_release_revision where application_id = $1", [applicationId]);
    await assert.rejects(pool.query(preflight), /does not record an accepted predecessor release/u, "The preflight admitted a database with no release record.");
    await assert.rejects(pool.query(statement), /from an accepted predecessor/u, "The release-revision step advanced a database with no release record.");
    assert.deepEqual(await row(), [], "A refused database must not gain a release record.");

    // Two runners racing the final step: the advisory lock plus the exact CAS
    // must let exactly one advance and refuse the other.
    await bootstrap("1.0.0");
    const racers = await Promise.allSettled([pool.query(statement), pool.query(statement)]);
    assert.equal(racers.filter(({ status }) => status === "fulfilled").length, 1, "Exactly one concurrent runner may advance the release.");
    assert.equal(racers.filter(({ status }) => status === "rejected").length, 1, "The losing concurrent runner must be refused.");
    assert.deepEqual(await row(), upgraded, "A contested advance must still record exactly the target release.");
  } finally {
    await pool.end();
    await container.stop();
  }
});
