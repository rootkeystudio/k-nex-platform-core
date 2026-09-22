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

/**
 * Graphite and paper: a dark instrument around light work.
 *
 * The chrome a person navigates with — sidebar, header, panel frames — is
 * graphite, and the material they actually read and write on is paper. The two
 * tones say which is which without a single label, and the accent is spent
 * only on the thing that is current: the selected row, the active stage, the
 * one number the page is about.
 */
const colorKeys = [
  "color.accent", "color.accent-contrast", "color.background", "color.border", "color.border-strong",
  "color.chrome", "color.critical", "color.foreground", "color.muted", "color.paper",
  "color.paper-border", "color.paper-foreground", "color.paper-muted", "color.positive", "color.surface",
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
  "color.accent": "#ff6b35",
  "color.accent-contrast": "#0f0f0f",
  "color.background": "#121212",
  "color.border": "#2a2a2a",
  "color.border-strong": "#3d3d3d",
  "color.chrome": "#0d0d0d",
  "color.critical": "#f87171",
  "color.foreground": "#ededed",
  "color.muted": "#8f8f8f",
  "color.paper": "#f2ede3",
  "color.paper-border": "#ddd5c6",
  "color.paper-foreground": "#1b1a17",
  "color.paper-muted": "#6b6557",
  "color.positive": "#4ade80",
  "color.surface": "#1a1a1a",
  "color.surface-sunken": "#151515",
  "color.warning": "#fbbf24",
  "control.height": 36,
  "font.size-body": 14,
  "font.size-large": 17,
  "font.size-small": 12,
  "font.size-title": 30,
  "motion.duration": 120,
  "radius.control": 6,
  "radius.surface": 10,
  "shadow.card": "0 1px 2px #00000080",
  "shadow.overlay": "0 18px 48px #000000a6",
  "spacing.content": 16,
  "spacing.section": 28,
  "spacing.tight": 8
};

const token = (name: string) => `var(--k-nex-admin-${name},var(--k-nex-public-${name}))`;

/**
 * Four corner marks, drawn as one background rather than four elements, so any
 * panel can carry them without changing its markup.
 */
function cornerBrackets(color: string, size = "12px", thickness = "1px"): string {
  const line = `linear-gradient(${color},${color})`;
  const horizontal = `${size} ${thickness}`;
  const vertical = `${thickness} ${size}`;
  return [
    `background-image:${[line, line, line, line, line, line, line, line].join(",")}`,
    "background-repeat:no-repeat",
    `background-size:${[horizontal, vertical, horizontal, vertical, horizontal, vertical, horizontal, vertical].join(",")}`,
    "background-position:left top,left top,right top,right top,left bottom,left bottom,right bottom,right bottom"
  ].join(";");
}

const rule = (selectors: readonly string[], declarations: string) =>
  `${selectors.map((selector) => `${themeRootSelector} ${selector}`).join(",")}{${declarations}}`;

const paperSurfaces = [
  '[data-k-nex-surface="paper"]',
  '[data-k-nex-component="timeline"]',
  '[data-k-nex-component="detail-panel"]',
  '[data-k-nex-component="rich-text-editor"]'
];

const languageCss = [
  // Chrome. The sidebar and header are the instrument; the page is the work.
  rule([".workspace-sidebar"], `background:${token("color-chrome")};border-inline-end:1px solid ${token("color-border")}`),
  rule([".workspace-header"], `background:${token("color-chrome")};border-block-end:1px solid ${token("color-border")}`),
  rule([".workspace-brand"], `gap:2px;padding-block:calc(${token("spacing-tight")}*1px)`),
  rule([".workspace-brand > :first-child"], "font-size:20px;font-weight:700;letter-spacing:-0.01em"),
  rule([".workspace-brand > :last-child"], `color:${token("color-muted")};font-size:11px;letter-spacing:.02em;text-transform:none`),
  rule([".workspace-environment"], `border-color:${token("color-border-strong")};color:${token("color-muted")};font-size:11px;letter-spacing:.08em;text-transform:uppercase`),
  rule([".workspace-header ol"], "font-size:13px;letter-spacing:.01em"),
  rule([".workspace-header li:last-child"], `color:${token("color-foreground")}`),

  // Navigation. The current destination is the only orange thing in the rail.
  rule([".workspace-sidebar [data-navigation-label]"], `color:${token("color-muted")};font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase`),
  rule([".workspace-sidebar a"], `position:relative;padding:7px 12px;border-radius:calc(${token("radius-control")}*1px);color:#c9c9c9;font-size:13px`),
  rule([".workspace-sidebar a:hover"], "background:#1c1c1c;color:#ededed"),
  rule(['.workspace-sidebar a[aria-current="page"]'], `background:#1f1f1f;color:${token("color-foreground")};font-weight:600`),
  rule(['.workspace-sidebar a[aria-current="page"]::before'], `content:"";position:absolute;inset-block:6px;inset-inline-start:0;width:3px;border-radius:2px;background:${token("color-accent")}`),

  // Panels. A numbered frame with corner marks, and a title that reads as a
  // label rather than prose.
  rule(['[data-k-nex-primitive="card"]', '[data-k-nex-component="metric"]', '[data-k-nex-component="stat-card"]', '[data-k-nex-component="filter-bar"]', '[data-k-nex-component="action-bar"]'],
    `background:${token("color-surface")};border-color:${token("color-border")};${cornerBrackets(token("color-border-strong"))}`),
  rule(['[data-k-nex-component="page-header"] [data-slot="title"]'], "font-size:calc(var(--k-font-title)*1px);font-weight:700;letter-spacing:-0.02em"),
  rule(['[data-k-nex-component="page-header"] [data-slot="description"]'], `color:${token("color-muted")}`),
  rule(['[data-k-nex-component="section"] > h2', '[data-k-nex-component="section"] > h3', '[data-k-nex-primitive="heading"][data-level="2"]', '[data-k-nex-primitive="heading"][data-level="3"]'],
    `color:${token("color-foreground")};font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase`),

  // Tables. Money and counts line up; the header is a label strip, not a row.
  rule(["table"], `background:${token("color-surface")};border-color:${token("color-border")}`),
  rule(["th"], `background:transparent;border-block-end:1px solid ${token("color-border")};color:${token("color-muted")};font-size:11px;letter-spacing:.1em;text-transform:uppercase`),
  rule(["td"], `border-block-end:1px solid ${token("color-border")};font-size:13px;font-variant-numeric:tabular-nums`),
  rule(["tbody tr:hover td"], "background:#1f1f1f"),

  // Controls.
  rule(['[data-k-nex-primitive="button"][data-variant="primary"]', 'button[type="submit"]'],
    `background:${token("color-accent")};border-color:${token("color-accent")};color:${token("color-accent-contrast")};font-weight:600`),
  rule(["button"], `background:#1f1f1f;border-color:${token("color-border-strong")};color:${token("color-foreground")};font-size:13px`),
  rule(["button:hover:not(:disabled)"], "background:#272727"),
  rule(['input:not([type="checkbox"]):not([type="radio"])', "select", "textarea"],
    `background:${token("color-surface-sunken")};border-color:${token("color-border")};color:${token("color-foreground")}`),
  rule(['input[type="checkbox"]', 'input[type="radio"]'], `accent-color:${token("color-accent")}`),
  rule(['[data-k-nex-primitive="badge"]', '[data-k-nex-primitive="status"]'],
    `background:#1f1f1f;border-color:${token("color-border")};color:${token("color-foreground")};font-size:11px;letter-spacing:.04em`),

  // Board. Lanes are graphite; a card is the object on the lane.
  rule(['[data-slot="kanban-columns"] > section'], `background:${token("color-surface-sunken")};border-color:${token("color-border")}`),
  rule(['[data-slot="kanban-columns"] > section > h3'], `color:${token("color-foreground")};font-size:12px;letter-spacing:.1em;text-transform:uppercase`),
  rule(['[data-slot="kanban-columns"] li'], `background:${token("color-surface")};border-color:${token("color-border")};font-size:13px`),
  rule(['[data-slot="kanban-columns"] li:hover'], `border-color:${token("color-border-strong")}`),
  rule(['[data-slot="kanban-card-stage"]'], `color:${token("color-muted")};font-size:11px;letter-spacing:.08em`),

  // Paper. What a person reads at length or authors sits on paper, and every
  // control on it inverts with it.
  rule(paperSurfaces, `background:${token("color-paper")};color:${token("color-paper-foreground")};border-color:${token("color-paper-border")};background-image:none`),
  rule(paperSurfaces.map((surface) => `${surface} :where(h1,h2,h3,h4,dt,strong,th)`), `color:${token("color-paper-foreground")}`),
  rule(paperSurfaces.map((surface) => `${surface} :where(p,dd,span,td,li)`), `color:${token("color-paper-foreground")}`),
  rule(paperSurfaces.flatMap((surface) => [`${surface} [data-slot="value"]`, `${surface} [data-k-nex-component="field-description"]`]), `color:${token("color-paper-muted")}`),
  rule(paperSurfaces.map((surface) => `${surface} :where(th,td)`), `border-color:${token("color-paper-border")}`),
  rule(paperSurfaces.map((surface) => `${surface} a`), `color:#b8451f`),

  // The workspace footer strip the concept ends every screen with.
  rule([".workspace-sidebar::after"], `content:"K-Nex";display:block;margin-block-start:auto;padding-block-start:calc(${token("spacing-content")}*1px);color:${token("color-muted")};font-size:10px;letter-spacing:.16em;text-transform:uppercase`),

  `@media (forced-colors:active){${themeRootSelector} [data-k-nex-primitive="card"]{background-image:none}}`
].join("\n");

const structuralCss = `${createWorkspaceCss({
  borderWidth: 1,
  elevation: "soft",
  headingTransform: "uppercase",
  headingLetterSpacing: ".1em",
  emphasis: "flat"
})}\n${languageCss}`;

export const graphitePaperThemePackage = defineThemePackage({
  id: "theme.graphite-paper",
  version: "1.1.0",
  surfaces: ["admin", "public"],
  tokenSchema: { safeParse: tokenSchema },
  defaults,
  palettes: [
    { id: "graphite", values: {} },
    {
      id: "paper",
      values: {
        "color.background": "#efeae0",
        "color.surface": "#f7f4ec",
        "color.surface-sunken": "#e7e1d4",
        "color.chrome": "#1b1a17",
        "color.foreground": "#1b1a17",
        "color.muted": "#6b6557",
        "color.border": "#ddd5c6",
        "color.border-strong": "#c7bda9",
        "color.paper": "#ffffff",
        "color.paper-border": "#ddd5c6",
        "color.paper-foreground": "#1b1a17",
        "color.paper-muted": "#6b6557",
        "shadow.card": "0 1px 2px #00000026",
        "shadow.overlay": "0 18px 48px #0000003d"
      }
    }
  ],
  recipes: Object.fromEntries(semanticPrimitiveNames.map((name) => [name, ["default"]])),
  structuralCss,
  migrations: [],
  primitiveOverrides: reactAriaPrimitives
});

const registry = createThemeRegistry([graphitePaperThemePackage]);

export function resolveGraphitePaperThemeProfile(profile: unknown) {
  return createThemePresentation(registry.resolveProfile(profile));
}
