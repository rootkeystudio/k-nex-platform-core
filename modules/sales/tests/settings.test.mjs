import assert from "node:assert/strict";
import { test } from "node:test";

import { validateSystemSettingsValues } from "@k-nex/runtime";

import { salesWorkspacePresentation } from "../dist/browser.js";
import { salesDefaultSettings, salesWorkspaceSettingsDescriptor } from "../dist/server.js";

test("Sales persisted settings enforce read/change permissions and drive workspace presentation", () => {
  assert.equal(salesWorkspaceSettingsDescriptor.readPermission, "sales.settings.read");
  assert.equal(salesWorkspaceSettingsDescriptor.changePermission, "sales.settings.write");
  assert.deepEqual(salesDefaultSettings, {
    defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks",
    pipelineStages: ["lead", "qualified", "won", "lost"]
  });
  const changed = validateSystemSettingsValues(salesWorkspaceSettingsDescriptor, {
    ...salesDefaultSettings, defaultTaskPageSize: 50, showPotentialRevenue: false, defaultPage: "opportunities"
  });
  assert.deepEqual(salesWorkspacePresentation(changed), {
    routeId: "sales.route.opportunities", taskPageSize: 50, showPotentialRevenue: false,
    pipelineStages: ["lead", "qualified", "won", "lost"]
  });
  assert.throws(() => validateSystemSettingsValues(salesWorkspaceSettingsDescriptor, {
    ...changed, apiKey: "must-never-be-a-setting"
  }), (error) => error.code === "FIELD_UNKNOWN");
});
