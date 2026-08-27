import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createPuckBuilderAdapter, reconcilePuckBlockContribution } from "@k-nex/builder-puck";
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeResult } from "@k-nex/ui-runtime";

import {
  salesOpportunitiesDescriptor,
  salesTasksDescriptor,
  salesTotalPotentialRevenueDescriptor
} from "../dist/contracts.js";
import {
  salesTaskTableBlock,
  salesTaskTablePuckAuthoring,
  salesPuckBlockBridges,
  salesWorkspaceUiContract,
  salesUiBlockDefinitions,
  salesUiComponentDefinitions
} from "../dist/ui.js";

const document = {
  id: "sales.page.tasks",
  version: 1,
  schemaVersion: 1,
  profile: "workspace",
  regions: {
    main: [{
      id: "sales-tasks",
      type: "sales.task-table",
      version: 2,
      props: { title: "Sales tasks" },
      bindings: {
        source: {
          source: { id: "sales.tasks", version: 1 },
          input: {},
          structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash,
          selectedFields: ["title", "status", "potential-revenue"]
        }
      }
    }]
  }
};
const actor = {
  authenticated: true,
  permissions: new Set([
    "sales.tasks.read", "sales.tasks.title.read", "sales.tasks.status.read", "sales.tasks.revenue.read",
    "sales.tasks.write", "sales.opportunities.read", "sales.opportunities.name.read", "sales.opportunities.stage.read",
    "sales.opportunities.value.read", "sales.settings.read"
  ])
};
const sourceResults = { "sales-tasks": { state: "empty" } };

const tableData = {
  fields: ["title", "status", "potential-revenue"],
  rows: [{ key: "task-1", values: {
    title: { kind: "text", value: "Follow up" },
    status: { kind: "status", value: "open" },
    "potential-revenue": { kind: "money", value: "100", currency: "USD", scale: 2 }
  } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};
const opportunityData = {
  fields: ["name", "stage", "value"],
  rows: [{ key: "opportunity-1", values: {
    name: { kind: "text", value: "Acme" },
    stage: { kind: "status", value: "qualified" },
    value: { kind: "money", value: "200", currency: "USD", scale: 2 }
  } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};

function sourceFor(definition) {
  const contract = definition.descriptor.sourcePolicy?.contracts[0]?.id;
  if (contract === "metric.scalar") return salesTotalPotentialRevenueDescriptor;
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
    ...(source.id === salesTasksDescriptor.id ? { selectedFields: ["title", "status", "potential-revenue"] } : {}),
    ...(source.id === salesOpportunitiesDescriptor.id ? { selectedFields: ["name", "stage", "value"] } : {})
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
  return source.primaryContract.id === "metric.scalar"
    ? { state: "success", data: { value: { kind: "number", value: 42 } } }
    : { state: "success", data: source.id === salesTasksDescriptor.id ? tableData : opportunityData };
}

test("Sales task table uses the same renderer outside Puck and through its authoring bridge", () => {
  const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [salesTaskTableBlock], sources: [salesTasksDescriptor] }));
  const production = presentUiRuntimeResult(runtime.render({ document, surface: "workspace", actor, sourceResults }));

  const bridge = reconcilePuckBlockContribution(salesTaskTableBlock, salesTaskTablePuckAuthoring);
  const adapter = createPuckBuilderAdapter({ blocks: [bridge], preview: { surface: "workspace", actor, sources: [salesTasksDescriptor], sourceResults } });
  const puckData = adapter.toPuckData(document);
  const component = adapter.config.components["sales.task-table__v2"];
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
    action: { id: "sales.task.create", version: 1 }
  };
  const kinds = new Set();
  for (const definition of [...salesUiComponentDefinitions, ...salesUiBlockDefinitions]) {
    const rendered = definition.render(input);
    assert.equal(typeof rendered, "object");
    kinds.add(rendered.kind);
    assert.equal(definition.descriptor.requiredStates.length, 4);
    assert.deepEqual(definition.actionPolicy, definition.descriptor.actionPolicy);
  }
  assert.deepEqual([...kinds].sort(), ["data-list", "data-table", "detail", "form", "metric", "settings-summary", "status"]);
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
  const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: salesUiBlockDefinitions, sources: [salesTasksDescriptor, salesOpportunitiesDescriptor, salesTotalPotentialRevenueDescriptor] }));

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
    const production = presentUiRuntimeResult(productionResult);
    const adapter = createPuckBuilderAdapter({
      blocks: salesPuckBlockBridges,
      preview: {
        surface: "workspace",
        actor,
        sources: [salesTasksDescriptor, salesOpportunitiesDescriptor, salesTotalPotentialRevenueDescriptor],
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
      : bridge.definition.id.includes("opportunity") ? (bridge.definition.id.includes("detail") ? "query-boundary" : "data-list")
      : bridge.definition.id.includes("quick-create") ? "form" : "section";
    assert.match(productionMarkup, new RegExp(`data-k-nex-component="${componentName}"`));
    if (bridge.definition.id.includes("task-table")) assert.match(productionMarkup, /<table\b/);
    if (bridge.definition.id.includes("metric")) assert.match(productionMarkup, /role="status"/);
    if (bridge.definition.id.includes("quick-create")) assert.match(productionMarkup, /<form\b/);
    if (bridge.definition.id.includes("opportunity")) assert.match(productionMarkup, /<section\b[^>]*aria-label=/);
  }
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
  assert.deepEqual(salesWorkspaceUiContract.sourceIds, ["sales.opportunities", "sales.tasks", "sales.total-potential-revenue"]);
  assert.deepEqual(salesWorkspaceUiContract.actionIds, ["sales.opportunity.stage.update", "sales.task.create", "sales.task.update"]);
  assert.deepEqual(salesWorkspaceUiContract.pageTemplateIds, ["sales.page.opportunities", "sales.page.overview", "sales.page.settings", "sales.page.tasks"]);
  assert.equal(salesWorkspaceUiContract.routeIds.length, 4);
  assert.equal(salesWorkspaceUiContract.componentIds.length, 6);
  assert.equal(salesWorkspaceUiContract.blockIds.length, 6);
});
