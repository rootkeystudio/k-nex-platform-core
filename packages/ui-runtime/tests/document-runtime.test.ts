import { describe, expect, it, vi } from "vitest";

import type { DataSourceDescriptor, UiDocument } from "@k-nex/contracts";
import {
  createUiDocumentRuntime,
  createUiRuntimeRegistry,
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
    expect(runtime.render({ document: {}, surface: "workspace", actor: actor() })).toEqual({ success: false, code: "DOCUMENT_MIGRATION_FAILED", migrationCode: "MISSING_SCHEMA_VERSION" });
    expect(runtime.render({ document: document(), surface: "public", actor: actor() })).toEqual({ success: false, code: "PROFILE_SURFACE_DENIED" });
    expect(runtime.render({ document: document(), surface: "workspace", actor: { authenticated: false, permissions: new Set() } })).toEqual({ success: false, code: "AUTHENTICATION_REQUIRED" });
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
});
