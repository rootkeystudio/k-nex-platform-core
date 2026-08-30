import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

import { canonicalJson } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import { ArtifactVerifier, buildBundle, CatalogClient, createNormalizedTarGz, defaultExtractionLimits, extractNormalizedTarGz, InMemoryCatalogCheckpointStore, sha256, type BundleBuildInput, type CatalogEntry, type SignedCatalog, VerifiedArtifactStore, verifyHostedBuildProvenance } from "../src/index.js";

const source = { repository: "https://github.com/k-nex/official-apps", commit: "0123456789abcdef0123456789abcdef01234567" };
const workflowIdentity = `${source.repository}/.github/workflows/release.yml@${source.commit}`;
const extensionKeys = generateKeyPairSync("ed25519");
const extensionPublisher = { identity: "k-nex-extension-author", publicKey: extensionKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
const manifest: BundleBuildInput["manifest"] = {
  schemaVersion: 1, deliveryClass: "hot-application", id: "app.sales-fixture", displayName: "Sales fixture", version: "1.0.0", runtimeAbi: "1.0.0",
  entrypoints: { server: ["server/main.mjs"], ui: ["ui/main.mjs"] },
  capabilities: [],
  resourceBudget: { maxBundleBytes: 1024 * 1024, maxAssetBytes: 1024, maxStorageBytes: 1024, maxMemoryMiB: 64, maxCpuMilliCores: 100, maxWallTimeMs: 1000, maxInputBytes: 1024, maxOutputBytes: 1024, maxLogBytes: 1024, maxConcurrency: 1 },
  settings: [], screens: [{ id: "sales.screen", route: "/", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: [], localization: [], healthChecks: []
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
  const payload = { schemaVersion: 1 as const, sequence: 1, expiresAt: "2030-01-01T00:00:00.000Z", entries: [entry] };
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
  const client = new CatalogClient({ [catalog.signer.identity]: catalog.signer.publicKey }, new InMemoryCatalogCheckpointStore());
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
    expect(first.manifest).toMatchObject({ applicationManifest: { path: "schemas/hot-application-manifest.json", digest: sha256(Buffer.from(canonicalJson(manifest))) } });
    expect(first.manifest.files).toHaveProperty("schemas/hot-application-manifest.json");
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

  it("verifies the signed catalog and every provenance/release binding before stage", async () => {
    const { client, request, bundle, catalog, publishers } = release();
    const verifier = new ArtifactVerifier(client, publishers);
    expect((await verifier.verify(request)).manifest.id).toBe(request.id);
    const store = new VerifiedArtifactStore(verifier);
    expect(store.read(sha256(bundle.artifact))).toBeUndefined();
    expect(await store.stage(request)).toEqual(await store.stage(request));
    expect(store.read(sha256(bundle.artifact))?.verified.manifest.id).toBe(request.id);

    const alteredSignature = `${catalog.signature.startsWith("A") ? "B" : "A"}${catalog.signature.slice(1)}`;
    await expect(new ArtifactVerifier(client, publishers).verify({ ...request, catalog: { ...catalog, signature: alteredSignature } })).rejects.toThrow(/signature/u);
    await expect(new ArtifactVerifier(client, publishers).verify({ ...request, artifact: Buffer.from("tampered") })).rejects.toThrow(/Artifact digest/u);
    const invalid = <K extends keyof CatalogEntry>(key: K, value: CatalogEntry[K]) => {
      const entry = catalog.payload.entries[0]!;
      const modified = signedCatalog({ ...entry, [key]: value });
      return new ArtifactVerifier(new CatalogClient({ [modified.signer.identity]: modified.signer.publicKey }, new InMemoryCatalogCheckpointStore()), publishers).verify({ ...request, catalog: modified });
    };
    await expect(invalid("manifestDigest", sha256(Buffer.from("wrong")))).rejects.toThrow(/Manifest digest/u);
    await expect(invalid("sbomDigest", sha256(Buffer.from("wrong")))).rejects.toThrow(/SBOM digest/u);
    await expect(new ArtifactVerifier(client, publishers).verify({ ...request, provenance: Buffer.from("{}") })).rejects.toThrow(/Provenance digest/u);
    expect(() => verifyHostedBuildProvenance({ ...JSON.parse(bundle.provenance.toString("utf8")), workflowIdentity: `${source.repository}/.github/workflows/other.yml@${"a".repeat(40)}` }, catalog.payload.entries[0]!, bundle.manifest.payloadDigest as `sha256:${string}`)).toThrow(/Provenance/u);
    await expect(new ArtifactVerifier(client, publishers).verify({ ...request, version: "1.0.1" })).rejects.toThrow(/not in the official catalog/u);
    await expect(new ArtifactVerifier(client, publishers).verify({ ...request, runtimeAbi: "2.0.0" })).rejects.toThrow(/runtime ABI/u);
    const unsupported = signedCatalog({ ...catalog.payload.entries[0]!, support: "unsupported" });
    const unsupportedClient = new CatalogClient({ [unsupported.signer.identity]: unsupported.signer.publicKey }, new InMemoryCatalogCheckpointStore());
    expect(await unsupportedClient.read(unsupported)).toHaveLength(1);
    await expect(new ArtifactVerifier(unsupportedClient, publishers).verify({ ...request, catalog: unsupported })).rejects.toThrow(/not currently installable/u);
    const revoked = signedCatalog({ ...catalog.payload.entries[0]!, revoked: true });
    const revokedClient = new CatalogClient({ [revoked.signer.identity]: revoked.signer.publicKey }, new InMemoryCatalogCheckpointStore());
    expect(await revokedClient.read(revoked)).toHaveLength(1);
    await expect(new ArtifactVerifier(revokedClient, publishers).verify({ ...request, catalog: revoked })).rejects.toThrow(/not currently installable/u);
    await expect(new ArtifactVerifier(client, {}).verify(request)).rejects.toThrow(/publisher/u);
    for (const entry of [
      { ...catalog.payload.entries[0]!, review: "pending" as const },
      { ...catalog.payload.entries[0]!, security: "advisory" as const }
    ]) {
      const blocked = signedCatalog(entry);
      const blockedClient = new CatalogClient({ [blocked.signer.identity]: blocked.signer.publicKey }, new InMemoryCatalogCheckpointStore());
      await expect(new ArtifactVerifier(blockedClient, publishers).verify({ ...request, catalog: blocked })).rejects.toThrow(/not currently installable/u);
    }
  });

  it("rejects a missing or divergent complete Hot Application manifest even when the envelope and catalog are resigned", async () => {
    const { bundle, catalog, client, publishers, request } = release();
    const mutate = (entries: Map<string, Buffer>) => createNormalizedTarGz([...entries].map(([path, bytes]) => ({ path, bytes })));
    const entries = extractNormalizedTarGz(bundle.artifact);
    entries.delete("schemas/hot-application-manifest.json");
    const missing = mutate(entries);
    const missingCatalog = signedCatalog({ ...catalog.payload.entries[0]!, artifactDigest: sha256(missing) });
    await expect(new ArtifactVerifier(new CatalogClient({ [missingCatalog.signer.identity]: missingCatalog.signer.publicKey }, new InMemoryCatalogCheckpointStore()), publishers).verify({ ...request, catalog: missingCatalog, artifact: missing })).rejects.toThrow(/unmanifested|missing schemas\/hot-application-manifest/u);

    const divergentEntries = extractNormalizedTarGz(bundle.artifact);
    const applicationManifestPath = "schemas/hot-application-manifest.json";
    const applicationManifest = Buffer.from(canonicalJson({ ...manifest, capabilities: [{ kind: "audit", required: true, reason: "Divergent authority.", operations: ["emit"] }] }));
    divergentEntries.set(applicationManifestPath, applicationManifest);
    const envelope = JSON.parse(divergentEntries.get("k-nex.app-bundle.json")!.toString("utf8"));
    envelope.files[applicationManifestPath] = { ...envelope.files[applicationManifestPath], digest: sha256(applicationManifest), bytes: applicationManifest.byteLength };
    envelope.applicationManifest.digest = sha256(applicationManifest);
    envelope.payloadDigest = sha256(Buffer.from(canonicalJson(envelope.files)));
    const sbom = JSON.parse(divergentEntries.get("sbom.cdx.json")!.toString("utf8"));
    sbom.components.find((component: { name: string }) => component.name === applicationManifestPath).hashes[0].content = sha256(applicationManifest).slice("sha256:".length);
    const sbomBytes = Buffer.from(canonicalJson(sbom));
    divergentEntries.set("sbom.cdx.json", sbomBytes);
    envelope.sbom.digest = sha256(sbomBytes);
    const provenance = JSON.parse(bundle.provenance.toString("utf8"));
    provenance.outputs = { ...provenance.outputs, payloadDigest: envelope.payloadDigest, sbomDigest: envelope.sbom.digest };
    const provenanceBytes = Buffer.from(canonicalJson(provenance));
    envelope.provenance.digest = sha256(provenanceBytes);
    const envelopeBytes = Buffer.from(canonicalJson(envelope));
    divergentEntries.set("k-nex.app-bundle.json", envelopeBytes);
    const divergent = mutate(divergentEntries);
    const divergentCatalog = signedCatalog({ ...catalog.payload.entries[0]!, artifactDigest: sha256(divergent), manifestDigest: sha256(envelopeBytes), sbomDigest: sha256(sbomBytes), provenanceDigest: sha256(provenanceBytes) });
    await expect(new ArtifactVerifier(new CatalogClient({ [divergentCatalog.signer.identity]: divergentCatalog.signer.publicKey }, new InMemoryCatalogCheckpointStore()), publishers).verify({ ...request, catalog: divergentCatalog, artifact: divergent, provenance: provenanceBytes })).rejects.toThrow(/diverges/u);
  });

  it("verifies the committed public-key-only signed official catalog fixture", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../fixtures/official-catalog.json", import.meta.url), "utf8"));
    expect(await new CatalogClient({ [fixture.signer.identity]: fixture.signer.publicKey }, new InMemoryCatalogCheckpointStore()).read(fixture)).toHaveLength(1);
  });

  it("rejects expired, replayed, revoked, and downgraded signed catalog indexes", async () => {
    const { catalog } = release();
    const keys = generateKeyPairSync("ed25519");
    const signer = { identity: "k-nex-checkpoint-catalog", publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
    const signed = (sequence: number, expiresAt: string, entry: CatalogEntry) => {
      const payload = { schemaVersion: 1 as const, sequence, expiresAt, entries: [entry] };
      return { schemaVersion: 1 as const, signer, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString("base64") };
    };
    const checkpoints = new InMemoryCatalogCheckpointStore();
    const client = new CatalogClient({ [signer.identity]: signer.publicKey }, checkpoints, () => Date.parse("2030-01-01T00:00:00.000Z"));
    const clear = catalog.payload.entries[0]!;
    const fresh = signed(2, "2030-01-02T00:00:00.000Z", clear);
    await expect(client.read(fresh)).resolves.toHaveLength(1);
    const restarted = new CatalogClient({ [signer.identity]: signer.publicKey }, checkpoints, () => Date.parse("2030-01-01T00:00:00.000Z"));
    await expect(restarted.read(signed(1, "2030-01-02T00:00:00.000Z", { ...clear, revoked: false }))).rejects.toThrow(/checkpoint|stale|replay/i);
    await expect(restarted.read(signed(3, "2029-12-31T00:00:00.000Z", clear))).rejects.toThrow(/expired/i);
    await expect(restarted.read(signed(3, "2030-01-02T00:00:00.000Z", { ...clear, revoked: true }))).resolves.toHaveLength(1);
    await expect(restarted.read(signed(4, "2030-01-02T00:00:00.000Z", { ...clear, version: "0.9.0" }))).rejects.toThrow(/downgrade|rollback/i);
    const racingHigh = new CatalogClient({ [signer.identity]: signer.publicKey }, checkpoints, () => Date.parse("2030-01-01T00:00:00.000Z"));
    const racingLow = new CatalogClient({ [signer.identity]: signer.publicKey }, checkpoints, () => Date.parse("2030-01-01T00:00:00.000Z"));
    const raced = await Promise.allSettled([
      racingHigh.read(signed(6, "2030-01-02T00:00:00.000Z", { ...clear, version: "1.2.0" })),
      racingLow.read(signed(5, "2030-01-02T00:00:00.000Z", { ...clear, version: "1.1.0" }))
    ]);
    expect(raced[0]?.status).toBe("fulfilled");
    await expect(restarted.read(signed(5, "2030-01-02T00:00:00.000Z", { ...clear, version: "1.1.0" }))).rejects.toThrow(/checkpoint|stale|replay/i);
  });

  it("revalidates accepted immutable bytes without applying later catalog freshness or checkpoint policy", async () => {
    const { request, publishers, catalog } = release();
    const keys = generateKeyPairSync("ed25519");
    const signer = { identity: "k-nex-accepted-catalog", publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
    const signed = (sequence: number, expiresAt: string) => {
      const payload = { schemaVersion: 1 as const, sequence, expiresAt, entries: catalog.payload.entries };
      return { schemaVersion: 1 as const, signer, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString("base64") };
    };
    const accepted = signed(1, "2030-01-01T00:00:00.000Z");
    const client = new CatalogClient({ [signer.identity]: signer.publicKey }, new InMemoryCatalogCheckpointStore(), () => Date.parse("2030-01-03T00:00:00.000Z"));
    const verifier = new ArtifactVerifier(client, publishers);
    await expect(verifier.verify({ ...request, catalog: accepted })).rejects.toThrow(/expired/u);
    await expect(verifier.verifyAccepted({ ...request, catalog: accepted })).resolves.toMatchObject({ artifactDigest: request.catalog.payload.entries[0]!.artifactDigest });
    await expect(client.read(signed(2, "2030-01-04T00:00:00.000Z"))).resolves.toHaveLength(1);
    await expect(verifier.verifyAccepted({ ...request, catalog: accepted })).resolves.toMatchObject({ manifest: { id: request.id } });
  });

  it("binds runner code to the verified owner, generation, artifact, and declared entrypoint", async () => {
    const { client, request, publishers } = release();
    const store = new VerifiedArtifactStore(new ArtifactVerifier(client, publishers));
    const owner = { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application" as const, extensionId: "app.sales-fixture", generationId: "sales-fixture-generation-1" };
    const staged = await store.stageForOwner(owner, request);
    const source = store.runnerSource();
    expect(source.load({ owner, artifactDigest: staged.artifactDigest, serverEntrypoint: "server/main.mjs" }).source).toContain("export const run");
    staged.verified.files.get("server/main.mjs")!.fill(0x20);
    expect(source.load({ owner, artifactDigest: staged.artifactDigest, serverEntrypoint: "server/main.mjs" }).source).toContain("export const run");
    expect(() => source.load({ owner, artifactDigest: staged.artifactDigest, serverEntrypoint: "server/not-declared.mjs" })).toThrow(/declared/u);
    const entrypoint = store.read(staged.artifactDigest)!.verified.files.get("server/main.mjs")!;
    entrypoint.fill(0x20);
    expect(source.load({ owner, artifactDigest: staged.artifactDigest, serverEntrypoint: "server/main.mjs" }).source).toContain("export const run");
  });

  it("rejects unknown catalog fields and invalid delivery-class-to-ID bindings at the catalog boundary", async () => {
    const { catalog, client } = release();
    await expect(client.read({ ...catalog, extra: true })).rejects.toThrow(/Invalid official catalog/u);
    const bad = { ...catalog, payload: { ...catalog.payload, entries: [{ ...catalog.payload.entries[0]!, deliveryClass: "theme-skin", id: "app.wrong" }] } };
    await expect(client.read(bad)).rejects.toThrow(/Invalid official catalog/u);
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
