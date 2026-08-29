import { canonicalJson, ExactSemverSchema } from "@k-nex/contracts";
import type { CatalogCheckpoint, CatalogCheckpointStore } from "@k-nex/extension-bundler";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export interface CatalogCheckpointOwner {
  readonly applicationId: string;
  readonly environment: string;
}

interface CatalogCheckpointRow {
  application_id: string;
  environment: string;
  signer_identity: string;
  sequence: string | number;
  payload_digest: string;
  highest_versions: unknown;
}

function assertOwner(owner: CatalogCheckpointOwner): void {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(owner.applicationId) || !/^[a-z][a-z0-9-]{2,63}$/u.test(owner.environment)) {
    throw new TypeError("Catalog checkpoint owner is invalid.");
  }
}

function checkpoint(row: CatalogCheckpointRow): CatalogCheckpoint {
  const sequence = Number(row.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !/^sha256:[0-9a-f]{64}$/u.test(row.payload_digest) ||
    !row.highest_versions || typeof row.highest_versions !== "object" || Array.isArray(row.highest_versions) ||
    !Object.entries(row.highest_versions).every(([key, version]) => key.length > 0 && ExactSemverSchema.safeParse(version).success)) {
    throw new Error("Persisted catalog checkpoint is invalid.");
  }
  return Object.freeze({ signerIdentity: row.signer_identity, sequence, payloadDigest: row.payload_digest as CatalogCheckpoint["payloadDigest"], highestVersions: Object.freeze({ ...(row.highest_versions as Record<string, string>) }) });
}

function same(left: CatalogCheckpoint | undefined, right: CatalogCheckpoint | undefined): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

export class PostgresCatalogCheckpointStore implements CatalogCheckpointStore {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly owner: CatalogCheckpointOwner) {
    assertOwner(owner);
  }

  async read(signerIdentity: string): Promise<CatalogCheckpoint | undefined> {
    const result = await this.pool.query<CatalogCheckpointRow>(
      `select application_id, environment, signer_identity, sequence, payload_digest, highest_versions
       from runtime_catalog_checkpoints where application_id=$1 and environment=$2 and signer_identity=$3`,
      [this.owner.applicationId, this.owner.environment, signerIdentity]
    );
    return result.rows[0] ? checkpoint(result.rows[0]) : undefined;
  }

  async compareAndSet(expected: CatalogCheckpoint | undefined, next: CatalogCheckpoint): Promise<boolean> {
    if (expected && expected.signerIdentity !== next.signerIdentity) throw new TypeError("Catalog checkpoint CAS requires one signer.");
    return this.transaction(async (session) => {
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([this.owner.applicationId, this.owner.environment, next.signerIdentity, "catalog-checkpoint"])]);
      const result = await session.query<CatalogCheckpointRow>(
        `select application_id, environment, signer_identity, sequence, payload_digest, highest_versions
         from runtime_catalog_checkpoints where application_id=$1 and environment=$2 and signer_identity=$3 for update`,
        [this.owner.applicationId, this.owner.environment, next.signerIdentity]
      );
      const actual = result.rows[0] ? checkpoint(result.rows[0]) : undefined;
      if (!same(actual, expected)) return false;
      await session.query(
        `insert into runtime_catalog_checkpoints (application_id, environment, signer_identity, sequence, payload_digest, highest_versions)
         values ($1,$2,$3,$4,$5,$6::jsonb)
         on conflict (application_id, environment, signer_identity) do update
           set sequence=excluded.sequence, payload_digest=excluded.payload_digest, highest_versions=excluded.highest_versions, updated_at=now()`,
        [this.owner.applicationId, this.owner.environment, next.signerIdentity, next.sequence, next.payloadDigest, canonicalJson(next.highestVersions)]
      );
      return true;
    });
  }

  private async transaction<T>(work: (session: RuntimeExtensionSession) => Promise<T>): Promise<T> {
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      const result = await work(session);
      await session.query("commit");
      return result;
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }
}
