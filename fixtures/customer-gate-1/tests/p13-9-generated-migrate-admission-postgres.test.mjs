import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import pg from "pg";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

/**
 * Several declared migrations are wrappers whose SQL lives in package code, so
 * a release manifest that names the expected archives is not evidence that the
 * modules the migration process will import are those bytes. Readiness checks
 * the packed closure, but readiness runs after `knex:migrate`, and a not-ready
 * result cannot undo a forward-only migration.
 *
 * This proves the generated command refuses that drift before Payload selects
 * a single pending migration, against a real installed application and a real
 * empty database: no schema, no data, no ledger, no release row.
 */
test("P13.9 generated migrate command refuses drifted package bytes before the first migration statement", { timeout: 900_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ application, connectionString, environment: applicationEnvironment }) => {
    const admissionDatabase = "p13_9_migrate_admission";
    const administrator = new pg.Pool({ connectionString });
    const target = new URL(connectionString);
    target.pathname = `/${admissionDatabase}`;
    // The application's own environment, pointed at an empty database: the
    // proof measures the migrate command, not a missing configuration.
    const environment = { ...applicationEnvironment, DATABASE_URL: target.toString() };
    const migrate = () => execFileSync("pnpm", ["knex:migrate"], { cwd: application, env: environment, encoding: "utf8", timeout: 240_000, stdio: "pipe" });

    // A package-owned implementation a declared wrapper executes from. The
    // entry is unlinked before it is rewritten so the installed copy drifts
    // without touching the bytes any other application shares.
    const drifted = resolve(application, "node_modules/@k-nex/payload-adapter/dist/index.js");
    const original = readFileSync(drifted);
    let pool;
    try {
      await administrator.query(`drop database if exists ${admissionDatabase}`);
      await administrator.query(`create database ${admissionDatabase}`);
      pool = new pg.Pool({ connectionString: target.toString() });
      const relations = async () => (await pool.query(
        "select count(*)::int as count from information_schema.tables where table_schema = 'public'"
      )).rows[0].count;
      assert.equal(await relations(), 0, "The admission proof must start from an empty database.");

      rmSync(drifted);
      writeFileSync(drifted, Buffer.concat([original, Buffer.from("\nexport const p139Drift = true;\n")]));
      let refusal;
      try {
        migrate();
      } catch (error) {
        refusal = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      }
      assert.ok(refusal, "The generated migrate command ran a drifted package closure.");
      assert.match(refusal, /does not carry the dist\/index\.js its released archive declares/u,
        `The refusal must name the package byte drift it found.\n${refusal}`);
      assert.equal(await relations(), 0, "A refused migration must leave the database with no schema at all.");

      // Restored bytes are admitted, so the refusal is the drift and not the
      // command refusing everything.
      rmSync(drifted);
      writeFileSync(drifted, original);
      const admitted = migrate();
      assert.match(admitted, /K_NEX_MIGRATE_ADMITTED sha256:[0-9a-f]{64} 17/u, "The generated command must report the executable closure it admitted.");
      assert.ok(await relations() > 0, "An admitted migration must create the application schema.");
      const receipt = (await pool.query("select revision, release_revision, migration_set_digest, release_closure from k_nex_release_revision")).rows;
      assert.equal(receipt.length, 1);
      assert.equal(receipt[0].release_revision, "platform-1.1.0-release", "An admitted migration must record the canonical release.");
      assert.match(receipt[0].migration_set_digest, /^[0-9a-f]{64}$/u, "The receipt must record the migration closure.");
      assert.match(receipt[0].release_closure, /^sha256:[0-9a-f]{64}$/u, "The receipt must record the executable closure it ran inside.");
      assert.ok(admitted.includes(receipt[0].release_closure), "The recorded executable closure must be the one the command admitted.");
    } finally {
      rmSync(drifted, { force: true });
      writeFileSync(drifted, original);
      if (pool !== undefined) await pool.end();
      await administrator.query(`drop database if exists ${admissionDatabase}`).catch(() => undefined);
      await administrator.end();
    }
  });
});
