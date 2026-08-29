import type { Payload } from "payload";

export const applicationMigrationRevision = Object.freeze({
  migrationName: "20260829_000011_static_deployment",
  predecessor: 10,
  current: 11
});

export class MigrationRevisionError extends Error {
  readonly code: "MISSING_REVISION" | "INCOMPATIBLE_REVISION";

  constructor(code: MigrationRevisionError["code"], message: string) {
    super(message);
    this.name = "MigrationRevisionError";
    this.code = code;
  }
}

export async function assertApplicationMigrationRevision(payload: Payload): Promise<void> {
  let rows: Array<{ predecessor_revision: number; revision: number }>;
  try {
    const result = await payload.db.pool.query<{ predecessor_revision: number; revision: number }>(
      "select predecessor_revision, revision from k_nex_migration_revision where id = 1"
    );
    rows = result.rows;
  } catch {
    throw new MigrationRevisionError("MISSING_REVISION", "The application migration revision is unavailable.");
  }
  const revision = rows[0];
  if (
    rows.length !== 1 ||
    revision?.predecessor_revision !== applicationMigrationRevision.predecessor ||
    revision.revision !== applicationMigrationRevision.current
  ) {
    throw new MigrationRevisionError("INCOMPATIBLE_REVISION", "The application migration revision is incompatible.");
  }
}
