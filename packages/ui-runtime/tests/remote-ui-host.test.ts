import { MessageChannel } from "node:worker_threads";

import { describe, expect, it, vi } from "vitest";

import { createOpaqueRemoteUiFrame, RemoteUiGenerationSessions, type RemoteUiGenerationSnapshot, type RemoteUiHostAdapter, type RemoteUiSessionRequest } from "../src/remote-ui-host.js";

const artifactDigest = `sha256:${"a".repeat(64)}`;
const assetDigest = "a".repeat(64);
const owner = { applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant" };
const authorization = (authorizationRevision = 1, authorizationProof = "authorization-proof-1") => ({ applicationId: owner.applicationId, environment: owner.environment, authorizationRevision, authorizationProof });
const generation = (generationId = "sales-generation-1", revision = 1, disposition: RemoteUiGenerationSnapshot["disposition"] = "active"): RemoteUiGenerationSnapshot => ({ ...owner, generationId, artifactDigest, revision, disposition });
const request = (sessionId = "remote-session-1", generationId = "sales-generation-1"): RemoteUiSessionRequest => ({
  sessionId, remoteUiFrameUrl: `https://extensions.example/api/extensions/apps/app.sales-assistant/assets/${generationId}/sha256:${assetDigest}/frame.html`, route: "/apps/sales-assistant", surface: "sales.assistant-screen",
  sources: new Set(["sales.tasks"]), actions: new Set(["sales.refresh"]), routes: new Set(["/", "/tasks/:taskid"]), assets: new Set([`asset:sha256:${assetDigest}`]),
  presentation: { profileRevisionId: "profile-revision-1", themeId: "theme.default", themeVersion: "1.0.0", surface: "admin", mode: "light" }
});
const registry = new Map([
  ["stack", { events: new Set<"press">(), validateProps(props: Record<string, unknown>) { if (Object.keys(props).some((key) => key !== "gap")) throw new Error(); } }],
  ["button", { events: new Set(["press"] as const), validateProps(props: Record<string, unknown>) { if (typeof props.label !== "string" || Object.keys(props).length !== 1) throw new Error(); } }]
]);
const root = { nodeId: "root", component: "stack", props: { gap: "medium" }, events: [], children: [{ nodeId: "refresh", component: "button", props: { label: "Refresh" }, events: [{ event: "press" as const, handlerId: "sales.refresh" }], children: [] }] };

function adapter(): RemoteUiHostAdapter & { authorize: ReturnType<typeof vi.fn>; authorizeTarget: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn>; fallback: ReturnType<typeof vi.fn>; source: ReturnType<typeof vi.fn>; action: ReturnType<typeof vi.fn> } {
  return {
    authorize: vi.fn(async () => true), authorizeTarget: vi.fn(async () => true), render: vi.fn(), fallback: vi.fn(), focus: vi.fn(), navigate: vi.fn(),
    source: vi.fn(async (_identity, _target, input) => ({ input })), action: vi.fn(async () => ({ changed: true }))
  };
}

function opened(snapshot = generation(), host = adapter(), scheduled: Array<() => void> = []): Readonly<{ sessions: RemoteUiGenerationSessions; session: ReturnType<RemoteUiGenerationSessions["open"]>; host: typeof host; scheduled: typeof scheduled }> {
  const sessions = new RemoteUiGenerationSessions((work) => scheduled.push(work));
  sessions.observe(snapshot, 100);
  sessions.admitAuthorization(authorization());
  return { sessions, session: sessions.open(snapshot, request("remote-session-1", snapshot.generationId), registry, host), host, scheduled };
}

async function tick(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 10)); }
function realmFrame(snapshot: RemoteUiGenerationSnapshot, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, sessionId: "remote-session-1", appId: snapshot.appId, generationId: snapshot.generationId, sequence: 1, direction: "realm-to-host", type, ...extra };
}

describe("remote UI host session authority", () => {
  it("creates and starts sessions only from the current active authority snapshot", () => {
    const first = generation();
    const second = generation("sales-generation-2", 2);
    const sessions = new RemoteUiGenerationSessions();
    sessions.observe(first, 100);
    expect(() => sessions.open(first, request(), registry, adapter())).toThrow("current active generation snapshot");
    sessions.admitAuthorization(authorization());
    expect(sessions.open(first, request(), registry, adapter()).identity).toMatchObject({ ...owner, generationId: first.generationId, artifactDigest });
    sessions.observe(second, 100);
    expect(() => sessions.open(first, request(), registry, adapter())).toThrow("current active generation snapshot");
    expect(() => sessions.open({ ...second, artifactDigest: `sha256:${"b".repeat(64)}` }, request("remote-session-2", second.generationId), registry, adapter())).toThrow("current active generation snapshot");
  });

  it("makes identical authority replays no-ops while rejecting stale or conflicting observations", () => {
    const sessions = new RemoteUiGenerationSessions();
    const first = generation();
    sessions.observe(first, 100);
    sessions.admitAuthorization(authorization());
    expect(() => sessions.observe(first, 100)).not.toThrow();
    expect(() => sessions.observe({ ...first, generationId: "sales-generation-2", revision: 1 }, 100)).toThrow("same revision must match");
    sessions.observe(generation("sales-generation-2", 2), 100);
    expect(() => sessions.observe(first, 100)).toThrow("advance monotonically");
  });

  it("does not schedule another retirement for an identical outbox replay", () => {
    const scheduled: Array<() => void> = [];
    const first = generation();
    const second = generation("sales-generation-2", 2);
    const sessions = new RemoteUiGenerationSessions((work) => scheduled.push(work));
    sessions.observe(first, 100);
    sessions.admitAuthorization(authorization());
    const old = sessions.open(first, request(), registry, adapter());
    const disposeOld = vi.spyOn(old, "dispose");
    sessions.observe(second, 100);
    sessions.observe(second, 100);
    expect(scheduled).toHaveLength(1);
    scheduled[0]!();
    expect(disposeOld).toHaveBeenCalledOnce();
  });

  it("drains admitted old work after update, while admitting only the new snapshot", () => {
    const scheduled: Array<() => void> = [];
    const first = generation();
    const second = generation("sales-generation-2", 2);
    const sessions = new RemoteUiGenerationSessions((work) => scheduled.push(work));
    sessions.observe(first, 100);
    sessions.admitAuthorization(authorization());
    const old = sessions.open(first, request(), registry, adapter());
    const disposeOld = vi.spyOn(old, "dispose");
    sessions.observe(second, 100);
    expect(() => sessions.open(first, request(), registry, adapter())).toThrow();
    expect(() => sessions.open(second, request("remote-session-2", second.generationId), registry, adapter())).not.toThrow();
    expect(scheduled).toHaveLength(1);
    scheduled[0]!();
    expect(disposeOld).toHaveBeenCalledOnce();
    expect(disposeOld).toHaveBeenCalledWith("generation-retired");
  });

  it("cancels a stale retirement after an authoritative rollback", () => {
    const scheduled: Array<() => void> = [];
    const first = generation();
    const second = generation("sales-generation-2", 2);
    const restored = generation("sales-generation-1", 3);
    const sessions = new RemoteUiGenerationSessions((work) => scheduled.push(work));
    sessions.observe(first, 100);
    sessions.admitAuthorization(authorization());
    const old = sessions.open(first, request(), registry, adapter());
    const disposeOld = vi.spyOn(old, "dispose");
    sessions.observe(second, 100);
    const current = sessions.open(second, request("remote-session-2", second.generationId), registry, adapter());
    const disposeCurrent = vi.spyOn(current, "dispose");
    sessions.observe(restored, 100);
    scheduled[0]!();
    expect(disposeOld).not.toHaveBeenCalled();
    scheduled[1]!();
    expect(disposeCurrent).toHaveBeenCalledWith("generation-retired");
  });

  it.each(["disabled", "quarantined", "removed"] as const)("immediately denies new work and disposes realms when %s", (disposition) => {
    const first = generation();
    const terminal = generation(first.generationId, 2, disposition);
    const { sessions, session } = opened(first);
    const realm = vi.fn();
    session.bindRealmDisposer(realm);
    sessions.observe(terminal, 100);
    expect(realm).toHaveBeenCalledOnce();
    expect(() => sessions.open(terminal, request(), registry, adapter())).toThrow();
  });

  it("unregisters normally disposed sessions", () => {
    const first = generation();
    const { sessions, session } = opened(first);
    session.dispose();
    expect(sessions.retire(owner, first.generationId)).toBe(0);
  });

  it("revokes every live app realm in one application environment and needs a newer authoritative readmission", () => {
    const sessions = new RemoteUiGenerationSessions();
    const first = generation();
    const sibling = { ...generation("sales-generation-2"), appId: "app.sales-dashboard" };
    const otherEnvironment = { ...generation("sales-generation-3"), environment: "staging" };
    sessions.observe(first, 100);
    sessions.observe(sibling, 100);
    sessions.observe(otherEnvironment, 100);
    sessions.admitAuthorization(authorization());
    sessions.admitAuthorization({ ...authorization(), environment: "staging" });
    const firstSession = sessions.open(first, request(), registry, adapter());
    const siblingSession = sessions.open(sibling, request("remote-session-2", sibling.generationId), registry, adapter());
    const otherEnvironmentSession = sessions.open(otherEnvironment, request("remote-session-3", otherEnvironment.generationId), registry, adapter());
    const disposeFirst = vi.spyOn(firstSession, "dispose");
    const disposeSibling = vi.spyOn(siblingSession, "dispose");
    const disposeOtherEnvironment = vi.spyOn(otherEnvironmentSession, "dispose");

    expect(sessions.revokeAuthorization({ applicationId: owner.applicationId, environment: owner.environment, authorizationRevision: 2 })).toBe(2);
    expect(disposeFirst).toHaveBeenCalledWith("authorization-revoked");
    expect(disposeSibling).toHaveBeenCalledWith("authorization-revoked");
    expect(disposeOtherEnvironment).not.toHaveBeenCalled();
    expect(() => sessions.open(first, request("remote-session-4"), registry, adapter())).toThrow("current active generation snapshot");
    expect(sessions.revokeAuthorization({ applicationId: owner.applicationId, environment: owner.environment, authorizationRevision: 2 })).toBe(0);
    sessions.observe(first, 100);
    expect(() => sessions.open(first, request("remote-session-4"), registry, adapter())).toThrow("current active generation snapshot");
    expect(() => sessions.admitAuthorization(authorization(1, "stale-proof"))).toThrow("regresses a revoked revision");
    sessions.admitAuthorization(authorization(2, "authorization-proof-2"));
    expect(() => sessions.admitAuthorization(authorization(2, "authorization-proof-2"))).not.toThrow();
    expect(() => sessions.admitAuthorization(authorization(2, "conflicting-proof"))).toThrow("proof conflicts");
    expect(sessions.revokeAuthorization({ applicationId: owner.applicationId, environment: owner.environment, authorizationRevision: 1 })).toBe(0);
    expect(() => sessions.open(first, request("remote-session-4"), registry, adapter())).not.toThrow();
    expect(() => sessions.open(otherEnvironment, request("remote-session-5", otherEnvironment.generationId), registry, adapter())).not.toThrow();
    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(disposeSibling).toHaveBeenCalledOnce();
    expect(sessions.retire(otherEnvironment, otherEnvironment.generationId)).toBe(2);
  });

  it("passes the admitted immutable session identity to bounded source and action gateways", async () => {
    const { session, host } = opened();
    const channel = new MessageChannel();
    session.start(channel.port1 as unknown as MessagePort);
    channel.port2.postMessage(realmFrame(generation(), "request", { operation: "source", requestId: "source-identity-1", targetId: "sales.tasks", input: { page: 1 } }));
    await tick();
    expect(host.source).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "remote-session-1", generationId: "sales-generation-1", artifactDigest }), "sales.tasks", { page: 1 }, expect.any(AbortSignal));
    expect(Object.isFrozen(host.source.mock.calls[0]![0])).toBe(true);
    channel.port2.close();
  });

  it("follows host profile changes without exposing presentation to app identity or frames", async () => {
    const { session, host } = opened();
    const channel = new MessageChannel();
    session.start(channel.port1 as unknown as MessagePort);
    channel.port2.postMessage(realmFrame(generation(), "render", { root }));
    await tick();
    expect(host.render).toHaveBeenLastCalledWith(root, expect.objectContaining({ profileRevisionId: "profile-revision-1", themeId: "theme.default" }), expect.any(AbortSignal));
    expect(session.identity).not.toHaveProperty("presentation");

    await session.updatePresentation({ profileRevisionId: "profile-revision-2", themeId: "theme.contrast", themeVersion: "1.0.0", surface: "admin", mode: "dark" });
    expect(host.render).toHaveBeenLastCalledWith(root, expect.objectContaining({ profileRevisionId: "profile-revision-2", themeId: "theme.contrast", mode: "dark" }), expect.any(AbortSignal));
    channel.port2.postMessage(realmFrame(generation(), "render", { root, presentation: { themeId: "theme.forged" } }));
    await tick();
    expect(host.fallback).toHaveBeenCalledWith("PROTOCOL_FAILURE", expect.any(AbortSignal));
    channel.port2.close();
  });

  it("reauthorizes the exact declared target before browser-facing dispatch", async () => {
    const { session, host } = opened();
    host.authorizeTarget.mockResolvedValueOnce(false);
    const channel = new MessageChannel();
    session.start(channel.port1 as unknown as MessagePort);
    channel.port2.postMessage(realmFrame(generation(), "request", { operation: "source", requestId: "source-denied-1", targetId: "sales.tasks", input: {} }));
    await tick();

    expect(host.authorizeTarget).toHaveBeenCalledWith(expect.anything(), "source", "sales.tasks", expect.any(AbortSignal));
    expect(host.source).not.toHaveBeenCalled();
    expect(host.fallback).toHaveBeenCalledWith("UNAUTHORIZED", expect.any(AbortSignal));
    channel.port2.close();
  });

  it("contains malformed port traffic with one fallback and one realm cleanup", async () => {
    const { session, host } = opened();
    const channel = new MessageChannel();
    const realm = vi.fn();
    session.bindRealmDisposer(realm);
    session.start(channel.port1 as unknown as MessagePort);
    channel.port2.postMessage(realmFrame(generation(), "render", { root: { ...root, component: "script" } }));
    await tick();
    expect(host.fallback).toHaveBeenCalledOnce();
    expect(host.fallback).toHaveBeenCalledWith("PROTOCOL_FAILURE", expect.any(AbortSignal));
    expect(realm).toHaveBeenCalledOnce();
    channel.port2.close();
  });

  it("cleans up exactly once when postMessage and fallback both fail", async () => {
    const { session, host } = opened();
    host.fallback.mockRejectedValueOnce(new Error("fallback failed"));
    const realm = vi.fn();
    session.bindRealmDisposer(realm);
    const port = { addEventListener() {}, start() {}, close: vi.fn(), postMessage() { throw new Error("port failed"); } } as unknown as MessagePort;
    session.start(port);
    await tick();
    session.dispose();
    expect(host.fallback).toHaveBeenCalledOnce();
    expect(realm).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("immediately aborts and tears down a crashed realm while its fallback never settles", async () => {
    let resolveSource: ((value: unknown) => void) | undefined;
    let sourceSignal: AbortSignal | undefined;
    let fallbackSignal: AbortSignal | undefined;
    const { sessions, session, host } = opened();
    host.source.mockImplementationOnce((_identity, _target, _input, signal) => new Promise((resolve) => {
      sourceSignal = signal;
      resolveSource = resolve;
    }));
    host.fallback.mockImplementationOnce((_code, signal) => new Promise<void>(() => { fallbackSignal = signal; }));
    const listeners = new Map<string, (event: Readonly<{ data: unknown }>) => void>();
    const port = {
      addEventListener(type: string, listener: (event: Readonly<{ data: unknown }>) => void) { listeners.set(type, listener); },
      start: vi.fn(), close: vi.fn(), postMessage: vi.fn()
    } as unknown as MessagePort;
    const realm = vi.fn();
    session.bindRealmDisposer(realm);
    session.start(port);
    listeners.get("message")!({ data: realmFrame(generation(), "request", { operation: "source", requestId: "source-crash-1", targetId: "sales.tasks", input: {} }) });
    await tick();
    expect(sourceSignal).toBeDefined();
    expect(sourceSignal!.aborted).toBe(false);

    session.realmCrashed();

    expect(host.fallback).toHaveBeenCalledWith("APP_FAILURE", expect.any(AbortSignal));
    expect(fallbackSignal).toBeDefined();
    expect(fallbackSignal!.aborted).toBe(true);
    expect(sourceSignal!.aborted).toBe(true);
    expect(port.close).toHaveBeenCalledOnce();
    expect(realm).toHaveBeenCalledOnce();
    expect(sessions.retire(owner, generation().generationId)).toBe(0);

    resolveSource!({ late: true });
    await tick();
    expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "response-ok" }));
    session.dispose();
    expect(port.close).toHaveBeenCalledOnce();
    expect(realm).toHaveBeenCalledOnce();
  });

  it("makes late authorization, render, source, and action completions inert after closure", async () => {
    let resolveAuthorization: ((value: boolean) => void) | undefined;
    let resolveRender: (() => void) | undefined;
    let resolveSource: ((value: unknown) => void) | undefined;
    let resolveAction: ((value: unknown) => void) | undefined;
    let sourceSignal: AbortSignal | undefined;
    let actionSignal: AbortSignal | undefined;
    const { session, host } = opened();
    host.authorize.mockImplementationOnce((_identity, _frame, signal) => new Promise<boolean>((resolve) => { expect(signal?.aborted).toBe(false); resolveAuthorization = resolve; }));
    const channel = new MessageChannel();
    const received: Array<Record<string, unknown>> = [];
    channel.port2.on("message", (value) => received.push(value));
    session.start(channel.port1 as unknown as MessagePort);
    channel.port2.postMessage(realmFrame(generation(), "ready"));
    await tick();
    session.dispose();
    resolveAuthorization!(true);
    await tick();
    expect(host.render).not.toHaveBeenCalled();

    const rendering = opened(generation("sales-generation-render", 1));
    rendering.host.render.mockImplementationOnce((_root, _presentation, signal) => new Promise<void>((resolve) => { expect(signal?.aborted).toBe(false); resolveRender = resolve; }));
    const renderingChannel = new MessageChannel();
    rendering.session.start(renderingChannel.port1 as unknown as MessagePort);
    renderingChannel.port2.postMessage(realmFrame(generation("sales-generation-render", 1), "render", { root }));
    await tick();
    rendering.session.dispose();
    resolveRender!();
    await tick();
    expect(rendering.host.fallback).not.toHaveBeenCalled();

    const fresh = opened(generation("sales-generation-2", 1));
    fresh.host.source.mockImplementationOnce((_identity, _target, _input, signal) => new Promise((resolve) => { expect(signal.aborted).toBe(false); sourceSignal = signal; resolveSource = resolve; }));
    const freshChannel = new MessageChannel();
    const freshReceived: Array<Record<string, unknown>> = [];
    freshChannel.port2.on("message", (value) => freshReceived.push(value));
    fresh.session.start(freshChannel.port1 as unknown as MessagePort);
    freshChannel.port2.postMessage(realmFrame(generation("sales-generation-2", 1), "request", { operation: "source", requestId: "source-request-1", targetId: "sales.tasks", input: {} }));
    await tick();
    fresh.session.dispose();
    expect(sourceSignal?.aborted).toBe(true);
    resolveSource!({ late: true });
    await tick();
    expect(freshReceived).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "response-ok" })]));

    const acting = opened(generation("sales-generation-action", 1));
    acting.host.action.mockImplementationOnce((_identity, _target, _input, signal) => new Promise((resolve) => { expect(signal.aborted).toBe(false); actionSignal = signal; resolveAction = resolve; }));
    const actingChannel = new MessageChannel();
    const actingReceived: Array<Record<string, unknown>> = [];
    actingChannel.port2.on("message", (value) => actingReceived.push(value));
    acting.session.start(actingChannel.port1 as unknown as MessagePort);
    actingChannel.port2.postMessage(realmFrame(generation("sales-generation-action", 1), "request", { operation: "action", requestId: "action-request-1", targetId: "sales.refresh", input: {} }));
    await tick();
    acting.session.dispose();
    expect(actionSignal?.aborted).toBe(true);
    resolveAction!({ late: true });
    await tick();
    expect(actingReceived).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "response-ok" })]));
    channel.port2.close();
    renderingChannel.port2.close();
    freshChannel.port2.close();
    actingChannel.port2.close();
  });

  it("keeps the opaque frame path generation pinned and reports realm load failure", async () => {
    const { session, host } = opened();
    let onError: (() => void) | undefined;
    let removed = false;
    const iframe = {
      title: "", sandbox: { add() {} }, referrerPolicy: "", contentWindow: null, setAttribute() {},
      addEventListener(type: string, listener: () => void) { if (type === "error") onError = listener; }, remove() { removed = true; }
    };
    createOpaqueRemoteUiFrame({ location: { href: "https://host.example/" }, createElement: () => iframe } as unknown as Document, session, session.identity.remoteUiFrameUrl, "Sales assistant");
    onError!();
    await tick();
    expect(host.fallback).toHaveBeenCalledWith("APP_FAILURE", expect.any(AbortSignal));
    expect(removed).toBe(true);
  });
});
