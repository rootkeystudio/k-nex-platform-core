// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { cloneElement, createElement, Fragment, isValidElement, useState, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canonicalJson, type DataSourceDescriptor } from "@k-nex/contracts";
import { createPuckBuilderAdapter, type PuckBlockBridge } from "@k-nex/builder-puck";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeNode, presentUiRuntimeNodeWithIdentity, presentUiRuntimeResult } from "@k-nex/ui-runtime";
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

type EditorComponent = { readonly type: string; readonly props: Record<string, unknown> };

function StatefulInput({ label }: { readonly label: string }) {
  const [value, setValue] = useState(label);
  return createElement("label", null, label, createElement("input", {
    "aria-label": label,
    value,
    onChange: (event: { readonly target: { readonly value: string } }) => setValue(event.target.value)
  }));
}

const statefulBridge: PuckBlockBridge = {
  definition: {
    id: "content.stateful-proof",
    version: 1,
    profiles: ["cms"],
    surfaces: ["public"],
    audience: "public",
    propsSchema: { safeParse(value: unknown) {
      if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || typeof (value as { label?: unknown }).label !== "string") {
        return { success: false as const, error: new TypeError("invalid") };
      }
      return { success: true as const, data: { label: (value as { label: string }).label } };
    } },
    render: ({ props }) => ({ element: createElement(StatefulInput, { label: (props as { label: string }).label }) })
  },
  label: "Stateful proof",
  fields: [{ prop: "label", label: "Label", kind: "text" }],
  allowChildren: false,
  defaultProps: { label: "Stateful" }
};

const nonComposableBridge: PuckBlockBridge = {
  definition: {
    id: "content.non-composable-proof",
    version: 1,
    profiles: ["cms"],
    surfaces: ["public"],
    audience: "public",
    propsSchema: { safeParse(value: unknown) {
      return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { label?: unknown }).label === "Parent"
        ? { success: true as const, data: { label: "Parent" } }
        : { success: false as const, error: new TypeError("invalid") };
    } },
    render: () => ({ element: createElement("div", null, "Parent") })
  },
  label: "Non-composable proof",
  fields: [{ prop: "label", label: "Label", kind: "text" }],
  allowChildren: true,
  defaultProps: { label: "Parent" }
};

afterEach(cleanup);

describe("generic Puck block library", () => {
  const actor = { authenticated: false, permissions: new Set<string>() };
  const nestedBridge = (id: string) => genericPuckBlockBridges.find(({ definition }) => definition.id === id)!;
  const renderEditorComponent = (adapter: ReturnType<typeof createPuckBuilderAdapter>, component: EditorComponent): unknown => {
    const definition = adapter.config.components[component.type] as { render: (props: Record<string, unknown>) => unknown };
    const storedChildren = component.props.__kNexChildren;
    const renderedChildren = Array.isArray(storedChildren)
      ? storedChildren.map((child) => {
        const stored = child as { readonly type: string; readonly props: Record<string, unknown> };
        const rendered = renderEditorComponent(adapter, stored);
        const key = String(stored.props.id);
        return isValidElement(rendered) ? cloneElement(rendered, { key }) : createElement(Fragment, { key }, rendered as ReactNode);
      })
      : [];
    return definition.render({ ...component.props, __kNexChildren: renderedChildren });
  };
  const renderEditorRoots = (adapter: ReturnType<typeof createPuckBuilderAdapter>, components: readonly EditorComponent[]): ReactNode =>
    components.map((component) => {
      const rendered = renderEditorComponent(adapter, component);
      const key = String(component.props.id);
      return isValidElement(rendered) ? cloneElement(rendered, { key }) : createElement(Fragment, { key }, rendered as ReactNode);
    });

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
    const adapter = createPuckBuilderAdapter({ blocks: genericPuckBlockBridges, preview: { surface: "public", actor, sources: [genericSource], sourceResults, present: presentUiRuntimeReact } });
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
      const runtimeMarkup = renderToStaticMarkup(presentUiRuntimeReact(presentUiRuntimeNodeWithIdentity({
        status: "rendered",
        nodeId: node.id,
        blockId: bridge.definition.id,
        blockVersion: bridge.definition.version,
        output: runtime,
        children: []
      })) as Parameters<typeof renderToStaticMarkup>[0]);
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

  it("escapes persisted text props in editor preview and production output", () => {
    const text = nestedBridge("content.text");
    const unsafe = '<img src=x onerror="alert(1)">';
    const node = { id: "unsafe-text", type: text.definition.id, version: 1, props: { text: unsafe } };
    const output = text.definition.render({ node, props: node.props, surface: "public", actor });
    const markup = renderToStaticMarkup(output.element as Parameters<typeof renderToStaticMarkup>[0]);
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
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
    const adapter = createPuckBuilderAdapter({ blocks: genericPuckBlockBridges, preview: { surface: "public", actor, present: presentUiRuntimeReact } });
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: genericPuckBlockBridges.map(({ definition }) => definition), sources: [] }));

    for (const candidate of documents) {
      const document = { id: candidate.id, version: 1, schemaVersion: 1 as const, profile: "cms" as const, regions: { main: [candidate.root] } };
      const data = adapter.toPuckData(document);
      const reloaded = adapter.fromPuckData(data);
      expect(canonicalJson(reloaded)).toBe(canonicalJson(document));
      const production = runtime.render({ document: reloaded, surface: "public", actor });
      const productionMarkup = renderToStaticMarkup(presentUiRuntimeReact(presentUiRuntimeResult(production)) as Parameters<typeof renderToStaticMarkup>[0]);
      const editorMarkup = renderToStaticMarkup(renderEditorComponent(adapter, data.content[0] as { readonly type: string; readonly props: Record<string, unknown> }) as Parameters<typeof renderToStaticMarkup>[0]);
      expect(editorMarkup).toBe(productionMarkup);
    }

    const stackMarkup = renderToStaticMarkup(presentUiRuntimeReact(presentUiRuntimeResult(runtime.render({ document: adapter.fromPuckData(adapter.toPuckData({ id: "content.nested-stack", version: 1, schemaVersion: 1, profile: "cms", regions: { main: [documents[0]!.root] } })), surface: "public", actor }))) as Parameters<typeof renderToStaticMarkup>[0]);
    expect(stackMarkup).toMatch(/data-k-nex-component="stack"[\s\S]*data-k-nex-component="card"[\s\S]*Nested text/);
  });

  it("keeps nested state with canonical node IDs after production and Puck reorder", () => {
    const stack = nestedBridge("content.stack");
    const bridges = [stack, statefulBridge];
    const adapter = createPuckBuilderAdapter({ blocks: bridges, preview: { surface: "public", actor, present: presentUiRuntimeReact } });
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: bridges.map(({ definition }) => definition), sources: [] }));
    const child = (id: string, label: string) => ({ id, type: statefulBridge.definition.id, version: 1, props: { label } });
    const root = { id: "stateful-stack", type: stack.definition.id, version: 1, props: stack.defaultProps, children: [child("alpha", "Alpha"), child("beta", "Beta")] };
    const document = { id: "content.stateful-reorder", version: 1, schemaVersion: 1 as const, profile: "cms" as const, regions: { main: [root] } };
    const reordered = { ...document, regions: { main: [{ ...root, children: [root.children[1]!, root.children[0]!] }] } };
    const present = (value: unknown) => presentUiRuntimeReact(presentUiRuntimeResult(runtime.render({ document: value, surface: "public", actor }))) as Parameters<typeof render>[0];
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const production = render(present(document));
      fireEvent.change(production.getByLabelText("Alpha"), { target: { value: "alpha-production" } });
      fireEvent.change(production.getByLabelText("Beta"), { target: { value: "beta-production" } });
      production.rerender(present(reordered));
      expect((production.getByLabelText("Alpha") as HTMLInputElement).value).toBe("alpha-production");
      expect((production.getByLabelText("Beta") as HTMLInputElement).value).toBe("beta-production");
      production.unmount();

      const initialData = adapter.toPuckData(document);
      const reloaded = adapter.fromPuckData(initialData);
      const reloadedRoot = reloaded.regions.main![0]!;
      const reloadedChildren = reloadedRoot.children!;
      const reorderedReload = { ...reloaded, regions: { ...reloaded.regions, main: [{ ...reloadedRoot, children: [reloadedChildren[1]!, reloadedChildren[0]!] }] } };
      const preview = render(renderEditorComponent(adapter, initialData.content[0] as { readonly type: string; readonly props: Record<string, unknown> }) as Parameters<typeof render>[0]);
      fireEvent.change(preview.getByLabelText("Alpha"), { target: { value: "alpha-preview" } });
      fireEvent.change(preview.getByLabelText("Beta"), { target: { value: "beta-preview" } });
      const reorderedData = adapter.toPuckData(reorderedReload);
      preview.rerender(renderEditorComponent(adapter, reorderedData.content[0] as { readonly type: string; readonly props: Record<string, unknown> }) as Parameters<typeof render>[0]);
      expect((preview.getByLabelText("Alpha") as HTMLInputElement).value).toBe("alpha-preview");
      expect((preview.getByLabelText("Beta") as HTMLInputElement).value).toBe("beta-preview");

      const productionResult = runtime.render({ document, surface: "public", actor });
      if (!productionResult.success) throw new Error("Expected production presentation.");
      render(presentUiRuntimeReact(presentUiRuntimeNode(productionResult.regions.main![0]!, [createElement("span", { key: "alpha" }, "Injected")])) as Parameters<typeof render>[0]);
      expect(warning.mock.calls.flat().join(" ")).not.toContain('unique "key"');
    } finally {
      warning.mockRestore();
    }
  });

  it("keeps same-type region-root state with canonical node IDs after production and Puck reorder", () => {
    const bridges = [statefulBridge];
    const adapter = createPuckBuilderAdapter({ blocks: bridges, preview: { surface: "public", actor, present: presentUiRuntimeReact } });
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: bridges.map(({ definition }) => definition), sources: [] }));
    const root = (id: string, label: string) => ({ id, type: statefulBridge.definition.id, version: 1, props: { label } });
    const document = { id: "content.stateful-roots", version: 1, schemaVersion: 1 as const, profile: "cms" as const, regions: { main: [root("alpha", "Alpha"), root("beta", "Beta")] } };
    const reordered = { ...document, regions: { main: [document.regions.main[1]!, document.regions.main[0]!] } };
    const present = (value: unknown) => presentUiRuntimeReact(presentUiRuntimeResult(runtime.render({ document: value, surface: "public", actor }))) as Parameters<typeof render>[0];
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const production = render(present(document));
      fireEvent.change(production.getByLabelText("Alpha"), { target: { value: "alpha-production" } });
      fireEvent.change(production.getByLabelText("Beta"), { target: { value: "beta-production" } });
      production.rerender(present(reordered));
      expect((production.getByLabelText("Alpha") as HTMLInputElement).value).toBe("alpha-production");
      expect((production.getByLabelText("Beta") as HTMLInputElement).value).toBe("beta-production");
      production.unmount();

      const initialData = adapter.toPuckData(document);
      const reloaded = adapter.fromPuckData(initialData);
      const reorderedData = adapter.toPuckData({ ...reloaded, regions: { ...reloaded.regions, main: [reloaded.regions.main![1]!, reloaded.regions.main![0]!] } });
      const preview = render(renderEditorRoots(adapter, initialData.content as readonly EditorComponent[]) as Parameters<typeof render>[0]);
      fireEvent.change(preview.getByLabelText("Alpha"), { target: { value: "alpha-preview" } });
      fireEvent.change(preview.getByLabelText("Beta"), { target: { value: "beta-preview" } });
      preview.rerender(renderEditorRoots(adapter, reorderedData.content as readonly EditorComponent[]) as Parameters<typeof render>[0]);
      expect((preview.getByLabelText("Alpha") as HTMLInputElement).value).toBe("alpha-preview");
      expect((preview.getByLabelText("Beta") as HTMLInputElement).value).toBe("beta-preview");
      expect(warning.mock.calls.flat().join(" ")).not.toContain('unique "key"');
    } finally {
      warning.mockRestore();
    }
  });

  it("keeps child state below fallback and non-composable parents without key warnings", () => {
    const bridges = [nonComposableBridge, statefulBridge];
    const adapter = createPuckBuilderAdapter({ blocks: bridges, preview: { surface: "public", actor, present: presentUiRuntimeReact } });
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: bridges.map(({ definition }) => definition), sources: [] }));
    const fallbackRuntime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [statefulBridge.definition], sources: [] }));
    const child = (id: string, label: string) => ({ id, type: statefulBridge.definition.id, version: 1, props: { label } });
    const parent = (type: string) => ({ id: "parent", type, version: 1, props: type === nonComposableBridge.definition.id ? { label: "Parent" } : {}, children: [child("alpha", "Alpha"), child("beta", "Beta")] });
    const document = (type: string) => ({ id: `content.${type}`, version: 1, schemaVersion: 1 as const, profile: "cms" as const, regions: { main: [parent(type)] } });
    const reorder = (value: ReturnType<typeof document>) => ({ ...value, regions: { main: [{ ...value.regions.main[0]!, children: [value.regions.main[0]!.children[1]!, value.regions.main[0]!.children[0]!] }] } });
    const present = (value: unknown, selectedRuntime = runtime) => presentUiRuntimeReact(presentUiRuntimeResult(selectedRuntime.render({ document: value, surface: "public", actor }))) as Parameters<typeof render>[0];
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      for (const [type, selectedRuntime] of [[nonComposableBridge.definition.id, runtime], ["content.missing-proof", fallbackRuntime]] as const) {
        const initial = document(type);
        const production = render(present(initial, selectedRuntime));
        fireEvent.change(production.getByLabelText("Alpha"), { target: { value: `${type}-alpha` } });
        fireEvent.change(production.getByLabelText("Beta"), { target: { value: `${type}-beta` } });
        production.rerender(present(reorder(initial), selectedRuntime));
        expect((production.getByLabelText("Alpha") as HTMLInputElement).value).toBe(`${type}-alpha`);
        expect((production.getByLabelText("Beta") as HTMLInputElement).value).toBe(`${type}-beta`);
        production.unmount();
      }

      const initial = document(nonComposableBridge.definition.id);
      const initialData = adapter.toPuckData(initial);
      const reloaded = adapter.fromPuckData(initialData);
      const reorderedData = adapter.toPuckData(reorder(reloaded as ReturnType<typeof document>));
      const preview = render(renderEditorComponent(adapter, initialData.content[0] as EditorComponent) as Parameters<typeof render>[0]);
      fireEvent.change(preview.getByLabelText("Alpha"), { target: { value: "alpha-preview" } });
      fireEvent.change(preview.getByLabelText("Beta"), { target: { value: "beta-preview" } });
      preview.rerender(renderEditorComponent(adapter, reorderedData.content[0] as EditorComponent) as Parameters<typeof render>[0]);
      expect((preview.getByLabelText("Alpha") as HTMLInputElement).value).toBe("alpha-preview");
      expect((preview.getByLabelText("Beta") as HTMLInputElement).value).toBe("beta-preview");
      expect(warning.mock.calls.flat().join(" ")).not.toContain('unique "key"');
    } finally {
      warning.mockRestore();
    }
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
