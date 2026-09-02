import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { canonicalJson } from "@k-nex/contracts";
import { CatalogClient, InMemoryCatalogCheckpointStore } from "@k-nex/extension-bundler";

import { AcceptedExtensionCatalogSource } from "../src/accepted-extension-catalog-source.js";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

function signedCatalog(entries: readonly Record<string, unknown>[], expiresAt = "2030-01-02T00:00:00.000Z") {
  const payload = { schemaVersion: 1, sequence: 7, expiresAt, entries } as const;
  return {
    schemaVersion: 1 as const,
    signer: { identity: "catalog-signer", publicKey },
    payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString("base64")
  } as const;
}

function entry(input: Readonly<{ deliveryClass: "hot-application" | "theme-skin"; id: string; version: string; support?: "supported" | "deprecated" | "unsupported"; review?: "approved" | "pending" | "rejected"; security?: "clear" | "advisory" | "compromised"; revoked?: boolean }>) {
  return {
    deliveryClass: input.deliveryClass,
    id: input.id,
    version: input.version,
    runtimeAbi: "1.0.0",
    publisher: { identity: "catalog-publisher", publicKey },
    source: {
      repository: "https://github.com/k-nex/official-apps",
      commit: "0123456789abcdef0123456789abcdef01234567",
      assetUrl: `https://github.com/k-nex/official-apps/releases/download/v${input.version}/${input.id}.tar.gz`
    },
    artifactDigest: `sha256:${"a".repeat(64)}`,
    manifestDigest: `sha256:${"b".repeat(64)}`,
    sbomDigest: `sha256:${"c".repeat(64)}`,
    provenanceDigest: `sha256:${"d".repeat(64)}`,
    support: input.support ?? "supported",
    review: input.review ?? "approved",
    security: input.security ?? "clear",
    revoked: input.revoked ?? false
  } as const;
}

function snapshot(catalog: ReturnType<typeof signedCatalog>) {
  return {
    snapshotId: "catalog-snapshot-1",
    signedCatalog: catalog,
    signerIdentity: catalog.signer.identity,
    sequence: catalog.payload.sequence,
    digest: `sha256:${createHash("sha256").update(canonicalJson(catalog.payload)).digest("hex")}`,
    releaseCount: catalog.payload.entries.length,
    observedAt: "2026-09-02T00:00:00.000Z"
  } as const;
}

function source(accepted: ReturnType<typeof snapshot> | undefined) {
  const mirror = { readAcceptedSnapshot: vi.fn(async () => accepted) };
  const catalog = new CatalogClient(
    { "catalog-signer": publicKey },
    new InMemoryCatalogCheckpointStore(),
    () => Date.parse("2030-01-01T00:00:00.000Z")
  );
  return { mirror, source: new AcceptedExtensionCatalogSource(mirror as never, catalog) };
}

describe("AcceptedExtensionCatalogSource", () => {
  it("maps the accepted dynamic catalog to immutable, sorted live-generation records", async () => {
    const accepted = snapshot(signedCatalog([
      entry({ deliveryClass: "theme-skin", id: "skin.night", version: "1.0.0", support: "deprecated", review: "pending", security: "advisory", revoked: true }),
      entry({ deliveryClass: "hot-application", id: "app.weather", version: "2.0.0" })
    ]));

    const result = await source(accepted).source.list();

    expect(result).toEqual([
      { extension: { deliveryClass: "hot-application", id: "app.weather" }, version: "2.0.0", displayName: "app.weather", support: "supported", review: "approved", security: "clear", revoked: false, availability: "live-generation" },
      { extension: { deliveryClass: "theme-skin", id: "skin.night" }, version: "1.0.0", displayName: "skin.night", support: "deprecated", review: "pending", security: "advisory", revoked: true, availability: "live-generation" }
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0]!)).toBe(true);
  });

  it("fails closed when there is no accepted snapshot", async () => {
    await expect(source(undefined).source.list()).rejects.toThrow("Accepted catalog snapshot is unavailable");
  });

  it("rejects an expired or forged accepted mirror", async () => {
    const expired = snapshot(signedCatalog([entry({ deliveryClass: "hot-application", id: "app.weather", version: "1.0.0" })], "2029-12-31T00:00:00.000Z"));
    await expect(source(expired).source.list()).rejects.toThrow("expired");

    const accepted = snapshot(signedCatalog([entry({ deliveryClass: "hot-application", id: "app.weather", version: "1.0.0" })]));
    const forged = { ...accepted, signedCatalog: { ...accepted.signedCatalog, signature: "a".repeat(88) } };
    await expect(source(forged as never).source.list()).rejects.toThrow("signature");
  });

  it("rejects durable pointer metadata that does not match the verified snapshot", async () => {
    const accepted = snapshot(signedCatalog([entry({ deliveryClass: "hot-application", id: "app.weather", version: "1.0.0" })]));

    await expect(source({ ...accepted, signerIdentity: "other-signer" } as never).source.list()).rejects.toThrow("metadata");
    await expect(source({ ...accepted, sequence: 8 } as never).source.list()).rejects.toThrow("metadata");
    await expect(source({ ...accepted, digest: `sha256:${"e".repeat(64)}` } as never).source.list()).rejects.toThrow("metadata");
    await expect(source({ ...accepted, releaseCount: 2 } as never).source.list()).rejects.toThrow("metadata");
  });
});
