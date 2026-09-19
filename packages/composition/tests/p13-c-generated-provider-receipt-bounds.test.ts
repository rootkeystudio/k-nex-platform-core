import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { afterAll, beforeAll, expect, it } from "vitest";

import { planCreateKnexApplication } from "../src/index.js";

const generated = planCreateKnexApplication({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal", database: "external" }).files;
const endpoint = "http://127.0.0.1:9/k-nex/reference-provider";
const idempotencyKey = `sha256:${"a".repeat(64)}`;
const payload = Object.freeze({ activityId: 1, expectedRevision: 1 });
const admissibleReceipt = Object.freeze({ providerReceiptId: "reference-receipt-0001", idempotencyKey, duplicate: false });

const stubSource = `
export const kNexIdentity = Object.freeze({ applicationId: "customer-alpha", environment: "production", publicOrigin: new URL("https://alpha.example.test/") });
export const canonicalJson = JSON.stringify;
export const AuthorizationDecisionAuditSchema = Object.freeze({ parse: (value) => value });
export class ActionGatewayError extends Error { constructor(code, status, detail) { super(detail); this.code = code; this.status = status; } }
export class PostgresAuthorizationStore {}
export class CurrentAuthorityAdapter {}
export class EffectiveAuthorityResolver {}
export const activePayloadPostgresTransaction = async () => { throw new Error("receipt bounds must not reach the database"); };
export const sql = () => undefined;
export const createAuthorizationCatalogProvider = () => undefined;
export const createCurrentAuthorityTarget = () => undefined;
export const createEffectiveAuthorizationRequest = () => undefined;
export const createEffectiveAuthorizationCatalog = () => undefined;
export const createPlatformPluginPolicyExecutable = () => undefined;
export const createPlatformPluginRegistrationAuthorizationContribution = () => undefined;
export const createTrustedAuthorizationSession = () => undefined;
export const platformPermissionDescriptors = Object.freeze([]);
export const kNexSalesRegistry = Object.freeze({ policyBindings: [], policyExecutors: {} });
`;

type Transport = Readonly<{ invoke(input: unknown): Promise<unknown>; reconcile(input: unknown): Promise<unknown> }>;

let directory: string;
let transport: Transport;
let fetched: Request[];

function transpile(source: string): string {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText;
}

/** A body the host must never allocate whole, delivered on the caller's terms. */
function respond(body: ReadableStream<Uint8Array>, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(body, { status: 202, headers: { "content-type": "application/json", ...headers } });
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

beforeAll(async () => {
  // Inside the package that carries Payload's Postgres adapter, because the
  // generated authority imports it: a temporary directory outside the workspace
  // cannot resolve the packages the emitted sources actually depend on.
  const host = fileURLToPath(new URL("../../payload-adapter/.k-nex-generated-proofs/", import.meta.url));
  mkdirSync(host, { recursive: true });
  directory = mkdtempSync(join(host, "receipt-bounds-"));
  writeFileSync(join(directory, "stubs.mjs"), stubSource);
  const authority = generated["src/k-nex-authority.ts"]!
    .replace(/import \{ AuthorizationDecisionAuditSchema, canonicalJson \} from "@k-nex\/contracts";/u, 'import { AuthorizationDecisionAuditSchema, canonicalJson } from "./stubs.mjs";')
    .replace(/import \{ PostgresAuthorizationStore,[^;]+from "@k-nex\/payload-adapter";/u, 'import { PostgresAuthorizationStore } from "./stubs.mjs";')
    .replace(/import \{\n(?:[^;]+)\n\} from "@k-nex\/runtime";/u, 'import { CurrentAuthorityAdapter, EffectiveAuthorityResolver, createAuthorizationCatalogProvider, createCurrentAuthorityTarget, createEffectiveAuthorizationRequest, createEffectiveAuthorizationCatalog, createPlatformPluginPolicyExecutable, createPlatformPluginRegistrationAuthorizationContribution, createTrustedAuthorizationSession, platformPermissionDescriptors } from "./stubs.mjs";')
    .replace('import { kNexIdentity } from "./k-nex-identity.js";', 'import { kNexIdentity } from "./stubs.mjs";')
    .replace('import { kNexSalesRegistry } from "./k-nex-registry.js";', 'import { kNexSalesRegistry } from "./stubs.mjs";');
  expect(authority).not.toMatch(/@k-nex\//u);
  writeFileSync(join(directory, "authority.mjs"), transpile(authority));
  const communications = generated["src/k-nex-sales-communications.ts"]!
    .replace('import { canonicalJson } from "@k-nex/contracts";', 'import { canonicalJson } from "./stubs.mjs";')
    .replace('import { activePayloadPostgresTransaction } from "@k-nex/payload-adapter";', 'import { activePayloadPostgresTransaction } from "./stubs.mjs";')
    .replace('import { ActionGatewayError } from "@k-nex/runtime";', 'import { ActionGatewayError } from "./stubs.mjs";')
    .replace('import { sql } from "@payloadcms/db-postgres";', 'import { sql } from "./stubs.mjs";')
    .replaceAll('"./k-nex-authority.js"', '"./authority.mjs"');
  // The reader under proof is the shipped one: the host reaches it only through
  // the import it declares, so a local copy would make this test vacuous.
  expect(communications).toContain('readBoundedRequestBody(response, providerReceiptReadLimits)');
  expect(communications).not.toMatch(/@k-nex\/|@payloadcms\//u);
  writeFileSync(join(directory, "communications.mjs"), transpile(communications));
  const module = await import(pathToFileURL(join(directory, "communications.mjs")).href) as { createGeneratedBoundedReferenceProviderTransport(value: string): Transport };
  transport = module.createGeneratedBoundedReferenceProviderTransport(endpoint);
});

afterAll(() => {
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
});

function stubFetch(response: () => Response): void {
  fetched = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetched.push(new Request(input as RequestInfo, init));
    return response();
  }) as typeof globalThis.fetch;
}

const originalFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = originalFetch; });

function invoke(): Promise<unknown> {
  return transport.invoke({ providerId: "calendar.reference.v1", credential: "outbound-credential", idempotencyKey, payload });
}

it("admits a length-less provider receipt that stays inside the byte bound", async () => {
  let pulls = 0;
  stubFetch(() => respond(new ReadableStream<Uint8Array>({
    pull(controller) { pulls += 1; controller.enqueue(encode(JSON.stringify(admissibleReceipt))); controller.close(); }
  })));
  const receipt = await invoke();
  expect(receipt).toEqual(admissibleReceipt);
  expect(pulls).toBe(1);
  // A chunked response declares no length, so the happy path proves the reader
  // replaced the whole-body decode rather than the length header check.
  expect(fetched).toHaveLength(1);
});

it("refuses a length-less provider receipt over the byte bound and never adopts the receipt inside it", async () => {
  let pulls = 0;
  let cancelled = false;
  stubFetch(() => respond(new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      // An admissible receipt first, then padding past the bound: a reader that
      // stops at the first parseable object would forge a completion here.
      if (pulls === 1) { controller.enqueue(encode(JSON.stringify(admissibleReceipt))); return; }
      if (pulls > 9) { controller.close(); return; }
      controller.enqueue(new Uint8Array(1_024));
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0, size() { return 1; } })));
  await expect(invoke()).rejects.toThrow("Provider receipt is invalid.");
  // A body that ends on its own is drained, and the bytes past the bound are
  // dropped as they arrive rather than held until the total is known.
  expect(cancelled).toBe(false);
  expect(pulls).toBe(10);
});

it("refuses an oversized chunked provider receipt that keeps streaming, on its own deadline", async () => {
  let streamed = 0;
  let cancelled = false;
  let clock = 0;
  stubFetch(() => respond(new ReadableStream<Uint8Array>({
    // A provider that never stops writing is the case a post-decode limit
    // cannot answer: the bytes are already resident by the time it looks.
    pull(controller) { clock += 250; streamed += 65_536; controller.enqueue(new Uint8Array(65_536)); },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0, size() { return 1; } })));
  const originalNow = performance.now.bind(performance);
  performance.now = () => clock;
  try { await expect(invoke()).rejects.toThrow("Provider receipt is invalid."); } finally { performance.now = originalNow; }
  // Twenty 64 KiB chunks cross the 4 KiB bound on the first one and keep
  // coming; the read ends on the 5s deadline, not on the provider's goodwill,
  // and the refusal is the byte bound rather than the outer call abort.
  expect(cancelled).toBe(true);
  expect(streamed).toBe(20 * 65_536);
});

it("refuses an over-declared provider receipt length without reading the body at all", async () => {
  let pulls = 0;
  stubFetch(() => respond(new ReadableStream<Uint8Array>({
    pull() { pulls += 1; return new Promise(() => undefined); }
  }, { highWaterMark: 0, size() { return 1; } }), { "content-length": "4097" }));
  const startedAt = Date.now();
  await expect(invoke()).rejects.toThrow("Provider receipt is invalid.");
  // The declared length is refused outright: a stalled body never delays it,
  // and the reader is never even taken.
  expect(pulls).toBe(0);
  expect(Date.now() - startedAt).toBeLessThan(500);
});

it("cancels a provider receipt whose body never ends, and keeps it an outage rather than a host invariant", async () => {
  let pulls = 0;
  let cancelled = false;
  stubFetch(() => respond(new ReadableStream<Uint8Array>({
    pull() { pulls += 1; return new Promise(() => undefined); },
    cancel() { cancelled = true; }
  })));
  const startedAt = Date.now();
  // A stalled body says nothing about the effect, so it stays retryable: the
  // worker reconciles by receipt lookup instead of resending the message.
  await expect(invoke()).rejects.toThrow("Provider transport failed.");
  const elapsedMs = Date.now() - startedAt;
  expect(cancelled).toBe(true);
  expect(pulls).toBe(1);
  expect(elapsedMs).toBeGreaterThanOrEqual(900);
  // The 10s call abort is the outer bound; the reader refuses far inside it.
  expect(elapsedMs).toBeLessThan(5_000);
});

it("ignores a provider receipt read that settles after the refusal was already decided", async () => {
  let cancelCalls = 0;
  let settleLateRead: (() => void) | undefined;
  stubFetch(() => respond(new ReadableStream<Uint8Array>({
    pull() { return new Promise((resolve) => { settleLateRead = () => resolve(); }); },
    cancel() { cancelCalls += 1; }
  })));
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => originalSetTimeout(callback, 0, ...args)) as typeof globalThis.setTimeout;
  try { await expect(invoke()).rejects.toThrow("Provider transport failed."); } finally { globalThis.setTimeout = originalSetTimeout; }
  expect(cancelCalls).toBe(1);
  expect(typeof settleLateRead).toBe("function");
  settleLateRead!();
  await new Promise((resolve) => originalSetTimeout(resolve, 10));
  process.off("unhandledRejection", onUnhandled);
  expect(unhandled).toEqual([]);
});

it("refuses a provider receipt with no body at all", async () => {
  stubFetch(() => new Response(null, { status: 202, headers: { "content-type": "application/json" } }));
  await expect(invoke()).rejects.toThrow("Provider receipt is invalid.");
});

it("bounds a reconciliation receipt on the same terms as an invocation receipt", async () => {
  let cancelled = false;
  stubFetch(() => respond(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(8_192)); controller.close(); },
    cancel() { cancelled = true; }
  })));
  await expect(transport.reconcile({ providerId: "calendar.reference.v1", credential: "outbound-credential", idempotencyKey })).rejects.toThrow("Provider receipt is invalid.");
  expect(cancelled).toBe(false);
});
