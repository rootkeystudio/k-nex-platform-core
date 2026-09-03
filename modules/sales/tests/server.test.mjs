import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ActionDescriptorSchema,
  AgentToolDescriptorSchema,
  DataSourceDescriptorSchema,
  AuthorizationPermissionDescriptorSchema,
  PermissionPolicyBindingSchema,
  PluginManifestSchema,
  PluginNavigationDescriptorSchema,
  PluginPageTemplateDescriptorSchema,
  PluginRouteDescriptorSchema,
  SystemSettingsDescriptorSchema,
  PluginUiContributionDescriptorSchema,
  RoleTemplateSchema,
  canonicalJson
} from "@k-nex/contracts";
import salesManifest from "../k-nex.plugin.json" with { type: "json" };

import {
  salesCreateTaskToolDescriptor,
  salesEventDescriptors,
  salesNavigationDescriptors,
  salesOpportunitiesDescriptor,
  salesPermissionDescriptors,
  salesPermissionPolicyBindings,
  salesRealtimeTopicDescriptors,
  salesRouteDescriptors,
  salesRoleTemplates,
  salesSearchTasksDescriptor,
  salesTaskCreateDescriptor,
  salesTaskUpdateDescriptor,
  salesOpportunityStageUpdateDescriptor,
  salesPageTemplates,
  salesUiBlockDescriptors,
  salesUiComponentDescriptors,
  salesTaskTableBlockDescriptor,
  salesTaskTableComponentDescriptor,
  salesTaskPageTemplate,
  salesTasksDescriptor,
  salesTotalPotentialRevenueDescriptor,
  salesWorkspaceSettingsDescriptor
} from "../dist/contracts.js";
import {
  createSalesRealtimeRelay,
  salesDefaultSettings,
  salesOpportunitiesHandler,
  salesOpportunityStageUpdateHandler,
  salesRegistration,
  salesTaskCreateDefinition,
  salesTaskCreateHandler,
  salesTaskUpdateHandler,
  salesTasksDefinition,
  salesTasksHandler,
  salesTotalPotentialRevenueDefinition,
  salesTotalPotentialRevenueHandler
} from "../dist/server.js";

function handlerContext(overrides = {}) {
  return {
    actor: { principal: { kind: "user", id: "user-1" }, effectiveActor: { kind: "user", id: "user-1" } },
    request: {
      payload: { find: async () => ({ docs: [], hasNextPage: false }) },
      locale: "en-US",
      transactionID: "tx-7"
    },
    input: {},
    query: { page: { number: 1, size: 25 }, filters: [], sort: [] },
    selectedFields: ["title", "status"],
    recordScope: { kind: "sales.tasks" },
    signal: new AbortController().signal,
    ...overrides
  };
}

function structuralHash(descriptor) {
  return `sha256:${createHash("sha256").update(canonicalJson({
    id: descriptor.id,
    version: descriptor.version,
    primaryContract: descriptor.primaryContract,
    sourceSchema: descriptor.sourceSchema,
    inputFields: descriptor.inputFields,
    outputFields: descriptor.outputFields ?? [],
    paginationModes: descriptor.paginationModes,
    limits: descriptor.limits
  })).digest("hex")}`;
}

test("Sales registers three single-output data sources with valid descriptors", () => {
  assert.equal(DataSourceDescriptorSchema.safeParse(salesTotalPotentialRevenueDescriptor).success, true);
  assert.equal(DataSourceDescriptorSchema.safeParse(salesTasksDescriptor).success, true);
  assert.equal(DataSourceDescriptorSchema.safeParse(salesOpportunitiesDescriptor).success, true);
  assert.equal(salesTotalPotentialRevenueDescriptor.structuralCompatibilityHash, structuralHash(salesTotalPotentialRevenueDescriptor));
  assert.equal(salesTasksDescriptor.structuralCompatibilityHash, structuralHash(salesTasksDescriptor));
  assert.equal(salesOpportunitiesDescriptor.structuralCompatibilityHash, structuralHash(salesOpportunitiesDescriptor));
  assert.equal(salesTotalPotentialRevenueDefinition.descriptor.primaryContract.id, "metric.scalar");
  assert.equal(salesTasksDefinition.descriptor.primaryContract.id, "table.records");
  assert.equal(salesTasksDescriptor.outputFields.find(({ id }) => id === "potential-revenue").binding, "required");
  assert.deepEqual(salesTasksDescriptor.outputFields.find(({ id }) => id === "potential-revenue").filterOperators, []);
  const permissionIds = new Set(salesPermissionDescriptors.map(({ id }) => id));
  for (const descriptor of [salesTotalPotentialRevenueDescriptor, salesTasksDescriptor, salesOpportunitiesDescriptor]) {
    assert.equal(permissionIds.has(descriptor.permission), true, `${descriptor.id} must reference a declared permission`);
  }

  const contributions = [];
  const bindings = [];
  salesRegistration.contracts?.({ pluginId: "module.sales", services: { get: () => undefined }, register: (kind, id) => contributions.push([kind, id]) });
  salesRegistration.dataHandlers?.({ pluginId: "module.sales", services: { get: () => undefined }, bind: (kind, id) => bindings.push([kind, id]) });
  salesRegistration.ui?.({
    pluginId: "module.sales",
    services: { get: () => undefined },
    register: (kind, id) => contributions.push([kind, id]),
    bindRenderer: (kind, id) => bindings.push([kind, id])
  });
  assert.deepEqual(contributions.filter(([kind]) => kind === "sources").map(([, id]) => id).sort(), ["sales.opportunities", "sales.tasks", "sales.total-potential-revenue"]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "actions").map(([, id]) => id).sort(), ["sales.opportunity.stage.update", "sales.task.create", "sales.task.update"]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "tools").map(([, id]) => id).sort(), ["sales.tools.create-task", "sales.tools.search-tasks"]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "permissions").map(([, id]) => id).sort(), salesPermissionDescriptors.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "policyBindings").map(([, id]) => id).sort(), salesPermissionPolicyBindings.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "roleTemplates").map(([, id]) => id).sort(), salesRoleTemplates.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "settings").map(([, id]) => id), [salesWorkspaceSettingsDescriptor.id]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "routes").map(([, id]) => id).sort(), salesRouteDescriptors.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "navigation").map(([, id]) => id), salesNavigationDescriptors.map(({ id }) => id));
  assert.deepEqual(contributions.filter(([kind]) => kind === "pageTemplates").map(([, id]) => id), salesPageTemplates.map(({ id }) => id));
  assert.deepEqual(contributions.filter(([kind]) => kind === "components").map(([, id]) => id), salesUiComponentDescriptors.map(({ id }) => id));
  assert.deepEqual(contributions.filter(([kind]) => kind === "blocks").map(([, id]) => id), salesUiBlockDescriptors.map(({ id }) => id));
  assert.deepEqual(bindings.filter(([kind]) => kind === "sources").map(([, id]) => id).sort(), ["sales.opportunities", "sales.tasks", "sales.total-potential-revenue"]);
  assert.deepEqual(bindings.filter(([kind]) => kind === "actions").map(([, id]) => id).sort(), ["sales.opportunity.stage.update", "sales.task.create", "sales.task.update"]);
  assert.deepEqual(bindings.filter(([kind]) => kind === "components").map(([, id]) => id), salesUiComponentDescriptors.map(({ id }) => id));
  assert.deepEqual(bindings.filter(([kind]) => kind === "blocks").map(([, id]) => id), salesUiBlockDescriptors.map(({ id }) => id));
});

test("Sales settings, permissions, routes, and navigation use strict platform contracts", () => {
  assert.equal(SystemSettingsDescriptorSchema.safeParse(salesWorkspaceSettingsDescriptor).success, true);
  assert.equal(salesPermissionDescriptors.every((descriptor) => AuthorizationPermissionDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesRouteDescriptors.every((descriptor) => PluginRouteDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesNavigationDescriptors.every((descriptor) => PluginNavigationDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesRouteDescriptors.every(({ viewId }) => salesPageTemplates.some(({ id }) => id === viewId)), true);
  assert.equal(PluginPageTemplateDescriptorSchema.safeParse(salesTaskPageTemplate).success, true);
  assert.equal(PluginUiContributionDescriptorSchema.safeParse(salesTaskTableComponentDescriptor).success, true);
  assert.equal(PluginUiContributionDescriptorSchema.safeParse(salesTaskTableBlockDescriptor).success, true);
  assert.deepEqual(salesDefaultSettings, {
    defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks",
    pipelineStages: ["lead", "qualified", "won", "lost"]
  });
});

test("Sales policy bindings and role templates are static same-owner declarations", () => {
  assert.equal(PluginManifestSchema.safeParse(salesManifest).success, true);
  assert.equal(salesPermissionPolicyBindings.every((binding) => PermissionPolicyBindingSchema.safeParse(binding).success), true);
  assert.equal(salesRoleTemplates.every((template) => RoleTemplateSchema.safeParse(template).success), true);

  const permissionById = new Map(salesPermissionDescriptors.map((descriptor) => [descriptor.id, descriptor]));
  const bindingByPermissionId = new Map(salesPermissionPolicyBindings.map((binding) => [binding.permissionId, binding]));
  for (const binding of salesPermissionPolicyBindings) {
    assert.deepEqual(binding.publisher, { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" });
    assert.equal(permissionById.get(binding.permissionId)?.scope, binding.scope);
    assert.equal(binding.failureMode, "deny");
    assert.equal(binding.timeoutMs > 0 && binding.timeoutMs <= 5_000, true);
  }
  for (const descriptor of salesPermissionDescriptors) {
    if (descriptor.scope === "application") assert.equal(bindingByPermissionId.has(descriptor.id), false);
    else {
      const binding = bindingByPermissionId.get(descriptor.id);
      assert.ok(binding, `${descriptor.id} must have one policy binding`);
      assert.equal(binding.policyReference, descriptor.id.startsWith("sales.tasks.") ? "sales.tasks.domain" : "sales.opportunities.domain");
    }
  }
  assert.equal(bindingByPermissionId.size, salesPermissionPolicyBindings.length);
  assert.deepEqual(Object.keys(salesManifest.contributions.policyBindings).sort(), salesPermissionPolicyBindings.map(({ id }) => id).sort());
  assert.deepEqual(Object.keys(salesManifest.contributions.roleTemplates).sort(), salesRoleTemplates.map(({ id }) => id).sort());

  for (const template of salesRoleTemplates) {
    assert.deepEqual(template.publisher, { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" });
    assert.deepEqual(template.permissionIds, [...template.permissionIds].sort());
    assert.equal(template.permissionIds.every((permissionId) => permissionById.has(permissionId)), true);
    assert.equal(Object.hasOwn(template, "assignments"), false);
  }
  assert.deepEqual(salesRoleTemplates.map(({ title }) => title), [
    "Sales Viewer", "Sales Representative", "Sales Manager", "Sales Administrator"
  ]);
  for (let index = 1; index < salesRoleTemplates.length; index += 1) {
    const previous = new Set(salesRoleTemplates[index - 1].permissionIds);
    assert.equal(previous.size < salesRoleTemplates[index].permissionIds.length, true);
    assert.equal([...previous].every((permissionId) => salesRoleTemplates[index].permissionIds.includes(permissionId)), true);
  }
});

test("Sales registers source/action-backed tools with strict write policy", () => {
  assert.equal(AgentToolDescriptorSchema.safeParse(salesSearchTasksDescriptor).success, true);
  assert.equal(AgentToolDescriptorSchema.safeParse(salesCreateTaskToolDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesTaskCreateDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesTaskUpdateDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesOpportunityStageUpdateDescriptor).success, true);
  assert.deepEqual(salesSearchTasksDescriptor.invocation, { kind: "source", source: { id: "sales.tasks", version: 1 } });
  assert.equal(salesSearchTasksDescriptor.policy, "sales.tasks.domain");
  assert.deepEqual(salesSearchTasksDescriptor.inputSchema.required, ["title"]);
  assert.deepEqual(Object.keys(salesSearchTasksDescriptor.inputSchema.properties), ["title"]);
  assert.deepEqual(salesCreateTaskToolDescriptor.invocation, { kind: "action", action: { id: "sales.task.create", version: 1 } });
  assert.equal(salesCreateTaskToolDescriptor.approval, "per-call");
  assert.equal(salesCreateTaskToolDescriptor.idempotency, "required");
  assert.equal(salesSearchTasksDescriptor.dryRun, false);
  assert.deepEqual(salesCreateTaskToolDescriptor.inputSchema, salesTaskCreateDescriptor.inputSchema);
  assert.deepEqual(salesCreateTaskToolDescriptor.outputSchema, salesTaskCreateDescriptor.outputSchema);
  assert.equal(salesTaskCreateDefinition.descriptor.id, "sales.task.create");
});

test("Sales declares event-to-realtime invalidation mappings", () => {
  assert.deepEqual(salesEventDescriptors.map(({ id }) => id).sort(), [
    "sales.event.opportunity-changed", "sales.event.task-changed"
  ]);
  const eventIds = new Set(salesEventDescriptors.map(({ id }) => id));
  const sourceIds = new Set([salesOpportunitiesDescriptor.id, salesTasksDescriptor.id]);
  const permissionIds = new Set(salesPermissionDescriptors.map(({ id }) => id));
  for (const event of salesEventDescriptors) {
    assert.equal(event.eventClass, "durable-integration");
    assert.equal(sourceIds.has(event.sourceId), true);
  }
  for (const topic of salesRealtimeTopicDescriptors) {
    assert.equal(eventIds.has(topic.eventId), true);
    assert.equal(sourceIds.has(topic.sourceId), true);
    assert.equal(permissionIds.has(topic.permission), true);
  }
});

test("the Sales create action uses Payload Local API exactly once under the actor context", async () => {
  const calls = [];
  const request = {
    payload: {
      find: async () => ({ docs: [], hasNextPage: false }),
      create: async (options) => {
        calls.push(options);
        return { id: "task-7", title: options.data.title, status: options.data.status ?? "open" };
      }
    },
    locale: "en-US",
    transactionID: "tx-7"
  };
  const result = await salesTaskCreateHandler({
    actor: { principal: { kind: "user", id: "user-1" }, effectiveActor: { kind: "user", id: "user-1" } },
    request,
    authorizationContext: { permissionFingerprint: "sales:open:full" },
    input: { title: "Call customer", status: "open", potentialRevenue: "12.50", privateNote: "follow-up" },
    idempotencyKey: "create-task-1",
    signal: new AbortController().signal
  });
  assert.deepEqual(result, { id: "task-7", title: "Call customer", status: "open" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].collection, "sales-tasks");
  assert.equal(calls[0].overrideAccess, true);
  assert.equal(calls[0].depth, 0);
  assert.deepEqual(calls[0].user, { id: "user-1", collection: "users" });
  assert.equal(calls[0].req, request);
  assert.deepEqual(calls[0].data, { title: "Call customer", status: "open", potentialRevenue: "12.50", privateNote: "follow-up" });
  assert.deepEqual(calls[0].context, { kNexSalesEvent: { eventId: "create-task-1", type: "sales.event.task-changed" } });
});

test("Sales durable events project task and opportunity invalidations through the realtime gateway", async () => {
  const publications = [];
  const relay = createSalesRealtimeRelay({ publish: async (input) => { publications.push(input); return { accepted: true }; } });
  const base = {
    schemaVersion: 1, messageClass: "durable-integration", occurredAt: "2026-08-27T00:00:00.000Z",
    applicationId: "customer-gate-1", pluginId: "module.sales", correlationId: "correlation-1"
  };
  const run = async (event) => relay({
    actor: { kind: "system", id: "outbox.processor" }, checkpoint: null, event,
    idempotencyKey: event.id, saveCheckpoint: async () => undefined
  });
  await run({ ...base, id: "task-event-1", type: "sales.event.task-changed", payload: { resourceId: "task-1", operation: "create" } });
  await run({ ...base, id: "opportunity-event-1", type: "sales.event.opportunity-changed", payload: { resourceId: "opp-1", operation: "update" } });
  assert.deepEqual(publications.map(({ channel, message }) => ({ topicId: channel.topicId, message })), [
    { topicId: "sales.realtime.tasks", message: { sourceId: "sales.tasks", resourceId: "task-1", operation: "create" } },
    { topicId: "sales.realtime.opportunities", message: { sourceId: "sales.opportunities", resourceId: "opp-1", operation: "update" } }
  ]);
});

test("the revenue source aggregates canonical money values on the server", async () => {
  const calls = [];
  const result = await salesTotalPotentialRevenueHandler(handlerContext({
    query: { filters: [], sort: [] },
    selectedFields: [],
    request: {
      payload: {
        find: async (options) => {
          calls.push(options);
          return options.page === 1
            ? { docs: [{ id: "a", potentialRevenue: "12.30" }, { id: "b", potentialRevenue: "7.7" }], page: 1, totalPages: 1, hasNextPage: false }
            : { docs: [], page: options.page, totalPages: 1, hasNextPage: false };
        }
      },
      locale: "en-US",
      transactionID: "tx-7"
    }
  }));
  assert.deepEqual(result, { value: { kind: "money", value: "20", currency: "USD", scale: 2 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].collection, "sales-tasks");
  assert.equal(calls[0].overrideAccess, true);
  assert.equal(calls[0].depth, 0);
  assert.equal(calls[0].user.id, "user-1");
  assert.deepEqual(calls[0].req, { locale: "en-US", transactionID: "tx-7" });
  assert.deepEqual(calls[0].select, { id: true, potentialRevenue: true });
});

test("the revenue source preserves integer zeros and exact mixed-scale negatives", async () => {
  const result = await salesTotalPotentialRevenueHandler(handlerContext({
    query: { filters: [], sort: [] },
    selectedFields: [],
    request: {
      payload: {
        find: async () => ({
          docs: [
            { id: "a", potentialRevenue: "10" },
            { id: "b", potentialRevenue: "20" },
            { id: "c", potentialRevenue: "100" },
            { id: "d", potentialRevenue: "1.20" },
            { id: "e", potentialRevenue: "-2.005" },
            { id: "f", potentialRevenue: "-0.5" }
          ],
          page: 1,
          totalPages: 1,
          hasNextPage: false
        })
      }
    }
  }));
  assert.deepEqual(result, { value: { kind: "money", value: "128.695", currency: "USD", scale: 3 } });
});

test("Sales output schemas enforce source-specific money and task shapes", () => {
  const validMetric = { value: { kind: "money", value: "20", currency: "USD", scale: 2 } };
  assert.equal(salesTotalPotentialRevenueDefinition.outputSchema.safeParse(validMetric).success, true);
  assert.equal(salesTotalPotentialRevenueDefinition.outputSchema.safeParse({ value: { ...validMetric.value, currency: "EUR" } }).success, false);
  assert.equal(salesTotalPotentialRevenueDefinition.outputSchema.safeParse({ value: { kind: "decimal", value: "20", scale: 2 } }).success, false);
  assert.equal(salesTotalPotentialRevenueDefinition.outputSchema.safeParse({ ...validMetric, comparison: { value: validMetric.value, sentiment: "neutral" } }).success, false);

  const validTable = {
    fields: ["title", "status", "potential-revenue"],
    rows: [{
      key: "task-1",
      values: {
        title: { kind: "text", value: "Follow-up" },
        status: { kind: "status", value: "open" },
        "potential-revenue": { kind: "money", value: "12.3", currency: "USD", scale: 2 }
      }
    }],
    page: { number: 1, pageSize: 25, hasNext: false }
  };
  assert.equal(salesTasksDefinition.outputSchema.safeParse(validTable).success, true);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    fields: ["title", "status", "potential-revenue", "private-note"],
    rows: [{
      ...validTable.rows[0],
      values: { ...validTable.rows[0].values, "potential-revenue": null, "private-note": null }
    }]
  }).success, true);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({ ...validTable, fields: ["title", "status"] }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({ ...validTable, fields: ["title", "status", "unknown"] }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    rows: [{ ...validTable.rows[0], values: { ...validTable.rows[0].values, status: { kind: "text", value: "open" } } }]
  }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    rows: [{ ...validTable.rows[0], values: { ...validTable.rows[0].values, status: { kind: "status", value: "paused" } } }]
  }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    rows: [{ ...validTable.rows[0], values: { ...validTable.rows[0].values, "potential-revenue": { kind: "money", value: "12.3", currency: "EUR", scale: 2 } } }]
  }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    rows: [{ ...validTable.rows[0], values: { title: null, status: validTable.rows[0].values.status, "potential-revenue": validTable.rows[0].values["potential-revenue"] } }]
  }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    rows: [{ ...validTable.rows[0], values: { title: validTable.rows[0].values.title, status: validTable.rows[0].values.status } }]
  }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    rows: [{ ...validTable.rows[0], values: { status: validTable.rows[0].values.status, title: validTable.rows[0].values.title, "potential-revenue": validTable.rows[0].values["potential-revenue"] } }]
  }).success, false);
});

test("the task source applies bounded projection, allowlisted operations, and pagination", async () => {
  let call;
  const result = await salesTasksHandler(handlerContext({
    selectedFields: ["title", "status", "potential-revenue", "private-note"],
    query: {
      page: { number: 2, size: 10 },
      filters: [{ field: "title", operator: "contains", value: "follow" }],
      sort: [{ field: "status", direction: "desc" }]
    },
    recordScope: { kind: "sales.tasks", where: { owner: { equals: "user-1" } } },
    request: {
      payload: {
        find: async (options) => {
          call = options;
          return { docs: [{ id: "task-1", title: "Follow-up", status: "open", potentialRevenue: "12.30", privateNote: null }], page: 2, totalPages: 3, hasNextPage: true };
        }
      }
    }
  }));
  assert.deepEqual(result, {
    fields: ["title", "status", "potential-revenue", "private-note"],
    rows: [{ key: "task-1", values: {
      title: { kind: "text", value: "Follow-up" },
      status: { kind: "status", value: "open" },
      "potential-revenue": { kind: "money", value: "12.3", currency: "USD", scale: 2 },
      "private-note": null
    } }],
    page: { number: 2, pageSize: 10, hasNext: true }
  });
  assert.equal(call.overrideAccess, true);
  assert.equal(call.depth, 0);
  assert.equal(call.page, 2);
  assert.equal(call.limit, 10);
  assert.deepEqual(call.select, { id: true, title: true, status: true, potentialRevenue: true, privateNote: true });
  assert.deepEqual(call.sort, ["-status", "id"]);
  assert.deepEqual(call.where, { and: [{ owner: { equals: "user-1" } }, { title: { contains: "follow" } }] });
});

test("the task source advances opaque cursor pages through bounded Payload pagination", async () => {
  let call;
  const first = await salesTasksHandler(handlerContext({
    query: { cursor: { size: 10 }, filters: [], sort: [] },
    request: { payload: { find: async (options) => {
      call = options;
      return { docs: [], hasNextPage: true };
    } } }
  }));
  assert.equal(first.page.number, 1);
  assert.equal(typeof first.page.nextCursor, "string");
  const second = await salesTasksHandler(handlerContext({
    query: { cursor: { size: 10, after: first.page.nextCursor }, filters: [], sort: [] },
    request: { payload: { find: async (options) => {
      call = options;
      return { docs: [], hasNextPage: false };
    } } }
  }));
  assert.equal(call.page, 2);
  assert.equal(second.page.nextCursor, undefined);
  const invalidCursor = (error) => error?.code === "INVALID_CURSOR" && error?.status === 400;
  await assert.rejects(salesTasksHandler(handlerContext({
    query: { cursor: { size: 5, after: first.page.nextCursor }, filters: [], sort: [] }
  })), invalidCursor);
  await assert.rejects(salesTasksHandler(handlerContext({
    query: { cursor: { size: 10, after: "not-a-sales-cursor" }, filters: [], sort: [] }
  })), invalidCursor);
});

test("the task source rejects direct unknown field manipulation", async () => {
  await assert.rejects(
    salesTasksHandler(handlerContext({ selectedFields: ["private-secret"] })),
    /invalid field selection/
  );
});

test("the opportunities source returns bounded canonical rows", async () => {
  const result = await salesOpportunitiesHandler(handlerContext({
    request: { payload: { find: async (options) => {
      assert.equal(options.collection, "sales-opportunities");
      return { docs: [{ id: "opp-1", name: "Platform rollout", stage: "qualified", value: "1200.50", updatedAt: "2026-09-03T00:00:00.000Z" }], hasNextPage: false };
    } } },
    selectedFields: ["name", "stage", "revision", "value"],
    recordScope: { kind: "sales.opportunities" }
  }));
  assert.deepEqual(result.rows[0], {
    key: "opp-1",
    values: {
      name: { kind: "text", value: "Platform rollout" },
      stage: { kind: "status", value: "qualified" },
      revision: { kind: "text", value: "2026-09-03T00:00:00.000Z" },
      value: { kind: "money", value: "1200.5", currency: "USD", scale: 2 }
    }
  });
});

test("Sales update actions use actor-scoped Payload updates exactly once", async () => {
  const calls = [];
  const request = {
    payload: {
      find: async () => ({ docs: [] }), create: async () => ({}),
      update: async (options) => {
        calls.push(options);
        return options.collection === "sales-tasks"
          ? { id: options.id, title: options.data.title ?? "Existing", status: options.data.status ?? "open" }
          : { docs: [{ id: "opp-1", name: "Platform rollout", stage: options.data.stage, updatedAt: "2026-09-03T00:01:00.000Z" }], errors: [] };
      }
    }
  };
  const base = { actor: handlerContext().actor, request, authorizationContext: {}, idempotencyKey: "update-1", signal: new AbortController().signal };
  assert.deepEqual(await salesTaskUpdateHandler({ ...base, input: { id: "task-1", status: "done" } }), { id: "task-1", title: "Existing", status: "done" });
  assert.deepEqual(await salesOpportunityStageUpdateHandler({ ...base, input: { id: "opp-1", expectedStage: "qualified", expectedRevision: "2026-09-03T00:00:00.000Z", stage: "won" } }), { id: "opp-1", name: "Platform rollout", stage: "won", revision: "2026-09-03T00:01:00.000Z" });
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.overrideAccess === true && call.user.id === "user-1"), true);
  assert.deepEqual(calls[1].where, { and: [
    { id: { equals: "opp-1" } },
    { stage: { equals: "qualified" } },
    { updatedAt: { equals: "2026-09-03T00:00:00.000Z" } }
  ] });
});

test("Sales rejects a stale opportunity card without a blind update", async () => {
  const request = { payload: { find: async () => ({ docs: [] }), create: async () => ({}), update: async () => ({ docs: [], errors: [] }) } };
  await assert.rejects(salesOpportunityStageUpdateHandler({
    actor: handlerContext().actor, request, authorizationContext: {}, idempotencyKey: "stale-1", signal: new AbortController().signal,
    input: { id: "opp-1", expectedStage: "lead", expectedRevision: "2026-09-03T00:00:00.000Z", stage: "won" }
  }), (error) => error?.code === "STALE_RECORD" && error?.status === 409);
});
