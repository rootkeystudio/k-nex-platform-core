import { createOpaqueRemoteUiFrame, RemoteUiHostSession, type RemoteUiComponentDefinition, type RemoteUiNode } from "@k-nex/ui-runtime";

declare global {
  interface Window {
    __K_NEX_HOT_APPLICATION_ROUTE__: Readonly<{ applicationId: string; environment: string; appId: string; generationId: string; route: string; routes: readonly string[]; remoteUiFrameUrl: string; actorSessionId: string }>;
    __K_NEX_HOT_APPLICATION_ROUTE_SESSION__?: Readonly<{ appId: string; generationId: string; route: string; actorSessionId: string }>;
  }
}

const configuration = window.__K_NEX_HOT_APPLICATION_ROUTE__;
const root = document.querySelector<HTMLElement>("#hot-application-route");
if (!root || !configuration.actorSessionId) throw new Error("Fixed Hot Application route has no authorized host session.");

const registry = new Map<string, RemoteUiComponentDefinition>([["heading", {
  events: new Set(),
  validateProps(props) {
    if (Object.keys(props).sort().join("\0") !== "level\0text" || !Number.isSafeInteger(props.level) || typeof props.text !== "string") throw new Error("Invalid remote heading.");
  }
}]]);

const session = new RemoteUiHostSession({
  sessionId: `route-${configuration.generationId}`, actorSessionId: configuration.actorSessionId,
  applicationId: configuration.applicationId, environment: "development", appId: configuration.appId,
  generationId: configuration.generationId, remoteUiFrameUrl: configuration.remoteUiFrameUrl,
  route: configuration.route, surface: "sales.screen", sources: new Set(), actions: new Set(), routes: new Set(configuration.routes), assets: new Set()
}, registry, {
  authorize(identity) { return identity.actorSessionId === configuration.actorSessionId; },
  render(tree: RemoteUiNode) {
    const heading = document.createElement(`h${tree.props.level}`);
    heading.textContent = String(tree.props.text);
    root.replaceChildren(heading);
  },
  fallback(code) { root.replaceChildren(Object.assign(document.createElement("div"), { role: "alert", textContent: code })); },
  focus() {}, navigate() {}, source() { return null; }, action() { return null; }
});

const remote = createOpaqueRemoteUiFrame(document, session, configuration.remoteUiFrameUrl, "Sales live", { allowInsecureDevelopmentOrigin: true });
root.before(remote.iframe);
window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__ = Object.freeze({ appId: configuration.appId, generationId: configuration.generationId, route: configuration.route, actorSessionId: configuration.actorSessionId });
