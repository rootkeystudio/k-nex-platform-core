import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { platformInstallingState, platformReleaseState, platformTransitionSource } from "@k-nex/composition";

import { MigrationFenceError } from "./migration-fence.js";

/**
 * What a release migration actually executes is not the set of files named in
 * the ledger. It is the registry that decides which implementation runs under
 * each ledger name, the guard that admits each step, and the package archives
 * those implementations come from. A digest over leaf migration filenames
 * leaves all three free to change while every recorded name stays identical.
 *
 * This module is that closure, and it lives in the platform package rather than
 * in generated source on purpose: a guard emitted into the application it
 * guards can be edited together with the constant it checks, which is not an
 * authority at all. The value it computes is recorded in the database at
 * completion, so the durable receipt - not a file next to the migration - is
 * what a later boot is measured against.
 */
export const generatedMigrationClosurePath = ".k-nex/migration-closure.json";
const releaseManifestPath = ".k-nex/package-release-manifest.json";
const migrationDirectory = "src/migrations";
const registryFile = "index.ts";

/** The platform steps that create and gate the release record. */
const releaseRecordStep = "20260827_000002_knex_bootstrap";
const releasePreflightStep = "20260905_000026_release_preflight";

export interface GeneratedMigrationClosure {
  readonly migrations: readonly string[];
  readonly digest: string;
  readonly releaseManifestDigest: string | null;
}

function fail(message: string): never {
  throw new MigrationFenceError("MIGRATION_SET_MISMATCH", message);
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * The digest of everything that decides what this application's migrations do:
 * the verified release manifest that identifies the package archives, every
 * migration source, and the registry file that wires them together. It is
 * deliberately computed from the directory as it is, not from the declared
 * names, so an added or removed file is a different closure rather than an
 * unnoticed one.
 */
export function computeGeneratedMigrationClosure(root: string, migrations: readonly string[]): {
  readonly digest: string;
  readonly releaseManifestDigest: string | null;
} {
  if (migrations.length === 0) fail("A generated application declares no release migrations.");
  const directory = resolve(root, migrationDirectory);
  if (!existsSync(directory)) fail(`This application cannot prove its migration closure: ${migrationDirectory} is not present.`);
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    fail(`This application cannot prove its migration closure: ${migrationDirectory} holds an entry that is not a regular file.`);
  }
  const present = entries.map((entry) => entry.name).sort();
  const expected = [...migrations.map((name) => `${name}.ts`), registryFile].sort();
  if (!sameList(present, expected)) {
    fail(`This application cannot prove its migration closure: ${migrationDirectory} holds ${present.join(", ")}, which is not the set it declares.`);
  }
  const manifest = resolve(root, releaseManifestPath);
  const releaseManifestDigest = existsSync(manifest) ? `sha256:${sha256(readFileSync(manifest))}` : null;
  const digest = createHash("sha256");
  digest.update(`release-manifest ${releaseManifestDigest ?? "none"}\n`);
  for (const name of expected) digest.update(`${name} ${sha256(readFileSync(join(directory, name)))}\n`);
  return { digest: digest.digest("hex"), releaseManifestDigest };
}

/** The closure the generated application declares for itself. */
export function readGeneratedMigrationClosure(root: string): GeneratedMigrationClosure {
  const path = resolve(root, generatedMigrationClosurePath);
  if (!existsSync(path)) fail(`This application does not declare a migration closure at ${generatedMigrationClosurePath}.`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`This application's declared migration closure is not readable: ${(error as Error).message}`);
  }
  const declared = value as Partial<GeneratedMigrationClosure>;
  if (typeof declared !== "object" || declared === null || !Array.isArray(declared.migrations) ||
    declared.migrations.some((name) => typeof name !== "string" || !/^[0-9a-z_]+$/u.test(name)) ||
    typeof declared.digest !== "string" || !/^[0-9a-f]{64}$/u.test(declared.digest) ||
    !(declared.releaseManifestDigest === null || typeof declared.releaseManifestDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(declared.releaseManifestDigest))) {
    fail("This application's declared migration closure is not a release migration closure.");
  }
  return Object.freeze({
    migrations: Object.freeze([...declared.migrations]),
    digest: declared.digest,
    releaseManifestDigest: declared.releaseManifestDigest ?? null
  });
}

/**
 * Re-reads the closure every time it is asked. Caching the first success would
 * make "this step verified its own implementation" true only for whichever step
 * ran first in the process, which is the same false assurance as verifying
 * nothing after that point.
 */
export function assertGeneratedMigrationClosure(root: string = process.cwd()): GeneratedMigrationClosure {
  const declared = readGeneratedMigrationClosure(root);
  const observed = computeGeneratedMigrationClosure(root, declared.migrations);
  if (observed.releaseManifestDigest !== declared.releaseManifestDigest) {
    fail(`This application's package release manifest digests to ${observed.releaseManifestDigest ?? "none"}, and it declares ${declared.releaseManifestDigest ?? "none"}. The package archives these migrations execute from are not the ones this release was closed over.`);
  }
  if (observed.digest !== declared.digest) {
    fail(`This application's migration closure on disk digests to ${observed.digest}, and it declares ${declared.digest}. A migration or the registry that decides what runs under each name was changed under a name this release already knows.`);
  }
  return declared;
}

const tupleClause = (state: { readonly predecessorRevision: number; readonly revision: number; readonly identity: string }): string =>
  `("predecessor_revision" = ${state.predecessorRevision} AND "revision" = ${state.revision} AND "release_revision" = '${state.identity}')`;

/**
 * Payload executes only the migrations a database has not recorded, so a
 * database whose ledger lost, gained, or reordered a row has the steps that gap
 * implies re-executed against a schema that is already past them. Each step is
 * therefore admitted against the exact ledger prefix it was ordered against,
 * inside the step's own transaction and before its first statement, so a
 * refusal costs nothing.
 */
export function generatedReleaseStepStatement(input: {
  readonly applicationId: string;
  readonly release: string;
  readonly step: string;
  readonly migrations: readonly string[];
}): string {
  const index = input.migrations.indexOf(input.step);
  if (index < 0) fail(`Release ${input.release} refuses to run ${input.step}: it is not a migration this release declares.`);
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(input.applicationId)) fail("Release admission application identity is invalid.");
  const recordCreatedAt = input.migrations.indexOf(releaseRecordStep);
  const targetSetStartsAt = input.migrations.indexOf(releasePreflightStep);
  if (recordCreatedAt < 0 || targetSetStartsAt <= recordCreatedAt) fail(`Release ${input.release} declares no release admission steps.`);
  const installing = platformInstallingState(input.release);
  const complete = platformReleaseState(input.release);
  const predecessor = platformTransitionSource(input.release);
  const refusal = (reason: string) => `RAISE EXCEPTION 'Release ${input.release} refuses to run %: ${reason}', step;`;
  const ledger = `ARRAY[${input.migrations.slice(0, index).map((name) => `'${name}'`).join(",")}]::text[]`;
  return [
    "DO $$",
    `DECLARE applied text[]; state text; step text := '${input.step}';`,
    "BEGIN",
    `  PERFORM pg_advisory_xact_lock(hashtext('k-nex/release-revision/${input.applicationId}'));`,
    "  IF to_regclass('public.payload_migrations') IS NULL THEN",
    "    applied := ARRAY[]::text[];",
    "  ELSE",
    '    SELECT coalesce(array_agg("name" ORDER BY "id"), ARRAY[]::text[]) INTO applied FROM "payload_migrations";',
    "  END IF;",
    `  IF applied IS DISTINCT FROM ${ledger} THEN`,
    `    ${refusal("the applied migration ledger is not the exact set this release applies before this step, so this step would run against a database it was never ordered against")}`,
    "  END IF;",
    "  IF to_regclass('public.k_nex_release_revision') IS NULL THEN",
    index <= recordCreatedAt
      ? "    RETURN;"
      : `    ${refusal(`${input.applicationId} has no release record, and the bootstrap migration that creates it has already run`)}`,
    "  END IF;",
    "  SELECT CASE",
    `    WHEN ${tupleClause(installing)} THEN 'installing'`,
    `    WHEN ${tupleClause(complete)} THEN 'complete'`,
    ...(predecessor === undefined ? [] : [`    WHEN ${tupleClause(predecessor)} THEN 'predecessor'`]),
    "    ELSE 'unknown' END INTO state",
    `   FROM "k_nex_release_revision" WHERE "application_id" = '${input.applicationId}';`,
    "  IF state IS NULL OR state = 'unknown' THEN",
    `    ${refusal(`${input.applicationId} does not record a release state this release may migrate`)}`,
    "  END IF;",
    "  IF state = 'complete' THEN",
    `    ${refusal(`this database already completed ${input.release}, so re-running a declared step would change a database its release receipt already describes`)}`,
    "  END IF;",
    ...(predecessor === undefined || index >= targetSetStartsAt
      ? []
      : [`  IF state = 'predecessor' THEN ${refusal("a database carrying the predecessor release has already applied this step")} END IF;`]),
    "END $$;"
  ].join("\n");
}

/**
 * The one entry point a generated registry uses: prove the closure that decides
 * what this step is, then prove the database is one this step may still run
 * against. Both happen before the step's implementation is called.
 */
export async function admitGeneratedReleaseStep(input: {
  readonly applicationId: string;
  readonly release: string;
  readonly step: string;
  readonly root?: string;
  execute(statement: string): Promise<unknown>;
}): Promise<GeneratedMigrationClosure> {
  const closure = assertGeneratedMigrationClosure(input.root ?? process.cwd());
  await input.execute(generatedReleaseStepStatement({
    applicationId: input.applicationId, release: input.release, step: input.step, migrations: closure.migrations
  }));
  return closure;
}
