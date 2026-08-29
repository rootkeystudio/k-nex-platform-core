import { canonicalJson } from "@k-nex/contracts";
import { ExtensionCapabilityError, type ExtensionCapabilityClaims, type ExtensionCapabilityHandler, type ExtensionCapabilityId } from "@k-nex/runtime";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export interface AppStorageDocumentValidator {
  validate(schemaId: string, value: unknown): unknown;
}

export interface AppStorageSecretGuard {
  assertSafe(value: unknown): void;
}

export interface AppStorageNamespace {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly schemaId: string;
}

export interface AppStorageRecord {
  readonly key: string;
  readonly value: unknown;
  readonly revision: number;
  readonly bytes: number;
}

export interface AppStorageBackup {
  readonly schemaVersion: 1;
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly namespaces: readonly Readonly<{
    schemaId: string;
    schemaVersion: number;
    quotaBytes: number;
    revision: number;
    records: readonly AppStorageRecord[];
  }>[];
  readonly digest: string;
}

export class AppStorageError extends Error {
  constructor(readonly code: "NAMESPACE_CONFLICT" | "NAMESPACE_NOT_FOUND" | "REVISION_CONFLICT" | "QUOTA_EXCEEDED" | "KEY_INVALID" | "BACKUP_INVALID", message: string) {
    super(message);
    this.name = "AppStorageError";
  }
}

interface NamespaceRow {
  schema_version: number;
  quota_bytes: number | string;
  used_bytes: number | string;
  revision: number;
}

interface RecordRow {
  schema_id: string;
  storage_key: string;
  value_json: unknown;
  value_bytes: number;
  revision: number;
}

const keyPattern = /^[a-z][a-z0-9._:-]{0,159}$/u;
const schemaPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const appPattern = /^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;

function fail(code: AppStorageError["code"], message: string): never { throw new AppStorageError(code, message); }

async function digest(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function valueBytes(value: unknown): number {
  let serialized: string;
  try { serialized = canonicalJson(value); } catch { fail("BACKUP_INVALID", "App storage values must be canonical JSON."); }
  const bytes = Buffer.byteLength(serialized);
  if (bytes < 1 || bytes > 1_048_576) fail("QUOTA_EXCEEDED", "App storage record exceeds its byte limit.");
  return bytes;
}

function assertNamespace(namespace: AppStorageNamespace): void {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(namespace.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(namespace.environment) ||
    !appPattern.test(namespace.appId) || !schemaPattern.test(namespace.schemaId)) throw new TypeError("App storage namespace is invalid.");
}

export class PostgresAppStorage {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly validator: AppStorageDocumentValidator, private readonly secretGuard: AppStorageSecretGuard) {}

  async ensureNamespace(namespace: AppStorageNamespace, schemaVersion: number, quotaBytes: number): Promise<void> {
    assertNamespace(namespace);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1_000_000_000 || !Number.isSafeInteger(quotaBytes) || quotaBytes < 1 || quotaBytes > 268_435_456) {
      throw new TypeError("App storage namespace limits are invalid.");
    }
    await this.transaction(async (session) => {
      await this.lockNamespace(session, namespace);
      const current = await this.readNamespace(session, namespace, true);
      if (!current) {
        await session.query(
          `insert into runtime_extension_storage_namespaces (application_id, environment, app_id, schema_id, schema_version, quota_bytes) values ($1,$2,$3,$4,$5,$6)`,
          [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId, schemaVersion, quotaBytes]
        );
      } else if (current.schema_version !== schemaVersion || Number(current.quota_bytes) !== quotaBytes) {
        fail("NAMESPACE_CONFLICT", "App storage namespace already exists with different immutable limits.");
      }
    });
  }

  async get(namespace: AppStorageNamespace, key: string): Promise<AppStorageRecord | undefined> {
    assertNamespace(namespace);
    this.assertKey(key);
    const result = await this.pool.query<RecordRow>(
      `select schema_id, storage_key, value_json, value_bytes, revision from runtime_extension_storage_records
       where application_id=$1 and environment=$2 and app_id=$3 and schema_id=$4 and storage_key=$5`,
      [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId, key]
    );
    return result.rows[0] ? this.record(result.rows[0]) : undefined;
  }

  async put(namespace: AppStorageNamespace, key: string, value: unknown, expectedRevision: number): Promise<AppStorageRecord> {
    assertNamespace(namespace);
    this.assertKey(key);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail("REVISION_CONFLICT", "App storage expected revision is invalid.");
    const validated = this.validator.validate(namespace.schemaId, value);
    this.secretGuard.assertSafe(validated);
    const bytes = valueBytes(validated);
    return this.transaction(async (session) => {
      await this.lockNamespace(session, namespace);
      const state = await this.readNamespace(session, namespace, true);
      if (!state) fail("NAMESPACE_NOT_FOUND", "App storage namespace is unavailable.");
      const existing = await session.query<RecordRow>(
        `select schema_id, storage_key, value_json, value_bytes, revision from runtime_extension_storage_records
         where application_id=$1 and environment=$2 and app_id=$3 and schema_id=$4 and storage_key=$5 for update`,
        [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId, key]
      );
      const row = existing.rows[0];
      if ((row?.revision ?? 0) !== expectedRevision) fail("REVISION_CONFLICT", "App storage record revision changed.");
      const usedBytes = Number(state.used_bytes) - (row?.value_bytes ?? 0) + bytes;
      if (usedBytes > Number(state.quota_bytes)) fail("QUOTA_EXCEEDED", "App storage namespace quota is exhausted.");
      const nextRevision = expectedRevision + 1;
      const result = await session.query<RecordRow>(
        `insert into runtime_extension_storage_records (application_id, environment, app_id, schema_id, storage_key, value_json, value_bytes, revision)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         on conflict (application_id, environment, app_id, schema_id, storage_key) do update set value_json=excluded.value_json, value_bytes=excluded.value_bytes, revision=excluded.revision, updated_at=now()
         returning schema_id, storage_key, value_json, value_bytes, revision`,
        [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId, key, JSON.stringify(validated), bytes, nextRevision]
      );
      await session.query(
        `update runtime_extension_storage_namespaces set used_bytes=$5, revision=revision+1, updated_at=now()
         where application_id=$1 and environment=$2 and app_id=$3 and schema_id=$4`,
        [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId, usedBytes]
      );
      return this.record(result.rows[0]!);
    });
  }

  async delete(namespace: AppStorageNamespace, key: string, expectedRevision: number): Promise<void> {
    assertNamespace(namespace);
    this.assertKey(key);
    await this.transaction(async (session) => {
      await this.lockNamespace(session, namespace);
      const state = await this.readNamespace(session, namespace, true);
      if (!state) fail("NAMESPACE_NOT_FOUND", "App storage namespace is unavailable.");
      const existing = await session.query<RecordRow>(
        `select schema_id, storage_key, value_json, value_bytes, revision from runtime_extension_storage_records
         where application_id=$1 and environment=$2 and app_id=$3 and schema_id=$4 and storage_key=$5 for update`,
        [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId, key]
      );
      const row = existing.rows[0];
      if (!row || row.revision !== expectedRevision) fail("REVISION_CONFLICT", "App storage record revision changed.");
      await session.query(
        `delete from runtime_extension_storage_records where application_id=$1 and environment=$2 and app_id=$3 and schema_id=$4 and storage_key=$5`,
        [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId, key]
      );
      await session.query(
        `update runtime_extension_storage_namespaces set used_bytes=used_bytes-$5, revision=revision+1, updated_at=now()
         where application_id=$1 and environment=$2 and app_id=$3 and schema_id=$4`,
        [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId, row.value_bytes]
      );
    });
  }

  async query(namespace: AppStorageNamespace, prefix: string, limit: number): Promise<readonly AppStorageRecord[]> {
    assertNamespace(namespace);
    if (prefix !== "" && !keyPattern.test(prefix)) fail("KEY_INVALID", "App storage key prefix is invalid.");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("App storage query limit is invalid.");
    const result = await this.pool.query<RecordRow>(
      `select schema_id, storage_key, value_json, value_bytes, revision from runtime_extension_storage_records
       where application_id=$1 and environment=$2 and app_id=$3 and schema_id=$4 and storage_key >= $5 and storage_key < $6
       order by storage_key limit $7`,
      [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId, prefix, `${prefix}\uffff`, limit]
    );
    return Object.freeze(result.rows.map((row) => this.record(row)));
  }

  async exportBackup(applicationId: string, environment: string, appId: string): Promise<AppStorageBackup> {
    assertNamespace({ applicationId, environment, appId, schemaId: "backup.probe" });
    const session = await this.pool.connect();
    try {
      await session.query("begin transaction isolation level repeatable read read only");
      const namespaces = await session.query<NamespaceRow & { schema_id: string }>(
        `select schema_id, schema_version, quota_bytes, used_bytes, revision from runtime_extension_storage_namespaces
         where application_id=$1 and environment=$2 and app_id=$3 order by schema_id`,
        [applicationId, environment, appId]
      );
      const records = await session.query<RecordRow>(
        `select schema_id, storage_key, value_json, value_bytes, revision from runtime_extension_storage_records
         where application_id=$1 and environment=$2 and app_id=$3 order by schema_id, storage_key`,
        [applicationId, environment, appId]
      );
      const body = {
        schemaVersion: 1 as const, applicationId, environment, appId,
        namespaces: namespaces.rows.map((namespace) => ({
          schemaId: namespace.schema_id, schemaVersion: namespace.schema_version, quotaBytes: Number(namespace.quota_bytes), revision: namespace.revision,
          records: records.rows.filter((record) => record.schema_id === namespace.schema_id).map((record) => this.record(record))
        }))
      };
      const backup = Object.freeze({ ...body, digest: await digest(body) });
      await session.query("commit");
      return backup;
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally { session.release(); }
  }

  async restoreBackup(backup: AppStorageBackup): Promise<void> {
    const { digest: suppliedDigest, ...body } = backup;
    if (await digest(body) !== suppliedDigest) fail("BACKUP_INVALID", "App storage backup digest is invalid.");
    assertNamespace({ applicationId: backup.applicationId, environment: backup.environment, appId: backup.appId, schemaId: "backup.probe" });
    if (!Array.isArray(backup.namespaces) || backup.namespaces.length > 16) fail("BACKUP_INVALID", "App storage backup namespace inventory is invalid.");
    await this.transaction(async (session) => {
      const appLock = canonicalJson([backup.applicationId, backup.environment, backup.appId]);
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [appLock]);
      await session.query(
        `delete from runtime_extension_storage_namespaces where application_id=$1 and environment=$2 and app_id=$3`,
        [backup.applicationId, backup.environment, backup.appId]
      );
      const schemaIds = new Set<string>();
      for (const namespace of backup.namespaces) {
        if (!schemaPattern.test(namespace.schemaId) || schemaIds.has(namespace.schemaId) || !Number.isSafeInteger(namespace.schemaVersion) || namespace.schemaVersion < 1 || !Number.isSafeInteger(namespace.quotaBytes) || namespace.quotaBytes < 1 || namespace.quotaBytes > 268_435_456 || !Number.isSafeInteger(namespace.revision) || namespace.revision < 0 || !Array.isArray(namespace.records) || namespace.records.length > 1_000) fail("BACKUP_INVALID", "App storage backup namespace is invalid.");
        schemaIds.add(namespace.schemaId);
        let usedBytes = 0;
        const keys = new Set<string>();
        for (const record of namespace.records) {
          this.assertKey(record.key);
          if (keys.has(record.key) || !Number.isSafeInteger(record.revision) || record.revision < 1) fail("BACKUP_INVALID", "App storage backup record is invalid.");
          keys.add(record.key);
          const validated = this.validator.validate(namespace.schemaId, record.value);
          this.secretGuard.assertSafe(validated);
          const bytes = valueBytes(validated);
          if (bytes !== record.bytes) fail("BACKUP_INVALID", "App storage backup byte evidence is invalid.");
          usedBytes += bytes;
        }
        if (usedBytes > namespace.quotaBytes) fail("QUOTA_EXCEEDED", "App storage backup exceeds its namespace quota.");
        await session.query(
          `insert into runtime_extension_storage_namespaces (application_id, environment, app_id, schema_id, schema_version, quota_bytes, used_bytes, revision)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [backup.applicationId, backup.environment, backup.appId, namespace.schemaId, namespace.schemaVersion, namespace.quotaBytes, usedBytes, namespace.revision]
        );
        for (const record of namespace.records) await session.query(
          `insert into runtime_extension_storage_records (application_id, environment, app_id, schema_id, storage_key, value_json, value_bytes, revision) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
          [backup.applicationId, backup.environment, backup.appId, namespace.schemaId, record.key, JSON.stringify(record.value), record.bytes, record.revision]
        );
      }
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
    } finally { session.release(); }
  }

  private async lockNamespace(session: RuntimeExtensionSession, namespace: AppStorageNamespace): Promise<void> {
    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId])]);
  }

  private async readNamespace(session: RuntimeExtensionSession, namespace: AppStorageNamespace, lock: boolean): Promise<NamespaceRow | undefined> {
    const result = await session.query<NamespaceRow>(
      `select schema_version, quota_bytes, used_bytes, revision from runtime_extension_storage_namespaces
       where application_id=$1 and environment=$2 and app_id=$3 and schema_id=$4${lock ? " for update" : ""}`,
      [namespace.applicationId, namespace.environment, namespace.appId, namespace.schemaId]
    );
    return result.rows[0];
  }

  private assertKey(key: string): void { if (!keyPattern.test(key)) fail("KEY_INVALID", "App storage key is invalid."); }
  private record(row: RecordRow): AppStorageRecord { return Object.freeze({ key: row.storage_key, value: row.value_json, revision: row.revision, bytes: row.value_bytes }); }
}

function inputObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AppStorageError("KEY_INVALID", "App storage capability input is invalid.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join("\0") !== [...keys].sort().join("\0") || typeof input.schemaId !== "string") throw new AppStorageError("KEY_INVALID", "App storage capability input is invalid.");
  return input;
}

function namespace(claims: ExtensionCapabilityClaims, input: Record<string, unknown>, operation: "get" | "put" | "query" | "delete"): AppStorageNamespace {
  if (typeof input.schemaId !== "string") throw new AppStorageError("NAMESPACE_NOT_FOUND", "App storage schema identity is required.");
  const schemaId = input.schemaId;
  if (!claims.grants.some((grant) => grant.kind === "app-storage" && grant.operations.includes(operation) && grant.schemaIds.includes(schemaId))) {
    throw new ExtensionCapabilityError("CAPABILITY_DENIED", "App storage schema was not granted to this invocation.");
  }
  return { applicationId: claims.applicationId, environment: claims.environment, appId: claims.appId, schemaId };
}

export function createAppStorageCapabilityHandlers(storage: PostgresAppStorage): Readonly<Partial<Record<ExtensionCapabilityId, ExtensionCapabilityHandler>>> {
  const output = (value: unknown) => value;
  return Object.freeze({
    "app-storage.get": { validateInput: (value) => {
      const input = inputObject(value, ["schemaId", "key"]);
      if (typeof input.key !== "string") throw new AppStorageError("KEY_INVALID", "App storage key is invalid.");
      return input;
    }, invoke: async (claims, input) => storage.get(namespace(claims, input as Record<string, unknown>, "get"), (input as Record<string, unknown>).key as string), validateOutput: output },
    "app-storage.put": { validateInput: (value) => {
      const input = inputObject(value, ["schemaId", "key", "value", "expectedRevision"]);
      if (typeof input.key !== "string" || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) throw new AppStorageError("KEY_INVALID", "App storage put input is invalid.");
      return input;
    }, invoke: async (claims, input) => {
      const data = input as Record<string, unknown>;
      return storage.put(namespace(claims, data, "put"), data.key as string, data.value, data.expectedRevision as number);
    }, validateOutput: output },
    "app-storage.query": { validateInput: (value) => {
      const input = inputObject(value, ["schemaId", "prefix", "limit"]);
      if (typeof input.prefix !== "string" || !Number.isSafeInteger(input.limit)) throw new AppStorageError("KEY_INVALID", "App storage query input is invalid.");
      return input;
    }, invoke: async (claims, input) => {
      const data = input as Record<string, unknown>;
      return storage.query(namespace(claims, data, "query"), data.prefix as string, data.limit as number);
    }, validateOutput: output },
    "app-storage.delete": { validateInput: (value) => {
      const input = inputObject(value, ["schemaId", "key", "expectedRevision"]);
      if (typeof input.key !== "string" || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) throw new AppStorageError("KEY_INVALID", "App storage delete input is invalid.");
      return input;
    }, invoke: async (claims, input) => {
      const data = input as Record<string, unknown>;
      await storage.delete(namespace(claims, data, "delete"), data.key as string, data.expectedRevision as number);
      return { deleted: true };
    }, validateOutput: output }
  });
}
