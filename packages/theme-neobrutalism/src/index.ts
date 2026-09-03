import type { RuntimeSchemaResult, ThemeProfileTokenValue } from "@k-nex/contracts";
import {
  createThemePresentation,
  createThemeRegistry,
  defineThemePackage,
  reactAriaPrimitives,
  semanticPrimitiveNames,
  themeRootSelector,
  type ThemeTokenValues
} from "@k-nex/ui-design-system-contracts";

const tokenKeys = [
  "color.accent", "color.background", "color.border", "color.foreground",
  "motion.duration", "radius.control", "shadow.card", "spacing.content", "spacing.section"
] as const;

function tokenSchema(value: unknown): RuntimeSchemaResult<ThemeTokenValues> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false, error: "invalid" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== [...tokenKeys].sort().join("\0")) return { success: false, error: "keys" };
  if (!["color.accent", "color.background", "color.border", "color.foreground"].every((key) => typeof record[key] === "string" && /^#[0-9a-f]{6}$/i.test(record[key]))) return { success: false, error: "color" };
  if (!["motion.duration", "radius.control", "spacing.content", "spacing.section"].every((key) => typeof record[key] === "number" && Number.isFinite(record[key]) && record[key] >= 0 && record[key] <= 128)) return { success: false, error: "number" };
  if (typeof record["shadow.card"] !== "string" || record["shadow.card"].length > 80) return { success: false, error: "shadow" };
  return { success: true, data: Object.freeze({ ...record }) as ThemeTokenValues };
}

const defaults: Readonly<Record<(typeof tokenKeys)[number], ThemeProfileTokenValue>> = {
  "color.accent": "#ff3b30",
  "color.background": "#fff4cc",
  "color.border": "#111111",
  "color.foreground": "#111111",
  "motion.duration": 80,
  "radius.control": 0,
  "shadow.card": "6px 6px 0 #111111",
  "spacing.content": 20,
  "spacing.section": 40
};

const structuralCss = `
${themeRootSelector}{background:var(--k-nex-admin-color-background,var(--k-nex-public-color-background));color:var(--k-nex-admin-color-foreground,var(--k-nex-public-color-foreground));font-weight:600}
${themeRootSelector} [data-k-nex-primitive="stack"]{display:flex;flex-direction:column;gap:calc(var(--k-nex-admin-spacing-content,var(--k-nex-public-spacing-content))*1px)}
${themeRootSelector} [data-k-nex-primitive="inline"]{display:flex;align-items:center;gap:calc(var(--k-nex-admin-spacing-content,var(--k-nex-public-spacing-content))*1px)}
${themeRootSelector} [data-k-nex-primitive="card"]{border:3px solid var(--k-nex-admin-color-border,var(--k-nex-public-color-border));border-radius:0;box-shadow:var(--k-nex-admin-shadow-card,var(--k-nex-public-shadow-card));padding:calc(var(--k-nex-admin-spacing-content,var(--k-nex-public-spacing-content))*1px)}
${themeRootSelector} [data-k-nex-primitive="button"],${themeRootSelector} [data-k-nex-primitive="icon-button"],${themeRootSelector} [data-k-nex-primitive="dialog-trigger"]{min-width:44px;min-height:44px;border:3px solid var(--k-nex-admin-color-border,var(--k-nex-public-color-border));border-radius:0;background:var(--k-nex-admin-color-accent,var(--k-nex-public-color-accent));box-shadow:4px 4px 0 var(--k-nex-admin-color-border,var(--k-nex-public-color-border));font-weight:800;text-transform:uppercase;transition-duration:calc(var(--k-nex-admin-motion-duration,var(--k-nex-public-motion-duration))*1ms)}
${themeRootSelector} :where([data-k-nex-primitive="button"],[data-k-nex-primitive="icon-button"],[data-k-nex-primitive="dialog-trigger"])[data-focus-visible]{outline:4px solid var(--k-nex-admin-color-foreground,var(--k-nex-public-color-foreground));outline-offset:3px}
@media (prefers-reduced-motion:reduce){${themeRootSelector} *{transition-duration:0ms!important;animation-duration:0ms!important}}
@media (forced-colors:active){${themeRootSelector} [data-k-nex-primitive="button"],${themeRootSelector} [data-k-nex-primitive="dialog-trigger"],${themeRootSelector} [data-k-nex-primitive="card"]{border-color:CanvasText;box-shadow:none}}
`;

export const neobrutalismThemePackage = defineThemePackage({
  id: "theme.neobrutalism",
  version: "1.0.0",
  surfaces: ["admin", "public"],
  tokenSchema: { safeParse: tokenSchema },
  defaults,
  palettes: [
    { id: "primary", values: {} },
    { id: "inverse", values: { "color.background": "#111111", "color.foreground": "#fff4cc", "color.border": "#fff4cc", "shadow.card": "6px 6px 0 #fff4cc" } }
  ],
  recipes: Object.fromEntries(semanticPrimitiveNames.map((name) => [name, ["default"]])),
  structuralCss,
  migrations: [],
  primitiveOverrides: reactAriaPrimitives
});

const registry = createThemeRegistry([neobrutalismThemePackage]);

export function resolveNeobrutalismThemeProfile(profile: unknown) {
  return createThemePresentation(registry.resolveProfile(profile));
}
