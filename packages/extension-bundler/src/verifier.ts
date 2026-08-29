import { canonicalJson, ExtensionBundleManifestSchema, type ExtensionBundleManifest } from "@k-nex/contracts";

import { CatalogClient, type CatalogEntry, type Digest, type SignedCatalog, verifyHostedBuildProvenance } from "./catalog.js";
import { inspectBundleImports, sha256 } from "./bundle.js";
import { assertBundleInventory } from "./inventory.js";
import { extractNormalizedTarGz, type ExtractionLimits } from "./tar.js";

export type VerificationRequest = Readonly<{ catalog: SignedCatalog; artifact: Uint8Array; provenance: Uint8Array; deliveryClass: "hot-application" | "theme-skin"; id: string; version: string; runtimeAbi: string }>;
export type VerifiedArtifact = Readonly<{ entry: CatalogEntry; manifest: ExtensionBundleManifest; files: ReadonlyMap<string, Buffer>; artifactDigest: Digest }>;

function required(files: ReadonlyMap<string, Buffer>, path: string): Buffer {
  const value = files.get(path);
  if (!value) throw new Error(`Verified bundle is missing ${path}.`);
  return value;
}

function contentType(path: string): "application/javascript" | "application/json" | "image/svg+xml" | "text/css" | "text/plain" {
  if (path.endsWith(".mjs")) return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".css")) return "text/css";
  return "text/plain";
}

function verifySbom(bytes: Buffer, inventory: Readonly<Record<string, { digest: string }>>): void {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("SBOM is not JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("SBOM is invalid.");
  const document = parsed as { bomFormat?: unknown; specVersion?: unknown; metadata?: { timestamp?: unknown }; components?: unknown };
  if (document.bomFormat !== "CycloneDX" || document.specVersion !== "1.6" || document.metadata?.timestamp !== undefined || !Array.isArray(document.components)) throw new Error("SBOM is not a timestamp-free CycloneDX 1.6 document.");
  const components = new Map(document.components.filter((component): component is { type: unknown; name: unknown; hashes: unknown } => !!component && typeof component === "object" && !Array.isArray(component)).map((component) => [component.name, component]));
  if (document.components.length !== Object.keys(inventory).length || components.size !== document.components.length) throw new Error("SBOM does not inventory each bundle file exactly once.");
  for (const [path, metadata] of Object.entries(inventory)) {
    const component = components.get(path);
    const hashes = component && Array.isArray(component.hashes) ? component.hashes : [];
    if (!component || component.type !== "file" || !hashes.some((hash): hash is { alg: unknown; content: unknown } => !!hash && typeof hash === "object" && (hash as { alg?: unknown }).alg === "SHA-256" && (hash as { content?: unknown }).content === metadata.digest.slice("sha256:".length))) throw new Error(`SBOM does not bind ${path}.`);
  }
}

export class ArtifactVerifier {
  readonly #catalog: CatalogClient;
  readonly #limits: ExtractionLimits | undefined;
  readonly #trustedExtensionPublishers: ReadonlyMap<string, string>;

  constructor(catalog: CatalogClient, trustedExtensionPublishers: Readonly<Record<string, string>>, limits?: ExtractionLimits) {
    this.#catalog = catalog;
    this.#trustedExtensionPublishers = new Map(Object.entries(trustedExtensionPublishers));
    this.#limits = limits;
  }

  verify(request: VerificationRequest): VerifiedArtifact {
    const entry = this.#catalog.read(request.catalog).find((candidate) => candidate.deliveryClass === request.deliveryClass && candidate.id === request.id && candidate.version === request.version);
    if (!entry) throw new Error("Requested extension is not in the official catalog.");
    if (entry.support !== "supported" || entry.review !== "approved" || entry.security !== "clear" || entry.revoked) throw new Error("Catalog release is not currently installable.");
    if (this.#trustedExtensionPublishers.get(entry.publisher.identity) !== entry.publisher.publicKey) throw new Error("Extension publisher is not trusted.");
    if (entry.runtimeAbi !== request.runtimeAbi) throw new Error("Catalog runtime ABI is incompatible.");
    const artifactDigest = sha256(request.artifact);
    if (artifactDigest !== entry.artifactDigest) throw new Error("Artifact digest does not match the catalog.");
    const files = extractNormalizedTarGz(request.artifact, this.#limits);
    const manifestPath = request.deliveryClass === "hot-application" ? "k-nex.app-bundle.json" : "k-nex.skin-bundle.json";
    const manifestBytes = required(files, manifestPath);
    if (sha256(manifestBytes) !== entry.manifestDigest) throw new Error("Manifest digest does not match the catalog.");
    let manifest: ExtensionBundleManifest;
    try { manifest = ExtensionBundleManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8"))); } catch { throw new Error("Embedded bundle manifest is invalid."); }
    if (manifest.deliveryClass === "platform-plugin" || manifest.deliveryClass !== request.deliveryClass || manifest.id !== request.id || manifest.version !== request.version || manifest.runtimeAbi !== request.runtimeAbi) throw new Error("Embedded manifest identity or ABI does not match the requested release.");
    assertBundleInventory(manifest);
    if (request.artifact.byteLength > manifest.resourceBudget.maxBundleBytes) throw new Error("Bundle archive exceeds its declared byte budget.");
    const sbom = required(files, manifest.sbom.path);
    if (sha256(sbom) !== entry.sbomDigest || sha256(sbom) !== manifest.sbom.digest) throw new Error("SBOM digest does not match the catalog or manifest.");
    const provenance = Buffer.from(request.provenance);
    if (sha256(provenance) !== entry.provenanceDigest || sha256(provenance) !== manifest.provenance.digest) throw new Error("Provenance digest does not match the catalog or manifest.");
    try { verifyHostedBuildProvenance(JSON.parse(provenance.toString("utf8")), entry, manifest.payloadDigest as Digest); } catch { throw new Error("Hosted-build provenance does not bind this release."); }
    const inventory = manifest.files;
    if (manifest.payloadDigest !== sha256(Buffer.from(canonicalJson(inventory)))) throw new Error("Bundle payload digest does not match its file inventory.");
    verifySbom(sbom, inventory);
    const expected = new Set([...Object.keys(inventory), manifestPath, manifest.sbom.path]);
    if (files.size !== expected.size || [...files.keys()].some((path) => !expected.has(path))) throw new Error("Bundle contains unmanifested files.");
    for (const [path, metadata] of Object.entries(inventory)) {
      const file = required(files, path);
      if (sha256(file) !== metadata.digest || file.byteLength !== metadata.bytes || contentType(path) !== metadata.contentType) throw new Error(`File inventory mismatch: ${path}`);
    }
    inspectBundleImports(Object.keys(inventory).filter((path) => path.endsWith(".mjs")).map((path) => ({ path, bytes: required(files, path) })));
    return { entry, manifest, files, artifactDigest };
  }
}
