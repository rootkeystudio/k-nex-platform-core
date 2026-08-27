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

export const componentEvidenceMap = Object.freeze(componentInventory.map((entry) => Object.freeze({
  family: entry.name,
  states: entry.states,
  proofs: Object.freeze(Object.fromEntries(entry.testClasses.map((testClass) => [testClass, componentEvidenceProofs[testClass]])))
})));

export function validateComponentEvidenceMap(): void {
  if (componentEvidenceMap.length !== componentInventory.length) throw new TypeError("Component evidence map does not cover the inventory.");
  for (const entry of componentInventory) {
    const evidence = componentEvidenceMap.find(({ family }) => family === entry.name);
    if (evidence === undefined || entry.testClasses.some((testClass) => evidence.proofs[testClass] === undefined) || entry.states.some((state) => !evidence.states.includes(state))) throw new TypeError(`Component evidence is incomplete: ${entry.name}.`);
  }
}

validateComponentEvidenceMap();
