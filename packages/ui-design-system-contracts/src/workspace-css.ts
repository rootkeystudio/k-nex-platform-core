import { themeRootSelector } from "./theme-css.js";

/**
 * What a theme is allowed to change. Layout is not on this list.
 *
 * A theme that has to author its own layout ships an application whose pages
 * are whatever raw HTML the components happen to emit, and every theme has to
 * rediscover the same structure before it can look like anything. Spacing,
 * alignment, density, and the shape of a page, a table, a form, and the
 * workspace shell are the product's, and they arrive with the theme rather
 * than after it. A design language chooses how that structure reads: its
 * weight, its edges, its emphasis.
 */
export interface ThemeDesignLanguage {
  /** Border weight in pixels. A heavier line is the whole difference between a quiet surface and a blocked one. */
  readonly borderWidth: number;
  /** `soft` lets shadows sit under surfaces; `hard` offsets them as a solid block. */
  readonly elevation: "soft" | "hard";
  /** Section and column headings: `uppercase` reads as a label, `none` as prose. */
  readonly headingTransform: "none" | "uppercase";
  /** Extra tracking applied to headings and labels. */
  readonly headingLetterSpacing: string;
  /** Interactive emphasis: `flat` fills, `block` fills and offsets. */
  readonly emphasis: "flat" | "block";
}

/** Token aliases. Every value resolves admin-first, then the public surface. */
const tokenAliases: readonly (readonly [string, string])[] = Object.freeze([
  ["--k-accent", "color-accent"],
  ["--k-accent-contrast", "color-accent-contrast"],
  ["--k-bg", "color-background"],
  ["--k-surface", "color-surface"],
  ["--k-sunken", "color-surface-sunken"],
  ["--k-border", "color-border"],
  ["--k-border-strong", "color-border-strong"],
  ["--k-fg", "color-foreground"],
  ["--k-muted", "color-muted"],
  ["--k-positive", "color-positive"],
  ["--k-warning", "color-warning"],
  ["--k-critical", "color-critical"],
  ["--k-radius-control", "radius-control"],
  ["--k-radius-surface", "radius-surface"],
  ["--k-shadow-card", "shadow-card"],
  ["--k-shadow-overlay", "shadow-overlay"],
  ["--k-space-tight", "spacing-tight"],
  ["--k-space-content", "spacing-content"],
  ["--k-space-section", "spacing-section"],
  ["--k-font-small", "font-size-small"],
  ["--k-font-body", "font-size-body"],
  ["--k-font-large", "font-size-large"],
  ["--k-font-title", "font-size-title"],
  ["--k-control-height", "control-height"],
  ["--k-motion", "motion-duration"]
]);

const numericAliases = new Set([
  "--k-radius-control", "--k-radius-surface", "--k-space-tight", "--k-space-content", "--k-space-section",
  "--k-font-small", "--k-font-body", "--k-font-large", "--k-font-title", "--k-control-height", "--k-motion"
]);

function aliasDeclarations(): string {
  return tokenAliases.map(([alias, token]) => {
    const value = `var(--k-nex-admin-${token},var(--k-nex-public-${token}))`;
    return `${alias}:${numericAliases.has(alias) ? value : value}`;
  }).join(";");
}

/**
 * Scoping is per selector, not per rule: a theme stylesheet may only reach
 * inside its own root, so every alternative in a selector list carries the
 * root itself. Passing a list as one string would scope the first and leave
 * the rest matching the whole document.
 */
function topLevelSelectors(value: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function rule(selectors: string | readonly string[], declarations: string): string {
  const list = (typeof selectors === "string" ? [selectors] : [...selectors]).flatMap((selector) =>
    selector === "" ? [""] : topLevelSelectors(selector));
  const scoped = list.map((selector) => `${themeRootSelector}${selector === "" ? "" : ` ${selector}`}`).join(",");
  return `${scoped}{${declarations}}`;
}

/**
 * The complete workspace surface: shell, page, data, forms, feedback. Written
 * against the component and primitive hooks the platform guarantees, so a page
 * that composes those pieces is laid out without knowing a theme exists.
 */
export function createWorkspaceCss(language: ThemeDesignLanguage): string {
  const border = `${language.borderWidth}px solid var(--k-border)`;
  const borderStrong = `${language.borderWidth}px solid var(--k-border-strong)`;
  const radius = "calc(var(--k-radius-control)*1px)";
  const surfaceRadius = "calc(var(--k-radius-surface)*1px)";
  const cardShadow = language.elevation === "hard"
    ? `${language.borderWidth * 2}px ${language.borderWidth * 2}px 0 var(--k-border-strong)`
    : "var(--k-shadow-card)";
  const overlayShadow = language.elevation === "hard"
    ? `${language.borderWidth * 3}px ${language.borderWidth * 3}px 0 var(--k-border-strong)`
    : "var(--k-shadow-overlay)";
  const pressOffset = language.emphasis === "block" ? `${language.borderWidth}px` : "0px";
  const labelTypography = `font-size:calc(var(--k-font-small)*1px);font-weight:600;letter-spacing:${language.headingLetterSpacing};text-transform:${language.headingTransform}`;

  return [
    // Root and document rhythm.
    rule("", `${aliasDeclarations()};background:var(--k-bg);color:var(--k-fg);font-size:calc(var(--k-font-body)*1px);line-height:1.5;-webkit-text-size-adjust:100%`),
    rule("*", "box-sizing:border-box"),
    rule(":where(h1,h2,h3,h4,h5,h6)", "margin:0;line-height:1.25;text-wrap:balance"),
    rule(":where(p,ul,ol,dl,figure,pre)", "margin:0"),
    rule(":where(ul,ol)", "padding-inline-start:0;list-style:none"),
    rule(":where(a)", "color:var(--k-accent);text-decoration-thickness:1px;text-underline-offset:2px"),
    rule(":where(a):hover", "text-decoration-thickness:2px"),
    rule(":where(a,button,input,select,textarea,summary,[tabindex]):focus-visible", "outline:3px solid var(--k-accent);outline-offset:2px;border-radius:2px"),
    rule(':where([data-k-nex-component="visually-hidden"])', "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0"),

    // Workspace shell.
    rule(".workspace-shell", "display:grid;grid-template-columns:17.5rem minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);min-height:100dvh;background:var(--k-sunken)"),
    rule('.workspace-shell[data-sidebar="collapsed"]', "grid-template-columns:4.5rem minmax(0,1fr)"),
    rule(".workspace-sidebar", `grid-row:1/-1;display:flex;flex-direction:column;gap:calc(var(--k-space-content)*1px);padding:calc(var(--k-space-content)*1px);background:var(--k-surface);border-inline-end:${border};min-width:0;overflow:auto`),
    rule(".workspace-brand", "display:grid;gap:2px;padding-block-end:calc(var(--k-space-tight)*1px)"),
    rule(".workspace-brand > :first-child", `font-size:calc(var(--k-font-large)*1px);font-weight:700;letter-spacing:${language.headingLetterSpacing}`),
    rule(".workspace-brand > :last-child", `color:var(--k-muted);${labelTypography}`),
    rule(".workspace-sidebar nav ul", "display:grid;gap:2px;padding-inline-start:0"),
    rule(".workspace-sidebar li", "margin:0;min-width:0"),
    rule(".workspace-sidebar [data-navigation-label]", `display:block;margin-block:calc(var(--k-space-content)*1px) calc(var(--k-space-tight)*1px);color:var(--k-muted);${labelTypography}`),
    rule(".workspace-sidebar a", `display:flex;align-items:center;gap:calc(var(--k-space-tight)*1px);padding:8px 10px;border-radius:${radius};color:var(--k-fg);text-decoration:none;min-height:36px;transition:background-color calc(var(--k-motion)*1ms) ease`),
    rule(".workspace-sidebar a:hover", "background:var(--k-sunken)"),
    rule('.workspace-sidebar a[aria-current="page"]', `background:var(--k-accent);color:var(--k-accent-contrast);font-weight:600`),
    rule(".workspace-desktop-navigation-rail", "display:none"),
    rule('.workspace-shell[data-sidebar="collapsed"] .workspace-desktop-navigation-rail', "display:block"),
    rule(".workspace-desktop-navigation-rail .workspace-rail-item", "display:flex;align-items:center;justify-content:center;min-block-size:40px"),
    rule(".workspace-header", `grid-column:2;display:flex;align-items:center;justify-content:space-between;gap:calc(var(--k-space-content)*1px);padding:calc(var(--k-space-tight)*1px) calc(var(--k-space-section)*1px);background:var(--k-surface);border-block-end:${border};min-width:0;min-height:56px`),
    rule(".workspace-header ol", "display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--k-space-tight)*1px);margin:0;padding:0;list-style:none;color:var(--k-muted);font-size:calc(var(--k-font-small)*1px)"),
    rule(".workspace-header li:last-child", "color:var(--k-fg);font-weight:600"),
    rule(".workspace-header li + li::before", 'content:"/";margin-inline-end:calc(var(--k-space-tight)*1px);color:var(--k-border-strong)'),
    rule(".workspace-environment", `border:${borderStrong};border-radius:999px;padding:4px 12px;color:var(--k-muted);${labelTypography}`),
    rule(".workspace-skip-link", `position:fixed;inset-block-start:8px;inset-inline-start:-100vw;z-index:1000;padding:8px 12px;border-radius:${radius};background:var(--k-accent);color:var(--k-accent-contrast)`),
    rule(".workspace-skip-link:focus", "inset-inline-start:8px"),
    rule(".workspace-mobile-trigger", "display:none"),
    rule(".workspace-drawer-overlay", "position:fixed;inset:0;z-index:100;background:#0009"),
    rule(".workspace-drawer", `position:fixed;inset-block:0;inset-inline-start:0;z-index:101;block-size:100%;inline-size:min(22rem,90vw);overflow:auto;padding:calc(var(--k-space-content)*1px);background:var(--k-surface);border-inline-end:${borderStrong}`),
    rule(".workspace-drawer-heading", `display:flex;align-items:center;justify-content:space-between;gap:calc(var(--k-space-content)*1px);padding-block-end:calc(var(--k-space-content)*1px);border-block-end:${border}`),
    rule(".workspace-drawer a", `display:block;padding:10px;border-radius:${radius};color:var(--k-fg);text-decoration:none`),
    rule(".workspace-drawer [data-navigation-label]", `display:block;margin-block:calc(var(--k-space-content)*1px) calc(var(--k-space-tight)*1px);color:var(--k-muted);${labelTypography}`),

    // Page frame.
    rule(['[data-k-nex-component="page-shell"]', "main"], "grid-column:2;display:block;min-width:0;padding:calc(var(--k-space-section)*1px);overflow:auto"),
    rule('[data-k-nex-component="page-header"]', `display:grid;gap:calc(var(--k-space-tight)*1px);margin-block-end:calc(var(--k-space-section)*1px)`),
    rule('[data-k-nex-component="page-header"] [data-slot="title"]', `font-size:calc(var(--k-font-title)*1px);font-weight:700;letter-spacing:${language.headingLetterSpacing};line-height:1.15`),
    rule('[data-k-nex-component="page-header"] [data-slot="description"]', "color:var(--k-muted);max-width:60ch"),
    rule('[data-k-nex-component="page-header"] [data-slot="actions"]', "display:flex;flex-wrap:wrap;gap:calc(var(--k-space-tight)*1px);margin-block-start:calc(var(--k-space-tight)*1px)"),
    rule('[data-k-nex-component="section"]', `display:block;margin-block-end:calc(var(--k-space-section)*1px)`),
    rule('[data-k-nex-component="action-bar"]', `display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--k-space-tight)*1px);padding:calc(var(--k-space-tight)*1px);margin-block-end:calc(var(--k-space-content)*1px);background:var(--k-surface);border:${border};border-radius:${radius}`),
    rule('[data-k-nex-component="split-view"]', "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,22rem);gap:calc(var(--k-space-section)*1px);align-items:start"),
    rule('[data-k-nex-component="detail-panel"]', `padding:calc(var(--k-space-content)*1px);background:var(--k-surface);border:${border};border-radius:${surfaceRadius};box-shadow:${cardShadow}`),

    // Primitives.
    rule('[data-k-nex-primitive="stack"]', "display:flex;flex-direction:column;gap:calc(var(--k-space-content)*1px);min-width:0"),
    rule('[data-k-nex-primitive="inline"]', "display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--k-space-tight)*1px);min-width:0"),
    rule('[data-gap="none"]', "gap:0"),
    rule('[data-gap="tight"]', "gap:calc(var(--k-space-tight)*1px)"),
    rule('[data-gap="section"]', "gap:calc(var(--k-space-section)*1px)"),
    rule('[data-align="start"]', "align-items:flex-start"),
    rule('[data-align="center"]', "align-items:center"),
    rule('[data-align="end"]', "align-items:flex-end"),
    rule('[data-k-nex-primitive="grid"]', "display:grid;gap:calc(var(--k-space-content)*1px);grid-template-columns:repeat(var(--k-columns,1),minmax(0,1fr))"),
    rule('[data-k-nex-primitive="grid"][data-columns="2"]', "--k-columns:2"),
    rule('[data-k-nex-primitive="grid"][data-columns="3"]', "--k-columns:3"),
    rule('[data-k-nex-primitive="grid"][data-columns="4"]', "--k-columns:4"),
    rule('[data-k-nex-primitive="grid"][data-columns="6"]', "--k-columns:6"),
    rule('[data-k-nex-primitive="grid"][data-columns="12"]', "--k-columns:12"),
    rule('[data-k-nex-primitive="container"]', "margin-inline:auto;width:100%;max-width:72rem"),
    rule('[data-k-nex-primitive="container"][data-size="narrow"]', "max-width:44rem"),
    rule('[data-k-nex-primitive="container"][data-size="wide"]', "max-width:96rem"),
    rule('[data-k-nex-primitive="heading"]', `font-weight:700;letter-spacing:${language.headingLetterSpacing}`),
    rule('[data-k-nex-primitive="heading"][data-level="1"]', "font-size:calc(var(--k-font-title)*1px)"),
    rule('[data-k-nex-primitive="heading"][data-level="2"]', "font-size:calc(var(--k-font-large)*1.35px)"),
    rule('[data-k-nex-primitive="heading"][data-level="3"]', "font-size:calc(var(--k-font-large)*1px)"),
    rule('[data-k-nex-primitive="heading"]:where([data-level="4"],[data-level="5"],[data-level="6"])', `font-size:calc(var(--k-font-body)*1px);${labelTypography}`),
    rule('[data-k-nex-primitive="text"][data-size="small"]', "font-size:calc(var(--k-font-small)*1px)"),
    rule('[data-k-nex-primitive="text"][data-size="large"]', "font-size:calc(var(--k-font-large)*1px)"),
    rule('[data-k-nex-primitive="text"][data-weight="medium"]', "font-weight:500"),
    rule('[data-k-nex-primitive="text"][data-weight="strong"]', "font-weight:700"),
    rule('[data-tone="neutral"]', "color:inherit"),
    rule('[data-tone="accent"]', "color:var(--k-accent)"),
    rule('[data-tone="positive"]', "color:var(--k-positive)"),
    rule('[data-tone="warning"]', "color:var(--k-warning)"),
    rule('[data-tone="critical"]', "color:var(--k-critical)"),
    rule('[data-k-nex-primitive="card"]', `display:block;padding:calc(var(--k-space-content)*1px);background:var(--k-surface);border:${border};border-radius:${surfaceRadius};box-shadow:${cardShadow}`),
    rule('[data-k-nex-primitive="card"][data-variant="interactive"]:hover', "border-color:var(--k-accent)"),
    rule(['[data-k-nex-primitive="badge"]', '[data-k-nex-primitive="status"]'], `display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border:${border};border-radius:999px;background:var(--k-sunken);font-size:calc(var(--k-font-small)*1px);font-weight:600;white-space:nowrap`),
    rule('[data-k-nex-primitive="skeleton"]', `display:block;min-height:1em;border-radius:${radius};background:var(--k-sunken)`),

    // Controls.
    rule(
      ["[data-k-nex-primitive=\"button\"]", "[data-k-nex-primitive=\"icon-button\"]", "[data-k-nex-primitive=\"dialog-trigger\"]", "[data-k-nex-primitive=\"popover-trigger\"]", "[data-k-nex-primitive=\"tooltip-trigger\"]", "button"],
      `display:inline-flex;align-items:center;justify-content:center;gap:calc(var(--k-space-tight)*1px);min-height:calc(var(--k-control-height)*1px);padding:0 16px;border:${borderStrong};border-radius:${radius};background:var(--k-surface);color:var(--k-fg);font:inherit;font-weight:600;cursor:pointer;box-shadow:${language.emphasis === "block" ? cardShadow : "none"};transition:background-color calc(var(--k-motion)*1ms) ease,transform calc(var(--k-motion)*1ms) ease`
    ),
    rule('button:hover:not(:disabled)', "background:var(--k-sunken)"),
    rule('button:active:not(:disabled)', `transform:translate(${pressOffset},${pressOffset});box-shadow:none`),
    rule(["button:disabled", '[data-k-nex-primitive="button"][aria-disabled="true"]'], "opacity:.55;cursor:not-allowed"),
    rule(['[data-k-nex-primitive="button"][data-variant="primary"]', 'button[type="submit"]'], "background:var(--k-accent);color:var(--k-accent-contrast);border-color:var(--k-accent)"),
    rule(['[data-k-nex-primitive="button"][data-variant="primary"]:hover:not(:disabled)', 'button[type="submit"]:hover:not(:disabled)'], "filter:brightness(.94);background:var(--k-accent)"),
    rule('[data-k-nex-primitive="button"][data-variant="quiet"]', "background:transparent;border-color:transparent;box-shadow:none"),
    rule('[data-k-nex-primitive="button"][data-variant="danger"]', "background:var(--k-critical);color:var(--k-accent-contrast);border-color:var(--k-critical)"),
    rule('[data-k-nex-primitive="icon-button"]', "padding:0;width:calc(var(--k-control-height)*1px)"),
    rule('[data-k-nex-component="icon"]', "display:inline-grid;place-items:center;inline-size:1.25em;line-height:1"),

    // Fields.
    rule(['[data-k-nex-primitive="form-field"]', '[data-k-nex-component="form-field"]', '[data-k-nex-component="field"]'], "display:grid;gap:6px;min-width:0"),
    rule(['[data-k-nex-component="label"]', "label"], `color:var(--k-fg);${labelTypography}`),
    rule(
      ["[data-k-nex-primitive=\"input\"]", "[data-k-nex-primitive=\"textarea\"]", "[data-k-nex-primitive=\"select\"]", "[data-k-nex-component=\"text-input\"]", "input:not([type=\"checkbox\"]):not([type=\"radio\"])", "select", "textarea"],
      `width:100%;min-height:calc(var(--k-control-height)*1px);padding:8px 12px;border:${border};border-radius:${radius};background:var(--k-surface);color:var(--k-fg);font:inherit;transition:border-color calc(var(--k-motion)*1ms) ease`
    ),
    rule(['input:not([type="checkbox"]):not([type="radio"]):hover', "select:hover", "textarea:hover"], "border-color:var(--k-border-strong)"),
    rule("textarea", "min-height:8rem;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:calc(var(--k-font-small)*1px)"),
    rule(["input::placeholder", "textarea::placeholder"], "color:var(--k-muted)"),
    rule(['[data-k-nex-primitive="checkbox"]', '[data-k-nex-component="checkbox"]'], "display:inline-flex;align-items:center;gap:8px;min-height:32px"),
    rule(['input[type="checkbox"]', 'input[type="radio"]'], "width:18px;height:18px;accent-color:var(--k-accent);margin:0"),
    rule(['[data-k-nex-component="field-description"]', '[data-slot="description"]'], "color:var(--k-muted);font-size:calc(var(--k-font-small)*1px)"),
    rule(['[data-k-nex-component="field-error"]', '[data-slot="error"]'], "color:var(--k-critical);font-size:calc(var(--k-font-small)*1px);font-weight:600"),
    rule(
      ['[data-k-nex-component="form"]', "form"],
      `display:grid;gap:calc(var(--k-space-content)*1px);padding:calc(var(--k-space-content)*1px);background:var(--k-surface);border:${border};border-radius:${surfaceRadius};box-shadow:${cardShadow};max-width:44rem`
    ),
    rule(['[data-k-nex-component="form"] > [data-slot="title"]', "form > legend"], `${labelTypography};color:var(--k-muted)`),
    rule('[data-k-nex-component="form-actions"]', `display:flex;flex-wrap:wrap;gap:calc(var(--k-space-tight)*1px);padding-block-start:calc(var(--k-space-tight)*1px);border-block-start:${border}`),
    rule("fieldset", `margin:0;padding:calc(var(--k-space-content)*1px);border:${border};border-radius:${radius}`),

    // Tables and data surfaces.
    rule(
      ["[data-k-nex-component=\"data-grid\"]", "[data-k-nex-component=\"data-table\"]", "[data-k-nex-primitive=\"table\"]", "table"],
      `width:100%;border-collapse:separate;border-spacing:0;background:var(--k-surface);border:${border};border-radius:${surfaceRadius};overflow:hidden`
    ),
    rule("th", `padding:12px 16px;text-align:start;background:var(--k-sunken);border-block-end:${border};color:var(--k-muted);${labelTypography};white-space:nowrap`),
    rule("td", `padding:12px 16px;border-block-end:${border};vertical-align:middle`),
    rule("tbody tr:last-child td", "border-block-end:0"),
    rule("tbody tr:hover td", "background:var(--k-sunken)"),
    rule(
      ["[data-k-nex-component=\"filter-bar\"]", "[data-k-nex-component=\"column-chooser\"]", "[data-k-nex-component=\"density-control\"]", "[data-k-nex-component=\"sort-control\"]", "[data-k-nex-component=\"search-control\"]", "[data-k-nex-component=\"pagination-control\"]"],
      "display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--k-space-tight)*1px);min-width:0"
    ),
    rule(
      '[data-k-nex-component="filter-bar"]',
      `padding:calc(var(--k-space-tight)*1px);margin-block-end:calc(var(--k-space-content)*1px);background:var(--k-surface);border:${border};border-radius:${radius}`
    ),
    rule('[data-k-nex-component="column-chooser"] label,[data-k-nex-component="density-control"] label,[data-k-nex-component="sort-control"] label,[data-k-nex-component="search-control"] label', "display:inline-flex;align-items:center;gap:6px;text-transform:none;font-weight:500;white-space:nowrap"),
    rule('[data-k-nex-component="column-chooser"] select,[data-k-nex-component="density-control"] select,[data-k-nex-component="sort-control"] select,[data-k-nex-component="search-control"] input', "width:auto;min-width:9rem"),
    rule(['[data-k-nex-component="pagination-control"]', '[data-k-nex-primitive="pagination"]'], `justify-content:flex-end;padding-block-start:calc(var(--k-space-content)*1px)`),
    rule(['[data-k-nex-component="metric"]', '[data-k-nex-component="stat-card"]'], `display:grid;gap:4px;padding:calc(var(--k-space-content)*1px);background:var(--k-surface);border:${border};border-radius:${surfaceRadius};box-shadow:${cardShadow}`),
    rule('[data-k-nex-component="metric"] [data-slot="label"]', `color:var(--k-muted);${labelTypography}`),
    rule('[data-k-nex-component="metric"] [data-slot="value"]', "font-size:calc(var(--k-font-title)*1px);font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums"),
    rule(['[data-k-nex-component="key-value-list"]', '[data-k-nex-component="description-list"]', "dl"], "display:grid;grid-template-columns:minmax(8rem,14rem) minmax(0,1fr);gap:8px calc(var(--k-space-content)*1px);margin:0"),
    rule("dt", `color:var(--k-muted);${labelTypography}`),
    rule("dd", "margin:0;min-width:0;overflow-wrap:anywhere"),
    rule(
      ["[data-k-nex-primitive=\"empty-state\"]", "[data-k-nex-primitive=\"error-state\"]", "[data-k-nex-component=\"empty-state\"]", "[data-k-nex-component=\"error-state\"]", "[data-k-nex-component=\"forbidden-state\"]", "[data-k-nex-component=\"loading-state\"]"],
      `display:grid;justify-items:center;gap:calc(var(--k-space-tight)*1px);padding:calc(var(--k-space-section)*1px);background:var(--k-surface);border:${language.borderWidth}px dashed var(--k-border);border-radius:${surfaceRadius};color:var(--k-muted);text-align:center`
    ),
    rule(['[data-k-nex-primitive="error-state"]', '[data-k-nex-component="error-state"]'], "border-color:var(--k-critical);color:var(--k-critical)"),

    // Builder chrome. The keyboard control strip is a toolbar, not a stack of
    // loose labels dropped above the canvas.
    rule(
      '[data-k-nex-component="builder-controls"]',
      `display:flex;flex-wrap:wrap;align-items:flex-end;gap:calc(var(--k-space-content)*1px);padding:calc(var(--k-space-content)*1px);margin-block-end:calc(var(--k-space-content)*1px);background:var(--k-surface);border:${border};border-radius:${surfaceRadius};box-shadow:${cardShadow}`
    ),
    rule('[data-k-nex-component="builder-controls"] label', "display:grid;gap:4px;min-width:0"),
    rule('[data-k-nex-component="builder-controls"] select', "min-width:12rem"),
    rule('[data-k-nex-component="builder-controls"] [id="k-nex-builder-position"]', `flex-basis:100%;color:var(--k-muted);font-size:calc(var(--k-font-small)*1px)`),

    // Overlays.
    rule(['[data-k-nex-primitive="dialog-modal"]', '[data-k-nex-component="dialog"] [data-slot="content"]'], `padding:calc(var(--k-space-section)*1px);background:var(--k-surface);border:${borderStrong};border-radius:${surfaceRadius};box-shadow:${overlayShadow};max-width:min(40rem,92vw)`),
    rule('[data-k-nex-primitive="popover"]', `padding:calc(var(--k-space-content)*1px);background:var(--k-surface);border:${border};border-radius:${radius};box-shadow:${overlayShadow}`),
    rule('[data-k-nex-primitive="tooltip"]', `padding:6px 10px;background:var(--k-fg);color:var(--k-bg);border-radius:${radius};font-size:calc(var(--k-font-small)*1px)`),
    rule('[data-k-nex-primitive="toast"]', `padding:calc(var(--k-space-content)*1px);background:var(--k-surface);border:${borderStrong};border-radius:${radius};box-shadow:${overlayShadow}`),

    // Responsive and preference overrides.
    `@media (max-width:60rem){${rule('[data-k-nex-component="split-view"]', "grid-template-columns:minmax(0,1fr)")}}`,
    `@media (max-width:48rem){${rule([".workspace-shell", '.workspace-shell[data-sidebar="collapsed"]'], "display:block")}${rule(".workspace-sidebar", "display:none")}${rule(".workspace-mobile-trigger", "display:inline-flex")}${rule(['[data-k-nex-component="page-shell"]', "main"], "padding:calc(var(--k-space-content)*1px)")}${rule(".workspace-header", "padding:calc(var(--k-space-tight)*1px) calc(var(--k-space-content)*1px)")}}`,
    `@media (prefers-reduced-motion:reduce){${rule("*", "transition-duration:0ms!important;animation-duration:0ms!important")}}`,
    `@media (forced-colors:active){${rule(['[data-k-nex-primitive="card"]', '[data-k-nex-primitive="button"]', '[data-k-nex-primitive="dialog-trigger"]', ".workspace-sidebar", ".workspace-header", ".workspace-environment", "table", "th", "td", "form"], "border-color:CanvasText")}}`
  ].join("\n");
}
