import { useState } from "react";
import { createRoot } from "react-dom/client";

import uiDocument from "../../../fixtures/ui-documents/valid/cms.v1.json";
import { KNeXDesignSystemProvider, type ThemePresentationSnapshot } from "@k-nex/ui-design-system-contracts";
import { createUiDocumentRuntime, createUiRuntimeRegistry } from "@k-nex/ui-runtime";
import { resolveMinimalThemeProfile } from "@k-nex/theme-minimal";
import { resolveNeobrutalismThemeProfile } from "../src/index.js";

const profile = (themeId: "theme.minimal" | "theme.neobrutalism", palette: string, revisionId: string) => ({
  schemaVersion: 1, id: `theme-profile.${revisionId.split(".").at(-1)}`, surface: "public", themeId, themeVersion: "1.0.0", palette, mode: "light", values: {},
  revision: { id: revisionId, number: 1, state: "published", createdAt: "2026-08-27T00:00:00.000Z", publishedAt: "2026-08-27T00:01:00.000Z" }
});
const minimal = resolveMinimalThemeProfile(profile("theme.minimal", "light", "theme-revision.browser-minimal"));
const neobrutalism = resolveNeobrutalismThemeProfile(profile("theme.neobrutalism", "primary", "theme-revision.browser-neobrutalism"));
const switched = resolveNeobrutalismThemeProfile(profile("theme.neobrutalism", "primary", "theme-revision.browser-switched"));
const customer = resolveMinimalThemeProfile(profile("theme.minimal", "light", "theme-revision.browser-customer"));

const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [{
  id: "content.hero", version: 1, profiles: ["cms"], surfaces: ["public"], audience: "public",
  propsSchema: { safeParse(value: unknown) { return value !== null && typeof value === "object" && typeof (value as Record<string, unknown>).heading === "string" && typeof (value as Record<string, unknown>).body === "string" ? { success: true as const, data: value } : { success: false as const, error: "invalid" }; } },
  render: ({ props }) => props
}], sources: [] }));
const evaluated = runtime.render({ document: uiDocument, surface: "public", actor: { authenticated: false, permissions: new Set() } });
if (!evaluated.success || evaluated.regions.main?.[0]?.status !== "rendered") throw new Error("Canonical CMS document runtime did not render.");
const hero = evaluated.regions.main[0].output as { heading: string; body: string };

function NestedCustomerSurface() {
  const P = customer.primitives;
  return <KNeXDesignSystemProvider primitives={P}>
    <section data-testid="surface-Nested" data-k-nex-theme-profile={customer.profileRevisionId}>
      <P.Card><P.Text>Nested customer theme</P.Text></P.Card>
    </section>
  </KNeXDesignSystemProvider>;
}

function Surface({ label, presentation, onSwitch }: { label: string; presentation: ThemePresentationSnapshot; onSwitch?: () => void }) {
  const [count, setCount] = useState(0);
  const [move, setMove] = useState("Ready");
  const P = presentation.primitives;
  return <KNeXDesignSystemProvider primitives={P}>
    <section data-testid={`surface-${label}`} data-k-nex-theme-profile={presentation.profileRevisionId}>
      <P.Stack>
        <P.Card><P.Heading level={1}>{hero.heading}</P.Heading><P.Text element="p">{hero.body}</P.Text></P.Card>
        <P.Inline>
          <P.Button onPress={() => setCount((value) => value + 1)}>Increment {label}</P.Button>
          <P.Button onPress={() => setMove("Beta moved earlier")}>Move Beta earlier {label}</P.Button>
          {onSwitch === undefined ? null : <P.Button onPress={onSwitch}>Switch Minimal theme</P.Button>}
          <P.Dialog title={`${label} dialog`} triggerLabel={`Open ${label} dialog`}>Actual K-Nex dialog</P.Dialog>
        </P.Inline>
        <P.Status>Count {count}; {move}</P.Status>
        {label === "Minimal" ? <NestedCustomerSurface /> : null}
      </P.Stack>
    </section>
  </KNeXDesignSystemProvider>;
}

function App() {
  const [first, setFirst] = useState<ThemePresentationSnapshot>(minimal);
  return <>
    <style>{minimal.cssText + neobrutalism.cssText + switched.cssText + customer.cssText + `[data-k-nex-theme-profile="${customer.profileRevisionId}"] [data-k-nex-primitive="card"]{border-width:5px;background:#eefbf2}`}</style>
    <main><Surface label="Minimal" presentation={first} onSwitch={() => setFirst(switched)} /><Surface label="Neobrutalism" presentation={neobrutalism} /><Surface label="Customer" presentation={customer} /></main>
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);
(window as Window & { __K_NEX_READY__?: boolean }).__K_NEX_READY__ = true;
