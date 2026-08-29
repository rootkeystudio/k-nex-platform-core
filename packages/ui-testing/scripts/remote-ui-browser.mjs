import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";
import { chromium } from "playwright";
import { createRemoteUiFrameDocument, createRemoteUiWorkerBootstrapSource, remoteUiContentSecurityPolicy } from "@k-nex/extension-bundler";

const directory = await mkdtemp(join(tmpdir(), "k-nex-p9-remote-ui-"));
const csp = remoteUiContentSecurityPolicy;
let browser; let hostServer; let extensionServer;
let authenticatedFetches = 0; let extensionDocumentCookie = undefined;
const extensionRequests = [];
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const close = (server) => server === undefined ? Promise.resolve() : new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
try {
  await build({ entryPoints: [new URL("../tests/remote-ui-browser-entry.ts", import.meta.url).pathname], bundle: true, format: "esm", outfile: join(directory, "host.js") });
  const hostScript = await readFile(join(directory, "host.js"));

  hostServer = createServer((request, response) => {
    if (request.url === "/host.js") { response.writeHead(200, { "content-type": "text/javascript", "x-content-type-options": "nosniff" }); response.end(hostScript); return; }
    if (request.url === "/authenticated") { authenticatedFetches += 1; response.writeHead(200, { "content-type": "application/json" }); response.end('{"secret":true}'); return; }
    response.writeHead(404); response.end();
  });
  await listen(hostServer);
  const hostAddress = hostServer.address(); if (hostAddress === null || typeof hostAddress === "string") throw new Error("Remote UI host server failed.");
  const hostOrigin = `http://127.0.0.1:${hostAddress.port}`;

  const worker = `let port; let outgoing = 0; let incoming = 0;
const send = (type, body = {}) => port.postMessage({ schemaVersion: 1, sessionId: 'remote-session-1', appId: 'app.sales-assistant', generationId: 'sales-generation-1', sequence: ++outgoing, direction: 'realm-to-host', type, ...body });
const attempt = async (work) => { try { await work(); return 'available'; } catch { return 'blocked'; } };
async function probes() {
  const indexed = typeof indexedDB === 'undefined' ? 'unavailable' : await attempt(() => new Promise((resolve, reject) => { const request = indexedDB.open('probe'); request.onerror = reject; request.onupgradeneeded = () => request.transaction.abort(); request.onsuccess = () => { request.result.close(); resolve(); }; }));
  const cache = typeof caches === 'undefined' ? 'unavailable' : await attempt(() => caches.open('probe'));
  return {
    document: typeof document, window: typeof window, localStorage: typeof localStorage, sessionStorage: typeof sessionStorage, sharedWorker: typeof SharedWorker,
    serviceWorker: typeof navigator.serviceWorker, popup: typeof open, top: typeof top, indexedDB: indexed, cache,
    authenticatedFetch: await attempt(() => fetch('${hostOrigin}/authenticated', { credentials: 'include' })),
    websocket: typeof WebSocket === 'undefined' ? 'unavailable' : await attempt(() => new Promise((resolve, reject) => { const socket = new WebSocket('ws://127.0.0.1:9/probe'); socket.onopen = () => { socket.close(); resolve(); }; socket.onerror = reject; })),
    dynamicImport: await attempt(() => import('${hostOrigin}/host.js'))
  };
}
function tree(probe, status = 'Ready') { return { nodeId: 'root', component: 'stack', props: { gap: 'medium' }, events: [], children: [
  { nodeId: 'title', component: 'heading', props: { level: 1, text: 'Sales assistant' }, events: [], children: [] },
  { nodeId: 'probe', component: 'text', props: { text: JSON.stringify(probe) }, events: [], children: [] },
  { nodeId: 'status', component: 'text', props: { text: status }, events: [], children: [] },
  { nodeId: 'refresh', component: 'button', props: { label: 'Refresh sales tasks' }, events: [{ event: 'press', handlerId: 'sales.refresh' }], children: [] },
  { nodeId: 'break', component: 'button', props: { label: 'Trigger invalid application tree' }, events: [{ event: 'press', handlerId: 'sales.break' }], children: [] }
] }; }
self.onmessage = async (event) => {
  if (event.data?.type !== 'connect' || !event.ports?.[0]) return;
  port = event.ports[0]; self.onmessage = null;
  port.onmessage = async ({ data }) => {
    if (data.sequence !== ++incoming || data.appId !== 'app.sales-assistant' || data.generationId !== 'sales-generation-1') return;
    if (data.type === 'bootstrap') { const probe = await probes(); self.__probe = probe; send('ready'); send('render', { root: tree(probe) }); send('focus', { nodeId: 'refresh' }); }
    else if (data.type === 'event' && data.handlerId === 'sales.refresh') send('request', { operation: 'source', requestId: 'source-request-1', targetId: 'sales.tasks', input: {} });
    else if (data.type === 'event' && data.handlerId === 'sales.break') send('render', { root: { ...tree(self.__probe), component: 'script' } });
    else if (data.type === 'response-ok') send('render', { root: tree(self.__probe, 'Loaded ' + data.output.rows + ' tasks') });
    else if (data.type === 'dispose') close();
  };
  port.start();
};`;
  const bootstrap = createRemoteUiWorkerBootstrapSource(worker);
  const bootstrapIntegrity = `sha256-${createHash("sha256").update(bootstrap).digest("base64")}`;
  const bootstrapDigest = `sha256:${createHash("sha256").update(bootstrap).digest("hex")}`;
  const bootstrapPath = `/api/extensions/apps/app.sales-assistant/assets/sales-generation-1/${bootstrapDigest}/bootstrap.js`;
  const framePath = `/api/extensions/apps/app.sales-assistant/assets/sales-generation-1/${bootstrapDigest}/frame.html`;
  const frameDocument = createRemoteUiFrameDocument(bootstrapPath, bootstrapIntegrity);

  extensionServer = createServer((request, response) => {
    extensionRequests.push(request.url);
    const headers = { "access-control-allow-origin": "null", "content-security-policy": csp, "cross-origin-resource-policy": "cross-origin", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
    if (request.url === framePath) {
      extensionDocumentCookie = request.headers.cookie;
      response.writeHead(frameDocument.status, frameDocument.headers);
      response.end(frameDocument.body); return;
    }
    if (request.url === bootstrapPath) { response.writeHead(200, { ...headers, "content-type": "text/javascript", "cache-control": "public,max-age=31536000,immutable" }); response.end(bootstrap); return; }
    response.writeHead(404); response.end();
  });
  await listen(extensionServer);
  const extensionAddress = extensionServer.address(); if (extensionAddress === null || typeof extensionAddress === "string") throw new Error("Remote UI extension server failed.");
  const extensionOrigin = `http://127.0.0.1:${extensionAddress.port}`;
  const frameUrl = `${extensionOrigin}${framePath}`;
  const hostileFrameUrl = `${extensionOrigin.replace(/:\d+$/u, ":1")}${framePath}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Remote UI proof</title></head><body><main id="root"></main><script>window.__K_NEX_REMOTE_FRAME_URL__=${JSON.stringify(frameUrl)};window.__K_NEX_REMOTE_HOSTILE_FRAME_URL__=${JSON.stringify(hostileFrameUrl)}</script><script type="module" src="/host.js"></script></body></html>`;
  hostServer.removeAllListeners("request");
  hostServer.on("request", (request, response) => {
    if (request.url === "/host.js") { response.writeHead(200, { "content-type": "text/javascript", "x-content-type-options": "nosniff" }); response.end(hostScript); return; }
    if (request.url === "/authenticated") { authenticatedFetches += 1; response.writeHead(200, { "content-type": "application/json" }); response.end('{"secret":true}'); return; }
    response.writeHead(200, { "content-type": "text/html", "set-cookie": "customer_session=protected; HttpOnly; SameSite=Lax" }); response.end(html);
  });

  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([{ name: "extension_cookie", value: "must-not-be-sent", url: extensionOrigin }]);
  const page = await context.newPage();
  const pageErrors = []; const browserDiagnostics = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => browserDiagnostics.push(`${message.type()}:${message.text()}`));
  page.on("requestfailed", (request) => browserDiagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(hostOrigin);
  await page.waitForFunction(() => window.__K_NEX_REMOTE_READY__ === true).catch((error) => { throw new Error(`Remote UI did not become ready: ${error.message}; requests=${extensionRequests.join(",")}; page=${pageErrors.join(" | ")}; browser=${browserDiagnostics.join(" | ")}`); });
  const probe = await page.evaluate(() => window.__K_NEX_REMOTE_PROBE__);
  assert.deepEqual(probe, {
    document: "undefined", window: "undefined", localStorage: "undefined", sessionStorage: "undefined", sharedWorker: "undefined", serviceWorker: "undefined", popup: "undefined", top: "undefined",
    indexedDB: "blocked", cache: "unavailable", authenticatedFetch: "blocked", websocket: "blocked", dynamicImport: "blocked"
  });
  assert.equal(extensionDocumentCookie, undefined, "credentialless iframe sent extension-origin cookies");
  assert.equal(await page.evaluate(() => window.__K_NEX_REMOTE_HOSTILE_FRAME_REJECTED__), true, "remote UI host accepted a hostile same-path frame origin");
  assert.equal(authenticatedFetches, 0, "remote realm reached an authenticated host endpoint");
  assert.equal(await page.evaluate(() => window.__K_NEX_REMOTE_WINDOW_MESSAGES__), 0, "remote app used ambient window messaging after channel transfer");
  assert.match(await page.getByRole("heading", { name: "Sales assistant" }).ariaSnapshot(), /heading "Sales assistant" \[level=1\]/);
  const refresh = page.getByRole("button", { name: "Refresh sales tasks" });
  assert.equal(await refresh.evaluate((element) => element === document.activeElement), true, "host-owned focus request did not target the semantic control");
  await refresh.click();
  await page.getByText("Loaded 2 tasks").waitFor();
  await page.getByRole("button", { name: "Trigger invalid application tree" }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent(), /PROTOCOL_FAILURE/u);
  assert.deepEqual(pageErrors, []);
  await context.close();
  process.stdout.write("P9_REMOTE_UI_BROWSER_PASS\n");
} finally {
  await browser?.close();
  await close(hostServer); await close(extensionServer);
  await rm(directory, { recursive: true, force: true });
}
