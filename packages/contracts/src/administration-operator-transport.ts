import * as z from "zod";

import { AdministrationActorEnvelopeSchema } from "./system-administration.js";
import { ExtensionIdentitySchema } from "./extension-runtime.js";
import { ExactSemverSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

export const ADMINISTRATION_OPERATOR_TRANSPORT_SCHEMA_VERSION = 1 as const;
export const administrationOperatorCommandPath = "/v1/commands" as const;
export const administrationOperatorAudience = "k-nex-administration-operator" as const;
export const administrationOperatorTransportSchemaUrl = "https://schemas.k-nex.dev/administration-operator-transport/v1.schema.json" as const;

export const administrationOperatorCommandFamilies = Object.freeze([
  "extension-lifecycle",
  "catalog",
  "operations"
] as const);

const applicationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const environmentSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u);
const recordIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u);
const revisionSchema = z.number().finite().int().nonnegative().max(1_000_000_000);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const uriSanSchema = z.string().max(512).regex(/^spiffe:\/\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:@/-]*)+$/u);
const serviceIdentitySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u);
const commandFamilySchema = z.enum(administrationOperatorCommandFamilies);

const expectedRevisionsSchema = z.strictObject({
  authorizationRevision: revisionSchema,
  lifecycleRevision: revisionSchema,
  inventoryRevision: revisionSchema,
  extensionRevision: revisionSchema
});

/**
 * Deployment-owned client-certificate identity projected only after TLS
 * verification. The URI SAN is never browser input or browser output.
 */
export const AdministrationOperatorMtlsIdentitySchema = z.strictObject({
  schemaVersion: z.literal(ADMINISTRATION_OPERATOR_TRANSPORT_SCHEMA_VERSION),
  uriSan: uriSanSchema,
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  allowedCommandFamilies: uniqueArray(commandFamilySchema).min(1).max(administrationOperatorCommandFamilies.length)
});

const commandBase = {
  schemaVersion: z.literal(ADMINISTRATION_OPERATOR_TRANSPORT_SCHEMA_VERSION),
  audience: z.literal(administrationOperatorAudience),
  actor: AdministrationActorEnvelopeSchema,
  expected: expectedRevisionsSchema,
  idempotencyKey: idempotencyKeySchema,
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true })
} as const;

/** Closed v1 command set. It intentionally has no URL, certificate, approval, or raw evidence field. */
export const AdministrationOperatorCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commandBase,
    kind: z.literal("extension-plan"),
    extension: ExtensionIdentitySchema,
    version: ExactSemverSchema,
    operation: z.enum(["install", "update", "disable", "rollback", "uninstall"])
  }),
  z.strictObject({
    ...commandBase,
    kind: z.literal("extension-execute"),
    operationId: recordIdSchema
  }),
  z.strictObject({ ...commandBase, kind: z.literal("catalog-refresh") }),
  z.strictObject({ ...commandBase, kind: z.literal("operations-backup") }),
  z.strictObject({ ...commandBase, kind: z.literal("operations-restore-drill") })
]).superRefine((command, context) => {
  if (Date.parse(command.expiresAt) <= Date.parse(command.issuedAt)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Operator commands must expire after issuance." });
  }
  if (command.expected.authorizationRevision !== command.actor.authorizationRevision || command.expected.lifecycleRevision !== command.actor.lifecycleRevision) {
    context.addIssue({ code: "custom", path: ["expected"], message: "Expected authorization and lifecycle revisions must match the actor envelope." });
  }
});

/** Maps a closed command to the authority recorded in the deployment client certificate. */
export function administrationOperatorCommandFamily(command: z.output<typeof AdministrationOperatorCommandSchema>): typeof administrationOperatorCommandFamilies[number] {
  if (command.kind === "extension-plan" || command.kind === "extension-execute") return "extension-lifecycle";
  if (command.kind === "catalog-refresh") return "catalog";
  return "operations";
}

/**
 * Operator-only envelope after the TLS terminator has verified the deployment
 * client certificate. The command's actor and certificate must name the same
 * customer application and environment.
 */
export const AdministrationOperatorAuthenticatedCommandSchema = z.strictObject({
  command: AdministrationOperatorCommandSchema,
  verifiedMtlsIdentity: AdministrationOperatorMtlsIdentitySchema
}).superRefine((value, context) => {
  const { command, verifiedMtlsIdentity } = value;
  if (command.actor.applicationId !== verifiedMtlsIdentity.applicationId || command.actor.environment !== verifiedMtlsIdentity.environment) {
    context.addIssue({ code: "custom", path: ["verifiedMtlsIdentity"], message: "Verified mTLS identity must match the actor application and environment." });
  }
  if (!verifiedMtlsIdentity.allowedCommandFamilies.includes(administrationOperatorCommandFamily(command))) {
    context.addIssue({ code: "custom", path: ["verifiedMtlsIdentity", "allowedCommandFamilies"], message: "Verified mTLS identity is not allowed to submit this command family." });
  }
});

/** The exact canonical value which SHA-256 request digest implementations must hash. */
export function administrationOperatorRequestDigestInput(value: z.output<typeof AdministrationOperatorAuthenticatedCommandSchema>) {
  return Object.freeze({
    command: value.command,
    verifiedMtlsIdentity: value.verifiedMtlsIdentity
  });
}

const operatorResultReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("operation"), operationId: recordIdSchema }),
  z.strictObject({ kind: z.literal("receipt"), receiptId: recordIdSchema })
]);

const safeRejectionReasonSchema = z.enum([
  "audience-mismatch",
  "command-expired",
  "authorization-rejected",
  "revision-conflict",
  "idempotency-conflict",
  "command-rejected",
  "operator-unavailable"
]);

/**
 * Safe server-to-server response. Raw errors, transport URL, certificates,
 * approvals, and evidence are deliberately unrepresentable.
 */
export const AdministrationOperatorResponseSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    schemaVersion: z.literal(ADMINISTRATION_OPERATOR_TRANSPORT_SCHEMA_VERSION),
    outcome: z.literal("accepted"),
    requestDigest: digestSchema,
    authoritativeResult: operatorResultReferenceSchema,
    resultDigest: digestSchema,
    operatorIdentity: serviceIdentitySchema
  }),
  z.strictObject({
    schemaVersion: z.literal(ADMINISTRATION_OPERATOR_TRANSPORT_SCHEMA_VERSION),
    outcome: z.literal("rejected"),
    requestDigest: digestSchema,
    authoritativeResult: operatorResultReferenceSchema,
    resultDigest: digestSchema,
    operatorIdentity: serviceIdentitySchema,
    reason: safeRejectionReasonSchema
  })
]);

/** Server-side verification input; it rejects a response for another request or operator identity. */
export const AdministrationOperatorResponseBindingSchema = z.strictObject({
  expectedRequestDigest: digestSchema,
  expectedOperatorIdentity: serviceIdentitySchema,
  response: AdministrationOperatorResponseSchema
}).superRefine((value, context) => {
  if (value.response.requestDigest !== value.expectedRequestDigest) {
    context.addIssue({ code: "custom", path: ["response", "requestDigest"], message: "Operator response does not bind the submitted request digest." });
  }
  if (value.response.operatorIdentity !== value.expectedOperatorIdentity) {
    context.addIssue({ code: "custom", path: ["response", "operatorIdentity"], message: "Operator response identity is not the configured operator." });
  }
});

/** Time-sensitive admission is explicit so parsing remains deterministic and replay checks supply their own clock. */
export function isAdministrationOperatorCommandActiveAt(command: z.output<typeof AdministrationOperatorCommandSchema>, now: string): boolean {
  const parsedNow = Date.parse(now);
  return Number.isFinite(parsedNow) && Date.parse(command.issuedAt) <= parsedNow && parsedNow < Date.parse(command.expiresAt);
}

export type AdministrationOperatorMtlsIdentity = z.infer<typeof AdministrationOperatorMtlsIdentitySchema>;
export type AdministrationOperatorExpectedRevisions = z.infer<typeof expectedRevisionsSchema>;
export type AdministrationOperatorCommand = z.infer<typeof AdministrationOperatorCommandSchema>;
export type AdministrationOperatorAuthenticatedCommand = z.infer<typeof AdministrationOperatorAuthenticatedCommandSchema>;
export type AdministrationOperatorResponse = z.infer<typeof AdministrationOperatorResponseSchema>;
export type AdministrationOperatorResponseBinding = z.infer<typeof AdministrationOperatorResponseBindingSchema>;
