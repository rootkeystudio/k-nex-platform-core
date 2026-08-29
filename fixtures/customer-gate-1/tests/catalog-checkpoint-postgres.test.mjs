import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { canonicalJson, CatalogClient } from "@k-nex/extension-bundler";
import { PostgresCatalogCheckpointStore } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const source = { repository: "https://github.com/k-nex/official-apps", commit: "0123456789abcdef0123456789abcdef01234567" };

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-10-catalog-checkpoint", BOOT_KEY: "p9-10-catalog-checkpoint" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function entry(version = "1.0.0") {
  const keys = generateKeyPairSync("ed25519");
  return {
    deliveryClass: "hot-application",
    id: "app.sales-fixture",
    version,
    runtimeAbi: "1.0.0",
    publisher: { identity: "k-nex-catalog-checkpoint-publisher", publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() },
    source: { ...source, assetUrl: "https://github.com/k-nex/official-apps/releases/download/v1.0.0/app.sales-fixture.tar.gz" },
    artifactDigest: `sha256:${"a".repeat(64)}`,
    manifestDigest: `sha256:${"b".repeat(64)}`,
    sbomDigest: `sha256:${"c".repeat(64)}`,
    provenanceDigest: `sha256:${"d".repeat(64)}`,
    support: "supported",
    review: "approved",
    security: "clear",
    revoked: false
  };
}

function catalog(signer, privateKey, sequence, release) {
  const payload = { schemaVersion: 1, sequence, expiresAt: "2030-01-02T00:00:00.000Z", entries: [release] };
  return { schemaVersion: 1, signer, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64") };
}

test("persists catalog checkpoints by owner and signer, rejects stale catalog races, and survives restart", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("catalog_checkpoint").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const keys = generateKeyPairSync("ed25519");
  const signer = { identity: "k-nex-catalog-checkpoint", publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
  const secondKeys = generateKeyPairSync("ed25519");
  const secondSigner = { identity: "k-nex-catalog-checkpoint-second", publicKey: secondKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
  const now = () => Date.parse("2030-01-01T00:00:00.000Z");
  try {
    await boot(container.getConnectionUri());
    const owner = { applicationId: "customer-alpha", environment: "production" };
    const first = new CatalogClient({ [signer.identity]: signer.publicKey }, new PostgresCatalogCheckpointStore(pool, owner), now);
    await first.read(catalog(signer, keys.privateKey, 2, entry("1.0.0")));

    const restarted = new CatalogClient({ [signer.identity]: signer.publicKey }, new PostgresCatalogCheckpointStore(pool, owner), now);
    await assert.rejects(restarted.read(catalog(signer, keys.privateKey, 1, entry("1.0.0"))), /checkpoint|stale|replay/i);
    await assert.rejects(restarted.read(catalog(signer, keys.privateKey, 3, entry("0.9.0"))), /downgrade/i);

    const ownerIsolated = new CatalogClient({ [signer.identity]: signer.publicKey }, new PostgresCatalogCheckpointStore(pool, { applicationId: "customer-beta", environment: "production" }), now);
    await ownerIsolated.read(catalog(signer, keys.privateKey, 1, entry("1.0.0")));
    const signerIsolated = new CatalogClient({ [secondSigner.identity]: secondSigner.publicKey }, new PostgresCatalogCheckpointStore(pool, owner), now);
    await signerIsolated.read(catalog(secondSigner, secondKeys.privateKey, 1, entry("1.0.0")));

    const racingHigh = new CatalogClient({ [signer.identity]: signer.publicKey }, new PostgresCatalogCheckpointStore(pool, owner), now);
    const racingLow = new CatalogClient({ [signer.identity]: signer.publicKey }, new PostgresCatalogCheckpointStore(pool, owner), now);
    const raced = await Promise.allSettled([
      racingHigh.read(catalog(signer, keys.privateKey, 5, entry("1.2.0"))),
      racingLow.read(catalog(signer, keys.privateKey, 4, entry("1.1.0")))
    ]);
    assert.ok(raced.some(({ status }) => status === "fulfilled"));
    const final = await new PostgresCatalogCheckpointStore(pool, owner).read(signer.identity);
    assert.equal(final?.sequence, 5);
    assert.equal(final?.highestVersions["hot-application:app.sales-fixture"], "1.2.0");
    await assert.rejects(restarted.read(catalog(signer, keys.privateKey, 4, entry("1.1.0"))), /checkpoint|stale|replay|downgrade/i);

    const rows = await pool.query("select application_id, environment, signer_identity, sequence::text sequence from runtime_catalog_checkpoints order by application_id, signer_identity");
    assert.deepEqual(rows.rows, [
      { application_id: "customer-alpha", environment: "production", signer_identity: signer.identity, sequence: "5" },
      { application_id: "customer-alpha", environment: "production", signer_identity: secondSigner.identity, sequence: "1" },
      { application_id: "customer-beta", environment: "production", signer_identity: signer.identity, sequence: "1" }
    ]);
  } finally {
    await pool.end();
    await container.stop();
  }
});
