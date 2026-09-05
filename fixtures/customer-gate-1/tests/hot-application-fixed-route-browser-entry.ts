import { createOpaqueRemoteUiFrame, RemoteUiGenerationSessions, type RemoteUiComponentDefinition, type RemoteUiGenerationSnapshot, type RemoteUiHostSession, type RemoteUiNode } from "@k-nex/ui-runtime";

declare global {
  interface Window {
    __K_NEX_HOT_APPLICATION_ROUTE__: Readonly<{ applicationId: string; environment: "production"; appId: string; generationId: string; artifactDigest: string; revision: number; authorizationRevision: number; authorizationProof: string; sessionId: string; route: string; routes: readonly string[]; sources: readonly string[]; actions: readonly string[]; remoteUiFrameUrl: string; snapshotUrl: string; sourceUrl: string; drainMs: number }>;
    __K_NEX_HOT_APPLICATION_ROUTE_SESSION__?: Readonly<{ appId: string; generationId: string; route: string }>;
    __K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__?: readonly Readonly<{ source: "snapshot-poll"; observedAt: number; generationId: string; revision: number; disposition: string; retirementScheduled: boolean; retirementCancelled: boolean }>[];
    __K_NEX_TEST_ROUTE_LIFECYCLE_CONTROL__?: Readonly<{ pause(): Promise<void>; pollOnce(): Promise<void>; resume(): void }>;
  }
}

const configuration = window.__K_NEX_HOT_APPLICATION_ROUTE__;
const root = document.querySelector<HTMLElement>("#hot-application-route");
if (!root) throw new Error("Fixed Hot Application route has no authorized host surface.");

const registry = new Map<string, RemoteUiComponentDefinition>([
  ["stack", { events: new Set(), validateProps(props) { if (Object.keys(props).length !== 0) throw new Error("Invalid remote stack."); } }],
  ["heading", { events: new Set(), validateProps(props) { if (Object.keys(props).sort().join("\0") !== "level\0text" || !Number.isSafeInteger(props.level) || typeof props.text !== "string") throw new Error("Invalid remote heading."); } }],
  ["button", { events: new Set(["press"] as const), validateProps(props) { if (Object.keys(props).join("\0") !== "label" || typeof props.label !== "string") throw new Error("Invalid remote button."); } }]
]);

const sessions = new RemoteUiGenerationSessions();
const snapshot: RemoteUiGenerationSnapshot = Object.freeze({
  applicationId: configuration.applicationId, environment: configuration.environment, appId: configuration.appId,
  generationId: configuration.generationId, artifactDigest: configuration.artifactDigest, revision: configuration.revision, disposition: "active"
});
sessions.observe(snapshot, configuration.drainMs);
sessions.admitAuthorization({
  applicationId: configuration.applicationId,
  environment: configuration.environment,
  authorizationRevision: configuration.authorizationRevision,
  authorizationProof: configuration.authorizationProof
});
const lifecycleObservations: Readonly<{ source: "snapshot-poll"; observedAt: number; generationId: string; revision: number; disposition: string; retirementScheduled: boolean; retirementCancelled: boolean }>[] = [];
Object.defineProperty(window, "__K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__", {
  enumerable: false,
  configurable: false,
  get: () => Object.freeze([...lifecycleObservations])
});

let activeSession: RemoteUiHostSession | undefined;
let authorizationRevision = configuration.authorizationRevision;
let freshAdmissionRequested = false;
let pollTimer: number | undefined;
const inFlightPolls = new Set<Promise<void>>();
function renderNode(node: RemoteUiNode): HTMLElement {
  if (node.component === "stack") {
    const element = document.createElement("div");
    element.replaceChildren(...node.children.map(renderNode));
    return element;
  }
  if (node.component === "heading") {
    const element = document.createElement(`h${node.props.level}`);
    element.textContent = String(node.props.text);
    return element;
  }
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = String(node.props.label);
  element.addEventListener("click", () => activeSession?.dispatchEvent(node.nodeId, "press", null));
  return element;
}

const session = sessions.open(snapshot, {
  sessionId: configuration.sessionId, remoteUiFrameUrl: configuration.remoteUiFrameUrl, route: configuration.route, surface: "sales.screen",
  sources: new Set(configuration.sources), actions: new Set(configuration.actions), routes: new Set(configuration.routes), assets: new Set(),
  presentation: { profileRevisionId: "sales-admin-profile-1", themeId: "theme.default", themeVersion: "1.0.0", surface: "admin", mode: "system" }
}, registry, {
  async authorize(_identity, _frame, signal) {
    const query = new URLSearchParams({ sessionId: configuration.sessionId });
    const response = await fetch(`/api/extensions/remote-ui/authorize?${query}`, { method: "POST", credentials: "same-origin", cache: "no-store", signal });
    return response.status === 204;
  },
  async authorizeTarget(_identity, operation, targetId, signal) {
    const query = new URLSearchParams({ operation, targetId, sessionId: configuration.sessionId });
    const response = await fetch(`/api/extensions/remote-ui/authorize-target?${query}`, { method: "POST", credentials: "same-origin", cache: "no-store", signal });
    return response.status === 204;
  },
  render(tree: RemoteUiNode, presentation) { root.dataset.kNexThemeProfile = presentation.profileRevisionId; root.replaceChildren(renderNode(tree)); },
  fallback(code) { root.replaceChildren(Object.assign(document.createElement("div"), { role: "alert", textContent: code })); },
  focus() {}, navigate() {},
  async source(identity, targetId, input, signal) {
    const response = await fetch(configuration.sourceUrl, {
      method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: configuration.sessionId, identity, targetId, input })
    });
    if (response.status !== 200) throw new Error("Remote UI source is no longer authorized for its admitted generation.");
    return (await response.json()).output;
  },
  action() { throw new Error("The fixed fixture declares no remote actions."); }
});
activeSession = session;
const remote = createOpaqueRemoteUiFrame(document, session, configuration.remoteUiFrameUrl, "Sales live");
root.before(remote.iframe);
window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__ = Object.freeze({ appId: configuration.appId, generationId: configuration.generationId, route: configuration.route });

function requestFreshAdmission(revision: number): void {
  if (freshAdmissionRequested) return;
  freshAdmissionRequested = true;
  if (pollTimer !== undefined) clearInterval(pollTimer);
  activeSession?.dispose("authorization-revoked");
  activeSession = undefined;
  sessions.revokeAuthorization({ applicationId: configuration.applicationId, environment: configuration.environment, authorizationRevision: revision });
  remote.dispose();
  window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__ = undefined;
  root.replaceChildren();
  window.location.reload();
}

const poll = async (): Promise<void> => {
  const response = await fetch(configuration.snapshotUrl, { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401 || response.status === 403) {
    const revision = Number(response.headers.get("x-k-nex-authorization-revision"));
    requestFreshAdmission(Number.isSafeInteger(revision) && revision >= 0 ? revision : authorizationRevision);
    return;
  }
  if (response.status !== 200) {
    return;
  }
  const observed = await response.json() as RemoteUiGenerationSnapshot & Readonly<{ authorizationRevision: number; authorizationProof: string }>;
  if (observed.authorizationRevision > authorizationRevision) {
    requestFreshAdmission(observed.authorizationRevision);
    return;
  }
  const retirementScheduled = observed.disposition === "active" && observed.generationId !== configuration.generationId;
  const retirementCancelled = observed.disposition === "active" && observed.generationId === configuration.generationId && lifecycleObservations.some((entry) => entry.retirementScheduled);
  sessions.observe(observed, configuration.drainMs);
  lifecycleObservations.push(Object.freeze({ source: "snapshot-poll", observedAt: Date.now(), generationId: observed.generationId, revision: observed.revision, disposition: observed.disposition, retirementScheduled, retirementCancelled }));
};

function startPolling(): void {
  if (pollTimer !== undefined) return;
  pollTimer = window.setInterval(() => { void runPoll(); }, 100);
}

function runPoll(): Promise<void> {
  const inFlight = poll();
  inFlightPolls.add(inFlight);
  void inFlight.then(() => { inFlightPolls.delete(inFlight); }, () => { inFlightPolls.delete(inFlight); });
  return inFlight;
}

async function pausePolling(): Promise<void> {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
  await Promise.all([...inFlightPolls]);
}

Object.defineProperty(window, "__K_NEX_TEST_ROUTE_LIFECYCLE_CONTROL__", {
  enumerable: false,
  configurable: false,
  value: Object.freeze({ pause: pausePolling, pollOnce: runPoll, resume: startPolling })
});
startPolling();
void runPoll();
addEventListener("pagehide", () => { void pausePolling(); remote.dispose(); }, { once: true });
