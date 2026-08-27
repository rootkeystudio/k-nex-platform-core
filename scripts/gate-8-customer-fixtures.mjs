import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApplicationManifestSchema } from "../packages/contracts/dist/index.js";
import { DeploymentReceiptSchema, RuntimeInventorySchema } from "../packages/contracts/dist/index.js";
import { reconcileDeploymentReceipt } from "../packages/runtime/dist/index.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromComposition = createRequire(resolve(repositoryRoot, "packages/composition/package.json"));
const YAML = requireFromComposition("yaml");
const selected = process.argv[2] === "--customer" ? [process.argv[3]] : ["customer-alpha", "customer-beta"];
const evidence = [];

for (const customer of selected) {
  assert.ok(customer === "customer-alpha" || customer === "customer-beta");
  const root = resolve(repositoryRoot, "fixtures", customer);
  const manifest = ApplicationManifestSchema.parse(JSON.parse(readFileSync(resolve(root, "k-nex.app.json"), "utf8")));
  const overrides = JSON.parse(readFileSync(resolve(root, "customer-overrides.json"), "utf8"));
  const lockContent = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
  const lock = YAML.parse(lockContent);
  const inventory = RuntimeInventorySchema.parse(JSON.parse(readFileSync(resolve(root, "runtime-inventory.json"), "utf8")));
  const receipt = DeploymentReceiptSchema.parse(JSON.parse(readFileSync(resolve(root, "deployment-receipt.json"), "utf8")));
  const release = JSON.parse(readFileSync(resolve(repositoryRoot, `releases/${inventory.platformRelease}/package-release-manifest.json`), "utf8"));
  const salesRelease = release.packages.find((entry) => entry.package === "@k-nex/module-sales");
  assert.deepEqual(manifest.plugins, [{ id: "module.sales", package: "@k-nex/module-sales", version: salesRelease?.version, enabled: true }]);
  assert.deepEqual(Object.keys(lock.importers), ["."]);
  const packedDependencies = Object.entries(lock.importers["."].dependencies).filter(([name]) => name.startsWith("@k-nex/"));
  assert.ok(packedDependencies.length >= 14);
  for (const [name, resolution] of packedDependencies) {
    assert.match(resolution.specifier, /^file:\.\.\/customer-gate-1\/packages\/k-nex-[a-z-]+-\d+\.\d+\.\d+\.tgz$/u, `${name} must resolve from the packed release mirror.`);
    assert.ok(existsSync(resolve(root, resolution.specifier.slice(5))), `${name} packed artifact is missing.`);
  }
  assert.equal(Object.keys(lock.packages).some((key) => key.includes("link:")), false);
  for (const [key, entry] of Object.entries(lock.packages).filter(([key]) => key.startsWith("@k-nex/"))) {
    assert.match(entry.resolution?.integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/u, `${key} lacks packed integrity.`);
  }
  assert.equal(overrides.schemaVersion, 1);
  assert.ok([25, 50].includes(overrides.salesSettings.defaultTaskPageSize));
  assert.ok(overrides.defaultPages.every((page) => page.startsWith("sales.page.")));
  assert.ok(Object.keys(overrides.permissions).length === 1 && overrides.layout.role in overrides.permissions);
  assert.match(overrides.releaseRevision, new RegExp(`^${customer}/`, "u"));
  assert.equal(inventory.applicationId, customer);
  assert.deepEqual(inventory.plugins, manifest.plugins);
  assert.equal(inventory.settings.every((entry) => !("values" in entry)), true);
  assert.equal(reconcileDeploymentReceipt(receipt, inventory), true);
  evidence.push({
    customer,
    database: manifest.development.database.mode,
    theme: manifest.themes.active,
    pageSize: overrides.salesSettings.defaultTaskPageSize,
    releaseCadence: overrides.releaseCadence,
    releaseRevision: overrides.releaseRevision,
    lockDigest: createHash("sha256").update(lockContent).digest("hex")
  });
}

if (evidence.length === 2) {
  for (const key of ["database", "theme", "pageSize", "releaseCadence", "releaseRevision", "lockDigest"]) {
    assert.notEqual(evidence[0][key], evidence[1][key], `${key} must differ between customers`);
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\nP8_6_CUSTOMER_FIXTURES_PASS\n`);
}
