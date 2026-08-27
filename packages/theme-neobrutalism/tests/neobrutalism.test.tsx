import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UiDocumentSchema, canonicalJson, type UiDocument } from "@k-nex/contracts";
import { KNeXDesignSystemProvider, type ThemePresentationSnapshot } from "@k-nex/ui-design-system-contracts";
import { resolveMinimalThemeProfile } from "@k-nex/theme-minimal";
import { neobrutalismThemePackage, resolveNeobrutalismThemeProfile } from "../src/index.js";

const document = UiDocumentSchema.parse(JSON.parse(await readFile(new URL("../../../fixtures/ui-documents/valid/cms.v1.json", import.meta.url), "utf8")));
const original = canonicalJson(document);

function profile(themeId: "theme.minimal" | "theme.neobrutalism", palette: string) {
  return {
    schemaVersion: 1,
    id: "theme-profile.public-default",
    surface: "public",
    themeId,
    themeVersion: "1.0.0",
    palette,
    mode: "light",
    values: {},
    revision: { id: `theme-revision.${themeId.split(".")[1]}-1`, number: 1, state: "published", createdAt: "2026-08-27T00:00:00.000Z", publishedAt: "2026-08-27T00:01:00.000Z" }
  };
}

function renderDocument(presentation: ThemePresentationSnapshot, value: UiDocument): string {
  const node = value.regions.main?.[0];
  if (node === undefined) throw new Error("Fixture needs one main node.");
  const props = node.props as { heading: string; body: string };
  const P = presentation.primitives;
  return renderToStaticMarkup(<KNeXDesignSystemProvider primitives={P}>
    <section data-k-nex-theme-profile={presentation.profileRevisionId}><style>{presentation.cssText}</style><P.Card><P.Heading level={1}>{props.heading}</P.Heading><P.Text>{props.body}</P.Text><P.Button>Track</P.Button></P.Card></section>
  </KNeXDesignSystemProvider>);
}

describe("Neobrutalism theme", () => {
  it("renders the same canonical document under both themes without mutation", () => {
    const minimal = resolveMinimalThemeProfile(profile("theme.minimal", "light"));
    const neobrutalism = resolveNeobrutalismThemeProfile(profile("theme.neobrutalism", "primary"));
    const minimalMarkup = renderDocument(minimal, document);
    const neobrutalismMarkup = renderDocument(neobrutalism, document);
    expect(minimalMarkup).toContain("Operations at a glance");
    expect(neobrutalismMarkup).toContain("Operations at a glance");
    expect(minimal.cssText).not.toBe(neobrutalism.cssText);
    expect(canonicalJson(document)).toBe(original);
  });

  it("changes presentation without forking interaction behavior", () => {
    const minimal = resolveMinimalThemeProfile(profile("theme.minimal", "light"));
    const neobrutalism = resolveNeobrutalismThemeProfile(profile("theme.neobrutalism", "primary"));
    expect(neobrutalism.cssVariables["--k-nex-public-radius-control"]).toBe("0");
    expect(neobrutalism.cssVariables["--k-nex-public-shadow-card"]).toBe("6px 6px 0 #111111");
    expect(neobrutalism.primitives.Button).toBe(minimal.primitives.Button);
    expect(neobrutalism.primitives.Dialog).toBe(minimal.primitives.Dialog);
  });

  it("implements all primitive recipes and rejects invalid overrides", () => {
    expect(Object.keys(neobrutalismThemePackage.recipes)).toHaveLength(27);
    expect(() => resolveNeobrutalismThemeProfile({ ...profile("theme.neobrutalism", "primary"), values: { "radius.control": -1 } })).toThrow(/schema/);
  });
});
