import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as components from "@k-nex/ui-components";
import { componentInventory, type ComponentInventoryEntry } from "@k-nex/ui-components";
import { KNeXDesignSystemProvider, type SemanticPrimitives } from "@k-nex/ui-design-system-contracts";
import * as data from "@k-nex/ui-data";
import * as forms from "@k-nex/ui-forms";
import * as pages from "@k-nex/ui-pages";
import { resolveMinimalThemeProfile } from "@k-nex/theme-minimal";
import { resolveNeobrutalismThemeProfile } from "@k-nex/theme-neobrutalism";
import { createDataTableState, type DataTableDefinition } from "@k-nex/ui-data";
import { salesTasksTableDefinition } from "@k-nex/module-sales/pages";
import { componentEvidenceMap, componentStateEvidence, validateComponentEvidenceMap } from "../src/index.js";

const profile = (themeId: "theme.minimal" | "theme.neobrutalism", palette: string, revision: string) => ({
  schemaVersion: 1, id: `theme-profile.${revision}`, surface: "public", themeId, themeVersion: "1.0.0", palette, mode: "light", values: {},
  revision: { id: `theme-revision.${revision}`, number: 1, state: "published", createdAt: "2026-08-27T00:00:00.000Z", publishedAt: "2026-08-27T00:01:00.000Z" }
});
const themes = [resolveMinimalThemeProfile(profile("theme.minimal", "light", "family-minimal")), resolveNeobrutalismThemeProfile(profile("theme.neobrutalism", "primary", "family-neo"))];
const packages: Readonly<Record<string, Record<string, unknown>>> = { "@k-nex/ui-components": components, "@k-nex/ui-data": data, "@k-nex/ui-forms": forms, "@k-nex/ui-pages": pages };
const noop = (): void => undefined;

function props(name: string): Record<string, unknown> {
  const item = { id: "one", label: "One", href: "#one", title: "One", content: "One", value: "One", key: "One", children: [{ id: "child", label: "Child" }] };
  const definition = salesTasksTableDefinition as DataTableDefinition;
  const base: Record<string, unknown> = {
    children: name === "QueryBoundary" ? () => "Evidence" : "Evidence", label: `${name} evidence`, name: name.toLowerCase(), title: `${name} title`, description: "Description", triggerLabel: `Open ${name}`, closeLabel: "Close", href: "#evidence", src: "/evidence", alt: "Evidence", fallback: "E", citation: "Evidence", columns: [{ id: "title", label: "Title" }], rows: [{ id: "one", cells: { title: "One" } }], items: [item], options: [item], value: name === "TagInput" || name === "MultiSelect" ? ["one"] : name === "Slider" || name === "Rating" || name === "Stepper" || name === "NumberInput" ? 1 : "one", checked: false, selectedId: "one", onChange: noop, onPress: noop, onAction: noop, onSubmit: noop, onRetry: noop, templateId: `template.${name}`, step: 1, stepCount: 2, primary: "Primary", secondary: "Secondary", maxHeight: 100, ratio: 1, container: null, contain: false, restoreFocus: false, autoFocus: false, start: "2026-08-27", end: "2026-08-28", dirty: false, document: { schemaVersion: 1, blocks: [{ type: "paragraph", children: [{ type: "text", text: "Evidence" }] }] }, metric: { value: { kind: "integer", value: 1 } }, state: { state: "empty" }, definition, viewState: createDataTableState(definition), requestState: { state: "empty" }, getKey: (value: unknown) => String(value), renderItem: (value: unknown) => String(value), height: 72, estimateSize: 36, currentPage: 1, totalPages: 2
  };
  if (name === "FacetFilter") base.options = ["one"];
  if (name === "SortControl") base.fields = [{ id: "title", label: "Title" }];
  if (name === "ColumnChooser") base.visibility = { title: true };
  if (name === "BulkActionBar" || name === "RowActions") Object.assign(base, { actions: definition.bulkActions ?? definition.rowActions ?? [], selectionCount: 1 });
  if (name === "Pagination") Object.assign(base, { currentPage: 1, pageCount: 2, onPageChange: noop });
  if (name === "LoadMore" || name === "InfiniteList") Object.assign(base, { hasNext: true, onLoadMore: noop });
  if (name === "DetailPanel") base.onClose = noop;
  if (name === "SelectionSummary") base.count = 1;
  return base;
}

function renderFamily(name: string, component: unknown, primitives: SemanticPrimitives): string {
  return renderFamilyState(name, component, primitives, "default");
}

function stateProps(name: string, state: string): Record<string, unknown> {
  const base = props(name);
  const fieldNames = new Set(["ColorPicker", "Combobox", "DateInput", "DatePicker", "FileUpload", "FormField", "MultiSelect", "NumberInput", "PasswordInput", "SearchInput", "Select", "Slider", "Stepper", "TextInput", "Textarea", "TimeInput"]);
  if (fieldNames.has(name)) {
    if (state === "disabled") return { ...base, disabled: true };
    if (state === "read-only") return { ...base, readOnly: true };
    if (state === "invalid") return { ...base, error: "Invalid evidence" };
  }
  if (name === "Alert") return { ...base, tone: state };
  if (name === "Accordion") return { ...base, items: [{ id: "one", title: "One", content: "Evidence", open: state === "expanded" }] };
  if (name === "Button" && state === "disabled") return { ...base, isDisabled: true };
  if (name === "Checkbox" || name === "RadioButton" || name === "Toggle") {
    if (state === "selected") return { ...base, checked: true };
    if (state === "disabled") return { ...base, disabled: true };
    if (state === "invalid") return { ...base, error: "Invalid evidence" };
  }
  if (name === "DataTable" || name === "DataGrid") {
    const records = { fields: ["title"], rows: [{ key: "one", values: { title: { kind: "text", value: "One" } } }], page: { number: 1, pageSize: 25, hasNext: false } };
    if (state === "selected") return { ...base, requestState: { state: "success", data: records }, viewState: { ...createDataTableState(base.definition as DataTableDefinition), selectedRows: ["one"] } };
    if (["loading", "forbidden", "empty", "error", "success"].includes(state)) return { ...base, requestState: state === "success" ? { state, data: records } : state === "error" ? { state, problem: { code: "FAILED", status: 500 } } : { state } };
  }
  if (name === "DateRangePicker") return state === "disabled" ? { ...base, disabled: true } : state === "invalid" ? { ...base, error: "Invalid evidence" } : base;
  if (name === "Fieldset") return state === "disabled" ? { ...base, disabled: true } : base;
  if (name === "Form") return state === "pending" ? { ...base, pending: true } : base;
  if (name === "InfiniteList") return state === "loading" ? { ...base, loading: true } : base;
  if (name === "LoadMore") return state === "hidden" ? { ...base, hasNext: false } : state === "loading" ? { ...base, loading: true } : base;
  if (name === "Pagination") return state === "previous-disabled" ? { ...base, currentPage: 1, totalPages: 2 } : state === "next-disabled" ? { ...base, currentPage: 2, totalPages: 2 } : base;
  if (name === "Progress" || name === "ProgressBar") return state === "determinate" ? { ...base, value: 1 } : { ...base, value: undefined };
  if (name === "QueryBoundary") {
    if (state === "success") return { ...base, state: { state, data: "Evidence" } };
    if (state === "error") return { ...base, state: { state, problem: { code: "FAILED", status: 500 } } };
    return { ...base, state: { state } };
  }
  if (name === "RadioGroup" || name === "Rating") return state === "disabled" ? { ...base, disabled: true } : state === "invalid" ? { ...base, error: "Invalid evidence" } : base;
  if (name === "SegmentedControl") return state === "selected" ? { ...base, value: "one" } : base;
  if (name === "Tabs") return state === "disabled" ? { ...base, items: [{ id: "one", label: "One", content: "Evidence", disabled: true }] } : { ...base, items: [{ id: "one", label: "One", content: "Evidence" }], selectedId: state === "selected" ? "one" : undefined };
  if (name === "TreeView") return state === "selected" ? { ...base, selectedId: "one" } : state === "expanded" ? { ...base, expandedIds: ["one"] } : state === "collapsed" ? { ...base, expandedIds: [] } : base;
  return base;
}

function renderFamilyState(name: string, component: unknown, primitives: SemanticPrimitives, state: string): string {
  const family = createElement(component as ComponentType<Record<string, unknown>>, stateProps(name, state));
  return renderToStaticMarkup(<KNeXDesignSystemProvider primitives={primitives}><div data-evidence-family={name}>{family as ReactElement}</div></KNeXDesignSystemProvider>);
}

function assertStateMarkup(name: string, state: string, markup: string): void {
  if (["hover", "focus", "pressed"].includes(state)) return;
  if (state === "hidden") {
    expect(markup).not.toContain(`data-k-nex-component="${name === "LoadMore" ? "load-more" : name}"`);
    return;
  }
  if (name === "Accordion" && state === "collapsed") {
    expect(markup).not.toContain("<details open=\"\"");
    return;
  }
  if (state === "default" && ["Portal", "UnsavedChangesGuard"].includes(name)) {
    expect(markup).toContain(`data-evidence-family="${name}"`);
    return;
  }
  if (state === "success" && ["DataTable", "DataGrid"].includes(name)) {
    expect(markup).toContain("One");
    return;
  }
  if (state === "previous-disabled" || state === "next-disabled") {
    const label = state === "previous-disabled" ? "Previous page" : "Next page";
    expect(markup).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*aria-label="${label}"`));
    return;
  }
  const markers: Record<string, readonly string[]> = {
    "read-only": ["readOnly=\"\"", "data-state=\"read-only\""], disabled: ["disabled=\"\"", "data-disabled=\"true\"", "data-state=\"disabled\""], invalid: ["aria-invalid=\"true\"", "data-state=\"invalid\""],
    selected: ["aria-selected=\"true\"", "aria-checked=\"true\"", "data-state=\"selected\"", "checked=\"\""], expanded: ["open=\"\"", "aria-expanded=\"true\""],
    collapsed: ["aria-expanded=\"false\""],
    neutral: ["data-state=\"neutral\""], positive: ["data-state=\"positive\""], warning: ["data-state=\"warning\""], critical: ["data-state=\"critical\""],
    pending: ["data-state=\"pending\""], determinate: ["data-state=\"determinate\""], loading: ["data-state=\"loading\""], forbidden: ["data-state=\"forbidden\""],
    "insufficient-permission": ["data-state=\"insufficient-permission\""], empty: ["data-state=\"empty\""], error: ["data-state=\"error\""], stale: ["data-state=\"stale\""], success: ["data-state=\"success\""], ready: ["data-state=\"ready\""], default: ["data-k-nex-component="]
  };
  const expected = markers[state] ?? [`data-state="${state}"`];
  expect(expected.some((marker) => markup.includes(marker)), `${name}:${state}`).toBe(true);
}

describe("family conformance evidence", () => {
  it("fails closed when inventory families or test-class claims lack independent evidence", () => {
    const addedFamily = [...componentInventory, { ...componentInventory[0]!, id: "unproved-family", name: "UnprovedFamily" }] as readonly ComponentInventoryEntry[];
    expect(() => validateComponentEvidenceMap(addedFamily)).toThrow(/exactly cover/);
    const addedBrowserClaim = componentInventory.map((entry) => entry.name === "Card" ? { ...entry, testClasses: [...entry.testClasses, "browser" as const] } : entry);
    expect(() => validateComponentEvidenceMap(addedBrowserClaim)).toThrow(/Card/);
    expect(componentStateEvidence.filter(({ states }) => states.length === 1 && states[0] === "default")).toHaveLength(82);
  });

  it("renders every declared family under both themes and maps every declared test class", () => {
    validateComponentEvidenceMap();
    expect(componentEvidenceMap).toHaveLength(131);
    for (const entry of componentInventory) {
      const component = packages[entry.packageTarget]?.[entry.name];
      expect(component, entry.name).toBeTypeOf("function");
      for (const theme of themes) expect(() => renderFamily(entry.name, component, theme.primitives), `${entry.name}:${theme.themeId}`).not.toThrow();
    }
  });

  it("executes every declared observable state under both themes", () => {
    for (const evidence of componentStateEvidence) {
      const entry = componentInventory.find(({ name }) => name === evidence.family)!;
      const component = packages[entry.packageTarget]?.[entry.name];
      for (const state of evidence.states) for (const theme of themes) {
        const markup = renderFamilyState(entry.name, component, theme.primitives, state);
        assertStateMarkup(entry.name, state, markup);
      }
    }
  });
});
