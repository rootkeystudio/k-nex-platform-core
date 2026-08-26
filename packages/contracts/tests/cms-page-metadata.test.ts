import { describe, expect, it } from "vitest";

import { CmsPageMetadataSchema } from "../src/index.js";

const valid = { schemaVersion: 1, pageId: "cms.home", locale: "en-US", path: "/operations", title: "Operations", description: "Track every delivery.", canonicalPath: "/operations", robots: "index-follow", documentId: "cms.home", themeProfileRevisionId: "theme-revision.minimal-1" };

describe("CmsPageMetadataSchema", () => {
  it("accepts one bounded canonical persisted metadata shape", () => {
    expect(CmsPageMetadataSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ["query", { path: "/operations?draft=1" }], ["fragment", { canonicalPath: "/operations#top" }], ["backslash", { path: "/operations\\draft" }],
    ["control", { title: "Operations\nDraft" }], ["unbounded title", { title: "x".repeat(121) }], ["free ID", { pageId: "HOME" }], ["unknown key", { extra: true }]
  ])("rejects %s metadata", (_name, change) => {
    expect(CmsPageMetadataSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
