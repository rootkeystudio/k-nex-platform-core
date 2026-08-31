import * as z from "zod";

import { MillisecondTimestampSchema } from "./event.js";
import {
  ExtensionLifecycleStateSchema,
  ExtensionOperationKindSchema
} from "./extension-runtime.js";
import { ExactSemverSchema, HotApplicationIdSchema, PluginIdSchema, ThemeSkinIdSchema } from "./identity.js";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const FullShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const ApplicationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const EnvironmentSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u);
const RecordIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const RevisionSchema = z.number().finite().int().nonnegative().max(1_000_000_000);
const PositiveRevisionSchema = z.number().finite().int().positive().max(1_000_000_000);

export const extensionOperationPhases = [
  "planning", "downloading", "verified", "staged", "waiting-configuration", "waiting-approval", "warming",
  "source-change-required", "source-change-ready", "build-attested", "zero-downtime-eligible", "maintenance-required", "unsupported",
  "rollback-window-open", "rollback-window-closed", "contract-cleanup-eligible", "completed", "failed"
] as const;

export const ExtensionOperationPhaseSchema = z.enum(extensionOperationPhases);

export const ExtensionOperationActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("trusted-automation"), identity: z.string().min(1).max(512) }),
  z.strictObject({ kind: z.literal("actor"), id: z.string().min(1).max(160), approvalId: z.string().min(1).max(160) })
]);

const LifecycleEventBase = {
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  applicationId: ApplicationIdSchema,
  environment: EnvironmentSchema,
  eventId: RecordIdSchema,
  eventType: z.literal("extension.lifecycle-transition"),
  operationId: RecordIdSchema,
  operation: ExtensionOperationKindSchema,
  operationPhase: ExtensionOperationPhaseSchema,
  lifecycleState: ExtensionLifecycleStateSchema,
  expectedRevision: RevisionSchema,
  revision: PositiveRevisionSchema,
  inventoryRevision: PositiveRevisionSchema,
  actor: ExtensionOperationActorSchema,
  receiptId: RecordIdSchema,
  auditId: RecordIdSchema,
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u),
  correlationId: RecordIdSchema,
  occurredAt: MillisecondTimestampSchema
} as const;

const BundleTransitionEvidenceSchema = z.strictObject({
  sourceCommit: FullShaSchema,
  artifactDigest: DigestSchema,
  generationId: RecordIdSchema,
  manifestDigest: DigestSchema.optional(),
  catalogDigest: DigestSchema.optional(),
  provenanceDigest: DigestSchema.optional(),
  sbomDigest: DigestSchema.optional()
});

const PlatformTransitionEvidenceSchema = z.strictObject({
  sourceCommit: FullShaSchema,
  compositionChangePlanDigest: DigestSchema,
  generationId: RecordIdSchema,
  buildRequestDigest: DigestSchema.optional(),
  buildEvidenceDigest: DigestSchema.optional(),
  applicationDigest: DigestSchema.optional(),
  imageDigest: DigestSchema.optional()
});

export const ExtensionLifecycleEventSchema = z.discriminatedUnion("deliveryClass", [
  z.strictObject({ ...LifecycleEventBase, deliveryClass: z.literal("platform-plugin"), id: PluginIdSchema, evidence: PlatformTransitionEvidenceSchema }),
  z.strictObject({ ...LifecycleEventBase, deliveryClass: z.literal("hot-application"), id: HotApplicationIdSchema, evidence: BundleTransitionEvidenceSchema }),
  z.strictObject({ ...LifecycleEventBase, deliveryClass: z.literal("theme-skin"), id: ThemeSkinIdSchema, evidence: BundleTransitionEvidenceSchema })
]).meta({ $id: "https://schemas.k-nex.dev/extension-lifecycle-event/v1.json", title: "K-Nex Extension Lifecycle Event v1" });

const SecurityQuarantineEvidenceSchema = z.strictObject({
  catalogDigest: DigestSchema,
  catalogSignerIdentity: z.string().min(1).max(160),
  catalogSequence: PositiveRevisionSchema,
  disposition: z.enum([
    "revoked",
    "security-compromised",
    "security-advisory",
    "review-rejected",
    "review-pending",
    "support-unsupported",
    "support-deprecated"
  ]),
  sourceCommit: FullShaSchema,
  artifactDigest: DigestSchema,
  manifestDigest: DigestSchema,
  provenanceDigest: DigestSchema,
  sbomDigest: DigestSchema,
  generationId: RecordIdSchema,
  version: ExactSemverSchema
});

const SecurityQuarantineEventBase = {
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  eventId: RecordIdSchema,
  eventType: z.literal("extension.security-quarantine"),
  securityTransitionId: RecordIdSchema,
  receiptId: RecordIdSchema,
  auditId: RecordIdSchema,
  applicationId: ApplicationIdSchema,
  environment: EnvironmentSchema,
  expectedRevision: RevisionSchema,
  revision: PositiveRevisionSchema,
  inventoryRevision: PositiveRevisionSchema,
  occurredAt: MillisecondTimestampSchema,
  evidence: SecurityQuarantineEvidenceSchema
} as const;

/** A system security transition, deliberately separate from an operator lifecycle action. */
export const ExtensionSecurityQuarantineEventSchema = z.discriminatedUnion("deliveryClass", [
  z.strictObject({ ...SecurityQuarantineEventBase, deliveryClass: z.literal("hot-application"), id: HotApplicationIdSchema }),
  z.strictObject({ ...SecurityQuarantineEventBase, deliveryClass: z.literal("theme-skin"), id: ThemeSkinIdSchema })
]).meta({ $id: "https://schemas.k-nex.dev/extension-security-quarantine-event/v1.json", title: "K-Nex Extension Security Quarantine Event v1" });

const BundleGenerationEvidenceBase = {
  authority: z.literal("verified-bundle"),
  applicationId: ApplicationIdSchema,
  environment: EnvironmentSchema,
  generationId: RecordIdSchema,
  version: ExactSemverSchema,
  sourceCommit: FullShaSchema,
  artifactDigest: DigestSchema,
  manifestDigest: DigestSchema,
  catalogDigest: DigestSchema,
  provenanceDigest: DigestSchema,
  sbomDigest: DigestSchema,
  receiptId: RecordIdSchema
} as const;

const HotApplicationGenerationEvidenceSchema = z.strictObject({
  ...BundleGenerationEvidenceBase,
  deliveryClass: z.literal("hot-application"),
  extensionId: HotApplicationIdSchema
});

const ThemeSkinGenerationEvidenceSchema = z.strictObject({
  ...BundleGenerationEvidenceBase,
  deliveryClass: z.literal("theme-skin"),
  extensionId: ThemeSkinIdSchema
});

const PlatformGenerationEvidenceSchema = z.strictObject({
  authority: z.literal("static-build"),
  generationId: RecordIdSchema,
  version: ExactSemverSchema,
  sourceCommit: FullShaSchema,
  compositionChangePlanDigest: DigestSchema,
  buildEvidenceDigest: DigestSchema,
  applicationDigest: DigestSchema,
  imageDigest: DigestSchema,
  migrationRevision: RevisionSchema,
  workerFencingToken: PositiveRevisionSchema,
  receiptId: RecordIdSchema
});

function runtimeEntry<T extends z.core.$ZodType>(generation: T) {
  const base = {
    revision: PositiveRevisionSchema,
    lastOperationId: RecordIdSchema,
    lastReceiptId: RecordIdSchema,
    stateDigest: DigestSchema
  } as const;
  return z.discriminatedUnion("disposition", [
    z.strictObject({ ...base, disposition: z.literal("active"), activeGeneration: generation, rollbackGeneration: z.optional(generation) }),
    z.strictObject({ ...base, disposition: z.enum(["disabled", "quarantined", "retirement-pending"]), retainedGeneration: z.optional(generation) }),
    z.strictObject({ ...base, disposition: z.literal("removed") })
  ]);
}

const PlatformRuntimeEntrySchema = runtimeEntry(PlatformGenerationEvidenceSchema);
const HotApplicationRuntimeEntrySchema = runtimeEntry(HotApplicationGenerationEvidenceSchema);
const ThemeSkinRuntimeEntrySchema = runtimeEntry(ThemeSkinGenerationEvidenceSchema);

function boundedRecord<K extends z.core.$ZodType<string>, V extends z.core.$ZodType>(key: K, value: V) {
  return z.record(key, value).check((context) => {
    if (Object.keys(context.value).length > 512) context.issues.push({ code: "custom", input: context.value, message: "Runtime extension inventory may contain at most 512 entries per delivery class." });
  }).meta({ maxProperties: 512 });
}

export const RuntimeExtensionInventorySchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  applicationId: ApplicationIdSchema,
  environment: EnvironmentSchema,
  hostInventoryDigest: DigestSchema,
  revision: RevisionSchema,
  observedAt: MillisecondTimestampSchema,
  stateDigest: DigestSchema,
  extensions: z.strictObject({
    platformPlugins: boundedRecord(PluginIdSchema, PlatformRuntimeEntrySchema),
    hotApplications: boundedRecord(HotApplicationIdSchema, HotApplicationRuntimeEntrySchema),
    themeSkins: boundedRecord(ThemeSkinIdSchema, ThemeSkinRuntimeEntrySchema)
  })
}).meta({ $id: "https://schemas.k-nex.dev/runtime-extension-inventory/v1.json", title: "K-Nex Runtime Extension Inventory v1" });

export type ExtensionOperationActor = z.infer<typeof ExtensionOperationActorSchema>;
export type ExtensionOperationPhase = z.infer<typeof ExtensionOperationPhaseSchema>;
export type ExtensionLifecycleEvent = z.infer<typeof ExtensionLifecycleEventSchema>;
export type ExtensionSecurityQuarantineEvent = z.infer<typeof ExtensionSecurityQuarantineEventSchema>;
export type RuntimeExtensionInventory = z.infer<typeof RuntimeExtensionInventorySchema>;
