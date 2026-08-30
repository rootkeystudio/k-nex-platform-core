import { canonicalJson, RemoteUiFrameSchema, remoteUiCeilings, type JsonValue, type RemoteUiFrame, type RemoteUiNode } from "@k-nex/contracts";

export interface RemoteUiComponentDefinition {
  readonly events: ReadonlySet<"press" | "change" | "submit" | "selection-change">;
  validateProps(props: Readonly<Record<string, JsonValue>>, context: Readonly<{ assets: ReadonlySet<string> }>): void;
}

export interface RemoteUiSessionIdentity {
  readonly sessionId: string;
  readonly actorSessionId: string;
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
  /** Host-authorized, verified, generation-pinned frame document URL. */
  readonly remoteUiFrameUrl: string;
  readonly route: string;
  readonly surface: string;
  readonly sources: ReadonlySet<string>;
  readonly actions: ReadonlySet<string>;
  readonly routes: ReadonlySet<string>;
  readonly assets: ReadonlySet<string>;
}

export interface RemoteUiGenerationOwner {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
}

export interface RemoteUiHostAdapter {
  authorize(identity: RemoteUiSessionIdentity, frame: RemoteUiFrame): boolean | Promise<boolean>;
  render(root: RemoteUiNode): void | Promise<void>;
  fallback(code: "APP_FAILURE" | "PROTOCOL_FAILURE" | "UNAUTHORIZED"): void | Promise<void>;
  focus(nodeId: string): void | Promise<void>;
  navigate(route: string): void | Promise<void>;
  source(targetId: string, input: JsonValue): JsonValue | Promise<JsonValue>;
  action(targetId: string, input: JsonValue): JsonValue | Promise<JsonValue>;
}

export interface RemoteUiFrameOptions {
  readonly allowInsecureDevelopmentOrigin?: boolean;
}

export class RemoteUiProtocolError extends Error {
  constructor(readonly code: "FRAME_INVALID" | "IDENTITY_MISMATCH" | "SEQUENCE_INVALID" | "BUDGET_EXCEEDED" | "COMPONENT_DENIED" | "PROP_INVALID" | "EVENT_DENIED" | "TARGET_DENIED" | "UNAUTHORIZED" | "SESSION_CLOSED", message: string) {
    super(message);
    this.name = "RemoteUiProtocolError";
  }
}

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

  constructor(
    readonly identity: RemoteUiSessionIdentity,
    private readonly registry: ReadonlyMap<string, RemoteUiComponentDefinition>,
    private readonly adapter: RemoteUiHostAdapter,
    private readonly now: () => number = Date.now
  ) {}

  start(port: MessagePort): void {
    if (this.port || this.closed) fail("SESSION_CLOSED", "Remote UI session cannot be started.");
    this.port = port;
    port.addEventListener("message", (event) => {
      this.queue = this.queue.then(() => this.receive(event.data)).catch((error) => this.protocolFailure(error));
    });
    port.start();
    this.send("bootstrap", { actorSessionId: this.identity.actorSessionId, route: this.identity.route, surface: this.identity.surface });
  }

  /** The host owns the realm lifecycle; any terminal session state must tear it down. */
  bindRealmDisposer(dispose: () => void): void {
    if (this.realmDisposer || this.closed) fail("SESSION_CLOSED", "Remote UI realm cannot be bound after session closure.");
    this.realmDisposer = dispose;
  }

  dispatchEvent(nodeId: string, event: "press" | "change" | "submit" | "selection-change", payload: JsonValue): void {
    const binding = this.nodes.get(nodeId)?.events.find((candidate) => candidate.event === event);
    if (!binding) fail("EVENT_DENIED", "Remote UI event is not bound by the active tree.");
    this.send("event", { nodeId, event, handlerId: binding.handlerId, payload });
  }

  dispose(reason: "generation-retired" | "session-ended" | "protocol-failure" = "session-ended"): void {
    if (this.closed) return;
    if (this.port) this.send("dispose", { reason });
    this.closed = true;
    this.nodes = new Map();
    this.port?.close();
    const disposeRealm = this.realmDisposer;
    this.realmDisposer = undefined;
    disposeRealm?.();
  }

  private async receive(value: unknown): Promise<void> {
    if (this.closed) fail("SESSION_CLOSED", "Remote UI session is closed.");
    if (bytes(value) > remoteUiCeilings.canonicalBytes) fail("BUDGET_EXCEEDED", "Remote UI frame exceeds its byte budget.");
    const parsed = RemoteUiFrameSchema.safeParse(value);
    if (!parsed.success || parsed.data.direction !== "realm-to-host") fail("FRAME_INVALID", "Remote UI realm frame is invalid.");
    const frame = parsed.data;
    if (frame.sessionId !== this.identity.sessionId || frame.appId !== this.identity.appId || frame.generationId !== this.identity.generationId) fail("IDENTITY_MISMATCH", "Remote UI frame identity does not match the session.");
    if (frame.sequence !== this.incomingSequence + 1) fail("SEQUENCE_INVALID", "Remote UI sequence is missing or replayed.");
    this.incomingSequence = frame.sequence;
    this.enforceRate();
    if (!await this.adapter.authorize(this.identity, frame)) {
      await this.adapter.fallback("UNAUTHORIZED");
      fail("UNAUTHORIZED", "Remote UI frame is not authorized.");
    }
    if (frame.type === "ready") return;
    if (frame.type === "render") {
      this.nodes = validateTree(frame.root, this.registry, this.identity.assets);
      await this.adapter.render(frame.root);
      return;
    }
    if (frame.type === "focus") {
      if (!this.nodes.has(frame.nodeId)) fail("TARGET_DENIED", "Remote UI focus target is not active.");
      await this.adapter.focus(frame.nodeId);
      return;
    }
    if (frame.type === "navigate") {
      if (!this.identity.routes.has(frame.route)) fail("TARGET_DENIED", "Remote UI route is not declared.");
      await this.adapter.navigate(frame.route);
      return;
    }
    if (frame.type === "failure") {
      await this.adapter.fallback("APP_FAILURE");
      this.dispose("protocol-failure");
      return;
    }
    const allowed = frame.operation === "source" ? this.identity.sources : this.identity.actions;
    if (!allowed.has(frame.targetId)) fail("TARGET_DENIED", "Remote UI data target is not declared.");
    try {
      const output = await (frame.operation === "source" ? this.adapter.source(frame.targetId, frame.input) : this.adapter.action(frame.targetId, frame.input));
      this.send("response-ok", { requestId: frame.requestId, output });
    } catch {
      this.send("response-error", { requestId: frame.requestId, code: "REQUEST_FAILED" });
    }
  }

  private send(type: "bootstrap" | "event" | "response-ok" | "response-error" | "dispose", body: Record<string, unknown>): void {
    if (!this.port || (this.closed && type !== "dispose")) fail("SESSION_CLOSED", "Remote UI session is not connected.");
    const frame = RemoteUiFrameSchema.parse({
      schemaVersion: 1, sessionId: this.identity.sessionId, appId: this.identity.appId, generationId: this.identity.generationId,
      sequence: ++this.outgoingSequence, direction: "host-to-realm", type, ...body
    });
    if (bytes(frame) > remoteUiCeilings.canonicalBytes) fail("BUDGET_EXCEEDED", "Remote UI host frame exceeds its byte budget.");
    this.port.postMessage(frame);
  }

  private enforceRate(): void {
    const cutoff = this.now() - 60_000;
    while (this.requestTimes[0] !== undefined && this.requestTimes[0] <= cutoff) this.requestTimes.shift();
    if (this.requestTimes.length >= remoteUiCeilings.callsPerMinute) fail("BUDGET_EXCEEDED", "Remote UI frame rate exceeds its budget.");
    this.requestTimes.push(this.now());
  }

  private async protocolFailure(error: unknown): Promise<void> {
    if (this.closed) return;
    if (!(error instanceof RemoteUiProtocolError && error.code === "UNAUTHORIZED")) await this.adapter.fallback("PROTOCOL_FAILURE");
    this.dispose("protocol-failure");
  }
}

export class RemoteUiGenerationSessions {
  private readonly active = new Map<string, string>();
  private readonly sessions = new Map<string, Set<RemoteUiHostSession>>();
  private readonly pendingRetirements = new Map<string, symbol>();

  constructor(private readonly schedule: (work: () => void, delayMs: number) => unknown = setTimeout) {}

  activate(ownerInput: RemoteUiGenerationOwner, generationId: string, drainMs: number): void {
    const owner = remoteUiGenerationOwner(ownerInput);
    if (!validGenerationId(generationId) || !Number.isSafeInteger(drainMs) || drainMs < 1 || drainMs > 30_000) throw new TypeError("Remote UI generation activation is invalid.");
    const key = remoteUiGenerationOwnerKey(owner);
    const previous = this.active.get(key);
    this.active.set(key, generationId);
    this.pendingRetirements.delete(remoteUiGenerationKey(owner, generationId));
    if (previous !== undefined && previous !== generationId) {
      const previousKey = remoteUiGenerationKey(owner, previous);
      const retirement = Symbol();
      this.pendingRetirements.set(previousKey, retirement);
      this.schedule(() => {
        if (this.pendingRetirements.get(previousKey) !== retirement) return;
        this.pendingRetirements.delete(previousKey);
        if (this.active.get(key) !== previous) this.retire(owner, previous);
      }, drainMs);
    }
  }

  admit(session: RemoteUiHostSession): void {
    const owner = remoteUiGenerationOwner(session.identity);
    if (!validGenerationId(session.identity.generationId)) fail("IDENTITY_MISMATCH", "Remote UI session generation is invalid.");
    if (this.active.get(remoteUiGenerationOwnerKey(owner)) !== session.identity.generationId) fail("IDENTITY_MISMATCH", "New Remote UI sessions require the active generation.");
    const key = remoteUiGenerationKey(owner, session.identity.generationId);
    const sessions = this.sessions.get(key) ?? new Set<RemoteUiHostSession>();
    sessions.add(session);
    this.sessions.set(key, sessions);
  }

  retire(ownerInput: RemoteUiGenerationOwner, generationId: string): number {
    const owner = remoteUiGenerationOwner(ownerInput);
    if (!validGenerationId(generationId)) throw new TypeError("Remote UI generation retirement is invalid.");
    const key = remoteUiGenerationKey(owner, generationId);
    this.pendingRetirements.delete(key);
    const sessions = this.sessions.get(key);
    if (!sessions) return 0;
    for (const session of sessions) session.dispose("generation-retired");
    this.sessions.delete(key);
    return sessions.size;
  }
}

function remoteUiGenerationOwner(owner: RemoteUiGenerationOwner): RemoteUiGenerationOwner {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(owner.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(owner.environment) || !/^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(owner.appId)) {
    throw new TypeError("Remote UI generation owner is invalid.");
  }
  return Object.freeze({ applicationId: owner.applicationId, environment: owner.environment, appId: owner.appId });
}

function validGenerationId(generationId: string): boolean {
  return /^[a-z][a-z0-9-]{2,127}$/u.test(generationId);
}

function remoteUiGenerationOwnerKey(owner: RemoteUiGenerationOwner): string {
  return `${owner.applicationId}\0${owner.environment}\0${owner.appId}`;
}

function remoteUiGenerationKey(owner: RemoteUiGenerationOwner, generationId: string): string {
  return `${remoteUiGenerationOwnerKey(owner)}\0${generationId}`;
}

export function createOpaqueRemoteUiFrame(document: Document, session: RemoteUiHostSession, source: string, title: string, options: RemoteUiFrameOptions = {}): Readonly<{ iframe: HTMLIFrameElement; dispose(): void }> {
  const url = new URL(source, document.location.href);
  const expected = new URL(session.identity.remoteUiFrameUrl, document.location.href);
  const framePath = /^\/api\/extensions\/apps\/(app\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)\/assets\/([a-z][a-z0-9-]{2,127})\/sha256:[0-9a-f]{64}\/frame\.html$/u.exec(url.pathname);
  if (options.allowInsecureDevelopmentOrigin && session.identity.environment !== "development") {
    throw new TypeError("Insecure Remote UI origins are permitted only for development.");
  }
  const insecureDevelopmentOrigin = options.allowInsecureDevelopmentOrigin && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.href !== expected.href || (!insecureDevelopmentOrigin && url.protocol !== "https:") || url.origin === document.location.origin || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || framePath?.[1] !== session.identity.appId || framePath[2] !== session.identity.generationId) {
    throw new TypeError("Remote UI frame URL must be a generation-pinned credentialless extension origin.");
  }
  const iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.sandbox.add("allow-scripts");
  iframe.referrerPolicy = "no-referrer";
  iframe.setAttribute("allow", "");
  (iframe as HTMLIFrameElement & { credentialless: boolean }).credentialless = true;
  const channel = new MessageChannel();
  iframe.addEventListener("load", () => {
    session.start(channel.port1);
    iframe.contentWindow?.postMessage({ schemaVersion: 1, type: "k-nex-connect" }, "*", [channel.port2]);
  }, { once: true });
  iframe.src = url.href;
  session.bindRealmDisposer(() => iframe.remove());
  return Object.freeze({ iframe, dispose() { session.dispose(); } });
}
