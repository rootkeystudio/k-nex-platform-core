import { createOpaqueRemoteUiFrame, RemoteUiGenerationSessions, type RemoteUiComponentDefinition, type RemoteUiGenerationSnapshot, type RemoteUiNode } from "@k-nex/ui-runtime";

declare global {
  interface Window {
    __K_NEX_REMOTE_FRAME_URL__: string;
    __K_NEX_REMOTE_HOSTILE_FRAME_URL__: string;
    __K_NEX_REMOTE_SNAPSHOT__: RemoteUiGenerationSnapshot;
    __K_NEX_REMOTE_HOSTILE_FRAME_REJECTED__?: boolean;
    __K_NEX_REMOTE_READY__?: boolean;
    __K_NEX_REMOTE_PROBE__?: Record<string, string>;
    __K_NEX_REMOTE_WINDOW_MESSAGES__?: number;
    __K_NEX_REMOTE_HEARTBEATS__?: number;
    __K_NEX_REMOTE_SOURCE_CALLS__?: number;
    __K_NEX_REMOTE_SOURCE_TARGETS__?: string[];
    __K_NEX_REMOTE_ACTION_CALLS__?: number;
  }
}

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Remote UI host root is unavailable.");
window.__K_NEX_REMOTE_WINDOW_MESSAGES__ = 0;
window.addEventListener("message", () => { window.__K_NEX_REMOTE_WINDOW_MESSAGES__! += 1; });

const exact = (props: Readonly<Record<string, unknown>>, keys: readonly string[]): void => {
  if (Object.keys(props).sort().join("\0") !== [...keys].sort().join("\0")) throw new Error("invalid props");
};
const registry = new Map<string, RemoteUiComponentDefinition>([
  ["stack", { events: new Set(), validateProps(props) { exact(props, ["gap"]); if (typeof props.gap !== "string") throw new Error(); } }],
  ["heading", { events: new Set(), validateProps(props) { exact(props, ["level", "text"]); if (!Number.isSafeInteger(props.level) || Number(props.level) < 1 || Number(props.level) > 6 || typeof props.text !== "string") throw new Error(); } }],
  ["text", { events: new Set(), validateProps(props) { exact(props, ["text"]); if (typeof props.text !== "string") throw new Error(); } }],
  ["button", { events: new Set(["press"]), validateProps(props) { exact(props, ["label"]); if (typeof props.label !== "string") throw new Error(); } }]
]);

let session: ReturnType<RemoteUiGenerationSessions["open"]>;
function element(node: RemoteUiNode): HTMLElement {
  let output: HTMLElement;
  if (node.component === "heading") output = document.createElement(`h${node.props.level}`) as HTMLElement;
  else if (node.component === "text") output = document.createElement("p");
  else if (node.component === "button") output = document.createElement("button");
  else output = document.createElement("section");
  output.dataset.nodeId = node.nodeId;
  if (node.component === "heading" || node.component === "text") output.textContent = String(node.props.text);
  if (node.component === "button") {
    output.textContent = String(node.props.label);
    output.addEventListener("click", () => session.dispatchEvent(node.nodeId, "press", null));
  }
  for (const child of node.children) output.append(element(child));
  return output;
}

const sessions = new RemoteUiGenerationSessions();
const snapshot = window.__K_NEX_REMOTE_SNAPSHOT__;
sessions.observe(snapshot, 100);
const authorize = async (_identity: unknown, _frame: unknown, signal?: AbortSignal): Promise<boolean> => {
  const response = await fetch("/api/extensions/remote-ui/authorize", { method: "POST", credentials: "same-origin", cache: "no-store", signal });
  return response.status === 204;
};
session = sessions.open(snapshot, {
  sessionId: "remote-session-1", remoteUiFrameUrl: window.__K_NEX_REMOTE_FRAME_URL__, route: "/apps/sales-assistant", surface: "sales.assistant-screen",
  sources: new Set(["sales.tasks", "sales.heartbeat"]), actions: new Set(["sales.refresh"]), routes: new Set(["/"]), assets: new Set()
}, registry, {
  authorize,
  render(tree) {
    root.replaceChildren(element(tree));
    const probe = root.querySelector<HTMLElement>("[data-node-id=probe]")?.textContent;
    if (probe) window.__K_NEX_REMOTE_PROBE__ = JSON.parse(probe) as Record<string, string>;
    window.__K_NEX_REMOTE_READY__ = true;
  },
  fallback(code) {
    const fallback = Object.assign(document.createElement("div"), { role: "alert", tabIndex: -1, textContent: `Application unavailable: ${code}` });
    root.replaceChildren(fallback);
    fallback.focus();
  },
  focus(nodeId) { root.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.focus(); },
  navigate(route) { history.pushState(null, "", route); },
  source: async (_identity, targetId) => { window.__K_NEX_REMOTE_SOURCE_CALLS__ = (window.__K_NEX_REMOTE_SOURCE_CALLS__ ?? 0) + 1; (window.__K_NEX_REMOTE_SOURCE_TARGETS__ ??= []).push(targetId); if (targetId === "sales.heartbeat") window.__K_NEX_REMOTE_HEARTBEATS__ = (window.__K_NEX_REMOTE_HEARTBEATS__ ?? 0) + 1; return { targetId, rows: 2 }; },
  action: async (_identity, targetId) => { window.__K_NEX_REMOTE_ACTION_CALLS__ = (window.__K_NEX_REMOTE_ACTION_CALLS__ ?? 0) + 1; return { targetId, changed: true }; }
});
try {
  createOpaqueRemoteUiFrame(document, session, window.__K_NEX_REMOTE_HOSTILE_FRAME_URL__, "Hostile isolated application");
  throw new Error("Remote UI host accepted a hostile frame origin.");
} catch (error) {
  if (!(error instanceof TypeError)) throw error;
  window.__K_NEX_REMOTE_HOSTILE_FRAME_REJECTED__ = true;
}
const remote = createOpaqueRemoteUiFrame(document, session, window.__K_NEX_REMOTE_FRAME_URL__, "Sales assistant isolated application");
remote.iframe.tabIndex = -1;
root.before(remote.iframe);
