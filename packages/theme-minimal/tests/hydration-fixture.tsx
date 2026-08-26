import type { ReactElement } from "react";
import { KNeXDesignSystemProvider } from "@k-nex/ui-design-system-contracts";
import { resolveMinimalThemeProfile } from "../src/index.js";

export const hydrationProfile = {
  schemaVersion: 1,
  id: "theme-profile.public-default",
  surface: "public",
  themeId: "theme.minimal",
  themeVersion: "1.0.0",
  palette: "dark",
  mode: "dark",
  values: {},
  revision: { id: "theme-revision.hydration-1", number: 1, state: "published", createdAt: "2026-08-27T00:00:00.000Z", publishedAt: "2026-08-27T00:01:00.000Z" }
} as const;

export function HydrationFixture(): ReactElement {
  const presentation = resolveMinimalThemeProfile(hydrationProfile);
  const P = presentation.primitives;
  return <KNeXDesignSystemProvider primitives={P}>
    <section data-k-nex-theme-profile={presentation.profileRevisionId} data-mode={presentation.mode}>
      <style>{presentation.cssText}</style>
      <P.Card><P.Heading level={1}>Minimal</P.Heading><P.Button>Continue</P.Button></P.Card>
    </section>
  </KNeXDesignSystemProvider>;
}
