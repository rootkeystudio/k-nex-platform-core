import { canonicalJson, matchHotApplicationRoute, RemoteUiFrameSchema, remoteUiCeilings, type JsonValue, type RemoteUiFrame, type RemoteUiNode } from "@k-nex/contracts";

export interface RemoteUiComponentDefinition {
  readonly events: ReadonlySet<"press" | "change" | "submit" | "selection-change">;
  validateProps(props: Readonly<Record<string, JsonValue>>, context: Readonly<{ assets: ReadonlySet<string> }>): void;
}

export interface RemoteUiGenerationOwner { readonly applicationId: string; readonly environment: string; readonly appId: string; }
export type RemoteUiGenerationDisposition = "active" | "disabled" | "quarantined" | "removed";
/** Ephemeral projection of the durable extension inventory authority. */
export interface RemoteUiGenerationSnapshot extends RemoteUiGenerationOwner {
  readonly generationId: string;
  readonly artifactDigest: string;
  readonly revision: number;
  readonly disposition: RemoteUiGenerationDisposition;
}

export interface RemoteUiSessionIdentity extends RemoteUiGenerationOwner {
  readonly sessionId: string;
  readonly generationId: string;
  readonly artifactDigest: string;
  /** Host-authorized, verified, generation-pinned frame document URL. */
  readonly remoteUiFrameUrl: string;
  /** Concrete host pathname for this session. */
  readonly route: string;
  readonly surface: string;
  readonly sources: ReadonlySet<string>;
  readonly actions: ReadonlySet<string>;
  /** Signed app-relative route templates. */
  readonly routes: ReadonlySet<string>;
  readonly assets: ReadonlySet<string>;
}

export type RemoteUiSessionRequest = Readonly<Omit<RemoteUiSessionIdentity, "applicationId" | "environment" | "appId" | "generationId" | "artifactDigest">>;

export interface RemoteUiHostAdapter {
  authorize(identity: RemoteUiSessionIdentity, frame: RemoteUiFrame, signal: AbortSignal): boolean | Promise<boolean>;
  /** Reauthorizes the exact server-declared target before source/action dispatch. */
  authorizeTarget(identity: RemoteUiSessionIdentity, operation: "source" | "action", targetId: string, signal: AbortSignal): boolean | Promise<boolean>;
  render(root: RemoteUiNode, signal: AbortSignal): void | Promise<void>;
  fallback(code: "APP_FAILURE" | "PROTOCOL_FAILURE" | "UNAUTHORIZED", signal: AbortSignal): void | Promise<void>;
  focus(nodeId: string, signal: AbortSignal): void | Promise<void>;
  navigate(route: string, signal: AbortSignal): void | Promise<void>;
  /** Requests always carry the immutable host-admitted session, never browser-authored identity. */
  source(identity: RemoteUiSessionIdentity, targetId: string, input: JsonValue, signal: AbortSignal): JsonValue | Promise<JsonValue>;
  action(identity: RemoteUiSessionIdentity, targetId: string, input: JsonValue, signal: AbortSignal): JsonValue | Promise<JsonValue>;
}

export interface RemoteUiFrameOptions { readonly allowInsecureDevelopmentOrigin?: boolean; }

export class RemoteUiProtocolError extends Error {
  constructor(readonly code: "FRAME_INVALID" | "IDENTITY_MISMATCH" | "SEQUENCE_INVALID" | "BUDGET_EXCEEDED" | "COMPONENT_DENIED" | "PROP_INVALID" | "EVENT_DENIED" | "TARGET_DENIED" | "UNAUTHORIZED" | "SESSION_CLOSED", message: string) {
    super(message);
    this.name = "RemoteUiProtocolError";
  }
}

const sessionAdmission = Symbol("remote-ui-session-admission");
function fail(code: RemoteUiProtocolError["code"], message: string): never { throw new RemoteUiProtocolError(code, message); }

function bytes(value: unknown): number {
  const pending: Array<{ value: unknown; depth: number; ancestors: ReadonlySet<object> }> = [{ value, depth: 0, ancestors: new Set() }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > remoteUiCeilings.jsonDepth) fail("BUDGET_EXCEEDED", "Remote UI frame exceeds its JSON depth budget.");
    if (typeof current.value !== "object" || current.value === null) continue;
    if (current.ancestors.has(current.value)) fail("FRAME_INVALID", "Remote UI frames must be acyclic JSON.");
    const ancestors = new Set(current.ancestors).add(current.value);
    for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value as Record<string, unknown>)) pending.push({ value: child, depth: current.depth + 1, ancestors });
  }
  try { return new TextEncoder().encode(canonicalJson(value)).byteLength; }
  catch { return fail("FRAME_INVALID", "Remote UI frames must contain canonical JSON only."); }
}

function validateTree(root: RemoteUiNode, registry: ReadonlyMap<string, RemoteUiComponentDefinition>, assets: ReadonlySet<string>): ReadonlyMap<string, RemoteUiNode> {
  const nodes = new Map<string, RemoteUiNode>();
  const pending: Array<{ node: RemoteUiNode; depth: number }> = [{ node: root, depth: 1 }];
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (depth > remoteUiCeilings.nodeDepth || nodes.size >= remoteUiCeilings.totalNodes) fail("BUDGET_EXCEEDED", "Remote UI tree exceeds its node budget.");
    if (nodes.has(node.nodeId)) fail("FRAME_INVALID", "Remote UI node identities must be unique.");
    const component = registry.get(node.component);
    if (!component) fail("COMPONENT_DENIED", `Remote UI component is not registered: ${node.component}.`);
    try { component.validateProps(node.props, { assets }); } catch { fail("PROP_INVALID", `Remote UI props are invalid for ${node.component}.`); }
    const eventNames = new Set<string>();
    for (const event of node.events) {
      if (!component.events.has(event.event) || eventNames.has(event.event)) fail("EVENT_DENIED", `Remote UI event is not registered for ${node.component}.`);
      eventNames.add(event.event);
    }
    nodes.set(node.nodeId, node);
    for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
  }
  return nodes;
}

export class RemoteUiHostSession {
  private port: MessagePort | undefined;
  private queue = Promise.resolve();
  private incomingSequence = 0;
  private outgoingSequence = 0;
  private closed = false;
  private realmDisposer: (() => void) | undefined;
  private nodes: ReadonlyMap<string, RemoteUiNode> = new Map();
  private readonly requestTimes: number[] = [];
  private readonly abortController = new AbortController();

  constructor(
    readonly identity: RemoteUiSessionIdentity,
    private readonly registry: ReadonlyMap<string, RemoteUiComponentDefinition>,
    private readonly adapter: RemoteUiHostAdapter,
    private readonly now: () => number,
    admission: symbol,
    private readonly unregister: (session: RemoteUiHostSession) => void
  ) {
    if (admission !== sessionAdmission) throw new TypeError("Remote UI sessions must be created by an admitted generation handle.");
  }

  start(port: MessagePort): void {
    if (this.port || this.closed) fail("SESSION_CLOSED", "Remote UI session cannot be started.");
    this.port = port;
    port.addEventListener("message", (event) => this.enqueue(() => this.receive(event.data)));
    port.addEventListener("messageerror", () => { void this.controlledFailure("PROTOCOL_FAILURE"); });
    port.start();
    this.send("bootstrap", { route: this.identity.route, surface: this.identity.surface });
  }

  /** The host owns the realm lifecycle; any terminal session state must tear it down. */
  bindRealmDisposer(dispose: () => void): void {
    if (this.realmDisposer || this.closed) fail("SESSION_CLOSED", "Remote UI realm cannot be bound after session closure.");
    this.realmDisposer = dispose;
  }

  realmCrashed(): void { void this.controlledFailure("APP_FAILURE"); }

  dispatchEvent(nodeId: string, event: "press" | "change" | "submit" | "selection-change", payload: JsonValue): void {
    if (this.closed) return;
    const binding = this.nodes.get(nodeId)?.events.find((candidate) => candidate.event === event);
    if (!binding) fail("EVENT_DENIED", "Remote UI event is not bound by the active tree.");
    this.send("event", { nodeId, event, handlerId: binding.handlerId, payload });
  }

  dispose(reason: "generation-retired" | "session-ended" | "protocol-failure" = "session-ended"): void {
    if (this.closed) return;
    this.closed = true;
    this.abortController.abort();
    const port = this.port;
    const disposeRealm = this.realmDisposer;
    this.port = undefined;
    this.realmDisposer = undefined;
    this.nodes = new Map();
    try { if (port) try { this.post(port, "dispose", { reason }); } catch {} }
    finally {
      try { try { port?.close(); } catch {} }
      finally {
        try { try { disposeRealm?.(); } catch {} }
        finally { this.unregister(this); }
      }
    }
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch((error) => this.controlledFailure(error instanceof RemoteUiProtocolError && error.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "PROTOCOL_FAILURE"));
  }

  private async receive(value: unknown): Promise<void> {
    if (this.closed) return;
    if (bytes(value) > remoteUiCeilings.canonicalBytes) fail("BUDGET_EXCEEDED", "Remote UI frame exceeds its byte budget.");
    const parsed = RemoteUiFrameSchema.safeParse(value);
    if (!parsed.success || parsed.data.direction !== "realm-to-host") fail("FRAME_INVALID", "Remote UI realm frame is invalid.");
    const frame = parsed.data;
    if (frame.sessionId !== this.identity.sessionId || frame.appId !== this.identity.appId || frame.generationId !== this.identity.generationId) fail("IDENTITY_MISMATCH", "Remote UI frame identity does not match the session.");
    if (frame.sequence !== this.incomingSequence + 1) fail("SEQUENCE_INVALID", "Remote UI sequence is missing or replayed.");
    this.incomingSequence = frame.sequence;
    this.enforceRate();
    const signal = this.abortController.signal;
    const authorized = await this.adapter.authorize(this.identity, frame, signal);
    if (this.closed) return;
    if (!authorized) { await this.controlledFailure("UNAUTHORIZED"); return; }
    if (frame.type === "ready") return;
    if (frame.type === "render") {
      this.nodes = validateTree(frame.root, this.registry, this.identity.assets);
      await this.adapter.render(frame.root, signal);
      return;
    }
    if (frame.type === "focus") {
      if (!this.nodes.has(frame.nodeId)) fail("TARGET_DENIED", "Remote UI focus target is not active.");
      await this.adapter.focus(frame.nodeId, signal);
      return;
    }
    if (frame.type === "navigate") {
      if (![...this.identity.routes].some((route) => matchHotApplicationRoute(this.identity.appId, route, frame.route))) fail("TARGET_DENIED", "Remote UI route is not declared.");
      await this.adapter.navigate(frame.route, signal);
      return;
    }
    if (frame.type === "failure") { await this.controlledFailure("APP_FAILURE"); return; }
    const allowed = frame.operation === "source" ? this.identity.sources : this.identity.actions;
    if (!allowed.has(frame.targetId)) fail("TARGET_DENIED", "Remote UI data target is not declared.");
    if (!await this.adapter.authorizeTarget(this.identity, frame.operation, frame.targetId, signal)) fail("UNAUTHORIZED", "Remote UI target authority is denied.");
    try {
      const output = await (frame.operation === "source" ? this.adapter.source(this.identity, frame.targetId, frame.input, signal) : this.adapter.action(this.identity, frame.targetId, frame.input, signal));
      if (!this.closed) this.send("response-ok", { requestId: frame.requestId, output });
    } catch {
      if (!this.closed) this.send("response-error", { requestId: frame.requestId, code: "REQUEST_FAILED" });
    }
  }

  private async controlledFailure(code: "APP_FAILURE" | "PROTOCOL_FAILURE" | "UNAUTHORIZED"): Promise<void> {
    if (this.closed) return;
    try { void Promise.resolve(this.adapter.fallback(code, this.abortController.signal)).catch(() => undefined); }
    catch {}
    finally { this.dispose("protocol-failure"); }
  }

  private send(type: "bootstrap" | "event" | "response-ok" | "response-error", body: Record<string, unknown>): void {
    if (!this.port || this.closed) return;
    try { this.post(this.port, type, body); }
    catch { this.realmCrashed(); }
  }

  private post(port: MessagePort, type: "bootstrap" | "event" | "response-ok" | "response-error" | "dispose", body: Record<string, unknown>): void {
    const frame = RemoteUiFrameSchema.parse({ schemaVersion: 1, sessionId: this.identity.sessionId, appId: this.identity.appId, generationId: this.identity.generationId, sequence: ++this.outgoingSequence, direction: "host-to-realm", type, ...body });
    if (bytes(frame) > remoteUiCeilings.canonicalBytes) fail("BUDGET_EXCEEDED", "Remote UI host frame exceeds its byte budget.");
    port.postMessage(frame);
  }

  private enforceRate(): void {
    const cutoff = this.now() - 60_000;
    while (this.requestTimes[0] !== undefined && this.requestTimes[0] <= cutoff) this.requestTimes.shift();
    if (this.requestTimes.length >= remoteUiCeilings.callsPerMinute) fail("BUDGET_EXCEEDED", "Remote UI frame rate exceeds its budget.");
    this.requestTimes.push(this.now());
  }
}

export class RemoteUiGenerationSessions {
  private readonly active = new Map<string, RemoteUiGenerationSnapshot>();
  private readonly observed = new Map<string, RemoteUiGenerationSnapshot>();
  private readonly sessions = new Map<string, Set<RemoteUiHostSession>>();
  private readonly pendingRetirements = new Map<string, symbol>();

  constructor(private readonly schedule: (work: () => void, delayMs: number) => unknown = (work, delayMs) => setTimeout(work, delayMs)) {}

  observe(snapshotInput: RemoteUiGenerationSnapshot, drainMs: number): void {
    const snapshot = remoteUiGenerationSnapshot(snapshotInput);
    if (!Number.isSafeInteger(drainMs) || drainMs < 1 || drainMs > 30_000) throw new TypeError("Remote UI generation drain is invalid.");
    const ownerKey = remoteUiGenerationOwnerKey(snapshot);
    const previous = this.observed.get(ownerKey);
    if (previous && snapshot.revision < previous.revision) throw new TypeError("Remote UI generation observations must advance monotonically.");
    if (previous && snapshot.revision === previous.revision) {
      if (sameSnapshot(previous, snapshot)) return;
      throw new TypeError("Remote UI generation observations with the same revision must match.");
    }
    const active = this.active.get(ownerKey);
    if (active && snapshot.disposition === "active" && active.generationId === snapshot.generationId && active.artifactDigest !== snapshot.artifactDigest) throw new TypeError("An immutable Remote UI generation cannot change artifact digest.");
    this.observed.set(ownerKey, snapshot);
    if (snapshot.disposition !== "active") {
      this.active.delete(ownerKey);
      this.disposeOwner(snapshot, "protocol-failure");
      return;
    }
    this.active.set(ownerKey, snapshot);
    this.pendingRetirements.delete(remoteUiGenerationKey(snapshot, snapshot.generationId));
    if (active && active.generationId !== snapshot.generationId) this.drain(active, drainMs);
  }

  open(snapshotInput: RemoteUiGenerationSnapshot, request: RemoteUiSessionRequest, registry: ReadonlyMap<string, RemoteUiComponentDefinition>, adapter: RemoteUiHostAdapter, now: () => number = Date.now): RemoteUiHostSession {
    const snapshot = remoteUiGenerationSnapshot(snapshotInput);
    const active = this.active.get(remoteUiGenerationOwnerKey(snapshot));
    if (!active || active.disposition !== "active" || !sameSnapshot(active, snapshot)) fail("IDENTITY_MISMATCH", "New Remote UI sessions require the current active generation snapshot.");
    if (!validRecordId(request.sessionId)) fail("IDENTITY_MISMATCH", "Remote UI session identity is invalid.");
    const identity = Object.freeze({ ...request, applicationId: active.applicationId, environment: active.environment, appId: active.appId, generationId: active.generationId, artifactDigest: active.artifactDigest });
    const session = new RemoteUiHostSession(identity, registry, adapter, now, sessionAdmission, (value) => this.unregister(value));
    const key = remoteUiGenerationKey(active, active.generationId);
    const sessions = this.sessions.get(key) ?? new Set<RemoteUiHostSession>();
    sessions.add(session);
    this.sessions.set(key, sessions);
    return session;
  }

  retire(ownerInput: RemoteUiGenerationOwner, generationId: string): number {
    const owner = remoteUiGenerationOwner(ownerInput);
    if (!validGenerationId(generationId)) throw new TypeError("Remote UI generation retirement is invalid.");
    const key = remoteUiGenerationKey(owner, generationId);
    this.pendingRetirements.delete(key);
    const sessions = this.sessions.get(key);
    if (!sessions) return 0;
    const count = sessions.size;
    this.sessions.delete(key);
    for (const session of sessions) session.dispose("generation-retired");
    return count;
  }

  private drain(snapshot: RemoteUiGenerationSnapshot, drainMs: number): void {
    const key = remoteUiGenerationKey(snapshot, snapshot.generationId);
    const retirement = Symbol();
    this.pendingRetirements.set(key, retirement);
    this.schedule(() => {
      if (this.pendingRetirements.get(key) !== retirement) return;
      this.pendingRetirements.delete(key);
      if (this.active.get(remoteUiGenerationOwnerKey(snapshot))?.generationId !== snapshot.generationId) this.retire(snapshot, snapshot.generationId);
    }, drainMs);
  }

  private disposeOwner(owner: RemoteUiGenerationOwner, reason: "generation-retired" | "protocol-failure"): void {
    const prefix = `${remoteUiGenerationOwnerKey(owner)}\0`;
    for (const key of [...this.pendingRetirements.keys()]) if (key.startsWith(prefix)) this.pendingRetirements.delete(key);
    for (const [key, sessions] of [...this.sessions]) {
      if (!key.startsWith(prefix)) continue;
      this.sessions.delete(key);
      for (const session of sessions) session.dispose(reason);
    }
  }

  private unregister(session: RemoteUiHostSession): void {
    const key = remoteUiGenerationKey(session.identity, session.identity.generationId);
    const sessions = this.sessions.get(key);
    if (!sessions) return;
    sessions.delete(session);
    if (sessions.size === 0) this.sessions.delete(key);
  }
}

function remoteUiGenerationOwner(owner: RemoteUiGenerationOwner): RemoteUiGenerationOwner {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(owner.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(owner.environment) || !/^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(owner.appId)) throw new TypeError("Remote UI generation owner is invalid.");
  return Object.freeze({ applicationId: owner.applicationId, environment: owner.environment, appId: owner.appId });
}

function remoteUiGenerationSnapshot(snapshot: RemoteUiGenerationSnapshot): RemoteUiGenerationSnapshot {
  const owner = remoteUiGenerationOwner(snapshot);
  if (!validGenerationId(snapshot.generationId) || !/^sha256:[0-9a-f]{64}$/u.test(snapshot.artifactDigest) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || !["active", "disabled", "quarantined", "removed"].includes(snapshot.disposition)) throw new TypeError("Remote UI generation snapshot is invalid.");
  return Object.freeze({ ...owner, generationId: snapshot.generationId, artifactDigest: snapshot.artifactDigest, revision: snapshot.revision, disposition: snapshot.disposition });
}

function sameSnapshot(left: RemoteUiGenerationSnapshot, right: RemoteUiGenerationSnapshot): boolean {
  return left.applicationId === right.applicationId && left.environment === right.environment && left.appId === right.appId && left.generationId === right.generationId && left.artifactDigest === right.artifactDigest && left.revision === right.revision && left.disposition === right.disposition;
}

function validRecordId(value: string): boolean { return /^[a-z][a-z0-9-]{2,127}$/u.test(value); }
function validGenerationId(generationId: string): boolean { return validRecordId(generationId); }
function remoteUiGenerationOwnerKey(owner: RemoteUiGenerationOwner): string { return `${owner.applicationId}\0${owner.environment}\0${owner.appId}`; }
function remoteUiGenerationKey(owner: RemoteUiGenerationOwner, generationId: string): string { return `${remoteUiGenerationOwnerKey(owner)}\0${generationId}`; }

export function createOpaqueRemoteUiFrame(document: Document, session: RemoteUiHostSession, source: string, title: string, options: RemoteUiFrameOptions = {}): Readonly<{ iframe: HTMLIFrameElement; dispose(): void }> {
  const url = new URL(source, document.location.href);
  const expected = new URL(session.identity.remoteUiFrameUrl, document.location.href);
  const framePath = /^\/api\/extensions\/apps\/(app\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)\/assets\/([a-z][a-z0-9-]{2,127})\/sha256:[0-9a-f]{64}\/frame\.html$/u.exec(url.pathname);
  if (options.allowInsecureDevelopmentOrigin && session.identity.environment !== "development") throw new TypeError("Insecure Remote UI origins are permitted only for development.");
  const insecureDevelopmentOrigin = options.allowInsecureDevelopmentOrigin && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.href !== expected.href || (!insecureDevelopmentOrigin && url.protocol !== "https:") || url.origin === document.location.origin || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || framePath?.[1] !== session.identity.appId || framePath[2] !== session.identity.generationId) throw new TypeError("Remote UI frame URL must be a generation-pinned credentialless extension origin.");
  const iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.sandbox.add("allow-scripts");
  iframe.referrerPolicy = "no-referrer";
  iframe.setAttribute("allow", "");
  (iframe as HTMLIFrameElement & { credentialless: boolean }).credentialless = true;
  const channel = new MessageChannel();
  iframe.addEventListener("load", () => {
    session.start(channel.port1);
    if (iframe.contentWindow) iframe.contentWindow.postMessage({ schemaVersion: 1, type: "k-nex-connect" }, "*", [channel.port2]);
    else session.realmCrashed();
  }, { once: true });
  iframe.addEventListener("error", () => session.realmCrashed(), { once: true });
  iframe.src = url.href;
  session.bindRealmDisposer(() => iframe.remove());
  return Object.freeze({ iframe, dispose() { session.dispose(); } });
}
