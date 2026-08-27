import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateGate6 } from "./gate-6.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

async function copy(source, target) {
  await mkdir(resolve(target, ".."), { recursive: true });
  await cp(resolve(repositoryRoot, source), target);
}

test("Gate 6 validates a squash-style artifact snapshot without Git topology", async () => {
  const root = await mkdtemp(join(tmpdir(), "k-nex-gate-6-squash-"));
  try {
    await Promise.all([
      copy("docs/plugin-authoring.md", resolve(root, "docs/plugin-authoring.md")),
      copy("docs/generated/module-sales-reference.md", resolve(root, "docs/generated/module-sales-reference.md")),
      copy("docs/implementation/phase-6-result.md", resolve(root, "docs/implementation/phase-6-result.md")),
      copy("modules/sales/k-nex.plugin.json", resolve(root, "modules/sales/k-nex.plugin.json")),
      copy("modules/sales/package.json", resolve(root, "modules/sales/package.json")),
      copy("modules/sales/k-nex.conformance.json", resolve(root, "modules/sales/k-nex.conformance.json"))
    ]);
    assert.equal(existsSync(resolve(root, ".git")), false);
    assert.equal((await validateGate6(root)).referencePlugin, "module.sales");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
