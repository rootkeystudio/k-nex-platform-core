import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DurableThemeSkinResolver, type DurableThemeSkinArtifact, type DurableThemeSkinAuthority } from "../src/index.js";

const sha256 = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const authority: DurableThemeSkinAuthority = {
  applicationId: "customer-alpha", environment: "production", deliveryClass: "theme-skin", extensionId: "skin.durable-proof", generationId: "skin-durable-1",
  artifactDigest: `sha256:${"a".repeat(64)}`, manifestDigest: `sha256:${"b".repeat(64)}`, catalogDigest: `sha256:${"c".repeat(64)}`,
  provenanceDigest: `sha256:${"d".repeat(64)}`, sbomDigest: `sha256:${"e".repeat(64)}`, sourceCommit: "0123456789abcdef0123456789abcdef01234567"
};
const css = `:--k-nex-theme-root{background:var(--k-nex-color-background)}
:--k-nex-theme-root [data-k-nex-primitive="button"]:focus-visible{outline:3px solid var(--k-nex-focus-ring)}
@media (prefers-reduced-motion: reduce){:--k-nex-theme-root *{transition-duration:0ms!important}}
@media (forced-colors: active){:--k-nex-theme-root [data-k-nex-primitive="button"]{border-color:CanvasText;outline-color:CanvasText}}`;
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/></svg>');
const skinManifest = {
  schemaVersion: 1, deliveryClass: "theme-skin", id: authority.extensionId, displayName: "Durable proof", version: "1.0.0", runtimeAbi: "1.0.0",
  profileCompatibility: { schemaVersion: 1 }, tokens: { "--k-nex-color-background": "#ffffff", "--k-nex-color-foreground": "#111111", "--k-nex-color-accent": "#005fcc", "--k-nex-focus-ring": "#000000", "--k-nex-motion-duration": "120ms" },
  palettes: { "skin.default": {} }, recipes: { surface: "skin.surface" }, stylesheets: ["styles/skin.css"], profileMigrations: [], assets: [{ path: "assets/grid.svg", digest: sha256(svg) }], localization: [],
  resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxCssBytes: 65_536 }
};
const manifestBytes = new TextEncoder().encode(JSON.stringify(skinManifest));
const files = new Map<string, Uint8Array>([["schemas/theme-skin.json", manifestBytes], ["styles/skin.css", new TextEncoder().encode(css)], ["assets/grid.svg", svg]]);
const bundleManifest = {
  schemaVersion: 1, deliveryClass: "theme-skin", id: authority.extensionId, version: "1.0.0", runtimeAbi: "1.0.0", stylesheets: skinManifest.stylesheets,
  resourceBudget: skinManifest.resourceBudget, payloadDigest: `sha256:${"f".repeat(64)}`, sbom: { path: "sbom.cdx.json", digest: `sha256:${"1".repeat(64)}` },
  provenance: { reference: "https://github.com/k-nex/official-catalog/attestations/durable-skin", digest: `sha256:${"2".repeat(64)}` },
  files: Object.fromEntries([...files].map(([path, body]) => [path, { digest: sha256(body), bytes: body.byteLength, contentType: path.endsWith(".json") ? "application/json" : path.endsWith(".css") ? "text/css" : "image/svg+xml" }]))
};
files.set("k-nex.skin-bundle.json", new TextEncoder().encode(JSON.stringify(bundleManifest)));
files.set("sbom.cdx.json", new TextEncoder().encode("{}"));
const profile = { schemaVersion: 1, id: "theme-profile.durable", surface: "public", themeId: "theme.minimal", themeVersion: "1.0.0", palette: "light", mode: "light", values: {}, skin: { id: authority.extensionId, generationId: authority.generationId, version: "1.0.0", palette: "skin.default", values: {} }, revision: { id: "theme-revision.durable-1", number: 1, state: "published", createdAt: "2026-08-29T09:00:00.000Z", publishedAt: "2026-08-29T09:01:00.000Z" } };

function artifact(overrides: Partial<DurableThemeSkinArtifact> = {}): DurableThemeSkinArtifact {
  return { authority, bundleManifest, files, ...overrides };
}

describe("durable Theme Skin resolver", () => {
  it("accepts only the exact generation-bound verified manifest, assets, and profile", async () => {
    const resolver = new DurableThemeSkinResolver({ load: async () => artifact() });
    await expect(resolver.resolve(authority, profile)).resolves.toMatchObject({ generation: { generationId: authority.generationId } });
    await expect(resolver.resolve(authority, { ...profile, skin: { ...profile.skin, generationId: "skin-durable-2" } })).rejects.toThrow(/Profile|generation/i);
  });

  it("rejects forged artifact authority, altered bytes, and undeclared content", async () => {
    await expect(new DurableThemeSkinResolver({ load: async () => artifact({ authority: { ...authority, generationId: "skin-forged" } }) }).generation(authority)).rejects.toThrow(/authority/i);
    const altered = new Map(files); altered.set("assets/grid.svg", new TextEncoder().encode("<svg><script/></svg>"));
    await expect(new DurableThemeSkinResolver({ load: async () => artifact({ files: altered }) }).generation(authority)).rejects.toThrow(/inventory|digest/i);
    const extra = new Map(files); extra.set("ui/forbidden.mjs", new TextEncoder().encode("export {}"));
    await expect(new DurableThemeSkinResolver({ load: async () => artifact({ files: extra }) }).generation(authority)).rejects.toThrow(/undeclared/i);
  });
});
