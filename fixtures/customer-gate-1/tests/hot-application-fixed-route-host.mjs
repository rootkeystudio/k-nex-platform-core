import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";
import { createRemoteUiFrameDocument, createRemoteUiWorkerBootstrapSource, sha256, VerifiedRemoteUiAssetService } from "@k-nex/extension-bundler";
import { resolveHotApplicationFixedRoute } from "@k-nex/ui-runtime";

const assetPath = /^\/api\/extensions\/apps\/(app(?:\.[a-z][a-z0-9-]*)+)\/assets\/([a-z][a-z0-9-]{2,127})\/(sha256:[0-9a-f]{64})\/(bootstrap\.js|frame\.html)$/u;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) { return new Promise((resolve) => server.close(resolve)); }

export async function startHotApplicationFixedRouteHost({ store, artifacts, applicationId, environment, extension }) {
  const directory = await mkdtemp(join(tmpdir(), "knex-p9-fixed-route-"));
  let scriptBuilds = 0;
  await build({ entryPoints: [new URL("./hot-application-fixed-route-browser-entry.ts", import.meta.url).pathname], bundle: true, format: "esm", outfile: join(directory, "host-route.js") });
  scriptBuilds += 1;
  const hostScript = await readFile(join(directory, "host-route.js"));
  let extensionOrigin;
  const routeRequests = [];
  const routeErrors = [];

  const current = async () => {
    const inventory = await store.inventory(applicationId, environment);
    const entry = inventory.extensions.hotApplications[extension.id];
    if (!entry || entry.disposition !== "active") return undefined;
    const active = entry.activeGeneration;
    const staged = await artifacts.read(active.artifactDigest);
    if (!staged || staged.verified.manifest.deliveryClass !== "hot-application" || staged.verified.manifest.id !== extension.id || !staged.verified.hotApplicationManifest) return undefined;
    return { active, manifest: staged.verified.hotApplicationManifest, envelope: staged.verified.manifest };
  };
  const assets = new VerifiedRemoteUiAssetService(artifacts, {
    async isActive(identity) {
      const active = await current();
      return active?.active.generationId === identity.generationId && active.active.artifactDigest === identity.artifactDigest && identity.appId === extension.id;
    }
  });

  const extensionServer = createServer(async (request, response) => {
    try {
      const match = assetPath.exec(new URL(request.url ?? "/", "http://extensions.local").pathname);
      if (!match) { response.writeHead(404).end(); return; }
      const [, appId, generationId, bootstrapDigest, resource] = match;
      const active = await current();
      const screen = active?.manifest.screens.find((candidate) => candidate.entrypoint.startsWith("ui/"));
      if (!active || appId !== extension.id || generationId !== active.active.generationId || !screen) { response.writeHead(404).end(); return; }
      const fileDigest = active.envelope.files[screen.entrypoint]?.digest;
      if (!fileDigest) { response.writeHead(404).end(); return; }
      const input = { applicationId, environment, appId, generationId, artifactDigest: active.active.artifactDigest, fileDigest, path: screen.entrypoint, bootstrapDigest };
      const bootstrap = await assets.readBootstrap(input);
      const output = resource === "bootstrap.js"
        ? bootstrap
        : createRemoteUiFrameDocument(`/api/extensions/apps/${appId}/assets/${generationId}/${bootstrap.bootstrapDigest}/bootstrap.js`, bootstrap.integrity);
      response.writeHead(output.status, output.headers);
      response.end(output.body);
    } catch (error) { routeErrors.push(error instanceof Error ? error.message : "fixed-route-asset-failed"); response.writeHead(404).end(); }
  });
  await listen(extensionServer);
  const extensionAddress = extensionServer.address();
  if (extensionAddress === null || typeof extensionAddress === "string") throw new Error("Fixed route extension asset host failed to listen.");
  extensionOrigin = `http://127.0.0.1:${extensionAddress.port}`;

  const hostServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://customer.local");
      if (url.pathname === "/host-route.js") {
        response.writeHead(200, { "content-type": "text/javascript", "x-content-type-options": "nosniff" });
        response.end(hostScript); return;
      }
      const parts = url.pathname.split("/").slice(1);
      if (request.method !== "GET" || parts[0] !== "apps") { response.writeHead(404).end(); return; }
      const active = await current();
      if (!active) { response.writeHead(404).end(); return; }
      const route = resolveHotApplicationFixedRoute(parts[1] ?? "", parts.slice(2), [{
        appId: extension.id, generationId: active.active.generationId, active: true,
        routes: active.manifest.screens.map((screen) => screen.route), navigation: [], slots: []
      }]);
      const screen = active.manifest.screens.find((candidate) => candidate.route === route.route);
      if (!screen) { response.writeHead(404).end(); return; }
      const uiDigest = active.envelope.files[screen.entrypoint]?.digest;
      if (!uiDigest) { response.writeHead(404).end(); return; }
      const staged = await artifacts.read(active.active.artifactDigest);
      const source = staged?.verified.files.get(screen.entrypoint);
      if (!source) { response.writeHead(404).end(); return; }
      const bootstrap = await assets.readBootstrap({
        applicationId, environment, appId: extension.id, generationId: route.generationId, artifactDigest: active.active.artifactDigest,
        fileDigest: uiDigest, path: screen.entrypoint, bootstrapDigest: sha256(Buffer.from(createRemoteUiWorkerBootstrapSource(Buffer.from(source).toString("utf8"))))
      });
      const actorSessionId = "customer-session-1";
      const hadSession = request.headers.cookie?.includes(`customer_session=${actorSessionId}`) ?? false;
      routeRequests.push({ route: route.route, generationId: route.generationId, hadSession });
      const configuration = { applicationId, environment, appId: route.appId, generationId: route.generationId, route: route.route, actorSessionId, remoteUiFrameUrl: `${extensionOrigin}/api/extensions/apps/${extension.id}/assets/${route.generationId}/${bootstrap.bootstrapDigest}/frame.html` };
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        ...(hadSession ? {} : { "set-cookie": `customer_session=${actorSessionId}; HttpOnly; SameSite=Lax` })
      });
      response.end(`<!doctype html><html><body><main id="hot-application-route"></main><script>window.__K_NEX_HOT_APPLICATION_ROUTE__=${JSON.stringify(configuration)}</script><script type="module" src="/host-route.js"></script></body></html>`);
    } catch (error) { routeErrors.push(error instanceof Error ? error.message : "fixed-route-host-failed"); response.writeHead(404).end(); }
  });
  await listen(hostServer);
  const hostAddress = hostServer.address();
  if (hostAddress === null || typeof hostAddress === "string") throw new Error("Fixed route customer host failed to listen.");
  return Object.freeze({
    url: `http://127.0.0.1:${hostAddress.port}`,
    routeRequests,
    routeErrors,
    get scriptBuilds() { return scriptBuilds; },
    async close() { await Promise.all([close(hostServer), close(extensionServer)]); await rm(directory, { recursive: true, force: true }); }
  });
}
