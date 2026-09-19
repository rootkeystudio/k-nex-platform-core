import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { afterAll, beforeAll, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";

const generated = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });

type FakeListener = {
  readonly queries: string[];
  readonly handlers: Map<string, () => void>;
  notify(payload: string): void;
  fail(event: "error" | "end"): void;
  released: boolean;
};

type BridgeModule = {
  startKnexRealtime(payload: unknown, httpServer: unknown): Promise<{ close(): Promise<void> }>;
  currentKnexRealtimeBridgeHealth(): { state: string; connection: number; watermark: number; synchronizedAt: number; degradedSince: number | undefined } | undefined;
  realtimeBridgeDegradation(health: unknown, now: number): string | undefined;
  realtimeBridgeDegradedGraceMs: number;
};

const stubSource = `
const control = () => globalThis.__kNexGeneratedRealtimeBridge;
export const kNexIdentity = Object.freeze({ applicationId: "customer-alpha", environment: "production", publicOrigin: new URL("https://alpha.example.test/") });
export const salesRealtimeTopicDescriptors = Object.freeze([
  Object.freeze({ id: "sales.topic.accounts", sourceId: "sales.source.accounts", eventId: "sales.event.account-changed", permission: "sales.accounts.read" }),
  Object.freeze({ id: "sales.topic.contacts", sourceId: "sales.source.contacts", eventId: "sales.event.contact-changed", permission: "sales.contacts.read" })
]);
export const kNexSalesRegistry = Object.freeze({ permissionDescriptors: Object.freeze([
  Object.freeze({ id: "sales.accounts.read", resource: "sales.object.account", scope: "application" }),
  Object.freeze({ id: "sales.contacts.read", resource: "sales.object.contact", scope: "application" })
]) });
export const createRealtimeTopicRegistry = (topics) => Object.freeze([...topics]);
export const defineRealtimeTopic = (topic) => topic;
export const createCurrentAuthorityTarget = (value) => value;
export const createSocketIoMemoryGateway = () => Object.freeze({
  publish: async (input) => { control().published.push(input); },
  close: async () => { control().gatewayClosed += 1; }
});
export const currentPayloadAuthentication = async () => ({ user: null });
export const currentSalesGeneration = async () => ({ state: { authorizationRevision: 1, lifecycleRevision: 1 } });
export const kNexAuthority = () => ({ adapter: { allows: async () => false } });
export const kNexRequestContext = (headers, boundary) => Object.freeze({ headers, correlationId: boundary + "-test" });
`;

let directory: string;
let bridge: BridgeModule;

type Control = {
  published: Array<{ channel: { topicId: string }; correlationId: string; message: unknown }>;
  gatewayClosed: number;
  listeners: FakeListener[];
  watermark: number;
  connectFailures: number;
};

function control(): Control {
  return (globalThis as typeof globalThis & { __kNexGeneratedRealtimeBridge: Control }).__kNexGeneratedRealtimeBridge;
}

function freshControl(): Control {
  const value: Control = { published: [], gatewayClosed: 0, listeners: [], watermark: 0, connectFailures: 0 };
  (globalThis as typeof globalThis & { __kNexGeneratedRealtimeBridge: Control }).__kNexGeneratedRealtimeBridge = value;
  return value;
}

function fakePool(state: Control) {
  return {
    async connect(): Promise<unknown> {
      if (state.connectFailures > 0) { state.connectFailures -= 1; throw new Error("pool is exhausted"); }
      const handlers = new Map<string, () => void>();
      const queries: string[] = [];
      let notification: ((message: { channel: string; payload?: string }) => void) | undefined;
      const listener: FakeListener = {
        queries, handlers, released: false,
        notify(payload: string) { notification?.({ channel: "k_nex_runtime_invalidation", payload }); },
        fail(event) { handlers.get(event)?.(); }
      };
      state.listeners.push(listener);
      return {
        on(event: string, handler: (message: { channel: string; payload?: string }) => void) {
          if (event === "notification") { notification = handler; return; }
          handlers.set(event, handler as () => void);
        },
        async query(text: string) { queries.push(text); return undefined; },
        release() { listener.released = true; }
      };
    },
    async query(_text: string, _values?: readonly unknown[]) {
      return { rows: [{ watermark: String(state.watermark) }] };
    }
  };
}

async function settle(predicate: () => boolean, failure: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(failure);
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "k-nex-realtime-bridge-"));
  writeFileSync(join(directory, "stubs.mjs"), stubSource);
  const source = generated["src/k-nex-realtime.ts"]!
    .replace('import { createSocketIoMemoryGateway } from "@k-nex/provider-realtime-socketio";', 'import { createSocketIoMemoryGateway } from "./stubs.mjs";')
    .replace('import { createCurrentAuthorityTarget, createRealtimeTopicRegistry, defineRealtimeTopic } from "@k-nex/runtime";', 'import { createCurrentAuthorityTarget, createRealtimeTopicRegistry, defineRealtimeTopic } from "./stubs.mjs";')
    .replace('import { salesRealtimeTopicDescriptors } from "@k-nex/module-sales/contracts";', 'import { salesRealtimeTopicDescriptors } from "./stubs.mjs";')
    .replace(/import \{ currentPayloadAuthentication,[^;]+from "\.\/k-nex-authority\.js";/u, 'import { currentPayloadAuthentication, currentSalesGeneration, kNexAuthority, kNexRequestContext } from "./stubs.mjs";')
    .replace('import { kNexIdentity } from "./k-nex-identity.js";', 'import { kNexIdentity } from "./stubs.mjs";')
    .replace('import { kNexSalesRegistry } from "./k-nex-registry.js";', 'import { kNexSalesRegistry } from "./stubs.mjs";');
  expect(source).not.toMatch(/@k-nex\//u);
  writeFileSync(join(directory, "realtime.mjs"), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText);
  bridge = await import(pathToFileURL(join(directory, "realtime.mjs")).href) as BridgeModule;
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

it("reconnects, resubscribes, and resynchronises a monotonic watermark after the listener connection dies", async () => {
  const state = freshControl();
  state.watermark = 12;
  const started = await bridge.startKnexRealtime({ db: { pool: fakePool(state) } }, undefined);
  try {
    await settle(() => bridge.currentKnexRealtimeBridgeHealth()?.watermark === 12, "bridge did not synchronise its first watermark");
    const first = bridge.currentKnexRealtimeBridgeHealth()!;
    expect(first.state).toBe("connected");
    expect(first.connection).toBe(1);
    expect(state.listeners[0]!.queries).toEqual(["LISTEN k_nex_runtime_invalidation"]);
    // Nothing subscribed before the first LISTEN, so the starting position is
    // adopted without invalidating anyone.
    expect(state.published).toEqual([]);

    // Events delivered while the bridge is gone are exactly what a dead LISTEN loses.
    state.watermark = 31;
    state.listeners[0]!.fail("error");
    expect(bridge.currentKnexRealtimeBridgeHealth()!.state).toBe("reconnecting");
    expect(state.listeners[0]!.released).toBe(true);

    await settle(() => bridge.currentKnexRealtimeBridgeHealth()!.state === "connected", "bridge did not reconnect");
    const second = bridge.currentKnexRealtimeBridgeHealth()!;
    expect(second.connection).toBe(2);
    expect(second.degradedSince).toBeUndefined();
    expect(state.listeners).toHaveLength(2);
    expect(state.listeners[1]!.queries).toEqual(["LISTEN k_nex_runtime_invalidation"]);
    await settle(() => bridge.currentKnexRealtimeBridgeHealth()!.watermark === 31, "bridge did not resynchronise its watermark");
    expect(state.published.map(({ channel }) => channel.topicId).sort()).toEqual(["sales.topic.accounts", "sales.topic.contacts"]);
    expect(state.published.every(({ correlationId }) => correlationId === "realtime-resynchronisation-31")).toBe(true);

    // A watermark that moves while the bridge is listening was already
    // delivered by notification, so it advances without a second fan-out.
    state.published.length = 0;
    state.watermark = 55;
    await settle(() => bridge.currentKnexRealtimeBridgeHealth()!.watermark === 55, "bridge did not track the authoritative watermark while listening");
    expect(state.published).toEqual([]);

    // A watermark that appears to move backwards never republishes or regresses.
    state.watermark = 7;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(bridge.currentKnexRealtimeBridgeHealth()!.watermark).toBe(55);
    expect(state.published).toEqual([]);
  } finally { await started.close(); }
  expect(bridge.currentKnexRealtimeBridgeHealth()!.state).toBe("closed");
  expect(control().gatewayClosed).toBe(1);
  expect(control().listeners.every(({ released }) => released)).toBe(true);
});

it("keeps retrying a listener connection the pool refuses, and reports the bridge degraded while it is gone", async () => {
  const state = freshControl();
  state.watermark = 4;
  const started = await bridge.startKnexRealtime({ db: { pool: fakePool(state) } }, undefined);
  try {
    await settle(() => bridge.currentKnexRealtimeBridgeHealth()!.state === "connected", "bridge did not start");
    state.connectFailures = 3;
    state.listeners[0]!.fail("end");
    const degradedAt = Date.now();
    expect(bridge.currentKnexRealtimeBridgeHealth()!.state).toBe("reconnecting");
    const stillDown = bridge.currentKnexRealtimeBridgeHealth()!;
    expect(bridge.realtimeBridgeDegradation(stillDown, degradedAt)).toBeUndefined();
    expect(bridge.realtimeBridgeDegradation(stillDown, degradedAt + bridge.realtimeBridgeDegradedGraceMs + 1)).toBe("Sales realtime invalidation bridge is not listening.");
    await settle(() => bridge.currentKnexRealtimeBridgeHealth()!.state === "connected", "bridge did not recover from repeated connection failures");
    expect(bridge.currentKnexRealtimeBridgeHealth()!.connection).toBe(2);
    expect(bridge.realtimeBridgeDegradation(bridge.currentKnexRealtimeBridgeHealth(), Date.now())).toBeUndefined();
  } finally { await started.close(); }
  expect(bridge.realtimeBridgeDegradation(bridge.currentKnexRealtimeBridgeHealth(), Date.now())).toBe("Sales realtime invalidation bridge is closed.");
});

it("refuses readiness for a bridge whose synchronisation has stalled, and ignores a process that never started one", () => {
  expect(bridge.realtimeBridgeDegradation(undefined, Date.now())).toBeUndefined();
  const stalled = { state: "connected", connection: 1, watermark: 3, synchronizedAt: 0, degradedSince: undefined };
  expect(bridge.realtimeBridgeDegradation(stalled, 60_001)).toBe("Sales realtime invalidation bridge has not synchronised.");
  expect(bridge.realtimeBridgeDegradation(stalled, 59_999)).toBeUndefined();
});

it("degrades generated readiness through the same bridge predicate the bridge publishes", () => {
  const readiness = generated["src/k-nex-readiness.ts"]!;
  expect(readiness).toContain('import { currentKnexRealtimeBridgeHealth, realtimeBridgeDegradation } from "./k-nex-realtime.js";');
  expect(readiness).toContain("const degraded = realtimeBridgeDegradation(realtime, Date.now());");
  expect(readiness).toContain("if (degraded !== undefined) fail(degraded);");
  expect(generated["src/app/api/readiness/route.ts"]).toContain("realtime: readiness.realtime ?? null");
  expect(generated["src/k-nex-realtime.ts"]).not.toContain("Polling remains the authoritative fallback");
});
