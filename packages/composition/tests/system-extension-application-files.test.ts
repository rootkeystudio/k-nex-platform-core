import { describe, expect, it } from "vitest";

import { systemExtensionApplicationFiles } from "../src/system-extension-application-files.js";

describe("generated System extension administration", () => {
  const files = systemExtensionApplicationFiles({ applicationId: "customer-alpha" });

  it("emits only fixed extension routes and uses the remote operator facade", () => {
    expect(Object.keys(files).filter((path) => path.includes("[..."))).toEqual([]);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      "src/k-nex-system-extensions.ts",
      "src/app/(workspace)/system/extensions/page.tsx",
      "src/app/(workspace)/system/extensions/[extensionId]/page.tsx",
      "src/app/api/system/extensions/[extensionId]/plan/route.ts",
      "src/app/api/system/extensions/[extensionId]/operations/[operationId]/execute/route.ts"
    ]));
    expect(files["src/k-nex-system-extensions.ts"]).toContain("new RemoteAdministrationExtensionOperator");
    expect(files["src/k-nex-system-extensions.ts"]).toContain("new NodeHttpsAdministrationOperatorClient");
    expect(files["src/k-nex-system-extensions.ts"]).not.toContain("PluginManager");
  });

  it("derives authority, revisions, inventory, action permission, and evidence on server", () => {
    const runtime = files["src/k-nex-system-extensions.ts"]!;
    const plan = files["src/app/api/system/extensions/[extensionId]/plan/route.ts"]!;
    const execute = files["src/app/api/system/extensions/[extensionId]/operations/[operationId]/execute/route.ts"]!;

    expect(runtime).toContain("currentExtensionExpected");
    expect(runtime).toContain("extensionMutationContext");
    expect(runtime).toContain("reauthenticateCurrentUser");
    expect(runtime).toContain("inventoryRevision: inventory.revision");
    expect(runtime).toContain("export const kNexHostInventoryDigest");
    expect(plan).toContain("exactFields(form, [\"operation\", \"version\"])");
    expect(plan).toContain("currentExtensionAction(payload, context, record.extension, operation)");
    expect(execute).toContain("exactFields(form, [\"password\"])");
    expect(execute).toContain("extensionStatusFor");
    expect(execute).toContain("extensionPassword(form)");
    expect(execute).not.toContain('form.get("expected")');
  });

  it("uses local accepted read projections but sends mutation only over mTLS", () => {
    const runtime = files["src/k-nex-system-extensions.ts"]!;
    expect(runtime).toContain("catalogList: async");
    expect(runtime).toContain("status: async");
    expect(runtime).toContain("expectedMtlsIdentity");
    expect(runtime).toContain("allowedCommandFamilies: [\"extension-lifecycle\"]");
    expect(runtime).not.toContain("payload.db.pool.query");
    expect(JSON.stringify(files)).not.toContain("fixtures/customer-gate-1");
  });
});
