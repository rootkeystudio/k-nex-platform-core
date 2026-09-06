import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createPuckBuilderAdapter, reconcilePuckBlockContribution } from "@k-nex/builder-puck";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeResult } from "@k-nex/ui-runtime";

import {
  salesAccountDetailPageTemplate,
  salesAccountDetailDescriptor,
  salesAccountsDescriptor,
  salesContactDetailDescriptor,
  salesContactsDescriptor,
  salesLeadDetailDescriptor,
  salesLeadsDescriptor,
  salesContactDetailPageTemplate,
  salesLeadDetailPageTemplate,
  salesOpportunitiesDescriptor,
  salesOpportunityDetailDescriptor,
  salesOpportunityDetailBlockDescriptor,
  salesOpportunityDetailComponentDescriptor,
  salesOpportunityDetailPageTemplate,
  salesOpportunityListBlockDescriptor,
  salesPageTemplates,
  salesReferenceMetadata,
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
    "sales.tasks.read", "sales.tasks.write", "sales.opportunities.read", "sales.opportunities.write", "sales.opportunities.archive", "sales.opportunities.close", "sales.opportunities.amount.read", "sales.pipelines.read", "sales.settings.read",
    "sales.accounts.read", "sales.accounts.write", "sales.accounts.archive", "sales.contacts.read", "sales.contacts.write", "sales.contacts.archive", "sales.contacts.channels.read",
    "sales.leads.read", "sales.leads.write", "sales.leads.archive", "sales.leads.qualify", "sales.leads.disqualify", "sales.leads.channels.read", "sales.activities.read", "sales.ownership.write"
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
  rows: [{ key: "4", values: {
    name: { kind: "text", value: "Acme" },
    "stage-id": { kind: "status", value: "discovery" },
    revision: { kind: "integer", value: 7 },
    amount: { kind: "money", value: "200", currency: "USD", scale: 2 }
  } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};
const opportunityDetailData = { ...opportunityData, fields: ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "stage-id", "archive-status", "revision"], rows: opportunityData.rows.map((row) => ({ ...row, values: { name: row.values.name, "owner-id": { kind: "text", value: "owner-1" }, "team-id": { kind: "text", value: "team-1" }, "account-id": { kind: "integer", value: 1 }, "primary-contact-id": { kind: "integer", value: 2 }, "pipeline-id": { kind: "integer", value: 3 }, "stage-id": row.values["stage-id"], "archive-status": { kind: "status", value: "active" }, revision: row.values.revision } })) };
const accountData = { fields: ["name", "owner-id", "status", "revision"], rows: [{ key: "1", values: { name: { kind: "text", value: "Acme" }, "owner-id": { kind: "text", value: "owner-1" }, status: { kind: "status", value: "active" }, revision: { kind: "integer", value: 2 } } }], page: { number: 1, pageSize: 25, hasNext: false } };
const contactData = { fields: ["display-name", "owner-id", "account-id", "status", "revision"], rows: [{ key: "2", values: { "display-name": { kind: "text", value: "Ada" }, "owner-id": { kind: "text", value: "owner-1" }, "account-id": { kind: "integer", value: 1 }, status: { kind: "status", value: "active" }, revision: { kind: "integer", value: 2 } } }], page: { number: 1, pageSize: 25, hasNext: false } };
const leadData = { fields: ["display-name", "owner-id", "status", "archive-status", "revision"], rows: [{ key: "3", values: { "display-name": { kind: "text", value: "Grace" }, "owner-id": { kind: "text", value: "owner-1" }, status: { kind: "status", value: "working" }, "archive-status": { kind: "status", value: "active" }, revision: { kind: "integer", value: 3 } } }], page: { number: 1, pageSize: 25, hasNext: false } };
const accountDetailData = { fields: ["name", "owner-id", "team-id", "status", "revision"], rows: accountData.rows.map((row) => ({ ...row, values: { name: row.values.name, "owner-id": { kind: "text", value: "owner-1" }, "team-id": { kind: "text", value: "team-1" }, status: row.values.status, revision: row.values.revision } })), page: accountData.page };
const contactDetailData = { fields: ["display-name", "owner-id", "team-id", "account-id", "status", "revision"], rows: contactData.rows.map((row) => ({ ...row, values: { "display-name": row.values["display-name"], "owner-id": { kind: "text", value: "owner-1" }, "team-id": { kind: "text", value: "team-1" }, "account-id": { kind: "integer", value: 1 }, status: row.values.status, revision: row.values.revision } })), page: contactData.page };
const leadDetailData = { fields: ["display-name", "owner-id", "team-id", "status", "archive-status", "revision"], rows: leadData.rows.map((row) => ({ ...row, values: { "display-name": row.values["display-name"], "owner-id": { kind: "text", value: "owner-1" }, "team-id": { kind: "text", value: "team-1" }, status: row.values.status, "archive-status": row.values["archive-status"], revision: row.values.revision } })), page: leadData.page };
function sourceFor(definition) {
  const detail = definition.id.includes("detail");
  if (definition.id.includes("account")) return detail ? salesAccountDetailDescriptor : salesAccountsDescriptor;
  if (definition.id.includes("contact")) return detail ? salesContactDetailDescriptor : salesContactsDescriptor;
  if (definition.id.includes("lead")) return detail ? salesLeadDetailDescriptor : salesLeadsDescriptor;
  if (definition.id.includes("opportunity")) return detail ? salesOpportunityDetailDescriptor : salesOpportunitiesDescriptor;
  return salesTasksDescriptor;
}

function nodeFor(bridge) {
  const definition = bridge.definition;
  const sourcePolicy = definition.sourcePolicy;
  const action = definition.actionPolicy?.actions[0];
  const source = sourcePolicy === undefined ? undefined : sourceFor(definition);
  const sourceBinding = source === undefined ? undefined : {
    source: { id: source.id, version: source.version },
    input: source.id.includes(".detail") ? { id: "1" } : {},
    structuralCompatibilityHash: source.structuralCompatibilityHash,
    ...(source.id === salesTasksDescriptor.id ? { selectedFields: ["title", "status"] } : {}),
    ...(source.id === salesOpportunitiesDescriptor.id ? { selectedFields: ["name", "stage-id", "revision", "amount"] } : {})
    ,...(source.id === salesOpportunityDetailDescriptor.id ? { selectedFields: ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "stage-id", "archive-status", "revision"] } : {})
    ,...(source.id === salesAccountDetailDescriptor.id ? { selectedFields: ["name", "owner-id", "team-id", "status", "revision"] } : source.id === salesAccountsDescriptor.id ? { selectedFields: ["name", "owner-id", "status", "revision"] } : {})
    ,...(source.id === salesContactDetailDescriptor.id ? { selectedFields: ["display-name", "owner-id", "team-id", "account-id", "status", "revision"] } : source.id === salesContactsDescriptor.id ? { selectedFields: ["display-name", "owner-id", "account-id", "status", "revision"] } : {})
    ,...(source.id === salesLeadDetailDescriptor.id ? { selectedFields: ["display-name", "owner-id", "team-id", "status", "archive-status", "revision"] } : source.id === salesLeadsDescriptor.id ? { selectedFields: ["display-name", "owner-id", "status", "archive-status", "revision"] } : {})
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
  return { state: "success", data: source.id === salesTasksDescriptor.id ? tableData : source.id === salesAccountDetailDescriptor.id ? accountDetailData : source.id === salesAccountsDescriptor.id ? accountData : source.id === salesContactDetailDescriptor.id ? contactDetailData : source.id === salesContactsDescriptor.id ? contactData : source.id === salesLeadDetailDescriptor.id ? leadDetailData : source.id === salesLeadsDescriptor.id ? leadData : source.id === salesOpportunityDetailDescriptor.id ? opportunityDetailData : opportunityData };
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

test("every Sales UI contribution renders, while only report-safe blocks reconcile into Puck", () => {
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
  assert.deepEqual([...kinds].sort(), ["data-table", "detail", "form", "kanban", "settings-summary", "status"]);
  const assertEquivalentRender = (actual, expected) => {
    assert.deepEqual({ ...actual, element: undefined }, { ...expected, element: undefined });
    assert.equal(renderToStaticMarkup(actual.element), renderToStaticMarkup(expected.element));
  };
  assert.deepEqual(salesPuckBlockBridges.map(({ definition }) => definition.id), ["sales.task-table", "sales.task-quick-create", "sales.opportunity-kanban", "sales.settings-summary"]);
  for (const bridge of salesPuckBlockBridges) {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === bridge.definition.id);
    assert.ok(definition);
    assertEquivalentRender(bridge.definition.render(input), definition.render(input));
  }
});

test("every Sales Puck block preserves source/action authority and DOM role parity", () => {
  const blocks = salesPuckBlockBridges;
  const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: salesUiBlockDefinitions, sources: [salesTasksDescriptor, salesOpportunitiesDescriptor, salesOpportunityDetailDescriptor, salesAccountsDescriptor, salesAccountDetailDescriptor, salesContactsDescriptor, salesContactDetailDescriptor, salesLeadsDescriptor, salesLeadDetailDescriptor] }));

  for (const bridge of blocks) {
    assert.notEqual(bridge, undefined);
    const node = nodeFor(bridge);
    const document = { id: "sales.reference", version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [node] } };
    const result = sourceResultFor(bridge);
    const productionResult = runtime.render({ document, surface: "workspace", actor, sourceResults: { reference: result } });
    assert.equal(productionResult.success, true);
    const renderedNode = productionResult.regions.main[0];
    assert.equal(renderedNode.status, "rendered", `${bridge.definition.id}: ${JSON.stringify(renderedNode)}`);
    const output = renderedNode.output;
    if (node.bindings?.action !== undefined) assert.deepEqual(output.action, node.bindings.action);
    if (result?.state === "success") assert.deepEqual(output.data ?? output.table, result.data);
    const production = presentUiRuntimeReact(presentUiRuntimeResult(productionResult));
    const adapter = createPuckBuilderAdapter({
      blocks: salesPuckBlockBridges,
      preview: {
        surface: "workspace",
        actor,
        sources: [salesTasksDescriptor, salesOpportunitiesDescriptor, salesOpportunityDetailDescriptor, salesAccountsDescriptor, salesAccountDetailDescriptor, salesContactsDescriptor, salesContactDetailDescriptor, salesLeadsDescriptor, salesLeadDetailDescriptor],
        present: presentUiRuntimeReact,
        ...(result === undefined ? {} : { sourceResults: { reference: result } })
      }
    });
    const puckData = adapter.toPuckData(document);
    const editor = adapter.config.components[`${bridge.definition.id}__v${bridge.definition.version}`].render(puckData.content[0].props);
    const productionMarkup = renderToStaticMarkup(production);
    const editorMarkup = renderToStaticMarkup(editor);
    assert.equal(editorMarkup, productionMarkup);
    const componentName = output.kind === "data-table" ? bridge.definition.id.includes("task-table") ? "data-table" : "data-grid"
      : output.kind === "metric" || output.kind === "kanban" || output.kind === "detail" ? "query-boundary"
        : output.kind === "data-list" ? "data-list" : output.kind === "form" ? "form" : "section";
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

test("P13.3 detail UI pre-fills CAS fields and never invents sensitive projection values", () => {
  const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.contact-detail");
  assert.ok(definition);
  const rendered = definition.render({
    node: { id: "contact-detail", type: definition.id, version: definition.version, props: { title: "Contact detail" } },
    props: { title: "Contact detail" }, surface: "workspace",
    actor: { ...actor, permissions: new Set([...actor.permissions].filter((permission) => permission !== "sales.contacts.channels.read")) },
    sourceResult: { state: "success", data: contactData },
    action: { id: "sales.contact.update", version: 2 }, dispatchAction: async () => undefined
  });
  const markup = renderToStaticMarkup(rendered.element);
  assert.match(markup, /role="status" aria-live="polite"/);
  assert.match(markup, /name="id"[^>]*value="2"/);
  assert.match(markup, /name="expectedRevision"[^>]*value="2"/);
  assert.match(markup, /name="displayName"[^>]*value="Ada"/);
  assert.doesNotMatch(markup, /name="emailMode"|name="email"|name="phoneMode"|name="phone"|ada@example/);
});

test("authorized channel edits expose explicit retain set clear modes", () => {
  const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.contact-detail");
  assert.ok(definition);
  const rendered = definition.render({
    node: { id: "contact-detail", type: definition.id, version: definition.version, props: { title: "Contact detail" } },
    props: { title: "Contact detail" }, surface: "workspace", actor, sourceResult: { state: "success", data: contactData },
    action: { id: "sales.contact.update", version: 2 }, dispatchAction: async () => undefined
  });
  const markup = renderToStaticMarkup(rendered.element);
  assert.match(markup, /name="emailMode"/); assert.match(markup, /name="phoneMode"/);
  assert.match(markup, /<option value="retain" selected="">Retain<\/option>/);
  assert.doesNotMatch(markup, /name="email"|name="phone"/);
});

test("contact create channels depend only on current permission, never unrelated list contents", () => {
  const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.contact-list");
  assert.ok(definition);
  const action = definition.actionPolicy.actions.find(({ id }) => id === "sales.contact.create");
  const render = (permissions) => renderToStaticMarkup(definition.render({
    node: { id: "contact-create", type: definition.id, version: definition.version, props: { title: "Create contact" }, bindings: { action } },
    props: { title: "Create contact" }, surface: "workspace", actor: { ...actor, permissions }, sourceResult: { state: "success", data: contactData }, action, dispatchAction: async () => undefined
  }).element);
  const authorized = render(actor.permissions);
  assert.match(authorized, /name="email"/); assert.match(authorized, /name="phone"/);
  for (const field of ["accountId", "displayName", "email", "phone"]) assert.match(authorized, new RegExp(`name="${field}"[^>]*value=""`));
  const denied = render(new Set([...actor.permissions].filter((permission) => permission !== "sales.contacts.channels.read")));
  assert.doesNotMatch(denied, /name="email"|name="phone"/);
});

test("every permitted detail action remains keyboard-reachable with safe target defaults", () => {
  const templates = [salesAccountDetailPageTemplate, salesContactDetailPageTemplate, salesLeadDetailPageTemplate, salesOpportunityDetailPageTemplate];
  const actionIds = new Set();
  const requiredActionIds = new Set();
  for (const template of templates) {
    for (const action of template.requirements.actions) requiredActionIds.add(action.id);
    for (const node of template.document.regions.main.filter((candidate) => candidate.bindings?.action !== undefined)) {
      const definition = salesUiBlockDefinitions.find(({ id }) => id === node.type);
      assert.ok(definition);
      const action = node.bindings.action;
      actionIds.add(action.id);
      const rendered = definition.render({
        node, props: node.props, surface: "workspace", actor,
        sourceResult: { state: "success", data: node.type.includes("account") ? accountData : node.type.includes("contact") ? contactData : node.type.includes("lead") ? leadData : opportunityDetailData },
        action, dispatchAction: async () => undefined
      });
      const markup = renderToStaticMarkup(rendered.element);
      assert.match(markup, /<form\b/);
      assert.match(markup, /<button[^>]*type="submit"/);
      assert.match(markup, /role="status" aria-live="polite"/);
      if (["sales.activity.create", "sales.note.create", "sales.attachment.link"].includes(action.id)) {
        assert.match(markup, /name="relatedRecordId"[^>]*value="[1-4]"/);
      }
      if (action.id === "sales.opportunity.close") assert.match(markup, /name="expectedStage"[^>]*value="discovery"/);
    }
  }
  assert.deepEqual([...actionIds].sort(), [
    "sales.account.archive", "sales.account.update", "sales.activity.create", "sales.attachment.link",
    "sales.contact.archive", "sales.contact.update", "sales.lead.archive", "sales.lead.disqualify", "sales.lead.qualify", "sales.lead.update", "sales.note.create",
    "sales.opportunity.archive", "sales.opportunity.close", "sales.opportunity.stage.update", "sales.opportunity.update", "sales.ownership.assign"
  ]);
  for (const id of ["sales.activity.complete", "sales.activity.cancel", "sales.attachment.remove"]) assert.equal(requiredActionIds.has(id), true);
});

test("fixed detail document renders one structured record surface and action-only secondary nodes", () => {
  const data = { ...accountData, fields: ["name", "owner-id", "team-id", "status", "revision"], rows: accountData.rows.map((row) => ({ ...row, values: { ...row.values, "owner-id": { kind: "text", value: "owner-1" }, "team-id": { kind: "text", value: "team-1" } } })) };
  const sourceResults = Object.fromEntries(salesAccountDetailPageTemplate.document.regions.main.map((node) => [node.id, { state: "success", data }]));
  const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: salesUiBlockDefinitions, sources: [salesAccountDetailDescriptor] }));
  const result = runtime.render({
    document: salesAccountDetailPageTemplate.document, surface: "workspace",
    actor: { ...actor, permissions: new Set([...actor.permissions, "sales.activities.write", "sales.notes.write", "sales.attachments.write"]) },
    sourceResults, dispatchAction: async () => undefined
  });
  assert.equal(result.success, true);
  const markup = renderToStaticMarkup(presentUiRuntimeReact(presentUiRuntimeResult(result)));
  assert.equal((markup.match(/data-page-template-id="sales.page.account-detail"/g) ?? []).length, 1);
  for (const label of ["Summary", "Ownership", "State history", "Authorized actions"]) assert.match(markup, new RegExp(`aria-label="${label}"`));
  assert.match(markup, /aria-label="Account Update"/);
  assert.match(markup, /aria-label="Activity Create"/);
  assert.doesNotMatch(markup, /aria-label="Activity Complete"|aria-label="Activity Cancel"|aria-label="Attachment Remove"/);
});

test("opportunity list exposes its bound create action through labelled native controls", () => {
  const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.opportunity-list");
  assert.ok(definition);
  const action = definition.actionPolicy?.actions.find(({ id }) => id === "sales.opportunity.create");
  assert.ok(action);
  const rendered = definition.render({
    node: { id: "opportunity-list", type: definition.id, version: definition.version, props: { title: "Opportunities" }, bindings: { action } },
    props: { title: "Opportunities" }, surface: "workspace", actor, sourceResult: { state: "success", data: opportunityData }, action, dispatchAction: async () => undefined
  });
  const markup = renderToStaticMarkup(rendered.element);
  for (const label of ["Name", "Account ID", "Pipeline ID", "Stage ID"]) assert.match(markup, new RegExp(`<label[^>]*>${label}</label>`));
  assert.match(markup, /<button[^>]*type="submit"/);
  assert.doesNotMatch(markup, /tabindex="-1"[^>]*name=/);
  assert.match(markup, /role="status" aria-live="polite"/);
  for (const field of ["name", "accountId", "pipelineId"]) assert.match(markup, new RegExp(`name="${field}"[^>]*value=""`));
  assert.match(markup, /name="stageId"[^>]*value="qualification"/);
});

test("ownership assignment pre-fills scoped CAS identity and keeps team optional", () => {
  const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.account-detail");
  assert.ok(definition);
  const action = definition.actionPolicy?.actions.find(({ id }) => id === "sales.ownership.assign");
  assert.ok(action);
  const data = { ...accountData, fields: ["name", "owner-id", "team-id", "status", "revision"], rows: accountData.rows.map((row) => ({ ...row, values: { ...row.values, "owner-id": { kind: "text", value: "owner-1" }, "team-id": { kind: "text", value: "team-1" } } })) };
  const rendered = definition.render({
    node: { id: "ownership", type: definition.id, version: definition.version, props: { title: "Assign ownership" }, bindings: { source: { source: { id: salesAccountDetailDescriptor.id, version: salesAccountDetailDescriptor.version }, input: { id: "account-1" }, structuralCompatibilityHash: salesAccountDetailDescriptor.structuralCompatibilityHash, selectedFields: data.fields }, action } },
    props: { title: "Assign ownership" }, surface: "workspace", actor, sourceResult: { state: "success", data }, action, dispatchAction: async () => undefined
  });
  const markup = renderToStaticMarkup(rendered.element);
  assert.match(markup, /name="recordType"[^>]*value="sales.account"/);
  assert.match(markup, /name="id"[^>]*value="1"/);
  assert.equal((markup.match(/aria-label="Ownership Assign"/g) ?? []).length, 1);
  assert.match(markup, /name="expectedRevision"[^>]*value="2"/);
  assert.match(markup, /name="ownerId"[^>]*value="owner-1"/);
  assert.match(markup, /name="teamId"[^>]*value="team-1"/);
  assert.doesNotMatch(markup, /name="teamId"[^>]*required=/);
  assert.match(markup, /role="status" aria-live="polite"/);
  const denied = definition.render({
    node: { id: "ownership-denied", type: definition.id, version: definition.version, props: { title: "Assign ownership" }, bindings: { action } },
    props: { title: "Assign ownership" }, surface: "workspace", actor: { ...actor, permissions: new Set([...actor.permissions].filter((permission) => permission !== "sales.ownership.write")) }, sourceResult: { state: "success", data }, action, dispatchAction: async () => undefined
  });
  assert.doesNotMatch(renderToStaticMarkup(denied.element), /aria-label="Update Assign ownership"|name="ownerId"/);
});

test("detail contributions preserve stale, refreshing, denied, and error semantics", () => {
  const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.account-detail");
  assert.ok(definition);
  const base = { node: { id: "account-detail", type: definition.id, version: definition.version, props: { title: "Account detail" } }, props: { title: "Account detail" }, surface: "workspace", actor };
  const stale = renderToStaticMarkup(definition.render({ ...base, sourceResult: { state: "stale", data: accountData } }).element);
  const refreshing = renderToStaticMarkup(definition.render({ ...base, sourceResult: { state: "refetching", data: accountData } }).element);
  const denied = renderToStaticMarkup(definition.render({ ...base, sourceResult: { state: "insufficient-permission" } }).element);
  const error = renderToStaticMarkup(definition.render({ ...base, sourceResult: { state: "error", problem: { code: "PRIVATE_FAILURE", status: 500 } } }).element);
  assert.match(stale, /data-state="stale"/); assert.match(stale, /role="status"/);
  assert.match(refreshing, /data-state="refetching"/); assert.match(refreshing, /role="status"/);
  assert.match(denied, /data-state="forbidden"/); assert.match(denied, /role="alert"/);
  assert.match(error, /role="alert"/); assert.doesNotMatch(error, /PRIVATE_FAILURE/);
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
  assert.deepEqual(salesWorkspaceUiContract.sourceIds, ["sales.account.detail", "sales.accounts", "sales.contact.detail", "sales.contacts", "sales.lead.detail", "sales.leads", "sales.opportunities", "sales.opportunity.detail", "sales.tasks", "sales.timeline"]);
  assert.equal(salesWorkspaceUiContract.actionIds.includes("sales.lead.qualify"), true);
  assert.equal(salesWorkspaceUiContract.pageTemplateIds.includes("sales.page.account-detail"), true);
  assert.equal(salesWorkspaceUiContract.routeIds.length >= 10, true);
  assert.equal(salesWorkspaceUiContract.componentIds.length >= 11, true);
  assert.equal(salesWorkspaceUiContract.blockIds.length >= 12, true);
  assert.equal(salesWorkspaceUiContract.componentIds.includes("sales.timeline-view"), false);
  assert.equal(salesWorkspaceUiContract.blockIds.includes("sales.timeline-list"), false);
  for (const template of salesPageTemplates) if (template.migration !== undefined) assert.equal(typeof salesReferenceMetadata.localization.messages[template.migration.notesMessageId], "string");
  const opportunities = salesPageTemplates.find(({ id }) => id === "sales.page.opportunities");
  assert.equal(opportunities.version, 3);
  assert.deepEqual(opportunities.migration.adoptableFromVersions, [1, 2]);
  assert.equal(opportunities.document.regions.main[0].version, 3);
  assert.deepEqual([salesOpportunityDetailComponentDescriptor.version, salesOpportunityListBlockDescriptor.version, salesOpportunityDetailBlockDescriptor.version], [3, 3, 3]);
});
