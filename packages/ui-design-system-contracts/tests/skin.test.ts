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
  "--k-nex-color-background": "#ffffff",
  "--k-nex-color-foreground": "#111111",
  "--k-nex-color-accent": "#005fcc",
  "--k-nex-focus-ring": "#000000",
  "--k-nex-motion-duration": "120ms"
};

const css = `${themeRootSelector}{background:var(--k-nex-color-background);color:var(--k-nex-color-foreground)}
${themeRootSelector} [data-k-nex-primitive="card"]{background-image:asset("assets/grid.svg");border:1px solid var(--k-nex-color-foreground)}
${themeRootSelector} [data-k-nex-primitive="button"]{min-width:44px;min-height:44px;transition-duration:var(--k-nex-motion-duration)}
${themeRootSelector} [data-focus-visible]{outline:3px solid var(--k-nex-focus-ring);outline-offset:2px}
@media (prefers-reduced-motion: reduce){${themeRootSelector} *{transition-duration:0ms!important}}
@media (forced-colors: active){${themeRootSelector} [data-k-nex-primitive="button"]{border-color:CanvasText;outline-color:CanvasText}}`;

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
  skin: { id: "skin.neobrutalism", generationId: "skin-generation-1", version: "1.0.0", palette: "skin.bright", values: { "--k-nex-color-accent": "#004fa8" } },
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
    expect(presentation.cssText).toContain("--k-nex-color-accent:#004fa8");
    expect(presentation.cssText).toContain(`/api/extensions/skins/skin.neobrutalism/assets/skin-generation-1/${digest("a")}/grid.svg`);
    expect(presentation.cssText).not.toContain(themeRootSelector);
    expect(Object.isFrozen(generation.manifest)).toBe(true);
  });

  it("fails closed on missing generations, palettes, undeclared overrides, or incompatible profiles", () => {
    const generation = createThemeSkinGeneration(skin());
    const skins = createThemeSkinRegistry([generation]);
    expect(() => skins.resolve({ ...profile.skin, generationId: "skin-generation-2" })).toThrow(/not active or retained/);
    expect(() => skins.resolve({ ...profile.skin, palette: "skin.missing" })).toThrow(/palette/);
    expect(() => skins.resolve({ ...profile.skin, values: { "--k-nex-unknown": "#000000" } })).toThrow(/undeclared/);
    const incompatible = createThemeSkinGeneration(skin({ manifest: { ...(skin().manifest as object), profileCompatibility: { schemaVersion: 2 } } }));
    expect(() => createThemeSkinRegistry([incompatible]).resolve({ ...profile.skin, generationId: incompatible.generationId })).toThrow(/migration/);
    const migrated = createThemeSkinGeneration(skin({ manifest: {
      ...(skin().manifest as object), profileCompatibility: { schemaVersion: 2 },
      profileMigrations: [{ fromSchemaVersion: 1, toSchemaVersion: 2, renames: [{ from: "--k-nex-accent-old", to: "--k-nex-color-accent" }] }]
    } }));
    expect(createThemeSkinRegistry([migrated]).resolve({ ...profile.skin, values: { "--k-nex-accent-old": "#004fa8" } }).tokens["--k-nex-color-accent"]).toBe("#004fa8");
  });

  it.each([
    ["global selector", css.replace(`${themeRootSelector}{`, "body{")],
    ["remote URL", css.replace("asset(\"assets/grid.svg\")", "url(https://evil.test/grid.svg)")],
    ["forbidden property", css.replace("background:var", "position:fixed;background:var")],
    ["missing reduced motion", css.replace(/@media \(prefers-reduced-motion: reduce\)\{[^}]+\}\}/u, "")],
    ["missing forced colors", css.replace(/@media \(forced-colors: active\)\{[^}]+\}\}/u, "")],
    ["missing focus", css.replace(`${themeRootSelector} [data-focus-visible]{outline:3px solid var(--k-nex-focus-ring);outline-offset:2px}\n`, "")]
  ])("rejects %s CSS before activation", (_name, stylesheet) => {
    expect(() => createThemeSkinGeneration(skin({ stylesheets: { "styles/skin.css": stylesheet } }))).toThrow();
  });

  it("does not accept accessibility evidence hidden in comments", () => {
    const spoofed = `${themeRootSelector}{display:block}/* @media (prefers-reduced-motion: reduce){x{transition-duration:0ms!important}} @media (forced-colors: active){x{outline-color:CanvasText}} ${themeRootSelector} [data-focus-visible]{outline:solid} */`;
    expect(() => createThemeSkinGeneration(skin({ stylesheets: { "styles/skin.css": spoofed } }))).toThrow(/reduced motion/);
  });

  it("rejects bad contrast, executable SVG, mixed inventories, and executable skin fields", () => {
    const original = skin();
    const badContrast = skin({ manifest: { ...(original.manifest as object), tokens: { ...tokens, "--k-nex-color-foreground": "#fefefe" } } });
    expect(() => createThemeSkinGeneration(badContrast)).toThrow(/contrast/);
    expect(() => createThemeSkinGeneration(skin({ assets: { "assets/grid.svg": { digest: digest("a"), contentType: "image/svg+xml", bytes: new TextEncoder().encode("<svg><script>alert(1)</script></svg>") } } }))).toThrow(/executable/);
    expect(() => createThemeSkinGeneration(skin({ stylesheets: { "styles/other.css": css } }))).toThrow(/inventory/);
    expect(() => createThemeSkinGeneration(skin({ manifest: { ...(skin().manifest as object), entrypoints: { ui: ["ui/theme.mjs"] } } }))).toThrow();
  });

  it.each([
    '<svg><use href="//evil.test/icon.svg#x"/></svg>',
    '<svg><use href="/assets/icon.svg#x"/></svg>',
    '<svg><style>@import url("https://evil.test/theme.css");</style></svg>',
    '<svg><path style="fill:url(https://evil.test/payload)"/></svg>'
  ])("rejects SVG network references at activation: %s", (unsafe) => {
    expect(() => createThemeSkinGeneration(skin({ assets: { "assets/grid.svg": { digest: digest("a"), contentType: "image/svg+xml", bytes: new TextEncoder().encode(unsafe) } } }))).toThrow(/SVG.*remote|SVG.*unsafe/i);
  });
});
