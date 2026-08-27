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

/**
 * Independently maintained evidence registry.  The inventory describes the
 * public state contract; this registry describes the variants our tests must
 * actually render.  Keeping them separate makes a missing proof fail closed.
 */
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

export const componentStateEvidence = Object.freeze(componentInventory.map((entry) => Object.freeze({
  family: entry.name,
  states: Object.freeze(statefulFamilyStates[entry.name as keyof typeof statefulFamilyStates] ?? ["default"])
})));

const browserOnlyStates = new Set(["hover", "focus", "pressed"]);

export const componentEvidenceMap = Object.freeze(componentInventory.map((entry) => Object.freeze({
  family: entry.name,
  states: componentStateEvidence.find(({ family }) => family === entry.name)?.states ?? [],
  proofs: Object.freeze(Object.fromEntries(entry.testClasses.map((testClass) => [testClass, componentEvidenceProofs[testClass]])))
})));

export function validateComponentEvidenceMap(): void {
  if (componentEvidenceMap.length !== componentInventory.length) throw new TypeError("Component evidence map does not cover the inventory.");
  for (const entry of componentInventory) {
    const evidence = componentEvidenceMap.find(({ family }) => family === entry.name);
    const evidenceStates: readonly string[] = evidence?.states ?? [];
    if (evidence === undefined || entry.testClasses.some((testClass) => evidence.proofs[testClass] === undefined) || entry.states.length !== evidenceStates.length || entry.states.some((state) => !evidenceStates.includes(state)) || entry.states.some((state) => browserOnlyStates.has(state)) && !entry.testClasses.includes("browser")) throw new TypeError(`Component evidence is incomplete: ${entry.name}.`);
  }
}

validateComponentEvidenceMap();
