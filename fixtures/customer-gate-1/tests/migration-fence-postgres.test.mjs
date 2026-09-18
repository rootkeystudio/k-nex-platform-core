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
 * A release is one exact database state. This proves that a fresh installation
 * and an upgraded database reach the identical record, that the record is only
 * written once the declared migration set is durably complete, that every other
 * recorded state - including one that merely counts as newer - is refused
 * without touching the database, and that the next release accepts both
 * histories as the same predecessor.
 */
test("the release record is one canonical completion receipt for both installation histories", { timeout: 180_000 }, async () => {
  const { planCreateKnexApplication, platformInstallingState, platformReleaseState, platformTransitionSource } = await import("@k-nex/composition");
  const applicationId = "release-state-proof";
  const plan = planCreateKnexApplication({ applicationId, applicationName: "Release State Proof", theme: "minimal", database: "external", primaryCurrency: "USD" });
  const rawStatement = (path, label) => {
    const source = plan.files[path];
    assert.ok(source, `The factory must emit ${label}.`);
    const [, statement] = /sql\.raw\(`([\s\S]+?)`\)\);/u.exec(source) ?? [];
    assert.ok(statement, `${label} must carry one raw statement.`);
    return statement;
  };
  const preflight = rawStatement("src/migrations/20260905_000026_release_preflight.ts", "a release preflight migration");
  const completion = rawStatement("src/migrations/20260909_000036_release_revision.ts", "a release completion migration");
  const registry = [...plan.files["src/migrations/index.ts"].matchAll(/name: "([^"\n]+)"/gu)].map(([, name]) => name);
  const installing = platformInstallingState("1.1.0");
  const complete = platformReleaseState("1.1.0");
  const source = platformTransitionSource("1.1.0");

  // One canonical record, and it is not the installation state.
  assert.deepEqual(complete, { predecessorRevision: 0, revision: 2, identity: "platform-1.1.0-release" });
  assert.deepEqual(source, { predecessorRevision: 0, revision: 1, identity: "platform-1.0.0-bootstrap" });
  assert.notDeepEqual(installing, complete);

  // The bootstrap may not claim the release it has not finished.
  const [, bootstrapRow] = /INSERT INTO "k_nex_release_revision" VALUES \(([^)]+)\)/u.exec(plan.files["src/migrations/20260827_000002_knex_bootstrap.ts"]) ?? [];
  assert.ok(bootstrapRow, "The bootstrap migration must insert one release row.");
  assert.match(bootstrapRow, new RegExp(`${installing.predecessorRevision}, ${installing.revision}, '${installing.identity}'`, "u"),
    "The bootstrap migration must record the installation, not the release.");
  assert.equal(registry.indexOf("20260909_000036_release_revision"), registry.length - 1, "The completion step must run last.");

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("release_state").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    const createTable = async () => {
      await pool.query("drop table if exists k_nex_release_revision");
      await pool.query(`create table k_nex_release_revision (
        application_id varchar primary key not null, predecessor_revision integer not null,
        revision integer not null, release_revision varchar not null
      )`);
    };
    const seed = async (state) => {
      await createTable();
      if (state !== undefined) await pool.query("insert into k_nex_release_revision values ($1, $2, $3, $4)", [applicationId, state.predecessorRevision, state.revision, state.identity]);
    };
    const seedLedger = async (names) => {
      await pool.query("drop table if exists payload_migrations");
      await pool.query("create table payload_migrations (id serial primary key, name text not null, batch integer not null default 1)");
      if (names.length > 0) await pool.query("insert into payload_migrations(name) select * from unnest($1::text[])", [names]);
    };
    const row = async () => (await pool.query(
      "select predecessor_revision, revision, release_revision from k_nex_release_revision where application_id = $1", [applicationId]
    )).rows;
    const canonicalRow = [{ predecessor_revision: complete.predecessorRevision, revision: complete.revision, release_revision: complete.identity }];
    const declaredLedger = registry.slice(0, -1);

    // Fresh installation: admitted while installing, completed once the exact
    // declared set is applied, and identical to the upgraded record.
    await seed(installing);
    await seedLedger(declaredLedger);
    await pool.query(preflight);
    await pool.query(completion);
    assert.deepEqual(await row(), canonicalRow, "A completed fresh installation must record the canonical release.");
    await pool.query(preflight);
    await pool.query(completion);
    assert.deepEqual(await row(), canonicalRow, "Replaying either step on a completed release must change nothing.");
    assert.deepEqual(await assertMigrationReadiness({ pool, applicationId, artifactRevision: complete.revision, releaseRevision: complete.identity }),
      { applicationId, predecessorRevision: complete.predecessorRevision, revision: complete.revision, releaseRevision: complete.identity });

    // Upgraded database: the coordinator's step reaches the identical record.
    await seed(source);
    await seedLedger(declaredLedger);
    await assert.rejects(pool.query(preflight), /must be transitioned by the upgrade coordinator/u,
      "The application migration command must refuse to perform a release transition.");
    await pool.query(completion);
    assert.deepEqual(await row(), canonicalRow, "An upgraded database must record exactly the same release as a fresh installation.");

    // The identity is a completion receipt: no declared set, no identity.
    for (const [name, ledger] of [
      ["no target migrations", []],
      ["partial chain", declaredLedger.slice(0, 9)],
      ["missing step", declaredLedger.filter((entry) => entry !== "20260908_000034_reports")],
      ["substituted step", declaredLedger.map((entry) => entry === "20260908_000034_reports" ? "20260908_000034_substituted" : entry)],
      ["reordered chain", [declaredLedger[1], declaredLedger[0], ...declaredLedger.slice(2)]],
      ["unknown extra step", [...declaredLedger, "20260909_999999_unknown"]]
    ]) {
      await seed(installing);
      await seedLedger(ledger);
      const before = await row();
      await assert.rejects(pool.query(completion), /not the exact set this release declares/u, `A ${name} ledger recorded the release identity.`);
      assert.deepEqual(await row(), before, `A refused ${name} ledger must leave the release record unchanged.`);
    }

    // Every other recorded state is refused by both steps, including states
    // that merely count as a newer revision.
    await seedLedger(declaredLedger);
    for (const [name, state] of [
      ["zero revision, wrong identity", { predecessorRevision: 0, revision: 0, identity: "platform-0.9.0-installing" }],
      ["predecessor with impossible chain field", { predecessorRevision: 99, revision: 1, identity: "platform-1.0.0-bootstrap" }],
      ["target revision, corrupt identity", { predecessorRevision: 0, revision: complete.revision, identity: "corrupt" }],
      ["target revision, lineage chain field", { predecessorRevision: 1, revision: complete.revision, identity: complete.identity }],
      ["future revision, unknown identity", { predecessorRevision: 0, revision: 999, identity: "platform-9.9.9-release" }],
      ["missing row", undefined]
    ]) {
      await seed(state);
      const before = await row();
      await assert.rejects(pool.query(preflight), /does not record a release state this application can run/u, `The preflight admitted a ${name} database.`);
      await assert.rejects(pool.query(completion), /does not carry this installation or the exact predecessor release/u, `The completion step recorded a ${name} database.`);
      assert.deepEqual(await row(), before, `A refused ${name} database must be left exactly as it was.`);
    }

    // A missing release table at this registry position is tampering, not a
    // fresh install: the bootstrap that creates it has already run.
    await pool.query("drop table if exists k_nex_release_revision");
    await assert.rejects(pool.query(preflight), /has no release record/u, "A missing release table was treated as a fresh install.");

    // The next release accepts both 1.1 histories as one predecessor.
    const nextSource = platformReleaseState("1.1.0");
    for (const [name, history] of [["fresh", canonicalRow[0]], ["upgraded", canonicalRow[0]]]) {
      assert.deepEqual({ predecessorRevision: history.predecessor_revision, revision: history.revision, identity: history.release_revision }, nextSource,
        `A ${name} 1.1 database must present the canonical predecessor tuple to the next release.`);
    }
  } finally {
    await pool.end();
    await container.stop();
  }
});
