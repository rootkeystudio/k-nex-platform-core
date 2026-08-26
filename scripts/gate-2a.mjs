import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  SafeToolProblemSerializer,
  ToolCatalog,
  ToolCatalogError,
  ToolExecutionGateway,
  ToolGatewayError
} from "../packages/runtime/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedNode = "24.19.0";
const catalogP95CeilingMs = 250;
const gatewayP95CeilingMs = 250;

if (process.versions.node !== expectedNode) {
  throw new Error(`Gate 2A requires Node ${expectedNode}; found ${process.versions.node}.`);
}

const requiredAttacks = [
  "automatic-exposure",
  "cross-actor-isolation",
  "direct-identity-input-manipulation",
  "forbidden-target",
  "output-schema-and-undeclared-field",
  "approval-replay-and-substitution",
  "duplicate-write-idempotency-conflict",
  "expired-revoked-delegation",
  "budget-rate-timeout",
  "secret-log-error-redaction",
  "runtime-cms-registration-mutation",
  "api-key-toggle-authority",
  "mcp-metadata-policy-bypass",
  "invalid-or-foreign-audience-identity",
  "untrusted-result-text"
];

const focusedProofs = [
  {
    id: "contracts",
    packageName: "@k-nex/contracts",
    files: ["tests/agent-tool.test.ts"],
    attacks: ["direct-identity-input-manipulation", "output-schema-and-undeclared-field"]
  },
  {
    id: "catalog-and-registration",
    packageName: "@k-nex/runtime",
    files: ["tests/tool-catalog.test.ts", "tests/registration-runtime.test.ts"],
    attacks: [
      "automatic-exposure",
      "cross-actor-isolation",
      "direct-identity-input-manipulation",
      "forbidden-target",
      "invalid-or-foreign-audience-identity",
      "runtime-cms-registration-mutation"
    ]
  },
  {
    id: "gateway-and-approval",
    packageName: "@k-nex/runtime",
    files: ["tests/tool-gateway.test.ts", "tests/tool-approval.test.ts", "tests/tool-delegation.test.ts"],
    attacks: [
      "forbidden-target",
      "approval-replay-and-substitution",
      "expired-revoked-delegation",
      "mcp-metadata-policy-bypass"
    ]
  },
  {
    id: "idempotency-budget-audit",
    packageName: "@k-nex/runtime",
    files: ["tests/tool-idempotency.test.ts", "tests/tool-budget.test.ts", "tests/tool-audit.test.ts"],
    attacks: [
      "duplicate-write-idempotency-conflict",
      "budget-rate-timeout",
      "secret-log-error-redaction"
    ]
  },
  {
    id: "payload-mcp",
    packageName: "@k-nex/payload-adapter",
    files: ["tests/mcp-adapter.test.ts", "tests/mcp-sales-proof.test.ts"],
    attacks: [
      "automatic-exposure",
      "cross-actor-isolation",
      "forbidden-target",
      "output-schema-and-undeclared-field",
      "api-key-toggle-authority",
      "mcp-metadata-policy-bypass",
      "untrusted-result-text",
      "secret-log-error-redaction"
    ]
  }
];

const coveredAttacks = new Set(focusedProofs.flatMap(({ attacks }) => attacks));
for (const attack of requiredAttacks) assert.ok(coveredAttacks.has(attack), `Gate 2A attack has no executable proof: ${attack}`);

function runFocusedProof(proof) {
  const output = execFileSync("pnpm", [
    "--filter", proof.packageName, "exec", "vitest", "run", ...proof.files, "--reporter=dot"
  ], { cwd: root, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { id: proof.id, status: "pass", attacks: proof.attacks, outputBytes: Buffer.byteLength(output) };
}

function descriptor(index, overrides = {}) {
  const id = `fixture.tools.tool-${index}`;
  return {
    id,
    version: 1,
    ownerPluginId: "module.gate-2a",
    title: `Fixture tool ${index}`,
    description: "Bounded Gate 2A benchmark tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    invocation: { kind: "source", source: { id: `fixture.sources.source-${index}`, version: 1 } },
    audience: "authenticated",
    surfaces: ["workspace"],
    permission: "fixture.tools.read",
    policy: "fixture.tools.read",
    effect: "read-only",
    risk: "low",
    approval: "none",
    idempotency: "not-applicable",
    dryRun: false,
    limits: { timeoutMs: 1_000, maxConcurrency: 4, ratePerMinute: 600, burst: 60, costClass: "low", maxCost: 1 },
    redaction: { inputPaths: [], outputPaths: [] },
    audit: { category: "fixture.tools" },
    ...overrides
  };
}

function registration(descriptors) {
  const owner = "module.gate-2a";
  return {
    inventory: [{ id: owner }],
    contributions: {
      tools: descriptors.map((value) => ({ pluginId: owner, id: value.id, value })),
      dataSources: descriptors.map((value) => ({
        pluginId: owner,
        id: value.invocation.source.id,
        value: { descriptor: { id: value.invocation.source.id, version: 1 } }
      }))
    },
    bindings: {
      dataSources: descriptors.map((value) => ({ pluginId: owner, id: value.invocation.source.id, value: () => ({}) })),
      actions: []
    }
  };
}

function actor(kind = "user", id = "gate-actor") {
  return { principal: { kind, id }, effectiveActor: { kind, id } };
}

function catalogRequest(actorValue = actor()) {
  return {
    actor: actorValue,
    delegation: { id: "gate-delegation" },
    authorizationContext: { revision: "gate-policy-1" },
    surface: "workspace",
    features: []
  };
}

async function directAudienceProbe() {
  const authDescriptor = descriptor(1);
  const catalog = new ToolCatalog(registration([authDescriptor]), { isVisible: () => true });
  const visible = await catalog.list(catalogRequest());
  assert.deepEqual(visible.tools.map(({ id }) => id), [authDescriptor.id]);
  const foreignAudience = await catalog.list(catalogRequest(actor("public", "remote-session")));
  assert.deepEqual(foreignAudience.tools, []);
  await assert.rejects(
    catalog.list({ ...catalogRequest(), actor: { principal: {}, effectiveActor: {} } }),
    (error) => error instanceof ToolCatalogError && error.code === "INVALID_ACTOR_CONTEXT"
  );
  return { id: "audience-and-invalid-identity", status: "pass" };
}

async function directOutputProbe() {
  const tool = descriptor(1, {
    outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, additionalProperties: false }
  });
  let dispatches = 0;
  const request = {
    correlationId: "gate-output",
    rawRequest: {},
    tool: { id: tool.id, version: tool.version },
    surface: "workspace",
    features: [],
    input: {},
    signal: new AbortController().signal
  };
  const gateway = new ToolExecutionGateway({
    principal: { authenticate: () => ({ actor: actor(), request: {}, authorizationContext: {} }) },
    agentClient: { authenticate: () => ({ client: {}, session: {} }) },
    delegation: { evaluate: () => ({}) },
    catalog: { lookup: () => tool },
    input: { validate: (_descriptor, input) => input },
    authorization: { authorize: () => ({}) },
    budget: { evaluate: () => ({ context: {}, signal: request.signal, release: () => undefined }) },
    approval: { evaluate: () => ({ status: "not-required" }), prepare: () => ({ required: false }), submit: () => ({ accepted: true }) },
    idempotency: { claim: () => ({ context: { status: "not-applicable" }, complete: () => undefined, fail: () => undefined }) },
    dispatcher: { dispatch: () => { dispatches += 1; return { undeclared: "secret-output" }; } },
    output: {
      validate: (_descriptor, output) => {
        if (typeof output !== "object" || output === null || !Object.hasOwn(output, "ok") || Object.hasOwn(output, "undeclared")) {
          throw new ToolGatewayError("TOOL_OUTPUT_INVALID", 500, "Tool output is invalid.");
        }
        return output;
      }
    },
    redactor: { redact: (_context, output) => output },
    audit: { success: () => undefined, failure: () => undefined },
    problem: new SafeToolProblemSerializer()
  });
  const response = await gateway.execute(request);
  assert.equal(response.ok, false);
  assert.equal(response.body.code, "TOOL_OUTPUT_INVALID");
  assert.equal(dispatches, 1);
  assert.equal(JSON.stringify(response).includes("secret-output"), false);
  return { id: "output-schema-and-undeclared-field", status: "pass" };
}

function percentile(samples, quantile) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * quantile)];
}

async function benchmark(name, iterations, p95CeilingMs, operation) {
  for (let index = 0; index < 10; index += 1) await operation();
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  const p95Ms = Number(percentile(samples, 0.95).toFixed(3));
  assert.ok(p95Ms <= p95CeilingMs, `${name} p95 ${p95Ms}ms exceeds ${p95CeilingMs}ms.`);
  return { name, iterations, p95Ms, acceptedP95Ms: p95CeilingMs };
}

async function runBenchmarks() {
  const descriptors = Array.from({ length: 100 }, (_, index) => descriptor(index + 1));
  const catalog = new ToolCatalog(registration(descriptors), { isVisible: () => true });
  const request = catalogRequest();
  const catalogBenchmark = await benchmark(
    "catalog list (100 explicit descriptors)",
    100,
    catalogP95CeilingMs,
    async () => {
      const result = await catalog.list({ ...request, limit: 100 });
      assert.equal(result.tools.length, 100);
    }
  );

  const tool = descriptors[0];
  const gatewayRequest = {
    correlationId: "gate-benchmark",
    rawRequest: {},
    tool: { id: tool.id, version: tool.version },
    surface: "workspace",
    features: [],
    input: {},
    signal: new AbortController().signal
  };
  const gateway = new ToolExecutionGateway({
    principal: { authenticate: () => ({ actor: actor(), request: {}, authorizationContext: {} }) },
    agentClient: { authenticate: () => ({ client: {}, session: {} }) },
    delegation: { evaluate: () => ({}) },
    catalog: { lookup: () => tool },
    input: { validate: (_descriptor, input) => input },
    authorization: { authorize: () => ({}) },
    budget: { evaluate: () => ({ context: {}, signal: gatewayRequest.signal, release: () => undefined }) },
    approval: { evaluate: () => ({ status: "not-required" }), prepare: () => ({ required: false }), submit: () => ({ accepted: true }) },
    idempotency: { claim: () => ({ context: { status: "not-applicable" }, complete: () => undefined, fail: () => undefined }) },
    dispatcher: { dispatch: () => ({ ok: true }) },
    output: { validate: (_descriptor, output) => output },
    redactor: { redact: (_context, output) => output },
    audit: { success: () => undefined, failure: () => undefined },
    problem: new SafeToolProblemSerializer()
  });
  const gatewayBenchmark = await benchmark(
    "gateway execute (bounded read pipeline)",
    200,
    gatewayP95CeilingMs,
    async () => {
      const result = await gateway.execute(gatewayRequest);
      assert.equal(result.ok, true);
    }
  );
  return [catalogBenchmark, gatewayBenchmark];
}

const proofResults = [];
for (const proof of focusedProofs) proofResults.push(runFocusedProof(proof));
proofResults.push(await directAudienceProbe());
proofResults.push(await directOutputProbe());
const benchmarkResults = await runBenchmarks();

console.log(JSON.stringify({
  gate: "Gate 2A",
  node: process.versions.node,
  attackProofs: proofResults.map(({ id, status, attacks }) => ({ id, status, attacks })),
  benchmarks: benchmarkResults,
  qualification: "Bounded catalog/gateway validation overhead only; p95 ceilings are generous local proof budgets, not production capacity claims."
}, null, 2));
console.log("GATE_2A_PASS");
