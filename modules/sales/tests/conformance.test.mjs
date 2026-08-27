import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { PluginManifestSchema, pluginContributionCategoryKeys } from "@k-nex/contracts";
import { executeRegistration, instantiatePluginPageTemplate } from "@k-nex/runtime";

import {
  salesPageTemplates,
  salesPermissionDescriptors,
  salesRouteDescriptors,
  salesTaskCreateDescriptor,
  salesTasksDescriptor,
  salesUiBlockDescriptors
} from "../dist/contracts.js";
import { salesRegistration } from "../dist/server.js";

function assertTarget() {
  assert.equal(process.env.K_NEX_CONFORMANCE_PLUGIN_ID, "module.sales");
  assert.equal(process.env.K_NEX_CONFORMANCE_PLUGIN_PACKAGE, "@k-nex/module-sales");
}

test("Sales manifest and registration inventory match every supported category", () => {
  assertTarget();
  const manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(resolve(import.meta.dirname, "../k-nex.plugin.json"), "utf8")));
  assert.equal(manifest.id, process.env.K_NEX_CONFORMANCE_PLUGIN_ID);
  assert.equal(manifest.package, process.env.K_NEX_CONFORMANCE_PLUGIN_PACKAGE);
  assert.deepEqual(Object.keys(manifest.contributions).sort(), [...pluginContributionCategoryKeys].sort());
  const integrity = `sha512-${"a".repeat(86)}==`;
  const registration = executeRegistration({
    graph: { resolverVersion: "1.0.0", plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity, required: [], optional: [] }], capabilityProviders: [], registrationOrder: [manifest.id] },
    installed: [{ package: { name: manifest.package, version: manifest.version, integrity }, manifest }],
    registrations: [salesRegistration]
  });
  assert.deepEqual(registration.inventory[0].contributions, Object.fromEntries(pluginContributionCategoryKeys.map((kind) => [kind, Object.keys(manifest.contributions[kind]).sort()])));
});

test("Sales default page seeds once as a customer-owned document", async () => {
  assertTarget();
  const descriptor = salesPageTemplates.find(({ id }) => id === "sales.page.tasks");
  assert.ok(descriptor);
  let stored;
  const store = {
    read: async () => stored === undefined ? undefined : structuredClone(stored),
    createIfAbsent: async (candidate) => {
      if (stored !== undefined) return { created: false, instance: structuredClone(stored) };
      stored = structuredClone(candidate);
      return { created: true, instance: structuredClone(stored) };
    },
    replace: async () => undefined
  };
  const inventory = {
    capabilities: new Map(),
    routes: new Set(salesRouteDescriptors.map(({ id }) => id)),
    permissions: new Set(salesPermissionDescriptors.map(({ id }) => id)),
    sources: new Set([`${salesTasksDescriptor.id}@${salesTasksDescriptor.version}`]),
    actions: new Set([`${salesTaskCreateDescriptor.id}@${salesTaskCreateDescriptor.version}`]),
    blocks: new Set(salesUiBlockDescriptors.map(({ id, version }) => `${id}@${version}`))
  };
  assert.equal((await instantiatePluginPageTemplate(descriptor, inventory, store)).created, true);
  const retry = await instantiatePluginPageTemplate(descriptor, inventory, store);
  assert.equal(retry.created, false);
  assert.equal(retry.instance.ownership, "customer");
});
