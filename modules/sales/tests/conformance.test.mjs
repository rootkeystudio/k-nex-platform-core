import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { pluginContributionCategoryKeys } from "@k-nex/contracts";
import { instantiatePluginPageTemplate } from "@k-nex/runtime";

import {
  salesPageTemplates,
  salesPermissionDescriptors,
  salesRouteDescriptors,
  salesTaskCreateDescriptor,
  salesTasksDescriptor,
  salesUiBlockDescriptors
} from "../dist/contracts.js";

function assertTarget() {
  assert.equal(process.env.K_NEX_CONFORMANCE_PLUGIN_ID, "module.sales");
  assert.equal(process.env.K_NEX_CONFORMANCE_PLUGIN_PACKAGE, "@k-nex/module-sales");
}

function childEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

test("Sales manifest and registration inventory match every supported category", () => {
  assertTarget();
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../k-nex.plugin.json"), "utf8"));
  assert.equal(manifest.id, process.env.K_NEX_CONFORMANCE_PLUGIN_ID);
  assert.equal(manifest.package, process.env.K_NEX_CONFORMANCE_PLUGIN_PACKAGE);
  assert.deepEqual(Object.keys(manifest.contributions).sort(), [...pluginContributionCategoryKeys].sort());
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

test("Sales package proves deterministic inventory, fresh migration boot, and lifecycle transitions", () => {
  assertTarget();
  const root = resolve(import.meta.dirname, "../../..");
  const output = execFileSync("pnpm", ["--filter", "@k-nex/customer-gate-1", "run", "test:postgres"], {
    cwd: root, encoding: "utf8", env: childEnvironment(), maxBuffer: 64 * 1024 * 1024
  });
  assert.match(output, /proves customer-owned migrations and revision-aware Postgres boot/);
  assert.match(output, /pass 1/);
  assert.match(output, /fail 0/);
});

test("Sales sources actions tools events and realtime execute through platform boundaries", () => {
  assertTarget();
  const root = resolve(import.meta.dirname, "../../..");
  const eventOutput = execFileSync(process.execPath, [
    "--test", "--test-name-pattern=^Sales durable events project task and opportunity invalidations through the realtime gateway$",
    resolve(import.meta.dirname, "server.test.mjs")
  ], { cwd: root, encoding: "utf8", env: childEnvironment() });
  assert.match(eventOutput, /pass 1/);
  assert.match(eventOutput, /fail 0/);
  const toolOutput = execFileSync("pnpm", ["--filter", "@k-nex/module-sales", "run", "test:mcp"], {
    cwd: root, encoding: "utf8", env: childEnvironment(), maxBuffer: 64 * 1024 * 1024
  });
  assert.match(toolOutput, /Test Files\s+1 passed/);
  assert.match(toolOutput, /Tests\s+1 passed/);
});
