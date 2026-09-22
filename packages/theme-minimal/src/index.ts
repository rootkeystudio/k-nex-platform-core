import type { RuntimeSchemaResult, ThemeProfileTokenValue } from "@k-nex/contracts";
import {
  createThemePresentation,
  createThemeRegistry,
  createWorkspaceCss,
  defineThemePackage,
  reactAriaPrimitives,
  semanticPrimitiveNames,
  type ThemeTokenValues
} from "@k-nex/ui-design-system-contracts";

const colorKeys = [
  "color.accent", "color.accent-contrast", "color.background", "color.border", "color.border-strong",
  "color.critical", "color.foreground", "color.muted", "color.positive", "color.surface",
  "color.surface-sunken", "color.warning"
] as const;
const scaleKeys = [
  "control.height", "font.size-body", "font.size-large", "font.size-small", "font.size-title",
  "motion.duration", "radius.control", "radius.surface", "spacing.content", "spacing.section", "spacing.tight"
] as const;
const shadowKeys = ["shadow.card", "shadow.overlay"] as const;
const tokenKeys = [...colorKeys, ...scaleKeys, ...shadowKeys] as const;

function minimalTokenSchema(value: unknown): RuntimeSchemaResult<ThemeTokenValues> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false, error: "invalid" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== [...tokenKeys].sort().join("\0")) return { success: false, error: "keys" };
  const color = /^#[0-9a-f]{6}$/i;
  if (!colorKeys.every((key) => typeof record[key] === "string" && color.test(record[key] as string))) return { success: false, error: "color" };
  if (!scaleKeys.every((key) => typeof record[key] === "number" && Number.isFinite(record[key] as number) && (record[key] as number) >= 0 && (record[key] as number) <= 128)) return { success: false, error: "number" };
  if (!shadowKeys.every((key) => typeof record[key] === "string" && (record[key] as string).length <= 80)) return { success: false, error: "shadow" };
  return { success: true, data: Object.freeze({ ...record }) as ThemeTokenValues };
}

const defaults: Readonly<Record<(typeof tokenKeys)[number], ThemeProfileTokenValue>> = {
  "color.accent": "#2457ff",
  "color.accent-contrast": "#ffffff",
  "color.background": "#ffffff",
  "color.border": "#d6d9e0",
  "color.border-strong": "#b4bac4",
  "color.critical": "#b3261e",
  "color.foreground": "#15171a",
  "color.muted": "#5b616e",
  "color.positive": "#10714a",
  "color.surface": "#ffffff",
  "color.surface-sunken": "#f4f6f8",
  "color.warning": "#8a5a00",
  "control.height": 40,
  "font.size-body": 15,
  "font.size-large": 18,
  "font.size-small": 13,
  "font.size-title": 28,
  "motion.duration": 120,
  "radius.control": 8,
  "radius.surface": 12,
  "shadow.card": "0 1px 2px #0000001f",
  "shadow.overlay": "0 12px 32px #0000002e",
  "spacing.content": 16,
  "spacing.section": 32,
  "spacing.tight": 8
};

/**
 * Minimal reads as paper: one hairline, a quiet raise, sentence-case headings.
 * The layout underneath it is the platform's, not this theme's.
 */
const structuralCss = createWorkspaceCss({
  borderWidth: 1,
  elevation: "soft",
  headingTransform: "none",
  headingLetterSpacing: "0",
  emphasis: "flat"
});

export const minimalThemePackage = defineThemePackage({
  id: "theme.minimal",
  version: "1.1.0",
  surfaces: ["admin", "public"],
  tokenSchema: { safeParse: minimalTokenSchema },
  defaults,
  palettes: [
    { id: "light", values: {} },
    {
      id: "dark",
      values: {
        "color.background": "#15171a",
        "color.surface": "#1c1f24",
        "color.surface-sunken": "#121417",
        "color.foreground": "#f7f8fa",
        "color.muted": "#a3aab6",
        "color.border": "#31363e",
        "color.border-strong": "#454a52",
        "color.accent": "#7aa0ff",
        "color.accent-contrast": "#10121a",
        "color.positive": "#4fd6a0",
        "color.warning": "#e3b341",
        "color.critical": "#ff7b72",
        "shadow.card": "0 1px 2px #00000066",
        "shadow.overlay": "0 12px 32px #00000099"
      }
    }
  ],
  recipes: Object.fromEntries(semanticPrimitiveNames.map((name) => [name, ["default"]])),
  structuralCss,
  migrations: [],
  primitiveOverrides: reactAriaPrimitives
});

const registry = createThemeRegistry([minimalThemePackage]);

export function resolveMinimalThemeProfile(profile: unknown) {
  return createThemePresentation(registry.resolveProfile(profile));
}
