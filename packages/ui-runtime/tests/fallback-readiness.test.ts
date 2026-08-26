import { describe, expect, it } from "vitest";

import { salesTasksDescriptor } from "../../../modules/sales/src/server.js";
import {
  createStaticTextBlockDefinition,
  createUiDocumentRuntime,
  createUiRuntimeRegistry,
  createWorkspaceTaskTableBlockDefinition,
  inspectUiDocumentReadiness
} from "../src/index.js";

const actor = { authenticated: true, permissions: new Set(["sales.tasks.read", "sales.tasks.title.read", "sales.tasks.status.read", "sales.tasks.revenue.read"]) };
const sourceBinding = {
  source: { id: "sales.tasks", version: 1 },
  input: {},
  structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash,
  selectedFields: ["title", "status", "potential-revenue"]
};
const workspaceDocument = (node: Record<string, unknown>) => ({
  id: "workspace.fallback",
  version: 1,
  schemaVersion: 1,
  profile: "workspace",
  regions: { main: [node] }
});
const taskNode = (binding = sourceBinding) => ({
  id: "tasks-1",
  type: "sales.workspace-task-table",
  version: 1,
  props: { title: "Tasks" },
  bindings: { source: binding }
});
const first = (result: ReturnType<ReturnType<typeof createUiDocumentRuntime>["render"]>) => {
  if (!result.success) throw new Error("Expected node result.");
  const node = result.regions.main?.[0];
  if (node === undefined) throw new Error("Expected main node.");
  return node;
};

describe("P4.6 safe fallback and readiness", () => {
  it("identifies a missing plugin while preserving its node and rendered children", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({
      blocks: [createStaticTextBlockDefinition()],
      sources: [],
      blockCatalog: [{ id: "content.plugin-card", version: 1, ownerPluginId: "module.content" }]
    }));
    const result = runtime.render({
      document: workspaceDocument({
        id: "plugin-1",
        type: "content.plugin-card",
        version: 1,
        props: { title: "Stored content" },
        children: [{ id: "text-1", type: "content.text", version: 1, props: { text: "Still present" } }]
      }),
      surface: "workspace",
      actor
    });
    expect(first(result)).toMatchObject({
      status: "fallback",
      nodeId: "plugin-1",
      blockId: "content.plugin-card",
      reason: "MISSING_PLUGIN",
      ownerPluginId: "module.content",
      remediation: "INSTALL_OR_ENABLE_PLUGIN",
      children: [{ status: "rendered", nodeId: "text-1" }]
    });
    expect(inspectUiDocumentReadiness(result)).toEqual({
      ready: false,
      issues: [{ code: "MISSING_PLUGIN", nodeId: "plugin-1", blockId: "content.plugin-card", blockVersion: 1, ownerPluginId: "module.content", remediation: "INSTALL_OR_ENABLE_PLUGIN" }]
    });
  });

  it("distinguishes a missing block version and identifies its owner", () => {
    const versionTwo = { ...createStaticTextBlockDefinition(), version: 2 };
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({
      blocks: [versionTwo],
      sources: [],
      blockCatalog: [{ id: "content.text", version: 2, ownerPluginId: "module.content" }]
    }));
    const result = runtime.render({ document: workspaceDocument({ id: "text-1", type: "content.text", version: 1, props: { text: "Stored" } }), surface: "workspace", actor });
    expect(first(result)).toMatchObject({ reason: "MISSING_BLOCK_VERSION", ownerPluginId: "module.content", remediation: "INSTALL_COMPATIBLE_BLOCK_VERSION" });
  });

  it("reports a missing source and unavailable selected field with owner remediation", () => {
    const definition = createWorkspaceTaskTableBlockDefinition();
    const missingRuntime = createUiDocumentRuntime(createUiRuntimeRegistry({
      blocks: [definition],
      sources: [],
      sourceCatalog: [{ id: "sales.tasks", version: 1, ownerPluginId: "module.sales" }]
    }));
    expect(first(missingRuntime.render({ document: workspaceDocument(taskNode()), surface: "workspace", actor }))).toMatchObject({
      reason: "MISSING_SOURCE",
      ownerPluginId: "module.sales",
      remediation: "RESTORE_SOURCE"
    });

    const selectedFieldRuntime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [definition], sources: [salesTasksDescriptor] }));
    const missingStatus = { ...sourceBinding, selectedFields: ["title", "potential-revenue"] };
    expect(first(selectedFieldRuntime.render({ document: workspaceDocument(taskNode(missingStatus)), surface: "workspace", actor }))).toMatchObject({
      reason: "SOURCE_FIELD_UNAVAILABLE",
      ownerPluginId: "module.sales",
      remediation: "UPDATE_SOURCE_BINDING"
    });
  });

  it("reports incompatible structural hashes and failed document migration", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [createWorkspaceTaskTableBlockDefinition()], sources: [salesTasksDescriptor] }));
    const mismatch = { ...sourceBinding, structuralCompatibilityHash: `sha256:${"a".repeat(64)}` };
    const hashResult = runtime.render({ document: workspaceDocument(taskNode(mismatch)), surface: "workspace", actor });
    expect(first(hashResult)).toMatchObject({ reason: "SOURCE_STRUCTURAL_HASH_MISMATCH", ownerPluginId: "module.sales", remediation: "MIGRATE_DOCUMENT" });

    const migrationResult = runtime.render({ document: { ...workspaceDocument(taskNode()), schemaVersion: 2 }, surface: "workspace", actor });
    expect(migrationResult).toMatchObject({ success: false, code: "DOCUMENT_MIGRATION_FAILED", migrationCode: "UNSUPPORTED_SCHEMA_VERSION", remediation: "MIGRATE_DOCUMENT" });
    expect(inspectUiDocumentReadiness(migrationResult)).toEqual({ ready: false, issues: [{ code: "DOCUMENT_MIGRATION_FAILED", remediation: "MIGRATE_DOCUMENT" }] });
  });
});
