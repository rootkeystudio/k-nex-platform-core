import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ActionDescriptorSchema,
  AgentToolDescriptorSchema,
  DataSourceDescriptorSchema,
  PermissionDescriptorSchema,
  PluginNavigationDescriptorSchema,
  PluginPageTemplateDescriptorSchema,
  PluginRouteDescriptorSchema,
  PluginSettingsDescriptorSchema,
  PluginUiContributionDescriptorSchema,
  canonicalJson
} from "@k-nex/contracts";

import {
  salesCreateTaskToolDescriptor,
  salesEventDescriptors,
  salesNavigationDescriptors,
  salesOpportunitiesDescriptor,
  salesPermissionDescriptors,
  salesRealtimeTopicDescriptors,
  salesRouteDescriptors,
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
  assert.equal(PluginSettingsDescriptorSchema.safeParse(salesWorkspaceSettingsDescriptor).success, true);
  assert.equal(salesPermissionDescriptors.every((descriptor) => PermissionDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesRouteDescriptors.every((descriptor) => PluginRouteDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesNavigationDescriptors.every((descriptor) => PluginNavigationDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(PluginPageTemplateDescriptorSchema.safeParse(salesTaskPageTemplate).success, true);
  assert.equal(PluginUiContributionDescriptorSchema.safeParse(salesTaskTableComponentDescriptor).success, true);
  assert.equal(PluginUiContributionDescriptorSchema.safeParse(salesTaskTableBlockDescriptor).success, true);
  assert.deepEqual(salesDefaultSettings.values, {
    defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks",
    pipelineStages: ["lead", "qualified", "won", "lost"]
  });
});

test("Sales registers source/action-backed tools with strict write policy", () => {
  assert.equal(AgentToolDescriptorSchema.safeParse(salesSearchTasksDescriptor).success, true);
  assert.equal(AgentToolDescriptorSchema.safeParse(salesCreateTaskToolDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesTaskCreateDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesTaskUpdateDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesOpportunityStageUpdateDescriptor).success, true);
  assert.deepEqual(salesSearchTasksDescriptor.invocation, { kind: "source", source: { id: "sales.tasks", version: 1 } });
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
      return { docs: [{ id: "opp-1", name: "Platform rollout", stage: "qualified", value: "1200.50" }], hasNextPage: false };
    } } },
    selectedFields: ["name", "stage", "value"],
    recordScope: { kind: "sales.opportunities" }
  }));
  assert.deepEqual(result.rows[0], {
    key: "opp-1",
    values: {
      name: { kind: "text", value: "Platform rollout" },
      stage: { kind: "status", value: "qualified" },
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
          : { id: options.id, name: "Platform rollout", stage: options.data.stage };
      }
    }
  };
  const base = { actor: handlerContext().actor, request, authorizationContext: {}, idempotencyKey: "update-1", signal: new AbortController().signal };
  assert.deepEqual(await salesTaskUpdateHandler({ ...base, input: { id: "task-1", status: "done" } }), { id: "task-1", title: "Existing", status: "done" });
  assert.deepEqual(await salesOpportunityStageUpdateHandler({ ...base, input: { id: "opp-1", stage: "won" } }), { id: "opp-1", name: "Platform rollout", stage: "won" });
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.overrideAccess === true && call.user.id === "user-1"), true);
});
