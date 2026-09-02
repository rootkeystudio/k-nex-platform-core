import { readFile } from "node:fs/promises";
import { createServer } from "node:https";

import { matchHotApplicationRoute } from "@k-nex/contracts";
import { createRemoteUiFrameDocument, createRemoteUiWorkerBootstrapSource, sha256, VerifiedRemoteUiAssetService } from "@k-nex/extension-bundler";
import { resolveHotApplicationFixedRoute } from "@k-nex/ui-runtime";

const assetPath = /^\/api\/extensions\/apps\/(app(?:\.[a-z][a-z0-9-]*)+)\/assets\/([a-z][a-z0-9-]{2,127})\/(sha256:[0-9a-f]{64})\/(bootstrap\.js|frame\.html)$/u;
const hostScriptPath = new URL("../dist/tests/hot-application-fixed-route-browser-entry.js", import.meta.url);
const tls = {
  key: Buffer.from("LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2Z0lCQURBTkJna3Foa2lHOXcwQkFRRUZBQVNDQktnd2dnU2tBZ0VBQW9JQkFRQ2c5eTRjNi9KZHBzNGMKQUFhaldHdnBhRzU2NVBENmxRTHFCa2dIQm5rUEFlYTVPTHdBOXluUUJtVlJIWDVza2xFbDNJYThvc1A5RkgzQwpYSFJLdE4yR2tIb1FJMGV4R0VhWnk3aThOSFc1TGNpSjU0SnRadkFVZFZCaUNKQlRwdjdrYXpjY3R5Z3M4VThLCkNhb2RtRVdKempkM1JJNWF0NmlYTHZPUnlHaSttODljZExielAxbDNUVVZYZy94TE1PanYvaEhEMkhXeXk5SzEKWW9wTE5oRUIrY2NOQk51L1RrRVBOQUhXc0V4dUxhc3JxK045QWRnVmdYeXFnYW84MEhVUGw2cGp3NVNhOXEvSgpoTGwxbzdzaXRoazhuTm11dGQxUVdzTmhKZ0tZTU5JMDNtbksrU0xWazlZeitneUg3NWwvYkR0V0xKaFd6WWluCmhwWk8rQ1U3QWdNQkFBRUNnZ0VBRFp4K24rcDNKR0tLYVBBUVNrMXhVL0R2OEF0enNkK0U1THVObEFQV1Juc2EKTFdKMTlMenh6UW42djZPM1ZrQ3AybGVZdXloN3NKSEVML25OSHY0Y0FoallnWXlDTDZCYnVWTkg5cWpzVURHUQp2M3lUV1EzM0o1RU9CWTdhS1lDNXdDQ3RnelpIdXU2QzNsaVgzb2gxcE9RS2FRR2o2Z1JBSGpJQVhiMENnbnBHCjk3ZGQvWnRZK2FYQXFEejltdWdjbjI4QXdEUmlCalV1dGIwNlI0TUNJSXFTd09MZUwzOE9SeFprbGg2SU80TE4KZldBbnY0QlNOYzBjZktCRlFWLzEwbnVhZ0JXOFl4SkJsa1VSU01CRXFFYjZrN29pTlZMS0wzWnB5YXNlRG9mRwp2Vm45Q09iQXRtSTFYbVJDUE4zcHBLTHp1dzhMdGxSeU1Ga3Q1MmRRdVFLQmdRRGY2QXpWREdwamtLcEM5a2RGCnd5cE1ab1BUWEhZQVpxWFVid3N4dnNXc2JvbFFMZWZHVnUySlpGajB0Wk9mdkZIMTI3ZmdwcmF1cnNvWU44OE0KbDlzZDZFU003NEFEcmlrY1R2M08vMUNOUnVTNmRWY2JtZHN1czk0bXFNTFU2T3FRYXN2Zjh2ZnJvczA3NVRZdwo3R2p4V1k3OWp4eTRPRy81N3JLaFRWVFkrUUtCZ1FDNENaam1jL2hUZDZFbnVISGQxdTVFRE5VVGNRS0loSWkrCm9YQlgvNlE3VEpsZStjVUt4Q2w2ME1IN292azZPMExPUmFFNXZUN1pVMmhsRlhOanBnNmJjazhPOXE2YldjYW4Kc2U0QTBpSWVGc2RBdEVqZEZHWnJOOE9BT1BFNC9ObUl6bzdnQ0JwRlNmZ0l3TTRCd2c5eDNoam9PY0hEbldvKwpuNHJ6ZG5mUTB3S0JnUURJSEZBN3FKajgyeklRSHFPY1Njem44MGNtQTZEQ3d2cTZYWFFYeFhSTm80eTlTQW01ClRiK0Y1MVZKZjI2c2VGYVg4UUxwbUpYMGtPcTFza3N0NmhvL0pITC9zcDBxck9DNUdDL21iSERGa3ZLaFluV3oKaVZKRzd5SkFVdHV1Qld4K0hiU1FOa28xSW85aVZIeVdSUE9Wb0lFWFJHeGFpTFlySFpZd2F6akZvUUtCZ1FDUwpsL3AySHd4QUdEdURNelZvT3FzQ0E2SzZZTHRlMlFzL3BjS2lKZHpBNjJ3RHJqclpMNVhHNFlDVEc2Y2dUbElSCmtuOHhTZUJGSmw0eW5wcVNWcFN1RjZpSHg5RWZwNnhJcWI5bVlmdVJNaDIzR2FRc2pmSmpGMEVmNHJ1cTVDVzMKQnFuaUpESWczU0c0ZnpQWlRLWVcwbzNPZFNzMTBTN3ZBUkNpaTh3Mnh3S0JnQ1drQldXUUFOQXpNZ0M3TGxlbQpwaFZJYTY2S1ZDWldETjJPMGxpSEtiQlo3RHRLZWw0TFU2NmZxOUdHSDhmRHR3M3p4bkc3SVoyZzd6d0hWYW4zCnI5OFlxUmN2UjNPWU1xM1BNeEFSa1pPWmFFYVY1cW5jZVdWclViNTIvU25WTGNFOGF1NzYvRjIvaHN6MFRGT2IKMkRvcm9KU0UvYytLUkdjOXdXaFEra2VqCi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS0K", "base64"),
  cert: Buffer.from("LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURHakNDQWdLZ0F3SUJBZ0lVZmpMSEpGK2NXb0hJSUZIRGIzZlJPcWFOT2Mwd0RRWUpLb1pJaHZjTkFRRUwKQlFBd0ZERVNNQkFHQTFVRUF3d0pNVEkzTGpBdU1DNHhNQjRYRFRJMk1EZ3pNVEF3TlRZMU9Wb1hEVE0yTURneQpPREF3TlRZMU9Wb3dGREVTTUJBR0ExVUVBd3dKTVRJM0xqQXVNQzR4TUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGCkFBT0NBUThBTUlJQkNnS0NBUUVBb1BjdUhPdnlYYWJPSEFBR28xaHI2V2h1ZXVUdytwVUM2Z1pJQndaNUR3SG0KdVRpOEFQY3AwQVpsVVIxK2JKSlJKZHlHdktMRC9SUjl3bHgwU3JUZGhwQjZFQ05Ic1JoR21jdTR2RFIxdVMzSQppZWVDYldid0ZIVlFZZ2lRVTZiKzVHczNITGNvTFBGUENnbXFIWmhGaWM0M2QwU09XcmVvbHk3emtjaG92cHZQClhIUzI4ejlaZDAxRlY0UDhTekRvNy80Unc5aDFzc3ZTdFdLS1N6WVJBZm5IRFFUYnYwNUJEelFCMXJCTWJpMnIKSzZ2amZRSFlGWUY4cW9HcVBOQjFENWVxWThPVW12YXZ5WVM1ZGFPN0lyWVpQSnpacnJYZFVGckRZU1lDbUREUwpOTjVweXZraTFaUFdNL29NaCsrWmYydzdWaXlZVnMySXA0YVdUdmdsT3dJREFRQUJvMlF3WWpBZEJnTlZIUTRFCkZnUVV2R0o1Nm9IUld2Wjlydjl5RGxaRGFCSHFFOHd3SHdZRFZSMGpCQmd3Rm9BVXZHSjU2b0hSV3ZaOXJ2OXkKRGxaRGFCSHFFOHd3RHdZRFZSMFRBUUgvQkFVd0F3RUIvekFQQmdOVkhSRUVDREFHaHdSL0FBQUJNQTBHQ1NxRwpTSWIzRFFFQkN3VUFBNElCQVFDSnZ6STVpTmhDZGR5VGQ0dzhIa01pekpBczh3Y3czNkpZS2lvVGtUV0pzQlU3CnJXLy9PUW9tTStENFpyOXVYN3psSkhjRVhVTTV5c3hvS3JURjlqYjRka0RzUFgrZGRKM0RvS3FCVlA2dnlLeFAKRER6STAzRUY0ajdOWGhoWVpVYkdCN2NST3NKUnhQU0FiSFpJbjEraUNlTFBjd0d5YkZvVkFQaWJRSk02eUZUOQoxOWljdVNuQ3I2VU84OFBLWlFRQUxmUC9QdnNURFZNanhOMk03RzZXN1RtRUhQMXJhalFEVFJKeURMd05PL2lVCitBSGl5OVNMRkdmeG9yNVVMaFFBQU8xamZmbmN2NitiUkFSV1d6WllxUFJIdzlrRGRmanFzT282SDdwQTZENkwKcThIRUVMYklvbWt5MDhDN1FxakIyR2RCOElibENOOEM4QlVSUEE1TwotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==", "base64")
};

function listen(server) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }
async function jsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > 65_536) throw new TypeError("Remote UI host request exceeds its byte budget.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function requestSignal(request) {
  const controller = new AbortController();
  if (request.aborted) controller.abort();
  else request.once("aborted", () => controller.abort());
  return controller.signal;
}

export async function startHotApplicationFixedRouteHost({ store, artifacts, applicationId, environment, extension, invokeSource, authorization }) {
  if (!artifacts || typeof artifacts.readRemoteUi !== "function") throw new TypeError("Fixed route host requires a verified artifact reader.");
  if (environment !== "production") throw new TypeError("Fixed route host requires the production environment.");
  if (typeof invokeSource !== "function") throw new TypeError("Fixed route host requires a bounded source gateway.");
  if (!authorization || typeof authorization.current !== "function" || typeof authorization.revision !== "function") {
    throw new TypeError("Fixed route host requires current Remote UI authorization.");
  }
  const hostScript = await readFile(hostScriptPath);
  const routeRequests = [];
  const routeErrors = [];
  const sourceRequests = [];
  const revokedSessions = new Set();
  const routeSessions = new Map();
  let nextRouteSession = 0;
  const authorizationAdmission = async (request) => {
    const admission = await authorization.revision(request);
    if (!admission || !Number.isSafeInteger(admission.authorizationRevision) || admission.authorizationRevision < 0 ||
      typeof admission.authorizationProof !== "string" || admission.authorizationProof.length < 1 || admission.authorizationProof.length > 512) return undefined;
    return Object.freeze({ authorizationRevision: admission.authorizationRevision, authorizationProof: admission.authorizationProof });
  };
  const authorizationHeaders = (admission) => admission
    ? { "x-k-nex-authorization-revision": String(admission.authorizationRevision), "x-k-nex-authorization-proof": admission.authorizationProof }
    : {};
  const sameAuthorizationAdmission = (left, right) => left?.authorizationRevision === right?.authorizationRevision && left?.authorizationProof === right?.authorizationProof;
  const currentAuthorization = async (request, routeSession = undefined) => {
    const current = await authorization.current(request);
    if (!current || typeof current.sessionId !== "string" || !current.sessionId || revokedSessions.has(current.sessionId) ||
      typeof current.authorizeRoute !== "function" || typeof current.authorizeFrame !== "function" || typeof current.authorizeTarget !== "function" ||
      (routeSession && routeSession.sessionId !== current.sessionId)) return undefined;
    return current;
  };
  const currentRouteSessionAuthorization = async (request, routeSession) => {
    if (!routeSession) return undefined;
    const current = await currentAuthorization(request, routeSession);
    if (!current) {
      routeSessions.delete(routeSession.identity.sessionId);
      return undefined;
    }
    const admission = await authorizationAdmission(request);
    if (!admission || !sameAuthorizationAdmission(routeSession.admission, admission)) {
      routeSessions.delete(routeSession.identity.sessionId);
      return Object.freeze({ admission });
    }
    return Object.freeze({ current, admission });
  };
  const activeGeneration = async (generationId) => {
    const inventory = await store.inventory(applicationId, environment);
    const entry = inventory.extensions.hotApplications[extension.id];
    if (!entry || entry.disposition !== "active" || (generationId && entry.activeGeneration.generationId !== generationId)) return undefined;
    const active = entry.activeGeneration;
    const identity = Object.freeze({ applicationId, environment, extensionId: extension.id, generationId: active.generationId, artifactDigest: active.artifactDigest });
    return Object.freeze({ identity, revision: entry.revision });
  };
  const admitted = async (generationId, current = undefined) => {
    const active = current ?? await activeGeneration(generationId);
    if (!active) return undefined;
    const { identity } = active;
    const staged = await artifacts.readRemoteUi(identity);
    if (!staged || staged.verified.artifactDigest !== identity.artifactDigest || staged.verified.manifest.deliveryClass !== "hot-application" || staged.verified.manifest.id !== extension.id || !staged.verified.hotApplicationManifest) return undefined;
    return Object.freeze({ identity, revision: active.revision, manifest: staged.verified.hotApplicationManifest, envelope: staged.verified.manifest, files: staged.verified.files });
  };
  const assets = new VerifiedRemoteUiAssetService(artifacts);
  const routeSnapshot = async (pathname, current) => {
    const active = await admitted(undefined, current);
    if (!active) return undefined;
    const parts = pathname.split("/").slice(1);
    const route = resolveHotApplicationFixedRoute(parts[1] ?? "", parts.slice(2), [{ appId: extension.id, generationId: active.identity.generationId, active: true, routes: active.manifest.screens.map((screen) => screen.route), navigation: [], slots: [] }]);
    const screen = active.manifest.screens.find((candidate) => matchHotApplicationRoute(route.appId, candidate.route, route.route));
    const fileDigest = screen && active.envelope.files[screen.entrypoint]?.digest;
    const source = screen && active.files.get(screen.entrypoint);
    if (!screen || !fileDigest || !source) return undefined;
    const bootstrapDigest = sha256(Buffer.from(createRemoteUiWorkerBootstrapSource(Buffer.from(source).toString("utf8"))));
    const bootstrap = await assets.readBootstrap({ applicationId, environment, appId: extension.id, generationId: active.identity.generationId, artifactDigest: active.identity.artifactDigest, fileDigest, path: screen.entrypoint, bootstrapDigest });
    return Object.freeze({ active, route, bootstrap });
  };
  const durableSnapshot = async (routeSession) => {
    const inventory = await store.inventory(applicationId, environment);
    const entry = inventory.extensions.hotApplications[extension.id];
    if (!entry) return undefined;
    if (entry.disposition === "active") {
      return Object.freeze({ applicationId, environment, appId: extension.id, generationId: entry.activeGeneration.generationId, artifactDigest: entry.activeGeneration.artifactDigest, revision: entry.revision, disposition: "active" });
    }
    if (!["disabled", "quarantined", "removed"].includes(entry.disposition)) return undefined;
    const retained = entry.retainedGeneration;
    return Object.freeze({ applicationId, environment, appId: extension.id, generationId: retained?.generationId ?? routeSession.identity.generationId, artifactDigest: retained?.artifactDigest ?? routeSession.identity.artifactDigest, revision: entry.revision, disposition: entry.disposition });
  };
  const extensionServer = createServer(tls, async (request, response) => {
    try {
      const match = assetPath.exec(new URL(request.url ?? "/", "https://extensions.local").pathname);
      if (!match) { response.writeHead(404).end(); return; }
      const [, appId, generationId, bootstrapDigest, resource] = match;
      const active = await admitted(generationId);
      const screen = active?.manifest.screens.find((candidate) => candidate.entrypoint.startsWith("ui/"));
      const fileDigest = screen && active.envelope.files[screen.entrypoint]?.digest;
      if (!active || appId !== extension.id || !screen || !fileDigest) { response.writeHead(404).end(); return; }
      const bootstrap = await assets.readBootstrap({ applicationId, environment, appId, generationId, artifactDigest: active.identity.artifactDigest, fileDigest, path: screen.entrypoint, bootstrapDigest });
      const output = resource === "bootstrap.js" ? bootstrap : createRemoteUiFrameDocument(`/api/extensions/apps/${appId}/assets/${generationId}/${bootstrap.bootstrapDigest}/bootstrap.js`, bootstrap.integrity);
      response.writeHead(output.status, output.headers);
      response.end(output.body);
    } catch (error) { routeErrors.push(error instanceof Error ? error.message : "fixed-route-asset-failed"); response.writeHead(404).end(); }
  });
  await listen(extensionServer);
  const extensionAddress = extensionServer.address();
  if (extensionAddress === null || typeof extensionAddress === "string") throw new Error("Fixed route extension asset host failed to listen.");
  const extensionOrigin = `https://127.0.0.1:${extensionAddress.port}`;
  const hostServer = createServer(tls, async (request, response) => {
    try {
      const signal = requestSignal(request);
      const url = new URL(request.url ?? "/", "https://customer.local");
      if (url.pathname === "/host-route.js") { response.writeHead(200, { "content-type": "text/javascript", "x-content-type-options": "nosniff" }); response.end(hostScript); return; }
      if (url.pathname === "/api/extensions/remote-ui/authorize" && request.method === "POST") {
        const routeSession = routeSessions.get(url.searchParams.get("sessionId") ?? "");
        const authorizationBefore = await currentRouteSessionAuthorization(request, routeSession);
        const allowed = authorizationBefore?.current && await authorizationBefore.current.authorizeFrame(routeSession.identity, signal);
        const authorizationAfter = allowed && await currentRouteSessionAuthorization(request, routeSession);
        response.writeHead(authorizationAfter?.current ? 204 : 401, { "cache-control": "no-store" }).end(); return;
      }
      if (url.pathname === "/api/extensions/remote-ui/authorize-target" && request.method === "POST") {
        const routeSession = routeSessions.get(url.searchParams.get("sessionId") ?? "");
        const operation = url.searchParams.get("operation");
        const targetId = url.searchParams.get("targetId");
        const targets = operation === "source" ? routeSession?.sources : operation === "action" ? routeSession?.actions : undefined;
        const authorizationBefore = await currentRouteSessionAuthorization(request, routeSession);
        const allowed = authorizationBefore?.current && typeof targetId === "string" && targets?.has(targetId) &&
          await authorizationBefore.current.authorizeTarget(routeSession.identity, operation, targetId, signal);
        const authorizationAfter = allowed && await currentRouteSessionAuthorization(request, routeSession);
        response.writeHead(authorizationAfter?.current ? 204 : 401, { "cache-control": "no-store" }).end(); return;
      }
      if (url.pathname === "/api/extensions/remote-ui/test-revoke" && request.method === "POST") {
        const currentAuthorizationSession = await currentAuthorization(request);
        response.writeHead(currentAuthorizationSession ? (revokedSessions.add(currentAuthorizationSession.sessionId), 204) : 401, { "cache-control": "no-store" }).end(); return;
      }
      if (url.pathname === "/api/extensions/remote-ui/snapshot" && request.method === "GET") {
        const routeSession = routeSessions.get(url.searchParams.get("session") ?? "");
        const authorizationBefore = await currentRouteSessionAuthorization(request, routeSession);
        if (!authorizationBefore?.current) { response.writeHead(401, { "cache-control": "no-store", ...authorizationHeaders(authorizationBefore?.admission) }).end(); return; }
        if (!await authorizationBefore.current.authorizeFrame(routeSession.identity, signal)) { response.writeHead(401, { "cache-control": "no-store", ...authorizationHeaders(authorizationBefore.admission) }).end(); return; }
        const snapshot = await durableSnapshot(routeSession);
        if (!snapshot) { response.writeHead(404, { "cache-control": "no-store" }).end(); return; }
        const authorizationAfter = await currentRouteSessionAuthorization(request, routeSession);
        if (!authorizationAfter?.current) { response.writeHead(401, { "cache-control": "no-store", ...authorizationHeaders(authorizationAfter?.admission) }).end(); return; }
        if (!await authorizationAfter.current.authorizeFrame(routeSession.identity, signal)) { response.writeHead(401, { "cache-control": "no-store", ...authorizationHeaders(authorizationAfter.admission) }).end(); return; }
        const authorizationFinal = await currentRouteSessionAuthorization(request, routeSession);
        if (!authorizationFinal?.current) { response.writeHead(401, { "cache-control": "no-store", ...authorizationHeaders(authorizationFinal?.admission) }).end(); return; }
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ ...snapshot, ...authorizationFinal.admission })); return;
      }
      if (url.pathname === "/api/extensions/remote-ui/source" && request.method === "POST") {
        const body = await jsonBody(request);
        const routeSession = typeof body?.sessionId === "string" ? routeSessions.get(body.sessionId) : undefined;
        const identity = body?.identity;
        if (!routeSession || !identity || identity.applicationId !== routeSession.identity.applicationId || identity.environment !== routeSession.identity.environment || identity.appId !== routeSession.identity.appId || identity.generationId !== routeSession.identity.generationId || identity.artifactDigest !== routeSession.identity.artifactDigest || identity.sessionId !== routeSession.identity.sessionId || typeof body.targetId !== "string" || !routeSession.sources.has(body.targetId)) {
          response.writeHead(401, { "cache-control": "no-store" }).end(); return;
        }
        const authorizationBefore = await currentRouteSessionAuthorization(request, routeSession);
        const targetAllowed = authorizationBefore?.current && await authorizationBefore.current.authorizeTarget(routeSession.identity, "source", body.targetId, signal);
        if (!targetAllowed) {
          response.writeHead(401, { "cache-control": "no-store" }).end(); return;
        }
        const current = await durableSnapshot(routeSession);
        if (!current || current.disposition !== "active" || current.generationId !== routeSession.identity.generationId || current.artifactDigest !== routeSession.identity.artifactDigest) {
          sourceRequests.push(Object.freeze({ sessionId: routeSession.identity.sessionId, generationId: routeSession.identity.generationId, artifactDigest: routeSession.identity.artifactDigest, targetId: body.targetId, status: "denied" }));
          response.writeHead(409, { "cache-control": "no-store" }).end(); return;
        }
        const authorizationAfter = await currentRouteSessionAuthorization(request, routeSession);
        if (!authorizationAfter?.current || !await authorizationAfter.current.authorizeTarget(routeSession.identity, "source", body.targetId, signal)) {
          response.writeHead(401, { "cache-control": "no-store" }).end(); return;
        }
        const expectedGeneration = Object.freeze({ generationId: routeSession.identity.generationId, artifactDigest: routeSession.identity.artifactDigest });
        if (!(await currentRouteSessionAuthorization(request, routeSession))?.current) {
          response.writeHead(401, { "cache-control": "no-store" }).end(); return;
        }
        sourceRequests.push(Object.freeze({ sessionId: routeSession.identity.sessionId, generationId: expectedGeneration.generationId, artifactDigest: expectedGeneration.artifactDigest, targetId: body.targetId, status: "admitted", input: body.input }));
        try {
          const output = await invokeSource(Object.freeze({ identity: routeSession.identity, expectedGeneration, targetId: body.targetId, input: body.input }));
          sourceRequests.push(Object.freeze({ sessionId: routeSession.identity.sessionId, generationId: expectedGeneration.generationId, artifactDigest: expectedGeneration.artifactDigest, targetId: body.targetId, status: "completed" }));
          response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ output })); return;
        } catch {
          sourceRequests.push(Object.freeze({ sessionId: routeSession.identity.sessionId, generationId: expectedGeneration.generationId, artifactDigest: expectedGeneration.artifactDigest, targetId: body.targetId, status: "runtime-denied" }));
          response.writeHead(409, { "cache-control": "no-store" }).end(); return;
        }
      }
      if (request.method !== "GET" || !url.pathname.startsWith("/apps/")) { response.writeHead(404).end(); return; }
      const current = await activeGeneration();
      if (!current) { response.writeHead(404).end(); return; }
      const currentAuthorizationSession = await currentAuthorization(request);
      if (!currentAuthorizationSession) { response.writeHead(401, { "cache-control": "no-store" }).end(); return; }
      const authorizationBefore = await authorizationAdmission(request);
      if (!authorizationBefore) { response.writeHead(503, { "cache-control": "no-store" }).end(); return; }
      if (!await currentAuthorizationSession.authorizeRoute({ ...current.identity, appId: extension.id }, signal)) { response.writeHead(403, { "cache-control": "no-store", ...authorizationHeaders(authorizationBefore) }).end(); return; }
      const snapshot = await routeSnapshot(url.pathname, current);
      if (!snapshot) { response.writeHead(404).end(); return; }
      const continuationAuthorizationSession = await currentAuthorization(request, currentAuthorizationSession);
      if (!continuationAuthorizationSession || !await continuationAuthorizationSession.authorizeRoute({ ...snapshot.active.identity, appId: extension.id }, signal)) { response.writeHead(403, { "cache-control": "no-store", ...authorizationHeaders(authorizationBefore) }).end(); return; }
      const authorizationAfter = await authorizationAdmission(request);
      if (!authorizationAfter || !sameAuthorizationAdmission(authorizationBefore, authorizationAfter)) { response.writeHead(503, { "cache-control": "no-store" }).end(); return; }
      const routeSessionId = `route-session-${++nextRouteSession}`;
      const identity = Object.freeze({ applicationId, environment: "production", appId: snapshot.route.appId, generationId: snapshot.active.identity.generationId, artifactDigest: snapshot.active.identity.artifactDigest, sessionId: routeSessionId });
      routeRequests.push({ route: snapshot.route.route, generationId: snapshot.active.identity.generationId, hadSession: true });
      const configuration = { ...identity, revision: snapshot.active.revision, ...authorizationAfter, route: snapshot.route.route, routes: snapshot.active.manifest.screens.map((screen) => screen.route), sources: snapshot.active.manifest.sources.map((source) => source.id), actions: snapshot.active.manifest.actions.map((action) => action.id), remoteUiFrameUrl: `${extensionOrigin}/api/extensions/apps/${extension.id}/assets/${snapshot.active.identity.generationId}/${snapshot.bootstrap.bootstrapDigest}/frame.html`, snapshotUrl: `/api/extensions/remote-ui/snapshot?session=${routeSessionId}`, sourceUrl: "/api/extensions/remote-ui/source", drainMs: 10_000 };
      routeSessions.set(routeSessionId, Object.freeze({ identity, sessionId: currentAuthorizationSession.sessionId, admission: authorizationAfter, sources: new Set(configuration.sources), actions: new Set(configuration.actions) }));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(`<!doctype html><html><body><main id="hot-application-route"></main><script>window.__K_NEX_HOT_APPLICATION_ROUTE__=${JSON.stringify(configuration)}</script><script type="module" src="/host-route.js"></script></body></html>`);
    } catch (error) { routeErrors.push(error instanceof Error ? error.message : "fixed-route-host-failed"); response.writeHead(404).end(); }
  });
  await listen(hostServer);
  const hostAddress = hostServer.address();
  if (hostAddress === null || typeof hostAddress === "string") throw new Error("Fixed route customer host failed to listen.");
  return Object.freeze({ url: `https://127.0.0.1:${hostAddress.port}`, routeRequests, routeErrors, sourceRequests, tlsCertificate: tls.cert, async close() { await Promise.all([close(hostServer), close(extensionServer)]); } });
}
