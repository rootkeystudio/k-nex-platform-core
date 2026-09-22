import type { RuntimeSchemaResult, ThemeProfileTokenValue } from "@k-nex/contracts";
import {
  createThemePresentation,
  createThemeRegistry,
  createWorkspaceCss,
  defineThemePackage,
  reactAriaPrimitives,
  semanticPrimitiveNames,
  themeRootSelector,
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

function tokenSchema(value: unknown): RuntimeSchemaResult<ThemeTokenValues> {
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
  "color.accent": "#ff3b30",
  "color.accent-contrast": "#111111",
  "color.background": "#fff4cc",
  "color.border": "#111111",
  "color.border-strong": "#111111",
  "color.critical": "#c81e1e",
  "color.foreground": "#111111",
  "color.muted": "#4a4034",
  "color.positive": "#0f6b3f",
  "color.surface": "#fffdf5",
  "color.surface-sunken": "#ffe9a8",
  "color.warning": "#8a5a00",
  "control.height": 44,
  "font.size-body": 16,
  "font.size-large": 20,
  "font.size-small": 13,
  "font.size-title": 34,
  "motion.duration": 80,
  "radius.control": 0,
  "radius.surface": 0,
  "shadow.card": "6px 6px 0 #111111",
  "shadow.overlay": "10px 10px 0 #111111",
  "spacing.content": 20,
  "spacing.section": 40,
  "spacing.tight": 10
};

/**
 * Neobrutalism reads as blocks: heavy lines, hard offset shadows, shouted
 * labels, controls that physically move when pressed. Same layout as every
 * other theme — a page has the same structure here, only louder.
 */
const workspaceCss = createWorkspaceCss({
  borderWidth: 3,
  elevation: "hard",
  headingTransform: "uppercase",
  headingLetterSpacing: ".04em",
  emphasis: "block"
});

const languageCss = `
${themeRootSelector}{font-weight:600}
${themeRootSelector} [data-k-nex-primitive="button"]:not([data-variant="quiet"]),${themeRootSelector} button:not([data-variant="quiet"]){background:var(--k-accent);color:var(--k-accent-contrast);text-transform:uppercase;font-weight:800;letter-spacing:.04em}
${themeRootSelector} [data-k-nex-primitive="badge"],${themeRootSelector} [data-k-nex-primitive="status"]{border-radius:0;text-transform:uppercase;letter-spacing:.04em}
${themeRootSelector} th{background:var(--k-accent);color:var(--k-accent-contrast)}
${themeRootSelector} .workspace-sidebar a[aria-current="page"]{box-shadow:4px 4px 0 var(--k-border-strong)}
@media (forced-colors:active){${themeRootSelector} [data-k-nex-primitive="card"],${themeRootSelector} [data-k-nex-primitive="button"],${themeRootSelector} button{box-shadow:none}}
`;

export const neobrutalismThemePackage = defineThemePackage({
  id: "theme.neobrutalism",
  version: "1.1.0",
  surfaces: ["admin", "public"],
  tokenSchema: { safeParse: tokenSchema },
  defaults,
  palettes: [
    { id: "primary", values: {} },
    {
      id: "inverse",
      values: {
        "color.background": "#111111",
        "color.surface": "#1b1b1b",
        "color.surface-sunken": "#000000",
        "color.foreground": "#fff4cc",
        "color.muted": "#d8cfa8",
        "color.border": "#fff4cc",
        "color.border-strong": "#fff4cc",
        "color.accent": "#ffd400",
        "color.accent-contrast": "#111111",
        "shadow.card": "6px 6px 0 #fff4cc",
        "shadow.overlay": "10px 10px 0 #fff4cc"
      }
    }
  ],
  recipes: Object.fromEntries(semanticPrimitiveNames.map((name) => [name, ["default"]])),
  structuralCss: `${workspaceCss}\n${languageCss}`,
  migrations: [],
  primitiveOverrides: reactAriaPrimitives
});

const registry = createThemeRegistry([neobrutalismThemePackage]);

export function resolveNeobrutalismThemeProfile(profile: unknown) {
  return createThemePresentation(registry.resolveProfile(profile));
}
