import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { minimalThemePackage } from "../packages/theme-minimal/dist/index.js";
import { neobrutalismThemePackage } from "../packages/theme-neobrutalism/dist/index.js";
import { semanticPrimitiveNames } from "../packages/ui-design-system-contracts/dist/index.js";
import { CmsPageMetadataSchema } from "../packages/contracts/dist/index.js";
import { CMS_PAGE_REVISIONS_SLUG, CMS_PUBLICATION_PAIRS_SLUG, THEME_PROFILE_REVISIONS_SLUG, UI_DOCUMENT_REVISIONS_SLUG } from "../packages/payload-builder-storage/dist/index.js";

if (process.versions.node !== "24.19.0") throw new Error(`Gate 5 requires Node 24.19.0; found ${process.versions.node}.`);

assert.notEqual(minimalThemePackage.structuralCss, neobrutalismThemePackage.structuralCss, "theme presentations must be materially distinct");
for (const primitive of semanticPrimitiveNames) {
  assert.equal(minimalThemePackage.primitiveOverrides?.[primitive], neobrutalismThemePackage.primitiveOverrides?.[primitive], `${primitive} interaction behavior must remain shared across themes`);
}
assert.deepEqual([UI_DOCUMENT_REVISIONS_SLUG, CMS_PAGE_REVISIONS_SLUG, CMS_PUBLICATION_PAIRS_SLUG, THEME_PROFILE_REVISIONS_SLUG], ["k-nex-ui-document-revisions", "k-nex-cms-page-revisions", "k-nex-cms-publication-pairs", "k-nex-theme-profile-revisions"]);
assert.equal(CmsPageMetadataSchema.safeParse({ schemaVersion: 1, pageId: "cms.home", locale: "en-US", path: "/operations?draft=1", title: "Operations", description: "Track every delivery.", canonicalPath: "/operations", robots: "index-follow", documentId: "cms.home", themeProfileRevisionId: "theme-revision.minimal-1" }).success, false);

const storageManifest = JSON.parse(await readFile(new URL("../packages/payload-builder-storage/package.json", import.meta.url), "utf8"));
const installed = Object.keys({ ...storageManifest.dependencies, ...storageManifest.devDependencies });
assert.equal(installed.some((name) => name.startsWith("@payloadcms/plugin-")), false, "deferred Payload plugins must not enter the Gate 5 contract");

const result = await readFile(new URL("../docs/implementation/phase-5-result.md", import.meta.url), "utf8");
for (const marker of ["**Decision:** **GO Phase 6**", "SEO — **deferred**", "Nested Docs — **deferred**", "Redirects — **deferred**", "Form Builder — **conditional**", "Search — **conditional**"]) assert.match(result, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

console.log(JSON.stringify({ gate: "Gate 5", themes: [minimalThemePackage.id, neobrutalismThemePackage.id], primitives: semanticPrimitiveNames.length, storageCollections: [UI_DOCUMENT_REVISIONS_SLUG, CMS_PAGE_REVISIONS_SLUG, CMS_PUBLICATION_PAIRS_SLUG, THEME_PROFILE_REVISIONS_SLUG], pluginCandidatesInstalled: [] }, null, 2));
console.log("GATE_5_PASS");
