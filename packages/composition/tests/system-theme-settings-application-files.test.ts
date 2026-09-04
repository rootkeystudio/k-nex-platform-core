import { describe, expect, it } from "vitest";

import { systemThemeSettingsApplicationFiles } from "../src/system-theme-settings-application-files.js";

describe("generated System Theme and Settings administration", () => {
  const files = systemThemeSettingsApplicationFiles({ applicationId: "customer-alpha" });

  it("uses existing current-authority services and one static immediate system descriptor", () => {
    const runtime = files["src/k-nex-system-theme-settings.ts"]!;

    expect(runtime).toContain('id: "system.general"');
    expect(runtime).toContain('fields: { siteName: { type: "string", required: true, default: "K-Nex" } }');
    expect(runtime).toContain('readPermission: "system.settings.read"');
    expect(runtime).toContain('changePermission: "system.settings.manage"');
    expect(runtime).toContain("new SystemThemeAdministrationService");
    expect(runtime).toContain("new SystemSettingsAdministrationService");
    expect(runtime).toContain("new PostgresThemeProfileStore");
    expect(runtime).toContain("new PostgresSystemSettingsStore");
    expect(runtime).toContain("new PostgresSystemSettingsDescriptorSource");
    expect(runtime).toContain("new CurrentAuthorityThemeProfileAuthorizer");
    expect(runtime).toContain('import { kNexHostInventoryDigest } from "./k-nex-system-extensions.js"');
    expect(runtime).toContain("reauthenticateCurrentUser(payload, context, password)");
    expect(runtime).toContain('reauthentication: "satisfied" as const');
  });

  it("emits only fixed Theme and Settings pages plus POST handlers", () => {
    expect(Object.keys(files).filter((path) => path.includes("[..."))).toEqual([]);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      "src/app/(workspace)/system/settings/page.tsx",
      "src/app/(workspace)/system/settings/[settingsId]/page.tsx",
      "src/app/(workspace)/system/themes/page.tsx",
      "src/app/(workspace)/system/themes/profiles/[profileId]/page.tsx",
      "src/app/api/system/settings/[settingsId]/route.ts",
      "src/app/api/system/themes/profiles/[profileId]/preview/route.ts",
      "src/app/api/system/themes/profiles/[profileId]/stage/route.ts",
      "src/app/api/system/themes/profiles/[profileId]/publish/route.ts",
      "src/app/api/system/themes/profiles/[profileId]/rollback/route.ts"
    ]));
  });

  it("keeps revisions server-derived and high-risk mutations password-reauthenticated", () => {
    const settings = files["src/app/api/system/settings/[settingsId]/route.ts"]!;
    const publish = files["src/app/api/system/themes/profiles/[profileId]/publish/route.ts"]!;
    const rollback = files["src/app/api/system/themes/profiles/[profileId]/rollback/route.ts"]!;
    const preview = files["src/app/api/system/themes/profiles/[profileId]/preview/route.ts"]!;
    const stage = files["src/app/api/system/themes/profiles/[profileId]/stage/route.ts"]!;

    for (const source of [settings, publish, rollback, preview]) {
      expect(source).toContain("openWorkspaceForm");
      expect(source).toContain("exactFields(form,");
      expect(source).not.toContain('name: "expected"');
    }
    expect(settings).toContain("expectedDocumentRevision: current.documentRevision");
    expect(settings).toContain("expectedSettingsRevision: current.settingsRevision");
    expect(publish).toContain('exactFields(form, ["password"])');
    expect(rollback).toContain('exactFields(form, ["password"])');
    expect(publish).toContain("publishedThemeProfile(current.draft)");
    expect(rollback).toContain("expectedRevision: current.revision");
    expect(preview).toContain("expectedRevision: current.revision");
    expect(preview).toContain("themeProfileForRoute(profileId");
    expect(stage).toContain("themeProfileForRoute(profileId");
    expect(JSON.stringify(files)).not.toContain("fixtures/customer-gate-1");
  });
});
