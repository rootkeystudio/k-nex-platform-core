import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import pg from "pg";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

/**
 * The boundary this proof is written against, stated before its assertions are
 * read. The deployment filesystem and the launcher an operator runs are the
 * trusted authority. `k-nex-migrate.mjs`, the `knex:migrate` command and the
 * installed `@k-nex/runtime` all live inside the tree they measure, so replacing
 * one of them replaces the authority rather than defeating a proof. Those three
 * are proved here for what is true of them: the migration runs, and the database
 * it produces is then refused by the genuine application, because the closure
 * the receipt records names the substituted authority.
 *
 * A released package has a packed archive this release declares by integrity, so
 * drift in one is denied outright - before Payload selects a migration and
 * before the migration process connects - whether the application links it
 * directly or a released dependency resolves it. Bytes changed after the
 * launcher's preflight are denied by the first declared step's own admission,
 * inside its transaction, with an empty ledger: `payload migrate` executes the
 * migration files rather than the registry beside them, so that admission is
 * written into the step and proved here by running the two halves of the
 * launcher's handover in order.
 *
 * The third-party executable the launcher spawns - the shim, payload, its
 * loader, the Postgres adapter - has no archive here and nothing in the
 * deployment declares its bytes, so a first migration cannot deny drift in it:
 * there is nothing yet to compare against. It is measured, recorded by the
 * completion receipt, and re-proved against that recording afterwards, so drift
 * is denied from the next boot onwards. That asymmetry is proved below rather
 * than papered over.
 */
test("P13.9 generated migrate command proves the code it runs, and names what it cannot prove", { timeout: 2_700_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ application, connectionString, environment: applicationEnvironment }) => {
    const administrator = new pg.Pool({ connectionString });
    const applicationRequire = createRequire(resolve(application, "package.json"));
    // Loaded before anything is substituted, so this process keeps playing the
    // genuine application while the installed copy is being tampered with.
    const runtime = await import(pathToFileURL(applicationRequire.resolve("@k-nex/runtime")).href);
    const composition = await import(pathToFileURL(applicationRequire.resolve("@k-nex/composition")).href);
    const applicationId = "p13-crm-browser";
    const theme = "minimal";
    const releaseState = composition.platformReleaseState("1.1.0");
    const releaseIdentity = composition.platformReleaseIdentity("1.1.0");

    const databases = new Map();
    const open = async (name) => {
      const existing = databases.get(name);
      if (existing !== undefined) { await existing.end(); databases.delete(name); }
      await administrator.query(`drop database if exists ${name}`);
      await administrator.query(`create database ${name}`);
      const target = new URL(connectionString);
      target.pathname = `/${name}`;
      const pool = new pg.Pool({ connectionString: target.toString() });
      databases.set(name, pool);
      // The application's own environment, pointed at an empty database: the
      // proof measures the migrate command, not a missing configuration.
      return { pool, environment: { ...applicationEnvironment, DATABASE_URL: target.toString() } };
    };
    const effect = async (pool) => {
      const tables = (await pool.query("select table_name from information_schema.tables where table_schema='public' order by table_name")).rows.map((row) => row.table_name);
      return {
        tables,
        ledger: tables.includes("payload_migrations") ? (await pool.query("select count(*)::int as count from payload_migrations")).rows[0].count : null,
        release: tables.includes("k_nex_release_revision") ? (await pool.query("select count(*)::int as count from k_nex_release_revision")).rows[0].count : null
      };
    };
    const migrate = (environment) => execFileSync("pnpm", ["knex:migrate"], { cwd: application, env: environment, encoding: "utf8", timeout: 900_000, stdio: "pipe" });
    const refusal = (environment) => {
      try {
        migrate(environment);
      } catch (error) {
        return `${error.stdout ?? ""}${error.stderr ?? ""}`;
      }
      return undefined;
    };

    // pnpm hardlinks installed files from its content-addressable store, so
    // every file is unlinked before it is rewritten: writing in place would
    // drift every other application on this machine that shares those bytes.
    const originals = new Map();
    const substitute = (path, next) => {
      if (!originals.has(path)) originals.set(path, { bytes: readFileSync(path), mode: statSync(path).mode });
      rmSync(path);
      writeFileSync(path, next);
      chmodSync(path, originals.get(path).mode);
    };
    const append = (path, marker) => substitute(path, Buffer.concat([readFileSync(path), Buffer.from(`\n${marker}\n`)]));
    const restore = () => {
      for (const [path, original] of originals) {
        rmSync(path, { force: true });
        writeFileSync(path, original.bytes);
        chmodSync(path, original.mode);
      }
      originals.clear();
    };

    const installed = (name) => realpathSync(resolve(application, "node_modules", name));
    const shim = resolve(application, "node_modules/.bin/payload");
    const launcher = resolve(application, "k-nex-migrate.mjs");
    const applicationManifest = resolve(application, "package.json");
    const loader = resolve(application, "k-nex-p139-loader.cjs");
    const verifier = join(installed("@k-nex/runtime"), "dist/generated-executable-closure.js");
    const releasedImplementation = join(installed("@k-nex/payload-adapter"), "dist/index.js");

    // The copy @k-nex/runtime's own imports resolve through, which the
    // application's top-level link says nothing about.
    const runtimeStore = readdirSync(resolve(application, "node_modules/.pnpm")).find((entry) => entry.startsWith("@k-nex+runtime@"));
    assert.ok(runtimeStore, "The generated application must install @k-nex/runtime through the pnpm store.");
    const nested = resolve(application, "node_modules/.pnpm", runtimeStore, "node_modules/@k-nex/contracts");
    assert.ok(lstatSync(nested).isSymbolicLink(), "@k-nex/runtime must resolve @k-nex/contracts through its own store link.");
    const nestedTarget = realpathSync(nested);

    const closure = () => runtime.assertGeneratedExecutableClosure({ root: application, theme });
    const readiness = async (pool) => {
      const proved = closure();
      try {
        await runtime.assertPlatformReleaseReadiness({
          pool, applicationId, predecessorRevision: releaseState.predecessorRevision, revision: releaseState.revision,
          releaseRevision: releaseIdentity, migrationSetDigest: proved.migration.digest, releaseClosure: proved.digest,
          declaredMigrations: proved.migration.migrations
        });
      } catch (error) {
        return error;
      }
      return undefined;
    };

    try {
      const denied = await open("p13_9_migrate_denied");
      assert.deepEqual(await effect(denied.pool), { tables: [], ledger: null, release: null },
        "The admission proof must start from an empty database.");

      writeFileSync(loader, "globalThis.p139Loaded = true;\n");
      const below = [
        {
          name: "a released package implementation that drifted after install",
          apply: () => append(releasedImplementation, "export const p139Drift = true;"),
          expect: /does not carry the dist\/index\.js its released archive declares/u
        },
        {
          name: "a clean top-level package beside a drifted copy a released dependency resolves",
          apply: () => {
            rmSync(nested);
            cpSync(nestedTarget, nested, { recursive: true, dereference: true });
            const source = join(nested, "dist/index.js");
            rmSync(source);
            writeFileSync(source, Buffer.concat([readFileSync(join(nestedTarget, "dist/index.js")), Buffer.from("\nexport const p139Nested = true;\n")]));
          },
          revert: () => {
            rmSync(nested, { recursive: true, force: true });
            symlinkSync(nestedTarget, nested, "dir");
          },
          expect: /@k-nex\/contracts is installed more than once/u
        },
        {
          name: "a process handed loader authority",
          apply: () => undefined,
          environment: { NODE_OPTIONS: `--require ${loader}` },
          expect: /NODE_OPTIONS is set, and it runs code before this proof does/u
        }
      ];

      for (const attack of below) {
        attack.apply();
        try {
          const output = refusal({ ...denied.environment, ...attack.environment });
          assert.ok(output, `${attack.name} was admitted and migrated.`);
          assert.match(output, attack.expect, `${attack.name} must be named by the refusal.\n${output}`);
          assert.doesNotMatch(output, /K_NEX_MIGRATE_ADMITTED/u, `${attack.name} reached the migration process.`);
          assert.deepEqual(await effect(denied.pool), { tables: [], ledger: null, release: null },
            `${attack.name} must leave the database with no schema at all.`);
        } finally {
          if (attack.revert === undefined) restore();
          else attack.revert();
        }
      }
      rmSync(loader);

      // Bytes changed after the launcher proved them and before the process it
      // spawned reads them. The launcher's handover is two processes, so the two
      // halves are driven here rather than raced: the closure is proved exactly
      // as the launcher proves it, the bytes then change, and the child the
      // launcher would have spawned is started against the same installation.
      // The first declared step re-proves the closure inside its own
      // transaction, so the window the handover opens closes there.
      const raced = await open("p13_9_migrate_raced");
      assert.ok(closure().digest, "The launcher's preflight must hold before the bytes it proved are changed.");
      append(releasedImplementation, "export const p139Raced = true;");
      let output;
      let status = 0;
      try {
        output = execFileSync(shim, ["migrate"], { cwd: application, env: raced.environment, encoding: "utf8", timeout: 900_000, stdio: "pipe" });
      } catch (error) {
        output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
        status = error.status ?? 1;
      }
      restore();
      assert.notEqual(status, 0, `A closure that drifted after preflight was migrated anyway.\n${output}`);
      assert.match(output, /does not carry the dist\/index\.js its released archive declares/u,
        `The step admission must name the drift it found.\n${output}`);
      const racedEffect = await effect(raced.pool);
      assert.deepEqual(racedEffect.tables.filter((table) => table !== "payload_migrations"), [],
        `A refused step must leave no application schema: ${racedEffect.tables.join(", ")}`);
      assert.equal(racedEffect.ledger ?? 0, 0, "A refused step must record no applied migration.");
      assert.equal(racedEffect.release, null, "A refused step must leave no release record.");

      // The admitted run, so the refusals above are the drift and not the
      // command refusing everything.
      const admittedDatabase = await open("p13_9_migrate_admitted");
      const migrateStart = process.hrtime.bigint();
      const admitted = migrate(admittedDatabase.environment);
      const migrateMilliseconds = Number(process.hrtime.bigint() - migrateStart) / 1e6;
      assert.match(admitted, /K_NEX_MIGRATE_ADMITTED sha256:[0-9a-f]{64} sha256:[0-9a-f]{64} 17/u,
        "The generated command must report the executable closure and the recorded executable it admitted.");
      const receipt = (await admittedDatabase.pool.query("select revision, release_revision, migration_set_digest, release_closure from k_nex_release_revision")).rows;
      assert.equal(receipt.length, 1);
      assert.equal(receipt[0].release_revision, releaseIdentity, "An admitted migration must record the canonical release.");
      assert.match(receipt[0].migration_set_digest, /^[0-9a-f]{64}$/u, "The receipt must record the migration closure.");
      assert.match(receipt[0].release_closure, /^sha256:[0-9a-f]{64}$/u, "The receipt must record the executable closure it ran inside.");
      assert.ok(admitted.includes(receipt[0].release_closure), "The recorded executable closure must be the one the command admitted.");
      assert.equal(await readiness(admittedDatabase.pool), undefined, "A database this application migrated must be one it will serve.");

      // What proving the whole closure costs, which is the reason it is proved
      // on the first and last declared step rather than on all nineteen.
      const closureStart = process.hrtime.bigint();
      for (let attempt = 0; attempt < 3; attempt += 1) closure();
      process.stdout.write(`P13_9_CLOSURE_COST ${(Number(process.hrtime.bigint() - closureStart) / 3e6).toFixed(0)}ms migrate ${migrateMilliseconds.toFixed(0)}ms\n`);

      // The third-party executable, recorded rather than declared. Nothing in
      // the deployment says what these bytes should be before a receipt exists,
      // so the honest claim is the one proved here: once a database records the
      // closure it was migrated inside, drift in any of them is refused before
      // the application serves that database.
      const recorded = closure().recorded;
      for (const { name, path } of [
        { name: "the launcher shim the command spawns", path: shim },
        { name: "the payload implementation the shim executes", path: join(installed("payload"), "bin.js") },
        { name: "the Postgres adapter every migration writes through", path: join(installed("@payloadcms/db-postgres"), "dist/connect.js") },
        // Resolved where payload resolves it, which is not the application's
        // own top level: it is payload's dependency, not the application's.
        { name: "the loader payload registers before it loads its own command", path: join(realpathSync(join(installed("payload"), "../tsx")), "package.json") },
        { name: "the patch this application applies to its adapter", path: resolve(application, "patches/@payloadcms__db-postgres@3.88.0.patch") }
      ]) {
        append(path, "# substituted");
        try {
          assert.notEqual(closure().recorded, recorded, `Drift in ${name} was not measured at all.`);
          const refused = await readiness(admittedDatabase.pool);
          assert.ok(refused, `Drift in ${name} left a database this application would still serve.`);
          assert.equal(refused.code, "RELEASE_MISMATCH", `Drift in ${name}: ${refused.message}`);
        } finally {
          restore();
        }
      }
      assert.equal(await readiness(admittedDatabase.pool), undefined, "Restored bytes must be served again, so the refusals above are the drift.");

      // Above the trusted boundary: each of these substitutes the authority
      // itself, so each one migrates. What is provable is that the genuine
      // application then refuses the database it produced.
      const substituted = [
        {
          name: "a replaced launcher that never calls the verifier",
          apply: () => substitute(launcher, Buffer.from([
            "import { spawnSync } from \"node:child_process\";",
            "import { resolve } from \"node:path\";",
            "const migration = spawnSync(resolve(process.cwd(), \"node_modules/.bin/payload\"), [\"migrate\"], { cwd: process.cwd(), stdio: \"inherit\" });",
            "process.exit(migration.status ?? 1);",
            ""
          ].join("\n")))
        },
        {
          name: "a knex:migrate command rewritten to call Payload directly",
          apply: () => {
            const manifest = JSON.parse(readFileSync(applicationManifest, "utf8"));
            manifest.scripts["knex:migrate"] = "payload migrate";
            substitute(applicationManifest, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
          }
        },
        {
          name: "a runtime verifier replaced with one that accepts everything",
          apply: () => substitute(verifier, Buffer.from([
            "import { admitGeneratedReleaseStep, assertGeneratedMigrationClosure } from \"./generated-migration-closure.js\";",
            "export const executableBootstrapVariables = Object.freeze([]);",
            "export function assertGeneratedExecutableBootstrap() {}",
            "export function sanitizedExecutableEnvironment(environment = process.env) { return { ...environment }; }",
            "export function assertGeneratedExecutableClosure(input) {",
            "  return Object.freeze({ migration: assertGeneratedMigrationClosure(input?.root ?? process.cwd()), release: \"1.1.0\",",
            "    packages: [], recorded: `sha256:${\"0\".repeat(64)}`, digest: `sha256:${\"1\".repeat(64)}` });",
            "}",
            "export async function admitGeneratedReleaseExecutable(input) {",
            "  return admitGeneratedReleaseStep({ applicationId: input.applicationId, release: input.release, step: input.step,",
            "    root: input.root ?? process.cwd(), execute: input.execute });",
            "}",
            ""
          ].join("\n")))
        }
      ];

      for (const authority of substituted) {
        const database = await open("p13_9_migrate_substituted");
        authority.apply();
        let migrated;
        try {
          migrated = migrate(database.environment);
        } finally {
          restore();
        }
        assert.ok(migrated !== undefined, `${authority.name} was expected to migrate; this proof does not claim it is stopped.`);
        const row = (await database.pool.query("select release_closure from k_nex_release_revision")).rows;
        assert.equal(row.length, 1, `${authority.name} must still have completed the release it claims.`);
        assert.notEqual(row[0].release_closure, closure().digest,
          `${authority.name} recorded the closure a genuine application computes, so nothing would notice it.`);
        const refused = await readiness(database.pool);
        assert.ok(refused, `${authority.name} produced a database the genuine application would serve.`);
        assert.equal(refused.code, "RELEASE_MISMATCH", `${authority.name}: ${refused.message}`);
      }
    } finally {
      restore();
      rmSync(loader, { force: true });
      if (!lstatSync(nested).isSymbolicLink()) {
        rmSync(nested, { recursive: true, force: true });
        symlinkSync(nestedTarget, nested, "dir");
      }
      for (const [name, pool] of databases) {
        await pool.end();
        await administrator.query(`drop database if exists ${name}`).catch(() => undefined);
      }
      await administrator.end();
    }
  });
});
