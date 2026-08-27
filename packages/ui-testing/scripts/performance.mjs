import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";

import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Combobox } from "../../ui-forms/dist/index.js";
import { TreeView } from "../../ui-components/dist/index.js";
import { DataTable, VirtualList, createDataTableController, createDataTableState } from "../../ui-data/dist/index.js";
import { salesTasksTableDefinition } from "../../../modules/sales/dist/pages.js";

const root = new URL("../../../", import.meta.url).pathname;
const bundles = {
  components: 'import {Button} from "./packages/ui-components/dist/index.js"; export {Button};',
  dataTable: 'import {DataTable} from "./packages/ui-data/dist/data-table.js"; export {DataTable};',
  richTextEditor: 'import {RichTextEditor} from "./packages/ui-data/dist/rich-text-editor.js"; export {RichTextEditor};',
  salesPages: 'import {SalesTasksPage} from "./modules/sales/dist/pages.js"; export {SalesTasksPage};'
};
const bundleBudgets = { components: 45_000, dataTable: 65_000, richTextEditor: 120_000, salesPages: 150_000 };
const bundleBytes = {};
for (const [name, contents] of Object.entries(bundles)) {
  const output = await build({ stdin: { contents, resolveDir: root, sourcefile: `${name}.js` }, bundle: true, format: "esm", minify: true, treeShaking: true, write: false });
  const bytes = gzipSync(output.outputFiles[0].contents).byteLength;
  bundleBytes[name] = bytes;
  assert(bytes <= bundleBudgets[name], `${name} gzip bundle ${bytes} exceeds ${bundleBudgets[name]}`);
  if (name !== "richTextEditor") assert.equal(output.outputFiles[0].text.includes("LexicalEditor"), false, `${name} unexpectedly bundles Lexical`);
}

const rows = Array.from({ length: 1_000 }, (_, index) => ({ key: `task-${index}`, values: { title: { kind: "text", value: `Task ${index}` }, status: { kind: "status", value: index % 2 === 0 ? "open" : "done" }, "potential-revenue": { kind: "money", value: String(index), currency: "USD", scale: 2 } } }));
const records = { fields: ["title", "status", "potential-revenue"], rows, page: { number: 1, pageSize: 100, hasNext: false } };
const state = createDataTableState(salesTasksTableDefinition);
let start = performance.now();
const tableMarkup = renderToStaticMarkup(React.createElement(DataTable, { definition: salesTasksTableDefinition, viewState: state, requestState: { state: "success", data: records } }));
const normalTableMs = performance.now() - start;
assert(tableMarkup.includes("Task 999") && normalTableMs < 1_500, `1,000-row table render exceeded 1.5s: ${normalTableMs}`);

const items = Array.from({ length: 10_000 }, (_, index) => `Row ${index}`);
start = performance.now();
const virtualMarkup = renderToStaticMarkup(React.createElement(VirtualList, { label: "Virtual rows", items, getKey: (item) => item, renderItem: (item) => item, window: { start: 5_000, size: 50 } }));
const virtualListMs = performance.now() - start;
assert(virtualMarkup.includes("Row 5000") && !virtualMarkup.includes("Row 4999") && virtualListMs < 250, `10,000-row virtual window exceeded 250ms: ${virtualListMs}`);

const controller = createDataTableController(salesTasksTableDefinition);
start = performance.now();
for (let index = 0; index < 1_000; index += 1) controller.controls({ ...state, search: `task-${index}`, pagination: { mode: "offset", page: index + 1, size: 25 } });
const queryChurnMs = performance.now() - start;
assert(queryChurnMs < 500, `1,000 query-state transitions exceeded 500ms: ${queryChurnMs}`);

const options = Array.from({ length: 1_000 }, (_, index) => ({ id: `option-${index}`, label: `Option ${index}` }));
const tree = Array.from({ length: 1_000 }, (_, index) => ({ id: `node-${index}`, label: `Node ${index}` }));
start = performance.now();
renderToStaticMarkup(React.createElement(React.Fragment, null, React.createElement(Combobox, { name: "large", label: "Large options", value: "", options, onChange: () => undefined }), React.createElement(TreeView, { label: "Large tree", items: tree })));
const largeCollectionMs = performance.now() - start;
assert(largeCollectionMs < 1_000, `large collections exceeded 1s: ${largeCollectionMs}`);

console.log(JSON.stringify({ bundleGzipBytes: bundleBytes, normalTableMs: Math.round(normalTableMs * 100) / 100, virtualListMs: Math.round(virtualListMs * 100) / 100, queryChurnMs: Math.round(queryChurnMs * 100) / 100, largeCollectionMs: Math.round(largeCollectionMs * 100) / 100 }, null, 2));
console.log("P7_COMPONENT_PERFORMANCE_PASS");
