import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GENERATED_APPLICATION_COMMAND_TIMEOUT_MS,
  GENERATED_APPLICATION_BUILD_TIMEOUT_MS,
  generatedApplicationCommandTimeout
} from "./generated-application-command.mjs";

test("bounds generated application builds separately from short fixture commands", () => {
  assert.equal(generatedApplicationCommandTimeout("pnpm", ["build"]), GENERATED_APPLICATION_BUILD_TIMEOUT_MS);
  assert.equal(generatedApplicationCommandTimeout("pnpm", ["install", "--frozen-lockfile"]), DEFAULT_GENERATED_APPLICATION_COMMAND_TIMEOUT_MS);
  assert.equal(generatedApplicationCommandTimeout("pnpm", ["knex:migrate"]), DEFAULT_GENERATED_APPLICATION_COMMAND_TIMEOUT_MS);
  assert.equal(generatedApplicationCommandTimeout("node", ["dist/k-nex-bootstrap-owner.js"]), DEFAULT_GENERATED_APPLICATION_COMMAND_TIMEOUT_MS);
  assert.equal(GENERATED_APPLICATION_BUILD_TIMEOUT_MS, 300_000);
  assert.equal(DEFAULT_GENERATED_APPLICATION_COMMAND_TIMEOUT_MS, 120_000);
});
