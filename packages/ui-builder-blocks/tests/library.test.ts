import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { canonicalJson, type DataSourceDescriptor } from "@k-nex/contracts";
import { createPuckBuilderAdapter } from "@k-nex/builder-puck";
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeResult } from "@k-nex/ui-runtime";
import { createGenericPuckBlockBridges, genericPuckBlockBridges } from "../src/index.js";

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
  paginationModes: ["offset"],
  limits: { maxSelectedFields: 8, maxPageSize: 25, maxFilters: 4, maxSorts: 2, maxBodyBytes: 4096, maxResultBytes: 65536, maxDepth: 4, timeoutMs: 5000, maxConcurrency: 4, ratePerMinute: 60, burst: 10, costClass: "low", maxCost: 10 },
  cacheClass: "public"
};
const genericRecords = {
  fields: ["value"],
  rows: [{ key: "record-1", values: { value: { kind: "text" as const, value: "Published content" } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};
const typedSource: DataSourceDescriptor = {
  ...genericSource,
  id: "content.typed-records",
  sourceSchema: { id: "content.typed-records.output", version: 1 },
  inputFields: [
    { id: "text", kind: "string", required: true, nullable: false },
    { id: "count", kind: "integer", required: true, nullable: false },
    { id: "ratio", kind: "number", required: true, nullable: false },
    { id: "enabled", kind: "boolean", required: true, nullable: false },
    { id: "date", kind: "date", required: true, nullable: false },
    { id: "datetime", kind: "datetime", required: true, nullable: false },
    { id: "choice", kind: "enum", required: true, nullable: false }
  ]
};

describe("generic Puck block library", () => {
  const actor = { authenticated: false, permissions: new Set<string>() };
  const nestedBridge = (id: string) => genericPuckBlockBridges.find(({ definition }) => definition.id === id)!;
  const renderEditorComponent = (adapter: ReturnType<typeof createPuckBuilderAdapter>, component: { readonly type: string; readonly props: Record<string, unknown> }): unknown => {
    const definition = adapter.config.components[component.type] as { render: (props: Record<string, unknown>) => unknown };
    const storedChildren = component.props.__kNexChildren;
    const renderedChildren = Array.isArray(storedChildren)
      ? storedChildren.map((child) => renderEditorComponent(adapter, child as { readonly type: string; readonly props: Record<string, unknown> }))
      : [];
    return definition.render({ ...component.props, __kNexChildren: renderedChildren });
  };

  it("covers the canonical generic block set and round-trips through shared definitions", () => {
    expect(genericPuckBlockBridges.map(({ label }) => label)).toEqual(["Stack", "Grid", "Section", "Heading", "Text", "Card", "Alert", "Tabs", "Accordion", "Metric", "DataTable", "Form", "EmptyState"]);
    const nodes = genericPuckBlockBridges.map((bridge, index) => ({
      id: `generic-${index}`,
      type: bridge.definition.id,
      version: 1,
      props: bridge.defaultProps,
      ...(bridge.allowChildren ? { children: [] } : {}),
      ...(bridge.definition.id === "content.data-table" ? { bindings: { source: { source: { id: genericSource.id, version: genericSource.version }, input: {}, structuralCompatibilityHash: genericSource.structuralCompatibilityHash, selectedFields: ["value"] } } } : {}),
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
    expect(form.definition.actionPolicy).toBeUndefined();
  });

  it("preserves nested container DOM hierarchy in production and Puck preview after reload", () => {
    const text = nestedBridge("content.text");
    const card = nestedBridge("content.card");
    const stack = nestedBridge("content.stack");
    const tabs = nestedBridge("content.tabs");
    const accordion = nestedBridge("content.accordion");
    const textNode = (id: string, value: string) => ({ id, type: text.definition.id, version: 1, props: { text: value } });
    const documents = [
      { id: "content.nested-stack", root: { id: "stack", type: stack.definition.id, version: 1, props: stack.defaultProps, children: [{ id: "card", type: card.definition.id, version: 1, props: card.defaultProps, children: [textNode("text", "Nested text")] }] } },
      { id: "content.nested-tabs", root: { id: "tabs", type: tabs.definition.id, version: 1, props: tabs.defaultProps, children: [textNode("tab-text", "Tab content")] } },
      { id: "content.nested-accordion", root: { id: "accordion", type: accordion.definition.id, version: 1, props: accordion.defaultProps, children: [textNode("accordion-text", "Accordion content")] } }
    ];
    const adapter = createPuckBuilderAdapter({ blocks: genericPuckBlockBridges, preview: { surface: "public", actor } });
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: genericPuckBlockBridges.map(({ definition }) => definition), sources: [] }));

    for (const candidate of documents) {
      const document = { id: candidate.id, version: 1, schemaVersion: 1 as const, profile: "cms" as const, regions: { main: [candidate.root] } };
      const data = adapter.toPuckData(document);
      const reloaded = adapter.fromPuckData(data);
      expect(canonicalJson(reloaded)).toBe(canonicalJson(document));
      const production = runtime.render({ document: reloaded, surface: "public", actor });
      const productionMarkup = renderToStaticMarkup(presentUiRuntimeResult(production) as Parameters<typeof renderToStaticMarkup>[0]);
      const editorMarkup = renderToStaticMarkup(renderEditorComponent(adapter, data.content[0] as { readonly type: string; readonly props: Record<string, unknown> }) as Parameters<typeof renderToStaticMarkup>[0]);
      expect(editorMarkup).toBe(productionMarkup);
    }

    const stackMarkup = renderToStaticMarkup(presentUiRuntimeResult(runtime.render({ document: adapter.fromPuckData(adapter.toPuckData({ id: "content.nested-stack", version: 1, schemaVersion: 1, profile: "cms", regions: { main: [documents[0]!.root] } })), surface: "public", actor })) as Parameters<typeof renderToStaticMarkup>[0]);
    expect(stackMarkup).toMatch(/data-k-nex-component="stack"[\s\S]*data-k-nex-component="card"[\s\S]*Nested text/);
  });

  it("renders a bound DataTable and keeps an unconfigured form disabled", () => {
    const table = genericPuckBlockBridges.find(({ definition }) => definition.id === "content.data-table")!;
    const form = genericPuckBlockBridges.find(({ definition }) => definition.id === "content.form")!;
    const tableNode = { id: "table", type: table.definition.id, version: 1, props: table.defaultProps, bindings: { source: { source: { id: genericSource.id, version: genericSource.version }, input: {}, structuralCompatibilityHash: genericSource.structuralCompatibilityHash, selectedFields: ["value"] } } };
    const formNode = { id: "form", type: form.definition.id, version: 1, props: form.defaultProps };
    const actor = { authenticated: false, permissions: new Set<string>() };
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [table.definition, form.definition], sources: [genericSource] }));
    const result = runtime.render({
      document: { id: "content.bound", version: 1, schemaVersion: 1, profile: "cms", regions: { main: [tableNode, formNode] } },
      surface: "public",
      actor,
      sourceResults: { table: { state: "success", data: genericRecords } }
    });
    if (!result.success) throw new Error("Expected generic components to render.");
    const tableOutput = result.regions.main?.[0];
    const formOutput = result.regions.main?.[1];
    expect(tableOutput?.status).toBe("rendered");
    expect(renderToStaticMarkup((tableOutput as { output: { element: Parameters<typeof renderToStaticMarkup>[0] } }).output.element)).toContain('data-k-nex-component="data-table"');
    expect(formOutput?.status).toBe("rendered");
    const formElement = (formOutput as { output: { element: Parameters<typeof renderToStaticMarkup>[0] } }).output.element;
    expect(renderToStaticMarkup(formElement)).toMatch(/<button[^>]*disabled/);

    const wrongSource = runtime.render({
      document: { id: "content.bound", version: 1, schemaVersion: 1, profile: "cms", regions: { main: [{ ...tableNode, bindings: { source: { ...tableNode.bindings.source, structuralCompatibilityHash: `sha256:${"d".repeat(64)}` } } }] } },
      surface: "public",
      actor,
      sourceResults: { table: { state: "success", data: genericRecords } }
    });
    expect(wrongSource.success && wrongSource.regions.main?.[0]).toMatchObject({ status: "fallback", reason: "SOURCE_STRUCTURAL_HASH_MISMATCH" });
  });

  it("accepts an explicit action configuration without inventing action authority", () => {
    const bridges = createGenericPuckBlockBridges({ form: {
      action: { id: "sales.task.create", version: 1 },
      fields: [{ name: "title", label: "Title", kind: "text", required: true }],
      initialValues: { title: "" },
      submitLabel: "Create"
    } });
    expect(bridges.find(({ definition }) => definition.id === "content.form")?.definition.actionPolicy).toEqual({ required: false, actions: [{ id: "sales.task.create", version: 1 }] });
    expect(() => createGenericPuckBlockBridges({ form: {
      action: { id: "not registered", version: 0 }, fields: [{ name: "title", label: "Title", kind: "text" }], initialValues: { title: "" }, submitLabel: "Submit"
    } })).toThrow("Generic form action identity is invalid.");
  });

  it("validates every standard source input kind, including boolean", async () => {
    const table = genericPuckBlockBridges.find(({ definition }) => definition.id === "content.data-table")!;
    const input = { text: "hello", count: 2, ratio: 1.5, enabled: true, date: "2026-08-27", datetime: "2026-08-27T00:00:00Z", choice: "one" };
    const node = { id: "typed-table", type: table.definition.id, version: 1, props: table.defaultProps, bindings: { source: { source: { id: typedSource.id, version: typedSource.version }, input, structuralCompatibilityHash: typedSource.structuralCompatibilityHash, selectedFields: ["value"] } } };
    const output = table.definition.render({ node, props: table.defaultProps, surface: "public", actor: { authenticated: false, permissions: new Set() }, source: typedSource, sourceResult: { state: "idle" } }) as { element: { props: { definition: { query: { execute: (transport: unknown, value: unknown, context: unknown) => Promise<unknown> } } } } };
    const query = output.element.props.definition.query;
    expect(query).toBeDefined();
    const context = { surface: "public", authorizationBoundary: { kind: "public", revision: "test" }, signal: new AbortController().signal };
    const transport = { query: async () => ({ ok: true, data: genericRecords }), mutate: async () => ({ ok: true, data: {} }) };
    await expect(query.execute(transport, input, context)).resolves.toEqual({ state: "success", data: genericRecords });
    for (const [field, value] of Object.entries({ text: 1, count: 1.5, ratio: "1.5", enabled: "true", date: 1, datetime: 1, choice: 1 })) {
      await expect(query.execute(transport, { ...input, [field]: value }, context)).resolves.toEqual({ state: "invalid-contract" });
    }
  });
});
