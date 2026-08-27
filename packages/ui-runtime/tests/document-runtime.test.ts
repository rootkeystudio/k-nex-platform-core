import { describe, expect, it, vi } from "vitest";

import type { DataSourceDescriptor, UiDocument } from "@k-nex/contracts";
import {
  createUiDocumentRuntime,
  createUiRuntimeRegistry,
  defineUiContributionBinding,
  snapshotUiBlockDefinition,
  type UiBlockDefinition,
  type UiRuntimeActor,
  type UiRuntimeNodeResult
} from "../src/index.js";

const actor = (permissions: readonly string[] = []): UiRuntimeActor => ({ authenticated: true, permissions: new Set(permissions) });
const validProps = {
  safeParse: (value: unknown) => typeof value === "object" && value !== null && "title" in value
    ? { success: true as const, data: { title: String((value as { title: unknown }).title).toUpperCase() } }
    : { success: false as const, error: "invalid" }
};
const block = (overrides: Partial<UiBlockDefinition> = {}): UiBlockDefinition => ({
  id: "content.card",
  version: 1,
  profiles: ["workspace"],
  surfaces: ["workspace"],
  audience: "authenticated",
  propsSchema: validProps,
  render: ({ props }) => (props as { title: string }).title,
  ...overrides
});
const document = (nodeOverrides: Record<string, unknown> = {}): UiDocument => ({
  id: "workspace.dashboard",
  version: 1,
  schemaVersion: 1,
  profile: "workspace",
  regions: {
    main: [{ id: "card-1", type: "content.card", version: 1, props: { title: "first" }, ...nodeOverrides }]
  }
});
const source = (overrides: Partial<DataSourceDescriptor> = {}): DataSourceDescriptor => ({
  id: "sales.tasks",
  version: 1,
  ownerPluginId: "module.sales",
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "sales.tasks", version: 1 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  structuralCompatibilityHash: `sha256:${"a".repeat(64)}`,
  presentationMetadataRevision: 1,
  title: "Tasks",
  inputFields: [],
  outputFields: [{ id: "title", kind: "text", binding: "required", nullable: false, permission: "sales.tasks.title.read", sortable: true, filterOperators: [] }],
  limits: { maxSelectedFields: 8, maxPageSize: 20, maxFilters: 4, maxSorts: 2, maxBodyBytes: 4096, maxResultBytes: 65536, maxDepth: 4, timeoutMs: 5000, maxConcurrency: 4, ratePerMinute: 60, burst: 10, costClass: "low", maxCost: 10 },
  cacheClass: "actor",
  ...overrides
});
const firstNode = (result: ReturnType<ReturnType<typeof createUiDocumentRuntime>["render"]>): UiRuntimeNodeResult => {
  if (!result.success) throw new Error("Expected successful document evaluation.");
  const node = result.regions.main?.[0];
  if (node === undefined) throw new Error("Expected the main node.");
  return node;
};

describe("UI document runtime", () => {
  it("renders validated props outside an editor and preserves node order", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [block()], sources: [] }));
    const result = runtime.render({ document: document({ children: [{ id: "card-2", type: "content.card", version: 1, props: { title: "second" } }] }), surface: "workspace", actor: actor() });
    const node = firstNode(result);
    expect(node).toMatchObject({ status: "rendered", nodeId: "card-1", output: "FIRST" });
    expect(node.children[0]).toMatchObject({ status: "rendered", nodeId: "card-2", output: "SECOND" });
  });

  it("fails closed for migration, profile/surface, and authentication", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [block()], sources: [] }));
    expect(runtime.render({ document: {}, surface: "workspace", actor: actor() })).toEqual({ success: false, code: "DOCUMENT_MIGRATION_FAILED", migrationCode: "MISSING_SCHEMA_VERSION", remediation: "MIGRATE_DOCUMENT" });
    expect(runtime.render({ document: document(), surface: "public", actor: actor() })).toEqual({ success: false, code: "PROFILE_SURFACE_DENIED", remediation: "FIX_BLOCK_CONFIGURATION" });
    expect(runtime.render({ document: document(), surface: "workspace", actor: { authenticated: false, permissions: new Set() } })).toEqual({ success: false, code: "AUTHENTICATION_REQUIRED", remediation: "REQUEST_ACCESS" });
  });

  it("returns stable fallbacks without invoking an invalid or forbidden block", () => {
    expect(firstNode(createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [], sources: [] })).render({ document: document(), surface: "workspace", actor: actor() }))).toMatchObject({ reason: "MISSING_BLOCK" });

    const render = vi.fn();
    const invalid = block({ propsSchema: { safeParse: () => ({ success: false as const, error: "invalid" }) }, render });
    expect(firstNode(createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [invalid], sources: [] })).render({ document: document(), surface: "workspace", actor: actor() }))).toMatchObject({ reason: "INVALID_PROPS" });
    expect(render).not.toHaveBeenCalled();

    const protectedBlock = block({ permission: "content.card.read", render });
    expect(firstNode(createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [protectedBlock], sources: [] })).render({ document: document(), surface: "workspace", actor: actor() }))).toMatchObject({ reason: "PERMISSION_DENIED" });
    expect(render).not.toHaveBeenCalled();
  });

  it("enforces source compatibility, selected fields, and field permission", () => {
    const dataBlock = block({ sourcePolicy: { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["title"] } });
    const bound = document({ bindings: { source: { source: { id: "sales.tasks", version: 1 }, input: {}, structuralCompatibilityHash: `sha256:${"a".repeat(64)}`, selectedFields: ["title"] } } });
    const registry = createUiRuntimeRegistry({ blocks: [dataBlock], sources: [source()] });
    const runtime = createUiDocumentRuntime(registry);
    expect(firstNode(runtime.render({ document: bound, surface: "workspace", actor: actor(["sales.tasks.read", "sales.tasks.title.read"]) }))).toMatchObject({ status: "rendered", output: "FIRST" });
    expect(firstNode(runtime.render({ document: bound, surface: "workspace", actor: actor(["sales.tasks.read"]) }))).toMatchObject({ reason: "SOURCE_FIELD_PERMISSION_DENIED" });
    expect(firstNode(createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [dataBlock], sources: [] })).render({ document: bound, surface: "workspace", actor: actor() }))).toMatchObject({ reason: "MISSING_SOURCE" });
    expect(firstNode(runtime.render({ document: document(), surface: "workspace", actor: actor() }))).toMatchObject({ reason: "SOURCE_BINDING_REQUIRED" });
  });

  it("requires persisted actions to match the component action policy", () => {
    const actionBlock = block({ actionPolicy: { required: true, actions: [{ id: "sales.task.create", version: 1 }] } });
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [actionBlock], sources: [] }));
    expect(firstNode(runtime.render({ document: document(), surface: "workspace", actor: actor() }))).toMatchObject({ reason: "ACTION_BINDING_REQUIRED" });
    expect(firstNode(runtime.render({ document: document({ bindings: { action: { id: "sales.task.delete", version: 1 } } }), surface: "workspace", actor: actor() }))).toMatchObject({ reason: "ACTION_NOT_ACCEPTED" });
    expect(firstNode(runtime.render({ document: document({ bindings: { action: { id: "sales.task.create", version: 1 } } }), surface: "workspace", actor: actor() }))).toMatchObject({ status: "rendered" });
  });

  it("rebinds forged descriptor definitions before registry and document runtime use", () => {
    const bound = defineUiContributionBinding({
      descriptor: {
        id: "sales.trusted-card",
        version: 1,
        ownerPluginId: "module.sales",
        kind: "block",
        propsSchema: { type: "object", properties: { title: { type: "string", maxLength: 4 } }, required: ["title"], additionalProperties: false },
        profiles: ["workspace"],
        surfaces: ["workspace"],
        audience: "authenticated",
        permission: "sales.tasks.read",
        actionPolicy: { required: true, actions: [{ id: "sales.task.create", version: 1 }] },
        sourcePolicy: { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["title"] },
        requiredStates: ["loading", "empty", "error", "forbidden"]
      },
      render: ({ props }) => props
    });
    const forged = {
      ...bound,
      propsSchema: { safeParse: (value: unknown) => ({ success: true as const, data: value }) },
      sourcePolicy: undefined,
      actionPolicy: { required: false, actions: [{ id: "sales.task.delete", version: 1 }] }
    };
    const direct = snapshotUiBlockDefinition(forged);
    const registry = createUiRuntimeRegistry({ blocks: [forged], sources: [] });
    const definition = registry.resolveBlock("sales.trusted-card", 1)!;
    const runtime = createUiDocumentRuntime(registry);
    const trustedDocument = (props: Record<string, unknown>, action?: { id: string; version: number }): UiDocument => ({
      id: "workspace.trusted", version: 1, schemaVersion: 1, profile: "workspace",
      regions: { main: [{ id: "trusted-card", type: "sales.trusted-card", version: 1, props, ...(action === undefined ? {} : { bindings: { action } }) }] }
    });

    for (const candidate of [bound, direct, definition]) {
      expect(candidate.actionPolicy).toEqual({ required: true, actions: [{ id: "sales.task.create", version: 1 }] });
      expect(candidate.sourcePolicy).toEqual({ required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["title"] });
      expect(candidate.propsSchema.safeParse({ title: "too long" }).success).toBe(false);
    }
    expect(firstNode(runtime.render({ document: trustedDocument({ title: "Task" }), surface: "workspace", actor: actor(["sales.tasks.read"]) }))).toMatchObject({ reason: "ACTION_BINDING_REQUIRED" });
    expect(firstNode(runtime.render({ document: trustedDocument({ title: "Task" }, { id: "sales.task.delete", version: 1 }), surface: "workspace", actor: actor(["sales.tasks.read"]) }))).toMatchObject({ reason: "ACTION_NOT_ACCEPTED" });
    expect(firstNode(runtime.render({ document: trustedDocument({ title: "Task" }, { id: "sales.task.create", version: 1 }), surface: "workspace", actor: actor(["sales.tasks.read"]) }))).toMatchObject({ reason: "SOURCE_BINDING_REQUIRED" });
    expect(firstNode(runtime.render({ document: trustedDocument({ title: "too long" }, { id: "sales.task.create", version: 1 }), surface: "workspace", actor: actor(["sales.tasks.read"]) }))).toMatchObject({ reason: "INVALID_PROPS" });
  });

  it("rejects incompatible source structure and descriptor-level input before rendering", () => {
    const render = vi.fn(({ props }: { props: unknown }) => props);
    const dataBlock = block({ sourcePolicy: { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["title"] }, render });
    const descriptor = source({ inputFields: [{ id: "status", kind: "string", required: true, nullable: false }] });
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [dataBlock], sources: [descriptor] }));
    const bound = (input: unknown, hash = descriptor.structuralCompatibilityHash) => document({
      bindings: { source: { source: { id: "sales.tasks", version: 1 }, input, structuralCompatibilityHash: hash, selectedFields: ["title"] } }
    });

    expect(firstNode(runtime.render({ document: bound({ status: "open" }), surface: "workspace", actor: actor(["sales.tasks.read", "sales.tasks.title.read"]) }))).toMatchObject({ status: "rendered" });
    render.mockClear();
    expect(firstNode(runtime.render({ document: bound({ status: "open" }, `sha256:${"b".repeat(64)}`), surface: "workspace", actor: actor() }))).toMatchObject({ reason: "SOURCE_STRUCTURAL_HASH_MISMATCH" });
    for (const input of [{}, { status: 1 }, { status: null }, { status: "open", unknown: true }, []]) {
      expect(firstNode(runtime.render({ document: bound(input), surface: "workspace", actor: actor() }))).toMatchObject({ reason: "SOURCE_INPUT_INVALID" });
    }
    expect(render).not.toHaveBeenCalled();
  });

  it("contains renderer failures as a fallback", () => {
    const throwing = block({ render: () => { throw new Error("private renderer detail"); } });
    const result = firstNode(createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [throwing], sources: [] })).render({ document: document(), surface: "workspace", actor: actor() }));
    expect(result).toMatchObject({ status: "fallback", reason: "RENDER_FAILED" });
    expect(JSON.stringify(result)).not.toContain("private renderer detail");
  });

  it("isolates renderer actor authority and deeply freezes registered descriptors", () => {
    const callerPermissions = new Set<string>();
    const mutator = block({
      id: "content.mutator",
      render: ({ actor: rendererActor }) => {
        (rendererActor.permissions as Set<string>).add("content.protected.read");
        return "mutated";
      }
    });
    const protectedBlock = block({ id: "content.protected", permission: "content.protected.read" });
    const descriptor = source();
    const registry = createUiRuntimeRegistry({ blocks: [mutator, protectedBlock], sources: [descriptor] });
    const runtime = createUiDocumentRuntime(registry);
    const result = runtime.render({
      document: {
        ...document(),
        regions: { main: [
          { id: "mutator-1", type: "content.mutator", version: 1, props: { title: "first" } },
          { id: "protected-1", type: "content.protected", version: 1, props: { title: "second" } }
        ] }
      },
      surface: "workspace",
      actor: { authenticated: true, permissions: callerPermissions }
    });
    if (!result.success) throw new Error("Expected successful document evaluation.");
    expect(result.regions.main).toMatchObject([{ reason: "RENDER_FAILED" }, { reason: "PERMISSION_DENIED" }]);
    expect(callerPermissions.has("content.protected.read")).toBe(false);

    const snapshot = registry.resolveSource(descriptor.id, descriptor.version)!;
    expect(Object.isFrozen(snapshot.outputFields)).toBe(true);
    expect(Object.isFrozen(snapshot.outputFields?.[0])).toBe(true);
    expect(() => (snapshot.outputFields as DataSourceDescriptor["outputFields"] & unknown[]).push({})).toThrow();
    expect(descriptor.outputFields).toHaveLength(1);
  });

  it("rejects loose result envelopes and gives renderers only immutable normalized data", () => {
    const observed: unknown[] = [];
    const dataBlock = block({
      sourcePolicy: { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["title"] },
      render: ({ sourceResult }) => {
        observed.push(sourceResult);
        if (sourceResult?.state === "success") (sourceResult.data as { fields: string[] }).fields.push("private-note");
        return "rendered";
      }
    });
    const descriptor = source();
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [dataBlock], sources: [descriptor] }));
    const bound = document({ bindings: { source: {
      source: { id: descriptor.id, version: descriptor.version }, input: {}, structuralCompatibilityHash: descriptor.structuralCompatibilityHash, selectedFields: ["title"]
    } } });
    const table = { fields: ["title"], rows: [], page: { number: 1, pageSize: 20, hasNext: false } };
    const render = (result: unknown) => firstNode(runtime.render({
      document: bound, surface: "workspace", actor: actor(["sales.tasks.read", "sales.tasks.title.read"]), sourceResults: { "card-1": result as never }
    }));

    expect(render({ state: "success", data: table, secret: "leak" })).toMatchObject({ reason: "SOURCE_RESULT_INVALID" });
    expect(render({ state: "error", problem: { code: "FAILED", status: 500, stack: "private" } })).toMatchObject({ reason: "SOURCE_RESULT_INVALID" });
    expect(render({ state: "forbidden", problem: { code: "FORBIDDEN", status: 500 } })).toMatchObject({ reason: "SOURCE_RESULT_INVALID" });
    expect(render({ state: "success", data: table })).toMatchObject({ reason: "RENDER_FAILED" });
    expect(observed).toHaveLength(1);
    expect(Object.isFrozen(observed[0])).toBe(true);
    expect(Object.isFrozen((observed[0] as { data: { fields: unknown } }).data.fields)).toBe(true);
    expect(table.fields).toEqual(["title"]);
  });
});
