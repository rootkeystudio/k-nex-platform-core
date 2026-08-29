import { createOpaqueRemoteUiFrame, RemoteUiHostSession, type RemoteUiComponentDefinition, type RemoteUiNode } from "@k-nex/ui-runtime";

declare global {
  interface Window {
    __K_NEX_REMOTE_FRAME_URL__: string;
    __K_NEX_REMOTE_HOSTILE_FRAME_URL__: string;
    __K_NEX_REMOTE_HOSTILE_FRAME_REJECTED__?: boolean;
    __K_NEX_REMOTE_READY__?: boolean;
    __K_NEX_REMOTE_PROBE__?: Record<string, string>;
    __K_NEX_REMOTE_WINDOW_MESSAGES__?: number;
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

let session: RemoteUiHostSession;
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

session = new RemoteUiHostSession({
  sessionId: "remote-session-1", actorSessionId: "actor-session-1", applicationId: "customer-alpha", environment: "production",
  appId: "app.sales-assistant", generationId: "sales-generation-1", remoteUiFrameUrl: window.__K_NEX_REMOTE_FRAME_URL__, route: "/apps/sales-assistant", surface: "sales.assistant-screen",
  sources: new Set(["sales.tasks"]), actions: new Set(["sales.refresh"]), routes: new Set(["/apps/sales-assistant"]), assets: new Set()
}, registry, {
  authorize: async () => true,
  render(tree) {
    root.replaceChildren(element(tree));
    const probe = root.querySelector<HTMLElement>("[data-node-id=probe]")?.textContent;
    if (probe) window.__K_NEX_REMOTE_PROBE__ = JSON.parse(probe) as Record<string, string>;
    window.__K_NEX_REMOTE_READY__ = true;
  },
  fallback(code) { root.replaceChildren(Object.assign(document.createElement("div"), { role: "alert", textContent: `Application unavailable: ${code}` })); },
  focus(nodeId) { root.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.focus(); },
  navigate(route) { history.pushState(null, "", route); },
  source: async (targetId) => ({ targetId, rows: 2 }),
  action: async (targetId) => ({ targetId, changed: true })
});
try {
  createOpaqueRemoteUiFrame(document, session, window.__K_NEX_REMOTE_HOSTILE_FRAME_URL__, "Hostile isolated application");
  throw new Error("Remote UI host accepted a hostile frame origin.");
} catch (error) {
  if (!(error instanceof TypeError)) throw error;
  window.__K_NEX_REMOTE_HOSTILE_FRAME_REJECTED__ = true;
}
const remote = createOpaqueRemoteUiFrame(document, session, window.__K_NEX_REMOTE_FRAME_URL__, "Sales assistant isolated application");
root.before(remote.iframe);
