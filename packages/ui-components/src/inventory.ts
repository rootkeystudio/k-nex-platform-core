export const componentContractSchemaVersion = 1 as const;

export const componentMaturityRules = Object.freeze({
  experimental: "Internal use; the API may change within Phase 7.",
  reference: "Used by Sales and covered by the component contract suite.",
  "stable-pre-v1": "Documented, themed, accessible, and frozen for the current pre-v1 line."
});

export const componentVersionRules = Object.freeze({
  patch: "Compatible fixes to behavior, accessibility, slots, or diagnostics.",
  minor: "Additive props, slots, states, or components.",
  major: "Removed or changed props, semantics, slots, state names, or persisted adapter state."
});

export const componentDataAttributes = Object.freeze({
  component: "data-k-nex-component",
  slot: "data-slot",
  state: "data-state"
});

export const componentSlotPattern = /^component\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type ComponentMaturity = keyof typeof componentMaturityRules;
export type ComponentDisposition = "native-semantic-wrapper" | "platform-component" | "versioned-complex-adapter";
export type ComponentBehaviorSource = "native-html" | "k-nex" | "react-aria-adapter" | "tanstack-table-adapter" | "tanstack-virtual-adapter" | "lexical-adapter";
export type ComponentTestClass = "unit" | "interaction" | "browser" | "ssr-hydration" | "theme-contract" | "boundary" | "performance";
export type ComponentPackageTarget = "@k-nex/ui-components" | "@k-nex/ui-data" | "@k-nex/ui-forms" | "@k-nex/ui-pages";

export interface ComponentInventoryEntry {
  readonly id: string;
  readonly name: string;
  readonly origin: "component-gallery" | "k-nex";
  readonly category: "foundation" | "content" | "feedback" | "navigation" | "forms" | "overlay" | "data" | "pages";
  readonly owner: "k-nex-platform";
  readonly packageTarget: ComponentPackageTarget;
  readonly behaviorSource: ComponentBehaviorSource;
  readonly disposition: ComponentDisposition;
  readonly maturity: ComponentMaturity;
  readonly deliveryTask: `P7.${2 | 3 | 4 | 5 | 6 | 7}`;
  readonly testClasses: readonly ComponentTestClass[];
  readonly slots: readonly string[];
  readonly states: readonly string[];
}

export const componentPackageBoundaries = Object.freeze({
  "@k-nex/ui-design-system-contracts": Object.freeze({ role: "small primitive ABI, tokens, theme provider", mayImport: Object.freeze(["@k-nex/contracts"]) }),
  "@k-nex/ui-components": Object.freeze({ role: "style-agnostic compound behavior", mayImport: Object.freeze(["@k-nex/ui-design-system-contracts"]) }),
  "@k-nex/ui-data": Object.freeze({ role: "query state and data presentation", mayImport: Object.freeze(["@k-nex/contracts", "@k-nex/ui-components", "@k-nex/ui-runtime"]) }),
  "@k-nex/ui-forms": Object.freeze({ role: "field composition and action result mapping", mayImport: Object.freeze(["@k-nex/contracts", "@k-nex/ui-components", "@k-nex/ui-runtime"]) }),
  "@k-nex/ui-pages": Object.freeze({ role: "route-level composition helpers", mayImport: Object.freeze(["@k-nex/ui-components", "@k-nex/ui-data", "@k-nex/ui-forms"]) }),
  "@k-nex/ui-builder-blocks": Object.freeze({ role: "canonical builder bridges", mayImport: Object.freeze(["@k-nex/builder-puck", "@k-nex/ui-components", "@k-nex/ui-data", "@k-nex/ui-forms", "@k-nex/ui-pages"]) }),
  "@k-nex/ui-testing": Object.freeze({ role: "shared component conformance", mayImport: Object.freeze(["@k-nex/ui-design-system-contracts", "@k-nex/ui-components", "@k-nex/ui-data", "@k-nex/ui-forms", "@k-nex/ui-pages"]) })
});

const galleryGroups = {
  foundation: ["Avatar", "Card", "File", "Footer", "Header", "Hero", "Icon", "Image", "Link", "List", "Quote", "Separator", "Stack", "Video", "VisuallyHidden"],
  content: ["Heading"],
  feedback: ["Alert", "Badge", "EmptyState", "ProgressBar", "ProgressIndicator", "Skeleton", "Spinner", "Toast"],
  navigation: ["Breadcrumbs", "Button", "ButtonGroup", "DropdownMenu", "Navigation", "Pagination", "SegmentedControl", "SkipLink", "Tabs", "TreeView"],
  forms: ["Checkbox", "ColorPicker", "Combobox", "DateInput", "DatePicker", "Fieldset", "FileUpload", "Form", "Label", "RadioButton", "Rating", "SearchInput", "Select", "Slider", "Stepper", "TextInput", "Textarea", "Toggle"],
  overlay: ["Accordion", "Carousel", "Drawer", "Modal", "Popover", "Tooltip"],
  data: ["Table", "RichTextEditor"]
} as const;

const platformGroups = {
  foundation: ["Box", "Inline", "Grid", "Container", "PageShell", "PageHeader", "Section", "Toolbar", "ActionBar", "SplitView", "ScrollableArea", "AspectRatio", "Portal", "FocusScope"],
  content: ["Text", "Status", "RichTextRenderer"],
  feedback: ["Progress"],
  forms: ["FormField", "FieldDescription", "FieldError", "InputGroup", "PasswordInput", "NumberInput", "CurrencyInput", "PhoneInput", "URLInput", "TimeInput", "DateRangePicker", "MultiSelect", "TagInput", "Autocomplete", "RadioGroup", "FormActions", "UnsavedChangesGuard"],
  overlay: ["Dialog"],
  data: ["QueryBoundary", "LoadingState", "ErrorState", "ForbiddenState", "InsufficientPermissionState", "StaleState", "DataList", "KeyValueList", "DescriptionList", "Metric", "MetricGroup", "StatCard", "DataTable", "DataGrid", "FilterBar", "FacetFilter", "SortControl", "SearchControl", "ColumnChooser", "DensityControl", "SelectionSummary", "BulkActionBar", "RowActions", "DetailPanel", "LoadMore", "InfiniteList", "VirtualList"],
  pages: ["DashboardPage", "IndexPage", "DetailPage", "CreatePage", "EditPage", "SettingsPage", "WizardPage", "BuilderPage"]
} as const;

const nativeNames = new Set(["Box", "Inline", "Grid", "Container", "Section", "Text", "Heading", "Link", "List", "Image", "Separator", "VisuallyHidden", "Badge", "ProgressBar", "Fieldset", "Form", "FormField", "Label", "SearchInput", "TextInput", "Textarea", "DateInput", "DatePicker", "TimeInput", "Table", "Header", "Footer", "Quote", "Video", "Checkbox", "ColorPicker", "Combobox", "FileUpload", "RadioButton", "RadioGroup", "SegmentedControl", "Select", "Slider", "Toggle", "MultiSelect"]);
const reactAriaNames = new Set(["Button", "ButtonGroup", "DropdownMenu", "Navigation", "Pagination", "Tabs", "TreeView", "Rating", "Stepper", "Accordion", "Carousel", "Drawer", "Modal", "Dialog", "Popover", "Tooltip", "Toast", "FocusScope", "Portal", "TagInput", "Autocomplete"]);
const complexSources = new Map<string, ComponentBehaviorSource>([["DataTable", "tanstack-table-adapter"], ["DataGrid", "tanstack-table-adapter"], ["VirtualList", "tanstack-virtual-adapter"], ["RichTextEditor", "lexical-adapter"]]);
const slotParts = new Map<string, readonly string[]>([
  ["DataTable", ["root", "header", "row", "cell", "sort-trigger"]],
  ["DataGrid", ["root", "header", "row", "cell"]],
  ["Dialog", ["root", "trigger", "backdrop", "content", "title", "close"]],
  ["Popover", ["root", "trigger", "content"]],
  ["FormField", ["root", "label", "control", "description", "error"]],
  ["DatePicker", ["root", "trigger", "calendar", "calendar-cell"]],
  ["TreeView", ["root", "item", "item-trigger", "group"]],
  ["FilterBar", ["root", "controls", "summary", "clear"]]
]);
const browserEvidenceNames = new Set(["Button", "DataGrid", "DataTable", "Dialog", "Form", "SegmentedControl", "TextInput", "TreeView", "VirtualList"]);
const hydrationEvidenceNames = new Set(["DataTable", "Dialog"]);
const stateEvidence = new Map<string, readonly string[]>([
  ["Accordion", ["default", "expanded", "collapsed"]],
  ["Alert", ["neutral", "positive", "warning", "critical"]],
  ["Button", ["default", "hover", "focus", "pressed", "disabled"]],
  ["Checkbox", ["default", "selected", "disabled", "invalid"]],
  ["ColorPicker", ["default", "disabled", "read-only", "invalid"]],
  ["Combobox", ["default", "disabled", "read-only", "invalid"]],
  ["DataGrid", ["default", "focus", "selected"]],
  ["DataTable", ["default", "loading", "forbidden", "selected", "empty", "error", "success"]],
  ["DateInput", ["default", "disabled", "read-only", "invalid"]],
  ["DatePicker", ["default", "disabled", "read-only", "invalid"]],
  ["DateRangePicker", ["default", "disabled", "invalid"]],
  ["Dialog", ["default", "focus"]],
  ["ErrorState", ["error"]],
  ["FieldError", ["invalid"]],
  ["Fieldset", ["default", "disabled"]],
  ["FileUpload", ["default", "disabled", "invalid"]],
  ["Form", ["default", "pending"]],
  ["FormField", ["default", "disabled", "read-only", "invalid"]],
  ["ForbiddenState", ["forbidden"]],
  ["InfiniteList", ["ready", "loading"]],
  ["InsufficientPermissionState", ["insufficient-permission"]],
  ["LoadMore", ["ready", "loading", "hidden"]],
  ["LoadingState", ["loading"]],
  ["MultiSelect", ["default", "disabled", "invalid"]],
  ["NumberInput", ["default", "disabled", "read-only", "invalid"]],
  ["Pagination", ["default", "previous-disabled", "next-disabled"]],
  ["PasswordInput", ["default", "disabled", "read-only", "invalid"]],
  ["Progress", ["pending", "determinate"]],
  ["ProgressBar", ["pending", "determinate"]],
  ["ProgressIndicator", ["pending"]],
  ["QueryBoundary", ["loading", "forbidden", "empty", "error", "success"]],
  ["RadioButton", ["default", "selected", "disabled"]],
  ["RadioGroup", ["default", "disabled", "invalid"]],
  ["Rating", ["default", "disabled", "invalid"]],
  ["SearchInput", ["default", "disabled", "read-only", "invalid"]],
  ["Select", ["default", "disabled", "invalid"]],
  ["SegmentedControl", ["default", "selected"]],
  ["Skeleton", ["pending"]],
  ["Slider", ["default", "disabled", "read-only", "invalid"]],
  ["Spinner", ["pending"]],
  ["Stepper", ["default", "disabled", "read-only", "invalid"]],
  ["StaleState", ["stale"]],
  ["Tabs", ["default", "selected", "disabled"]],
  ["TextInput", ["default", "read-only", "invalid"]],
  ["Textarea", ["default", "disabled", "read-only", "invalid"]],
  ["TimeInput", ["default", "disabled", "read-only", "invalid"]],
  ["TreeView", ["default", "focus", "selected", "expanded", "collapsed"]],
  ["Toggle", ["default", "selected", "disabled"]],
  ["VirtualList", ["default", "focus"]]
]);
export const referenceComponentNames = Object.freeze([
  "Alert", "Breadcrumbs", "Button", "Card", "DataGrid", "DataTable", "Dialog", "EmptyState", "ErrorState",
  "FilterBar", "Form", "FormActions", "Heading", "IndexPage", "KeyValueList", "LoadingState", "Metric",
  "QueryBoundary", "SearchControl", "SegmentedControl", "Select", "SettingsPage", "Stack", "Status", "Text",
  "TextInput", "DashboardPage"
] as const);
const referenceNames = new Set<string>(referenceComponentNames);

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function deliveryTask(category: ComponentInventoryEntry["category"], name: string): ComponentInventoryEntry["deliveryTask"] {
  if (name === "RichTextRenderer") return "P7.5";
  if (category === "forms") return "P7.3";
  if (category === "navigation" || category === "overlay") return "P7.4";
  if (category === "data") return name === "DataTable" || name === "DataGrid" ? "P7.6" : "P7.5";
  if (category === "pages") return "P7.7";
  return "P7.2";
}

function packageTarget(category: ComponentInventoryEntry["category"], name: string): ComponentPackageTarget {
  if (name === "RichTextRenderer") return "@k-nex/ui-data";
  if (category === "forms") return "@k-nex/ui-forms";
  if (category === "data") return "@k-nex/ui-data";
  if (category === "pages") return "@k-nex/ui-pages";
  return "@k-nex/ui-components";
}

function entry(origin: ComponentInventoryEntry["origin"], category: ComponentInventoryEntry["category"], name: string): ComponentInventoryEntry {
  const id = kebab(name);
  const behaviorSource = complexSources.get(name) ?? (nativeNames.has(name) ? "native-html" : reactAriaNames.has(name) ? "react-aria-adapter" : "k-nex");
  const disposition: ComponentDisposition = behaviorSource === "native-html" ? "native-semantic-wrapper" : complexSources.has(name) ? "versioned-complex-adapter" : "platform-component";
  const testClasses: ComponentTestClass[] = ["unit", "theme-contract", "boundary"];
  if (hydrationEvidenceNames.has(name)) testClasses.push("ssr-hydration");
  if (browserEvidenceNames.has(name)) testClasses.push("interaction", "browser");
  if (complexSources.has(name)) testClasses.push("performance");
  return Object.freeze({
    id,
    name,
    origin,
    category,
    owner: "k-nex-platform",
    packageTarget: packageTarget(category, name),
    behaviorSource,
    disposition,
    maturity: referenceNames.has(name) ? "reference" : "experimental",
    deliveryTask: deliveryTask(category, name),
    testClasses: Object.freeze(testClasses),
    slots: Object.freeze((slotParts.get(name) ?? ["root"]).map((part) => `component.${id}.${part}`)),
    states: Object.freeze(stateEvidence.get(name) ?? ["default"])
  });
}

function entries(origin: ComponentInventoryEntry["origin"], groups: Readonly<Record<string, readonly string[]>>): ComponentInventoryEntry[] {
  return Object.entries(groups).flatMap(([category, names]) => names.map((name) => entry(origin, category as ComponentInventoryEntry["category"], name)));
}

export const componentInventory = Object.freeze([
  ...entries("component-gallery", galleryGroups),
  ...entries("k-nex", platformGroups)
]);

export function validateComponentInventory(inventory: readonly ComponentInventoryEntry[] = componentInventory): void {
  const gallery = inventory.filter((item) => item.origin === "component-gallery");
  if (gallery.length !== 60) throw new TypeError(`Component Gallery inventory must contain exactly 60 families; received ${gallery.length}.`);
  const ids = new Set<string>();
  for (const item of inventory) {
    if (ids.has(item.id)) throw new TypeError(`Duplicate component inventory ID: ${item.id}.`);
    ids.add(item.id);
    if (item.owner !== "k-nex-platform") throw new TypeError(`Component owner must remain platform-owned: ${item.id}.`);
    if (item.testClasses.length === 0) throw new TypeError(`Component requires a test class: ${item.id}.`);
    if (item.slots.length === 0 || item.slots.some((slot) => !componentSlotPattern.test(slot))) throw new TypeError(`Component has an invalid semantic slot: ${item.id}.`);
    if (item.slots.some((slot) => !slot.startsWith(`component.${item.id}.`))) throw new TypeError(`Component slot must be owned by its component: ${item.id}.`);
  }
}

validateComponentInventory();
