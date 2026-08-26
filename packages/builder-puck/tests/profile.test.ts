import { describe, expect, it } from "vitest";
import type { DataSourceDescriptor } from "@k-nex/contracts";

import { createPuckBuilderProfileRegistry, type PuckBlockBridge, type PuckBuilderProfile } from "../src/index.js";

const staticBlock: PuckBlockBridge = {
  definition: {
    id: "content.text", version: 1, profiles: ["cms", "workspace"], surfaces: ["cms", "public", "workspace"], audience: "public",
    propsSchema: { safeParse: (value: unknown) => ({ success: true as const, data: value }) }, render: ({ props }) => props
  },
  label: "Text",
  fields: [{ prop: "text", label: "Text", kind: "text" }],
  allowChildren: false,
  defaultProps: { text: "" }
};
const workspaceBlock: PuckBlockBridge = {
  ...staticBlock,
  definition: {
    ...staticBlock.definition,
    id: "sales.workspace-task-table",
    profiles: ["workspace"],
    surfaces: ["workspace"],
    audience: "authenticated",
    sourcePolicy: { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["title"] }
  },
  label: "Task table"
};
const source = (id: string, audience: "public" | "authenticated", surfaces: DataSourceDescriptor["surfaces"]): DataSourceDescriptor => ({
  id, version: 1, ownerPluginId: "module.sales", primaryContract: { id: "table.records", version: 1 }, sourceSchema: { id, version: 1 },
  audience, surfaces, permission: audience === "public" ? "sales.public-task-summary.read" : "sales.tasks.read", structuralCompatibilityHash: `sha256:${"a".repeat(64)}`,
  presentationMetadataRevision: 1, title: id, inputFields: [], outputFields: [{
    id: "title", kind: "text", binding: "required", nullable: false, permission: "sales.tasks.read", sortable: false, filterOperators: []
  }],
  limits: { maxSelectedFields: 8, maxPageSize: 20, maxFilters: 4, maxSorts: 2, maxBodyBytes: 4096, maxResultBytes: 65536, maxDepth: 4, timeoutMs: 5000, maxConcurrency: 4, ratePerMinute: 60, burst: 10, costClass: "low", maxCost: 10 },
  cacheClass: audience === "public" ? "public" : "actor"
});
const sources = [source("sales.public-task-summary", "public", ["public"]), source("sales.tasks", "authenticated", ["workspace"])] as const;
const cms: PuckBuilderProfile = {
  id: "cms",
  blocks: [{ id: "content.text", version: 1 }],
  sources: [{ id: "sales.public-task-summary", version: 1 }],
  actions: [{ id: "content.public-signup", version: 1 }],
  publication: "draft-preview-publish"
};
const workspace: PuckBuilderProfile = {
  id: "workspace",
  blocks: [{ id: "content.text", version: 1 }, { id: "sales.workspace-task-table", version: 1 }],
  sources: [{ id: "sales.tasks", version: 1 }],
  actions: [{ id: "sales.workspace-task-create", version: 1 }],
  publication: "save-layout"
};

describe("profile-specific Puck policy", () => {
  it("uses one engine with distinct palettes and authority allowlists", () => {
    const registry = createPuckBuilderProfileRegistry({ blocks: [staticBlock, workspaceBlock], sources, profiles: [cms, workspace] });
    const cmsProfile = registry.resolve("cms");
    const workspaceProfile = registry.resolve("workspace");
    expect(Object.keys(cmsProfile?.adapter.config.components ?? {})).toEqual(["content.text__v1"]);
    expect(Object.keys(workspaceProfile?.adapter.config.components ?? {})).toEqual(["content.text__v1", "sales.workspace-task-table__v1"]);
    expect(cmsProfile?.allowsSource("sales.tasks", 1)).toBe(false);
    expect(cmsProfile?.allowsSource("sales.public-task-summary", 1)).toBe(true);
    expect(workspaceProfile?.allowsSource("sales.tasks", 1)).toBe(true);
    expect(workspaceProfile?.allowsSource("sales.public-task-summary", 1)).toBe(false);
    expect(cmsProfile?.allowsAction("sales.workspace-task-create", 1)).toBe(false);
    expect(workspaceProfile?.allowsAction("sales.workspace-task-create", 1)).toBe(true);
  });

  it("rejects unknown blocks, duplicates, and crossed publication rules", () => {
    expect(() => createPuckBuilderProfileRegistry({ blocks: [staticBlock], sources, profiles: [{ ...cms, blocks: [{ id: "missing.block", version: 1 }] }] })).toThrow(/unknown block/);
    expect(() => createPuckBuilderProfileRegistry({ blocks: [staticBlock], sources, profiles: [cms, cms] })).toThrow(/unique/);
    expect(() => createPuckBuilderProfileRegistry({ blocks: [staticBlock], sources, profiles: [{ ...cms, publication: "save-layout" }] })).toThrow(/publication/);
    expect(() => createPuckBuilderProfileRegistry({ blocks: [staticBlock], sources, profiles: [{ ...workspace, blocks: [{ id: "content.text", version: 1 }], publication: "draft-preview-publish" }] })).toThrow(/publication/);
    expect(() => createPuckBuilderProfileRegistry({ blocks: [staticBlock], sources, profiles: [{ ...cms, sources: [{ id: "sales.tasks", version: 1 }] }] })).toThrow(/cannot allow source/);
  });

  it("rejects documents from another profile and sources outside the profile allowlist", () => {
    const profile = createPuckBuilderProfileRegistry({ blocks: [staticBlock, workspaceBlock], sources, profiles: [cms] }).resolve("cms");
    if (profile === undefined) throw new Error("Expected CMS profile.");
    const node = { id: "text-1", type: "content.text", version: 1, props: { text: "Hello" } };
    expect(() => profile.adapter.toPuckData({ id: "workspace.home", version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [node] } })).toThrow(/cannot edit/);
    expect(() => profile.adapter.toPuckData({
      id: "cms.home",
      version: 1,
      schemaVersion: 1,
      profile: "cms",
      regions: { main: [{ ...node, bindings: { source: { source: { id: "sales.tasks", version: 1 }, input: {}, structuralCompatibilityHash: `sha256:${"a".repeat(64)}`, selectedFields: ["title"] } } }] }
    })).toThrow(/forbids source/);
    expect(() => profile.adapter.toPuckData({
      id: "cms.hidden", version: 1, schemaVersion: 1, profile: "cms",
      regions: { main: [], sidebar: [{ id: "tasks-1", type: "sales.workspace-task-table", version: 1, props: { text: "Hidden" } }] }
    })).toThrow(/forbids block/);
  });

  it("threads preview authority through the resolved profile and rejects publication-incompatible bindings", () => {
    const registry = createPuckBuilderProfileRegistry({
      blocks: [staticBlock, workspaceBlock],
      sources,
      profiles: [workspace],
      preview: { workspace: {
        surface: "workspace",
        actor: { authenticated: true, permissions: new Set(["sales.tasks.read"]) },
        sourceResults: { tasks: { state: "idle" } }
      } }
    });
    const profile = registry.resolve("workspace");
    if (profile === undefined) throw new Error("Expected workspace profile.");
    const document = {
      id: "workspace.tasks", version: 1, schemaVersion: 1, profile: "workspace",
      regions: { main: [{
        id: "tasks", type: "sales.workspace-task-table", version: 1, props: { text: "Tasks" },
        bindings: { source: {
          source: { id: "sales.tasks", version: 1 }, input: {}, structuralCompatibilityHash: sources[1].structuralCompatibilityHash,
          selectedFields: ["title"]
        } }
      }] }
    };
    expect(profile.validateDocument(document)).toEqual(document);
    expect(() => profile.validateDocument({
      ...document,
      regions: { main: [{
        ...document.regions.main[0],
        bindings: { source: { ...document.regions.main[0].bindings.source, structuralCompatibilityHash: `sha256:${"0".repeat(64)}` } }
      }] }
    })).toThrow(/SOURCE_STRUCTURAL_HASH_MISMATCH/);

    const data = profile.adapter.toPuckData(document);
    const component = profile.adapter.config.components["sales.workspace-task-table__v1"] as { render: (props: Record<string, unknown>) => unknown };
    expect(component.render(data.content[0]!.props)).not.toBe("Unavailable: MISSING_SOURCE");
  });
});
