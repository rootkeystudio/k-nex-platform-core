import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { assertMigrationReadiness, assertPlatformReleaseReadiness, executeMigrationJob } from "@k-nex/runtime";

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
 * A release is one exact database state, and the record that says so is only
 * evidence while the database still matches it. This proves that a fresh
 * installation and an upgraded database reach the identical record, that the
 * record is written only once the declared migration set is durably complete
 * and carries the digest of the exact migration bytes that produced it, that
 * every other recorded state - including one that merely counts as newer - is
 * refused without touching the database, and that a completed release keeps
 * being re-proved rather than trusted.
 */
const generatedReleaseSources = async () => {
  const { planCreateKnexApplication, platformInstallingState, platformReleaseState, platformTransitionSource } = await import("@k-nex/composition");
  const applicationId = "release-state-proof";
  const plan = planCreateKnexApplication({ applicationId, applicationName: "Release State Proof", theme: "minimal", database: "external", primaryCurrency: "USD" });
  const migrationSet = plan.files["src/release-migration-set.ts"];
  assert.ok(migrationSet, "The factory must emit the release migration set.");

  // The proofs run the generated code itself rather than a transcription of it:
  // a statement the test rebuilt by hand would prove the test, not the product.
  const bodyOf = (source, signature, label) => {
    const [, extracted] = new RegExp(`function ${signature} \\{([\\s\\S]+?)\\n\\}`, "u").exec(source) ?? [];
    assert.ok(extracted, `${label} must be generated.`);
    return extracted;
  };
  const rawStatement = (path, label) => {
    const source = plan.files[path];
    assert.ok(source, `The factory must emit ${label}.`);
    const [, statement] = /sql\.raw\(`([\s\S]+?)`\)\);/u.exec(source) ?? [];
    assert.ok(statement, `${label} must carry one raw statement.`);
    return statement;
  };
  const declaredSet = JSON.parse(/releaseMigrationSet = (\[[\s\S]+?\]) as const/u.exec(migrationSet)[1]);
  const declaredDigest = /releaseMigrationSetDigest = "([0-9a-f]{64})"/u.exec(migrationSet)?.[1];
  assert.ok(declaredDigest, "The generated release must declare one migration set digest.");
  const recordCreatedAt = Number(/recordCreatedAt = (\d+)/u.exec(migrationSet)[1]);
  const targetSetStartsAt = Number(/targetSetStartsAt = (\d+)/u.exec(migrationSet)[1]);
  const admission = new Function("releaseMigrationSet", "recordCreatedAt", "targetSetStartsAt", "step", "index",
    bodyOf(migrationSet, "admissionStatement\\(step: string, index: number\\): string", "The step admission"));
  const completion = new Function("releaseMigrationSetDigest",
    bodyOf(plan.files["src/migrations/20260909_000036_release_revision.ts"], "completionStatement\\(\\): string", "The completion statement"))(declaredDigest);
  const observedDigest = new Function("createHash", "readdirSync", "readFileSync", "join", "resolve", "releaseMigrationSet", "root",
    bodyOf(migrationSet, "observedMigrationSetDigest\\(root: string = process\\.cwd\\(\\)\\): string", "The observed migration set digest"));
  const integrity = new Function("verifiedDigest", "observedMigrationSetDigest", "releaseMigrationSetDigest", "root",
    bodyOf(migrationSet, "assertMigrationSetIntegrity\\(root\\?: string\\): string", "The migration set integrity check"));

  return {
    applicationId, plan, declaredSet, declaredDigest,
    installing: platformInstallingState("1.1.0"),
    complete: platformReleaseState("1.1.0"),
    source: platformTransitionSource("1.1.0"),
    canonicalPredecessorOf: platformReleaseState,
    preflight: rawStatement("src/migrations/20260905_000026_release_preflight.ts", "a release preflight migration"),
    completion,
    admissionFor: (step) => admission(declaredSet, recordCreatedAt, targetSetStartsAt, step, declaredSet.indexOf(step)),
    observedDigestOf: (root) => observedDigest(createHash, readdirSync, readFileSync, join, resolve, declaredSet, root),
    assertIntegrityOf: (root) => integrity(undefined, (at) => observedDigest(createHash, readdirSync, readFileSync, join, resolve, declaredSet, at), declaredDigest, root),
    migrationSetSource: migrationSet
  };
};

test("the release record is one canonical completion receipt for both installation histories", { timeout: 180_000 }, async () => {
  const release = await generatedReleaseSources();
  const { applicationId, plan, declaredSet, declaredDigest, installing, complete, source, preflight, completion } = release;
  const registry = [...plan.files["src/migrations/index.ts"].matchAll(/name: "([^"\n]+)"/gu)].map(([, name]) => name);

  // One canonical record, and it is not the installation state.
  assert.deepEqual(complete, { predecessorRevision: 0, revision: 2, identity: "platform-1.1.0-release" });
  assert.deepEqual(source, { predecessorRevision: 0, revision: 1, identity: "platform-1.0.0-bootstrap" });
  assert.notDeepEqual(installing, complete);
  assert.deepEqual(registry, declaredSet, "The generated registry and the declared migration set must be one list.");

  // The bootstrap may not claim the release it has not finished.
  const [, bootstrapRow] = /INSERT INTO "k_nex_release_revision" VALUES \(([^)]+)\)/u.exec(plan.files["src/migrations/20260827_000002_knex_bootstrap.ts"]) ?? [];
  assert.ok(bootstrapRow, "The bootstrap migration must insert one release row.");
  assert.match(bootstrapRow, new RegExp(`${installing.predecessorRevision}, ${installing.revision}, '${installing.identity}'`, "u"),
    "The bootstrap migration must record the installation, not the release.");
  assert.equal(registry.indexOf("20260909_000036_release_revision"), registry.length - 1, "The completion step must run last.");

  // Payload only ever runs migrations the registry hands it, so the admission
  // is bound there: every declared step, not only the release steps.
  for (const step of declaredSet) {
    assert.match(plan.files["src/migrations/index.ts"], new RegExp(`\\{ name: "${step}", up: admitted\\("${step}", `, "u"),
      `The generated registry must admit ${step} before it runs.`);
  }

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
      if (state !== undefined) {
        await pool.query("insert into k_nex_release_revision(application_id, predecessor_revision, revision, release_revision) values ($1, $2, $3, $4)",
          [applicationId, state.predecessorRevision, state.revision, state.identity]);
      }
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
    const readiness = () => assertPlatformReleaseReadiness({
      pool, applicationId, predecessorRevision: complete.predecessorRevision, revision: complete.revision,
      releaseRevision: complete.identity, migrationSetDigest: declaredDigest, declaredMigrations: registry
    });

    // Fresh installation: admitted while installing, completed once the exact
    // declared set is applied, and identical to the upgraded record.
    await seed(installing);
    await seedLedger(declaredLedger);
    await pool.query(preflight);
    await pool.query(completion);
    assert.deepEqual(await row(), canonicalRow, "A completed fresh installation must record the canonical release.");
    await seedLedger(registry);
    await pool.query(preflight);
    await pool.query(completion);
    assert.deepEqual(await row(), canonicalRow, "Replaying either step on a completed release must change nothing.");
    const receipt = await readiness();
    assert.deepEqual(receipt, {
      applicationId, predecessorRevision: complete.predecessorRevision, revision: complete.revision,
      releaseRevision: complete.identity, migrationSetDigest: declaredDigest, appliedMigrations: registry
    }, "A completed release must be readable as the exact migration evidence it was written from.");
    const freshRecord = (await row())[0];

    // Upgraded database: the coordinator's step reaches the identical record.
    await seed(source);
    await seedLedger(declaredLedger);
    await assert.rejects(pool.query(preflight), /must be transitioned by the upgrade coordinator/u,
      "The application migration command must refuse to perform a release transition.");
    await pool.query(completion);
    assert.deepEqual(await row(), canonicalRow, "An upgraded database must record exactly the same release as a fresh installation.");
    assert.deepEqual((await row())[0], freshRecord, "Both installation histories must end at one byte-identical record.");
    assert.equal((await pool.query("select migration_set_digest from k_nex_release_revision where application_id = $1", [applicationId])).rows[0].migration_set_digest,
      declaredDigest, "An upgraded database must record the migration set that completed it.");

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

    // Narrow claim: both 1.1 histories converge on one record, and a release
    // names its predecessor by exactly that canonical record. A three-release
    // proof needs a declared 1.2.0 and is deliberately not claimed here.
    assert.deepEqual(release.source, release.canonicalPredecessorOf("1.0.0"),
      "A release must name its predecessor by that predecessor's canonical record.");
    assert.deepEqual({ predecessorRevision: freshRecord.predecessor_revision, revision: freshRecord.revision, identity: freshRecord.release_revision }, complete,
      "The record both histories reach must be the canonical tuple a next release would name.");
  } finally {
    await pool.end();
    await container.stop();
  }
});

/**
 * A receipt that is only checked at the moment it is written turns the first
 * valid completion into a permanent exemption from the proof it stands for.
 * This proves the opposite for the two ways a completed release can stop being
 * true: its durable ledger drifting away from the declared set, and a migration
 * being changed under a name the ledger already carries. Both must refuse the
 * database, refuse every declared step before it can mutate anything, and leave
 * the recorded release exactly as it was.
 */
test("a completed release keeps proving its migration set or stops being served", { timeout: 180_000 }, async () => {
  const release = await generatedReleaseSources();
  const { applicationId, plan, declaredSet, declaredDigest, installing, complete, completion, migrationSetSource } = release;
  const substitutedStep = "20260908_000034_reports";

  // The byte check runs before the step's first statement, so a substituted
  // migration is refused in the process rather than by the database afterwards.
  assert.ok(migrationSetSource.indexOf("assertMigrationSetIntegrity();") < migrationSetSource.indexOf("await db.execute(sql.raw(admissionStatement(step, index)));"),
    "The generated admission must verify the migration bytes before it touches the database.");

  const root = mkdtempSync(join(tmpdir(), "k-nex-migration-set-"));
  try {
    for (const [path, source] of Object.entries(plan.files)) {
      if (!path.startsWith("src/migrations/")) continue;
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), source);
    }
    assert.equal(release.observedDigestOf(root), declaredDigest, "The generated sources must digest to the set the release declares.");
    assert.equal(release.assertIntegrityOf(root), declaredDigest, "An untouched migration set must be admitted.");

    const substitutedPath = join(root, "src/migrations", `${substitutedStep}.ts`);
    const original = readFileSync(substitutedPath, "utf8");
    writeFileSync(substitutedPath, original.replace("export async function up", "export async function up /* substituted */"));
    assert.notEqual(release.observedDigestOf(root), declaredDigest, "A migration changed under its own name must change the set digest.");
    assert.throws(() => release.assertIntegrityOf(root), /changed under a name this release already knows/u,
      "A same-name, different-byte migration was admitted.");
    writeFileSync(substitutedPath, original);
    assert.equal(release.assertIntegrityOf(root), declaredDigest, "Restoring the declared bytes must restore admission.");

    // An extra or missing file is the same claim from the other side: the set
    // is the exact list, not merely a superset of the names the ledger holds.
    writeFileSync(join(root, "src/migrations", "20260909_999999_extra.ts"), "export async function up(): Promise<void> {}\n");
    assert.throws(() => release.assertIntegrityOf(root), /is not the migration set this release declares/u,
      "An extra migration file was admitted into the declared set.");
    rmSync(join(root, "src/migrations", "20260909_999999_extra.ts"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("release_receipt").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    const seedLedger = async (names) => {
      await pool.query("drop table if exists payload_migrations");
      await pool.query("create table payload_migrations (id serial primary key, name text not null, batch integer not null default 1)");
      if (names.length > 0) await pool.query("insert into payload_migrations(name) select * from unnest($1::text[])", [names]);
    };
    const completeDatabase = async (ledger) => {
      await pool.query("drop table if exists k_nex_release_revision");
      await pool.query(`create table k_nex_release_revision (
        application_id varchar primary key not null, predecessor_revision integer not null,
        revision integer not null, release_revision varchar not null
      )`);
      await pool.query("insert into k_nex_release_revision(application_id, predecessor_revision, revision, release_revision) values ($1, $2, $3, $4)",
        [applicationId, installing.predecessorRevision, installing.revision, installing.identity]);
      await seedLedger(declaredSet.slice(0, -1));
      await pool.query(completion);
      await seedLedger(ledger);
    };
    const observedState = async () => ({
      release: (await pool.query("select predecessor_revision, revision, release_revision, migration_set_digest from k_nex_release_revision where application_id = $1", [applicationId])).rows,
      ledger: (await pool.query("select name from payload_migrations order by id")).rows.map(({ name }) => name),
      columns: (await pool.query("select table_name, column_name from information_schema.columns where table_schema = 'public' order by table_name, column_name")).rowCount
    });
    const readiness = (digest = declaredDigest) => assertPlatformReleaseReadiness({
      pool, applicationId, predecessorRevision: complete.predecessorRevision, revision: complete.revision,
      releaseRevision: complete.identity, migrationSetDigest: digest, declaredMigrations: declaredSet
    });

    await completeDatabase(declaredSet);
    assert.equal((await observedState()).release[0].migration_set_digest, declaredDigest, "A completed release must record the migration set that produced it.");
    await readiness();

    // A canonical release row whose durable ledger has drifted is refused - by
    // readiness, and by the completion step that would otherwise wave it
    // through as already applied.
    for (const [name, ledger] of [
      ["missing", declaredSet.filter((step) => step !== substitutedStep)],
      ["extra", [...declaredSet, "20260909_999999_unknown"]],
      ["reordered", [declaredSet[1], declaredSet[0], ...declaredSet.slice(2)]],
      ["substituted", declaredSet.map((step) => step === substitutedStep ? "20260908_000034_substituted" : step)]
    ]) {
      await completeDatabase(ledger);
      const before = await observedState();
      await assert.rejects(readiness(), { code: "LEDGER_MISMATCH" }, `A canonical release with a ${name} ledger row was served.`);
      await assert.rejects(pool.query(completion), /not the exact set this release declares/u,
        `The completion step accepted a canonical release with a ${name} ledger row as already applied.`);
      assert.deepEqual(await observedState(), before, `A refused ${name} ledger must leave schema, data, and ledger unchanged.`);
    }

    // The step admission refuses before the step runs, which is the only place
    // a refusal can still be free of consequences: Payload re-runs exactly the
    // declared steps a drifted ledger no longer records.
    await completeDatabase(declaredSet.filter((step) => step !== substitutedStep));
    const beforeGap = await observedState();
    await assert.rejects(pool.query(release.admissionFor(substitutedStep)),
      /the applied migration ledger is not the exact set this release applies before this step/u,
      "A pending step ran against a database whose ledger is not the set it was ordered against.");
    assert.deepEqual(await observedState(), beforeGap, "A refused pending step must leave schema, data, and ledger unchanged.");

    // A ledger restored to exactly the point before a step makes that step look
    // pending, and the release row is the only thing left that says otherwise.
    await completeDatabase(declaredSet.slice(0, declaredSet.indexOf(substitutedStep)));
    const beforeReplay = await observedState();
    await assert.rejects(pool.query(release.admissionFor(substitutedStep)),
      /this database already completed 1\.1\.0/u, "A declared step ran again against a completed release.");
    assert.deepEqual(await observedState(), beforeReplay, "A refused replay must leave schema, data, and ledger unchanged.");

    // The durable half of the byte binding: a receipt written for one migration
    // set does not describe an artifact that declares another.
    await assert.rejects(readiness(`${"0".repeat(63)}1`), { code: "MIGRATION_SET_MISMATCH" },
      "A release recorded for other migration bytes was served as this artifact.");
  } finally {
    await pool.end();
    await container.stop();
  }
});
