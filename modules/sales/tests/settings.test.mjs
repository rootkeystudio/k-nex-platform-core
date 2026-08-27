import assert from "node:assert/strict";
import test from "node:test";

import { PluginSettingsService } from "@k-nex/runtime";

import { salesWorkspacePresentation } from "../dist/browser.js";
import { salesWorkspaceSettingsDefinition } from "../dist/server.js";

test("Sales persisted settings enforce read/change permissions and drive workspace presentation", async () => {
  let document = {
    settingsId: "sales.settings.workspace", schemaVersion: 1, revision: 3,
    values: { defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks", pipelineStages: ["lead", "qualified", "won", "lost"] }
  };
  const service = new PluginSettingsService({
    read: async () => structuredClone(document),
    replace: async (candidate, expectedRevision) => {
      if (document.revision !== expectedRevision) return undefined;
      document = structuredClone(candidate);
      return structuredClone(document);
    }
  });
  const readActor = { permissions: new Set(["sales.settings.read"]) };
  const changeActor = { permissions: new Set(["sales.settings.write"]) };
  await assert.rejects(service.read(salesWorkspaceSettingsDefinition, { permissions: new Set() }), (error) => error.code === "ACCESS_DENIED");
  await assert.rejects(service.change({
    definition: salesWorkspaceSettingsDefinition, actor: readActor, expectedRevision: 3, values: document.values
  }), (error) => error.code === "ACCESS_DENIED");
  const changed = await service.change({
    definition: salesWorkspaceSettingsDefinition,
    actor: changeActor,
    expectedRevision: 3,
    values: { ...document.values, defaultTaskPageSize: 50, showPotentialRevenue: false, defaultPage: "opportunities" }
  });
  assert.deepEqual(salesWorkspacePresentation(changed.values), {
    routeId: "sales.route.opportunities", taskPageSize: 50, showPotentialRevenue: false,
    pipelineStages: ["lead", "qualified", "won", "lost"]
  });
  assert.equal((await service.read(salesWorkspaceSettingsDefinition, readActor)).revision, 4);
  await assert.rejects(service.change({
    definition: salesWorkspaceSettingsDefinition, actor: changeActor, expectedRevision: 3, values: changed.values
  }), (error) => error.code === "REVISION_CONFLICT");
  await assert.rejects(service.change({
    definition: salesWorkspaceSettingsDefinition, actor: changeActor, expectedRevision: 4,
    values: { ...changed.values, apiKey: "must-never-be-a-setting" }
  }), (error) => error.code === "FIELD_UNKNOWN");
});
