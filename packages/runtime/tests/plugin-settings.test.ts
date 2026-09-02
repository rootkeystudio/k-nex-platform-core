import { describe, expect, it } from "vitest";

import type { PluginSettingValue, PluginSettingsDescriptor, PluginSettingsDocument } from "@k-nex/contracts";

import {
  PluginSettingsError,
  PluginSettingsService,
  resolvePluginSettings,
  type PluginSettingsRuntimeDefinition
} from "../src/plugin-settings.js";

const descriptor: PluginSettingsDescriptor = {
  id: "sales.settings.workspace",
  ownerPluginId: "module.sales",
  schemaVersion: 2,
  fields: {
    defaultTaskPageSize: { type: "integer", required: true, default: 25, minimum: 1, maximum: 100 },
    showPotentialRevenue: { type: "boolean", required: true, default: true },
    apiToken: { type: "secret-reference", required: false }
  },
  surface: "workspace",
  audience: "authenticated",
  readPermission: "sales.settings.read",
  changePermission: "sales.settings.write",
  featureRevision: 1,
  publicationRevision: 1
};

type Values = Readonly<Record<string, PluginSettingValue>>;

function schema(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false as const, error: new Error("object") };
  const values = value as Record<string, unknown>;
  const keys = Object.keys(values);
  if (keys.some((key) => !["defaultTaskPageSize", "showPotentialRevenue", "apiToken"].includes(key)) ||
    !Number.isSafeInteger(values.defaultTaskPageSize) || typeof values.showPotentialRevenue !== "boolean") {
    return { success: false as const, error: new Error("strict schema") };
  }
  return { success: true as const, data: values as Values };
}

function definition(migrations: PluginSettingsRuntimeDefinition<Values>["migrations"] = []): PluginSettingsRuntimeDefinition<Values> {
  return { descriptor, schema: { safeParse: schema }, migrations };
}

function expectCode(run: () => unknown, code: PluginSettingsError["code"]): void {
  try {
    run();
    throw new Error("Expected plugin settings failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(PluginSettingsError);
    expect((error as PluginSettingsError).code).toBe(code);
  }
}

describe("P6.3 plugin settings runtime", () => {
  it("resolves immutable defaults under the current schema revision", () => {
    const resolved = resolvePluginSettings(definition());
    expect(resolved).toEqual({
      settingsId: descriptor.id,
      schemaVersion: 2,
      revision: 1,
      values: { defaultTaskPageSize: 25, showPotentialRevenue: true }
    });
    expect(Object.isFrozen(resolved.values)).toBe(true);
  });

  it("migrates one sequential revision without mutating the stored document", () => {
    const document: PluginSettingsDocument = {
      settingsId: descriptor.id,
      schemaVersion: 1,
      revision: 7,
      values: { pageSize: 50 }
    };
    const before = structuredClone(document);
    const resolved = resolvePluginSettings(definition([{
      fromVersion: 1,
      toVersion: 2,
      migrate: (values) => ({ defaultTaskPageSize: values.pageSize ?? 25, showPotentialRevenue: true })
    }]), document);
    expect(resolved).toMatchObject({ schemaVersion: 2, revision: 8, values: { defaultTaskPageSize: 50 } });
    expect(document).toEqual(before);
  });

  it("rejects raw secret values and accepts environment secret references", () => {
    const base = { settingsId: descriptor.id, schemaVersion: 2, revision: 1 } as const;
    expectCode(() => resolvePluginSettings(definition(), {
      ...base,
      values: { defaultTaskPageSize: 25, showPotentialRevenue: true, apiToken: "raw-secret" }
    }), "FIELD_INVALID");
    expect(resolvePluginSettings(definition(), {
      ...base,
      values: {
        defaultTaskPageSize: 25,
        showPotentialRevenue: true,
        apiToken: { kind: "secret-reference", provider: "environment", key: "SALES_API_TOKEN" }
      }
    }).values.apiToken).toEqual({ kind: "secret-reference", provider: "environment", key: "SALES_API_TOKEN" });
  });

  it("rejects executable contribution and topology/import graph keys", () => {
    for (const key of ["actions", "imports", "plugins", "topology"]) {
      expectCode(() => resolvePluginSettings(definition(), {
        settingsId: descriptor.id,
        schemaVersion: 2,
        revision: 1,
        values: { defaultTaskPageSize: 25, showPotentialRevenue: true, [key]: "forbidden" }
      }), "FIELD_UNKNOWN");
    }
  });

  it("fails closed on missing or throwing migrations and preserves the last valid document", () => {
    const document: PluginSettingsDocument = {
      settingsId: descriptor.id,
      schemaVersion: 1,
      revision: 4,
      values: { pageSize: 25 }
    };
    const before = structuredClone(document);
    expectCode(() => resolvePluginSettings(definition(), document), "MIGRATION_INVALID");
    expectCode(() => resolvePluginSettings(definition([{
      fromVersion: 1,
      toVersion: 2,
      migrate: () => { throw new Error("failed"); }
    }]), document), "MIGRATION_FAILED");
    expect(document).toEqual(before);
  });

  it("reads and changes persisted settings only with explicit permissions and revision", async () => {
    let document: PluginSettingsDocument = {
      settingsId: descriptor.id, schemaVersion: 2, revision: 4,
      values: { defaultTaskPageSize: 25, showPotentialRevenue: true }
    };
    const service = new PluginSettingsService({
      read: async () => structuredClone(document),
      replace: async (candidate, expectedRevision) => {
        if (document.revision !== expectedRevision) return undefined;
        document = structuredClone(candidate);
        return structuredClone(document);
      }
    }, { authorize: ({ operation, context }) => operation === context });
    await expect(service.read(definition(), "none")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.change({ definition: definition(), context: "read", expectedRevision: 4, values: { defaultTaskPageSize: 50, showPotentialRevenue: true } })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.change({ definition: definition(), context: "change", expectedRevision: 3, values: { defaultTaskPageSize: 50, showPotentialRevenue: true } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await service.change({ definition: definition(), context: "change", expectedRevision: 4, values: { defaultTaskPageSize: 50, showPotentialRevenue: false } })).toMatchObject({ revision: 5, values: { defaultTaskPageSize: 50, showPotentialRevenue: false } });
    expect(await service.read(definition(), "read")).toMatchObject({ revision: 5, values: { defaultTaskPageSize: 50, showPotentialRevenue: false } });
  });

  it("persists the normalized settings candidate including defaults and schema transforms", async () => {
    let document: PluginSettingsDocument = {
      settingsId: descriptor.id, schemaVersion: 2, revision: 4,
      values: { defaultTaskPageSize: 25, showPotentialRevenue: true }
    };
    const normalizingDefinition: PluginSettingsRuntimeDefinition<Values> = {
      ...definition(),
      schema: {
        safeParse: (value) => {
          const parsed = schema(value);
          if (!parsed.success) return parsed;
          const values = parsed.data as Values & { readonly defaultTaskPageSize: number };
          return {
            success: true as const,
            data: {
              ...values,
              defaultTaskPageSize: Math.min(values.defaultTaskPageSize, 40)
            }
          };
        }
      }
    };
    const service = new PluginSettingsService({
      read: async () => structuredClone(document),
      replace: async (candidate, expectedRevision) => {
        if (document.revision !== expectedRevision) return undefined;
        document = structuredClone(candidate);
        return structuredClone(document);
      }
    }, { authorize: ({ operation }) => operation === "change" });

    const changed = await service.change({
      definition: normalizingDefinition,
      context: "current-session",
      expectedRevision: 4,
      values: { defaultTaskPageSize: 50 } as Values
    });

    expect(changed).toEqual({
      settingsId: descriptor.id,
      schemaVersion: 2,
      revision: 5,
      values: { defaultTaskPageSize: 40, showPotentialRevenue: true }
    });
    expect(document).toEqual({
      settingsId: descriptor.id,
      schemaVersion: 2,
      revision: 5,
      values: { defaultTaskPageSize: 40, showPotentialRevenue: true }
    });
  });
});
