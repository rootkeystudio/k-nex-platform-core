import { describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { systemAccessApplicationFiles } from "../src/system-access-application-files.js";

describe("generated System access administration", () => {
  const options = { applicationId: "customer-alpha" } as const;

  it("composes the existing current-authority service and exposes no protected-assignment approval substitute", () => {
    const files = systemAccessApplicationFiles(options);
    const authority = applicationAuthFiles({ applicationId: options.applicationId, applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-authority.ts"]!;
    const service = files["src/k-nex-system-access.ts"]!;

    expect(authority).toContain("return Object.freeze({ adapter, catalogProvider, resolver, store });");
    expect(service).toContain("new SystemAccessAdministrationService({ store: authority.store, catalogProvider: authority.catalogProvider, authority: authority.adapter })");
    expect(service).toContain("No protectedAssignmentAdmission is installed here");
    expect(service).not.toContain("protectedAssignmentAdmission:");
    expect(service).toContain("export async function currentAccessExpected(payload: Payload)");
    expect(service).toContain("state.authorizationRevision");
    expect(service).toContain("state.lifecycleRevision");
  });

  it("emits only fixed access pages and fixed POST handlers", () => {
    const files = systemAccessApplicationFiles(options);

    expect(Object.keys(files).filter((path) => path.includes("[..."))).toEqual([]);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      "src/app/(workspace)/system/access/roles/page.tsx",
      "src/app/(workspace)/system/access/roles/[roleId]/page.tsx",
      "src/app/(workspace)/system/access/permissions/page.tsx",
      "src/app/(workspace)/system/access/assignments/page.tsx",
      "src/app/(workspace)/system/access/audit/page.tsx",
      "src/app/api/system/access/roles/route.ts",
      "src/app/api/system/access/roles/[roleId]/permissions/route.ts",
      "src/app/api/system/access/grants/[grantId]/remove/route.ts",
      "src/app/api/system/access/assignments/route.ts",
      "src/app/api/system/access/assignments/[assignmentId]/revoke/route.ts"
    ]));
    expect(JSON.stringify(files)).not.toContain("fixtures/customer-gate-1");
    expect(JSON.stringify(files)).not.toContain("runtime route");
  });

  it("keeps creation and permission changes server-derived, strict, and current-authority checked", () => {
    const files = systemAccessApplicationFiles(options);
    const roles = files["src/app/(workspace)/system/access/roles/page.tsx"]!;
    const detail = files["src/app/(workspace)/system/access/roles/[roleId]/page.tsx"]!;
    const create = files["src/app/api/system/access/roles/route.ts"]!;
    const add = files["src/app/api/system/access/roles/[roleId]/permissions/route.ts"]!;
    const remove = files["src/app/api/system/access/grants/[grantId]/remove/route.ts"]!;

    expect(roles).toContain('authorizeRequest(payload, context, "system.roles.manage", "system.roles")');
    expect(roles).toContain('label: "Create role"');
    expect(detail).toContain("accessPermissionGroups(permissions.active, roleId, detail.grants, canManage && detail.role.protectedRoleId === undefined)");
    for (const source of [create, add, remove]) {
      expect(source).toContain("openWorkspaceForm");
      expect(source).toContain("exactFields(form,");
      expect(source).toContain("expected: await currentAccessExpected(payload)");
      expect(source).not.toContain('name: "expected"');
    }
    expect(create).toContain('exactFields(form, ["id", "label"])');
    expect(add).toContain('exactFields(form, ["permissionId"])');
    expect(remove).toContain("exactFields(form, [])");
  });

  it("allows normal user assignment flows while leaving protected assignment evidence fail-closed", () => {
    const files = systemAccessApplicationFiles(options);
    const assignments = files["src/app/(workspace)/system/access/assignments/page.tsx"]!;
    const create = files["src/app/api/system/access/assignments/route.ts"]!;
    const revoke = files["src/app/api/system/access/assignments/[assignmentId]/revoke/route.ts"]!;
    const service = files["src/k-nex-system-access.ts"]!;

    expect(assignments).toContain('authorizeRequest(payload, context, "system.role-assignments.manage", "system.role-assignments")');
    expect(assignments).toContain("role.protectedRoleId === undefined");
    expect(assignments).toContain('label: "Assign user to role"');
    expect(create).toContain('exactFields(form, ["roleId", "userId"])');
    expect(create).toContain('principal: { kind: "user", id: userId }');
    expect(create).toContain("id: accessAssignmentId(roleId, userId)");
    expect(revoke).toContain("revokeAssignment");
    expect(revoke).toContain("exactFields(form, [])");
    expect(service).toContain("No protectedAssignmentAdmission is installed here");
    expect(service).toContain("return Response.json({ code }");
  });
});
