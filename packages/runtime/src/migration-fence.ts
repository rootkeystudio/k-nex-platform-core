export type MigrationFenceErrorCode =
  | "INVALID_INPUT" | "LOCK_UNAVAILABLE" | "REVISION_MISMATCH" | "STALE_ARTIFACT" | "RELEASE_MISMATCH";

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
  if (!/^[a-z][a-z0-9.-]{2,127}$/u.test(applicationId) || databaseIdentity.length < 1 || databaseIdentity.length > 512) {
    fail("INVALID_INPUT", "Migration application and database identities are invalid.");
  }
  const identity = `${applicationId}\u0000${databaseIdentity}`;
  return Object.freeze([hash32(identity, 0x811c9dc5), hash32(identity, 0x6d2b79f5)]);
}

function validateJob(input: {
  readonly applicationId: string;
  readonly databaseIdentity: string;
  readonly expectedPredecessorRevision: number;
  readonly targetRevision: number;
  readonly releaseRevision: string;
}): void {
  deriveMigrationLockKey(input.applicationId, input.databaseIdentity);
  if (!Number.isSafeInteger(input.expectedPredecessorRevision) || input.expectedPredecessorRevision < 0 ||
    input.targetRevision !== input.expectedPredecessorRevision + 1 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:+/-]{0,127}$/u.test(input.releaseRevision)) {
    fail("INVALID_INPUT", "Migration predecessor, target, or release revision is invalid.");
  }
}

export async function executeMigrationJob(input: {
  readonly pool: MigrationPool;
  readonly applicationId: string;
  readonly databaseIdentity: string;
  readonly expectedPredecessorRevision: number;
  readonly targetRevision: number;
  readonly releaseRevision: string;
  migrate(session: MigrationSession): Promise<void>;
}): Promise<MigrationRevisionReceipt> {
  validateJob(input);
  const session = await input.pool.connect();
  const [lockKeyA, lockKeyB] = deriveMigrationLockKey(input.applicationId, input.databaseIdentity);
  let locked = false;
  let transaction = false;
  try {
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
