import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canonicalJson, type UiDocument } from "@k-nex/contracts";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import {
  createStaticTextBlockDefinition,
  createUiDocumentRuntime,
  createUiRuntimeRegistry,
  defineUiContributionBinding,
  presentUiRuntimeResult,
  type UiBlockDefinition
} from "@k-nex/ui-runtime";
import { createPuckBuilderAdapter, reconcilePuckBlockContribution, snapshotPuckBlockBridge, type PuckBlockBridge } from "../src/index.js";

const definition = (id: string): UiBlockDefinition => ({
  id,
  version: 1,
  profiles: ["cms", "workspace"],
  surfaces: ["cms", "public", "workspace"],
  audience: "public",
  propsSchema: { safeParse: (value: unknown) => ({ success: true as const, data: value }) },
  render: ({ props }) => props
});

const card: PuckBlockBridge = {
  definition: definition("content.card"),
  label: "Card",
  fields: [{ prop: "title", label: "Title", kind: "text" }],
  allowChildren: true,
  defaultProps: { title: "New card" },
};
const text: PuckBlockBridge = {
  definition: definition("content.text"),
  label: "Text",
  fields: [{ prop: "text", label: "Text", kind: "textarea" }],
  allowChildren: false,
  defaultProps: { text: "" },
};
const fixture: UiDocument = {
  id: "cms.home",
  version: 1,
  schemaVersion: 1,
  profile: "cms",
  regions: {
    main: [{
      id: "card-1",
      type: "content.card",
      version: 1,
      props: { title: "Welcome", untouched: { enabled: true } },
      layout: { tokens: { spacing: "space.large" } },
      children: [{ id: "text-1", type: "content.text", version: 1, props: { text: "Hello" } }],
      engineMetadata: { "builder.visual": { zone: "main" } }
    }],
    sidebar: [{ id: "text-2", type: "content.text", version: 1, props: { text: "Preserved" } }]
  }
};

describe("Puck builder adapter", () => {
  it("preserves absent, optional, and required action policy identities in bridge snapshots", () => {
    const policies = [
      undefined,
      { required: false, actions: [{ id: "sales.task.create", version: 1 }] },
      { required: true, actions: [{ id: "sales.task.update", version: 2 }] }
    ] as const;
    const snapshots = policies.map((actionPolicy) => snapshotPuckBlockBridge({
      ...text,
      definition: { ...text.definition, ...(actionPolicy === undefined ? {} : { actionPolicy }) }
    }));

    expect(snapshots.map((snapshot) => snapshot.definition.actionPolicy)).toEqual(policies);
  });

  it("deeply snapshots action policy authority", () => {
    const actionPolicy = { required: true, actions: [{ id: "sales.task.create", version: 1 }] };
    const snapshot = snapshotPuckBlockBridge({
      ...text,
      definition: { ...text.definition, actionPolicy }
    });

    actionPolicy.required = false;
    actionPolicy.actions[0]!.id = "sales.task.delete";
    actionPolicy.actions.push({ id: "sales.task.update", version: 1 });

    expect(snapshot.definition.actionPolicy).toEqual({ required: true, actions: [{ id: "sales.task.create", version: 1 }] });
    expect(Object.isFrozen(snapshot.definition.actionPolicy)).toBe(true);
    expect(Object.isFrozen(snapshot.definition.actionPolicy?.actions)).toBe(true);
    expect(Object.isFrozen(snapshot.definition.actionPolicy?.actions[0])).toBe(true);
  });

  it("reconciles canonical block descriptors without replacing the production renderer", () => {
    const bound = defineUiContributionBinding({
      descriptor: {
        id: "sales.task-table",
        version: 2,
        ownerPluginId: "module.sales",
        kind: "block",
        propsSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
        profiles: ["workspace"],
        surfaces: ["workspace"],
        audience: "authenticated",
        permission: "sales.tasks.read",
        actionPolicy: { required: true, actions: [{ id: "sales.task.create", version: 1 }] },
        requiredStates: ["loading", "empty", "error", "forbidden"]
      },
      render: ({ props }) => props
    });
    const bridge = reconcilePuckBlockContribution(bound, {
      label: "Task table",
      fields: [{ prop: "title", label: "Title", kind: "text" }],
      allowChildren: false,
      defaultProps: { title: "Tasks" }
    });
    expect(bridge.definition.descriptor).toEqual(bound.descriptor);
    expect(bridge.definition.actionPolicy).toEqual(bound.actionPolicy);
    expect(bridge.definition.render({ node: {} as never, props: { title: "Outside" }, surface: "workspace", actor: { authenticated: true, permissions: new Set() } }))
      .toEqual({ title: "Outside" });
    expect(() => reconcilePuckBlockContribution({ ...bound, descriptor: { ...bound.descriptor, kind: "component" } }, {
      label: "Task table", fields: [], allowChildren: false, defaultProps: {}
    })).toThrow(/canonical block/);
  });

  it("fails closed in Puck previews for missing or unauthorized action bindings", () => {
    const bound = defineUiContributionBinding({
      descriptor: {
        id: "sales.task-action",
        version: 1,
        ownerPluginId: "module.sales",
        kind: "block",
        propsSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
        profiles: ["workspace"],
        surfaces: ["workspace"],
        audience: "authenticated",
        permission: "sales.tasks.read",
        actionPolicy: { required: true, actions: [{ id: "sales.task.create", version: 1 }] },
        requiredStates: ["loading", "empty", "error", "forbidden"]
      },
      render: ({ props }) => ({ kind: "text", text: String((props as { title: string }).title) })
    });
    const bridge = reconcilePuckBlockContribution(bound, {
      label: "Task action",
      fields: [{ prop: "title", label: "Title", kind: "text" }],
      allowChildren: false,
      defaultProps: { title: "Tasks" }
    });
    const adapter = createPuckBuilderAdapter({
      blocks: [bridge],
      preview: { surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.tasks.read"]) }, present: (value) => value }
    });
    const component = adapter.config.components["sales.task-action__v1"] as { render: (props: Record<string, unknown>) => unknown };
    const preview = (action?: { id: string; version: number }) => {
      const data = adapter.toPuckData({
        id: "workspace.tasks", version: 1, schemaVersion: 1, profile: "workspace",
        regions: { main: [{
          id: "task-action", type: "sales.task-action", version: 1, props: { title: "Tasks" },
          ...(action === undefined ? {} : { bindings: { action } })
        }] }
      });
      return component.render(data.content[0]!.props as Record<string, unknown>);
    };

    expect(preview()).toBe("Unavailable: ACTION_BINDING_REQUIRED");
    expect(preview({ id: "sales.task.delete", version: 1 })).toBe("Unavailable: ACTION_NOT_ACCEPTED");
    expect(preview({ id: "sales.task.create", version: 1 })).toBe("Tasks");
  });

  it("rebinds forged descriptor policies and props validation before Puck snapshots and previews", () => {
    const bound = defineUiContributionBinding({
      descriptor: {
        id: "sales.trusted-puck",
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
      render: ({ props }) => ({ kind: "text", text: String((props as { title: string }).title) })
    });
    const forged = {
      ...bound,
      propsSchema: { safeParse: (value: unknown) => ({ success: true as const, data: value }) },
      sourcePolicy: undefined,
      actionPolicy: { required: false, actions: [{ id: "sales.task.delete", version: 1 }] }
    };
    const authoring = {
      label: "Trusted Puck",
      fields: [{ prop: "title", label: "Title", kind: "text" }] as const,
      allowChildren: false,
      defaultProps: { title: "Task" }
    };
    const snapshot = snapshotPuckBlockBridge({ definition: forged, ...authoring });
    const bridge = reconcilePuckBlockContribution(forged, authoring);
    const adapter = createPuckBuilderAdapter({
      blocks: [bridge],
      preview: { surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.tasks.read"]) }, present: (value) => value }
    });
    const component = adapter.config.components["sales.trusted-puck__v1"] as { render: (props: Record<string, unknown>) => unknown };
    const preview = (title: string, action?: { id: string; version: number }) => {
      const data = adapter.toPuckData({
        id: "workspace.trusted", version: 1, schemaVersion: 1, profile: "workspace",
        regions: { main: [{ id: "trusted-puck", type: "sales.trusted-puck", version: 1, props: { title }, ...(action === undefined ? {} : { bindings: { action } }) }] }
      });
      return component.render(data.content[0]!.props as Record<string, unknown>);
    };

    expect(snapshot.definition.actionPolicy).toEqual({ required: true, actions: [{ id: "sales.task.create", version: 1 }] });
    expect(snapshot.definition.sourcePolicy).toEqual({ required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["title"] });
    expect(snapshot.definition.propsSchema.safeParse({ title: "too long" }).success).toBe(false);
    expect(preview("Task")).toBe("Unavailable: ACTION_BINDING_REQUIRED");
    expect(preview("Task", { id: "sales.task.delete", version: 1 })).toBe("Unavailable: ACTION_NOT_ACCEPTED");
    expect(preview("Task", { id: "sales.task.create", version: 1 })).toBe("Unavailable: SOURCE_BINDING_REQUIRED");
    const edited = structuredClone(adapter.toPuckData({
      id: "workspace.trusted", version: 1, schemaVersion: 1, profile: "workspace",
      regions: { main: [{ id: "trusted-puck", type: "sales.trusted-puck", version: 1, props: { title: "Task" }, bindings: { action: { id: "sales.task.create", version: 1 } } }] }
    })) as { content: Array<{ props: Record<string, unknown> }> };
    edited.content[0]!.props["__kNexField:title"] = "too long";
    expect(component.render(edited.content[0]!.props)).toBe("Unavailable: INVALID_PROPS");
  });

  it("round-trips canonical documents without semantic loss", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [card, text] });
    const puckData = adapter.toPuckData(fixture);
    expect(canonicalJson(adapter.fromPuckData(puckData))).toBe(canonicalJson(fixture));
    expect(JSON.stringify(fixture)).not.toContain("__kNex");
  });

  it("preserves absent, null, and empty optional shapes until the user edits them", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [card] });
    const shapes = [
      { id: "card-absent", type: "content.card", version: 1, props: {} },
      { id: "card-null", type: "content.card", version: 1, props: { title: null }, children: [] }
    ];
    const document = { ...fixture, regions: { main: shapes } };
    expect(canonicalJson(adapter.fromPuckData(adapter.toPuckData(document)))).toBe(canonicalJson(document));
  });

  it("applies an editor field change and survives serialize/reload", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [card, text] });
    const puckData = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ props: Record<string, unknown> }> };
    puckData.content[0].props["__kNexField:title"] = "Edited";
    const edited = adapter.fromPuckData(puckData);
    expect(edited.regions.main[0].props).toEqual({ title: "Edited", untouched: { enabled: true } });
    expect(canonicalJson(adapter.fromPuckData(adapter.toPuckData(edited)))).toBe(canonicalJson(edited));
  });

  it("uses the full runtime policy and shared browser presenter inside and outside Puck", () => {
    const actualText = { ...text, definition: createStaticTextBlockDefinition(), defaultProps: { text: "New text" } };
    const adapter = createPuckBuilderAdapter({ blocks: [actualText] });
    const data = adapter.toPuckData({ ...fixture, regions: { main: [fixture.regions.main[0].children?.[0]!] } });
    const component = adapter.config.components["content.text__v1"] as { render: (props: Record<string, unknown>) => unknown };
    const editorOutput = component.render(data.content[0]!.props);
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [actualText.definition], sources: [] }));
    const production = runtime.render({ document: adapter.fromPuckData(data), surface: "public", actor: { authenticated: false, permissions: new Set() } });
    expect(editorOutput).toBe("Hello");
    expect(presentUiRuntimeResult(production)).toBe(editorOutput);

    const protectedDefinition = {
      ...actualText.definition,
      id: "sales.secure-text",
      profiles: ["workspace"] as const,
      surfaces: ["workspace"] as const,
      audience: "authenticated" as const,
      permission: "sales.secure.read"
    };
    const protectedBridge = { ...actualText, definition: protectedDefinition };
    const protectedAdapter = createPuckBuilderAdapter({
      blocks: [protectedBridge],
      preview: { surface: "workspace", actor: { authenticated: true, permissions: new Set() }, present: (value) => value }
    });
    const protectedData = protectedAdapter.toPuckData({
      id: "workspace.secure", version: 1, schemaVersion: 1, profile: "workspace",
      regions: { main: [{ id: "secure-1", type: "sales.secure-text", version: 1, props: { text: "Private" } }] }
    });
    const protectedComponent = protectedAdapter.config.components["sales.secure-text__v1"] as { render: (props: Record<string, unknown>) => unknown };
    expect(protectedComponent.render(protectedData.content[0]!.props)).toBe("Unavailable: PERMISSION_DENIED");
  });

  it("requires a host for explicit previews and presents React success and fallback roots", () => {
    const reactBridge: PuckBlockBridge = {
      ...text,
      definition: {
        ...text.definition,
        permission: "content.read",
        render: ({ props }) => ({ element: createElement("p", null, String((props as { text: string }).text)) })
      }
    };
    const actor = { authenticated: true, permissions: new Set(["content.read"]) };
    expect(() => createPuckBuilderAdapter({
      blocks: [reactBridge],
      preview: { surface: "workspace", actor } as never
    })).toThrow(/presentation host/);

    const renderPreview = (permissions: ReadonlySet<string>) => {
      const adapter = createPuckBuilderAdapter({
        blocks: [reactBridge],
        preview: { surface: "workspace", actor: { authenticated: true, permissions }, present: presentUiRuntimeReact }
      });
      const data = adapter.toPuckData({
        id: "workspace.react", version: 1, schemaVersion: 1, profile: "workspace",
        regions: { main: [{ id: "react-1", type: "content.text", version: 1, props: { text: "Ready" } }] }
      });
      const component = adapter.config.components["content.text__v1"] as { render: (props: Record<string, unknown>) => unknown };
      return renderToStaticMarkup(component.render(data.content[0]!.props) as Parameters<typeof renderToStaticMarkup>[0]);
    };

    expect(renderPreview(actor.permissions)).toBe("<p>Ready</p>");
    expect(renderPreview(new Set())).toBe("Unavailable: PERMISSION_DENIED");
    const unsafeHost = createPuckBuilderAdapter({
      blocks: [reactBridge],
      preview: { surface: "workspace", actor, present: (value) => value }
    });
    const unsafeData = unsafeHost.toPuckData({
      id: "workspace.unsafe", version: 1, schemaVersion: 1, profile: "workspace",
      regions: { main: [{ id: "unsafe-1", type: "content.text", version: 1, props: { text: "Unsafe" } }] }
    });
    const unsafeComponent = unsafeHost.config.components["content.text__v1"] as { render: (props: Record<string, unknown>) => unknown };
    expect(unsafeComponent.render(unsafeData.content[0]!.props)).toBe("Unavailable: PRESENTATION_HOST_REQUIRED");
    const legacyBridge = { ...reactBridge, definition: { ...text.definition, render: reactBridge.definition.render } };
    const legacy = createPuckBuilderAdapter({ blocks: [legacyBridge] });
    const legacyData = legacy.toPuckData({
      id: "workspace.legacy", version: 1, schemaVersion: 1, profile: "workspace",
      regions: { main: [{ id: "legacy-1", type: "content.text", version: 1, props: { text: "Legacy" } }] }
    });
    const legacyComponent = legacy.config.components["content.text__v1"] as { render: (props: Record<string, unknown>) => unknown };
    expect(legacyComponent.render(legacyData.content[0]!.props)).toBe("Unavailable: PRESENTATION_HOST_REQUIRED");
  });

  it("round-trips a document without the configured canvas region", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [text] });
    const withoutMain = { ...fixture, regions: { sidebar: fixture.regions.sidebar } };
    expect(canonicalJson(adapter.fromPuckData(adapter.toPuckData(withoutMain)))).toBe(canonicalJson(withoutMain));
  });

  it("serializes a palette-added component from canonical defaults", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [text] });
    const data = structuredClone(adapter.toPuckData({ ...fixture, regions: { main: [] } })) as { content: unknown[] };
    const config = adapter.config.components["content.text__v1"] as { defaultProps: Record<string, unknown> };
    data.content.push({ type: "content.text__v1", props: { ...structuredClone(config.defaultProps), id: "text-new" } });
    expect(adapter.fromPuckData(data).regions.main[0]).toMatchObject({ id: "text-new", type: "content.text", props: { text: "" } });
  });

  it("bridges fields and the canonical child slot into Puck config", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [card, text] });
    const components = adapter.config.components as Record<string, { fields: Record<string, { type: string }> }>;
    expect(components["content.card__v1"]?.fields["__kNexField:title"]?.type).toBe("text");
    expect(components["content.card__v1"]?.fields.__kNexChildren?.type).toBe("slot");
    expect(components["content.text__v1"]?.fields.__kNexChildren).toBeUndefined();
  });

  it("rejects unknown, mismatched, and malformed editor data", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [card, text] });
    const unknown = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ type: string; props: Record<string, unknown> }> };
    unknown.content[0].type = "unknown.block__v1";
    expect(() => adapter.fromPuckData(unknown)).toThrow(/Unknown Puck component/);

    const mismatched = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ props: Record<string, any> }> };
    mismatched.content[0].props.__kNexNode.type = "content.text";
    expect(() => adapter.fromPuckData(mismatched)).toThrow(/does not match/);

    const missingField = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ props: Record<string, unknown> }> };
    delete missingField.content[0].props["__kNexField:title"];
    expect(() => adapter.fromPuckData(missingField)).toThrow(/field is missing/);

    const wrongFieldType = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ props: Record<string, unknown> }> };
    wrongFieldType.content[0].props["__kNexField:title"] = 42;
    expect(() => adapter.fromPuckData(wrongFieldType)).toThrow(/invalid value/);
  });

  it("rejects duplicate bridges and child content on leaf blocks", () => {
    expect(() => createPuckBuilderAdapter({ blocks: [card, card] })).toThrow(/Duplicate/);
    const adapter = createPuckBuilderAdapter({ blocks: [text] });
    expect(() => adapter.toPuckData({ ...fixture, regions: { main: [{ ...fixture.regions.main[0], type: "content.text", children: fixture.regions.main[0].children }] } })).toThrow(/does not allow children/);
  });
});
