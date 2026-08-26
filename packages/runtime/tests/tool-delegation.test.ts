import type { AgentToolDescriptor } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import { BoundToolDelegationEvaluator, DelegatedToolCatalogPolicy, type ToolDelegationGrant } from "../src/tool-delegation.js";
import type { ToolGatewayRequest } from "../src/tool-gateway.js";

const request: ToolGatewayRequest = {
  correlationId: "correlation-1",
  rawRequest: {},
  tool: { id: "sales.tools.search", version: 1 },
  surface: "workspace",
  features: [],
  input: {},
  signal: new AbortController().signal
};

const grant: ToolDelegationGrant = {
  id: "grant-1",
  principalId: "user-1",
  agentClientId: "client-1",
  applicationId: "customer-1",
  allowedTools: [{ id: "sales.tools.search", version: 1 }],
  allowedEffects: ["read-only"],
  expiresAtEpochMs: 2_000,
  revocationRevision: 3,
  resourceScope: { kind: "sales-team", id: "team-1" }
};

const tool = (overrides: Partial<AgentToolDescriptor> = {}): AgentToolDescriptor => ({
  id: "sales.tools.search",
  version: 1,
  ownerPluginId: "module.sales",
  title: "Search",
  description: "Search tasks.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: { type: "string" },
  invocation: { kind: "source", source: { id: "sales.tasks", version: 1 } },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  policy: "sales.tasks.tool",
  effect: "read-only",
  risk: "low",
  approval: "none",
  idempotency: "not-applicable",
  dryRun: false,
  limits: { timeoutMs: 1000, maxConcurrency: 1, ratePerMinute: 10, burst: 2, costClass: "low", maxCost: 1 },
  redaction: { inputPaths: [], outputPaths: [] },
  audit: { category: "sales.tasks" },
  ...overrides
});

function evaluator(overrides: {
  grant?: ToolDelegationGrant;
  now?: number;
  revision?: number;
  parent?: boolean;
  principalId?: string;
  clientId?: string;
  applicationId?: string;
} = {}) {
  return new BoundToolDelegationEvaluator(
    { resolve: () => overrides.grant ?? grant },
    { resolve: () => ({
      principalId: overrides.principalId ?? "user-1",
      agentClientId: overrides.clientId ?? "client-1",
      applicationId: overrides.applicationId ?? "customer-1"
    }) },
    { now: () => overrides.now ?? 1_000 },
    { revision: () => overrides.revision ?? 3 },
    { allows: () => overrides.parent ?? true }
  );
}

describe("P2A.5 bounded delegation", () => {
  it("binds the exact subject/application and only reduces tool/effect scope", async () => {
    const evaluated = await evaluator().evaluate(
      request,
      { actor: {}, request: {}, authorizationContext: {} },
      { client: {}, session: {} }
    );
    expect(evaluated.resourceScope).toEqual({ kind: "sales-team", id: "team-1" });
    expect(evaluated.allows(tool())).toBe(true);
    expect(evaluated.allows(tool({ version: 2 }))).toBe(false);
    expect(evaluated.allows(tool({ id: "sales.tools.other" }))).toBe(false);
    expect(evaluated.allows(tool({ effect: "write" }))).toBe(false);
  });

  it.each([
    ["expired", { now: 2_000 }, "DELEGATION_INVALID"],
    ["revoked", { revision: 4 }, "DELEGATION_REVOKED"],
    ["wrong principal", { principalId: "user-2" }, "DELEGATION_SUBJECT_MISMATCH"],
    ["wrong client", { clientId: "client-2" }, "DELEGATION_SUBJECT_MISMATCH"],
    ["wrong application", { applicationId: "customer-2" }, "DELEGATION_SUBJECT_MISMATCH"],
    ["authority escalation", { parent: false }, "DELEGATION_ESCALATION"]
  ] as const)("denies %s", async (_label, options, code) => {
    await expect(evaluator(options).evaluate(
      request,
      { actor: {}, request: {}, authorizationContext: {} },
      { client: {}, session: {} }
    )).rejects.toMatchObject({ code });
  });

  it("rejects duplicate, empty, overlong, or malformed scope", async () => {
    const malformed = [
      { ...grant, allowedTools: [] },
      { ...grant, allowedTools: [...grant.allowedTools, ...grant.allowedTools] },
      { ...grant, allowedEffects: ["read-only", "read-only"] },
      { ...grant, resourceScope: { kind: "bad scope", id: "team-1" } }
    ] as ToolDelegationGrant[];
    for (const candidate of malformed) {
      await expect(evaluator({ grant: candidate }).evaluate(
        request,
        { actor: {}, request: {}, authorizationContext: {} },
        { client: {}, session: {} }
      )).rejects.toMatchObject({ code: "DELEGATION_INVALID" });
    }
  });

  it("omits tools outside delegation before principal visibility policy", async () => {
    const evaluated = await evaluator().evaluate(
      request,
      { actor: {}, request: {}, authorizationContext: {} },
      { client: {}, session: {} }
    );
    let principalChecks = 0;
    const policy = new DelegatedToolCatalogPolicy({ isVisible: () => { principalChecks += 1; return true; } });
    const base = {
      actor: { principal: { kind: "user" as const, id: "user-1" }, effectiveActor: { kind: "user" as const, id: "user-1" } },
      delegation: evaluated,
      authorizationContext: {},
      surface: "workspace" as const,
      features: [] as const
    };
    expect(await policy.isVisible({ ...base, descriptor: tool() })).toBe(true);
    expect(await policy.isVisible({ ...base, descriptor: tool({ id: "sales.tools.other" }) })).toBe(false);
    expect(principalChecks).toBe(1);
  });
});
