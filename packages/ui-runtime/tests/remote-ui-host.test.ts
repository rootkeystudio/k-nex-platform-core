import { MessageChannel } from "node:worker_threads";

import { describe, expect, it, vi } from "vitest";

import { createOpaqueRemoteUiFrame, RemoteUiGenerationSessions, RemoteUiHostSession, type RemoteUiHostAdapter, type RemoteUiSessionIdentity } from "../src/remote-ui-host.js";

const identity: RemoteUiSessionIdentity = {
  sessionId: "remote-session-1", actorSessionId: "actor-session-1", applicationId: "customer-alpha", environment: "production",
  appId: "app.sales-assistant", generationId: "sales-generation-1", remoteUiFrameUrl: `https://extensions.example/api/extensions/apps/app.sales-assistant/assets/sales-generation-1/sha256:${"a".repeat(64)}/frame.html`, route: "/apps/sales-assistant", surface: "sales.assistant-screen",
  sources: new Set(["sales.tasks"]), actions: new Set(["sales.refresh"]), routes: new Set(["/apps/sales-assistant"]),
  assets: new Set([`asset:sha256:${"a".repeat(64)}`])
};
const registry = new Map([
  ["stack", { events: new Set<"press">(), validateProps(props: Record<string, unknown>) { if (Object.keys(props).some((key) => key !== "gap")) throw new Error(); } }],
  ["button", { events: new Set(["press"] as const), validateProps(props: Record<string, unknown>) { if (typeof props.label !== "string" || Object.keys(props).length !== 1) throw new Error(); } }],
  ["image", { events: new Set<"press">(), validateProps(props: Record<string, unknown>, context: { assets: ReadonlySet<string> }) { if (typeof props.asset !== "string" || !context.assets.has(props.asset)) throw new Error(); } }]
]);
const root = { nodeId: "root", component: "stack", props: { gap: "medium" }, events: [], children: [
  { nodeId: "refresh", component: "button", props: { label: "Refresh" }, events: [{ event: "press" as const, handlerId: "sales.refresh" }], children: [] }
] };

function adapter(): RemoteUiHostAdapter & { render: ReturnType<typeof vi.fn>; fallback: ReturnType<typeof vi.fn>; source: ReturnType<typeof vi.fn> } {
  return {
    authorize: async () => true, render: vi.fn(), fallback: vi.fn(), focus: vi.fn(), navigate: vi.fn(),
    source: vi.fn(async (_target, input) => ({ input })), action: vi.fn(async () => ({ changed: true }))
  };
}

async function tick(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 10)); }

describe("remote UI host session", () => {
  it("removes the owned realm after a malformed frame", async () => {
    const host = adapter();
    const session = new RemoteUiHostSession(identity, registry, host);
    let onLoad: (() => void) | undefined;
    let removed = false;
    let realmPort: MessagePort | undefined;
    const iframe = {
      title: "", sandbox: { add() {} }, referrerPolicy: "", contentWindow: { postMessage(_message: unknown, _origin: string, ports: readonly MessagePort[]) { realmPort = ports[0]; } },
      setAttribute() {}, addEventListener(_type: string, listener: () => void) { onLoad = listener; }, remove() { removed = true; }
    };
    const frame = createOpaqueRemoteUiFrame({ location: { href: "https://host.example/" }, createElement: () => iframe } as unknown as Document, session, identity.remoteUiFrameUrl, "Sales assistant");
    onLoad!();
    realmPort!.postMessage({ schemaVersion: 1, sessionId: identity.sessionId, appId: identity.appId, generationId: identity.generationId, sequence: 1, direction: "realm-to-host", type: "render", root: { ...root, component: "script" } });
    await tick();
    expect(host.fallback).toHaveBeenCalledWith("PROTOCOL_FAILURE");
    expect(removed).toBe(true);
    frame.dispose();
  });

  it("rejects an alternate origin even when its app and generation frame path match", () => {
    const session = new RemoteUiHostSession(identity, registry, adapter());
    const attacker = identity.remoteUiFrameUrl.replace("extensions.example", "attacker.example");
    expect(() => createOpaqueRemoteUiFrame({ location: { href: "https://host.example/" } } as Document, session, attacker, "hostile frame")).toThrow("generation-pinned credentialless extension origin");
  });

  it("requires HTTPS in production and permits loopback HTTP only with explicit development opt-in", () => {
    const frameUrl = identity.remoteUiFrameUrl.replace("https://extensions.example", "http://localhost:4173");
    const production = { ...identity, remoteUiFrameUrl: frameUrl };
    expect(() => createOpaqueRemoteUiFrame({ location: { href: "https://host.example/" } } as Document, new RemoteUiHostSession(production, registry, adapter()), frameUrl, "implicit insecure production")).toThrow("generation-pinned credentialless extension origin");
    expect(() => createOpaqueRemoteUiFrame({ location: { href: "https://host.example/" } } as Document, new RemoteUiHostSession(production, registry, adapter()), frameUrl, "insecure production", { allowInsecureDevelopmentOrigin: true })).toThrow("permitted only for development");
    const iframe = { title: "", sandbox: { add() {} }, referrerPolicy: "", setAttribute() {}, addEventListener() {}, remove() {} };
    const development = { ...production, environment: "development" };
    expect(() => createOpaqueRemoteUiFrame({ location: { href: "https://host.example/" }, createElement: () => iframe } as unknown as Document, new RemoteUiHostSession(development, registry, adapter()), frameUrl, "development frame", { allowInsecureDevelopmentOrigin: true })).not.toThrow();
    expect(() => createOpaqueRemoteUiFrame({ location: { href: "https://host.example/" } } as Document, new RemoteUiHostSession(development, registry, adapter()), frameUrl, "implicit development frame")).toThrow("generation-pinned credentialless extension origin");
  });

  it("validates identity, sequence, registry, events, and declared source transport", async () => {
    const host = adapter();
    const session = new RemoteUiHostSession(identity, registry, host);
    const channel = new MessageChannel();
    const received: unknown[] = [];
    channel.port2.on("message", (message) => received.push(message));
    session.start(channel.port1 as unknown as MessagePort);
    channel.port2.postMessage({ schemaVersion: 1, sessionId: identity.sessionId, appId: identity.appId, generationId: identity.generationId, sequence: 1, direction: "realm-to-host", type: "ready" });
    channel.port2.postMessage({ schemaVersion: 1, sessionId: identity.sessionId, appId: identity.appId, generationId: identity.generationId, sequence: 2, direction: "realm-to-host", type: "render", root });
    channel.port2.postMessage({ schemaVersion: 1, sessionId: identity.sessionId, appId: identity.appId, generationId: identity.generationId, sequence: 3, direction: "realm-to-host", type: "request", operation: "source", requestId: "source-request-1", targetId: "sales.tasks", input: {} });
    channel.port2.postMessage({ schemaVersion: 1, sessionId: identity.sessionId, appId: identity.appId, generationId: identity.generationId, sequence: 4, direction: "realm-to-host", type: "request", operation: "action", requestId: "action-request-1", targetId: "sales.refresh", input: {} });
    await tick();
    expect(host.render).toHaveBeenCalledWith(root);
    expect(host.source).toHaveBeenCalledWith("sales.tasks", {});
    expect(host.action).toHaveBeenCalledWith("sales.refresh", {});
    expect(received).toEqual(expect.arrayContaining([expect.objectContaining({ type: "bootstrap", sequence: 1 }), expect.objectContaining({ type: "response-ok", requestId: "source-request-1" })]));
    session.dispatchEvent("refresh", "press", null);
    await tick();
    expect(received).toEqual(expect.arrayContaining([expect.objectContaining({ type: "event", handlerId: "sales.refresh" })]));
    session.dispose();
    channel.port2.close();
  });

  it("fails the app-local session on replay, unknown component, and authorization denial", async () => {
    for (const frame of [
      { sequence: 2, type: "ready" },
      { sequence: 1, type: "render", root: { ...root, component: "script" } },
      { sequence: 1, type: "render", root: { ...root, children: [{ nodeId: "asset", component: "image", props: { asset: `asset:sha256:${"b".repeat(64)}` }, events: [], children: [] }] } },
      { sequence: 1, type: "request", operation: "source", requestId: "source-request-1", targetId: "other.tasks", input: {} },
      { sequence: 1, generationId: "other-generation-1", type: "ready" }
    ]) {
      const host = adapter();
      const channel = new MessageChannel();
      const session = new RemoteUiHostSession(identity, registry, host);
      session.start(channel.port1 as unknown as MessagePort);
      channel.port2.postMessage({ schemaVersion: 1, sessionId: identity.sessionId, appId: identity.appId, generationId: identity.generationId, direction: "realm-to-host", ...frame });
      await tick();
      expect(host.fallback).toHaveBeenCalledWith("PROTOCOL_FAILURE");
      channel.port2.close();
    }
    const denied = adapter();
    denied.authorize = async () => false;
    const channel = new MessageChannel();
    const session = new RemoteUiHostSession(identity, registry, denied);
    session.start(channel.port1 as unknown as MessagePort);
    channel.port2.postMessage({ schemaVersion: 1, sessionId: identity.sessionId, appId: identity.appId, generationId: identity.generationId, sequence: 1, direction: "realm-to-host", type: "ready" });
    await tick();
    expect(denied.fallback).toHaveBeenCalledWith("UNAUTHORIZED");
    channel.port2.close();
  });

  it("admits only the active generation and drains old sessions after promotion", () => {
    const scheduled: Array<() => void> = [];
    const generations = new RemoteUiGenerationSessions((work) => scheduled.push(work));
    generations.activate(identity.appId, identity.generationId, 100);
    const old = new RemoteUiHostSession(identity, registry, adapter());
    generations.admit(old);
    generations.activate(identity.appId, "sales-generation-2", 100);
    expect(() => generations.admit(new RemoteUiHostSession(identity, registry, adapter()))).toThrow();
    const current = new RemoteUiHostSession({ ...identity, sessionId: "remote-session-2", generationId: "sales-generation-2" }, registry, adapter());
    expect(() => generations.admit(current)).not.toThrow();
    expect(scheduled).toHaveLength(1);
    scheduled[0]!();
    expect(generations.retire(identity.appId, identity.generationId)).toBe(0);
  });

  it("closes sessions that exceed frame depth, size, or rate budgets", async () => {
    const cases: unknown[] = [];
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 30; index += 1) nested = { nested };
    cases.push({ sequence: 1, type: "request", operation: "source", requestId: "deep-request-1", targetId: "sales.tasks", input: nested });
    cases.push({ sequence: 1, type: "request", operation: "source", requestId: "large-request-1", targetId: "sales.tasks", input: "x".repeat(270_000) });
    for (const frame of cases) {
      const host = adapter(); const channel = new MessageChannel(); const session = new RemoteUiHostSession(identity, registry, host);
      session.start(channel.port1 as unknown as MessagePort);
      channel.port2.postMessage({ schemaVersion: 1, sessionId: identity.sessionId, appId: identity.appId, generationId: identity.generationId, direction: "realm-to-host", ...frame });
      await tick();
      expect(host.fallback).toHaveBeenCalledWith("PROTOCOL_FAILURE");
      channel.port2.close();
    }

    const host = adapter(); const channel = new MessageChannel(); const session = new RemoteUiHostSession(identity, registry, host, () => 1_000);
    session.start(channel.port1 as unknown as MessagePort);
    for (let index = 1; index <= 241; index += 1) channel.port2.postMessage({ schemaVersion: 1, sessionId: identity.sessionId, appId: identity.appId, generationId: identity.generationId, sequence: index, direction: "realm-to-host", type: "ready" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(host.fallback).toHaveBeenCalledWith("PROTOCOL_FAILURE");
    channel.port2.close();
  });
});
