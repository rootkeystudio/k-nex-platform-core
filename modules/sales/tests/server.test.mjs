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
  salesOpportunitiesOutputRuntimeSchema,
  salesRealtimeTopicDescriptors,
  salesRouteDescriptors,
  salesSearchTasksDescriptor,
  salesTaskCreateDescriptor,
  salesTaskUpdateDescriptor,
  salesOpportunityStageUpdateDescriptor,
  salesPageTemplates,
  salesReferenceMetadata,
  salesUiBlockDescriptors,
  salesUiComponentDescriptors,
  salesTaskTableBlockDescriptor,
  salesTaskTableComponentDescriptor,
  salesTaskPageTemplate,
  salesTasksDescriptor,
  salesWorkspaceSettingsDescriptor
} from "../dist/contracts.js";
import {
  createSalesRealtimeRelay,
  salesDefaultSettings,
  salesOpportunitiesHandler,
  salesPipelineAuditJob,
  salesOpportunityStageUpdateHandler,
  salesRegistration,
  salesTaskCreateDefinition,
  salesTaskCreateHandler,
  salesTaskUpdateHandler,
  salesTasksDefinition,
  salesTasksHandler,
  salesCrmActionDescriptors,
  salesCrmRouteDescriptors,
  salesPermissionPolicyExecutors
} from "../dist/server.js";
import {
  salesCrmPermissionDescriptors,
  salesCrmObjectFieldActionMatrix,
  salesCrmPermissionPolicyBindings,
  salesCrmRoleTemplates
} from "../dist/crm-authority.js";

function handlerContext(overrides = {}) {
  const base = {
    actor: { principal: { kind: "user", id: "user-1" }, effectiveActor: { kind: "user", id: "user-1" } },
    request: {
      payload: { find: async () => ({ docs: [], hasNextPage: false }) },
      applicationIdentity: { applicationId: "customer-gate-1", environment: "production" },
      locale: "en-US",
      transactionID: "tx-7"
    },
    input: {},
    query: { page: { number: 1, size: 25 }, filters: [], sort: [] },
    selectedFields: ["title", "status"],
    recordScope: salesScope("sales.tasks"),
    signal: new AbortController().signal
  };
  return { ...base, ...overrides, request: { ...base.request, ...overrides.request, payload: { ...base.request.payload, ...overrides.request?.payload } } };
}

function salesScope(kind) {
  return {
    kind,
    where: { and: [
      { applicationId: { equals: "customer-gate-1" } },
      { environment: { equals: "production" } },
      { ownerId: { equals: "user-1" } }
    ] }
  };
}

function assertActionAudit(entry, expected) {
  assert.deepEqual({
    actionId: entry.actionId,
    resourceId: entry.resourceId,
    applicationId: entry.applicationId,
    environment: entry.environment,
    fromState: entry.fromState,
    toState: entry.toState,
    actorId: entry.actorId,
    revision: entry.revision,
    idempotencyKey: entry.idempotencyKey
  }, expected);
  assert.equal(new Date(entry.occurredAt).toISOString(), entry.occurredAt);
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

test("Sales registers active v2 sources and frozen P13.2 authority", () => {
  assert.equal(DataSourceDescriptorSchema.safeParse(salesTasksDescriptor).success, true);
  assert.equal(DataSourceDescriptorSchema.safeParse(salesOpportunitiesDescriptor).success, true);
  assert.equal(salesTasksDescriptor.structuralCompatibilityHash, structuralHash(salesTasksDescriptor));
  assert.equal(salesOpportunitiesDescriptor.structuralCompatibilityHash, structuralHash(salesOpportunitiesDescriptor));
  assert.equal(salesTasksDefinition.descriptor.primaryContract.id, "table.records");
  assert.deepEqual(salesTasksDescriptor.outputFields.map(({ id }) => id), ["title", "status"]);
  assert.deepEqual(salesOpportunitiesDescriptor.outputFields.map(({ id }) => id), ["name", "stage-id", "revision", "amount"]);
  const permissionIds = new Set(salesCrmPermissionDescriptors.map(({ id }) => id));
  for (const descriptor of [salesTasksDescriptor, salesOpportunitiesDescriptor]) {
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
  assert.deepEqual(contributions.filter(([kind]) => kind === "sources").map(([, id]) => id).sort(), ["sales.opportunities", "sales.tasks"]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "actions").map(([, id]) => id).sort(), ["sales.opportunity.stage.update", "sales.task.create", "sales.task.update"]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "tools").map(([, id]) => id).sort(), ["sales.tools.create-task", "sales.tools.search-tasks"]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "permissions").map(([, id]) => id).sort(), salesCrmPermissionDescriptors.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "policyBindings").map(([, id]) => id).sort(), salesCrmPermissionPolicyBindings.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "roleTemplates").map(([, id]) => id).sort(), salesCrmRoleTemplates.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "settings").map(([, id]) => id), [salesWorkspaceSettingsDescriptor.id]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "routes").map(([, id]) => id).sort(), salesRouteDescriptors.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "navigation").map(([, id]) => id), salesNavigationDescriptors.map(({ id }) => id));
  assert.deepEqual(contributions.filter(([kind]) => kind === "pageTemplates").map(([, id]) => id), salesPageTemplates.map(({ id }) => id));
  assert.deepEqual(contributions.filter(([kind]) => kind === "components").map(([, id]) => id), salesUiComponentDescriptors.map(({ id }) => id));
  assert.deepEqual(contributions.filter(([kind]) => kind === "blocks").map(([, id]) => id), salesUiBlockDescriptors.map(({ id }) => id));
  assert.deepEqual(bindings.filter(([kind]) => kind === "sources").map(([, id]) => id).sort(), ["sales.opportunities", "sales.tasks"]);
  assert.deepEqual(bindings.filter(([kind]) => kind === "actions").map(([, id]) => id).sort(), ["sales.opportunity.stage.update", "sales.task.create", "sales.task.update"]);
  assert.deepEqual(bindings.filter(([kind]) => kind === "components").map(([, id]) => id), salesUiComponentDescriptors.map(({ id }) => id));
  assert.deepEqual(bindings.filter(([kind]) => kind === "blocks").map(([, id]) => id), salesUiBlockDescriptors.map(({ id }) => id));
});

test("Sales settings, permissions, routes, and navigation use strict platform contracts", () => {
  assert.equal(SystemSettingsDescriptorSchema.safeParse(salesWorkspaceSettingsDescriptor).success, true);
  assert.equal(salesCrmPermissionDescriptors.every((descriptor) => AuthorizationPermissionDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesRouteDescriptors.every((descriptor) => PluginRouteDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesNavigationDescriptors.every((descriptor) => PluginNavigationDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesRouteDescriptors.every(({ viewId }) => salesPageTemplates.some(({ id }) => id === viewId)), true);
  assert.equal(PluginPageTemplateDescriptorSchema.safeParse(salesTaskPageTemplate).success, true);
  assert.equal(PluginUiContributionDescriptorSchema.safeParse(salesTaskTableComponentDescriptor).success, true);
  assert.equal(PluginUiContributionDescriptorSchema.safeParse(salesTaskTableBlockDescriptor).success, true);
  assert.deepEqual(salesDefaultSettings, {
    defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks",
    pipelineStages: ["qualification", "discovery", "proposal", "negotiation", "won", "lost"]
  });
  assert.deepEqual([salesReferenceMetadata.health.version, salesReferenceMetadata.lifecycle.version, salesReferenceMetadata.testing.version], [2, 2, 2]);
});

test("Sales P13.2 policy bindings and role templates are static same-owner declarations", () => {
  assert.equal(PluginManifestSchema.safeParse(salesManifest).success, true);
  assert.equal(salesCrmPermissionPolicyBindings.every((binding) => PermissionPolicyBindingSchema.safeParse(binding).success), true);
  assert.equal(salesCrmRoleTemplates.every((template) => RoleTemplateSchema.safeParse(template).success), true);

  const permissionById = new Map(salesCrmPermissionDescriptors.map((descriptor) => [descriptor.id, descriptor]));
  const bindingByPermissionId = new Map(salesCrmPermissionPolicyBindings.map((binding) => [binding.permissionId, binding]));
  for (const binding of salesCrmPermissionPolicyBindings) {
    assert.deepEqual(binding.publisher, { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" });
    assert.equal(permissionById.get(binding.permissionId)?.scope, binding.scope);
    assert.equal(binding.failureMode, "deny");
    assert.equal(binding.timeoutMs > 0 && binding.timeoutMs <= 5_000, true);
  }
  for (const descriptor of salesCrmPermissionDescriptors) {
    if (descriptor.scope === "application") assert.equal(bindingByPermissionId.has(descriptor.id), false);
    else {
      const binding = bindingByPermissionId.get(descriptor.id);
      assert.ok(binding, `${descriptor.id} must have one policy binding`);
      const row = salesCrmObjectFieldActionMatrix.find((candidate) => [candidate.readPermissionId, candidate.writePermissionId, candidate.archivePermissionId, ...Object.values(candidate.sensitiveFields ?? {}), ...Object.values(candidate.actionPermissions ?? {})].includes(descriptor.id));
      const operationPolicy = descriptor.id === "sales.ownership.write" ? "sales.policy.ownership.current"
        : descriptor.id === "sales.records.merge" ? "sales.policy.merge.current" : row?.recordPolicyId;
      assert.equal(binding.policyReference, operationPolicy);
    }
  }
  assert.equal(bindingByPermissionId.size, salesCrmPermissionPolicyBindings.length);
  assert.deepEqual(Object.keys(salesManifest.contributions.policyBindings).sort(), salesCrmPermissionPolicyBindings.map(({ id }) => id).sort());
  assert.deepEqual(Object.keys(salesManifest.contributions.roleTemplates).sort(), salesCrmRoleTemplates.map(({ id }) => id).sort());

  for (const template of salesCrmRoleTemplates) {
    assert.deepEqual(template.publisher, { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" });
    assert.deepEqual(template.permissionIds, [...template.permissionIds].sort());
    assert.equal(template.permissionIds.every((permissionId) => permissionById.has(permissionId)), true);
    assert.equal(Object.hasOwn(template, "assignments"), false);
  }
  assert.deepEqual(salesCrmRoleTemplates.map(({ title }) => title), [
    "Sales Viewer", "Sales Representative", "Sales Manager", "Sales Administrator"
  ]);
  for (let index = 1; index < salesCrmRoleTemplates.length; index += 1) {
    const previous = new Set(salesCrmRoleTemplates[index - 1].permissionIds);
    assert.equal(previous.size < salesCrmRoleTemplates[index].permissionIds.length, true);
    assert.equal([...previous].every((permissionId) => salesCrmRoleTemplates[index].permissionIds.includes(permissionId)), true);
  }
});

test("Sales current record policies enforce exact persona scope modes", () => {
  const executor = salesPermissionPolicyExecutors["sales.policy.tasks.current"];
  const input = {
    permissionId: "sales.tasks.read",
    applicationId: "customer-gate-1",
    effectiveActor: { id: "user-1" },
    scope: { kind: "record", recordId: "task-1" },
    facts: {
      applicationId: "customer-gate-1",
      environment: "production",
      recordEnvironment: "production",
      recordId: "task-1",
      ownerId: "user-1",
      recordScope: "owned-or-assigned-team",
      applicationWide: false,
      mutationAllowed: true,
      salesScopeRevision: 1
    }
  };
  assert.deepEqual(executor.evaluate(input), { schemaVersion: 1, outcome: "allow" });
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, applicationId: "other-customer" } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, recordEnvironment: "staging" } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, ownerId: "user-2" } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, ownerId: "user-2", teamId: "team-2", authorizedTeamIds: ["team-1"] } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, ownerId: "user-2", teamId: "team-2", authorizedTeamIds: ["team-2"] } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, ownerId: "user-2", applicationWide: true } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, recordScope: "managed-teams-and-own", ownerId: "user-2", teamId: "team-2", authorizedTeamIds: ["team-2"] } }).outcome, "allow");
  const viewer = { ...input, facts: { ...input.facts, recordScope: "explicit-application-or-team-scope", applicationWide: false, mutationAllowed: false, ownerId: "user-1" } };
  assert.equal(executor.evaluate(viewer).outcome, "deny", "viewer ownership alone must not grant record access");
  assert.equal(executor.evaluate({ ...viewer, facts: { ...viewer.facts, ownerId: "user-2", teamId: "team-1", authorizedTeamIds: ["team-1"] } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...viewer, facts: { ...viewer.facts, ownerId: "user-2", applicationWide: true } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...viewer, facts: { ...viewer.facts, ownerId: "user-2", teamId: "team-2", authorizedTeamIds: ["team-1"] } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, recordScope: "application-sales-scope", ownerId: "user-2", applicationWide: true } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, recordScope: "application-sales-scope", applicationWide: false } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...viewer, scope: { kind: "record", recordId: "collection" }, facts: { ...viewer.facts, recordId: "collection", collectionScope: true, authorizedTeamIds: ["team-1"] } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...input, permissionId: "sales.tasks.write", facts: { ...input.facts, mutationAllowed: false } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, salesScopeRevision: 0 } }).outcome, "deny");

  const fieldExecutor = salesPermissionPolicyExecutors["sales.policy.opportunities.current"];
  assert.equal(fieldExecutor.evaluate({
    ...input,
    permissionId: "sales.opportunities.amount.read",
    scope: { kind: "field", recordId: "task-1", fieldId: "amount" },
    facts: { ...input.facts, fieldId: "amount", fieldAllowed: false }
  }).outcome, "deny");
});

test("Sales registers source/action-backed tools with strict write policy", () => {
  assert.equal(AgentToolDescriptorSchema.safeParse(salesSearchTasksDescriptor).success, true);
  assert.equal(AgentToolDescriptorSchema.safeParse(salesCreateTaskToolDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesTaskCreateDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesTaskUpdateDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesOpportunityStageUpdateDescriptor).success, true);
  assert.deepEqual(salesSearchTasksDescriptor.invocation, { kind: "source", source: { id: "sales.tasks", version: 2 } });
  assert.equal(salesSearchTasksDescriptor.policy, "sales.policy.tasks.current");
  assert.deepEqual(salesSearchTasksDescriptor.inputSchema.required, ["title"]);
  assert.deepEqual(Object.keys(salesSearchTasksDescriptor.inputSchema.properties), ["title"]);
  assert.deepEqual(salesCreateTaskToolDescriptor.invocation, { kind: "action", action: { id: "sales.task.create", version: 2 } });
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
  const permissionIds = new Set(salesCrmPermissionDescriptors.map(({ id }) => id));
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

test("the Sales create action finalizes resource-bound audit evidence in its transaction", async () => {
  const calls = [];
  const request = {
    payload: {
      find: async () => ({ docs: [], hasNextPage: false }),
      create: async (options) => {
        calls.push(options);
        return { id: "task-7", title: options.data.title, status: options.data.status, revision: options.data.revision };
      },
      update: async (options) => {
        calls.push(options);
        return { id: "task-7", title: "Call customer", status: "open", revision: 1 };
      }
    },
    locale: "en-US",
    transactionID: "tx-7"
  };
  const result = await salesTaskCreateHandler({
    actor: { principal: { kind: "user", id: "user-1" }, effectiveActor: { kind: "user", id: "user-1" } },
    request,
    authorizationContext: { actionId: "sales.task.create", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-2", teamId: "team-1" },
    input: { title: "Call customer" },
    idempotencyKey: "create-task-1",
    signal: new AbortController().signal
  });
  assert.deepEqual(result, { id: "task-7", title: "Call customer", status: "open", revision: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].collection, "sales-tasks");
  assert.equal(calls[0].overrideAccess, true);
  assert.equal(calls[0].depth, 0);
  assert.deepEqual(calls[0].user, { id: "user-1", collection: "users" });
  assert.equal(calls[0].req, request);
  assert.deepEqual(calls[0].data, {
    title: "Call customer", status: "open", applicationId: "customer-gate-1", environment: "production",
    ownerId: "user-1", teamId: "team-1", createdBy: "user-1", updatedBy: "user-1", revision: 1,
    audit: [], archiveStatus: "active"
  });
  assert.deepEqual(calls[0].context, {});
  assert.equal(calls[1].collection, "sales-tasks");
  assertActionAudit(calls[1].data.audit[0], {
    actionId: "sales.task.create", resourceId: "task-7", applicationId: "customer-gate-1", environment: "production",
    fromState: "absent", toState: "open", actorId: "user-1", revision: 1, idempotencyKey: "create-task-1"
  });
  assert.deepEqual({ eventId: calls[1].context.kNexSalesEvent.eventId, type: calls[1].context.kNexSalesEvent.type }, { eventId: "create-task-1", type: "sales.event.task-changed" });
  assert.deepEqual(calls[1].context.kNexSalesEvent.transition, calls[1].data.audit[0]);
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
  await run({ ...base, id: "task-event-1", type: "sales.event.task-changed", payload: { resourceId: "task-1", actionId: "sales.task.update", environment: "production", fromState: "open", toState: "completed", revision: 2, idempotencyKey: "task-event-1", operation: "update" } });
  await run({ ...base, id: "opportunity-event-1", type: "sales.event.opportunity-changed", payload: { resourceId: "opp-1", actionId: "sales.opportunity.stage.update", environment: "production", fromState: "discovery", toState: "proposal", revision: 8, idempotencyKey: "opportunity-event-1", operation: "update" } });
  assert.deepEqual(publications.map(({ channel, message }) => ({ topicId: channel.topicId, message })), [
    { topicId: "sales.realtime.tasks", message: { sourceId: "sales.tasks", resourceId: "task-1", actionId: "sales.task.update", environment: "production", fromState: "open", toState: "completed", revision: 2, idempotencyKey: "task-event-1", operation: "update" } },
    { topicId: "sales.realtime.opportunities", message: { sourceId: "sales.opportunities", resourceId: "opp-1", actionId: "sales.opportunity.stage.update", environment: "production", fromState: "discovery", toState: "proposal", revision: 8, idempotencyKey: "opportunity-event-1", operation: "update" } }
  ]);
});

test("Sales output schemas enforce canonical task shapes", () => {
  const validTable = {
    fields: ["title", "status"],
    rows: [{
      key: "task-1",
      values: {
        title: { kind: "text", value: "Follow-up" },
        status: { kind: "status", value: "open" }
      }
    }],
    page: { number: 1, pageSize: 25, hasNext: false }
  };
  assert.equal(salesTasksDefinition.outputSchema.safeParse(validTable).success, true);
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
    rows: [{ ...validTable.rows[0], values: { title: null, status: validTable.rows[0].values.status } }]
  }).success, false);
});

test("the task source applies bounded projection, allowlisted operations, and pagination", async () => {
  let call;
  const result = await salesTasksHandler(handlerContext({
    selectedFields: ["title", "status"],
    query: {
      page: { number: 2, size: 10 },
      filters: [{ field: "title", operator: "contains", value: "follow" }],
      sort: [{ field: "status", direction: "desc" }]
    },
    recordScope: salesScope("sales.tasks"),
    request: {
      payload: {
        find: async (options) => {
          call = options;
          return { docs: [{ id: "task-1", title: "Follow-up", status: "open" }], page: 2, totalPages: 3, hasNextPage: true };
        }
      }
    }
  }));
  assert.deepEqual(result, {
    fields: ["title", "status"],
    rows: [{ key: "task-1", values: {
      title: { kind: "text", value: "Follow-up" },
      status: { kind: "status", value: "open" }
    } }],
    page: { number: 2, pageSize: 10, hasNext: true }
  });
  assert.equal(call.overrideAccess, true);
  assert.equal(call.depth, 0);
  assert.equal(call.page, 2);
  assert.equal(call.limit, 10);
  assert.deepEqual(call.select, { id: true, title: true, status: true });
  assert.deepEqual(call.sort, ["-status", "id"]);
  assert.deepEqual(call.where, { and: [
    { and: [{ applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }, { ownerId: { equals: "user-1" } }] },
    { title: { contains: "follow" } }
  ] });
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

test("Sales sources require closed host-issued application and environment scopes", async () => {
  for (const recordScope of [undefined, { kind: "sales.tasks" }, { kind: "sales.tasks", where: {} },
    { kind: "sales.tasks", where: { arbitrary: { equals: "value" } } }]) {
    await assert.rejects(salesTasksHandler(handlerContext({ recordScope })), /closed application and environment record scope/);
  }
  await assert.rejects(salesTasksHandler(handlerContext({
    recordScope: { ...salesScope("sales.tasks"), where: { and: [
      { applicationId: { equals: "other-customer" } }, { environment: { equals: "production" } }, { ownerId: { equals: "user-1" } }
    ] } },
  })), /closed application and environment record scope/);
  await assert.rejects(salesTasksHandler(handlerContext({
    recordScope: { kind: "sales.tasks", where: { and: [
      { or: [{ applicationId: { equals: "customer-gate-1" } }, { ownerId: { equals: "user-1" } }] },
      { environment: { equals: "production" } }, { ownerId: { equals: "user-1" } }
    ] } }
  })), /closed application and environment record scope/);
  await assert.rejects(salesTasksHandler(handlerContext({
    recordScope: { ...salesScope("sales.tasks"), where: { and: [
      { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "staging" } }, { ownerId: { equals: "user-1" } }
    ] } }
  })), /closed application and environment record scope/);
  await assert.rejects(salesTasksHandler(handlerContext({
    request: { applicationIdentity: { applicationId: "other-customer", environment: "production" } }
  })), /closed application and environment record scope/);
  for (const clause of [{ applicationId: { equals: "customer-gate-1", extraOperator: "bypass" } }, { environment: { equals: "production", extraOperator: "bypass" } }]) {
    await assert.rejects(salesTasksHandler(handlerContext({
      recordScope: { ...salesScope("sales.tasks"), where: { and: [clause, { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }, { ownerId: { equals: "user-1" } }] } }
    })), /closed application and environment record scope/);
  }
  let observed;
  const teamScope = { and: [
    { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } },
    { or: [{ ownerId: { equals: "user-1" } }, { teamId: { in: ["team-1", "team-2"] } }] }
  ] };
  await salesTasksHandler(handlerContext({
    recordScope: { kind: "sales.tasks", where: teamScope },
    request: { payload: { find: async (options) => { observed = options.where; return { docs: [], hasNextPage: false }; } } }
  }));
  assert.deepEqual(observed, teamScope);
  const applicationScope = { and: [
    { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }
  ] };
  await salesTasksHandler(handlerContext({
    recordScope: { kind: "sales.tasks", where: applicationScope },
    request: { payload: { find: async (options) => { observed = options.where; return { docs: [], hasNextPage: false }; } } }
  }));
  assert.deepEqual(observed, applicationScope);
  for (const inValues of [[], ["team-1", "team-1"], [""], Array.from({ length: 33 }, (_, index) => `team-${index}`)]) {
    await assert.rejects(salesTasksHandler(handlerContext({
      recordScope: { kind: "sales.tasks", where: { and: [
        { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }, { teamId: { in: inValues } }
      ] } }
    })), /closed application and environment record scope/);
  }
  await assert.rejects(salesTasksHandler(handlerContext({
    recordScope: { kind: "sales.tasks", where: { and: [
      { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }, { ownerId: { in: ["user-1"] } }
    ] } }
  })), /closed application and environment record scope/);
});

test("the opportunities source returns bounded canonical rows", async () => {
  const result = await salesOpportunitiesHandler(handlerContext({
    request: { payload: { find: async (options) => {
      assert.equal(options.collection, "sales-opportunities");
      assert.equal(options.select.currency, true);
      return { docs: [{ id: "opp-1", name: "Platform rollout", stageId: "discovery", amount: "1200.50", currency: "EUR", revision: 7 }], hasNextPage: false };
    } } },
    selectedFields: ["name", "stage-id", "revision", "amount"],
    recordScope: salesScope("sales.opportunities")
  }));
  assert.deepEqual(result.rows[0], {
    key: "opp-1",
    values: {
      name: { kind: "text", value: "Platform rollout" },
      "stage-id": { kind: "status", value: "discovery" },
      revision: { kind: "integer", value: 7 },
      amount: { kind: "money", value: "1200.5", currency: "EUR", scale: 2 }
    }
  });
});

test("Sales opportunity output accepts only exact canonical selected cells", () => {
  const valid = {
    fields: ["name", "stage-id", "revision", "amount"],
    rows: [{ key: "opp-1", values: {
      name: { kind: "text", value: "Platform rollout" },
      "stage-id": { kind: "status", value: "discovery" },
      revision: { kind: "integer", value: 7 },
      amount: { kind: "money", value: "1200.5", currency: "EUR", scale: 2 }
    } }],
    page: { number: 1, pageSize: 25, hasNext: false }
  };
  assert.equal(salesOpportunitiesOutputRuntimeSchema.safeParse(valid).success, true);
  assert.equal(salesOpportunitiesOutputRuntimeSchema.safeParse({ ...valid, rows: [{ ...valid.rows[0], values: { ...valid.rows[0].values, amount: null } }] }).success, true);
  for (const values of [
    { name: valid.rows[0].values.name, "stage-id": valid.rows[0].values["stage-id"] },
    { ...valid.rows[0].values, extra: { kind: "text", value: "extra" } },
    { ...valid.rows[0].values, name: { kind: "status", value: "Platform rollout" } },
    { ...valid.rows[0].values, "stage-id": { kind: "status", value: "unknown" } },
    { ...valid.rows[0].values, revision: { kind: "integer", value: 0 } },
    { ...valid.rows[0].values, amount: { kind: "money", value: "1200.5", currency: "eur", scale: 2 } },
    { ...valid.rows[0].values, amount: { kind: "money", value: "1200.5", currency: "EUR", scale: 19 } }
  ]) assert.equal(salesOpportunitiesOutputRuntimeSchema.safeParse({ ...valid, rows: [{ ...valid.rows[0], values }] }).success, false);
});

test("Sales opportunity money preserves stored currency and rejects malformed amount pairs", async () => {
  const source = (document) => salesOpportunitiesHandler(handlerContext({
    request: { payload: { find: async () => ({ docs: [{ id: "opp-1", name: "Platform rollout", stageId: "discovery", revision: 1, ...document }], hasNextPage: false }) } },
    selectedFields: ["amount"], recordScope: salesScope("sales.opportunities")
  }));
  assert.deepEqual((await source({ amount: "0.00", currency: "EUR" })).rows[0].values.amount, { kind: "money", value: "0", currency: "EUR", scale: 2 });
  for (const document of [
    { amount: "12.3x", currency: "EUR" }, { amount: "12.3", currency: "eur" },
    { amount: 12.3, currency: "EUR" }, { amount: null, currency: "EUR" }, { amount: "12.3", currency: null }
  ]) await assert.rejects(source(document));
});

test("Sales pipeline audit counts exactly six canonical stages", () => {
  const result = salesPipelineAuditJob({
    opportunities: [{ stage: "qualification" }, { stage: "discovery" }, { stage: "proposal" }, { stage: "negotiation" }, { stage: "won" }, { stage: "lost" }],
    signal: new AbortController().signal
  });
  assert.deepEqual(result.stageCounts, { qualification: 1, discovery: 1, proposal: 1, negotiation: 1, won: 1, lost: 1 });
});

test("Sales mutation lifecycles reject invalid, stale, replayed, and foreign-scope writes", async () => {
  let updates = 0;
  let creates = 0;
  const readWheres = [];
  const request = {
    payload: {
      find: async (options) => { readWheres.push(options.where); return { docs: [] }; }, create: async () => { creates += 1; return {}; },
      update: async () => { updates += 1; return { docs: [], errors: [] }; }
    }
  };
  const base = {
    actor: handlerContext().actor, request, idempotencyKey: "replay-1", signal: new AbortController().signal,
    authorizationContext: { actionId: "sales.task.update", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", teamId: "team-1" }
  };
  await assert.rejects(salesTaskUpdateHandler({ ...base, input: { id: "task-1", expectedRevision: 1, expectedStatus: "completed", status: "cancelled" } }));
  await assert.rejects(salesTaskUpdateHandler({ ...base, input: { id: "task-1", expectedRevision: 1, expectedStatus: "open", status: "open" } }));
  await assert.rejects(salesTaskUpdateHandler({ ...base, input: { id: "task-1", expectedRevision: 1, expectedStatus: "open", status: "completed" } }), (error) => error?.code === "STALE_RECORD");
  await assert.rejects(salesTaskUpdateHandler({ ...base, authorizationContext: { ...base.authorizationContext, ownerId: "user-2", teamId: "team-2" }, input: { id: "task-1", expectedRevision: 1, expectedStatus: "open", status: "cancelled" } }), (error) => error?.code === "STALE_RECORD");
  await assert.rejects(salesTaskCreateHandler({ ...base, authorizationContext: { ...base.authorizationContext, actionId: "sales.task.create", resourceId: undefined }, input: { title: "Blocked", status: "completed" } }));
  await assert.rejects(salesOpportunityStageUpdateHandler({ ...base, authorizationContext: { ...base.authorizationContext, actionId: "sales.opportunity.stage.update", resourceId: "opp-1" }, input: { id: "opp-1", expectedStage: "negotiation", expectedRevision: 1, stage: "won" } }));
  assert.deepEqual(readWheres.at(-1).and, [
    { id: { equals: "task-1" } }, { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } },
    { ownerId: { equals: "user-2" } }, { teamId: { equals: "team-2" } }, { status: { equals: "open" } }, { revision: { equals: 1 } }
  ]);
  assert.equal(creates, 0);
  assert.equal(updates, 0);
});

test("Sales rejects malformed or unbounded prior audit history before a write", async () => {
  let updates = 0;
  const authorizationContext = { actionId: "sales.task.update", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" };
  const transition = { actionId: "sales.task.update", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production", fromState: "open", toState: "completed", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 2, idempotencyKey: "prior-close-1" };
  for (const audit of [[{ notAnAudit: true }], [{ kind: "p13-2-generated-app-seed" }], [{ kind: "phase-13-legacy-upgrade", receiptDigest: "not-a-digest" }], [{ ...transition, actionId: "unknown" }], [transition, { ...transition, revision: 4, idempotencyKey: "prior-close-2" }], Array.from({ length: 101 }, () => ({ kind: "legacy" }))]) {
    const request = { payload: {
      find: async () => ({ docs: [{ id: "task-1", audit }] }), create: async () => ({}),
      update: async () => { updates += 1; return { docs: [], errors: [] }; }
    } };
    await assert.rejects(salesTaskUpdateHandler({
      actor: handlerContext().actor, request, authorizationContext,
      input: { id: "task-1", expectedRevision: 1, expectedStatus: "open", status: "completed" },
      idempotencyKey: `audit-${updates + 1}`, signal: new AbortController().signal
    }), (error) => error?.code === "STALE_RECORD");
  }
  assert.equal(updates, 0);
});

test("Sales audit origin and current-row binding are collection-specific", async () => {
  let updates = 0;
  const authorizationContext = { actionId: "sales.task.update", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" };
  const taskCreate = { actionId: "sales.task.create", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production", fromState: "absent", toState: "open", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 1, idempotencyKey: "create-1" };
  const opportunityTransition = { ...taskCreate, actionId: "sales.opportunity.stage.update", fromState: "qualification", toState: "discovery", revision: 2 };
  for (const document of [
    { id: "task-1", revision: 1, audit: [] },
    { id: "task-1", revision: 2, audit: [{ kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}` }] },
    { id: "task-1", revision: 2, audit: [opportunityTransition] },
    { id: "task-1", revision: 1, audit: [{ ...taskCreate, resourceId: "other-task" }] },
    { id: "task-1", revision: 2, audit: [taskCreate] }
  ]) {
    const request = { payload: { find: async () => ({ docs: [document] }), create: async () => ({}), update: async () => { updates += 1; return { docs: [], errors: [] }; } } };
    await assert.rejects(salesTaskUpdateHandler({ actor: handlerContext().actor, request, authorizationContext,
      input: { id: "task-1", expectedRevision: document.revision, expectedStatus: "open", status: "completed" }, idempotencyKey: `strict-${document.revision}`, signal: new AbortController().signal
    }), (error) => error?.code === "STALE_RECORD" && error?.status === 409);
  }
  const migration = { kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "lead" };
  const firstStage = { actionId: "sales.opportunity.stage.update", resourceId: "opp-1", applicationId: "customer-gate-1", environment: "production", fromState: "qualification", toState: "discovery", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 2, idempotencyKey: "stage-1" };
  const repeatedStage = { ...firstStage, revision: 3, idempotencyKey: "stage-2" };
  const opportunityRequest = { payload: { find: async () => ({ docs: [{ id: "opp-1", revision: 3, audit: [migration, firstStage, repeatedStage] }] }), create: async () => ({}), update: async () => { updates += 1; return { docs: [], errors: [] }; } } };
  await assert.rejects(salesOpportunityStageUpdateHandler({ actor: handlerContext().actor, request: opportunityRequest,
    authorizationContext: { ...authorizationContext, actionId: "sales.opportunity.stage.update", resourceId: "opp-1" },
    input: { id: "opp-1", expectedRevision: 3, expectedStage: "discovery", stage: "proposal" }, idempotencyKey: "strict-opp", signal: new AbortController().signal
  }), (error) => error?.code === "STALE_RECORD" && error?.status === 409);
  assert.equal(updates, 0);
});

test("Sales task CAS admits one close and rejects its replay without another write", async () => {
  const state = { id: "task-1", title: "Follow-up", status: "open", revision: 1, audit: [{ actionId: "sales.task.create", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production", fromState: "absent", toState: "open", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 1, idempotencyKey: "create-1" }] };
  let updates = 0;
  const request = {
    payload: {
      create: async () => ({}),
      find: async (options) => {
        const predicates = options.where.and;
        const value = (field) => predicates.find((predicate) => predicate[field] !== undefined)?.[field].equals;
        return value("id") === state.id && value("applicationId") === "customer-gate-1" && value("environment") === "production" && value("ownerId") === "user-1" && value("teamId") === "team-1" && value("status") === state.status && value("revision") === state.revision
          ? { docs: [structuredClone(state)] } : { docs: [] };
      },
      update: async (options) => {
        updates += 1;
        Object.assign(state, { status: options.data.status, revision: options.data.revision, audit: options.data.audit });
        return { docs: [structuredClone(state)], errors: [] };
      }
    }
  };
  const input = { id: "task-1", expectedRevision: 1, expectedStatus: "open", status: "completed" };
  const base = { actor: handlerContext().actor, request, authorizationContext: { actionId: "sales.task.update", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", teamId: "team-1" }, input, idempotencyKey: "close-1", signal: new AbortController().signal };
  await salesTaskUpdateHandler(base);
  await assert.rejects(salesTaskUpdateHandler(base), (error) => error?.code === "STALE_RECORD");
  assert.equal(updates, 1);
  assertActionAudit(state.audit[1], {
    actionId: "sales.task.update", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production",
    fromState: "open", toState: "completed", actorId: "user-1", revision: 2, idempotencyKey: "close-1"
  });
});

test("Sales opportunity stage history appends one complete audit entry per accepted transition", async () => {
  const state = { id: "opp-1", name: "Platform rollout", stageId: "qualification", revision: 1, audit: [{ kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "lead" }] };
  const request = {
    payload: {
      create: async () => ({}),
      find: async (options) => {
        const equals = (field) => options.where.and.find((entry) => entry[field] !== undefined)?.[field].equals;
        return equals("id") === state.id && equals("stageId") === state.stageId && equals("revision") === state.revision
          ? { docs: [structuredClone(state)] } : { docs: [] };
      },
      update: async (options) => {
        Object.assign(state, { stageId: options.data.stageId, revision: options.data.revision, audit: options.data.audit });
        return { docs: [structuredClone(state)], errors: [] };
      }
    }
  };
  const authorizationContext = { actionId: "sales.opportunity.stage.update", resourceId: "opp-1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" };
  const stages = ["discovery", "proposal", "negotiation"];
  for (const stage of stages) {
    const result = await salesOpportunityStageUpdateHandler({
      actor: handlerContext().actor, request, authorizationContext,
      input: { id: "opp-1", expectedStage: state.stageId, expectedRevision: state.revision, stage },
      idempotencyKey: `opp-${stage}-1`, signal: new AbortController().signal
    });
    assert.equal(result.stage, stage);
  }
  assert.equal(state.audit.length, stages.length + 1);
  for (const [index, entry] of state.audit.slice(1).entries()) {
    assertActionAudit(entry, {
      actionId: "sales.opportunity.stage.update", resourceId: "opp-1", applicationId: "customer-gate-1", environment: "production",
      fromState: index === 0 ? "qualification" : stages[index - 1], toState: stages[index], actorId: "user-1", revision: index + 2,
      idempotencyKey: `opp-${stages[index]}-1`
    });
  }
});

test("Sales update actions use actor-scoped Payload updates exactly once", async () => {
  const calls = [];
  const taskAudit = { actionId: "sales.task.create", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production", fromState: "absent", toState: "open", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 1, idempotencyKey: "task-create-1" };
  const opportunityAudit = { kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "qualified" };
  const request = {
    payload: {
      find: async (options) => ({ docs: [{ id: options.collection === "sales-tasks" ? "task-1" : "opp-1", revision: 1, audit: [options.collection === "sales-tasks" ? taskAudit : opportunityAudit] }] }), create: async () => ({}),
      update: async (options) => {
        calls.push(options);
        return options.collection === "sales-tasks"
          ? { docs: [{ id: "task-1", title: "Existing", status: options.data.status, revision: options.data.revision }], errors: [] }
          : { docs: [{ id: "opp-1", name: "Platform rollout", stageId: options.data.stageId, revision: options.data.revision }], errors: [] };
      }
    }
  };
  const auth = (actionId, resourceId) => ({ actionId, resourceId, applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" });
  const base = { actor: handlerContext().actor, request, idempotencyKey: "update-1", signal: new AbortController().signal };
  assert.deepEqual(await salesTaskUpdateHandler({ ...base, authorizationContext: auth("sales.task.update", "task-1"), input: { id: "task-1", expectedRevision: 1, expectedStatus: "open", status: "completed" } }), { id: "task-1", title: "Existing", status: "completed", revision: 2 });
  assert.deepEqual(await salesOpportunityStageUpdateHandler({ ...base, authorizationContext: auth("sales.opportunity.stage.update", "opp-1"), input: { id: "opp-1", expectedStage: "discovery", expectedRevision: 1, stage: "proposal" } }), { id: "opp-1", name: "Platform rollout", stage: "proposal", revision: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.overrideAccess === true && call.user.id === "user-1"), true);
  assert.deepEqual(calls[1].where, { and: [
    { id: { equals: "opp-1" } },
    { applicationId: { equals: "customer-gate-1" } },
    { environment: { equals: "production" } },
    { ownerId: { equals: "user-1" } },
    { stageId: { equals: "discovery" } },
    { revision: { equals: 1 } }
  ] });
  assert.deepEqual(calls[0].data.audit.slice(0, 1), [taskAudit]);
  assertActionAudit(calls[0].data.audit[1], {
    actionId: "sales.task.update", resourceId: "task-1", applicationId: "customer-gate-1", environment: "production",
    fromState: "open", toState: "completed", actorId: "user-1", revision: 2, idempotencyKey: "update-1"
  });
  assert.deepEqual(calls[1].data.audit.slice(0, 1), [opportunityAudit]);
  assertActionAudit(calls[1].data.audit[1], {
    actionId: "sales.opportunity.stage.update", resourceId: "opp-1", applicationId: "customer-gate-1", environment: "production",
    fromState: "discovery", toState: "proposal", actorId: "user-1", revision: 2, idempotencyKey: "update-1"
  });
});

test("Sales rejects a stale opportunity card without a blind update", async () => {
  let updates = 0;
  const request = { payload: { find: async () => ({ docs: [] }), create: async () => ({}), update: async () => { updates += 1; return { docs: [], errors: [] }; } } };
  await assert.rejects(salesOpportunityStageUpdateHandler({
    actor: handlerContext().actor, request,
    authorizationContext: { actionId: "sales.opportunity.stage.update", resourceId: "opp-1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" },
    idempotencyKey: "stale-1", signal: new AbortController().signal,
    input: { id: "opp-1", expectedStage: "qualification", expectedRevision: 1, stage: "discovery" }
  }), (error) => error?.code === "STALE_RECORD" && error?.status === 409);
  assert.equal(updates, 0);
});
