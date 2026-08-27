import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateGate6 } from "./gate-6.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

async function copy(source, target) {
  await mkdir(resolve(target, ".."), { recursive: true });
  await cp(resolve(repositoryRoot, source), target);
}

async function createSquashSnapshot() {
  const root = await mkdtemp(join(tmpdir(), "k-nex-gate-6-squash-"));
  await Promise.all([
    copy("docs/plugin-authoring.md", resolve(root, "docs/plugin-authoring.md")),
    copy("docs/generated/module-sales-reference.md", resolve(root, "docs/generated/module-sales-reference.md")),
    copy("docs/implementation/phase-6-result.md", resolve(root, "docs/implementation/phase-6-result.md")),
    copy("modules/sales/k-nex.plugin.json", resolve(root, "modules/sales/k-nex.plugin.json")),
    copy("modules/sales/package.json", resolve(root, "modules/sales/package.json")),
    copy("modules/sales/k-nex.conformance.json", resolve(root, "modules/sales/k-nex.conformance.json"))
  ]);
  return root;
}

test("Gate 6 validates a squash-style artifact snapshot without Git topology", async () => {
  const root = await createSquashSnapshot();
  try {
    assert.equal(existsSync(resolve(root, ".git")), false);
    assert.equal((await validateGate6(root)).referencePlugin, "module.sales");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Gate 6 rejects stale generated artifacts and missing task evidence in a squash snapshot", async () => {
  const root = await createSquashSnapshot();
  try {
    const generatedReference = resolve(root, "docs/generated/module-sales-reference.md");
    await writeFile(generatedReference, "stale generated reference\n");
    await assert.rejects(validateGate6(root), /Generated Sales reference documentation is stale/);

    await copy("docs/generated/module-sales-reference.md", generatedReference);
    const result = resolve(root, "docs/implementation/phase-6-result.md");
    await writeFile(result, (await readFile(result, "utf8")).replaceAll("P6.10", "P6.XX"));
    await assert.rejects(validateGate6(root), /Phase 6 result is missing task mapping: P6.10/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
