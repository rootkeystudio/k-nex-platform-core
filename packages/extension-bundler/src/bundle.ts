import { createHash } from "node:crypto";

import { canonicalJson, ExtensionBundleManifestSchema, type ExtensionBundleManifest } from "@k-nex/contracts";
import { initSync, parse } from "es-module-lexer";

import { assertBundleInventory } from "./inventory.js";
import { createNormalizedTarGz, type ArchiveEntry } from "./tar.js";
import { HostedBuildProvenanceSchema, type Digest, type HostedBuildProvenance } from "./catalog.js";

type BundleDraft = Omit<Extract<ExtensionBundleManifest, { deliveryClass: "hot-application" }>, "payloadDigest" | "files" | "sbom" | "provenance"> | Omit<Extract<ExtensionBundleManifest, { deliveryClass: "theme-skin" }>, "payloadDigest" | "files" | "sbom" | "provenance">;
export type BuiltFile = Readonly<{ path: string; bytes: Uint8Array; contentType: "application/javascript" | "application/json" | "image/svg+xml" | "text/css" | "text/plain" }>;
export type BundleBuildInput = Readonly<{ manifest: BundleDraft; files: readonly BuiltFile[]; source: HostedBuildProvenance["source"]; workflowIdentity: string }>;
export type BuiltBundle = Readonly<{ artifact: Buffer; manifest: ExtensionBundleManifest; manifestPath: "k-nex.app-bundle.json" | "k-nex.skin-bundle.json"; sbom: Buffer; provenance: Buffer }>;

export function sha256(bytes: Uint8Array): Digest { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

initSync();

function inspectSource(path: string, source: string): void {
  let imports;
  try { [imports] = parse(source, path); } catch { throw new Error(`Invalid ECMAScript module syntax in ${path}.`); }
  if (imports.some((declaration) => declaration.d !== -2) || /\brequire\s*\(/u.test(source)) throw new Error(`Forbidden module access in ${path}.`);
}

export function inspectBundleImports(files: readonly Pick<BuiltFile, "path" | "bytes">[]): void {
  for (const file of files) if (file.path.endsWith(".mjs")) inspectSource(file.path, Buffer.from(file.bytes).toString("utf8"));
}

function sbom(files: readonly BuiltFile[]): Buffer {
  return Buffer.from(canonicalJson({ bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000000", version: 1, components: files.map((file) => ({ type: "file", name: file.path, hashes: [{ alg: "SHA-256", content: sha256(file.bytes).slice("sha256:".length) }] })).sort((left, right) => left.name.localeCompare(right.name)) }));
}

export function buildBundle(input: BundleBuildInput): BuiltBundle {
  const files = [...input.files].map((file) => ({ ...file, bytes: Buffer.from(file.bytes) })).sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0 || new Set(files.map((file) => file.path)).size !== files.length) throw new Error("Bundle files must be non-empty and unique.");
  if (files.some((file) => !/^(?:assets|locales|schemas|server|styles|ui)\//u.test(file.path) || file.path.split("/").at(-1) === "package.json")) throw new Error("Bundle files may not represent package metadata or lifecycle scripts.");
  inspectBundleImports(files);
  const generatedSbom = sbom(files);
  const inventory = Object.fromEntries(files.map((file) => [file.path, { digest: sha256(file.bytes), bytes: file.bytes.byteLength, contentType: file.contentType }]));
  const payloadDigest = sha256(Buffer.from(canonicalJson(inventory)));
  const provenance = Buffer.from(canonicalJson(HostedBuildProvenanceSchema.parse({ schemaVersion: 1, source: input.source, workflowIdentity: input.workflowIdentity, outputs: { payloadDigest, sbomDigest: sha256(generatedSbom) } satisfies HostedBuildProvenance["outputs"] })));
  const manifestPath = input.manifest.deliveryClass === "hot-application" ? "k-nex.app-bundle.json" : "k-nex.skin-bundle.json";
  const manifest = ExtensionBundleManifestSchema.parse({ ...input.manifest, payloadDigest, files: inventory, sbom: { path: "sbom.cdx.json", digest: sha256(generatedSbom) }, provenance: { reference: `https://github.com/k-nex/official-catalog/attestations/${sha256(provenance).slice("sha256:".length)}`, digest: sha256(provenance) } });
  if (manifest.deliveryClass === "platform-plugin") throw new Error("The hot bundle builder cannot produce a Platform Plugin release.");
  assertBundleInventory(manifest);
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const artifact = createNormalizedTarGz([
    ...files.map((file): ArchiveEntry => ({ path: file.path, bytes: file.bytes })),
    { path: "sbom.cdx.json", bytes: generatedSbom },
    { path: manifestPath, bytes: manifestBytes }
  ]);
  if (artifact.byteLength > manifest.resourceBudget.maxBundleBytes) throw new Error("Bundle archive exceeds its declared byte budget.");
  return { artifact, manifest, manifestPath, sbom: generatedSbom, provenance };
}
