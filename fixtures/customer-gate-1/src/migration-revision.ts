import type { Payload } from "payload";

export const gate1MigrationRevision = Object.freeze({
  migrationName: "20260826_000001_gate1",
  predecessor: 0,
  current: 1
});

export class MigrationRevisionError extends Error {
  readonly code: "MISSING_REVISION" | "INCOMPATIBLE_REVISION";

  constructor(code: MigrationRevisionError["code"], message: string) {
    super(message);
    this.name = "MigrationRevisionError";
    this.code = code;
  }
}

export async function assertGate1MigrationRevision(payload: Payload): Promise<void> {
  let rows: Array<{ predecessor_revision: number; revision: number }>;
  try {
    const result = await payload.db.pool.query<{ predecessor_revision: number; revision: number }>(
      "select predecessor_revision, revision from k_nex_migration_revision where id = 1"
    );
    rows = result.rows;
  } catch {
    throw new MigrationRevisionError("MISSING_REVISION", "The Gate 1 migration revision is unavailable.");
  }
  const revision = rows[0];
  if (
    rows.length !== 1 ||
    revision?.predecessor_revision !== gate1MigrationRevision.predecessor ||
    revision.revision !== gate1MigrationRevision.current
  ) {
    throw new MigrationRevisionError("INCOMPATIBLE_REVISION", "The Gate 1 migration revision is incompatible.");
  }
}
