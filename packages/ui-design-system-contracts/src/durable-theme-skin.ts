import {
  canonicalJson,
  ExtensionBundleManifestSchema,
  ThemeProfileSchema,
  ThemeSkinManifestSchema,
  type ThemeProfile
} from "@k-nex/contracts";

import {
  createThemeSkinGeneration,
  createThemeSkinRegistry,
  type ResolvedThemeSkin,
  type ThemeSkinGeneration
} from "./skin.js";

const skinManifestPath = "schemas/theme-skin.json";

export interface DurableThemeSkinAuthority {
  readonly applicationId: string;
  readonly environment: string;
  readonly deliveryClass: "theme-skin";
  readonly extensionId: string;
  readonly generationId: string;
  readonly artifactDigest: string;
  readonly manifestDigest: string;
  readonly catalogDigest: string;
  readonly provenanceDigest: string;
  readonly sbomDigest: string;
  readonly sourceCommit: string;
}

export interface DurableThemeSkinArtifact {
  readonly authority: DurableThemeSkinAuthority;
  readonly bundleManifest: unknown;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface DurableThemeSkinArtifactReader {
  load(authority: DurableThemeSkinAuthority): Promise<DurableThemeSkinArtifact>;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function requireFile(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const bytes = files.get(path);
  if (!bytes) throw new TypeError(`Theme Skin durable artifact is missing ${path}.`);
  return bytes;
}

/**
 * Reconstructs a Theme Skin exclusively from a generation-bound, reverified
 * artifact. The envelope remains intentionally separate from the declarative
 * skin manifest so executable bundle fields cannot become theme contracts.
 */
export class DurableThemeSkinResolver {
  constructor(private readonly artifacts: DurableThemeSkinArtifactReader) {}

  async generation(authority: DurableThemeSkinAuthority): Promise<ThemeSkinGeneration> {
    const artifact = await this.artifacts.load(authority);
    if (!same(artifact.authority, authority)) throw new TypeError("Theme Skin artifact authority does not exactly match the requested generation.");
    const bundle = ExtensionBundleManifestSchema.parse(artifact.bundleManifest);
    if (bundle.deliveryClass !== "theme-skin" || bundle.id !== authority.extensionId) {
      throw new TypeError("Theme Skin artifact envelope does not match its generation authority.");
    }
    const manifestBytes = requireFile(artifact.files, skinManifestPath);
    let manifestValue: unknown;
    try { manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new TypeError("Theme Skin declarative manifest is not JSON."); }
    const manifest = ThemeSkinManifestSchema.parse(manifestValue);
    if (manifest.id !== authority.extensionId || manifest.version !== bundle.version || manifest.runtimeAbi !== bundle.runtimeAbi ||
      !same(manifest.stylesheets, bundle.stylesheets) || !same(manifest.resourceBudget, bundle.resourceBudget)) {
      throw new TypeError("Theme Skin declarative manifest does not match the verified bundle envelope.");
    }

    const expectedPaths = new Set([skinManifestPath, ...manifest.stylesheets, ...manifest.assets.map((asset) => asset.path), ...manifest.localization.map((entry) => entry.path)]);
    const artifactPaths = new Set(["k-nex.skin-bundle.json", "sbom.cdx.json", ...expectedPaths]);
    if (artifact.files.size !== artifactPaths.size || [...artifact.files.keys()].some((path) => !artifactPaths.has(path)) ||
      Object.keys(bundle.files).length !== expectedPaths.size || Object.keys(bundle.files).some((path) => !expectedPaths.has(path))) {
      throw new TypeError("Theme Skin bundle contains undeclared or missing declarative content.");
    }

    for (const path of expectedPaths) {
      const bytes = requireFile(artifact.files, path);
      const metadata = bundle.files[path];
      if (!metadata || metadata.bytes !== bytes.byteLength || metadata.digest !== await digest(bytes)) {
        throw new TypeError(`Theme Skin durable bytes fail the verified inventory: ${path}.`);
      }
    }
    if (bundle.files[skinManifestPath]?.contentType !== "application/json") throw new TypeError("Theme Skin manifest has an invalid content type.");

    const stylesheets = Object.fromEntries(await Promise.all(manifest.stylesheets.map(async (path) => {
      if (bundle.files[path]?.contentType !== "text/css") throw new TypeError(`Theme Skin stylesheet has an invalid content type: ${path}.`);
      return [path, new TextDecoder().decode(requireFile(artifact.files, path))] as const;
    })));
    const assets = Object.fromEntries(await Promise.all(manifest.assets.map(async (asset) => {
      const bytes = requireFile(artifact.files, asset.path);
      if (bundle.files[asset.path]?.contentType !== "image/svg+xml" || await digest(bytes) !== asset.digest) {
        throw new TypeError(`Theme Skin asset fails its declared digest: ${asset.path}.`);
      }
      return [asset.path, { digest: asset.digest, contentType: "image/svg+xml" as const, bytes: new Uint8Array(bytes) }] as const;
    })));
    return createThemeSkinGeneration({ manifest, generationId: authority.generationId, stylesheets, assets });
  }

  async resolve(authority: DurableThemeSkinAuthority, profileValue: unknown): Promise<ResolvedThemeSkin> {
    const profile = ThemeProfileSchema.parse(profileValue) as ThemeProfile;
    if (!profile.skin || profile.skin.id !== authority.extensionId || profile.skin.generationId !== authority.generationId) {
      throw new TypeError("Theme Profile does not select the requested durable skin generation.");
    }
    const generation = await this.generation(authority);
    if (profile.skin.version !== generation.manifest.version) throw new TypeError("Theme Profile version does not match the durable skin generation.");
    return createThemeSkinRegistry([generation]).resolve(profile.skin);
  }
}
