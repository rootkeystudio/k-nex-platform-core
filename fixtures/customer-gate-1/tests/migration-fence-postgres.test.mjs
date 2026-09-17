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
 * A fresh install records the release it is, directly, so it reaches the
 * historical transition steps already at that release and passes through them
 * unchanged. A database still on the predecessor is refused before any target
 * migration runs: this command cannot hold the database authority across the
 * whole transition, so it does not pretend to perform one. The coordinator's
 * own step is proved here too, against the exact predecessor tuple.
 */
test("the release transition admits a fresh install, refuses a predecessor database, and is executable only from the exact source", { timeout: 180_000 }, async () => {
  const { planCreateKnexApplication, platformReleaseIdentity, platformReleaseRevision, platformTransitionSource } = await import("@k-nex/composition");
  const applicationId = "release-revision-proof";
  const plan = planCreateKnexApplication({ applicationId, applicationName: "Release Revision Proof", theme: "minimal", database: "external", primaryCurrency: "USD" });
  const rawStatement = (path, label) => {
    const source = plan.files[path];
    assert.ok(source, `The factory must emit ${label}.`);
    const [, statement] = /sql\.raw\(`([\s\S]+?)`\)\);/u.exec(source) ?? [];
    assert.ok(statement, `${label} must carry one raw statement.`);
    return statement;
  };
  const preflight = rawStatement("src/migrations/20260905_000026_release_preflight.ts", "a release preflight migration");
  const statement = rawStatement("src/migrations/20260909_000036_release_revision.ts", "a release-revision migration");
  const [, bootstrapRow] = /INSERT INTO "k_nex_release_revision" VALUES \(([^)]+)\)/u.exec(plan.files["src/migrations/20260827_000002_knex_bootstrap.ts"]) ?? [];
  assert.ok(bootstrapRow, "The bootstrap migration must insert one release row.");
  const targetRevision = platformReleaseRevision("1.1.0");
  const targetIdentity = platformReleaseIdentity("1.1.0");
  const source = platformTransitionSource("1.1.0");
  assert.deepEqual(source, { predecessorRevision: 0, revision: 1, identity: "platform-1.0.0-bootstrap" });

  // A fresh install bootstraps straight onto this release, so the historical
  // transition steps have nothing to do and a later release can replay the
  // registry without walking transitions it was never on.
  assert.match(bootstrapRow, new RegExp(`0, ${targetRevision}, '${targetIdentity}'`, "u"),
    "The bootstrap migration must record this release directly.");

  // The preflight must still precede every target migration.
  const registry = [...plan.files["src/migrations/index.ts"].matchAll(/name: "([^"\n]+)"/gu)].map(([, name]) => name);
  const preflightIndex = registry.indexOf("20260905_000026_release_preflight");
  assert.ok(preflightIndex > 0, "The generated registry must contain the release preflight.");
  for (const target of ["20260905_000027_crm_core", "20260906_000029_attachment_upload_admissions", "20260908_000034_reports", "20260909_000036_release_revision"]) {
    assert.ok(registry.indexOf(target) > preflightIndex, `The preflight must precede the target migration ${target}.`);
  }

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("release_revision").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    const seed = async (predecessor, revision, identity) => {
      await pool.query("drop table if exists k_nex_release_revision");
      await pool.query(`create table k_nex_release_revision (
        application_id varchar primary key not null, predecessor_revision integer not null,
        revision integer not null, release_revision varchar not null
      )`);
      if (identity !== undefined) await pool.query("insert into k_nex_release_revision values ($1, $2, $3, $4)", [applicationId, predecessor, revision, identity]);
    };
    const row = async () => (await pool.query(
      "select predecessor_revision, revision, release_revision from k_nex_release_revision where application_id = $1", [applicationId]
    )).rows;

    // Fresh install: no table yet, then this release's own row. Both pass.
    await pool.query("drop table if exists k_nex_release_revision");
    await pool.query(preflight);
    await seed(0, targetRevision, targetIdentity);
    await pool.query(preflight);
    await pool.query(statement);
    assert.deepEqual(await row(), [{ predecessor_revision: 0, revision: targetRevision, release_revision: targetIdentity }],
      "A database already on this release must pass through the transition steps unchanged.");

    // A database still on the predecessor is refused, naming the coordinator,
    // and is left exactly as it was.
    await seed(source.predecessorRevision, source.revision, source.identity);
    const predecessorRow = await row();
    await assert.rejects(pool.query(preflight), /must be transitioned by the upgrade coordinator/u,
      "The application migration command must refuse to perform a release transition.");
    assert.deepEqual(await row(), predecessorRow, "A refused predecessor database must be left exactly as it was.");

    // The coordinator's own step advances exactly that tuple, once.
    await pool.query(statement);
    assert.deepEqual(await row(), [{ predecessor_revision: source.revision, revision: targetRevision, release_revision: targetIdentity }]);
    await pool.query(statement);
    assert.deepEqual(await row(), [{ predecessor_revision: source.revision, revision: targetRevision, release_revision: targetIdentity }],
      "Replaying the transition step on an advanced database must change nothing.");
    assert.deepEqual(await assertMigrationReadiness({ pool, applicationId, artifactRevision: targetRevision, releaseRevision: targetIdentity }),
      { applicationId, predecessorRevision: source.revision, revision: targetRevision, releaseRevision: targetIdentity });

    // Every other recorded state is refused by both, and left untouched.
    for (const [name, state] of [
      ["zero revision", [0, 0, "platform-1.0.0-bootstrap"]],
      ["unknown identity", [0, 1, "platform-0.9.0-bootstrap"]],
      ["corrupt identity", [0, 1, ""]],
      ["impossible chain field", [99, 1, "platform-1.0.0-bootstrap"]],
      ["missing row", undefined]
    ]) {
      await seed(...(state ?? [0, 0, undefined]));
      const before = await row();
      await assert.rejects(pool.query(preflight), /does not record a release this application can run/u, `The preflight admitted a ${name} database.`);
      await assert.rejects(pool.query(statement), /from an accepted predecessor/u, `The transition step advanced a ${name} database.`);
      assert.deepEqual(await row(), before, `A refused ${name} database must be left exactly as it was.`);
    }

    // Two coordinators racing the transition: exactly one advances.
    await seed(source.predecessorRevision, source.revision, source.identity);
    const racers = await Promise.allSettled([pool.query(statement), pool.query(statement)]);
    assert.equal(racers.filter(({ status }) => status === "rejected").length, 0,
      "A second runner must find the release already advanced rather than fail.");
    assert.deepEqual(await row(), [{ predecessor_revision: source.revision, revision: targetRevision, release_revision: targetIdentity }],
      "A contested transition must still record exactly the target release.");
  } finally {
    await pool.end();
    await container.stop();
  }
});
