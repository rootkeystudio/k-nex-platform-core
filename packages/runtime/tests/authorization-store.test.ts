import { describe, expect, it } from "vitest";

import {
  AuthorizationStoreError,
  assertAuthorizationExpectedRevision,
  parseAuthorizationExpectedRevision,
  parseAuthorizationStoreMutation
} from "../src/authorization-store.js";

const role = { schemaVersion: 1, id: "sales.manager", applicationId: "customer-alpha", label: "Sales Manager", revision: 1 } as const;
const assignment = { schemaVersion: 1, id: "assignment-1", applicationId: "customer-alpha", roleId: role.id, principal: { kind: "service", id: "service:sync" }, state: "active", revision: 1 } as const;

describe("authorization store contract", () => {
  it("rejects non-canonical mutation envelopes and values", async () => {
    await expect(parseAuthorizationStoreMutation({ kind: "role", role, ignored: true })).rejects.toMatchObject({ code: "MUTATION_INVALID" } satisfies Partial<AuthorizationStoreError>);
    await expect(parseAuthorizationStoreMutation({ kind: "role", role: { ...role, ignored: true } })).rejects.toMatchObject({ code: "MUTATION_INVALID" } satisfies Partial<AuthorizationStoreError>);
  });

  it("requires an exact current authorization revision", () => {
    const expected = parseAuthorizationExpectedRevision({ applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 2 });
    expect(() => assertAuthorizationExpectedRevision(expected, { schemaVersion: 1, ...expected })).not.toThrow();
    expect(() => assertAuthorizationExpectedRevision(expected, { schemaVersion: 1, ...expected, authorizationRevision: 5 })).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" } satisfies Partial<AuthorizationStoreError>));
    expect(() => parseAuthorizationExpectedRevision({ ...expected, ignored: true })).toThrow(expect.objectContaining({ code: "MUTATION_INVALID" } satisfies Partial<AuthorizationStoreError>));
  });

  it("fails closed when no authority accepts a service subject", async () => {
    await expect(parseAuthorizationStoreMutation({ kind: "assignment", assignment })).rejects.toMatchObject({ code: "SUBJECT_INVALID" } satisfies Partial<AuthorizationStoreError>);
    await expect(parseAuthorizationStoreMutation({ kind: "assignment", assignment }, { validate: () => "rejected" })).rejects.toMatchObject({ code: "SUBJECT_INVALID" } satisfies Partial<AuthorizationStoreError>);
    await expect(parseAuthorizationStoreMutation({ kind: "assignment", assignment }, { validate: () => { throw new Error("authority unavailable"); } })).rejects.toMatchObject({ code: "SUBJECT_INVALID" } satisfies Partial<AuthorizationStoreError>);
    await expect(parseAuthorizationStoreMutation({ kind: "assignment", assignment }, {
      validate(applicationId, subject) {
        expect(applicationId).toBe("customer-alpha");
        expect(subject).toEqual(assignment.principal);
        return "accepted";
      }
    })).resolves.toMatchObject({ kind: "assignment", assignment });
  });
});
