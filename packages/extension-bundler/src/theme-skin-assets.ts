import { assertSafeThemeSkinSvg, ExtensionBundlePathSchema } from "@k-nex/contracts";

import { sha256 } from "./bundle.js";
import type { Digest } from "./catalog.js";
import type { StagedArtifact } from "./store.js";

export interface VerifiedThemeSkinArtifactReader { read(artifactDigest: Digest): Promise<StagedArtifact | undefined>; }

export interface ThemeSkinGenerationAuthority {
  isAvailable(identity: Readonly<{
    applicationId: string;
    environment: string;
    skinId: string;
    generationId: string;
    artifactDigest: Digest;
  }>): boolean | Promise<boolean>;
}

export interface ThemeSkinAssetRequest {
  readonly applicationId: string;
  readonly environment: string;
  readonly skinId: string;
  readonly generationId: string;
  readonly artifactDigest: Digest;
  readonly fileDigest: Digest;
  readonly path: string;
}

export interface ThemeSkinAssetResponse {
  readonly status: 200;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export class ThemeSkinAssetError extends Error {
  constructor(readonly code: "REQUEST_INVALID" | "GENERATION_UNAVAILABLE" | "ARTIFACT_UNAVAILABLE" | "ASSET_UNAVAILABLE" | "DIGEST_MISMATCH" | "ASSET_UNSAFE", message: string) {
    super(message);
    this.name = "ThemeSkinAssetError";
  }
}

const ownerPattern = /^[a-z][a-z0-9.-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const skinPattern = /^skin(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;
const generationPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function assertSafeSvg(body: Buffer): void {
  try { assertSafeThemeSkinSvg(body); } catch { throw new ThemeSkinAssetError("ASSET_UNSAFE", "Theme Skin SVG contains executable or remote content."); }
}

export class VerifiedThemeSkinAssetService {
  constructor(private readonly artifacts: VerifiedThemeSkinArtifactReader, private readonly authority: ThemeSkinGenerationAuthority) {}

  async read(request: ThemeSkinAssetRequest): Promise<ThemeSkinAssetResponse> {
    const path = ExtensionBundlePathSchema.safeParse(request.path);
    if (!ownerPattern.test(request.applicationId) || !environmentPattern.test(request.environment) || !skinPattern.test(request.skinId) ||
      !generationPattern.test(request.generationId) || !digestPattern.test(request.artifactDigest) || !digestPattern.test(request.fileDigest) ||
      !path.success || !path.data.startsWith("assets/") || !path.data.endsWith(".svg")) {
      throw new ThemeSkinAssetError("REQUEST_INVALID", "Theme Skin asset request is invalid.");
    }
    if (!await this.authority.isAvailable(request)) throw new ThemeSkinAssetError("GENERATION_UNAVAILABLE", "Theme Skin generation is neither active nor retained.");
    const staged = await this.artifacts.read(request.artifactDigest);
    if (!staged || staged.verified.artifactDigest !== request.artifactDigest) throw new ThemeSkinAssetError("ARTIFACT_UNAVAILABLE", "Verified Theme Skin artifact is unavailable.");
    const manifest = staged.verified.manifest;
    if (manifest.deliveryClass !== "theme-skin" || manifest.id !== request.skinId) throw new ThemeSkinAssetError("ARTIFACT_UNAVAILABLE", "Verified Theme Skin artifact identity does not match.");
    const metadata = manifest.files[path.data];
    const body = staged.verified.files.get(path.data);
    if (!metadata || !body || metadata.contentType !== "image/svg+xml") throw new ThemeSkinAssetError("ASSET_UNAVAILABLE", "Theme Skin asset is absent or has a forbidden content type.");
    if (metadata.digest !== request.fileDigest || sha256(body) !== request.fileDigest || body.byteLength !== metadata.bytes) throw new ThemeSkinAssetError("DIGEST_MISMATCH", "Theme Skin asset no longer matches its verified inventory.");
    assertSafeSvg(body);
    const digestBytes = Buffer.from(request.fileDigest.slice("sha256:".length), "hex").toString("base64");
    return Object.freeze({
      status: 200 as const,
      headers: Object.freeze({
        "cache-control": "public, max-age=31536000, immutable",
        "content-digest": `sha-256=:${digestBytes}:`,
        "content-length": String(body.byteLength),
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": "image/svg+xml",
        "cross-origin-resource-policy": "same-origin",
        "etag": `\"${request.fileDigest}\"`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff"
      }),
      body: Buffer.from(body)
    });
  }
}
