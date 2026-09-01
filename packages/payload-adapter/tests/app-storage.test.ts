import { describe, expect, it } from "vitest";

import { createAppStorageCapabilityHandlers, PostgresAppStorage } from "../src/app-storage.js";
import type { RuntimeExtensionPool } from "../src/runtime-extension-store.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

const identity = ["customer-alpha", "production", "app.sales-assistant"] as const;
const appNamespace = { applicationId: identity[0], environment: identity[1], appId: identity[2], schemaId: "sales.preferences" };

describe("PostgresAppStorage.exportBackup", () => {
  it("does not produce a torn recoverable backup across a barrier-controlled concurrent mutation", async () => {
    let state = {
      namespace: { schema_id: "sales.preferences", schema_version: 1, quota_bytes: 1_024, used_bytes: 24, revision: 1 },
      record: { schema_id: "sales.preferences", storage_key: "view.primary", value_json: { label: "before" }, value_bytes: 24, revision: 1 }
    };
    let snapshot = state;
    const namespaceRead = deferred();
    const mutationApplied = deferred();
    const statements: string[] = [];
    let released = false;
    const pool = {
      connect: async () => ({
        query: async <T extends object>(statement: string) => {
          statements.push(statement);
          if (statement.startsWith("begin transaction")) {
            snapshot = structuredClone(state);
            return { rows: [] as T[] };
          }
          if (statement.includes("runtime_extension_storage_namespaces")) {
            namespaceRead.resolve();
            await mutationApplied.promise;
            return { rows: [snapshot.namespace] as T[] };
          }
          if (statement.includes("runtime_extension_storage_records")) return { rows: [snapshot.record] as T[] };
          return { rows: [] as T[] };
        },
        release: () => { released = true; }
      }),
      query: async () => { throw new Error("export must use its connected snapshot client"); }
    } as unknown as RuntimeExtensionPool;
    const storage = new PostgresAppStorage(pool, { validate: (_schemaId, value) => value }, { assertSafe: () => undefined });

    const exporting = storage.exportBackup(...identity);
    await namespaceRead.promise;
    state = {
      namespace: { ...state.namespace, used_bytes: 23, revision: 2 },
      record: { ...state.record, value_json: { label: "after" }, value_bytes: 23, revision: 2 }
    };
    mutationApplied.resolve();

    const backup = await exporting;
    expect(backup).toMatchObject({
      namespaces: [{ revision: 1, records: [{ value: { label: "before" }, revision: 1, bytes: 24 }] }]
    });
    expect(statements).toEqual([
      "begin transaction isolation level repeatable read read only",
      expect.stringContaining("runtime_extension_storage_namespaces"),
      expect.stringContaining("runtime_extension_storage_records"),
      "commit"
    ]);
    expect(released).toBe(true);
    await expect(storage.restoreBackup(backup)).resolves.toBeUndefined();
  });

  it("rolls back and releases the snapshot client when a read fails", async () => {
    const statements: string[] = [];
    let released = false;
    const pool = {
      connect: async () => ({
        query: async <T extends object>(statement: string) => {
          statements.push(statement);
          if (statement.includes("runtime_extension_storage_namespaces")) throw new Error("read failed");
          return { rows: [] as T[] };
        },
        release: () => { released = true; }
      }),
      query: async () => { throw new Error("export must use its connected snapshot client"); }
    } as unknown as RuntimeExtensionPool;
    const storage = new PostgresAppStorage(pool, { validate: (_schemaId, value) => value }, { assertSafe: () => undefined });

    await expect(storage.exportBackup(...identity)).rejects.toThrow("read failed");
    expect(statements).toEqual([
      "begin transaction isolation level repeatable read read only",
      expect.stringContaining("runtime_extension_storage_namespaces"),
      "rollback"
    ]);
    expect(released).toBe(true);
  });

  it("keyset-pages exports and rolls back a later restore batch", async () => {
    const records = Array.from({ length: 1_001 }, (_, index) => ({
      schema_id: appNamespace.schemaId,
      storage_key: `view.${String(index).padStart(4, "0")}`,
      value_json: null,
      value_bytes: 5,
      revision: 1
    }));
    const restoreStatements: string[] = [];
    const restoreParameterCounts: number[] = [];
    let connections = 0;
    let recordBatches = 0;
    let releases = 0;
    const pool = {
      connect: async () => {
        connections += 1;
        if (connections === 1) return {
          query: async <T extends object>(statement: string, values?: readonly unknown[]) => {
            if (statement.startsWith("select schema_id, schema_version")) {
              return { rows: [{ schema_id: appNamespace.schemaId, schema_version: 1, quota_bytes: 20_000, used_bytes: 5_005, revision: 1 }] as T[] };
            }
            if (statement.startsWith("select schema_id, storage_key")) {
              const start = values?.[3] === null ? 0 : 1_000;
              return { rows: records.slice(start, start + 1_000) as T[] };
            }
            return { rows: [] as T[] };
          },
          release: () => { releases += 1; }
        };
        return {
          query: async <T extends object>(statement: string, values?: readonly unknown[]) => {
            restoreStatements.push(statement);
            if (statement.startsWith("insert into runtime_extension_storage_records")) {
              recordBatches += 1;
              restoreParameterCounts.push(values?.length ?? 0);
              if (recordBatches === 2) throw new Error("second batch failed");
            }
            return { rows: [] as T[] };
          },
          release: () => { releases += 1; }
        };
      },
      query: async () => { throw new Error("storage must use its connected client"); }
    } as unknown as RuntimeExtensionPool;
    const storage = new PostgresAppStorage(pool, { validate: (_schemaId, value) => value }, { assertSafe: () => undefined });

    const backup = await storage.exportBackup(...identity);
    expect(backup.namespaces[0]?.records).toHaveLength(1_001);
    expect(backup.namespaces[0]?.records.map((record) => record.key)).toEqual(records.map((record) => record.storage_key));

    await expect(storage.restoreBackup(backup)).rejects.toThrow("second batch failed");
    expect(restoreParameterCounts).toEqual([8_000, 8]);
    expect(restoreStatements).toContain("rollback");
    expect(restoreStatements).not.toContain("commit");
    expect(releases).toBe(2);
  });
});

describe("PostgresAppStorage cancellation", () => {
  it("forwards the exact caller signal through every app-storage capability handler", async () => {
    const received: Record<string, AbortSignal | undefined> = {};
    const storage = {
      get: async (_namespace: unknown, _key: unknown, signal: AbortSignal) => { received.get = signal; return undefined; },
      put: async (_namespace: unknown, _key: unknown, _value: unknown, _revision: unknown, signal: AbortSignal) => { received.put = signal; return {}; },
      query: async (_namespace: unknown, _prefix: unknown, _limit: unknown, signal: AbortSignal) => { received.query = signal; return []; },
      delete: async (_namespace: unknown, _key: unknown, _revision: unknown, signal: AbortSignal) => { received.delete = signal; }
    } as unknown as PostgresAppStorage;
    const handlers = createAppStorageCapabilityHandlers(storage);
    const claims = {
      applicationId: identity[0], environment: identity[1], appId: identity[2],
      grants: [{ kind: "app-storage", operations: ["get", "put", "query", "delete"], schemaIds: [appNamespace.schemaId] }]
    } as never;
    const controller = new AbortController();

    await handlers["app-storage.get"]!.invoke(claims, { schemaId: appNamespace.schemaId, key: "view.primary" }, controller.signal);
    await handlers["app-storage.put"]!.invoke(claims, { schemaId: appNamespace.schemaId, key: "view.primary", value: { label: "primary" }, expectedRevision: 0 }, controller.signal);
    await handlers["app-storage.query"]!.invoke(claims, { schemaId: appNamespace.schemaId, prefix: "view", limit: 1 }, controller.signal);
    await handlers["app-storage.delete"]!.invoke(claims, { schemaId: appNamespace.schemaId, key: "view.primary", expectedRevision: 1 }, controller.signal);

    expect(received).toEqual({ get: controller.signal, put: controller.signal, query: controller.signal, delete: controller.signal });
  });

  it("runs no SQL when a storage mutation is already aborted", async () => {
    let connects = 0;
    let queries = 0;
    const pool = {
      connect: async () => { connects += 1; throw new Error("must not connect"); },
      query: async () => { queries += 1; throw new Error("must not query"); }
    } as unknown as RuntimeExtensionPool;
    const storage = new PostgresAppStorage(pool, { validate: (_schemaId, value) => value }, { assertSafe: () => undefined });
    const controller = new AbortController();
    const cancellation = new Error("cancelled before storage");
    controller.abort(cancellation);

    await expect(storage.put(appNamespace, "view.primary", { label: "primary" }, 0, controller.signal)).rejects.toBe(cancellation);
    expect({ connects, queries }).toEqual({ connects: 0, queries: 0 });
  });

  it("returns the committed put when cancellation arrives during commit", async () => {
    const statements: string[] = [];
    let releases = 0;
    const controller = new AbortController();
    const pool = {
      connect: async () => ({
        query: async <T extends object>(statement: string) => {
          statements.push(statement);
          if (statement === "commit") controller.abort(new Error("cancelled during commit"));
          if (statement.includes("runtime_extension_storage_namespaces")) {
            return { rows: [{ schema_version: 1, quota_bytes: 1_024, used_bytes: 0, revision: 1 }] as T[] };
          }
          if (statement.includes("runtime_extension_storage_records") && statement.includes("for update")) return { rows: [] as T[] };
          if (statement.includes("insert into runtime_extension_storage_records")) {
            return { rows: [{ schema_id: appNamespace.schemaId, storage_key: "view.primary", value_json: { label: "primary" }, value_bytes: 19, revision: 1 }] as T[] };
          }
          return { rows: [] as T[] };
        },
        release: () => { releases += 1; }
      }),
      query: async () => { throw new Error("mutation must use its connected transaction client"); }
    } as unknown as RuntimeExtensionPool;
    const storage = new PostgresAppStorage(pool, { validate: (_schemaId, value) => value }, { assertSafe: () => undefined });

    await expect(storage.put(appNamespace, "view.primary", { label: "primary" }, 0, controller.signal)).resolves.toMatchObject({ key: "view.primary", revision: 1 });
    expect(statements.filter((statement) => statement === "commit")).toHaveLength(1);
    expect(statements).not.toContain("rollback");
    expect(releases).toBe(1);
  });

  it.each(["put", "delete"] as const)("rolls back and releases without subsequent SQL when %s is aborted after its mutating query", async (operation) => {
    const statements: string[] = [];
    let released = false;
    const controller = new AbortController();
    const cancellation = new Error(`cancelled during ${operation}`);
    const pool = {
      connect: async () => ({
        query: async <T extends object>(statement: string) => {
          statements.push(statement);
          if ((operation === "put" && statement.includes("insert into runtime_extension_storage_records")) ||
            (operation === "delete" && statement.startsWith("delete from runtime_extension_storage_records"))) {
            controller.abort(cancellation);
            return { rows: (operation === "put" ? [{ schema_id: appNamespace.schemaId, storage_key: "view.primary", value_json: { label: "primary" }, value_bytes: 19, revision: 1 }] : []) as T[] };
          }
          if (statement.includes("runtime_extension_storage_namespaces")) {
            return { rows: [{ schema_version: 1, quota_bytes: 1_024, used_bytes: 0, revision: 1 }] as T[] };
          }
          if (statement.includes("runtime_extension_storage_records") && statement.includes("for update")) {
            return { rows: (operation === "delete" ? [{ schema_id: appNamespace.schemaId, storage_key: "view.primary", value_json: { label: "primary" }, value_bytes: 19, revision: 1 }] : []) as T[] };
          }
          return { rows: [] as T[] };
        },
        release: () => { released = true; }
      }),
      query: async () => { throw new Error("mutation must use its connected transaction client"); }
    } as unknown as RuntimeExtensionPool;
    const storage = new PostgresAppStorage(pool, { validate: (_schemaId, value) => value }, { assertSafe: () => undefined });

    const pending = operation === "put"
      ? storage.put(appNamespace, "view.primary", { label: "primary" }, 0, controller.signal)
      : storage.delete(appNamespace, "view.primary", 1, controller.signal);
    await expect(pending).rejects.toBe(cancellation);

    const mutationIndex = statements.findIndex((statement) => operation === "put"
      ? statement.includes("insert into runtime_extension_storage_records")
      : statement.startsWith("delete from runtime_extension_storage_records"));
    expect(mutationIndex).toBeGreaterThanOrEqual(0);
    expect(statements.slice(mutationIndex + 1)).toEqual(["rollback"]);
    expect(statements).not.toContain("commit");
    expect(statements.some((statement) => statement.startsWith("update runtime_extension_storage_namespaces"))).toBe(false);
    expect(released).toBe(true);
  });
});
