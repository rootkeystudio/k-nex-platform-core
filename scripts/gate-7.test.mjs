import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateGate7 } from "./gate-7.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

async function copy(source, target) {
  await mkdir(resolve(target, ".."), { recursive: true });
  await cp(resolve(repositoryRoot, source), target);
}

async function createSquashSnapshot() {
  const root = await mkdtemp(join(tmpdir(), "k-nex-gate-7-squash-"));
  await Promise.all([
    copy("docs/implementation/phase-7-result.md", resolve(root, "docs/implementation/phase-7-result.md")),
    copy("modules/sales/src/pages.tsx", resolve(root, "modules/sales/src/pages.tsx")),
    copy("packages/ui-components/package.json", resolve(root, "packages/ui-components/package.json")),
    copy("packages/ui-data/package.json", resolve(root, "packages/ui-data/package.json"))
  ]);
  return root;
}

test("Gate 7 validates a squash-style artifact snapshot without Git topology", async () => {
  const root = await createSquashSnapshot();
  try {
    assert.equal(existsSync(resolve(root, ".git")), false);
    assert.equal((await validateGate7(root)).executableFamilies, 131);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Gate 7 rejects missing task evidence in a squash snapshot", async () => {
  const root = await createSquashSnapshot();
  try {
    const result = resolve(root, "docs/implementation/phase-7-result.md");
    await writeFile(result, (await readFile(result, "utf8")).replaceAll("P7.10", "P7.XX"));
    await assert.rejects(validateGate7(root), /Phase 7 result is missing task mapping: P7.10/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
