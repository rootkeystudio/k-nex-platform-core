import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const topologyProcess = join(fixtureDirectory, "static-deployment", "topology-process.mjs");
const PROBE_LINE_STARTUP_TIMEOUT_MS = 10_000;

function startProbe(environment) {
  const child = spawn(process.execPath, [topologyProcess], {
    cwd: fixtureDirectory,
    env: {
      ...process.env,
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
      P9_PROCESS_ROLE: "artifact-wait-probe",
      P9_PROCESS_INSTANCE: "artifact-wait-probe",
      ...environment
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const lines = [];
  const listeners = new Set();
  const receive = (chunk) => {
    output += chunk;
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("{")) continue;
      try {
        const value = JSON.parse(line);
        lines.push(value);
        for (const listener of listeners) listener(value);
      } catch { /* retain malformed process output for diagnostics */ }
    }
  };
  child.stdout.setEncoding("utf8").on("data", receive);
  child.stderr.setEncoding("utf8").on("data", receive);
  return {
    output: () => output,
    exited: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    line(predicate) {
      const existing = lines.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error(`Probe did not emit the expected line: ${output}`));
        }, PROBE_LINE_STARTUP_TIMEOUT_MS);
        const listener = (value) => {
          if (!predicate(value)) return;
          clearTimeout(timeout);
          listeners.delete(listener);
          resolve(value);
        };
        listeners.add(listener);
      });
    }
  };
}

test("static topology validates and propagates the bounded artifact wait timeout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "knex-p9-artifact-wait-"));
  const artifactPath = join(directory, "artifact.json");
  try {
    const probe = startProbe({ P9_ARTIFACT_WAIT_TIMEOUT_MS: "2000", P9_ARTIFACT_WAIT_PROBE_PATH: artifactPath });
    const ready = await probe.line((value) => value.type === "ready");
    assert.equal(ready.artifactWaitTimeout, 2000);
    await writeFile(artifactPath, "{\"state\":\"ready\"}\n");
    const complete = await probe.line((value) => value.type === "artifact-wait-complete");
    assert.deepEqual(complete, { type: "artifact-wait-complete", artifactWaitTimeout: 2000, artifact: { state: "ready" } });
    assert.deepEqual(await probe.exited, { code: 0, signal: null });

    const timeoutProbe = startProbe({ P9_ARTIFACT_WAIT_TIMEOUT_MS: "25", P9_ARTIFACT_WAIT_PROBE_PATH: join(directory, "missing.json") });
    await timeoutProbe.line((value) => value.type === "ready");
    const startedAt = Date.now();
    assert.deepEqual(await timeoutProbe.exited, { code: 1, signal: null });
    assert.ok(Date.now() - startedAt < 2_000, "The small artifact timeout must not fall back to the historical 120-second wait.");
    assert.match(timeoutProbe.output(), /Timed out waiting for .*missing\.json/u);

    const invalidProbe = startProbe({ P9_ARTIFACT_WAIT_TIMEOUT_MS: "0", P9_ARTIFACT_WAIT_PROBE_PATH: artifactPath });
    assert.deepEqual(await invalidProbe.exited, { code: 1, signal: null });
    assert.match(invalidProbe.output(), /P9_ARTIFACT_WAIT_TIMEOUT_MS must be an integer between 1 and 480000/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
