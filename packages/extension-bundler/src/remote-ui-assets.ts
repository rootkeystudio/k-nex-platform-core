import { ExtensionBundlePathSchema } from "@k-nex/contracts";
import { createHash } from "node:crypto";

import type { Digest } from "./catalog.js";
import type { StagedArtifact } from "./store.js";

export interface RemoteUiArtifactIdentity {
  readonly applicationId: string;
  readonly environment: string;
  readonly extensionId: string;
  readonly generationId: string;
  readonly artifactDigest: Digest;
}

/**
 * Resolves only the currently active durable Hot Application generation and
 * reverified bytes as one authority boundary. A digest-only read cannot serve
 * Remote UI because it loses the owner and lifecycle binding.
 */
export interface VerifiedRemoteUiArtifactReader {
  readRemoteUi(identity: RemoteUiArtifactIdentity): StagedArtifact | undefined | Promise<StagedArtifact | undefined>;
}

export interface RemoteUiAssetRequest {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
  readonly artifactDigest: Digest;
  readonly fileDigest: Digest;
  readonly path: string;
}

export interface RemoteUiAssetResponse {
  readonly status: 200;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface RemoteUiBootstrapResponse extends RemoteUiAssetResponse { readonly integrity: string; readonly bootstrapDigest: Digest; }
export type RemoteUiFrameDocumentResponse = RemoteUiAssetResponse;

export class RemoteUiAssetError extends Error {
  constructor(readonly code: "REQUEST_INVALID" | "GENERATION_INACTIVE" | "ARTIFACT_UNAVAILABLE" | "ASSET_UNAVAILABLE" | "DIGEST_MISMATCH", message: string) {
    super(message);
    this.name = "RemoteUiAssetError";
  }
}

const idPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const appPattern = /^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
export const remoteUiContentSecurityPolicy = "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src data:; img-src 'self'; style-src 'self'";

function sha256(bytes: Uint8Array): Digest { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

function contentType(path: string): "application/javascript" | "application/json" | "image/svg+xml" | "text/css" | "text/plain" {
  if (path.endsWith(".mjs")) return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".css")) return "text/css";
  return "text/plain";
}

export function createRemoteUiWorkerBootstrapSource(applicationSource: string): string {
  return `const applicationSource=${JSON.stringify(applicationSource)};addEventListener("message",function connect(event){if(event.data?.type!=="k-nex-connect"||!event.ports?.[0])return;removeEventListener("message",connect);const hostPort=event.ports[0];let identity,worker,workerPort,url,closed=false,realmSequence=0;const validIdentity=value=>value&&typeof value==="object"&&value.schemaVersion===1&&value.direction==="host-to-realm"&&value.type==="bootstrap"&&typeof value.sessionId==="string"&&typeof value.appId==="string"&&typeof value.generationId==="string"&&Number.isInteger(value.sequence)&&value.sequence>0&&value.sequence<=1000000000;const recordRealm=value=>{if(value&&typeof value==="object"&&value.schemaVersion===1&&value.direction==="realm-to-host"&&value.sessionId===identity?.sessionId&&value.appId===identity?.appId&&value.generationId===identity?.generationId&&Number.isInteger(value.sequence)&&value.sequence===realmSequence+1)realmSequence=value.sequence;};const cleanup=()=>{if(closed)return;closed=true;try{worker?.terminate()}catch{}try{workerPort?.close()}catch{}try{hostPort.close()}catch{}};const fail=()=>{if(closed)return;try{if(identity)hostPort.postMessage({schemaVersion:1,sessionId:identity.sessionId,appId:identity.appId,generationId:identity.generationId,sequence:realmSequence+1,direction:"realm-to-host",type:"failure",code:"APP_BOOT_FAILED"})}catch{}finally{cleanup()}};hostPort.addEventListener("message",hostEvent=>{if(closed)return;const frame=hostEvent.data;if(!identity){if(!validIdentity(frame))return;identity=frame;try{url="data:text/javascript;base64,"+btoa(unescape(encodeURIComponent(applicationSource)));worker=new Worker(url,{type:"module"});const channel=new MessageChannel();workerPort=channel.port1;workerPort.addEventListener("message",workerEvent=>{if(closed)return;recordRealm(workerEvent.data);try{hostPort.postMessage(workerEvent.data)}catch{fail()}});workerPort.addEventListener("messageerror",fail);workerPort.start();worker.addEventListener("error",workerEvent=>{workerEvent.preventDefault?.();fail()});worker.addEventListener("messageerror",fail);worker.postMessage({type:"connect"},[channel.port2]);workerPort.postMessage(frame)}catch{fail()}return}try{workerPort?.postMessage(frame);if(frame?.type==="dispose")cleanup()}catch{fail()}});hostPort.addEventListener("messageerror",fail);hostPort.start();});\n`;
}

export function createRemoteUiFrameDocument(bootstrapPath: string, integrity: string): RemoteUiFrameDocumentResponse {
  if (!/^\/api\/extensions\/apps\/app\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*\/assets\/[a-z][a-z0-9-]{2,127}\/sha256:[0-9a-f]{64}\/bootstrap\.js$/u.test(bootstrapPath) || !/^sha256-[A-Za-z0-9+/]{43}=$/u.test(integrity)) {
    throw new RemoteUiAssetError("REQUEST_INVALID", "Remote UI frame document identity is invalid.");
  }
  const body = Buffer.from(`<!doctype html><html><head><meta charset="utf-8"></head><body><script src="${bootstrapPath}" integrity="${integrity}" crossorigin="anonymous"></script></body></html>\n`);
  return Object.freeze({
    status: 200 as const,
    headers: Object.freeze({
      "access-control-allow-origin": "null", "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(body.byteLength), "content-security-policy": remoteUiContentSecurityPolicy,
      "content-type": "text/html; charset=utf-8", "cross-origin-resource-policy": "cross-origin",
      "referrer-policy": "no-referrer", "x-content-type-options": "nosniff"
    }),
    body
  });
}

export class VerifiedRemoteUiAssetService {
  constructor(private readonly artifacts: VerifiedRemoteUiArtifactReader) {}

  async read(request: RemoteUiAssetRequest): Promise<RemoteUiAssetResponse> {
    const verified = await this.verifiedFile(request, /^(?:assets|locales)\//u, false);
    return this.response(verified.body, verified.contentType, request.fileDigest);
  }

  async readBootstrap(request: RemoteUiAssetRequest & { readonly bootstrapDigest: Digest }): Promise<RemoteUiBootstrapResponse> {
    const verified = await this.verifiedFile(request, /^ui\//u, true);
    if (verified.contentType !== "application/javascript") throw new RemoteUiAssetError("ASSET_UNAVAILABLE", "Remote UI entrypoint must be JavaScript.");
    const body = Buffer.from(createRemoteUiWorkerBootstrapSource(verified.body.toString("utf8")));
    const bootstrapDigest = sha256(body);
    if (bootstrapDigest !== request.bootstrapDigest) throw new RemoteUiAssetError("DIGEST_MISMATCH", "Remote UI bootstrap digest does not match its route identity.");
    const response = this.response(body, "application/javascript", bootstrapDigest);
    return Object.freeze({ ...response, bootstrapDigest, integrity: `sha256-${Buffer.from(bootstrapDigest.slice("sha256:".length), "hex").toString("base64")}` });
  }

  private async verifiedFile(request: RemoteUiAssetRequest, allowedPath: RegExp, requireScreenEntrypoint: boolean): Promise<Readonly<{ body: Buffer; contentType: string }>> {
    const path = ExtensionBundlePathSchema.safeParse(request.path);
    if (!idPattern.test(request.applicationId) || !environmentPattern.test(request.environment) || !appPattern.test(request.appId) || !idPattern.test(request.generationId) ||
      !digestPattern.test(request.artifactDigest) || !digestPattern.test(request.fileDigest) || !path.success || !allowedPath.test(path.data)) {
      throw new RemoteUiAssetError("REQUEST_INVALID", "Remote UI asset request is invalid.");
    }
    let staged: StagedArtifact | undefined;
    try {
      staged = await this.artifacts.readRemoteUi({
        applicationId: request.applicationId,
        environment: request.environment,
        extensionId: request.appId,
        generationId: request.generationId,
        artifactDigest: request.artifactDigest
      });
    } catch {
      throw new RemoteUiAssetError("ARTIFACT_UNAVAILABLE", "Verified Remote UI artifact is unavailable.");
    }
    if (!staged || staged.verified.artifactDigest !== request.artifactDigest) {
      throw new RemoteUiAssetError("GENERATION_INACTIVE", "Remote UI generation is not active with its verified artifact.");
    }
    const manifest = staged.verified.manifest;
    if (manifest.deliveryClass !== "hot-application" || manifest.id !== request.appId || !staged.verified.hotApplicationManifest) {
      throw new RemoteUiAssetError("ARTIFACT_UNAVAILABLE", "Verified Remote UI artifact identity does not match.");
    }
    if (requireScreenEntrypoint &&
      (!manifest.entrypoints.ui.includes(path.data) || !staged.verified.hotApplicationManifest.screens.some((screen) => screen.entrypoint === path.data))) {
      throw new RemoteUiAssetError("ASSET_UNAVAILABLE", "Remote UI bootstrap entrypoint is not declared by a screen.");
    }
    if (!requireScreenEntrypoint &&
      (path.data.startsWith("assets/")
        ? !staged.verified.hotApplicationManifest.assets.includes(path.data)
        : !staged.verified.hotApplicationManifest.localization.some((localization) => localization.path === path.data))) {
      throw new RemoteUiAssetError("ASSET_UNAVAILABLE", "Remote UI asset is not declared by the signed Hot Application manifest.");
    }
    const metadata = manifest.files[path.data];
    const storedBody = staged.verified.files.get(path.data);
    if (!metadata || !storedBody) throw new RemoteUiAssetError("ASSET_UNAVAILABLE", "Remote UI asset is not in the verified inventory.");
    const body = Buffer.from(storedBody);
    if (metadata.digest !== request.fileDigest || sha256(body) !== metadata.digest || body.byteLength !== metadata.bytes || contentType(path.data) !== metadata.contentType) {
      throw new RemoteUiAssetError("DIGEST_MISMATCH", "Remote UI asset no longer matches its verified inventory.");
    }
    return Object.freeze({ body, contentType: metadata.contentType });
  }

  private response(body: Buffer, contentType: string, digest: Digest): RemoteUiAssetResponse {
    const immutableBody = Buffer.from(body);
    if (sha256(immutableBody) !== digest) throw new RemoteUiAssetError("DIGEST_MISMATCH", "Remote UI response body no longer matches its digest.");
    const digestBytes = Buffer.from(digest.slice("sha256:".length), "hex").toString("base64");
    return Object.freeze({
      status: 200 as const,
      headers: Object.freeze({
        "cache-control": "public, max-age=31536000, immutable",
        "content-digest": `sha-256=:${digestBytes}:`,
        "content-length": String(immutableBody.byteLength),
        "access-control-allow-origin": "null",
        "content-security-policy": remoteUiContentSecurityPolicy,
        "content-type": `${contentType}; charset=utf-8`,
        "cross-origin-resource-policy": "cross-origin",
        "etag": `\"${digest}\"`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff"
      }),
      body: immutableBody
    });
  }
}
