export const componentStateMatrix = Object.freeze([
  "default", "hover", "focus", "pressed", "selected", "disabled", "read-only", "pending", "invalid",
  "empty", "error", "high-contrast", "reduced-motion", "rtl", "long-text", "localization"
] as const);

export const componentThemeMatrix = Object.freeze(["theme.minimal", "theme.neobrutalism"] as const);

export function validateComponentStateMatrix(values: readonly string[]): void {
  if (values.length !== componentStateMatrix.length || componentStateMatrix.some((state) => !values.includes(state))) {
    throw new TypeError("Component state evidence is incomplete.");
  }
}
