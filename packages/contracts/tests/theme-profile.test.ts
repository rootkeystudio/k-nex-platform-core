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

  it.each([
    ["unknown profile field", { ...validProfile, className: "brand" }],
    ["non-theme package", { ...validProfile, themeId: "module.sales" }],
    ["remote font URL", { ...validProfile, values: { "typography.font": "https://example.com/font.woff2" } }],
    ["arbitrary CSS", { ...validProfile, values: { "color.accent": "red; display:none" } }],
    ["forbidden token key", { ...validProfile, values: { "theme.className": "brand" } }],
    ["published revision without publication time", { ...validProfile, revision: { id: "theme-revision.public-1", number: 1, state: "published", createdAt: "2026-08-26T20:00:00.000Z" } }]
  ])("rejects %s", (_name, value) => {
    expect(ThemeProfileSchema.safeParse(value).success).toBe(false);
  });
});
