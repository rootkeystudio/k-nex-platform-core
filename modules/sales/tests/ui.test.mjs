import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createPuckBuilderAdapter, reconcilePuckBlockContribution } from "@k-nex/builder-puck";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeResult } from "@k-nex/ui-runtime";

import {
  salesOpportunitiesDescriptor,
  salesTasksDescriptor
} from "../dist/contracts.js";
import {
  salesTaskTableBlock,
  salesWorkspaceUiContract,
  salesUiBlockDefinitions,
  salesUiComponentDefinitions
} from "../dist/ui.js";
import { salesTaskTablePuckAuthoring, salesPuckBlockBridges } from "../dist/puck.js";

const document = {
  id: "sales.page.tasks",
  version: 2,
  schemaVersion: 1,
  profile: "workspace",
  regions: {
    main: [{
      id: "sales-tasks",
      type: "sales.task-table",
      version: 3,
      props: { title: "Sales tasks" },
      bindings: {
        source: {
          source: { id: "sales.tasks", version: 2 },
          input: {},
          structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash,
          selectedFields: ["title", "status"]
        }
      }
    }]
  }
};
const actor = {
  authenticated: true,
  permissions: new Set([
    "sales.tasks.read", "sales.tasks.write", "sales.opportunities.read", "sales.opportunities.amount.read", "sales.pipelines.read", "sales.settings.read"
  ])
};
const sourceResults = { "sales-tasks": { state: "empty" } };

const tableData = {
  fields: ["title", "status"],
  rows: [{ key: "task-1", values: {
    title: { kind: "text", value: "Follow up" },
    status: { kind: "status", value: "open" }
  } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};
const opportunityData = {
  fields: ["name", "stage-id", "revision", "amount"],
  rows: [{ key: "opportunity-1", values: {
    name: { kind: "text", value: "Acme" },
    "stage-id": { kind: "status", value: "discovery" },
    revision: { kind: "integer", value: 7 },
    amount: { kind: "money", value: "200", currency: "USD", scale: 2 }
  } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};

function sourceFor(definition) {
  if (definition.id.includes("opportunity")) return salesOpportunitiesDescriptor;
  return salesTasksDescriptor;
}

function nodeFor(bridge) {
  const definition = bridge.definition;
  const sourcePolicy = definition.sourcePolicy;
  const action = definition.actionPolicy?.actions[0];
  const source = sourcePolicy === undefined ? undefined : sourceFor(definition);
  const sourceBinding = source === undefined ? undefined : {
    source: { id: source.id, version: source.version },
    input: {},
    structuralCompatibilityHash: source.structuralCompatibilityHash,
    ...(source.id === salesTasksDescriptor.id ? { selectedFields: ["title", "status"] } : {}),
    ...(source.id === salesOpportunitiesDescriptor.id ? { selectedFields: ["name", "stage-id", "revision", "amount"] } : {})
  };
  const bindings = sourceBinding === undefined && action === undefined ? undefined : {
    ...(sourceBinding === undefined ? {} : { source: sourceBinding }),
    ...(action === undefined ? {} : { action })
  };
  return {
    id: "reference",
    type: definition.id,
    version: definition.version,
    props: bridge.defaultProps,
    ...(bindings === undefined ? {} : { bindings })
  };
}

function sourceResultFor(bridge) {
  const source = bridge.definition.sourcePolicy === undefined ? undefined : sourceFor(bridge.definition);
  if (source === undefined) return undefined;
  return { state: "success", data: source.id === salesTasksDescriptor.id ? tableData : opportunityData };
}

test("Sales task table uses the same renderer outside Puck and through its authoring bridge", () => {
  const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [salesTaskTableBlock], sources: [salesTasksDescriptor] }));
  const production = presentUiRuntimeReact(presentUiRuntimeResult(runtime.render({ document, surface: "workspace", actor, sourceResults })));

  const bridge = reconcilePuckBlockContribution(salesTaskTableBlock, salesTaskTablePuckAuthoring);
  const adapter = createPuckBuilderAdapter({ blocks: [bridge], preview: { surface: "workspace", actor, sources: [salesTasksDescriptor], sourceResults, present: presentUiRuntimeReact } });
  const puckData = adapter.toPuckData(document);
  const component = adapter.config.components["sales.task-table__v3"];
  const editor = component.render(puckData.content[0].props);

  const productionMarkup = renderToStaticMarkup(production);
  const editorMarkup = renderToStaticMarkup(editor);
  assert.match(productionMarkup, /data-k-nex-component="query-empty"/);
  assert.equal(editorMarkup, productionMarkup);
  assert.equal(adapter.fromPuckData(puckData).regions.main[0].type, "sales.task-table");
});

test("every Sales UI contribution renders outside the editor and every block reconciles into Puck", () => {
  const input = {
    node: { id: "reference", type: "sales.reference", version: 1, props: { title: "Reference" } },
    props: { title: "Reference" }, surface: "workspace", actor,
    sourceResult: { state: "empty" },
    action: { id: "sales.task.create", version: 2 }
  };
  const kinds = new Set();
  for (const definition of [...salesUiComponentDefinitions, ...salesUiBlockDefinitions]) {
    const rendered = definition.render(input);
    assert.equal(typeof rendered, "object");
    kinds.add(rendered.kind);
    assert.equal(definition.descriptor.requiredStates.length, 4);
    assert.deepEqual(definition.actionPolicy, definition.descriptor.actionPolicy);
  }
  assert.deepEqual([...kinds].sort(), ["data-list", "data-table", "detail", "form", "kanban", "settings-summary", "status"]);
  const assertEquivalentRender = (actual, expected) => {
    assert.deepEqual({ ...actual, element: undefined }, { ...expected, element: undefined });
    assert.equal(renderToStaticMarkup(actual.element), renderToStaticMarkup(expected.element));
  };
  for (const definition of salesUiBlockDefinitions) {
    const bridge = reconcilePuckBlockContribution(definition, salesTaskTablePuckAuthoring);
    assertEquivalentRender(bridge.definition.render(input), definition.render(input));
    assert.equal(bridge.definition.id, definition.id);
  }
  assert.equal(salesPuckBlockBridges.length, salesUiBlockDefinitions.length);
  for (const [index, bridge] of salesPuckBlockBridges.entries()) {
    assert.equal(bridge.definition.id, salesUiBlockDefinitions[index].id);
    assertEquivalentRender(bridge.definition.render(input), salesUiBlockDefinitions[index].render(input));
  }
});

test("every Sales Puck block preserves source/action authority and DOM role parity", () => {
  const blocks = salesUiBlockDefinitions.map((definition) => salesPuckBlockBridges.find((bridge) => bridge.definition.id === definition.id));
  const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: salesUiBlockDefinitions, sources: [salesTasksDescriptor, salesOpportunitiesDescriptor] }));

  for (const bridge of blocks) {
    assert.notEqual(bridge, undefined);
    const node = nodeFor(bridge);
    const document = { id: "sales.reference", version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [node] } };
    const result = sourceResultFor(bridge);
    const productionResult = runtime.render({ document, surface: "workspace", actor, sourceResults: { reference: result } });
    assert.equal(productionResult.success, true);
    const renderedNode = productionResult.regions.main[0];
    assert.equal(renderedNode.status, "rendered");
    const output = renderedNode.output;
    if (node.bindings?.action !== undefined) assert.deepEqual(output.action, node.bindings.action);
    if (result?.state === "success") assert.deepEqual(output.data ?? output.table, result.data);
    const production = presentUiRuntimeReact(presentUiRuntimeResult(productionResult));
    const adapter = createPuckBuilderAdapter({
      blocks: salesPuckBlockBridges,
      preview: {
        surface: "workspace",
        actor,
        sources: [salesTasksDescriptor, salesOpportunitiesDescriptor],
        present: presentUiRuntimeReact,
        ...(result === undefined ? {} : { sourceResults: { reference: result } })
      }
    });
    const puckData = adapter.toPuckData(document);
    const editor = adapter.config.components[`${bridge.definition.id}__v${bridge.definition.version}`].render(puckData.content[0].props);
    const productionMarkup = renderToStaticMarkup(production);
    const editorMarkup = renderToStaticMarkup(editor);
    assert.equal(editorMarkup, productionMarkup);
    const componentName = bridge.definition.id.includes("task-table") ? "data-table"
      : bridge.definition.id.includes("metric") ? "query-boundary"
      : bridge.definition.id.includes("kanban") ? "query-boundary"
      : bridge.definition.id.includes("opportunity") ? (bridge.definition.id.includes("detail") ? "query-boundary" : "data-list")
      : bridge.definition.id.includes("quick-create") ? "form" : "section";
    assert.match(productionMarkup, new RegExp(`data-k-nex-component="${componentName}"`));
    if (bridge.definition.id.includes("task-table")) assert.match(productionMarkup, /<table\b/);
    if (bridge.definition.id.includes("metric")) assert.match(productionMarkup, /role="status"/);
    if (bridge.definition.id.includes("quick-create")) {
      assert.match(productionMarkup, /<form\b/);
      assert.match(productionMarkup, /name="title"/);
      assert.doesNotMatch(productionMarkup, /name="status"/);
      assert.match(productionMarkup, />Create task<\/button>/);
      assert.match(productionMarkup, /disabled=""/);
    }
    if (bridge.definition.id.includes("opportunity")) assert.match(productionMarkup, /<section\b[^>]*aria-label=/);
    if (bridge.definition.id.includes("kanban")) {
      assert.match(productionMarkup, /data-k-nex-component="sales-opportunity-kanban"/);
      assert.match(productionMarkup, /aria-live="polite"/);
    }
  }
});

test("Sales Kanban exposes native pointer and keyboard stage controls only with exact action authority", () => {
  const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.opportunity-kanban");
  assert.ok(definition);
  const rendered = definition.render({
    node: nodeFor(salesPuckBlockBridges.find(({ definition }) => definition.id === "sales.opportunity-kanban")),
    props: { title: "Pipeline" }, surface: "workspace", actor, sourceResult: { state: "success", data: opportunityData },
    action: { id: "sales.opportunity.stage.update", version: 2 }, dispatchAction: async () => undefined
  });
  const markup = renderToStaticMarkup(rendered.element);
  assert.match(markup, /<button[^>]*>Move to proposal<\/button>/);
  assert.doesNotMatch(markup, /Move to qualification/);
  assert.doesNotMatch(markup, /Move to won/);
  assert.match(markup, /role="status" aria-live="polite"/);
});

test("Sales UI contributions expose labelled semantic regions", () => {
  const input = {
    node: { id: "accessible", type: "sales.reference", version: 1, props: { title: "Sales reference" } },
    props: { title: "Sales reference" }, surface: "workspace", actor, sourceResult: { state: "empty" }
  };
  for (const definition of [...salesUiComponentDefinitions, ...salesUiBlockDefinitions]) {
    const rendered = definition.render(input);
    assert.equal(rendered.accessibility.label, "Sales reference");
    assert.equal(["form", "list", "region", "status", "table"].includes(rendered.accessibility.role), true);
  }
});

test("Sales public UI inventory reconciles every canonical source action route page component and block", () => {
  assert.deepEqual(salesWorkspaceUiContract.sourceIds, ["sales.opportunities", "sales.tasks"]);
  assert.deepEqual(salesWorkspaceUiContract.actionIds, ["sales.opportunity.stage.update", "sales.task.create", "sales.task.update"]);
  assert.deepEqual(salesWorkspaceUiContract.pageTemplateIds, ["sales.page.opportunities", "sales.page.overview", "sales.page.settings", "sales.page.tasks"]);
  assert.equal(salesWorkspaceUiContract.routeIds.length, 4);
  assert.equal(salesWorkspaceUiContract.componentIds.length, 5);
  assert.equal(salesWorkspaceUiContract.blockIds.length, 6);
});
