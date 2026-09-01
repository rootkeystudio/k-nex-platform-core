import { describe, expect, it } from "vitest";

import {
  createThemePresentation,
  createThemeRegistry,
  createThemeSkinGeneration,
  createThemeSkinRegistry,
  themeRootSelector,
  type ThemeSkinGenerationInput,
  type ThemeTokenValues
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h4v4H0z"/></svg>');

const tokens = {
  "--k-nex-skin-color-background": "#ffffff",
  "--k-nex-skin-color-foreground": "#111111",
  "--k-nex-skin-color-accent": "#0088cc",
  "--k-nex-skin-focus-ring": "#000000",
  "--k-nex-skin-motion-duration": "120ms"
};

const css = `${themeRootSelector}{background:var(--k-nex-skin-color-background);color:var(--k-nex-skin-color-foreground)}
${themeRootSelector} [data-k-nex-primitive="card"]{border:1px solid var(--k-nex-skin-color-foreground);padding:8px}
${themeRootSelector} [data-k-nex-primitive="button"]{transition-duration:var(--k-nex-skin-motion-duration);padding:8px}`;

function skin(overrides: Partial<ThemeSkinGenerationInput> = {}): ThemeSkinGenerationInput {
  return {
    generationId: "skin-generation-1",
    manifest: {
      schemaVersion: 1, deliveryClass: "theme-skin", id: "skin.neobrutalism", displayName: "Neobrutalism", version: "1.0.0", runtimeAbi: "1.0.0",
      profileCompatibility: { schemaVersion: 1 }, tokens, palettes: { "skin.bright": {} }, recipes: { surface: "skin.surface", focusRing: "skin.focus-ring" },
      stylesheets: ["styles/skin.css"], profileMigrations: [], assets: [{ path: "assets/grid.svg", digest: digest("a") }], localization: [],
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 131_072, maxCssBytes: 65_536 }
    },
    stylesheets: { "styles/skin.css": css },
    assets: { "assets/grid.svg": { digest: digest("a"), contentType: "image/svg+xml", bytes: svg } },
    ...overrides
  };
}

const profile = {
  schemaVersion: 1, id: "theme-profile.public-default", surface: "public", themeId: "theme.minimal", themeVersion: "1.0.0", palette: "default", mode: "light", values: {},
  skin: { id: "skin.neobrutalism", generationId: "skin-generation-1", version: "1.0.0", palette: "skin.bright", values: { "--k-nex-skin-color-accent": "#0088cc" } },
  revision: { id: "theme-revision.public-1", number: 1, state: "published", createdAt: "2026-08-29T09:00:00.000Z", publishedAt: "2026-08-29T09:01:00.000Z" }
} as const;

function baseTheme() {
  return {
    id: "theme.minimal", version: "1.0.0", surfaces: ["public"] as const,
    tokenSchema: { safeParse(value: unknown) { return { success: true as const, data: value as ThemeTokenValues }; } },
    defaults: { "color.background": "#fff" }, palettes: [{ id: "default", values: {} }], recipes: {},
    structuralCss: `${themeRootSelector}{display:block}`, migrations: []
  };
}

describe("live Theme Skin generations", () => {
  it("resolves an exact immutable generation and layers data-only CSS onto the unchanged base profile", () => {
    const generation = createThemeSkinGeneration(skin());
    const registry = createThemeRegistry([baseTheme()], createThemeSkinRegistry([generation]));
    const before = structuredClone(profile);
    const presentation = createThemePresentation(registry.resolveProfile(profile));
    expect(profile).toEqual(before);
    expect(presentation).toMatchObject({ skinId: "skin.neobrutalism", skinGenerationId: "skin-generation-1", skinRecipes: { surface: "skin.surface", focusRing: "skin.focus-ring" } });
    expect(presentation.cssText).toContain("--k-nex-skin-color-accent:#0088cc");
    expect(presentation.cssText).toContain("@media (prefers-reduced-motion: reduce)");
    expect(presentation.cssText).toContain("::before");
    expect(presentation.cssText).toContain("::after");
    expect(presentation.cssText).toContain("outline:3px solid var(--k-nex-skin-focus-ring)!important");
    expect(presentation.cssText).toContain(" :focus-visible:where");
    expect(presentation.cssText).not.toContain(themeRootSelector);
    expect(Object.isFrozen(generation.manifest)).toBe(true);
  });

  it("fails closed on missing generations, palettes, undeclared overrides, or incompatible profiles", () => {
    const generation = createThemeSkinGeneration(skin());
    const skins = createThemeSkinRegistry([generation]);
    expect(() => skins.resolve({ ...profile.skin, generationId: "skin-generation-2" })).toThrow(/not active or retained/);
    expect(() => skins.resolve({ ...profile.skin, palette: "skin.missing" })).toThrow(/palette/);
    expect(() => skins.resolve({ ...profile.skin, values: { "--k-nex-skin-unknown": "#000000" } })).toThrow(/undeclared/);
    const incompatible = createThemeSkinGeneration(skin({ manifest: { ...(skin().manifest as object), profileCompatibility: { schemaVersion: 2 } } }));
    expect(() => createThemeSkinRegistry([incompatible]).resolve({ ...profile.skin, generationId: incompatible.generationId })).toThrow(/migration/);
    const migrated = createThemeSkinGeneration(skin({ manifest: {
      ...(skin().manifest as object), profileCompatibility: { schemaVersion: 2 },
      profileMigrations: [{ fromSchemaVersion: 1, toSchemaVersion: 2, renames: [{ from: "--k-nex-skin-accent-old", to: "--k-nex-skin-color-accent" }] }]
    } }));
    expect(createThemeSkinRegistry([migrated]).resolve({ ...profile.skin, values: { "--k-nex-skin-accent-old": "#0088cc" } }).tokens["--k-nex-skin-color-accent"]).toBe("#0088cc");
  });

  it.each([
    ["global selector", css.replace(`${themeRootSelector}{`, "body{")],
    ["remote URL", `${css}\n${themeRootSelector}{background-image:url(https://evil.test/grid.svg)}`],
    ["forbidden property", css.replace("background:var", "position:fixed;background:var")],
    ["host guard media", `${css}\n@media (prefers-reduced-motion: reduce){${themeRootSelector} *{transition-duration:0ms!important}}`],
    ["host focus outline", `${css}\n${themeRootSelector} [data-focus-visible]{outline:3px solid currentColor}`],
    ["supports block", `${css}\n@supports (display: grid){${themeRootSelector}{padding:8px}}`],
    ["nested media", `${css}\n@media (min-width: 1px){@media (prefers-color-scheme: dark){${themeRootSelector}{padding:8px}}}`]
  ])("rejects %s CSS before activation", (_name, stylesheet) => {
    expect(() => createThemeSkinGeneration(skin({ stylesheets: { "styles/skin.css": stylesheet } }))).toThrow();
  });

  it("does not accept accessibility evidence hidden in comments", () => {
    const spoofed = `${themeRootSelector}{display:block}/* @media (prefers-reduced-motion: reduce){x{transition-duration:0ms!important}} @media (forced-colors: active){x{outline-color:CanvasText}} ${themeRootSelector} [data-focus-visible]{outline:solid} */`;
    expect(() => createThemeSkinGeneration(skin({ stylesheets: { "styles/skin.css": spoofed } }))).toThrow(/comment|declaration-breaking/i);
  });

  it.each([
    ["escaped remote url", `${css}\n${themeRootSelector}{background:\\75\\72\\6c(\\68\\74\\74\\70\\73\\3a\\2f\\2f\\65\\76\\69\\6c\\2e\\74\\65\\73\\74\\2f\\74\\68\\65\\6d\\65\\2e\\63\\73\\73)}`],
    ["escaped import", `${css}\n@\\69mport url(//evil.test/theme.css);`],
    ["comment smuggling", `${css}\n${themeRootSelector}{color:var(--k-nex-skin-color-foreground)/*;background:url(//evil.test)*/}`],
    ["quoted value", `${css}\n${themeRootSelector}{color:"#ffffff"}`],
    ["custom-property smuggling", `${css}\n${themeRootSelector}{--k-nex-skin-focus-ring:#ffffff}`],
    ["focus cascade override", `${css}\n${themeRootSelector} [data-focus-visible]{outline:none!important}`],
    ["motion cascade override", `${css}\n${themeRootSelector} [data-k-nex-primitive="button"]{transition-duration:999s!important}`],
    ["forced-colors cascade override", `${css}\n@media (forced-colors: active){${themeRootSelector} [data-k-nex-primitive="button"]{border-color:var(--k-nex-skin-color-accent)}}`],
    ["asset placement", `${css}\n${themeRootSelector}{background-image:asset("assets/grid.svg")}`],
    ["literal contrast override", `${css}\n${themeRootSelector}{background:#ffffff;color:#ffffff}`],
    ["link affordance removal", `${css}\n${themeRootSelector} a{text-decoration:none}`],
    ["undeclared CSS variable", css.replace("var(--k-nex-skin-color-background)", "var(--k-nex-skin-missing)")],
    ["CSS variable fallback", css.replace("var(--k-nex-skin-color-background)", "var(--k-nex-skin-color-background,#ffffff)")],
    ["nested CSS variable", css.replace("var(--k-nex-skin-color-background)", "var(var(--k-nex-skin-color-background))")],
    ["hidden focus target", `${css}\n${themeRootSelector} [data-k-nex-primitive="button"]{display:none}`],
    ["case-insensitive hidden focus target", `${css}\n${themeRootSelector} [data-k-nex-primitive="button"]{display:NoNe}`],
    ["transparent focus target", `${css}\n${themeRootSelector} [data-k-nex-primitive="button"]{opacity:calc(0)}`],
    ["collapsed focus target", `${css}\n${themeRootSelector} [data-k-nex-primitive="button"]{min-width:0PX}`],
    ["hidden text", `${css}\n${themeRootSelector}{font-size:0;line-height:0}`],
    ["pseudo-element motion", `${css}\n${themeRootSelector} input::file-selector-button{transition-duration:var(--k-nex-skin-motion-duration)}`],
    ["legacy pseudo-element motion", `${css}\n${themeRootSelector} [data-k-nex-primitive="button"]:before{transition-duration:var(--k-nex-skin-motion-duration)}`]
  ])("rejects CSS lexical and cascade smuggling: %s", (_name, stylesheet) => {
    expect(() => createThemeSkinGeneration(skin({ stylesheets: { "styles/skin.css": stylesheet } }))).toThrow();
  });

  it("allows signed accent backgrounds only when the required contrast pair is valid", () => {
    const stylesheet = `${css}\n${themeRootSelector} [data-k-nex-primitive="button"]{background:var(--k-nex-skin-color-accent);color:var(--k-nex-skin-color-foreground)}`;
    expect(() => createThemeSkinGeneration(skin({ stylesheets: { "styles/skin.css": stylesheet } }))).not.toThrow();
  });

  it("rejects bad contrast, executable SVG, mixed inventories, and executable skin fields", () => {
    const original = skin();
    const badContrast = skin({ manifest: { ...(original.manifest as object), tokens: { ...tokens, "--k-nex-skin-color-foreground": "#fefefe" } } });
    expect(() => createThemeSkinGeneration(badContrast)).toThrow(/contrast/);
    expect(() => createThemeSkinGeneration(skin({ manifest: { ...(original.manifest as object), tokens: { ...tokens, "--k-nex-skin-color-accent": "#005fcc" } } }))).toThrow(/foreground-on-accent/);
    expect(() => createThemeSkinGeneration(skin({ manifest: { ...(original.manifest as object), tokens: { ...tokens, "--k-nex-skin-focus-ring": "#0088cc" } } }))).toThrow(/focus-on-accent/);
    expect(() => createThemeSkinGeneration(skin({ assets: { "assets/grid.svg": { digest: digest("a"), contentType: "image/svg+xml", bytes: new TextEncoder().encode("<svg><script>alert(1)</script></svg>") } } }))).toThrow(/executable/);
    expect(() => createThemeSkinGeneration(skin({ stylesheets: { "styles/other.css": css } }))).toThrow(/inventory/);
    expect(() => createThemeSkinGeneration(skin({ manifest: { ...(skin().manifest as object), entrypoints: { ui: ["ui/theme.mjs"] } } }))).toThrow();
  });

  it("keeps palette and variable namespaces bound to the base manifest tokens", () => {
    expect(() => createThemeSkinGeneration(skin({ manifest: { ...(skin().manifest as object), tokens: { ...tokens, "--k-nex-public-color-background": "#ffffff" } } }))).toThrow();
    expect(() => createThemeSkinGeneration(skin({ manifest: { ...(skin().manifest as object), palettes: { "skin.bright": { "--k-nex-skin-palette-only": "#ffffff" } } } }))).toThrow(/unknown token/);
  });

  it.each([
    '<svg><use href="//evil.test/icon.svg#x"/></svg>',
    '<svg><use href="/assets/icon.svg#x"/></svg>',
    '<svg><style>@import url("https://evil.test/theme.css");</style></svg>',
    '<svg><path style="fill:url(https://evil.test/payload)"/></svg>',
    '<svg><path fill="&#117;&#114;&#108;&#40;&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;&#101;&#118;&#105;&#108;&#46;&#116;&#101;&#115;&#116;&#47;&#112;&#97;&#121;&#108;&#111;&#97;&#100;&#41;"/></svg>',
    '<svg><path fill="\\75\\72\\6c(\\68\\74\\74\\70\\73\\3a\\2f\\2f\\65\\76\\69\\6c\\2e\\74\\65\\73\\74\\2f\\70\\61\\79\\6c\\6f\\61\\64)"/></svg>',
    '<svg><path mask="image-set(\'https://evil.test/payload.svg\' 1x)"/></svg>'
  ])("rejects SVG network references at activation: %s", (unsafe) => {
    expect(() => createThemeSkinGeneration(skin({ assets: { "assets/grid.svg": { digest: digest("a"), contentType: "image/svg+xml", bytes: new TextEncoder().encode(unsafe) } } }))).toThrow(/SVG.*remote|SVG.*unsafe/i);
  });

  it.each([
    ["unbounded padding", `${css}\n${themeRootSelector}{padding:999px}`],
    ["layered shadow", `${css}\n${themeRootSelector}{box-shadow:1px 1px var(--k-nex-skin-color-accent),1px 1px var(--k-nex-skin-color-accent)}`],
    ["inset contrast cover", `${css}\n${themeRootSelector}{box-shadow:inset 0px 0px 0px 99px var(--k-nex-skin-color-foreground)}`],
    ["sibling contrast cover", `${css}\n${themeRootSelector} [data-k-nex-primitive="button"]{box-shadow:0px 0px 0px 99px var(--k-nex-skin-color-foreground)}`],
    ["unbounded letter spacing", `${css}\n${themeRootSelector}{letter-spacing:999px}`]
  ])("rejects unbounded visual values: %s", (_name, stylesheet) => {
    expect(() => createThemeSkinGeneration(skin({ stylesheets: { "styles/skin.css": stylesheet } }))).toThrow();
  });
});
