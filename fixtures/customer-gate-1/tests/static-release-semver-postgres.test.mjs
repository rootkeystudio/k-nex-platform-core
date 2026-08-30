import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-static-release-semver", BOOT_KEY: "p9-static-release-semver" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

test("static release persistence accepts exact SemVer and rejects malformed identifiers", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("static_release_semver").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const insert = (version) => pool.query(
    `insert into runtime_static_release_requests (request_digest, application_id, environment, version, source_commit, change_plan_digest, change_json, authorization_json)
     values ($1, 'customer-alpha', 'production', $2, $3, $4, '{}'::jsonb, '{}'::jsonb)`,
    [digest(version), version, "a".repeat(40), digest("change")]
  );
  try {
    await boot(container.getConnectionUri());
    await assert.doesNotReject(insert("1.0.0-rc.1+build.2"));
    for (const version of ["1.0.0-01", "1.0.0-alpha..1", "1.0.0-.", "1.0.0+build..1"]) {
      await assert.rejects(insert(version), /runtime_static_release_requests_version_check/);
    }
  } finally {
    await pool.end();
    await container.stop();
  }
});
