import { componentInventory, type ComponentTestClass } from "@k-nex/ui-components";

export const componentEvidenceProofs = Object.freeze({
  unit: "family-two-theme-render",
  "theme-contract": "family-two-theme-render",
  boundary: "inventory-package-export",
  interaction: "chromium-role-name-interaction",
  browser: "chromium-role-name-interaction",
  "ssr-hydration": "chromium-server-hydration",
  performance: "bundle-browser-performance"
} satisfies Record<ComponentTestClass, string>);

/** Inventory is deliberately not used to construct this registry. */
const statefulFamilyStates = Object.freeze({
  Accordion: ["default", "expanded", "collapsed"], Alert: ["neutral", "positive", "warning", "critical"],
  Button: ["default", "hover", "focus", "pressed", "disabled"],
  Checkbox: ["default", "selected", "disabled", "invalid"], ColorPicker: ["default", "disabled", "read-only", "invalid"],
  Combobox: ["default", "disabled", "read-only", "invalid"], DataGrid: ["default", "focus", "selected"],
  DataTable: ["default", "loading", "forbidden", "selected", "empty", "error", "success"],
  DateInput: ["default", "disabled", "read-only", "invalid"], DatePicker: ["default", "disabled", "read-only", "invalid"],
  DateRangePicker: ["default", "disabled", "invalid"], Dialog: ["default", "focus"], ErrorState: ["error"],
  FieldError: ["invalid"], Fieldset: ["default", "disabled"], FileUpload: ["default", "disabled", "invalid"],
  Form: ["default", "pending"], FormField: ["default", "disabled", "read-only", "invalid"],
  ForbiddenState: ["forbidden"], InfiniteList: ["ready", "loading"], InsufficientPermissionState: ["insufficient-permission"],
  LoadMore: ["ready", "loading", "hidden"], LoadingState: ["loading"], MultiSelect: ["default", "disabled", "invalid"],
  NumberInput: ["default", "disabled", "read-only", "invalid"], Pagination: ["default", "previous-disabled", "next-disabled"],
  PasswordInput: ["default", "disabled", "read-only", "invalid"], Progress: ["pending", "determinate"],
  ProgressBar: ["pending", "determinate"], ProgressIndicator: ["pending"], QueryBoundary: ["loading", "forbidden", "empty", "error", "success"],
  RadioButton: ["default", "selected", "disabled"], RadioGroup: ["default", "disabled", "invalid"],
  Rating: ["default", "disabled", "invalid"], SearchInput: ["default", "disabled", "read-only", "invalid"],
  Select: ["default", "disabled", "invalid"], SegmentedControl: ["default", "selected"], Skeleton: ["pending"],
  Slider: ["default", "disabled", "read-only", "invalid"], Spinner: ["pending"], Stepper: ["default", "disabled", "read-only", "invalid"],
  StaleState: ["stale"], Tabs: ["default", "selected", "disabled"], TextInput: ["default", "read-only", "invalid"],
  Textarea: ["default", "disabled", "read-only", "invalid"], TimeInput: ["default", "disabled", "read-only", "invalid"],
  Toggle: ["default", "selected", "disabled"], TreeView: ["default", "focus", "selected", "expanded", "collapsed"],
  VirtualList: ["default", "focus"]
} as const satisfies Readonly<Record<string, readonly string[]>>);

const defaultOnlyFamilies = Object.freeze([
  "Avatar", "Card", "File", "Footer", "Header", "Hero", "Icon", "Image", "Link", "List", "Quote", "Separator", "Stack", "Video", "VisuallyHidden", "Heading",
  "Badge", "EmptyState", "Toast", "Breadcrumbs", "ButtonGroup", "DropdownMenu", "Navigation", "SkipLink", "Label", "Carousel", "Drawer", "Modal", "Popover", "Tooltip",
  "Table", "RichTextEditor", "Box", "Inline", "Grid", "Container", "PageShell", "PageHeader", "Section", "Toolbar", "ActionBar", "SplitView", "ScrollableArea", "AspectRatio",
  "Portal", "FocusScope", "Text", "Status", "RichTextRenderer", "FieldDescription", "InputGroup", "CurrencyInput", "PhoneInput", "URLInput", "TagInput", "Autocomplete",
  "FormActions", "UnsavedChangesGuard", "DataList", "KeyValueList", "DescriptionList", "Metric", "MetricGroup", "StatCard", "FilterBar", "FacetFilter", "SortControl",
  "SearchControl", "ColumnChooser", "DensityControl", "SelectionSummary", "BulkActionBar", "RowActions", "DetailPanel", "DashboardPage", "IndexPage", "DetailPage", "CreatePage",
  "EditPage", "SettingsPage", "WizardPage", "BuilderPage"
] as const);

export const componentStateEvidence = Object.freeze([
  ...defaultOnlyFamilies.map((family) => Object.freeze({ family, states: Object.freeze(["default"] as const) })),
  ...Object.entries(statefulFamilyStates).map(([family, states]) => Object.freeze({ family, states: Object.freeze([...states]) }))
]);

const browserOnlyStates = new Set(["hover", "focus", "pressed"]);
const specializedProofFamilies = Object.freeze({
  interaction: Object.freeze(["Button", "SegmentedControl", "TreeView", "Form", "TextInput", "Dialog", "DataTable", "DataGrid", "VirtualList"]),
  browser: Object.freeze(["Button", "SegmentedControl", "TreeView", "Form", "TextInput", "Dialog", "DataTable", "DataGrid", "VirtualList"]),
  "ssr-hydration": Object.freeze(["Dialog", "DataTable"]),
  performance: Object.freeze(["RichTextEditor", "DataTable", "DataGrid", "VirtualList"])
} satisfies Readonly<Record<"interaction" | "browser" | "ssr-hydration" | "performance", readonly string[]>>);

export const componentEvidenceMap = Object.freeze(componentStateEvidence.map((entry) => Object.freeze({
  family: entry.family,
  states: entry.states,
  proofs: Object.freeze({
    unit: componentEvidenceProofs.unit,
    "theme-contract": componentEvidenceProofs["theme-contract"],
    boundary: componentEvidenceProofs.boundary,
    ...Object.fromEntries(Object.entries(specializedProofFamilies).filter(([, families]) => families.includes(entry.family)).map(([testClass]) => [testClass, componentEvidenceProofs[testClass as ComponentTestClass]]))
  })
})));

export function validateComponentEvidenceMap(
  inventory = componentInventory,
  evidenceMap: readonly { readonly family: string; readonly states: readonly string[]; readonly proofs: Readonly<Partial<Record<ComponentTestClass, string>>> }[] = componentEvidenceMap
): void {
  if (evidenceMap.length !== inventory.length || new Set(evidenceMap.map(({ family }) => family)).size !== evidenceMap.length) throw new TypeError("Component evidence map does not exactly cover the inventory.");
  for (const entry of inventory) {
    const evidence = evidenceMap.find(({ family }) => family === entry.name);
    const evidenceStates: readonly string[] = evidence?.states ?? [];
    if (evidence === undefined || entry.testClasses.some((testClass) => evidence.proofs[testClass] === undefined) || entry.states.length !== evidenceStates.length || entry.states.some((state) => !evidenceStates.includes(state)) || entry.states.some((state) => browserOnlyStates.has(state)) && !entry.testClasses.includes("browser")) throw new TypeError(`Component evidence is incomplete: ${entry.name}.`);
  }
}

validateComponentEvidenceMap();
