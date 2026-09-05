import { describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { systemAccessApplicationFiles } from "../src/system-access-application-files.js";
import { systemExtensionApplicationFiles } from "../src/system-extension-application-files.js";
import { systemOperationsApplicationFiles } from "../src/system-operations-application-files.js";
import { systemThemeSettingsApplicationFiles } from "../src/system-theme-settings-application-files.js";

describe("generated System administration navigation authority", () => {
  const options = { applicationId: "customer-alpha" } as const;

  it("renders only current-authority-permitted System links on every generated System page", () => {
    const authority = applicationAuthFiles({ applicationId: options.applicationId, applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-authority.ts"]!;
    const pages = [
      ...Object.entries(systemAccessApplicationFiles(options)),
      ...Object.entries(systemThemeSettingsApplicationFiles(options)),
      ...Object.entries(systemExtensionApplicationFiles(options)),
      ...Object.entries(systemOperationsApplicationFiles(options))
    ].filter(([path]) => path.includes("src/app/(workspace)/system/")).map(([, source]) => source);

    expect(authority).toContain("export async function currentSystemAdministrationNavigation(payload: Payload, context: KnexRequestContext)");
    expect(authority).toContain("await authorizeNavigationPermission(payload, context, permissionId) ? item : undefined");
    expect(authority).toContain('href: "/system/operations", permissionId: "system.operations.read"');
    expect(authority).toContain('href: "/system/access/audit", permissionId: "system.authorization.audit.read"');
    expect(pages).toHaveLength(13);
    for (const source of pages) {
      expect(source).toContain("navigation: await currentSystemAdministrationNavigation(payload, context)");
      expect(source).not.toContain("Navigation = Object.freeze");
    }
  });
});
