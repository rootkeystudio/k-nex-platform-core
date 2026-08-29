import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

import { canonicalJson } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import { ArtifactVerifier, buildBundle, CatalogClient, createNormalizedTarGz, defaultExtractionLimits, extractNormalizedTarGz, sha256, type BundleBuildInput, type CatalogEntry, type SignedCatalog, VerifiedArtifactStore, verifyHostedBuildProvenance } from "../src/index.js";

const source = { repository: "https://github.com/k-nex/official-apps", commit: "0123456789abcdef0123456789abcdef01234567" };
const workflowIdentity = `${source.repository}/.github/workflows/release.yml@${source.commit}`;
const extensionKeys = generateKeyPairSync("ed25519");
const extensionPublisher = { identity: "k-nex-extension-author", publicKey: extensionKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
const manifest: BundleBuildInput["manifest"] = {
  schemaVersion: 1, deliveryClass: "hot-application", id: "app.sales-fixture", version: "1.0.0", runtimeAbi: "1.0.0",
  entrypoints: { server: ["server/main.mjs"], ui: ["ui/main.mjs"] },
  resourceBudget: { maxBundleBytes: 1024 * 1024, maxAssetBytes: 1024, maxStorageBytes: 1024, maxMemoryMiB: 64, maxCpuMilliCores: 100, maxWallTimeMs: 1000, maxInputBytes: 1024, maxOutputBytes: 1024, maxLogBytes: 1024, maxConcurrency: 1 }
};
const files = [
  { path: "server/main.mjs", bytes: Buffer.from("export const run = () => 'ok';\n"), contentType: "application/javascript" as const },
  { path: "ui/main.mjs", bytes: Buffer.from("export const render = () => ({ type: 'text' });\n"), contentType: "application/javascript" as const },
  { path: "schemas/settings.json", bytes: Buffer.from("{}\n"), contentType: "application/json" as const }
];

function signedCatalog(entry: CatalogEntry): SignedCatalog {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const signer = { identity: "k-nex-catalog", publicKey };
  const payload = { schemaVersion: 1 as const, entries: [entry] };
  return { schemaVersion: 1, signer, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString("base64") };
}

function release() {
  const bundle = buildBundle({ manifest, files, source, workflowIdentity });
  const entry: CatalogEntry = {
    deliveryClass: "hot-application", id: "app.sales-fixture", version: "1.0.0", runtimeAbi: "1.0.0", publisher: extensionPublisher,
    source: { ...source, assetUrl: "https://github.com/k-nex/official-apps/releases/download/v1.0.0/app.sales-fixture.tar.gz" },
    artifactDigest: sha256(bundle.artifact), manifestDigest: sha256(Buffer.from(canonicalJson(bundle.manifest))), sbomDigest: sha256(bundle.sbom), provenanceDigest: sha256(bundle.provenance), support: "supported", review: "approved", security: "clear", revoked: false
  };
  const catalog = signedCatalog(entry);
  const client = new CatalogClient({ [catalog.signer.identity]: catalog.signer.publicKey });
  const request = { catalog, artifact: bundle.artifact, provenance: bundle.provenance, deliveryClass: "hot-application" as const, id: entry.id, version: entry.version, runtimeAbi: entry.runtimeAbi };
  return { bundle, catalog, client, request, publishers: { [entry.publisher.identity]: entry.publisher.publicKey } };
}

function rawTar(entries: readonly { path: string; bytes: Uint8Array; type?: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.path);
    header.write(entry.bytes.byteLength.toString(8).padStart(11, "0"), 124);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    header.write("ustar\0", 257);
    header.fill(0x20, 148, 156);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0"), 148);
    parts.push(header, Buffer.from(entry.bytes), Buffer.alloc((512 - (entry.bytes.byteLength % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

describe("extension bundler", () => {
  it("builds byte-identical self-contained payloads with closed inventory, SBOM, and provenance", () => {
    const first = buildBundle({ manifest, files, source, workflowIdentity });
    const second = buildBundle({ manifest, files: [...files].reverse(), source, workflowIdentity });
    expect(first.artifact.equals(second.artifact)).toBe(true);
    expect(first.manifest.payloadDigest).toBe(sha256(Buffer.from(canonicalJson(first.manifest.files))));
    expect(first.manifest.files).not.toHaveProperty(first.manifestPath);
    expect(JSON.parse(first.sbom.toString("utf8"))).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.6" });
    expect(JSON.parse(first.provenance.toString("utf8"))).toMatchObject({ schemaVersion: 1, source, workflowIdentity, outputs: { payloadDigest: first.manifest.payloadDigest } });
    expect(() => buildBundle({ manifest, files, source: { ...source, commit: "not-a-commit" }, workflowIdentity })).toThrow();
    expect(() => buildBundle({ manifest: { ...manifest, entrypoints: { ...manifest.entrypoints, server: ["server/missing.mjs"] } }, files, source, workflowIdentity })).toThrow(/entrypoint/u);
  });

  it("rejects module access and package lifecycle representation without false comment matches", () => {
    for (const sourceText of ["import fs from 'node:fs'", "import('x')", "require('x')", "export * from 'node:fs'", "export { value } from 'package'"]) {
      expect(() => buildBundle({ manifest, source, workflowIdentity, files: [{ ...files[0]!, bytes: Buffer.from(sourceText) }, ...files.slice(1)] })).toThrow(/Forbidden module access/u);
    }
    expect(() => buildBundle({ manifest, source, workflowIdentity, files: [{ ...files[0]!, bytes: Buffer.from("// import 'ignored'\nexport const text = 'process';") }, ...files.slice(1)] })).not.toThrow();
    expect(() => buildBundle({ manifest, source, workflowIdentity, files: [{ ...files[0]!, path: "package.json" }, ...files.slice(1)] })).toThrow(/lifecycle scripts/u);
    expect(() => buildBundle({ manifest, source, workflowIdentity, files: [{ ...files[0]!, path: "assets/package.json" }, ...files.slice(1)] })).toThrow(/lifecycle scripts/u);
  });

  it("enforces declared entrypoint, asset, skin CSS, and no-executable-skin inventories", () => {
    expect(() => buildBundle({ manifest: { ...manifest, resourceBudget: { ...manifest.resourceBudget, maxAssetBytes: 1 } }, source, workflowIdentity, files: [...files, { path: "assets/a.txt", bytes: Buffer.from("ab"), contentType: "text/plain" }] })).toThrow(/maxAssetBytes/u);
    const skin: BundleBuildInput["manifest"] = {
      schemaVersion: 1, deliveryClass: "theme-skin", id: "skin.fixture", version: "1.0.0", runtimeAbi: "1.0.0",
      stylesheets: ["styles/theme.css"], resourceBudget: { maxBundleBytes: 1024 * 1024, maxAssetBytes: 1024, maxCssBytes: 2 }
    };
    expect(() => buildBundle({ manifest: skin, source, workflowIdentity, files: [{ path: "styles/theme.css", bytes: Buffer.from("abc"), contentType: "text/css" }] })).toThrow(/maxCssBytes/u);
    expect(() => buildBundle({ manifest: { ...skin, resourceBudget: { ...skin.resourceBudget, maxCssBytes: 1024 } }, source, workflowIdentity, files: [{ path: "styles/theme.css", bytes: Buffer.from("a{}"), contentType: "text/css" }, { path: "ui/evil.mjs", bytes: Buffer.from("export {}"), contentType: "application/javascript" }] })).toThrow(/executable JavaScript/u);
  });

  it("verifies the signed catalog and every provenance/release binding before stage", () => {
    const { client, request, bundle, catalog, publishers } = release();
    const verifier = new ArtifactVerifier(client, publishers);
    expect(verifier.verify(request).manifest.id).toBe(request.id);
    const store = new VerifiedArtifactStore(verifier);
    expect(store.read(sha256(bundle.artifact))).toBeUndefined();
    expect(store.stage(request)).toBe(store.stage(request));
    expect(store.read(sha256(bundle.artifact))?.verified.manifest.id).toBe(request.id);

    expect(() => new ArtifactVerifier(client, publishers).verify({ ...request, catalog: { ...catalog, signature: `A${catalog.signature.slice(1)}` } })).toThrow(/signature/u);
    expect(() => new ArtifactVerifier(client, publishers).verify({ ...request, artifact: Buffer.from("tampered") })).toThrow(/Artifact digest/u);
    const invalid = <K extends keyof CatalogEntry>(key: K, value: CatalogEntry[K]) => {
      const entry = catalog.payload.entries[0]!;
      const modified = signedCatalog({ ...entry, [key]: value });
      return new ArtifactVerifier(new CatalogClient({ [modified.signer.identity]: modified.signer.publicKey }), publishers).verify({ ...request, catalog: modified });
    };
    expect(() => invalid("manifestDigest", sha256(Buffer.from("wrong")))).toThrow(/Manifest digest/u);
    expect(() => invalid("sbomDigest", sha256(Buffer.from("wrong")))).toThrow(/SBOM digest/u);
    expect(() => new ArtifactVerifier(client, publishers).verify({ ...request, provenance: Buffer.from("{}") })).toThrow(/Provenance digest/u);
    expect(() => verifyHostedBuildProvenance({ ...JSON.parse(bundle.provenance.toString("utf8")), workflowIdentity: `${source.repository}/.github/workflows/other.yml@${"a".repeat(40)}` }, catalog.payload.entries[0]!, bundle.manifest.payloadDigest as `sha256:${string}`)).toThrow(/Provenance/u);
    expect(() => new ArtifactVerifier(client, publishers).verify({ ...request, version: "1.0.1" })).toThrow(/not in the official catalog/u);
    expect(() => new ArtifactVerifier(client, publishers).verify({ ...request, runtimeAbi: "2.0.0" })).toThrow(/runtime ABI/u);
    const unsupported = signedCatalog({ ...catalog.payload.entries[0]!, support: "unsupported" });
    const unsupportedClient = new CatalogClient({ [unsupported.signer.identity]: unsupported.signer.publicKey });
    expect(unsupportedClient.read(unsupported)).toHaveLength(1);
    expect(() => new ArtifactVerifier(unsupportedClient, publishers).verify({ ...request, catalog: unsupported })).toThrow(/not currently installable/u);
    const revoked = signedCatalog({ ...catalog.payload.entries[0]!, revoked: true });
    const revokedClient = new CatalogClient({ [revoked.signer.identity]: revoked.signer.publicKey });
    expect(revokedClient.read(revoked)).toHaveLength(1);
    expect(() => new ArtifactVerifier(revokedClient, publishers).verify({ ...request, catalog: revoked })).toThrow(/not currently installable/u);
    expect(() => new ArtifactVerifier(client, {}).verify(request)).toThrow(/publisher/u);
    for (const entry of [
      { ...catalog.payload.entries[0]!, review: "pending" as const },
      { ...catalog.payload.entries[0]!, security: "advisory" as const }
    ]) {
      const blocked = signedCatalog(entry);
      const blockedClient = new CatalogClient({ [blocked.signer.identity]: blocked.signer.publicKey });
      expect(() => new ArtifactVerifier(blockedClient, publishers).verify({ ...request, catalog: blocked })).toThrow(/not currently installable/u);
    }
  });

  it("verifies the committed public-key-only signed official catalog fixture", () => {
    const fixture = JSON.parse(readFileSync(new URL("../fixtures/official-catalog.json", import.meta.url), "utf8"));
    expect(new CatalogClient({ [fixture.signer.identity]: fixture.signer.publicKey }).read(fixture)).toHaveLength(1);
  });

  it("rejects unknown catalog fields and invalid delivery-class-to-ID bindings at the catalog boundary", () => {
    const { catalog, client } = release();
    expect(() => client.read({ ...catalog, extra: true })).toThrow(/Invalid official catalog/u);
    const bad = { ...catalog, payload: { ...catalog.payload, entries: [{ ...catalog.payload.entries[0]!, deliveryClass: "theme-skin", id: "app.wrong" }] } };
    expect(() => client.read(bad)).toThrow(/Invalid official catalog/u);
  });

  it("rejects traversal, links, colliding paths, bombs, and every configured extraction bound", () => {
    expect(() => extractNormalizedTarGz(rawTar([{ path: "../escape", bytes: Buffer.from("x") }]))).toThrow(/unsafe path/u);
    expect(() => extractNormalizedTarGz(rawTar([{ path: "link", bytes: Buffer.alloc(0), type: "2" }]))).toThrow(/unsupported tar entry/u);
    expect(() => extractNormalizedTarGz(rawTar([{ path: "hard", bytes: Buffer.alloc(0), type: "1" }]))).toThrow(/unsupported tar entry/u);
    expect(() => extractNormalizedTarGz(rawTar([{ path: "same", bytes: Buffer.from("x") }, { path: "same", bytes: Buffer.from("y") }]))).toThrow(/duplicate path/u);
    expect(() => extractNormalizedTarGz(rawTar([{ path: "assets/Readme.txt", bytes: Buffer.from("x") }, { path: "assets/readme.txt", bytes: Buffer.from("y") }]))).toThrow(/case-colliding path/u);
    expect(() => extractNormalizedTarGz(rawTar([{ path: "assets/K.txt", bytes: Buffer.from("x") }, { path: "assets/K.txt", bytes: Buffer.from("y") }]))).toThrow(/case-colliding path/u);
    expect(() => extractNormalizedTarGz(rawTar([{ path: "a\\b", bytes: Buffer.from("x") }]))).toThrow(/unsafe path/u);
    expect(() => extractNormalizedTarGz(rawTar([{ path: Array.from({ length: defaultExtractionLimits.maxPathDepth + 1 }, () => "a").join("/"), bytes: Buffer.from("x") }]))).toThrow(/unsafe path/u);
    expect(() => extractNormalizedTarGz(rawTar([{ path: "a/b/c", bytes: Buffer.from("x") }]), { maxCompressedBytes: 1024 * 1024, maxFiles: 1, maxFileBytes: 1, maxTotalBytes: 1, maxPathDepth: 2 })).toThrow(/unsafe path/u);
    expect(() => extractNormalizedTarGz(gzipSync(Buffer.alloc(4096)), { maxCompressedBytes: 1000, maxFiles: 1, maxFileBytes: 1, maxTotalBytes: 1, maxPathDepth: 1 })).toThrow(/decompression/u);
    const archive = createNormalizedTarGz([{ path: "one", bytes: Buffer.from("12") }, { path: "two", bytes: Buffer.from("34") }]);
    expect(() => extractNormalizedTarGz(archive, { maxCompressedBytes: 1024 * 1024, maxFiles: 1, maxFileBytes: 10, maxTotalBytes: 10000, maxPathDepth: 1 })).toThrow(/file count/u);
    expect(() => extractNormalizedTarGz(archive, { maxCompressedBytes: 1024 * 1024, maxFiles: 3, maxFileBytes: 1, maxTotalBytes: 10000, maxPathDepth: 1 })).toThrow(/file exceeds/u);
    expect(() => extractNormalizedTarGz(archive, { maxCompressedBytes: 1024 * 1024, maxFiles: 3, maxFileBytes: 10, maxTotalBytes: 3, maxPathDepth: 1 })).toThrow(/total size/u);
    const compressed = gunzipSync(archive);
    expect(() => extractNormalizedTarGz(gzipSync(compressed), { maxCompressedBytes: 1, maxFiles: 3, maxFileBytes: 10, maxTotalBytes: 10, maxPathDepth: 1 })).toThrow(/compressed size/u);
    const invalidChecksum = Buffer.from(gunzipSync(archive));
    invalidChecksum[0] = 0x78;
    expect(() => extractNormalizedTarGz(gzipSync(invalidChecksum))).toThrow(/checksum/u);
    const invalidMagic = Buffer.from(gunzipSync(archive));
    invalidMagic[257] = 0x78;
    expect(() => extractNormalizedTarGz(gzipSync(invalidMagic))).toThrow(/format/u);
    expect(() => extractNormalizedTarGz(Buffer.concat([archive, archive]))).toThrow(/data follows tar terminator/u);
  });
});
