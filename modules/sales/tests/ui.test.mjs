import assert from "node:assert/strict";
import test from "node:test";

import { createPuckBuilderAdapter, reconcilePuckBlockContribution } from "@k-nex/builder-puck";
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeResult } from "@k-nex/ui-runtime";

import { salesTasksDescriptor } from "../dist/contracts.js";
import {
  salesTaskTableBlock,
  salesTaskTablePuckAuthoring
} from "../dist/ui.js";

const document = {
  id: "sales.page.tasks",
  version: 1,
  schemaVersion: 1,
  profile: "workspace",
  regions: {
    main: [{
      id: "sales-tasks",
      type: "sales.task-table",
      version: 2,
      props: { title: "Sales tasks" },
      bindings: {
        source: {
          source: { id: "sales.tasks", version: 1 },
          input: {},
          structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash,
          selectedFields: ["title", "status", "potential-revenue"]
        }
      }
    }]
  }
};
const actor = {
  authenticated: true,
  permissions: new Set([
    "sales.tasks.read", "sales.tasks.title.read", "sales.tasks.status.read", "sales.tasks.revenue.read"
  ])
};
const sourceResults = { "sales-tasks": { state: "empty" } };

test("Sales task table uses the same renderer outside Puck and through its authoring bridge", () => {
  const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [salesTaskTableBlock], sources: [salesTasksDescriptor] }));
  const production = presentUiRuntimeResult(runtime.render({ document, surface: "workspace", actor, sourceResults }));

  const bridge = reconcilePuckBlockContribution(salesTaskTableBlock, salesTaskTablePuckAuthoring);
  const adapter = createPuckBuilderAdapter({ blocks: [bridge], preview: { surface: "workspace", actor, sources: [salesTasksDescriptor], sourceResults } });
  const puckData = adapter.toPuckData(document);
  const component = adapter.config.components["sales.task-table__v2"];
  const editor = component.render(puckData.content[0].props);

  assert.equal(production, "Sales tasks (empty)");
  assert.equal(editor, production);
  assert.equal(adapter.fromPuckData(puckData).regions.main[0].type, "sales.task-table");
});
