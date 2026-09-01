import { describe, expect, it } from "vitest";

import { ProtectedRoleBaselineSchema, protectedRoleIds } from "@k-nex/contracts";

import { platformPermissionDescriptors } from "../src/authorization-registry.js";
import {
  TemplateBaselineError,
  compareTemplateBaseline,
  digestTemplateBaseline,
  protectedPlatformRoleBaselines
} from "../src/protected-role-baselines.js";

describe("protected role and template baseline kernel", () => {
  it("defines exactly the five protected platform role IDs with valid platform-only baselines", () => {
    expect(protectedPlatformRoleBaselines.map(({ id }) => id)).toEqual(protectedRoleIds);
    const platformPermissionIds = new Set(platformPermissionDescriptors.map(({ id }) => id));
    expect(protectedPlatformRoleBaselines.every((baseline) => ProtectedRoleBaselineSchema.safeParse(baseline).success && baseline.permissionIds.every((permissionId) => platformPermissionIds.has(permissionId)))).toBe(true);
    expect(Object.isFrozen(protectedPlatformRoleBaselines)).toBe(true);
  });

  it("grants the owner every planned system permission", () => {
    const owner = protectedPlatformRoleBaselines.find(({ id }) => id === "system.role.owner")!;
    expect(owner.permissionIds).toEqual(platformPermissionDescriptors.map(({ id }) => id).sort());
    expect(owner.permissionIds).toHaveLength(19);
  });

  it("keeps non-owner protected roles least-privilege and explicit", () => {
    const byId = Object.fromEntries(protectedPlatformRoleBaselines.map((baseline) => [baseline.id, baseline.permissionIds]));
    expect(byId["system.role.security-admin"]).toEqual([
      "system.authorization.audit.read", "system.permissions.read", "system.role-assignments.manage", "system.role-assignments.read", "system.roles.manage", "system.roles.read"
    ]);
    expect(byId["system.role.extension-admin"]).toEqual([
      "system.extensions.deploy-platform-plugin", "system.extensions.disable", "system.extensions.enable", "system.extensions.install-hot", "system.extensions.plan", "system.extensions.quarantine", "system.extensions.read", "system.extensions.rollback", "system.extensions.uninstall", "system.extensions.update", "system.permissions.read"
    ]);
    expect(byId["system.role.user-admin"]).toEqual(["system.role-assignments.manage", "system.role-assignments.read", "system.roles.read"]);
    expect(byId["system.role.auditor"]).toEqual(["system.authorization.audit.read", "system.permissions.read", "system.role-assignments.read", "system.roles.read"]);
  });

  it("creates deterministic baseline digests and rejects a tampered stored baseline", () => {
    const permissions = ["sales.tasks.read", "sales.tasks.write"];
    const digest = digestTemplateBaseline([...permissions].reverse());
    expect(digest).toBe(digestTemplateBaseline(permissions));
    expect(() => compareTemplateBaseline({
      stored: { digestAlgorithm: "sha256-canonical-json-v1", oldBaselineDigest: `sha256:${"0".repeat(64)}`, oldBaselinePermissionIds: ["sales.tasks.read", "sales.tasks.write"] },
      currentOwnerPermissionIds: permissions,
      newBaselinePermissionIds: permissions
    })).toThrow(expect.objectContaining({ code: "DIGEST_MISMATCH" } satisfies Partial<TemplateBaselineError>));
  });

  it("reports independent customer and template additions and removals", () => {
    const oldBaselinePermissionIds = ["sales.tasks.create", "sales.tasks.read", "sales.tasks.update"];
    const comparison = compareTemplateBaseline({
      stored: {
        digestAlgorithm: "sha256-canonical-json-v1",
        oldBaselineDigest: digestTemplateBaseline(oldBaselinePermissionIds),
        oldBaselinePermissionIds
      },
      currentOwnerPermissionIds: ["sales.tasks.create", "sales.tasks.delete", "sales.tasks.read"],
      newBaselinePermissionIds: ["sales.tasks.create", "sales.tasks.read", "sales.tasks.write"]
    });
    expect(comparison.customerAddedPermissionIds).toEqual(["sales.tasks.delete"]);
    expect(comparison.customerRemovedPermissionIds).toEqual(["sales.tasks.update"]);
    expect(comparison.templateAddedPermissionIds).toEqual(["sales.tasks.write"]);
    expect(comparison.templateRemovedPermissionIds).toEqual(["sales.tasks.update"]);
  });
});
