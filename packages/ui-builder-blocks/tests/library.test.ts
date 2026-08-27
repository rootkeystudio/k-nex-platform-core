import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { canonicalJson, type DataSourceDescriptor } from "@k-nex/contracts";
import { createPuckBuilderAdapter } from "@k-nex/builder-puck";
import { createUiDocumentRuntime, createUiRuntimeRegistry } from "@k-nex/ui-runtime";
import { genericPuckBlockBridges } from "../src/index.js";

const genericFormAction = { id: "content.form.submit", version: 1 } as const;
const genericSource: DataSourceDescriptor = {
  id: "content.records",
  version: 1,
  ownerPluginId: "module.content",
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "content.records.output", version: 1 },
  audience: "public",
  surfaces: ["public"],
  permission: "content.records.read",
  structuralCompatibilityHash: `sha256:${"c".repeat(64)}`,
  presentationMetadataRevision: 1,
  title: "Content records",
  inputFields: [],
  outputFields: [{ id: "value", kind: "text", binding: "required", nullable: false, permission: "content.records.value.read", sortable: false, filterOperators: [] }],
  limits: { maxSelectedFields: 8, maxPageSize: 25, maxFilters: 4, maxSorts: 2, maxBodyBytes: 4096, maxResultBytes: 65536, maxDepth: 4, timeoutMs: 5000, maxConcurrency: 4, ratePerMinute: 60, burst: 10, costClass: "low", maxCost: 10 },
  cacheClass: "public"
};
const genericRecords = {
  fields: ["value"],
  rows: [{ key: "record-1", values: { value: { kind: "text" as const, value: "Published content" } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};

describe("generic Puck block library", () => {
  it("covers the canonical generic block set and round-trips through shared definitions", () => {
    expect(genericPuckBlockBridges.map(({ label }) => label)).toEqual(["Stack", "Grid", "Section", "Heading", "Text", "Card", "Alert", "Tabs", "Accordion", "Metric", "DataTable", "Form", "EmptyState"]);
    const nodes = genericPuckBlockBridges.map((bridge, index) => ({
      id: `generic-${index}`,
      type: bridge.definition.id,
      version: 1,
      props: bridge.defaultProps,
      ...(bridge.allowChildren ? { children: [] } : {}),
      ...(bridge.definition.id === "content.data-table" ? { bindings: { source: { source: { id: genericSource.id, version: genericSource.version }, input: {}, structuralCompatibilityHash: genericSource.structuralCompatibilityHash, selectedFields: ["value"] } } } : {}),
      ...(bridge.definition.id === "content.form" ? { bindings: { action: genericFormAction } } : {})
    }));
    const sourceResults = { "generic-10": { state: "success" as const, data: genericRecords } };
    const actor = { authenticated: false, permissions: new Set<string>() };
    const adapter = createPuckBuilderAdapter({ blocks: genericPuckBlockBridges, preview: { surface: "public", actor, sources: [genericSource], sourceResults } });
    const document = { id: "content.reference", version: 1, schemaVersion: 1 as const, profile: "cms" as const, regions: { main: nodes } };
    const data = adapter.toPuckData(document);
    expect(canonicalJson(adapter.fromPuckData(data))).toBe(canonicalJson(document));
    for (const [index, bridge] of genericPuckBlockBridges.entries()) {
      const editor = (adapter.config.components[`${bridge.definition.id}__v1`] as { render: (props: Record<string, unknown>) => unknown }).render(data.content[index]!.props);
      const node = nodes[index]!;
      const runtime = bridge.definition.render({
        node,
        props: bridge.defaultProps,
        surface: "public",
        actor,
        ...(node.bindings?.source === undefined ? {} : { source: genericSource, sourceResult: sourceResults["generic-10"] }),
        ...(node.bindings?.action === undefined ? {} : { action: genericFormAction })
      });
      expect(runtime).toMatchObject({ kind: bridge.definition.id.slice("content.".length), props: bridge.defaultProps });
      expect(runtime).toHaveProperty("component");
      expect(runtime).toHaveProperty("accessibility.role");
      expect(runtime).toHaveProperty("element");
      const editorMarkup = renderToStaticMarkup(editor as Parameters<typeof renderToStaticMarkup>[0]);
      const runtimeMarkup = renderToStaticMarkup((runtime as { element: Parameters<typeof renderToStaticMarkup>[0] }).element);
      expect(editorMarkup).toBe(runtimeMarkup);
      const componentName = String((runtime as { component: string }).component).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(runtimeMarkup).toContain(`data-k-nex-component="${componentName.replace(/^-/, "")}"`);
      const role = String((runtime as { accessibility: { role: string } }).accessibility.role);
      if (role === "heading") expect(runtimeMarkup).toMatch(/<h[1-6]\b/);
      else if (role === "table") expect(runtimeMarkup).toMatch(/<table\b/);
      else if (role === "form") expect(runtimeMarkup).toMatch(/<form\b/);
      else if (role === "status") expect(runtimeMarkup).toContain('role="status"');
      else if (role === "tablist") expect(runtimeMarkup).toContain('role="tablist"');
      else if (role === "region") expect(runtimeMarkup).toMatch(/<section\b[^>]*aria-label=/);
    }
  });

  it("declares standard source/action policies for the generic data components", () => {
    const table = genericPuckBlockBridges.find(({ definition }) => definition.id === "content.data-table")!;
    const form = genericPuckBlockBridges.find(({ definition }) => definition.id === "content.form")!;
    expect(table.definition.sourcePolicy).toEqual({ required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: [] });
    expect(form.definition.actionPolicy).toEqual({ required: false, actions: [genericFormAction] });
  });

  it("renders a bound DataTable and dispatches only its accepted form action", async () => {
    const table = genericPuckBlockBridges.find(({ definition }) => definition.id === "content.data-table")!;
    const form = genericPuckBlockBridges.find(({ definition }) => definition.id === "content.form")!;
    const tableNode = { id: "table", type: table.definition.id, version: 1, props: table.defaultProps, bindings: { source: { source: { id: genericSource.id, version: genericSource.version }, input: {}, structuralCompatibilityHash: genericSource.structuralCompatibilityHash, selectedFields: ["value"] } } };
    const formNode = { id: "form", type: form.definition.id, version: 1, props: form.defaultProps, bindings: { action: genericFormAction } };
    const actor = { authenticated: false, permissions: new Set<string>() };
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [table.definition, form.definition], sources: [genericSource] }));
    const dispatchAction = vi.fn(async () => ({ ok: true }));
    const result = runtime.render({
      document: { id: "content.bound", version: 1, schemaVersion: 1, profile: "cms", regions: { main: [tableNode, formNode] } },
      surface: "public",
      actor,
      sourceResults: { table: { state: "success", data: genericRecords } },
      dispatchAction
    });
    if (!result.success) throw new Error("Expected generic components to render.");
    const tableOutput = result.regions.main?.[0];
    const formOutput = result.regions.main?.[1];
    expect(tableOutput?.status).toBe("rendered");
    expect(renderToStaticMarkup((tableOutput as { output: { element: Parameters<typeof renderToStaticMarkup>[0] } }).output.element)).toContain('data-k-nex-component="data-table"');
    expect(formOutput?.status).toBe("rendered");
    const formElement = (formOutput as { output: { element: { props: { onSubmit: (values: Readonly<Record<string, string>>) => Promise<void> } } } }).output.element;
    await formElement.props.onSubmit({ value: "hello" });
    expect(dispatchAction).toHaveBeenCalledWith({ action: genericFormAction, input: { value: "hello" }, nodeId: "form" });

    const wrongAction = runtime.render({
      document: { id: "content.bound", version: 1, schemaVersion: 1, profile: "cms", regions: { main: [{ ...formNode, bindings: { action: { id: "content.form.other", version: 1 } } }] } },
      surface: "public",
      actor,
      dispatchAction
    });
    expect(wrongAction.success && wrongAction.regions.main?.[0]).toMatchObject({ status: "fallback", reason: "ACTION_NOT_ACCEPTED" });

    const wrongSource = runtime.render({
      document: { id: "content.bound", version: 1, schemaVersion: 1, profile: "cms", regions: { main: [{ ...tableNode, bindings: { source: { ...tableNode.bindings.source, structuralCompatibilityHash: `sha256:${"d".repeat(64)}` } } }] } },
      surface: "public",
      actor,
      sourceResults: { table: { state: "success", data: genericRecords } }
    });
    expect(wrongSource.success && wrongSource.regions.main?.[0]).toMatchObject({ status: "fallback", reason: "SOURCE_STRUCTURAL_HASH_MISMATCH" });
  });
});
