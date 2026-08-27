import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as components from "@k-nex/ui-components";
import { componentInventory } from "@k-nex/ui-components";
import { KNeXDesignSystemProvider, type SemanticPrimitives } from "@k-nex/ui-design-system-contracts";
import * as data from "@k-nex/ui-data";
import * as forms from "@k-nex/ui-forms";
import * as pages from "@k-nex/ui-pages";
import { resolveMinimalThemeProfile } from "@k-nex/theme-minimal";
import { resolveNeobrutalismThemeProfile } from "@k-nex/theme-neobrutalism";
import { createDataTableState, type DataTableDefinition } from "@k-nex/ui-data";
import { salesTasksTableDefinition } from "@k-nex/module-sales/pages";
import { componentEvidenceMap, validateComponentEvidenceMap } from "../src/index.js";

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
    children: name === "QueryBoundary" ? () => "Evidence" : "Evidence", label: `${name} evidence`, name: name.toLowerCase(), title: `${name} title`, description: "Description", triggerLabel: `Open ${name}`, closeLabel: "Close", href: "#evidence", src: "/evidence", alt: "Evidence", fallback: "E", citation: "Evidence", columns: [{ id: "title", label: "Title" }], rows: [{ id: "one", cells: { title: "One" } }], items: [item], options: [item], value: name === "TagInput" || name === "MultiSelect" ? ["one"] : name === "Slider" || name === "Rating" || name === "Stepper" || name === "NumberInput" ? 1 : "one", checked: false, selectedId: "one", onChange: noop, onPress: noop, onAction: noop, onSubmit: noop, onRetry: noop, templateId: `template.${name}`, step: 1, stepCount: 2, primary: "Primary", secondary: "Secondary", maxHeight: 100, ratio: 1, container: null, contain: false, restoreFocus: false, autoFocus: false, start: "2026-08-27", end: "2026-08-28", dirty: false, document: { schemaVersion: 1, blocks: [{ type: "paragraph", children: [{ type: "text", text: "Evidence" }] }] }, metric: { value: { kind: "integer", value: 1 } }, state: { state: "empty" }, definition, viewState: createDataTableState(definition), requestState: { state: "empty" }, getKey: (value: unknown) => String(value), renderItem: (value: unknown) => String(value), height: 72, estimateSize: 36
  };
  if (name === "FacetFilter") base.options = ["one"];
  if (name === "SortControl") base.fields = [{ id: "title", label: "Title" }];
  if (name === "ColumnChooser") base.visibility = { title: true };
  if (name === "BulkActionBar" || name === "RowActions") base.actions = definition.bulkActions ?? definition.rowActions ?? [];
  if (name === "Pagination") Object.assign(base, { currentPage: 1, pageCount: 2, onPageChange: noop });
  if (name === "LoadMore" || name === "InfiniteList") Object.assign(base, { hasNext: true, onLoadMore: noop });
  if (name === "DetailPanel") base.onClose = noop;
  if (name === "SelectionSummary") base.count = 1;
  return base;
}

function renderFamily(name: string, component: unknown, primitives: SemanticPrimitives): string {
  const family = createElement(component as ComponentType<Record<string, unknown>>, props(name));
  return renderToStaticMarkup(<KNeXDesignSystemProvider primitives={primitives}><div data-evidence-family={name}>{family as ReactElement}</div></KNeXDesignSystemProvider>);
}

describe("family conformance evidence", () => {
  it("renders every declared family under both themes and maps every declared test class", () => {
    validateComponentEvidenceMap();
    expect(componentEvidenceMap).toHaveLength(131);
    for (const entry of componentInventory) {
      const component = packages[entry.packageTarget]?.[entry.name];
      expect(component, entry.name).toBeTypeOf("function");
      for (const theme of themes) expect(() => renderFamily(entry.name, component, theme.primitives), `${entry.name}:${theme.themeId}`).not.toThrow();
    }
  });
});
