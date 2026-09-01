import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { build } from "esbuild";
import { chromium } from "playwright";
import { createRemoteUiFrameDocument, createRemoteUiWorkerBootstrapSource, remoteUiContentSecurityPolicy } from "@k-nex/extension-bundler";

const directory = await mkdtemp(join(tmpdir(), "k-nex-p9-remote-ui-"));
const csp = remoteUiContentSecurityPolicy;
let browser; let hostServer; let extensionServer;
let authenticatedFetches = 0; let extensionDocumentCookie = undefined;
const authorizedSessions = new Set(["protected"]); let remoteUiAuthorizationChecks = 0;
const extensionRequests = [];
const run = promisify(execFile);
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const close = (server) => server === undefined ? Promise.resolve() : new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
try {
  const keyPath = join(directory, "key.pem");
  const certificatePath = join(directory, "certificate.pem");
  await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certificatePath, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"]);
  const tls = { key: await readFile(keyPath), cert: await readFile(certificatePath) };
  await build({ entryPoints: [new URL("../tests/remote-ui-browser-entry.ts", import.meta.url).pathname], bundle: true, format: "esm", outfile: join(directory, "host.js") });
  const hostScript = await readFile(join(directory, "host.js"));

  hostServer = createServer(tls, (request, response) => {
    if (request.url === "/host.js") { response.writeHead(200, { "content-type": "text/javascript", "x-content-type-options": "nosniff" }); response.end(hostScript); return; }
    if (request.url === "/authenticated") { authenticatedFetches += 1; response.writeHead(200, { "content-type": "application/json" }); response.end('{"secret":true}'); return; }
    response.writeHead(404); response.end();
  });
  await listen(hostServer);
  const hostAddress = hostServer.address(); if (hostAddress === null || typeof hostAddress === "string") throw new Error("Remote UI host server failed.");
  const hostOrigin = `https://127.0.0.1:${hostAddress.port}`;

  const worker = `export const remoteUiModuleProof = true;
let port; let outgoing = 0; let incoming = 0; let heartbeat;
const send = (type, body = {}) => port.postMessage({ schemaVersion: 1, sessionId: 'remote-session-1', appId: 'app.sales-assistant', generationId: 'sales-generation-1', sequence: ++outgoing, direction: 'realm-to-host', type, ...body });
const attempt = async (work) => { try { await work(); return 'available'; } catch { return 'blocked'; } };
async function probes() {
  const indexed = typeof indexedDB === 'undefined' ? 'unavailable' : await attempt(() => new Promise((resolve, reject) => { const request = indexedDB.open('probe'); request.onerror = reject; request.onupgradeneeded = () => request.transaction.abort(); request.onsuccess = () => { request.result.close(); resolve(); }; }));
  const cache = await attempt(() => caches.open('probe'));
  return {
    document: typeof document, window: typeof window, localStorage: typeof localStorage, sessionStorage: typeof sessionStorage, sharedWorker: typeof SharedWorker,
    serviceWorker: typeof navigator.serviceWorker, popup: typeof open, top: typeof top, indexedDB: indexed, cache,
    authenticatedFetch: await attempt(() => fetch('${hostOrigin}/authenticated', { credentials: 'include' })),
    websocket: typeof WebSocket === 'undefined' ? 'unavailable' : await attempt(() => new Promise((resolve, reject) => { const socket = new WebSocket('ws://127.0.0.1:9/probe'); socket.onopen = () => { socket.close(); resolve(); }; socket.onerror = reject; })),
    dynamicImport: await attempt(() => import('${hostOrigin}/host.js'))
  };
}
async function hostile(kind) {
  if (kind === 'oversized') { port.postMessage({ schemaVersion: 1, sessionId: 'remote-session-1', appId: 'app.sales-assistant', generationId: 'sales-generation-1', sequence: ++outgoing, direction: 'realm-to-host', type: 'ready', padding: 'x'.repeat(270000) }); return; }
  if (kind === 'depth') { let input = null; for (let depth = 0; depth < 32; depth += 1) input = [input]; send('request', { operation: 'source', requestId: 'hostile-depth', targetId: 'sales.tasks', input }); return; }
  if (kind === 'rate') { for (let frame = 0; frame < 300; frame += 1) send('ready'); return; }
  if (kind === 'replay') { const sequence = outgoing; port.postMessage({ schemaVersion: 1, sessionId: 'remote-session-1', appId: 'app.sales-assistant', generationId: 'sales-generation-1', sequence, direction: 'realm-to-host', type: 'ready' }); return; }
  if (kind === 'mixed-generation') { port.postMessage({ schemaVersion: 1, sessionId: 'remote-session-1', appId: 'app.sales-assistant', generationId: 'sales-generation-2', sequence: ++outgoing, direction: 'realm-to-host', type: 'request', operation: 'source', requestId: 'hostile-mixed', targetId: 'sales.tasks', input: {} }); return; }
  if (kind === 'navigation') { send('navigate', { route: '/apps/sales-assistant/hostile' }); return; }
  if (kind === 'download') { await attempt(() => fetch(new URL('/download', self.location.href))); send('request', { operation: 'source', requestId: 'hostile-download', targetId: 'sales.download', input: {} }); }
}
function tree(probe, status = 'Ready') { return { nodeId: 'root', component: 'stack', props: { gap: 'medium' }, events: [], children: [
  { nodeId: 'title', component: 'heading', props: { level: 1, text: 'Sales assistant' }, events: [], children: [] },
  { nodeId: 'probe', component: 'text', props: { text: JSON.stringify(probe) }, events: [], children: [] },
  { nodeId: 'status', component: 'text', props: { text: status }, events: [], children: [] },
  { nodeId: 'refresh', component: 'button', props: { label: 'Refresh sales tasks' }, events: [{ event: 'press', handlerId: 'sales.refresh' }], children: [] },
  { nodeId: 'pause', component: 'button', props: { label: 'Pause sales heartbeat' }, events: [{ event: 'press', handlerId: 'sales.pause-heartbeat' }], children: [] },
  { nodeId: 'break', component: 'button', props: { label: 'Trigger invalid application tree' }, events: [{ event: 'press', handlerId: 'sales.break' }], children: [] },
  { nodeId: 'crash', component: 'button', props: { label: 'Report application runtime crash' }, events: [{ event: 'press', handlerId: 'sales.runtime-crash' }], children: [] },
  ...['oversized', 'depth', 'rate', 'replay', 'mixed-generation', 'navigation', 'download'].map((kind) => ({ nodeId: 'attack-' + kind, component: 'button', props: { label: 'Hostile ' + kind }, events: [{ event: 'press', handlerId: 'sales.attack.' + kind }], children: [] }))
] }; }
self.onmessage = async (event) => {
  if (event.data?.type !== 'connect' || !event.ports?.[0]) return;
  port = event.ports[0]; self.onmessage = null;
  port.onmessage = async ({ data }) => {
    if (data.sequence !== ++incoming || data.appId !== 'app.sales-assistant' || data.generationId !== 'sales-generation-1') return;
    if (data.type === 'bootstrap') { const probe = { ...(await probes()), bootstrapCredentials: /cookie|token|credential|actor/i.test(JSON.stringify(data)) ? 'exposed' : 'absent' }; self.__probe = probe; send('ready'); send('render', { root: tree(probe) }); send('focus', { nodeId: 'refresh' }); heartbeat = setInterval(() => send('request', { operation: 'source', requestId: 'heartbeat-' + outgoing, targetId: 'sales.heartbeat', input: {} }), 20); }
    else if (data.type === 'event' && data.handlerId === 'sales.refresh') send('request', { operation: 'source', requestId: 'source-request-1', targetId: 'sales.tasks', input: {} });
    else if (data.type === 'event' && data.handlerId === 'sales.pause-heartbeat') clearInterval(heartbeat);
    else if (data.type === 'event' && data.handlerId === 'sales.break') send('render', { root: { ...tree(self.__probe), component: 'script' } });
    else if (data.type === 'event' && data.handlerId === 'sales.runtime-crash') { send('failure', { code: 'APP_EVENT_FAILED' }); clearInterval(heartbeat); close(); }
    else if (data.type === 'event' && data.handlerId.startsWith('sales.attack.')) hostile(data.handlerId.slice('sales.attack.'.length));
    else if (data.type === 'response-ok' && data.requestId === 'source-request-1') send('render', { root: tree(self.__probe, 'Loaded ' + data.output.rows + ' tasks') });
    else if (data.type === 'dispose') { clearInterval(heartbeat); close(); }
  };
  port.start();
};`;
  const bootstrap = createRemoteUiWorkerBootstrapSource(worker);
  const bootstrapIntegrity = `sha256-${createHash("sha256").update(bootstrap).digest("base64")}`;
  const bootstrapDigest = `sha256:${createHash("sha256").update(bootstrap).digest("hex")}`;
  const bootstrapPath = `/api/extensions/apps/app.sales-assistant/assets/sales-generation-1/${bootstrapDigest}/bootstrap.js`;
  const framePath = `/api/extensions/apps/app.sales-assistant/assets/sales-generation-1/${bootstrapDigest}/frame.html`;
  const frameDocument = createRemoteUiFrameDocument(bootstrapPath, bootstrapIntegrity);

  extensionServer = createServer(tls, (request, response) => {
    extensionRequests.push(request.url);
    const headers = { "access-control-allow-origin": "null", "content-security-policy": csp, "cross-origin-resource-policy": "cross-origin", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
    if (request.url === framePath) {
      extensionDocumentCookie = request.headers.cookie;
      response.writeHead(frameDocument.status, frameDocument.headers);
      response.end(frameDocument.body); return;
    }
    if (request.url === "/download") { response.writeHead(200, { "content-disposition": "attachment; filename=hostile.txt", "content-type": "text/plain" }); response.end("hostile"); return; }
    if (request.url === bootstrapPath) { response.writeHead(200, { ...headers, "content-type": "text/javascript", "cache-control": "public,max-age=31536000,immutable" }); response.end(bootstrap); return; }
    response.writeHead(404); response.end();
  });
  await listen(extensionServer);
  const extensionAddress = extensionServer.address(); if (extensionAddress === null || typeof extensionAddress === "string") throw new Error("Remote UI extension server failed.");
  const extensionOrigin = `https://127.0.0.1:${extensionAddress.port}`;
  const frameUrl = `${extensionOrigin}${framePath}`;
  const hostileFrameUrl = `${extensionOrigin.replace(/:\d+$/u, ":1")}${framePath}`;
  const snapshot = { applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant", generationId: "sales-generation-1", artifactDigest: `sha256:${"a".repeat(64)}`, revision: 1, disposition: "active" };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Remote UI proof</title></head><body><main id="root"></main><script>window.__K_NEX_REMOTE_FRAME_URL__=${JSON.stringify(frameUrl)};window.__K_NEX_REMOTE_HOSTILE_FRAME_URL__=${JSON.stringify(hostileFrameUrl)};window.__K_NEX_REMOTE_SNAPSHOT__=${JSON.stringify(snapshot)}</script><script type="module" src="/host.js"></script></body></html>`;
  hostServer.removeAllListeners("request");
  hostServer.on("request", (request, response) => {
    const url = new URL(request.url ?? "/", hostOrigin);
    if (request.url === "/host.js") { response.writeHead(200, { "content-type": "text/javascript", "x-content-type-options": "nosniff" }); response.end(hostScript); return; }
    if (request.url === "/api/extensions/remote-ui/authorize" && request.method === "POST") {
      remoteUiAuthorizationChecks += 1;
      const sessionId = /(?:^|;\s*)customer_session=([^;]+)/u.exec(request.headers.cookie ?? "")?.[1];
      response.writeHead(authorizedSessions.has(sessionId) ? 204 : 401, { "cache-control": "no-store" }); response.end(); return;
    }
    if (url.pathname === "/api/extensions/remote-ui/authorize-target" && request.method === "POST") {
      remoteUiAuthorizationChecks += 1;
      const target = `${url.searchParams.get("operation")}:${url.searchParams.get("targetId")}`;
      const allowed = new Set(["source:sales.tasks", "source:sales.heartbeat", "action:sales.refresh"]);
      response.writeHead(authorizedSessions.has(/(?:^|;\s*)customer_session=([^;]+)/u.exec(request.headers.cookie ?? "")?.[1]) && allowed.has(target) ? 204 : 401, { "cache-control": "no-store" }); response.end(); return;
    }
    if (request.url === "/api/extensions/remote-ui/test-revoke" && request.method === "POST") {
      const sessionId = /(?:^|;\s*)customer_session=([^;]+)/u.exec(request.headers.cookie ?? "")?.[1];
      response.writeHead(authorizedSessions.delete(sessionId) ? 204 : 401, { "cache-control": "no-store" }); response.end(); return;
    }
    if (request.url === "/authenticated") { authenticatedFetches += 1; response.writeHead(200, { "content-type": "application/json" }); response.end('{"secret":true}'); return; }
    if (request.url === "/healthy") { response.writeHead(200, { "content-type": "application/json" }); response.end('{"healthy":true}'); return; }
    response.writeHead(200, { "content-type": "text/html", "set-cookie": "customer_session=protected; HttpOnly; SameSite=Lax" }); response.end(html);
  });

  browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
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
    indexedDB: "blocked", cache: "blocked", authenticatedFetch: "blocked", websocket: "blocked", dynamicImport: "blocked", bootstrapCredentials: "absent"
  });
  assert.equal(extensionDocumentCookie, undefined, "credentialless iframe sent extension-origin cookies");
  assert.equal(await page.evaluate(() => window.__K_NEX_REMOTE_HOSTILE_FRAME_REJECTED__), true, "remote UI host accepted a hostile same-path frame origin");
  assert.equal(authenticatedFetches, 0, "remote realm reached an authenticated host endpoint");
  assert.equal(await page.evaluate(() => window.__K_NEX_REMOTE_WINDOW_MESSAGES__), 0, "remote app used ambient window messaging after channel transfer");
  const heading = page.getByRole("heading", { name: "Sales assistant" });
  assert.equal(await heading.evaluate((element) => element.tagName), "H1", "remote heading did not render through the host semantic component");
  const refresh = page.getByRole("button", { name: "Refresh sales tasks" });
  assert.equal(await refresh.evaluate((element) => element === document.activeElement), true, "host-owned focus request did not target the semantic control");
  await page.getByRole("heading", { name: "Sales assistant" }).evaluate((element) => { element.tabIndex = -1; element.focus(); });
  await page.keyboard.press("Tab");
  assert.equal(await refresh.evaluate((element) => element === document.activeElement), true, "Tab did not reach the host semantic control");
  await page.keyboard.press("Enter");
  await page.getByText("Loaded 2 tasks").waitFor();
  await page.waitForFunction(() => (window.__K_NEX_REMOTE_HEARTBEATS__ ?? 0) >= 2);
  const heartbeatsBeforeFailure = await page.evaluate(() => window.__K_NEX_REMOTE_HEARTBEATS__);
  await page.getByRole("button", { name: "Trigger invalid application tree" }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent(), /PROTOCOL_FAILURE/u);
  const heartbeatsAtFailure = await page.evaluate(() => window.__K_NEX_REMOTE_HEARTBEATS__);
  assert.equal(heartbeatsAtFailure >= heartbeatsBeforeFailure, true);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__K_NEX_REMOTE_HEARTBEATS__), heartbeatsAtFailure, "remote realm heartbeat continued after protocol failure");
  assert.equal(await page.locator("iframe").count(), 0, "failed remote realm iframe remained attached");
  const fallback = page.getByRole("alert");
  assert.equal(await fallback.evaluate((element) => element === document.activeElement), true, "fallback did not recover host-owned focus");
  assert.deepEqual(pageErrors, []);
  const crashPage = await context.newPage();
  await crashPage.goto(hostOrigin);
  await crashPage.waitForFunction(() => window.__K_NEX_REMOTE_READY__ === true);
  await crashPage.getByRole("button", { name: "Report application runtime crash" }).click();
  await crashPage.getByRole("alert").waitFor();
  assert.match(await crashPage.getByRole("alert").textContent(), /APP_FAILURE/u);
  assert.equal(await crashPage.locator("iframe").count(), 0, "crashed remote realm iframe remained attached");
  assert.equal(await crashPage.getByRole("alert").evaluate((element) => element === document.activeElement), true, "crashed realm did not recover host-owned focus");
  await crashPage.close();
  for (const attack of ["oversized", "depth", "rate", "replay", "mixed-generation", "navigation", "download"]) {
    const attackPage = await context.newPage();
    let downloads = 0;
    attackPage.on("download", () => { downloads += 1; });
    await attackPage.goto(hostOrigin);
    await attackPage.waitForFunction(() => window.__K_NEX_REMOTE_READY__ === true);
    await attackPage.getByRole("button", { name: `Hostile ${attack}` }).click();
    await attackPage.getByRole("alert").waitFor();
    assert.match(await attackPage.getByRole("alert").textContent(), /PROTOCOL_FAILURE/u, `${attack} did not fail closed`);
    await attackPage.waitForTimeout(100);
    assert.equal(await attackPage.locator("iframe").count(), 0, `${attack} left its remote realm attached`);
    assert.equal(attackPage.url(), `${hostOrigin}/`, `${attack} navigated the host`);
    assert.equal((await attackPage.evaluate(() => window.__K_NEX_REMOTE_SOURCE_TARGETS__ ?? [])).every((target) => target === "sales.heartbeat"), true, `${attack} reached an unauthorized source`);
    assert.equal(await attackPage.evaluate(() => window.__K_NEX_REMOTE_ACTION_CALLS__ ?? 0), 0, `${attack} reached an unauthorized action`);
    assert.equal(downloads, 0, `${attack} initiated a browser download`);
    const health = await context.request.get(`${hostOrigin}/healthy`);
    assert.equal(health.status(), 200, `${attack} made the host unhealthy`);
    await attackPage.close();
  }
  assert.equal(extensionRequests.includes("/download"), false, "remote realm reached the download endpoint despite connect-src denial");
  const reauthorizationPage = await context.newPage();
  await reauthorizationPage.goto(hostOrigin);
  await reauthorizationPage.waitForFunction(() => window.__K_NEX_REMOTE_READY__ === true);
  await reauthorizationPage.getByRole("button", { name: "Pause sales heartbeat" }).click();
  await reauthorizationPage.waitForTimeout(100);
  const gatewaysBeforeRevocation = await reauthorizationPage.evaluate(() => ({ source: window.__K_NEX_REMOTE_SOURCE_CALLS__ ?? 0, action: window.__K_NEX_REMOTE_ACTION_CALLS__ ?? 0 }));
  const authorizationsBeforeRevocation = remoteUiAuthorizationChecks;
  assert.equal(await reauthorizationPage.evaluate(async () => (await fetch("/api/extensions/remote-ui/test-revoke", { method: "POST", credentials: "same-origin" })).status), 204, "test session revocation failed");
  await reauthorizationPage.getByRole("button", { name: "Refresh sales tasks" }).click();
  await reauthorizationPage.getByRole("alert").waitFor();
  assert.match(await reauthorizationPage.getByRole("alert").textContent(), /UNAUTHORIZED/u, "revoked session did not fail closed");
  assert.equal(remoteUiAuthorizationChecks, authorizationsBeforeRevocation + 1, "the valid post-revocation frame was not reauthorized");
  assert.deepEqual(await reauthorizationPage.evaluate(() => ({ source: window.__K_NEX_REMOTE_SOURCE_CALLS__ ?? 0, action: window.__K_NEX_REMOTE_ACTION_CALLS__ ?? 0 })), gatewaysBeforeRevocation, "revoked session reached a source or action gateway");
  assert.equal(await reauthorizationPage.locator("iframe").count(), 0, "revoked remote realm remained attached");
  await reauthorizationPage.close();
  await context.close();
  process.stdout.write("P9_REMOTE_UI_BROWSER_PASS\n");
} finally {
  await browser?.close();
  await close(hostServer); await close(extensionServer);
  await rm(directory, { recursive: true, force: true });
}
