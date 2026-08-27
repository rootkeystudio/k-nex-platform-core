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
  RegisteredToolAuthorization,
  RegisteredToolDispatcher,
  RegisteredToolInputValidator,
  RegisteredToolOutputValidator,
  RegisteredToolRedactor,
  RegisteredToolTargetResolver,
  executeRegistration,
  scopePluginRegistration
} from "../packages/runtime/dist/index.js";
import { pluginContributionCategoryKeys } from "../packages/contracts/dist/index.js";

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
    id: "contract-input-schema",
    packageName: "@k-nex/contracts",
    file: "tests/agent-tool.test.ts",
    testName: "rejects an open input object with a stable diagnostic path",
    attacks: ["direct-identity-input-manipulation"]
  },
  {
    id: "catalog-identity",
    packageName: "@k-nex/runtime",
    file: "tests/tool-catalog.test.ts",
    testName: "omits unknown and stale versions and supports synchronous invalidation subscribers",
    attacks: ["direct-identity-input-manipulation"]
  },
  {
    id: "registration-target",
    packageName: "@k-nex/runtime",
    file: "tests/tool-catalog.test.ts",
    testName: "rejects a tool targeting another plugin's binding",
    attacks: ["forbidden-target"]
  },
  {
    id: "registration-mutation",
    packageName: "@k-nex/runtime",
    file: "tests/registration-runtime.test.ts",
    testName: "snapshots declarations before hooks can mutate their source objects",
    attacks: ["runtime-cms-registration-mutation"]
  },
  {
    id: "registration-freeze",
    packageName: "@k-nex/runtime",
    file: "tests/registration-runtime.test.ts",
    testName: "rejects late registration after freeze",
    attacks: ["runtime-cms-registration-mutation"]
  },
  {
    id: "registration-policy-mismatch",
    packageName: "@k-nex/runtime",
    file: "tests/registration-runtime.test.ts",
    testName: "requires exact schema-compatible action tool bindings",
    attacks: ["mcp-metadata-policy-bypass"]
  },
  {
    id: "approval-binding",
    packageName: "@k-nex/runtime",
    file: "tests/tool-approval.test.ts",
    testName: "binds an approval to exact arguments, principal, session, tool version, and one use",
    attacks: ["approval-replay-and-substitution"]
  },
  {
    id: "approval-concurrency",
    packageName: "@k-nex/runtime",
    file: "tests/tool-approval.test.ts",
    testName: "reserves an approval ID across concurrent submissions",
    attacks: ["approval-replay-and-substitution"]
  },
  {
    id: "gateway-approval-concurrency",
    packageName: "@k-nex/runtime",
    file: "tests/tool-gateway.test.ts",
    testName: "allows one concurrent gateway call to consume a single approval",
    attacks: ["approval-replay-and-substitution"]
  },
  {
    id: "delegation-expiry",
    packageName: "@k-nex/runtime",
    file: "tests/tool-delegation.test.ts",
    testName: "denies expired",
    attacks: ["expired-revoked-delegation"]
  },
  {
    id: "delegation-revocation",
    packageName: "@k-nex/runtime",
    file: "tests/tool-delegation.test.ts",
    testName: "denies revoked",
    attacks: ["expired-revoked-delegation"]
  },
  {
    id: "idempotency-replay",
    packageName: "@k-nex/runtime",
    file: "tests/tool-idempotency.test.ts",
    testName: "canonicalizes input and returns one frozen stable result for exact replays",
    attacks: ["duplicate-write-idempotency-conflict"]
  },
  {
    id: "idempotency-conflict",
    packageName: "@k-nex/runtime",
    file: "tests/tool-idempotency.test.ts",
    testName: "rejects changed input and isolates the key by exact tool identity",
    attacks: ["duplicate-write-idempotency-conflict"]
  },
  {
    id: "gateway-synchronous-dispatch-failure",
    packageName: "@k-nex/runtime",
    file: "tests/tool-gateway.test.ts",
    testName: "bounds a real idempotency claim after a synchronous dispatcher failure",
    attacks: ["duplicate-write-idempotency-conflict"]
  },
  {
    id: "budget-concurrency",
    packageName: "@k-nex/runtime",
    file: "tests/tool-budget.test.ts",
    testName: "enforces per-principal/tool concurrency and releases idempotently",
    attacks: ["budget-rate-timeout"]
  },
  {
    id: "budget-rate",
    packageName: "@k-nex/runtime",
    file: "tests/tool-budget.test.ts",
    testName: "enforces rate/burst independently and refills with the injected clock",
    attacks: ["budget-rate-timeout"]
  },
  {
    id: "gateway-non-cooperative-timeout",
    packageName: "@k-nex/runtime",
    file: "tests/tool-gateway.test.ts",
    testName: "enforces timeout against a non-cooperative dispatcher without releasing uncertain idempotency",
    attacks: ["budget-rate-timeout"]
  },
  {
    id: "audit-redaction",
    packageName: "@k-nex/runtime",
    file: "tests/tool-audit.test.ts",
    testName: "records bounded success metadata without inputs, results, prompts, or key values",
    attacks: ["secret-log-error-redaction"]
  },
  {
    id: "gateway-error-redaction",
    packageName: "@k-nex/runtime",
    file: "tests/tool-gateway.test.ts",
    testName: "normalizes unexpected failures without leaking their message",
    attacks: ["secret-log-error-redaction"]
  },
  {
    id: "gateway-audit-before-dispatch",
    packageName: "@k-nex/runtime",
    file: "tests/tool-gateway.test.ts",
    testName: "fails closed before dispatch when authoritative audit is unavailable",
    attacks: ["secret-log-error-redaction"]
  },
  {
    id: "gateway-audit-completion",
    packageName: "@k-nex/runtime",
    file: "tests/tool-gateway.test.ts",
    testName: "fails closed when the completion audit sink fails",
    attacks: ["secret-log-error-redaction"]
  },
  {
    id: "mcp-registration-boundary",
    packageName: "@k-nex/payload-adapter",
    file: "tests/mcp-adapter.test.ts",
    testName: "registers only explicit K-Nex tools and disables Payload CRUD/experimental surfaces",
    attacks: ["automatic-exposure"]
  },
  {
    id: "mcp-api-key-intersection",
    packageName: "@k-nex/payload-adapter",
    file: "tests/mcp-adapter.test.ts",
    testName: "intersects API-key capability toggles with actor/delegation-filtered catalog visibility",
    attacks: ["api-key-toggle-authority"]
  },
  {
    id: "mcp-api-key-denial",
    packageName: "@k-nex/payload-adapter",
    file: "tests/mcp-adapter.test.ts",
    testName: "fails closed for an API key that has not enabled the visible K-Nex tool",
    attacks: ["api-key-toggle-authority"]
  },
  {
    id: "mcp-gateway-reentry",
    packageName: "@k-nex/payload-adapter",
    file: "tests/mcp-adapter.test.ts",
    testName: "re-enters the K-Nex gateway and returns only the safe structured envelope",
    attacks: ["mcp-metadata-policy-bypass", "untrusted-result-text"]
  },
  {
    id: "mcp-protocol-roundtrip",
    packageName: "@k-nex/payload-adapter",
    file: "tests/mcp-adapter.test.ts",
    testName: "serves tools/list and tools/call over the MCP protocol",
    attacks: ["mcp-metadata-policy-bypass"]
  },
  {
    id: "sales-mcp-security",
    packageName: "@k-nex/module-sales",
    file: "tests/mcp-sales-proof.test.ts",
    testName: "runs one logical approved write and enforces actor-filtered MCP list/call",
    attacks: [
      "cross-actor-isolation",
      "forbidden-target",
      "duplicate-write-idempotency-conflict",
      "secret-log-error-redaction",
      "untrusted-result-text"
    ]
  }
];

for (const proof of focusedProofs) {
  assert.equal(typeof proof.file, "string", `Gate 2A proof ${proof.id} must name one test file.`);
  assert.equal(typeof proof.testName, "string", `Gate 2A proof ${proof.id} must name one test.`);
  assert.ok(proof.attacks.length > 0, `Gate 2A proof ${proof.id} must name an attack.`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runFocusedProof(proof) {
  let output;
  try {
    output = execFileSync("pnpm", [
      "--filter", proof.packageName, "exec", "vitest", "run", proof.file,
      "--testNamePattern", escapeRegExp(proof.testName), "--reporter=json"
    ], {
      cwd: root,
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? "";
    const stderr = error?.stderr?.toString?.() ?? "";
    throw new Error(`Gate 2A targeted proof failed: ${proof.id} (${proof.file} :: ${proof.testName})\n${stdout}${stderr}`, { cause: error });
  }

  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    throw new Error(`Gate 2A targeted proof did not return a JSON report: ${proof.id}.`, { cause: error });
  }
  const assertions = report.testResults?.flatMap(({ assertionResults = [] }) => assertionResults) ?? [];
  const passed = assertions.filter(({ status }) => status === "passed");
  const selected = passed.filter(({ title }) => title === proof.testName);
  assert.equal(selected.length, 1, `Gate 2A targeted proof did not execute exactly one selected test: ${proof.id}.`);
  assert.equal(passed.length, 1, `Gate 2A targeted proof selected additional passing tests: ${proof.id}.`);
  return {
    id: proof.id,
    status: "pass",
    target: `${proof.file} :: ${proof.testName}`,
    attacks: proof.attacks,
    outputBytes: Buffer.byteLength(output)
  };
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
    permission: "gate-2a.tools.read",
    policy: "gate-2a.tools.read",
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
  const contributions = Object.fromEntries(pluginContributionCategoryKeys.map((kind) => [kind, []]));
  contributions.tools = descriptors.map((value) => ({ pluginId: owner, id: value.id, value }));
  contributions.sources = descriptors.map((value) => ({
        pluginId: owner,
        id: value.invocation.source.id,
        value: { descriptor: { id: value.invocation.source.id, version: 1 } }
      }));
  return scopePluginRegistration({
    phases: [],
    inventory: [{ id: owner, contributions: {}, capabilityAccess: [] }],
    contributions,
    bindings: {
      sources: descriptors.map((value) => ({ pluginId: owner, id: value.invocation.source.id, value: () => ({}) })),
      actions: [], events: [], jobs: [], realtimeTopics: [], components: [], blocks: []
    }
  }, []);
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
  return {
    id: "audience-and-invalid-identity",
    status: "pass",
    target: "directAudienceProbe",
    attacks: ["invalid-or-foreign-audience-identity"]
  };
}

async function directOutputProbe() {
  const outputSchema = { type: "object", properties: { ok: { type: "boolean" } }, additionalProperties: false };
  const action = {
    id: "fixture.actions.run",
    version: 1,
    ownerPluginId: "module.gate-2a",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema,
    permission: "gate-2a.tools.read",
    policy: "gate-2a.tools.read",
    effect: "read-only",
    idempotency: "not-applicable",
    dryRun: false
  };
  const tool = descriptor(1, {
    outputSchema,
    invocation: { kind: "action", action: { id: action.id, version: action.version } },
    permission: "gate-2a.tools.read",
    policy: "gate-2a.tools.read"
  });
  const runtimeOutputSchema = {
    safeParse(value) {
      const valid = value !== null && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).join("\u0000") === "ok" && typeof value.ok === "boolean";
      return valid ? { success: true, data: value } : { success: false, error: new Error("invalid output") };
    }
  };
  const runtimeInputSchema = { safeParse: (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0
      ? { success: true, data: value }
      : { success: false, error: new Error("invalid input") } };
  let dispatches = 0;
  const resolved = scopePluginRegistration(executeRegistration({
    graph: {
      resolverVersion: "1.0.0",
      plugins: [{ id: "module.gate-2a", kind: "module", package: "@k-nex/gate-2a", version: "1.0.0", integrity: "sha512-gate-2a", required: [], optional: [] }],
      capabilityProviders: [],
      registrationOrder: ["module.gate-2a"]
    },
    installed: [{
      package: { name: "@k-nex/gate-2a", version: "1.0.0", integrity: "sha512-gate-2a" },
      manifest: {
        apiVersion: 1,
        id: "module.gate-2a",
        kind: "module",
        displayName: "Gate 2A",
        version: "1.0.0",
        package: "@k-nex/gate-2a",
        compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
        provides: [],
        requires: [],
        optional: [],
        conflicts: [],
        lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "unsupported" },
        contributions: { permissions: { "gate-2a.tools.read": "required" }, actions: { [action.id]: "required" }, tools: { [tool.id]: "required" } }
      }
    }],
    registrations: [{
      pluginId: "module.gate-2a",
      contracts(context) {
        context.register("permissions", "gate-2a.tools.read", {
          id: "gate-2a.tools.read", ownerPluginId: "module.gate-2a", title: "Read Gate 2A tools",
          description: "Execute the Gate 2A fixture tool.", audience: "authenticated", resource: "gate-2a.tools",
          operation: "execute", policy: { id: "gate-2a.tools.read", scope: "application", recordScoped: false, fieldScoped: false }
        });
        context.register("actions", action.id, { descriptor: action, inputSchema: runtimeInputSchema, outputSchema: runtimeOutputSchema });
        context.register("tools", tool.id, tool);
      },
      dataHandlers(context) {
        context.bind("actions", action.id, () => { dispatches += 1; return { undeclared: "secret-output" }; });
      }
    }]
  }), []);
  const catalog = new ToolCatalog(resolved, { isVisible: () => true });
  const targets = new RegisteredToolTargetResolver(resolved);
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
    catalog: { lookup: (id, version, context) => catalog.lookup(id, version, {
      actor: context.principal.actor,
      delegation: context.delegation,
      authorizationContext: context.principal.authorizationContext,
      surface: context.surface,
      features: context.features
    }) },
    input: new RegisteredToolInputValidator(targets),
    authorization: new RegisteredToolAuthorization(targets, { authorize: () => ({}) }),
    budget: { evaluate: () => ({ context: {}, signal: request.signal, release: () => undefined }) },
    approval: { evaluate: () => ({ status: "not-required" }), prepare: () => ({ required: false }), submit: () => ({ accepted: true }) },
    idempotency: { claim: () => ({ context: { status: "not-applicable" }, complete: () => undefined, fail: () => undefined }) },
    dispatcher: new RegisteredToolDispatcher(targets, { dispatch: () => undefined }),
    output: new RegisteredToolOutputValidator(targets),
    redactor: new RegisteredToolRedactor(),
    audit: { beforeDispatch: () => undefined, success: () => undefined, failure: () => undefined },
    problem: new SafeToolProblemSerializer()
  });
  const response = await gateway.execute(request);
  assert.equal(response.ok, false);
  assert.equal(response.body.code, "TOOL_OUTPUT_INVALID");
  assert.equal(dispatches, 1);
  assert.equal(JSON.stringify(response).includes("secret-output"), false);
  return {
    id: "output-schema-and-undeclared-field",
    status: "pass",
    target: "directOutputProbe",
    attacks: ["output-schema-and-undeclared-field"]
  };
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
    audit: { beforeDispatch: () => undefined, success: () => undefined, failure: () => undefined },
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
const coveredAttacks = new Set(proofResults.flatMap(({ attacks = [] }) => attacks));
for (const attack of requiredAttacks) assert.ok(coveredAttacks.has(attack), `Gate 2A attack has no executable proof: ${attack}`);
const benchmarkResults = await runBenchmarks();

console.log(JSON.stringify({
  gate: "Gate 2A",
  node: process.versions.node,
  attackProofs: proofResults.map(({ id, status, target, attacks }) => ({ id, status, target, attacks })),
  benchmarks: benchmarkResults,
  qualification: "Bounded catalog/gateway validation overhead only; p95 ceilings are generous local proof budgets, not production capacity claims."
}, null, 2));
console.log("GATE_2A_PASS");
