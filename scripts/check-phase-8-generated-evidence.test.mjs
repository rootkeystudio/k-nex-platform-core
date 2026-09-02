import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Gate 8 refuses local replacement of missing hosted signed evidence", () => {
  const result = spawnSync(process.execPath, ["scripts/check-phase-8-generated-evidence.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, P8_EVIDENCE_ROOT: "/missing/phase-8-v1-evidence" }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /P8_SIGNED_EVIDENCE_REGENERATION_REQUIRED/u);
});
