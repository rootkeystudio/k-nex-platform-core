import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PluginManifestSchema, type AgentToolDescriptor, type DataSourceDefinition } from "@k-nex/contracts";
import {
  BoundedQueryBudgetEvaluator,
  BoundedToolRiskBudgetEvaluator,
  CanonicalOutputContractValidator,
  DataSourceGateway,
  DefinitionSourceSchemaValidator,
  DescriptorSurfaceAudienceGuard,
  InMemoryDataSourceCachePolicy,
  InMemoryToolApprovalEvaluator,
  InMemoryToolIdempotencyCoordinator,
  PolicyAuthorizationEvaluator,
  RegisteredHandlerDispatcher,
  RegisteredToolAuthorization,
  RegisteredToolDataSourceDispatcher,
  RegisteredToolDispatcher,
  RegisteredToolInputValidator,
  RegisteredToolOutputValidator,
  RegisteredToolRedactor,
  RegisteredToolTargetResolver,
  SafeToolAuditDecorator,
  SafeToolProblemSerializer,
  SafeProblemDetailsSerializer,
  ScriptedSalesToolClient,
  TableProjectionRedactor,
  ToolCatalog,
  BoundToolDelegationEvaluator,
  DelegatedToolCatalogPolicy,
  ToolGatewayError,
  ToolExecutionGateway,
  createPluginLifecycleState,
  executeRegistration,
  reconcilePluginAvailability,
  scopePluginRegistration,
  type DataSourceHandler,
  type DataSourcePolicyService,
  type RegisteredDataSource,
  type ScriptedToolRequestDetails,
  type ToolExecutionContext,
  type ToolGatewayRequest,
  type ToolGatewayStages
} from "@k-nex/runtime";
import {
  salesCreateTaskToolDescriptor,
  salesRegistration,
  salesSearchTasksDescriptor,
  salesTasksDefinition
} from "@k-nex/module-sales/server";
import { describe, expect, it } from "vitest";

import { createPayloadMcpPlugin, createPayloadMcpPluginConfig, createPayloadPersistenceCapability, PayloadRequestAuthenticator } from "@k-nex/payload-adapter";

const manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../k-nex.plugin.json"),
  "utf8"
)));

function registration(scope = true) {
  const integrity = `sha512-${"a".repeat(86)}==`;
  const raw = executeRegistration({
    graph: {
      resolverVersion: "1.0.0",
      plugins: [{
        id: manifest.id,
        kind: manifest.kind,
        package: manifest.package,
        version: manifest.version,
        integrity,
        required: [],
        optional: []
      }],
      capabilityProviders: [],
      registrationOrder: [manifest.id]
    },
    installed: [{
      package: { name: manifest.package, version: manifest.version, integrity },
      manifest
    }],
    registrations: [salesRegistration]
  });
  const lifecycle = createPluginLifecycleState({
    pluginId: manifest.id, catalogStatus: "supported",
    package: { status: "installed", name: manifest.package, version: manifest.version, integrity },
    enabled: true, configuration: { revision: 1, ready: true }, migration: { current: 1, required: 1, ready: true },
    dataState: "active", releaseStatus: "supported"
  });
  if (!scope) return raw;
  return scopePluginRegistration(raw, [reconcilePluginAvailability(raw, lifecycle)]);
}

describe("P2A.8 Sales tool proof", () => {
  it("runs one logical approved write and enforces actor-filtered MCP list/call", async () => {
    const resolved = registration();
    expect(() => new ToolCatalog(registration(false) as never, { isVisible: () => true })).toThrowError(/authoritative lifecycle scoping/);
    expect(() => new RegisteredToolTargetResolver(registration(false) as never).resolve(salesCreateTaskToolDescriptor))
      .toThrowError(/until lifecycle availability is reconciled/);
    const actor = {
      principal: { kind: "user" as const, id: "user-1" },
      effectiveActor: { kind: "user" as const, id: "user-1" }
    };
    const tasks = [{ id: "task-1", title: "Seed follow-up", status: "open", potentialRevenue: "10.00", privateNote: "seed-secret" }];
    let creates = 0;
    const payloadRequest = {
      user: { id: "user-1", collection: "users" },
      payload: {
        find: async (options: { page?: number; limit?: number }) => {
          const page = options.page ?? 1;
          const limit = options.limit ?? tasks.length;
          const totalPages = Math.max(1, Math.ceil(tasks.length / limit));
          return { docs: tasks.slice((page - 1) * limit, page * limit), page, totalPages, hasNextPage: page < totalPages };
        },
        create: async (options: { data: { title: string; status?: "open" | "done" } }) => {
          creates += 1;
          const task = { id: `task-${tasks.length + 1}`, title: options.data.title, status: options.data.status ?? "open", potentialRevenue: null, privateNote: null };
          tasks.push(task);
          return task;
        }
      },
      locale: "en-US",
      transactionID: "tx-tool-proof"
    };
    const salesActor = (request: { readonly user?: unknown }) => {
      const user = request.user;
      if (user === null || typeof user !== "object" || !("id" in user) || typeof user.id !== "string") {
        throw new Error("Sales proof request has no actor.");
      }
      return { principal: { kind: "user" as const, id: user.id }, effectiveActor: { kind: "user" as const, id: user.id } };
    };
    const clock = { now: () => 1_000 };
    const delegationEvaluator = new BoundToolDelegationEvaluator(
      {
        resolve: () => ({
          id: "delegation-1",
          principalId: "user-1",
          agentClientId: "deterministic-client",
          applicationId: "app-1",
          allowedTools: [
            { id: salesSearchTasksDescriptor.id, version: salesSearchTasksDescriptor.version },
            { id: salesCreateTaskToolDescriptor.id, version: salesCreateTaskToolDescriptor.version }
          ],
          allowedEffects: ["read-only", "write"],
          expiresAtEpochMs: 2_000,
          revocationRevision: 1,
          resourceScope: { kind: "sales.tasks", id: "team-1" }
        } as const)
      },
      { resolve: () => ({ principalId: "user-1", agentClientId: "deterministic-client", applicationId: "app-1" }) },
      clock,
      { revision: () => 1 },
      { allows: () => true }
    );
    const evaluatedDelegation = await delegationEvaluator.evaluate(
      {
        correlationId: "catalog",
        rawRequest: payloadRequest,
        tool: { id: salesSearchTasksDescriptor.id, version: salesSearchTasksDescriptor.version },
        surface: "workspace",
        features: [],
        input: { title: "Seed" },
        signal: new AbortController().signal
      },
      { actor, request: payloadRequest, authorizationContext: { permissionFingerprint: "sales:open:full" } },
      { client: { id: "deterministic-client" }, session: { id: "session-1" } }
    );
    const authorizationContext = { permissionFingerprint: "sales:open:full" };
    const catalogContext = {
      actor,
      delegation: evaluatedDelegation,
      authorizationContext,
      surface: "workspace" as const,
      features: [] as const
    };
    const catalog = new ToolCatalog(resolved, new DelegatedToolCatalogPolicy({
      isVisible: ({ actor: visibleActor, authorizationContext: visibleContext, descriptor }) =>
        visibleActor.effectiveActor.id === "user-1" &&
        (visibleContext as { permissionFingerprint?: unknown }).permissionFingerprint === "sales:open:full" &&
        descriptor.ownerPluginId === manifest.id
    }));
    const audits: unknown[] = [];
    const approval = new InMemoryToolApprovalEvaluator(
      clock,
      {
        resolve: (context) => ({
          principalId: "user-1",
          agentSessionId: "session-1",
          ...((context.agentClient.session as { approvalId?: string }).approvalId === undefined
            ? {}
            : { approvalId: (context.agentClient.session as { approvalId: string }).approvalId })
        })
      },
      { authorize: () => true }
    );
    const budget = new BoundedToolRiskBudgetEvaluator(clock, {
      resolve: () => ({ principalId: "user-1", agentRunId: "run-1" })
    });
    const sourceDefinitions = new Map(
      resolved.contributions.sources.map(({ id, value }) => [id, value as DataSourceDefinition])
    );
    const sourceHandlers = new Map(
      resolved.bindings.sources.map(({ id, value }) => [id, value as DataSourceHandler])
    );
    const sourceCatalog = {
      lookup: (sourceId: string): RegisteredDataSource | undefined => {
        const definition = sourceDefinitions.get(sourceId);
        const handler = sourceHandlers.get(sourceId);
        return definition === undefined || handler === undefined ? undefined : { definition, handler };
      }
    };
    const salesPolicy: DataSourcePolicyService = {
      authorize: ({ authorizationContext, descriptor }) => {
        const permissionFingerprint = (authorizationContext as { permissionFingerprint?: unknown }).permissionFingerprint;
        return {
          sourceAllowed: permissionFingerprint === "sales:open:full" && descriptor.id === salesTasksDefinition.descriptor.id,
          recordScope: { kind: "sales.tasks", where: { status: { equals: "open" } } },
          allowedFields: descriptor.primaryContract.id === "table.records"
            ? ["title", "status", "potential-revenue"]
            : []
        };
      }
    };
    const dataSourceGateway = new DataSourceGateway({
      authenticator: new PayloadRequestAuthenticator({
        actor: salesActor,
        authorizationContext: () => ({ permissionFingerprint: "sales:open:full" }),
        requestContext: (request) => createPayloadPersistenceCapability(request, [
          { collection: "sales-tasks", operations: ["find", "create"] }
        ])
      }),
      catalog: sourceCatalog,
      surfaceAudience: new DescriptorSurfaceAudienceGuard(),
      authorization: new PolicyAuthorizationEvaluator(salesPolicy),
      budget: new BoundedQueryBudgetEvaluator({ now: clock.now }),
      dispatcher: new RegisteredHandlerDispatcher(),
      sourceSchema: new DefinitionSourceSchemaValidator(),
      outputContract: new CanonicalOutputContractValidator(),
      redactor: new TableProjectionRedactor(),
      cache: new InMemoryDataSourceCachePolicy({ now: clock.now }),
      observability: { success() {}, failure() {} },
      problemDetails: new SafeProblemDetailsSerializer()
    });
    const targetResolver = new RegisteredToolTargetResolver(resolved);
    const registeredAuthorization = new RegisteredToolAuthorization(targetResolver, {
      authorize: ({ context, target }) => {
        const delegation = context.delegation as { resourceScope?: { kind: string; id: string } };
        if (target.definition.descriptor.ownerPluginId !== context.descriptor.ownerPluginId ||
          delegation.resourceScope?.kind !== "sales.tasks" || delegation.resourceScope.id !== "team-1") {
          throw new ToolGatewayError("TOOL_TARGET_FORBIDDEN", 403, "Tool target access is forbidden.");
        }
        return Object.freeze({ resourceScope: delegation.resourceScope });
      }
    });
    const registeredDispatcher = new RegisteredToolDispatcher(
      targetResolver,
      new RegisteredToolDataSourceDispatcher(dataSourceGateway, {
        map: (context) => ({
          input: {},
          query: {
            page: { number: 1, size: 25 },
            filters: [{ field: "title", operator: "contains", value: (context.input as { title: string }).title }],
            sort: []
          },
          selectedFields: ["title", "status", "potential-revenue"]
        })
      })
    );
    const stages: ToolGatewayStages = {
      principal: {
        authenticate: (request) => {
          const authenticated = new PayloadRequestAuthenticator({
            actor: salesActor,
            authorizationContext: () => catalogContext.authorizationContext,
            requestContext: (payloadRequest) => createPayloadPersistenceCapability(payloadRequest, [
              { collection: "sales-tasks", operations: ["find", "create"] }
            ])
          }).authenticate({
            correlationId: request.correlationId,
            rawRequest: request.rawRequest,
            sourceId: "sales.tasks",
            surface: request.surface,
            input: {},
            query: { filters: [], sort: [] },
            selectedFields: [],
            signal: request.signal
          });
          return authenticated;
        }
      },
      agentClient: {
        authenticate: (request) => ({
          client: { id: "deterministic-client" },
          session: {
            id: "session-1",
            ...((request.rawRequest as { approvalId?: string }).approvalId === undefined
              ? {}
              : { approvalId: (request.rawRequest as { approvalId: string }).approvalId })
          }
        })
      },
      delegation: { evaluate: (request, principal, client) => delegationEvaluator.evaluate(request, principal, client) },
      catalog: {
        lookup: (id, version, context) => catalog.lookup(id, version, {
          actor: context.principal.actor as typeof actor,
          delegation: context.delegation,
          authorizationContext: context.principal.authorizationContext,
          surface: context.surface,
          features: context.features
        })
      },
      input: new RegisteredToolInputValidator(targetResolver),
      authorization: registeredAuthorization,
      budget,
      approval,
      idempotency: new InMemoryToolIdempotencyCoordinator(clock),
      dispatcher: registeredDispatcher,
      output: new RegisteredToolOutputValidator(targetResolver),
      redactor: new RegisteredToolRedactor(),
      audit: new SafeToolAuditDecorator(
        clock,
        {
          resolve: (request, context?: ToolExecutionContext) => ({
            principalId: "user-1",
            agentClientId: "deterministic-client",
            agentSessionId: "session-1",
            delegationId: "delegation-1",
            approvalId: (context?.approval as { id?: string } | undefined)?.id,
            idempotencyReference: (context?.idempotency as { reference?: string } | undefined)?.reference,
            inputDigest: (context?.idempotency as { inputDigest?: string } | undefined)?.inputDigest
          })
        },
        { write: (record) => { audits.push(record); } }
      ),
      problem: new SafeToolProblemSerializer()
    };
    const gateway = new ToolExecutionGateway(stages);
    const request = (details: ScriptedToolRequestDetails): ToolGatewayRequest => ({
      correlationId: details.correlationId,
      rawRequest: { ...payloadRequest, approvalId: details.approvalId },
      tool: details.tool,
      surface: details.context.surface,
      features: details.context.features,
      input: details.input,
      signal: new AbortController().signal,
      ...(details.idempotencyKey === undefined ? {} : { idempotencyKey: details.idempotencyKey })
    });
    const client = new ScriptedSalesToolClient({
      catalog,
      gateway,
      authenticate: () => catalogContext,
      request
    });
    const proof = await client.run({
      readTool: salesSearchTasksDescriptor,
      readInput: { title: "Seed" },
      forbiddenTool: { id: "sales.tools.forbidden", version: 1 },
      forbiddenInput: {},
      writeTool: salesCreateTaskToolDescriptor,
      writeInput: { title: "Approved follow-up", privateNote: "never-audit-this" },
      changedWriteInput: { title: "Changed follow-up", privateNote: "never-audit-this-either" },
      idempotencyKey: "create-task-proof-1",
      approval: ({ stage }) => ({ id: `approval-${stage}`, decision: "approve", expiresAtEpochMs: 2_000 })
    });

    expect(proof.catalog.tools.map(({ id }) => id)).toEqual(["sales.tools.create-task", "sales.tools.search-tasks"]);
    expect(proof.read).toMatchObject({ ok: true, body: { trust: "structured-untrusted-content" } });
    expect(JSON.stringify(proof.read)).not.toContain("seed-secret");
    expect(proof.forbidden).toMatchObject({ ok: false, status: 404, body: { code: "TOOL_NOT_FOUND" } });
    expect(proof.prepared).toMatchObject({ ok: true, body: { status: "required" } });
    expect(proof.write).toMatchObject({ ok: true, body: { data: { id: "task-2", title: "Approved follow-up", status: "open" } } });
    expect(proof.replay).toEqual(proof.write);
    expect(proof.changedReplay).toMatchObject({ ok: false, status: 409, body: { code: "IDEMPOTENCY_KEY_REUSED" } });
    expect(creates).toBe(1);
    expect(tasks).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("never-audit-this");
    const cursorRequest = (query: unknown) => dataSourceGateway.query({
      correlationId: "sales-cursor-proof",
      rawRequest: payloadRequest,
      sourceId: salesTasksDefinition.descriptor.id,
      surface: "workspace",
      input: {},
      query,
      selectedFields: ["title", "status", "potential-revenue"],
      signal: new AbortController().signal
    });
    const firstCursorPage = await cursorRequest({ cursor: { size: 1 }, filters: [], sort: [] });
    expect(firstCursorPage).toMatchObject({ ok: true, body: { data: { rows: [{ key: "task-1" }], page: { number: 1, pageSize: 1, hasNext: true } } } });
    if (!firstCursorPage.ok) throw new Error("First authenticated Sales cursor page failed.");
    const nextCursor = (firstCursorPage.body.data as { page: { nextCursor?: string } }).page.nextCursor;
    expect(nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const secondCursorPage = await cursorRequest({ cursor: { size: 1, after: nextCursor }, filters: [], sort: [] });
    expect(secondCursorPage).toMatchObject({ ok: true, body: { data: { rows: [{ key: "task-2" }], page: { number: 2, pageSize: 1, hasNext: false } } } });
    const changedQueryReplay = await cursorRequest({ cursor: { size: 2, after: nextCursor }, filters: [], sort: [] });
    expect(changedQueryReplay).toMatchObject({ ok: false, status: 500, body: { code: "INTERNAL_ERROR" } });
    const invalidRead = await gateway.execute({
      correlationId: "invalid-read",
      rawRequest: payloadRequest,
      tool: { id: salesSearchTasksDescriptor.id, version: salesSearchTasksDescriptor.version },
      surface: "workspace",
      features: [],
      input: { title: "x".repeat(121) },
      signal: new AbortController().signal
    });
    expect(invalidRead).toMatchObject({ ok: false, status: 400, body: { code: "TOOL_INPUT_INVALID" } });

    const adapterOptions = {
      tools: [salesSearchTasksDescriptor, salesCreateTaskToolDescriptor],
      catalog,
      gateway,
      context: { resolve: (_request: unknown, user: unknown) => ({ ...catalogContext, actor: salesActor({ user }) }) },
      surface: "workspace" as const
    };
    const adapter = createPayloadMcpPluginConfig(adapterOptions);
    const payloadMcpRequest = { ...payloadRequest, headers: new Headers({ "x-correlation-id": "mcp-sales-read" }) };
    const defaults = {
      user: { id: "user-1", collection: "users" },
      createdAt: new Date(Date.now() - 1_000).toISOString(),
      enableAPIKey: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      "payload-mcp-tool": {
        kNexSalesToolsSearchTasksV1: true,
        kNexSalesToolsCreateTaskV1: true
      }
    } as never;
    const access = await adapter.overrideAuth!(payloadMcpRequest as never, async () => defaults);
    expect(Object.values(access["payload-mcp-tool"] ?? {})).toEqual([true, true]);
    const readHandler = adapter.mcp?.tools?.find(({ name }) => name.includes("search-tasks"))?.handler;
    const mcpRead = await readHandler!({ title: "Seed" }, payloadMcpRequest as never, undefined);
    expect(JSON.parse(mcpRead.content[0]!.text)).toMatchObject({ provenance: "k-nex-tool", trust: "structured-untrusted-content" });
    expect(mcpRead.content[0]!.text).not.toContain("seed-secret");

    const applied = await createPayloadMcpPlugin(adapterOptions)({
      secret: "mcp-sales-proof-secret",
      collections: [],
      globals: []
    } as never);
    const endpoint = applied.endpoints?.find(({ method, path }) => method === "post" && path === "/mcp");
    expect(endpoint?.handler).toBeTypeOf("function");
    const protocolConfig = {
      ...applied,
      admin: { ...applied.admin, timezones: { supportedTimezones: [] } },
      collections: (applied.collections ?? []).map((collection) => ({
        ...collection,
        flattenedFields: [],
        joins: {},
        polymorphicJoins: []
      }))
    };

    const protocolSecret = "mcp-sales-proof-secret";
    const ownerApiKey = "owner-protocol-key";
    const foreignApiKey = "foreign-protocol-key";
    const digest = (apiKey: string) => createHmac("sha256", protocolSecret).update(apiKey).digest("hex");
    const apiKeyDocuments = new Map([
      [digest(ownerApiKey), {
        user: { id: "user-1", collection: "users" },
        createdAt: new Date(Date.now() - 1_000).toISOString(),
        enableAPIKey: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        "payload-mcp-tool": {
          kNexSalesToolsSearchTasksV1: true,
          kNexSalesToolsCreateTaskV1: true
        }
      }],
      [digest(foreignApiKey), {
        user: { id: "user-2", collection: "users" },
        createdAt: new Date(Date.now() - 1_000).toISOString(),
        enableAPIKey: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        "payload-mcp-tool": {
          kNexSalesToolsSearchTasksV1: true,
          kNexSalesToolsCreateTaskV1: true
        }
      }]
    ]);
    const observedApiKeyDigests: string[] = [];
    let protocolCallId = 0;

    async function protocolCall(apiKey: string, method: string, params: Record<string, unknown> = {}) {
      const protocolPayload = {
        config: protocolConfig,
        db: { defaultIDType: "number" },
        secret: protocolSecret,
        logger: { info() {}, error() {} },
        find: async (options: { collection?: string; where?: { apiKeyIndex?: { equals?: unknown } } }) => {
          if (options.collection !== "payload-mcp-api-keys") {
            return { docs: tasks, page: 1, totalPages: 1, hasNextPage: false };
          }
          const requestedDigest = options.where?.apiKeyIndex?.equals;
          if (typeof requestedDigest !== "string") throw new Error("MCP API-key lookup did not use apiKeyIndex.");
          expect(options.where).toEqual({ apiKeyIndex: { equals: requestedDigest } });
          observedApiKeyDigests.push(requestedDigest);
          const document = apiKeyDocuments.get(requestedDigest);
          return { docs: document === undefined ? [] : [document] };
        },
        create: payloadRequest.payload.create
      };
      const response = await endpoint!.handler({
        url: "http://localhost/api/mcp",
        method: "POST",
        headers: new Headers({
          authorization: `Bearer ${apiKey}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json"
        }),
        body: JSON.stringify({ jsonrpc: "2.0", id: ++protocolCallId, method, params }),
        payload: protocolPayload,
        i18n: {}
      } as never);
      const text = await response.text();
      const data = text.startsWith("{")
        ? text
        : text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (data === undefined) throw new Error(`MCP protocol response was not JSON: ${text}`);
      return JSON.parse(data) as {
        result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean };
        error?: { code: number; message: string };
      };
    }

    const listedForOwner = await protocolCall(ownerApiKey, "tools/list");
    expect(listedForOwner.result?.tools?.map(({ name }) => name)).toEqual([
      "k-nex-sales-tools-search-tasks-v1",
      "k-nex-sales-tools-create-task-v1"
    ]);
    const calledForOwner = await protocolCall(ownerApiKey, "tools/call", {
      name: "k-nex-sales-tools-search-tasks-v1",
      arguments: { title: "Seed" }
    });
    expect(calledForOwner.result?.isError).toBeUndefined();
    expect(JSON.parse(calledForOwner.result!.content![0]!.text)).toMatchObject({ provenance: "k-nex-tool" });

    const listedForForeignActor = await protocolCall(foreignApiKey, "tools/list");
    expect(listedForForeignActor.error).toEqual({ code: -32601, message: "Method not found" });
    expect(listedForForeignActor.result?.tools).toBeUndefined();
    const calledForForeignActor = await protocolCall(foreignApiKey, "tools/call", {
      name: "k-nex-sales-tools-search-tasks-v1",
      arguments: { title: "Seed" }
    });
    expect(calledForForeignActor.error).toEqual({ code: -32601, message: "Method not found" });
    expect(calledForForeignActor.result).toBeUndefined();
    expect(observedApiKeyDigests).toEqual([
      digest(ownerApiKey),
      digest(ownerApiKey),
      digest(foreignApiKey),
      digest(foreignApiKey)
    ]);
  });
});
