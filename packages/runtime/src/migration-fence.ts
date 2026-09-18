export type MigrationFenceErrorCode =
  | "INVALID_INPUT" | "LOCK_UNAVAILABLE" | "REVISION_MISMATCH" | "STALE_ARTIFACT" | "RELEASE_MISMATCH"
  | "MIGRATION_SET_MISMATCH" | "LEDGER_MISMATCH";

export class MigrationFenceError extends Error {
  constructor(readonly code: MigrationFenceErrorCode, message: string) {
    super(message);
    this.name = "MigrationFenceError";
  }
}

export interface MigrationQueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount?: number | null;
}

export interface MigrationSession {
  query<T extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<MigrationQueryResult<T>>;
  release(): void;
}

export interface MigrationPool {
  connect(): Promise<MigrationSession>;
  query<T extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<MigrationQueryResult<T>>;
}

export interface MigrationRevisionReceipt {
  readonly applicationId: string;
  readonly predecessorRevision: number;
  readonly revision: number;
  readonly releaseRevision: string;
}

function fail(code: MigrationFenceErrorCode, message: string): never {
  throw new MigrationFenceError(code, message);
}

function hash32(value: string, seed: number): number {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

export function deriveMigrationLockKey(applicationId: string, databaseIdentity: string): readonly [number, number] {
  if (!/^[a-z][a-z0-9.-]{2,127}$/u.test(applicationId) || !/^\d+$/u.test(databaseIdentity)) {
    fail("INVALID_INPUT", "Migration application and database identities are invalid.");
  }
  const identity = `${applicationId}\u0000${databaseIdentity}`;
  return Object.freeze([hash32(identity, 0x811c9dc5), hash32(identity, 0x6d2b79f5)]);
}

/**
 * This primitive advances a lineage: it records the revision it came from, so a
 * later job can prove it started where the previous one stopped. A platform
 * release is not a lineage - it is one exact terminal state that a fresh
 * installation and an upgrade must both reach - so a release receipt written
 * this way would carry the installation history that the release model
 * deliberately drops. Plugin migrations keep this primitive; the platform
 * release transition is refused here rather than silently issuing a receipt
 * that no readiness check would accept.
 */
export const platformReleaseReceiptPattern = /^platform-/u;

function validateJob(input: {
  readonly applicationId: string;
  readonly expectedPredecessorRevision: number;
  readonly targetRevision: number;
  readonly releaseRevision: string;
}): void {
  if (!/^[a-z][a-z0-9.-]{2,127}$/u.test(input.applicationId)) fail("INVALID_INPUT", "Migration application identity is invalid.");
  if (!Number.isSafeInteger(input.expectedPredecessorRevision) || input.expectedPredecessorRevision < 0 ||
    input.targetRevision !== input.expectedPredecessorRevision + 1 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:+/-]{0,127}$/u.test(input.releaseRevision)) {
    fail("INVALID_INPUT", "Migration predecessor, target, or release revision is invalid.");
  }
  if (platformReleaseReceiptPattern.test(input.releaseRevision)) {
    fail("INVALID_INPUT", "Platform release receipts are written by the release transition itself, which records one terminal release state rather than this primitive's migration lineage.");
  }
}

export async function executeMigrationJob(input: {
  readonly pool: MigrationPool;
  readonly applicationId: string;
  readonly expectedPredecessorRevision: number;
  readonly targetRevision: number;
  readonly releaseRevision: string;
  migrate(session: MigrationSession): Promise<void>;
}): Promise<MigrationRevisionReceipt> {
  validateJob(input);
  const session = await input.pool.connect();
  let lockKeyA = 0;
  let lockKeyB = 0;
  let locked = false;
  let transaction = false;
  try {
    const database = await session.query<{ database_id: string }>(
      "select oid::text as database_id from pg_database where datname = current_database()"
    );
    if (database.rows.length !== 1 || database.rows[0] === undefined) {
      fail("INVALID_INPUT", "Connected PostgreSQL database identity is unavailable.");
    }
    [lockKeyA, lockKeyB] = deriveMigrationLockKey(input.applicationId, database.rows[0].database_id);
    const lock = await session.query<{ locked: boolean }>("select pg_try_advisory_lock($1, $2) as locked", [lockKeyA, lockKeyB]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) fail("LOCK_UNAVAILABLE", "Another migration owns the application/database advisory lock.");

    await session.query("begin");
    transaction = true;
    const current = await session.query<{ revision: number }>(
      "select revision from k_nex_release_revision where application_id = $1 for update",
      [input.applicationId]
    );
    if (current.rows.length !== 1 || current.rows[0]?.revision !== input.expectedPredecessorRevision) {
      fail("REVISION_MISMATCH", "Database migration revision does not match the approved predecessor.");
    }
    await input.migrate(session);
    const updated = await session.query<{ application_id: string; predecessor_revision: number; revision: number; release_revision: string }>(
      `update k_nex_release_revision
       set predecessor_revision = revision, revision = $2, release_revision = $3
       where application_id = $1 and revision = $4
       returning application_id, predecessor_revision, revision, release_revision`,
      [input.applicationId, input.targetRevision, input.releaseRevision, input.expectedPredecessorRevision]
    );
    if (updated.rows.length !== 1) fail("REVISION_MISMATCH", "Database migration revision changed during migration.");
    await session.query("commit");
    transaction = false;
    const row = updated.rows[0]!;
    return Object.freeze({
      applicationId: row.application_id,
      predecessorRevision: row.predecessor_revision,
      revision: row.revision,
      releaseRevision: row.release_revision
    });
  } catch (error) {
    if (transaction) {
      try { await session.query("rollback"); } catch { /* the original migration error remains authoritative */ }
    }
    throw error;
  } finally {
    if (locked) {
      try { await session.query("select pg_advisory_unlock($1, $2)", [lockKeyA, lockKeyB]); } catch { /* session release drops the lock */ }
    }
    session.release();
  }
}

export interface PlatformReleaseReceipt extends MigrationRevisionReceipt {
  readonly migrationSetDigest: string;
  readonly releaseClosure: string | null;
  readonly appliedMigrations: readonly string[];
}

/**
 * A release receipt is only evidence for as long as the database still matches
 * the evidence. The recorded tuple says which release this database reached,
 * the recorded closure digest says which migration and registry bytes brought
 * it there, the recorded release manifest identifies the package archives those
 * migrations executed from, and the applied ledger says that set is still the
 * set the database carries. Checking the tuple alone would make the receipt
 * true only at the instant it was written: a ledger row deleted, reordered,
 * renamed, or added afterwards - by a partial restore as easily as by tampering
 * - would leave a database that no longer is what the receipt claims, and it
 * would still be served.
 *
 * All four are read in one statement. Two statements would let a concurrent
 * restore or migration land between the release row and the ledger and produce
 * a pair that was never true together.
 */
export async function assertPlatformReleaseReadiness(input: {
  readonly pool: Pick<MigrationPool, "query">;
  readonly applicationId: string;
  readonly predecessorRevision: number;
  readonly revision: number;
  readonly releaseRevision: string;
  readonly migrationSetDigest: string;
  readonly releaseClosure: string | null;
  readonly declaredMigrations: readonly string[];
}): Promise<PlatformReleaseReceipt> {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !Number.isSafeInteger(input.predecessorRevision) || input.predecessorRevision < 0) {
    fail("INVALID_INPUT", "Platform release revision is invalid.");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.migrationSetDigest)) fail("INVALID_INPUT", "Platform migration closure digest is invalid.");
  if (input.releaseClosure !== null && !/^sha256:[0-9a-f]{64}$/u.test(input.releaseClosure)) fail("INVALID_INPUT", "Platform release closure identity is invalid.");
  if (input.declaredMigrations.length === 0) fail("INVALID_INPUT", "Platform migration set is empty.");
  // to_jsonb keeps this readable against a database whose release table has not
  // yet been extended with the receipt columns: an installing or predecessor
  // database answers NULL here and is refused below, instead of failing with an
  // undefined-column error that says nothing about the release state.
  const result = await input.pool.query<{
    application_id: string; predecessor_revision: number; revision: number; release_revision: string;
    migration_set_digest: string | null; release_closure: string | null; applied: readonly string[] | null;
  }>(
    `select r.application_id, r.predecessor_revision, r.revision, r.release_revision,
            to_jsonb(r) ->> 'migration_set_digest' as migration_set_digest,
            to_jsonb(r) ->> 'release_closure' as release_closure,
            (select array_agg(l.name order by l.id) from payload_migrations l) as applied
     from k_nex_release_revision r where r.application_id = $1`,
    [input.applicationId]
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) fail("REVISION_MISMATCH", "Application migration revision is unavailable.");
  if (row.revision > input.revision) fail("STALE_ARTIFACT", "Artifact is older than the database migration revision.");
  if (row.revision !== input.revision || row.predecessor_revision !== input.predecessorRevision) {
    fail("REVISION_MISMATCH", "Database does not carry the exact release state this artifact was built for.");
  }
  if (row.release_revision !== input.releaseRevision) fail("RELEASE_MISMATCH", "Artifact release revision does not match the migrated database.");
  if (row.migration_set_digest !== input.migrationSetDigest) {
    fail("MIGRATION_SET_MISMATCH", "Database release receipt was written by a different migration closure than this artifact declares.");
  }
  if (row.release_closure !== input.releaseClosure) {
    fail("RELEASE_MISMATCH", "Database release receipt was written against a different package release closure than this artifact carries.");
  }
  const applied = row.applied ?? [];
  if (applied.length !== input.declaredMigrations.length || applied.some((name, index) => name !== input.declaredMigrations[index])) {
    fail("LEDGER_MISMATCH", "Applied migration ledger is not the exact set this release declares.");
  }
  return Object.freeze({
    applicationId: row.application_id, predecessorRevision: row.predecessor_revision, revision: row.revision,
    releaseRevision: row.release_revision, migrationSetDigest: input.migrationSetDigest, releaseClosure: input.releaseClosure,
    appliedMigrations: Object.freeze([...applied])
  });
}

export async function assertMigrationReadiness(input: {
  readonly pool: Pick<MigrationPool, "query">;
  readonly applicationId: string;
  readonly artifactRevision: number;
  readonly releaseRevision: string;
}): Promise<MigrationRevisionReceipt> {
  if (!Number.isSafeInteger(input.artifactRevision) || input.artifactRevision < 0) fail("INVALID_INPUT", "Artifact revision is invalid.");
  const result = await input.pool.query<{ application_id: string; predecessor_revision: number; revision: number; release_revision: string }>(
    `select application_id, predecessor_revision, revision, release_revision
     from k_nex_release_revision where application_id = $1`,
    [input.applicationId]
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) fail("REVISION_MISMATCH", "Application migration revision is unavailable.");
  if (row.revision > input.artifactRevision) fail("STALE_ARTIFACT", "Artifact is older than the database migration revision.");
  if (row.revision !== input.artifactRevision) fail("REVISION_MISMATCH", "Artifact and database migration revisions are incompatible.");
  if (row.release_revision !== input.releaseRevision) fail("RELEASE_MISMATCH", "Artifact release revision does not match the migrated database.");
  return Object.freeze({ applicationId: row.application_id, predecessorRevision: row.predecessor_revision, revision: row.revision, releaseRevision: row.release_revision });
}
