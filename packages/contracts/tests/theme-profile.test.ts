import { describe, expect, it } from "vitest";

import { ThemeProfileSchema } from "../src/index.js";

const validProfile = {
  schemaVersion: 1,
  id: "theme-profile.public-default",
  surface: "public",
  themeId: "theme.minimal",
  themeVersion: "1.0.0",
  palette: "default",
  mode: "system",
  values: { "color.accent": "#2457ff", "spacing.content": 16 },
  revision: { id: "theme-revision.public-1", number: 1, state: "published", createdAt: "2026-08-26T20:00:00.000Z", publishedAt: "2026-08-26T20:01:00.000Z" }
} as const;

describe("ThemeProfileSchema", () => {
  it("accepts a strict typed published profile", () => {
    expect(ThemeProfileSchema.parse(validProfile)).toEqual(validProfile);
  });

  it("binds an optional data-only skin to an exact generation and safe overrides", () => {
    const skinned = {
      ...validProfile,
      skin: { id: "skin.neobrutalism", generationId: "skin-generation-1", version: "1.0.0", palette: "skin.bright", values: { "--k-nex-skin-surface": "#fff200" } }
    };
    expect(ThemeProfileSchema.parse(skinned)).toEqual(skinned);
    expect(ThemeProfileSchema.safeParse({ ...skinned, skin: { ...skinned.skin, id: "theme.neobrutalism" } }).success).toBe(false);
    expect(ThemeProfileSchema.safeParse({ ...skinned, skin: { ...skinned.skin, values: { "--k-nex-skin-surface": "url(https://evil.test/x)" } } }).success).toBe(false);
    expect(ThemeProfileSchema.safeParse({ ...skinned, skin: { ...skinned.skin, values: { "--k-nex-skin-surface": "\\75\\72\\6c(//evil.test/x)" } } }).success).toBe(false);
    expect(ThemeProfileSchema.safeParse({ ...skinned, skin: { ...skinned.skin, values: { "--k-nex-skin-surface": "#ffffff;--k-nex-skin-focus-ring:#ffffff" } } }).success).toBe(false);
    expect(ThemeProfileSchema.safeParse({ ...skinned, skin: { ...skinned.skin, values: { "--k-nex-skin-surface": "#ffffff/* payload */" } } }).success).toBe(false);
    expect(ThemeProfileSchema.safeParse({ ...skinned, skin: { ...skinned.skin, values: { "--k-nex-skin-surface": "var(--host-controlled-token)" } } }).success).toBe(false);
    expect(ThemeProfileSchema.safeParse({ ...skinned, skin: { ...skinned.skin, values: { "--k-nex-public-color-background": "#ffffff" } } }).success).toBe(false);
  });

  it.each([
    ["unknown profile field", { ...validProfile, className: "brand" }],
    ["non-theme package", { ...validProfile, themeId: "module.sales" }],
    ["remote font URL", { ...validProfile, values: { "typography.font": "https://example.com/font.woff2" } }],
    ["arbitrary CSS", { ...validProfile, values: { "color.accent": "red; display:none" } }],
    ["escaped remote CSS", { ...validProfile, values: { "color.accent": "\\75\\72\\6c(//evil.test/x)" } }],
    ["indirected CSS", { ...validProfile, values: { "color.accent": "var(--host-controlled-token)" } }],
    ["forbidden token key", { ...validProfile, values: { "theme.className": "brand" } }],
    ["published revision without publication time", { ...validProfile, revision: { id: "theme-revision.public-1", number: 1, state: "published", createdAt: "2026-08-26T20:00:00.000Z" } }]
  ])("rejects %s", (_name, value) => {
    expect(ThemeProfileSchema.safeParse(value).success).toBe(false);
  });
});
