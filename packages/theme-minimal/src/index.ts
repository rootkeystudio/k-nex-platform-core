import type { RuntimeSchemaResult, ThemeProfileTokenValue } from "@k-nex/contracts";
import {
  createThemePresentation,
  createThemeRegistry,
  defineThemePackage,
  reactAriaPrimitives,
  semanticPrimitiveNames,
  type ThemeTokenValues
} from "@k-nex/ui-design-system-contracts";

const tokenKeys = [
  "color.accent", "color.background", "color.border", "color.foreground",
  "motion.duration", "radius.control", "shadow.card", "spacing.content", "spacing.section"
] as const;

function minimalTokenSchema(value: unknown): RuntimeSchemaResult<ThemeTokenValues> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false, error: "invalid" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== [...tokenKeys].sort().join("\0")) return { success: false, error: "keys" };
  const color = /^#[0-9a-f]{6}$/i;
  if (!["color.accent", "color.background", "color.border", "color.foreground"].every((key) => typeof record[key] === "string" && color.test(record[key]))) return { success: false, error: "color" };
  if (!["motion.duration", "radius.control", "spacing.content", "spacing.section"].every((key) => typeof record[key] === "number" && Number.isFinite(record[key]) && record[key] >= 0 && record[key] <= 128)) return { success: false, error: "number" };
  if (typeof record["shadow.card"] !== "string" || record["shadow.card"].length > 80) return { success: false, error: "shadow" };
  return { success: true, data: Object.freeze({ ...record }) as ThemeTokenValues };
}

const defaults: Readonly<Record<(typeof tokenKeys)[number], ThemeProfileTokenValue>> = {
  "color.accent": "#2457ff",
  "color.background": "#ffffff",
  "color.border": "#d6d9e0",
  "color.foreground": "#15171a",
  "motion.duration": 120,
  "radius.control": 8,
  "shadow.card": "0 1px 3px #00000024",
  "spacing.content": 16,
  "spacing.section": 32
};

const structuralCss = `
[data-k-nex-theme-profile]{background:var(--k-nex-public-color-background);color:var(--k-nex-public-color-foreground)}
[data-k-nex-primitive="stack"]{display:flex;flex-direction:column;gap:calc(var(--k-nex-public-spacing-content)*1px)}
[data-k-nex-primitive="inline"]{display:flex;align-items:center;gap:calc(var(--k-nex-public-spacing-content)*1px)}
[data-k-nex-primitive="card"]{border:1px solid var(--k-nex-public-color-border);border-radius:calc(var(--k-nex-public-radius-control)*1px);box-shadow:var(--k-nex-public-shadow-card);padding:calc(var(--k-nex-public-spacing-content)*1px)}
[data-k-nex-primitive="button"],[data-k-nex-primitive="icon-button"]{min-width:44px;min-height:44px;border:1px solid var(--k-nex-public-color-border);border-radius:calc(var(--k-nex-public-radius-control)*1px);transition-duration:calc(var(--k-nex-public-motion-duration)*1ms)}
:where([data-k-nex-primitive="button"],[data-k-nex-primitive="icon-button"])[data-focus-visible]{outline:3px solid var(--k-nex-public-color-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){[data-k-nex-theme-profile] *{transition-duration:0ms!important;animation-duration:0ms!important}}
@media (forced-colors:active){[data-k-nex-primitive="button"],[data-k-nex-primitive="card"]{border-color:CanvasText}}
`;

export const minimalThemePackage = defineThemePackage({
  id: "theme.minimal",
  version: "1.0.0",
  surfaces: ["public"],
  tokenSchema: { safeParse: minimalTokenSchema },
  defaults,
  palettes: [
    { id: "light", values: {} },
    { id: "dark", values: { "color.background": "#15171a", "color.foreground": "#f7f8fa", "color.border": "#454a52", "shadow.card": "0 1px 3px #00000066" } }
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
