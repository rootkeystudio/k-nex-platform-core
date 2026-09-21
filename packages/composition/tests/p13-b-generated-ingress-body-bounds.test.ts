import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";

const generated = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });

type IngressControl = {
  boots: number;
  webhookAdmissions: number;
  salesPermissionReads: number;
};

const stubSource = `
export const control = globalThis.__kNexGeneratedIngressBounds;
export const kNexIdentity = Object.freeze({ applicationId: "customer-alpha", environment: "production", publicOrigin: new URL("https://alpha.example.test/") });
export const canonicalJson = JSON.stringify;
export const AuthorizationDecisionAuditSchema = Object.freeze({ parse: (value) => value });
export class PostgresAuthorizationStore {}
export class CurrentAuthorityAdapter {}
export class EffectiveAuthorityResolver {}
export const createAuthorizationCatalogProvider = () => undefined;
export const createCurrentAuthorityTarget = () => undefined;
export const createEffectiveAuthorizationRequest = () => undefined;
export const createEffectiveAuthorizationCatalog = () => undefined;
export const createPlatformPluginPolicyExecutable = () => undefined;
export const createPlatformPluginRegistrationAuthorizationContribution = () => undefined;
export const createTrustedAuthorizationSession = () => undefined;
export const platformPermissionDescriptors = Object.freeze([]);
export const kNexSalesRegistry = Object.freeze({ policyBindings: [], policyExecutors: {} });
export const sql = (strings, ...values) => Object.freeze({ strings: Object.freeze([...strings]), values: Object.freeze(values) });
export const activePayloadPostgresTransaction = async () => { throw new Error("generated ingress must not open a credential transaction for a refused body"); };
export const bootKnexApplication = async () => { control.boots += 1; throw new Error("generated ingress must not boot the application for a refused body"); };
export const workspaceSalesPermissions = async () => { control.salesPermissionReads += 1; return []; };
export const createGeneratedEnvironmentProviderSecretResolver = () => undefined;
export const acceptGeneratedSalesProviderWebhook = async () => { control.webhookAdmissions += 1; throw new Error("generated webhook must not be admitted for a refused body"); };
`;

let directory: string;
let importUpload: { POST(request: Request): Promise<Response> };
let providerWebhook: { POST(request: Request): Promise<Response> };

function transpile(source: string): string {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText;
}

function control(): IngressControl {
  return (globalThis as typeof globalThis & { __kNexGeneratedIngressBounds: IngressControl }).__kNexGeneratedIngressBounds;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { __kNexGeneratedIngressBounds: IngressControl }).__kNexGeneratedIngressBounds = { boots: 0, webhookAdmissions: 0, salesPermissionReads: 0 };
});

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "k-nex-ingress-bounds-"));
  writeFileSync(join(directory, "stubs.mjs"), stubSource);
  const authority = generated["src/k-nex-authority.ts"]!
    .replace(/import \{ AuthorizationDecisionAuditSchema, canonicalJson \} from "@k-nex\/contracts";/u, 'import { AuthorizationDecisionAuditSchema, canonicalJson } from "./stubs.mjs";')
    .replace(/import \{ PostgresAuthorizationStore,[^;]+from "@k-nex\/payload-adapter";/u, 'import { PostgresAuthorizationStore, activePayloadPostgresTransaction } from "./stubs.mjs";')
    .replace(/import \{\n(?:[^;]+)\n\} from "@k-nex\/runtime";/u, 'import { CurrentAuthorityAdapter, EffectiveAuthorityResolver, createAuthorizationCatalogProvider, createCurrentAuthorityTarget, createEffectiveAuthorizationRequest, createEffectiveAuthorizationCatalog, createPlatformPluginPolicyExecutable, createPlatformPluginRegistrationAuthorizationContribution, createTrustedAuthorizationSession, platformPermissionDescriptors } from "./stubs.mjs";')
    .replace('import { sql } from "@payloadcms/db-postgres";', 'import { sql } from "./stubs.mjs";')
    .replace('import { kNexIdentity } from "./k-nex-identity.js";', 'import { kNexIdentity } from "./stubs.mjs";')
    .replace('import { kNexSalesRegistry } from "./k-nex-registry.js";', 'import { kNexSalesRegistry } from "./stubs.mjs";');
  expect(authority).not.toMatch(/@k-nex\/|@payloadcms\//u);
  writeFileSync(join(directory, "authority.mjs"), transpile(authority));
  const upload = generated["src/app/api/k-nex/sales/import-upload/route.ts"]!
    .replaceAll('"../../../../../k-nex-authority.js"', '"./authority.mjs"')
    .replaceAll(/"\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/(?:boot|k-nex-identity|k-nex-sales-workspace)\.js"/gu, '"./stubs.mjs"');
  writeFileSync(join(directory, "import-upload.mjs"), transpile(upload));
  const webhook = generated["src/app/api/k-nex/sales/providers/email-reference/webhook/route.ts"]!
    .replaceAll('"../../../../../../../k-nex-authority.js"', '"./authority.mjs"')
    .replaceAll(/"\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/(?:boot|k-nex-identity|k-nex-sales-communications)\.js"/gu, '"./stubs.mjs"');
  writeFileSync(join(directory, "provider-webhook.mjs"), transpile(webhook));
  importUpload = await import(pathToFileURL(join(directory, "import-upload.mjs")).href);
  providerWebhook = await import(pathToFileURL(join(directory, "provider-webhook.mjs")).href);
});

afterEach(() => {
  expect(control().boots).toBe(0);
  expect(control().webhookAdmissions).toBe(0);
  expect(control().salesPermissionReads).toBe(0);
});

function uploadRequest(body: ReadableStream<Uint8Array>, headers: Readonly<Record<string, string>> = {}): Request {
  return new Request("https://alpha.example.test/api/k-nex/sales/import-upload", {
    method: "POST", body, duplex: "half",
    headers: { origin: "https://alpha.example.test", "content-type": "application/json", ...headers }
  } as RequestInit & { duplex: "half" });
}

function webhookRequest(body: ReadableStream<Uint8Array>, headers: Readonly<Record<string, string>> = {}): Request {
  return new Request("https://alpha.example.test/api/k-nex/sales/providers/email-reference/webhook", {
    method: "POST", body, duplex: "half",
    headers: { "content-type": "application/json", "x-k-nex-signature": "sha256=deadbeef", "x-k-nex-timestamp": "2026-09-17T00:00:00.000Z", ...headers }
  } as RequestInit & { duplex: "half" });
}

it("refuses an oversized generated upload stream that never declares a content length, and drains it without retaining bytes", async () => {
  let chunks = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks += 1;
      if (chunks > 24) { controller.close(); return; }
      controller.enqueue(new Uint8Array(1_000_000));
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0, size() { return 1; } });
  const request = uploadRequest(body);
  expect(request.headers.get("content-length")).toBeNull();
  const response = await importUpload.POST(request);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "IMPORT_LIMIT_EXCEEDED" });
  // A body that ends on its own is drained so the refusal reaches the client.
  expect(cancelled).toBe(false);
  expect(chunks).toBe(25);
});

it("refuses a declared generated upload length over the bound without waiting on the stream", async () => {
  const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => undefined); } });
  const startedAt = Date.now();
  const response = await importUpload.POST(uploadRequest(body, { "content-length": "22369921" }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "IMPORT_LIMIT_EXCEEDED" });
  // The declared length is refused outright: a stalled stream never delays it.
  expect(Date.now() - startedAt).toBeLessThan(500);
});

it("cancels a generated upload that trickles one byte per interval once the total deadline expires", async () => {
  let pulls = 0;
  let cancelled = false;
  let clock = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls += 1; clock += 2_000; controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0, size() { return 1; } });
  const originalNow = performance.now.bind(performance);
  performance.now = () => clock;
  let response: Response;
  try { response = await importUpload.POST(uploadRequest(body)); } finally { performance.now = originalNow; }
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "IMPORT_UPLOAD_BINDING_INVALID" });
  expect(cancelled).toBe(true);
  expect(pulls).toBe(15);
});

it("cancels a generated upload whose stream never ends once the idle timeout expires", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() { pulls += 1; return new Promise(() => undefined); },
    cancel() { cancelled = true; }
  });
  const startedAt = Date.now();
  const response = await importUpload.POST(uploadRequest(body));
  const elapsedMs = Date.now() - startedAt;
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "IMPORT_UPLOAD_BINDING_INVALID" });
  expect(cancelled).toBe(true);
  expect(pulls).toBe(1);
  expect(elapsedMs).toBeGreaterThanOrEqual(900);
  expect(elapsedMs).toBeLessThan(10_000);
});

it("ignores a generated upload read that rejects after the refusal was already decided", async () => {
  let cancelCalls = 0;
  let settleLateRead: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    pull() { return new Promise((_resolve, reject) => { settleLateRead = () => reject(new Error("late generated upload read")); }); },
    cancel() { cancelCalls += 1; }
  });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => originalSetTimeout(callback, 0, ...args)) as typeof globalThis.setTimeout;
  let response: Response;
  try { response = await importUpload.POST(uploadRequest(body)); } finally { globalThis.setTimeout = originalSetTimeout; }
  expect(response.status).toBe(400);
  expect(cancelCalls).toBe(1);
  expect(typeof settleLateRead).toBe("function");
  settleLateRead!();
  await new Promise((resolve) => originalSetTimeout(resolve, 10));
  process.off("unhandledRejection", onUnhandled);
  expect(unhandled).toEqual([]);
});

it("refuses an oversized generated provider webhook stream that never declares a content length", async () => {
  let chunks = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks += 1;
      if (chunks > 9) { controller.close(); return; }
      controller.enqueue(new Uint8Array(16_384));
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0, size() { return 1; } });
  const response = await providerWebhook.POST(webhookRequest(body));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "WEBHOOK_INVALID", status: 400 });
  expect(cancelled).toBe(false);
  expect(chunks).toBe(10);
});

it("cancels a generated provider webhook whose stream never ends, before any signature verification", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() { pulls += 1; return new Promise(() => undefined); },
    cancel() { cancelled = true; }
  });
  const startedAt = Date.now();
  const response = await providerWebhook.POST(webhookRequest(body));
  expect(Date.now() - startedAt).toBeLessThan(10_000);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "WEBHOOK_INVALID", status: 400 });
  expect(cancelled).toBe(true);
  expect(pulls).toBe(1);
});

it("keeps every generated ingress reader on the one shared bound", () => {
  const readers = Object.entries(generated).filter(([, source]) => source.includes(".getReader()"));
  expect(readers.map(([path]) => path)).toEqual(["src/k-nex-authority.ts"]);
  for (const path of [
    "src/app/api/k-nex/sales/import-upload/route.ts",
    "src/app/api/k-nex/sales/providers/email-reference/webhook/route.ts",
    "src/app/api/k-nex/sales/providers/calendar-reference/webhook/route.ts"
  ]) expect(generated[path]).toContain("readBoundedRequestBody(request");
});

it("rejects a body the runtime never supplies", async () => {
  const response = await importUpload.POST(new Request("https://alpha.example.test/api/k-nex/sales/import-upload", {
    method: "POST", headers: { origin: "https://alpha.example.test", "content-type": "application/json" }
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "IMPORT_UPLOAD_BINDING_INVALID" });
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});
