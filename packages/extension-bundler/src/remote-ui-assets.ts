import { ExtensionBundlePathSchema } from "@k-nex/contracts";
import { createHash } from "node:crypto";

import type { Digest } from "./catalog.js";
import type { StagedArtifact } from "./store.js";

export interface VerifiedRemoteUiArtifactReader { read(artifactDigest: Digest): StagedArtifact | undefined | Promise<StagedArtifact | undefined>; }

export interface RemoteUiGenerationAuthority {
  isActive(identity: Readonly<{ applicationId: string; environment: string; appId: string; generationId: string; artifactDigest: Digest }>): boolean | Promise<boolean>;
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
export const remoteUiContentSecurityPolicy = "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src blob:; img-src 'self'; style-src 'self'";

function sha256(bytes: Uint8Array): Digest { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

export function createRemoteUiWorkerBootstrapSource(applicationSource: string): string {
  return `const applicationSource=${JSON.stringify(applicationSource)};addEventListener("message",function connect(event){if(event.data?.type!=="k-nex-connect"||!event.ports?.[0])return;removeEventListener("message",connect);const url=URL.createObjectURL(new Blob([applicationSource],{type:"text/javascript"}));const worker=new Worker(url);worker.addEventListener("error",()=>worker.terminate());worker.postMessage({type:"connect"},[event.ports[0]]);});\n`;
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
  constructor(private readonly artifacts: VerifiedRemoteUiArtifactReader, private readonly authority: RemoteUiGenerationAuthority) {}

  async read(request: RemoteUiAssetRequest): Promise<RemoteUiAssetResponse> {
    const verified = await this.verifiedFile(request, /^(?:assets|locales)\//u);
    return this.response(verified.body, verified.contentType, request.fileDigest);
  }

  async readBootstrap(request: RemoteUiAssetRequest & { readonly bootstrapDigest: Digest }): Promise<RemoteUiBootstrapResponse> {
    const verified = await this.verifiedFile(request, /^ui\//u);
    if (verified.contentType !== "application/javascript") throw new RemoteUiAssetError("ASSET_UNAVAILABLE", "Remote UI entrypoint must be JavaScript.");
    const body = Buffer.from(createRemoteUiWorkerBootstrapSource(verified.body.toString("utf8")));
    const bootstrapDigest = sha256(body);
    if (bootstrapDigest !== request.bootstrapDigest) throw new RemoteUiAssetError("DIGEST_MISMATCH", "Remote UI bootstrap digest does not match its route identity.");
    const response = this.response(body, "application/javascript", bootstrapDigest);
    return Object.freeze({ ...response, bootstrapDigest, integrity: `sha256-${Buffer.from(bootstrapDigest.slice("sha256:".length), "hex").toString("base64")}` });
  }

  private async verifiedFile(request: RemoteUiAssetRequest, allowedPath: RegExp): Promise<Readonly<{ body: Buffer; contentType: string }>> {
    const path = ExtensionBundlePathSchema.safeParse(request.path);
    if (!idPattern.test(request.applicationId) || !environmentPattern.test(request.environment) || !appPattern.test(request.appId) || !idPattern.test(request.generationId) ||
      !digestPattern.test(request.artifactDigest) || !digestPattern.test(request.fileDigest) || !path.success || !allowedPath.test(path.data)) {
      throw new RemoteUiAssetError("REQUEST_INVALID", "Remote UI asset request is invalid.");
    }
    if (!await this.authority.isActive(request)) throw new RemoteUiAssetError("GENERATION_INACTIVE", "Remote UI generation is not active.");
    const staged = await this.artifacts.read(request.artifactDigest);
    if (!staged || staged.verified.artifactDigest !== request.artifactDigest) throw new RemoteUiAssetError("ARTIFACT_UNAVAILABLE", "Verified Remote UI artifact is unavailable.");
    const manifest = staged.verified.manifest;
    if (manifest.deliveryClass !== "hot-application" || manifest.id !== request.appId) throw new RemoteUiAssetError("ARTIFACT_UNAVAILABLE", "Verified Remote UI artifact identity does not match.");
    const metadata = manifest.files[path.data];
    const body = staged.verified.files.get(path.data);
    if (!metadata || !body) throw new RemoteUiAssetError("ASSET_UNAVAILABLE", "Remote UI asset is not in the verified inventory.");
    if (metadata.digest !== request.fileDigest) throw new RemoteUiAssetError("DIGEST_MISMATCH", "Remote UI asset digest does not match its route identity.");
    return Object.freeze({ body, contentType: metadata.contentType });
  }

  private response(body: Buffer, contentType: string, digest: Digest): RemoteUiAssetResponse {
    const digestBytes = Buffer.from(digest.slice("sha256:".length), "hex").toString("base64");
    return Object.freeze({
      status: 200 as const,
      headers: Object.freeze({
        "cache-control": "public, max-age=31536000, immutable",
        "content-digest": `sha-256=:${digestBytes}:`,
        "content-length": String(body.byteLength),
        "access-control-allow-origin": "null",
        "content-security-policy": remoteUiContentSecurityPolicy,
        "content-type": `${contentType}; charset=utf-8`,
        "cross-origin-resource-policy": "cross-origin",
        "etag": `\"${digest}\"`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff"
      }),
      body: Buffer.from(body)
    });
  }
}
