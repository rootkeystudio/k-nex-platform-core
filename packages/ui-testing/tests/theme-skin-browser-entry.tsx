import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { minimalThemePackage } from "@k-nex/theme-minimal";
import { Card, Heading, Stack, Text } from "@k-nex/ui-components";
import { Button, KNeXDesignSystemProvider, createThemePresentation, createThemeRegistry, createThemeSkinGeneration, createThemeSkinRegistry, themeRootSelector } from "@k-nex/ui-design-system-contracts";

declare global {
  interface Window {
    __K_NEX_SKIN_READY__?: boolean;
    __K_NEX_BAD_SKIN_REJECTED__?: boolean;
    __K_NEX_SKIN_SWITCH__?: () => void;
    __K_NEX_SKIN_BUTTON__?: Element;
    __K_NEX_SKIN_SAME_DOCUMENT__?: boolean;
    __K_NEX_ATTACK_SKIN_REJECTED__?: boolean;
    __K_NEX_SVG_ATTACK_SKIN_REJECTED__?: boolean;
  }
}

const tokens = (background: string, foreground: string, accent: string, focus: string) => ({
  "--k-nex-skin-color-background": background, "--k-nex-skin-color-foreground": foreground,
  "--k-nex-skin-color-accent": accent, "--k-nex-skin-focus-ring": focus, "--k-nex-skin-motion-duration": "120ms"
});
const css = `${themeRootSelector}{background:var(--k-nex-skin-color-background);color:var(--k-nex-skin-color-foreground)}
${themeRootSelector} [data-k-nex-primitive="card"]{background:var(--k-nex-skin-color-background);border:2px solid var(--k-nex-skin-color-foreground)}
${themeRootSelector} [data-k-nex-primitive="button"]{background:var(--k-nex-skin-color-background);color:var(--k-nex-skin-color-foreground);transition-duration:var(--k-nex-skin-motion-duration);padding:8px}`;

function generation(generationId: string, version: string, colorTokens: ReturnType<typeof tokens>, stylesheet = css, asset?: Uint8Array) {
  const assets = asset === undefined ? {} : { "assets/grid.svg": { digest: `sha256:${"a".repeat(64)}`, contentType: "image/svg+xml", bytes: asset } };
  return createThemeSkinGeneration({
    generationId,
    manifest: {
      schemaVersion: 1, deliveryClass: "theme-skin", id: "skin.browser-proof", displayName: "Browser proof", version, runtimeAbi: "1.0.0",
      profileCompatibility: { schemaVersion: 1 }, tokens: colorTokens, palettes: { "skin.default": {} }, recipes: { surface: "skin.surface", focusRing: "skin.focus" },
      stylesheets: ["styles/skin.css"], profileMigrations: [], assets: asset === undefined ? [] : [{ path: "assets/grid.svg", digest: `sha256:${"a".repeat(64)}` }], localization: [],
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 65_536, maxCssBytes: 65_536 }
    },
    stylesheets: { "styles/skin.css": stylesheet }, assets
  });
}

const oldGeneration = generation("skin-browser-1", "1.0.0", tokens("#ffffff", "#111111", "#0088cc", "#000000"));
const newGeneration = generation("skin-browser-2", "1.1.0", tokens("#111111", "#ffffff", "#804dcc", "#ffffff"));
const skins = createThemeSkinRegistry([oldGeneration, newGeneration]);
const registry = createThemeRegistry([minimalThemePackage], skins);
const profile = (generationId: string, version: string, revision: number) => ({
  schemaVersion: 1 as const, id: "theme-profile.browser-proof", surface: "public" as const, themeId: "theme.minimal", themeVersion: "1.0.0", palette: "light", mode: "light" as const, values: {},
  skin: { id: "skin.browser-proof", generationId, version, palette: "skin.default", values: {} },
  revision: { id: `theme-revision.browser-${revision}`, number: revision, state: "published" as const, createdAt: `2026-08-29T09:0${revision}:00.000Z`, publishedAt: `2026-08-29T09:0${revision}:01.000Z` }
});
const presentations = [
  createThemePresentation(registry.resolveProfile(profile("skin-browser-1", "1.0.0", 1))),
  createThemePresentation(registry.resolveProfile(profile("skin-browser-2", "1.1.0", 2)))
];

const root = document.querySelector<HTMLElement>("#root");
const style = document.querySelector<HTMLStyleElement>("#theme");
if (!root || !style) throw new Error("Theme Skin browser fixture is unavailable.");
let active = 0;
const apply = () => {
  const presentation = presentations[active]!;
  style.textContent = presentation.cssText;
  root.dataset.kNexThemeProfile = presentation.profileRevisionId;
  root.dataset.skinGeneration = presentation.skinGenerationId;
};
apply();
flushSync(() => createRoot(root).render(
    <KNeXDesignSystemProvider primitives={presentations[0]!.primitives}>
      <Stack><Card><Heading level={1}>Sales skin proof</Heading><Text>Canonical sales document</Text><Button>Save sales view</Button></Card></Stack>
    </KNeXDesignSystemProvider>
  ));

requestAnimationFrame(() => {
  const button = document.querySelector('[data-k-nex-primitive="button"]');
  if (!button) throw new Error("Theme Skin proof button is unavailable.");
  window.__K_NEX_SKIN_BUTTON__ = button;
  window.__K_NEX_SKIN_SWITCH__ = () => {
    const before = root.innerHTML;
    active = 1;
    apply();
    window.__K_NEX_SKIN_SAME_DOCUMENT__ = before === root.innerHTML && window.__K_NEX_SKIN_BUTTON__ === document.querySelector('[data-k-nex-primitive="button"]');
  };
  try {
    generation("skin-browser-bad", "2.0.0", tokens("#ffffff", "#fefefe", "#ffffff", "#ffffff"));
    window.__K_NEX_BAD_SKIN_REJECTED__ = false;
  } catch {
    window.__K_NEX_BAD_SKIN_REJECTED__ = true;
  }
  window.__K_NEX_ATTACK_SKIN_REJECTED__ = [
    `${css}\n${themeRootSelector}{background:${String.raw`\75\72\6c(\68\74\74\70\73\3a\2f\2f\65\76\69\6c\2e\74\65\73\74\2f\74\68\65\6d\65\2e\63\73\73)`}}`,
    `${css}\n${themeRootSelector} [data-k-nex-primitive="button"]:focus-visible{outline:none!important}`,
    `${css}\n${themeRootSelector} input::file-selector-button{transition-duration:var(--k-nex-skin-motion-duration)}`
  ].every((stylesheet, index) => {
    try { generation(`skin-browser-attack-${index}`, "2.0.0", tokens("#ffffff", "#111111", "#0088cc", "#000000"), stylesheet); return false; } catch { return true; }
  });
  try {
    generation("skin-browser-svg-attack", "2.0.0", tokens("#ffffff", "#111111", "#0088cc", "#000000"), css, new TextEncoder().encode('<svg><path mask="image-set(\'/attacker.svg\' 1x)"/></svg>'));
    window.__K_NEX_SVG_ATTACK_SKIN_REJECTED__ = false;
  } catch {
    window.__K_NEX_SVG_ATTACK_SKIN_REJECTED__ = true;
  }
  window.__K_NEX_SKIN_READY__ = true;
});
