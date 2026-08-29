import { describe, expect, it } from "vitest";

import { PostgresAppStorage } from "../src/app-storage.js";
import type { RuntimeExtensionPool } from "../src/runtime-extension-store.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

const identity = ["customer-alpha", "production", "app.sales-assistant"] as const;

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
});
