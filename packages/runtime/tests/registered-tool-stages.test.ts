import type { ActionDefinition, AgentToolDescriptor, PluginManifest } from "@k-nex/contracts";
import type { InstalledPluginManifest, ResolvedPluginGraph } from "@k-nex/composition";
import { describe, expect, it } from "vitest";

import {
  executeRegistration,
  scopePluginRegistration,
  RegisteredToolAuthorization,
  RegisteredToolDataSourceDispatcher,
  RegisteredToolDispatcher,
  RegisteredToolInputValidator,
  RegisteredToolOutputValidator,
  RegisteredToolRedactor,
  RegisteredToolTargetResolver,
  ToolGatewayError,
  type ToolExecutionContext
} from "../src/index.js";

const actionDescriptor = {
  id: "fixture.action.run",
  version: 1,
  ownerPluginId: "module.fixture",
  inputSchema: {
    type: "object" as const,
    properties: { value: { type: "string" as const, minLength: 1 } },
    required: ["value"],
    additionalProperties: false as const
  },
  outputSchema: {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
    additionalProperties: false as const
  },
  permission: "fixture.run",
  policy: "fixture.run",
  effect: "read-only" as const,
  idempotency: "not-applicable" as const,
  dryRun: false
};

const tool: AgentToolDescriptor = {
  id: "fixture.tools.run",
  version: 1,
  ownerPluginId: "module.fixture",
  title: "Run fixture",
  description: "Run fixture.",
  inputSchema: actionDescriptor.inputSchema,
  outputSchema: actionDescriptor.outputSchema,
  invocation: { kind: "action", action: { id: actionDescriptor.id, version: actionDescriptor.version } },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: actionDescriptor.permission,
  policy: actionDescriptor.policy,
  effect: "read-only",
  risk: "low",
  approval: "none",
  idempotency: "not-applicable",
  dryRun: false,
  limits: { timeoutMs: 100, maxConcurrency: 1, ratePerMinute: 10, burst: 2, costClass: "low", maxCost: 1 },
  redaction: { inputPaths: [], outputPaths: ["/secret", "/nested/token"] },
  audit: { category: "fixture.run" }
};

const inputSchema = {
  safeParse(value: unknown) {
    return typeof value === "object" && value !== null && !Array.isArray(value) &&
      Object.keys(value).join("\u0000") === "value" && typeof (value as { value?: unknown }).value === "string"
      ? { success: true as const, data: value as { value: string } }
      : { success: false as const, error: new Error("invalid input") };
  }
};
const outputSchema = {
  safeParse(value: unknown) {
    return typeof value === "object" && value !== null && !Array.isArray(value) &&
      Object.keys(value).join("\u0000") === "ok" && typeof (value as { ok?: unknown }).ok === "boolean"
      ? { success: true as const, data: value }
      : { success: false as const, error: new Error("invalid output") };
  }
};

function registration() {
  const manifest: PluginManifest = {
    apiVersion: 1,
    id: "module.fixture",
    kind: "module",
    displayName: "Fixture",
    version: "1.0.0",
    package: "@k-nex/module-fixture",
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: [],
    requires: [],
    optional: [],
    conflicts: [],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "unsupported" },
    contributions: { permissions: { "fixture.run": "required" }, actions: { [actionDescriptor.id]: "required" }, tools: { [tool.id]: "required" } }
  };
  const installed: readonly InstalledPluginManifest[] = [{ package: { name: manifest.package, version: manifest.version, integrity: "sha512-fixture" }, manifest }];
  const graph: ResolvedPluginGraph = {
    resolverVersion: "1.0.0",
    plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: "sha512-fixture", required: [], optional: [] }],
    capabilityProviders: [],
    registrationOrder: [manifest.id]
  };
  const definition: ActionDefinition = { descriptor: actionDescriptor, inputSchema, outputSchema };
  return scopePluginRegistration(executeRegistration({
    graph,
    installed,
    registrations: [{
      pluginId: manifest.id,
      contracts(context) {
        context.register("permissions", "fixture.run", {
          id: "fixture.run", ownerPluginId: manifest.id, title: "Run fixture", description: "Run fixture action.",
          audience: "authenticated", resource: "fixture.action", operation: "execute",
          policy: { id: "fixture.policy", scope: "application", recordScoped: false, fieldScoped: false }
        });
        context.register("actions", actionDescriptor.id, definition);
        context.register("tools", tool.id, tool);
      },
      dataHandlers(context) {
        context.bind("actions", actionDescriptor.id, ({ input }) => ({ ok: true, secret: input, nested: { token: "token" } }));
      }
    }]
  }), []);
}

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    request: {
      correlationId: "fixture-correlation",
      rawRequest: {},
      tool: { id: tool.id, version: tool.version },
      surface: "workspace",
      features: [],
      input: { value: "input" },
      signal: new AbortController().signal
    },
    principal: { actor: { id: "user-1" }, request: {}, authorizationContext: { untrusted: true } },
    agentClient: { client: { id: "client-1" }, session: { id: "session-1" } },
    delegation: { id: "delegation-1" },
    descriptor: tool,
    input: { value: "input" },
    authorization: {},
    budget: {},
    signal: new AbortController().signal,
    ...overrides
  };
}

describe("registered tool stages", () => {
  it("resolve registrations and enforce exact input/output contracts", () => {
    const targets = new RegisteredToolTargetResolver(registration());
    const input = new RegisteredToolInputValidator(targets);
    const output = new RegisteredToolOutputValidator(targets);
    expect(input.validate(tool, { value: "ok" })).toEqual({ value: "ok" });
    expect(() => input.validate(tool, { value: "ok", undeclared: true })).toThrowError(expect.objectContaining({ code: "TOOL_INPUT_INVALID" }));
    expect(() => output.validate(tool, { ok: true })).not.toThrow();
    expect(() => output.validate(tool, { ok: true, undeclared: "x" })).toThrowError(expect.objectContaining({ code: "TOOL_OUTPUT_INVALID" }));
    expect(() => targets.resolve({ ...tool, policy: "fixture.other" })).toThrowError(ToolGatewayError);
  });

  it("dispatches the registered action, applies target policy, and removes descriptor output paths", async () => {
    const targets = new RegisteredToolTargetResolver(registration());
    const dispatched = new RegisteredToolDispatcher(targets, { dispatch: () => undefined });
    expect(dispatched.dispatch(context())).toEqual({ ok: true, secret: { value: "input" }, nested: { token: "token" } });
    const seen: unknown[] = [];
    const authorization = new RegisteredToolAuthorization(targets, { authorize: ({ target }) => { seen.push(target); return { scope: "fixture" }; } });
    await expect(authorization.authorize(context())).resolves.toMatchObject({ decision: { scope: "fixture" }, target: { kind: "action" } });
    expect(seen).toHaveLength(1);
    const redacted = new RegisteredToolRedactor().redact(context(), { ok: true, secret: "x", nested: { token: "y", keep: true } });
    expect(redacted).toEqual({ ok: true, nested: { keep: true } });
  });

  it("maps source tools through a bounded data-source gateway without exposing a handler", async () => {
    const target = {
      kind: "source" as const,
      definition: { descriptor: { id: "fixture.source", version: 1 } }
    } as never;
    let seen: unknown;
    const dispatcher = new RegisteredToolDataSourceDispatcher(
      {
        query(request) {
          seen = request;
          return {
            ok: true,
            status: 200,
            body: {
              schemaVersion: 1,
              source: { id: "fixture.source", version: 1 },
              contract: { id: "metric.scalar", version: 1 },
              structuralCompatibilityHash: `sha256:${"0".repeat(64)}`,
              data: { value: 1 }
            }
          };
        }
      },
      { map: () => ({ input: {}, query: { filters: [] }, selectedFields: ["title"] }) }
    );
    await expect(dispatcher.dispatch(context(), target)).resolves.toEqual({ value: 1 });
    expect(seen).toMatchObject({ sourceId: "fixture.source", input: {}, query: { filters: [] }, selectedFields: ["title"] });
    expect(target).not.toHaveProperty("handler");
  });
});
