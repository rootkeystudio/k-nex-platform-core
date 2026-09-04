import { describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { planCreateKnexApplication } from "../src/application-factory.js";
import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

describe("generated durable Theme Profile runtime", () => {
  it.each([
    ["minimal", "resolveMinimalThemeProfile"],
    ["neobrutalism", "resolveNeobrutalismThemeProfile"]
  ] as const)("binds %s to one statically imported installed package", (theme, resolver) => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme });
    const runtime = files["src/k-nex-theme-runtime.ts"]!;

    expect(runtime).toContain(`import { ${resolver} as resolveInstalledThemeProfile } from "@k-nex/theme-${theme}";`);
    expect(runtime).not.toMatch(/import\s*\(/u);
    expect(runtime).not.toContain('import "server-only"');
    expect(runtime).not.toContain("active_profile->>'css'");
    expect(runtime).toContain('profile.themeId !== "theme.' + theme + '" || profile.themeVersion !== "1.0.0"');
    expect(runtime).toContain("const presentation = resolveInstalledThemeProfile(profile);");
    expect(runtime).toContain("profile.skin !== undefined");

    expect(files["src/k-nex-readiness.ts"]).toContain("await resolveApplicationTheme(payload);");
  });

  it("seeds one exact default without overwriting later admin publication", () => {
    const runtime = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-theme-runtime.ts"]!;

    expect(runtime).toContain("const profile = ThemeProfileSchema.parse(kNexInitialThemeProfile);");
    expect(runtime).toContain("on conflict (application_id, environment, profile_id) do nothing");
    expect(runtime).not.toMatch(/on conflict[\s\S]{0,120}do update/u);
    expect(runtime).toContain("ThemeProfilePublicationEventSchema.parse");
    expect(runtime).toContain("with inserted as (");
    expect(runtime).toContain("insert into runtime_theme_profile_outbox");
    expect(runtime).toContain("previousRevisionId: null");
    expect(runtime).toContain("stateDigest");
    expect(applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-bootstrap-owner.ts"]).toContain("await bootstrapApplicationTheme(payload);");
  });

  it("generates the accepted v1 Theme Profile publication tables", () => {
    const files = planCreateKnexApplication({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal", database: "external" }).files;
    const migration = files["src/migrations/20260904_000006_knex_theme_profiles.ts"]!;

    expect(migration).toContain('CREATE TABLE "runtime_theme_profile_publications"');
    expect(migration).toContain('CREATE TABLE "runtime_theme_profile_outbox"');
    expect(migration).toContain('CONSTRAINT "runtime_theme_profile_state_digest_check"');
    expect(files["src/migrations/index.ts"]).toContain('name: "20260904_000006_knex_theme_profiles"');
    expect(files["src/migrations/20260904_000007_knex_workspace_sidebar_preferences.ts"]).toContain("kNexWorkspaceSidebarPreferenceSchemaMigration");
    expect(files["src/migrations/index.ts"]).toContain('name: "20260904_000007_knex_workspace_sidebar_preferences"');
  });

  it("wires current durable presentation around whole shell and polling watermark", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const navigation = files["src/k-nex-workspace-navigation.ts"]!;
    const layout = files["src/app/(workspace)/layout.tsx"]!;
    const shell = files["src/app/components/k-nex-workspace-shell.tsx"]!;
    const route = files["src/app/api/k-nex/navigation/revision/route.ts"]!;

    expect(navigation).toContain("const applicationTheme = await resolveApplicationTheme(payload);");
    expect(navigation).toContain("theme: applicationTheme.observation");
    expect(navigation).toContain("themePresentation: applicationTheme.presentation");
    expect(layout).toContain("themePresentation={resolved.themePresentation}");
    expect(shell).toContain("themePresentation={themePresentation}");
    expect(shell).toContain("const nextTheme = parseThemePresentation(body?.themePresentation);");
    expect(shell).toContain("setThemePresentation(nextTheme)");
    expect(route).toContain("themePresentation: resolved.themePresentation");
    expect(files["src/app/(workspace)/page.tsx"]).not.toContain("kNexThemePresentation");
  });

  it("resolves exact active admin override CSS inside page content only", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const runtime = files["src/k-nex-workspace-pages.ts"]!;
    const client = files["src/app/components/k-nex-workspace-page-runtime.tsx"]!;

    expect(runtime).toContain("await resolvePageThemeOverride(payload, reference);");
    expect(runtime).toContain("themeRevision: session.theme.presentation.profileRevisionId");
    expect(runtime).toContain("themeCss: session.theme.presentation.cssText");
    expect(runtime).not.toContain("kNexThemePresentation.cssText");
    expect(client).toContain("<section data-k-nex-theme-profile={current.themeRevision} data-k-nex-theme-mode={current.themeMode}>");
    expect(client).toContain("<style>{current.themeCss}</style>");
  });

  it("rejects stale, draft, wrong-surface/package, and skin-backed selections", () => {
    const runtime = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-theme-runtime.ts"]!;

    expect(runtime).toContain("WorkspaceThemeProfileRefSchema.parse(value)");
    expect(runtime).toContain("revisionId !== row.active_revision_id");
    expect(runtime).toContain('profile.revision.state !== "published"');
    expect(runtime).toContain('profile.surface !== "admin"');
    expect(runtime).toContain('profile.themeId !== "theme.minimal"');
    expect(runtime).toContain("profile.skin !== undefined");
  });

  it("adds publication revision and state digest to page convergence watermark", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const runtime = files["src/k-nex-workspace-pages.ts"]!;
    const route = files["src/app/api/k-nex/workspace-pages/[pageId]/session/route.ts"]!;

    expect(runtime).toContain("themePublicationRevision: theme.observation.publicationRevision");
    expect(runtime).toContain("themeActiveRevisionId: theme.observation.activeRevisionId");
    expect(runtime).toContain("themeStateDigest: theme.observation.stateDigest");
    expect(route).toContain("left.themePublicationRevision === right.themePublicationRevision");
    expect(route).toContain("left.themeStateDigest === right.themeStateDigest");
    expect(runtime).toContain("extensionGenerations: Object.freeze(usesSales(document) ? [{ applicationId: scope.applicationId");
    expect(runtime).toContain("themePublication: Object.freeze({ applicationId: scope.applicationId");
  });

  it("separates theme failure from exact current Sales generation impact", () => {
    const runtime = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-workspace-pages.ts"]!;

    expect(runtime).toContain("async function salesGenerationImpact(payload: Payload, lifecycleRevision: number | undefined)");
    expect(runtime).toContain("from k_nex_extension_authorization_generations");
    expect(runtime).toContain("max(state) filter (where authorization_generation=$3 and runtime_generation_ids=$4::jsonb) exact_state");
    expect(runtime).toContain("bool_or(state='current' and (authorization_generation<>$3 or runtime_generation_ids<>$4::jsonb))");
    expect(runtime).not.toContain("order by authorization_generation desc limit 1");
    expect(runtime).toContain('return "plugin-disabled" as const');
    expect(runtime).toContain('return "plugin-updated" as const');
    expect(runtime).toContain('code: "theme-unavailable" as const');
    expect(runtime.indexOf('code: "theme-unavailable" as const')).toBeLessThan(runtime.indexOf("const pluginCode = usesSales(document) ? await salesGenerationImpact"));
  });
});
