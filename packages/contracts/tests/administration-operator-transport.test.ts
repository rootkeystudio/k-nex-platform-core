import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AdministrationOperatorAuthenticatedCommandSchema,
  AdministrationOperatorCommandSchema,
  AdministrationOperatorResponseBindingSchema,
  AdministrationOperatorResponseSchema,
  administrationOperatorRequestDigestInput,
  canonicalJson,
  isAdministrationOperatorCommandActiveAt
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const command = {
  schemaVersion: 1,
  kind: "extension-plan",
  audience: "k-nex-administration-operator",
  actor: {
    schemaVersion: 1,
    applicationId: "customer-alpha",
    environment: "production",
    principal: { kind: "user", id: "user:owner" },
    effectiveActor: { kind: "user", id: "user:owner" },
    authorizationRevision: 7,
    lifecycleRevision: 11,
    permissions: [{ decisionId: "decision-1", permissionId: "system.extensions.plan", owner: { kind: "platform", namespace: "system" }, scope: { kind: "application", resource: "system.extensions" } }]
  },
  expected: { authorizationRevision: 7, lifecycleRevision: 11, inventoryRevision: 13, extensionRevision: 17 },
  idempotencyKey: "operator-command-1",
  issuedAt: "2026-09-04T12:00:00.000Z",
  expiresAt: "2026-09-04T12:05:00.000Z",
  extension: { deliveryClass: "platform-plugin", id: "module.sales" },
  version: "1.0.0",
  operation: "update"
} as const;
const verifiedMtlsIdentity = {
  schemaVersion: 1,
  uriSan: "spiffe://knex-deployment/customer-alpha/production/extensions",
  applicationId: "customer-alpha",
  environment: "production",
  allowedCommandFamilies: ["extension-lifecycle"]
} as const;

describe("P12 administration operator transport contracts", () => {
  it("accepts a closed authenticated command and canonically binds the verified mTLS identity", () => {
    const authenticated = { command, verifiedMtlsIdentity } as const;
    expect(AdministrationOperatorAuthenticatedCommandSchema.safeParse(authenticated).success).toBe(true);
    const requestDigest = `sha256:${createHash("sha256").update(canonicalJson(administrationOperatorRequestDigestInput(authenticated))).digest("hex")}`;
    expect(requestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(AdministrationOperatorCommandSchema.safeParse({ ...command, transportUrl: "https://browser-visible.invalid/v1/commands" }).success).toBe(false);
  });

  it("rejects wrong audience and expired commands before operator admission", () => {
    expect(AdministrationOperatorCommandSchema.safeParse({ ...command, audience: "browser" }).success).toBe(false);
    expect(isAdministrationOperatorCommandActiveAt(command, "2026-09-04T12:04:59.999Z")).toBe(true);
    expect(isAdministrationOperatorCommandActiveAt(command, "2026-09-04T12:05:00.000Z")).toBe(false);
    expect(AdministrationOperatorCommandSchema.safeParse({ ...command, expiresAt: command.issuedAt }).success).toBe(false);
  });

  it("rejects cross-tenant commands and commands outside the certificate command family", () => {
    expect(AdministrationOperatorAuthenticatedCommandSchema.safeParse({ command, verifiedMtlsIdentity: { ...verifiedMtlsIdentity, applicationId: "customer-beta" } }).success).toBe(false);
    expect(AdministrationOperatorAuthenticatedCommandSchema.safeParse({ command, verifiedMtlsIdentity: { ...verifiedMtlsIdentity, allowedCommandFamilies: ["catalog"] } }).success).toBe(false);
  });

  it("binds replay identity to the unchanged canonical request and rejects forged responses", () => {
    const authenticated = { command, verifiedMtlsIdentity } as const;
    const requestDigest = `sha256:${createHash("sha256").update(canonicalJson(administrationOperatorRequestDigestInput(authenticated))).digest("hex")}`;
    const changed = { ...command, version: "1.0.1" } as const;
    const changedDigest = `sha256:${createHash("sha256").update(canonicalJson(administrationOperatorRequestDigestInput({ command: changed, verifiedMtlsIdentity }))).digest("hex")}`;
    expect(changedDigest).not.toBe(requestDigest);
    const response = { schemaVersion: 1, outcome: "accepted", requestDigest, authoritativeResult: { kind: "operation", operationId: "operator-operation-1" }, resultDigest: digest("a"), operatorIdentity: "operator:production" } as const;
    expect(AdministrationOperatorResponseSchema.safeParse(response).success).toBe(true);
    expect(AdministrationOperatorResponseBindingSchema.safeParse({ expectedRequestDigest: requestDigest, expectedOperatorIdentity: "operator:production", response }).success).toBe(true);
    expect(AdministrationOperatorResponseBindingSchema.safeParse({ expectedRequestDigest: requestDigest, expectedOperatorIdentity: "operator:production", response: { ...response, requestDigest: changedDigest } }).success).toBe(false);
    expect(AdministrationOperatorResponseBindingSchema.safeParse({ expectedRequestDigest: requestDigest, expectedOperatorIdentity: "operator:production", response: { ...response, operatorIdentity: "operator:forged" } }).success).toBe(false);
  });
});
