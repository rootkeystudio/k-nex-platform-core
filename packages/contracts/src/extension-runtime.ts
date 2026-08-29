import * as z from "zod";

import { MillisecondTimestampSchema } from "./event.js";
import { ExactSemverSchema, HotApplicationIdSchema, PluginIdSchema, ResourceIdSchema, ThemeSkinIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

export const extensionDeliveryClasses = ["platform-plugin", "hot-application", "theme-skin"] as const;
export const extensionLifecycleStates = [
  "catalog-available", "planning", "downloading", "verified", "staged", "waiting-configuration", "waiting-approval", "warming",
  "active", "disabled", "update-available", "rollback-available", "quarantined", "retirement-pending", "removed"
] as const;
export const extensionOperationKinds = ["install", "update", "disable", "rollback", "uninstall"] as const;

export const extensionRuntimeCeilings = Object.freeze({
  bundleFiles: 512,
  bundleBytes: 256 * 1024 * 1024,
  assetBytes: 64 * 1024 * 1024,
  cssBytes: 512 * 1024,
  storageBytes: 256 * 1024 * 1024,
  memoryMiB: 512,
  cpuMilliCores: 2_000,
  wallTimeMs: 30_000,
  inputBytes: 1_048_576,
  outputBytes: 4_194_304,
  logBytes: 1_048_576,
  concurrency: 64,
  capabilities: 16,
  entrypoints: 16,
  descriptors: 64,
  routes: 32,
  destinations: 16
} as const);

const positiveInteger = (maximum: number) => z.number().finite().int().min(1).max(maximum);
const revisionSchema = z.number().finite().int().nonnegative().max(1_000_000_000);
const recordIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const reasonSchema = z.string().min(1).max(240);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const fullShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const applicationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const environmentSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u);
const authorityIdentitySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]{2,511}$/u);
const bundleSegment = "[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}";
const entrypointSegment = "[a-z0-9][a-z0-9._-]{0,119}";

export const ExtensionDeliveryClassSchema = z.enum(extensionDeliveryClasses);
export const ExtensionLifecycleStateSchema = z.enum(extensionLifecycleStates);
export const ExtensionOperationKindSchema = z.enum(extensionOperationKinds);
export const ExtensionDigestSchema = digestSchema;
export const ExtensionAssetPathSchema = z.string().max(256).regex(new RegExp(`^assets/${bundleSegment}(?:/${bundleSegment})*$`));
export const ExtensionSchemaPathSchema = z.string().max(256).regex(new RegExp(`^schemas/${bundleSegment}(?:/${bundleSegment})*\\.json$`));
export const ExtensionBundlePathSchema = z.string().max(256).regex(new RegExp(`^(?:assets|locales|schemas|server|styles|ui)/${bundleSegment}(?:/${bundleSegment})*$`));
export const HotApplicationServerEntrypointSchema = z.string().max(160).regex(new RegExp(`^server/${entrypointSegment}\\.mjs$`));
export const HotApplicationUiEntrypointSchema = z.string().max(160).regex(new RegExp(`^ui/${entrypointSegment}\\.mjs$`));
export const ThemeSkinStylesheetSchema = z.string().max(160).regex(new RegExp(`^styles/${entrypointSegment}\\.css$`));
export const ExtensionRouteSchema = z.string().max(160).regex(/^\/apps\/[a-z0-9][a-z0-9-]*(?:\/(?:[a-z0-9_-]+|:[a-z][a-z0-9]*))*$/u);
export const ExtensionDestinationSchema = z.string().max(253).regex(/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::[0-9]{2,5})?$/u);

export const ExtensionIdentitySchema = z.discriminatedUnion("deliveryClass", [
  z.strictObject({ deliveryClass: z.literal("platform-plugin"), id: PluginIdSchema }),
  z.strictObject({ deliveryClass: z.literal("hot-application"), id: HotApplicationIdSchema }),
  z.strictObject({ deliveryClass: z.literal("theme-skin"), id: ThemeSkinIdSchema })
]);

const capabilityBase = { "$schema": z.string().max(512).optional(), required: z.boolean(), reason: reasonSchema } as const;
const capabilityReferenceSchema = z.strictObject({ id: ResourceIdSchema, version: positiveInteger(1_000_000) });

export const ExtensionCapabilityRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...capabilityBase, kind: z.literal("records"), operations: uniqueArray(z.enum(["query", "action"])).min(1).max(2), resources: uniqueArray(capabilityReferenceSchema).min(1).max(32) }),
  z.strictObject({ ...capabilityBase, kind: z.literal("app-storage"), operations: uniqueArray(z.enum(["get", "put", "query", "delete"])).min(1).max(4), schemaIds: uniqueArray(ResourceIdSchema).min(1).max(16) }),
  z.strictObject({ ...capabilityBase, kind: z.literal("events"), operations: uniqueArray(z.enum(["publish", "subscribe"])).min(1).max(2), eventTypes: uniqueArray(ResourceIdSchema).min(1).max(32) }),
  z.strictObject({ ...capabilityBase, kind: z.literal("http-fetch"), destinations: uniqueArray(ExtensionDestinationSchema).min(1).max(extensionRuntimeCeilings.destinations), methods: uniqueArray(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])).min(1).max(5) }),
  z.strictObject({ ...capabilityBase, kind: z.literal("files"), operations: uniqueArray(z.enum(["read", "write"])).min(1).max(2) }),
  z.strictObject({ ...capabilityBase, kind: z.literal("secret-reference"), references: uniqueArray(ResourceIdSchema).min(1).max(16) }),
  z.strictObject({ ...capabilityBase, kind: z.literal("jobs"), operations: uniqueArray(z.literal("schedule")).length(1), scheduleIds: uniqueArray(ResourceIdSchema).min(1).max(16) }),
  z.strictObject({ ...capabilityBase, kind: z.literal("audit"), operations: uniqueArray(z.literal("emit")).length(1) })
]);

export const HotApplicationResourceBudgetSchema = z.strictObject({
  maxBundleBytes: positiveInteger(extensionRuntimeCeilings.bundleBytes),
  maxAssetBytes: positiveInteger(extensionRuntimeCeilings.assetBytes),
  maxStorageBytes: positiveInteger(extensionRuntimeCeilings.storageBytes),
  maxMemoryMiB: positiveInteger(extensionRuntimeCeilings.memoryMiB),
  maxCpuMilliCores: positiveInteger(extensionRuntimeCeilings.cpuMilliCores),
  maxWallTimeMs: positiveInteger(extensionRuntimeCeilings.wallTimeMs),
  maxInputBytes: positiveInteger(extensionRuntimeCeilings.inputBytes),
  maxOutputBytes: positiveInteger(extensionRuntimeCeilings.outputBytes),
  maxLogBytes: positiveInteger(extensionRuntimeCeilings.logBytes),
  maxConcurrency: positiveInteger(extensionRuntimeCeilings.concurrency)
});

export const ThemeSkinResourceBudgetSchema = z.strictObject({
  maxBundleBytes: positiveInteger(extensionRuntimeCeilings.bundleBytes),
  maxAssetBytes: positiveInteger(extensionRuntimeCeilings.assetBytes),
  maxCssBytes: positiveInteger(extensionRuntimeCeilings.cssBytes)
});

export const ExtensionResourceBudgetSchema = z.discriminatedUnion("deliveryClass", [
  z.strictObject({ "$schema": z.string().max(512).optional(), deliveryClass: z.literal("hot-application"), limits: HotApplicationResourceBudgetSchema }),
  z.strictObject({ "$schema": z.string().max(512).optional(), deliveryClass: z.literal("theme-skin"), limits: ThemeSkinResourceBudgetSchema })
]).meta({ $id: "https://schemas.k-nex.dev/extension-resource-budget/v1.json", title: "K-Nex Extension Resource Budget v1" });

const descriptorReferenceSchema = z.strictObject({ id: ResourceIdSchema, path: ExtensionSchemaPathSchema });
const logicFunctionSchema = z.strictObject({ id: ResourceIdSchema, entrypoint: HotApplicationServerEntrypointSchema });
const storageSchema = z.strictObject({
  id: ResourceIdSchema,
  schemaPath: ExtensionSchemaPathSchema,
  quotaBytes: positiveInteger(extensionRuntimeCeilings.storageBytes),
  indexes: uniqueArray(z.strictObject({ path: z.string().regex(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u).max(160), unique: z.boolean() })).max(16)
});
const localizationReferenceSchema = z.strictObject({ locale: z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u).max(35), path: z.string().max(256).regex(new RegExp(`^locales/${bundleSegment}(?:/${bundleSegment})*\\.json$`)) });

export const HotApplicationManifestSchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  deliveryClass: z.literal("hot-application"),
  id: HotApplicationIdSchema,
  displayName: z.string().min(1).max(120),
  version: ExactSemverSchema,
  runtimeAbi: ExactSemverSchema,
  entrypoints: z.strictObject({ server: uniqueArray(HotApplicationServerEntrypointSchema).max(extensionRuntimeCeilings.entrypoints), ui: uniqueArray(HotApplicationUiEntrypointSchema).min(1).max(extensionRuntimeCeilings.entrypoints) }),
  capabilities: uniqueArray(ExtensionCapabilityRequestSchema).max(extensionRuntimeCeilings.capabilities),
  resourceBudget: HotApplicationResourceBudgetSchema,
  settings: uniqueArray(descriptorReferenceSchema).max(extensionRuntimeCeilings.descriptors),
  screens: uniqueArray(z.strictObject({ id: ResourceIdSchema, route: ExtensionRouteSchema, entrypoint: HotApplicationUiEntrypointSchema })).min(1).max(extensionRuntimeCeilings.routes),
  navigation: uniqueArray(z.strictObject({ id: ResourceIdSchema, title: z.string().min(1).max(120), screenId: ResourceIdSchema })).max(extensionRuntimeCeilings.routes),
  sources: uniqueArray(descriptorReferenceSchema).max(extensionRuntimeCeilings.descriptors),
  actions: uniqueArray(descriptorReferenceSchema).max(extensionRuntimeCeilings.descriptors),
  tools: uniqueArray(descriptorReferenceSchema).max(extensionRuntimeCeilings.descriptors),
  logicFunctions: uniqueArray(logicFunctionSchema).max(extensionRuntimeCeilings.entrypoints),
  eventSubscriptions: uniqueArray(z.strictObject({ eventType: ResourceIdSchema, logicFunctionId: ResourceIdSchema })).max(extensionRuntimeCeilings.descriptors),
  schedules: uniqueArray(z.strictObject({ id: ResourceIdSchema, logicFunctionId: ResourceIdSchema, intervalSeconds: positiveInteger(86_400) })).max(16),
  storageSchemas: uniqueArray(storageSchema).max(16),
  assets: uniqueArray(ExtensionAssetPathSchema).max(extensionRuntimeCeilings.bundleFiles),
  localization: uniqueArray(localizationReferenceSchema).max(32),
  healthChecks: uniqueArray(z.strictObject({ id: ResourceIdSchema, entrypoint: HotApplicationServerEntrypointSchema })).max(8)
}).meta({ $id: "https://schemas.k-nex.dev/hot-application-manifest/v1.json", title: "K-Nex Hot Application Manifest v1" });

const tokenNameSchema = z.string().regex(/^--k-nex-[a-z0-9-]{1,80}$/u);
const tokenValueSchema = z.string().min(1).max(256).regex(/^(?![\s\S]*(?:@import|url\s*\(|javascript:|https?:|data:|[{};]))[\s\S]+$/iu);
const tokenMapSchema = z.record(tokenNameSchema, tokenValueSchema).check((context) => {
  if (Object.keys(context.value).length > 128) context.issues.push({ code: "custom", input: context.value, message: "A skin token map may contain at most 128 tokens." });
}).meta({ maxProperties: 128 });
const paletteMapSchema = z.record(ResourceIdSchema, tokenMapSchema).check((context) => {
  const count = Object.keys(context.value).length;
  if (count < 1 || count > 16) context.issues.push({ code: "custom", input: context.value, message: "A skin must declare between 1 and 16 palettes." });
}).meta({ minProperties: 1, maxProperties: 16 });

export const ThemeSkinManifestSchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  deliveryClass: z.literal("theme-skin"),
  id: ThemeSkinIdSchema,
  displayName: z.string().min(1).max(120),
  version: ExactSemverSchema,
  runtimeAbi: ExactSemverSchema,
  profileCompatibility: z.strictObject({ schemaVersion: positiveInteger(1_000_000) }),
  tokens: tokenMapSchema,
  palettes: paletteMapSchema,
  recipes: z.strictObject({ surface: ResourceIdSchema.optional(), text: ResourceIdSchema.optional(), border: ResourceIdSchema.optional(), accent: ResourceIdSchema.optional(), focusRing: ResourceIdSchema.optional() }),
  stylesheets: uniqueArray(ThemeSkinStylesheetSchema).min(1).max(8),
  profileMigrations: uniqueArray(z.strictObject({ fromSchemaVersion: positiveInteger(1_000_000), toSchemaVersion: positiveInteger(1_000_000), renames: uniqueArray(z.strictObject({ from: tokenNameSchema, to: tokenNameSchema })).min(1).max(32) })).max(8),
  assets: uniqueArray(z.strictObject({ path: ExtensionAssetPathSchema, digest: digestSchema })).max(extensionRuntimeCeilings.bundleFiles),
  localization: uniqueArray(localizationReferenceSchema).max(32),
  resourceBudget: ThemeSkinResourceBudgetSchema
}).meta({ $id: "https://schemas.k-nex.dev/theme-skin-manifest/v1.json", title: "K-Nex Theme Skin Manifest v1" });

const bundleFileMetadataSchema = z.strictObject({ digest: digestSchema, bytes: positiveInteger(extensionRuntimeCeilings.bundleBytes), contentType: z.enum(["application/javascript", "application/json", "image/svg+xml", "text/css", "text/plain"]) });
const bundleFileInventorySchema = z.record(ExtensionBundlePathSchema, bundleFileMetadataSchema).check((context) => {
  const count = Object.keys(context.value).length;
  if (count < 1 || count > extensionRuntimeCeilings.bundleFiles) context.issues.push({ code: "custom", input: context.value, message: `A bundle must contain between 1 and ${extensionRuntimeCeilings.bundleFiles} files.` });
}).meta({ minProperties: 1, maxProperties: extensionRuntimeCeilings.bundleFiles });
const bundleEvidenceShape = {
  payloadDigest: digestSchema.describe("SHA-256 of canonical JSON for the closed files inventory after each listed file digest, size, and content type is computed."),
  files: bundleFileInventorySchema,
  sbom: z.strictObject({ path: z.literal("sbom.cdx.json"), digest: digestSchema }),
  provenance: z.strictObject({ reference: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/attestations\/[A-Za-z0-9_.:-]+$/u).max(512), digest: digestSchema })
} as const;

export const ExtensionBundleManifestSchema = z.discriminatedUnion("deliveryClass", [
  z.strictObject({ "$schema": z.string().max(512).optional(), schemaVersion: z.literal(1), deliveryClass: z.literal("platform-plugin"), id: PluginIdSchema, version: ExactSemverSchema, delivery: z.literal("external-supervisor"), releaseManifestDigest: digestSchema, artifactDigest: digestSchema }),
  z.strictObject({ "$schema": z.string().max(512).optional(), schemaVersion: z.literal(1), deliveryClass: z.literal("hot-application"), id: HotApplicationIdSchema, version: ExactSemverSchema, runtimeAbi: ExactSemverSchema, ...bundleEvidenceShape, entrypoints: z.strictObject({ server: uniqueArray(HotApplicationServerEntrypointSchema).max(extensionRuntimeCeilings.entrypoints), ui: uniqueArray(HotApplicationUiEntrypointSchema).min(1).max(extensionRuntimeCeilings.entrypoints) }), resourceBudget: HotApplicationResourceBudgetSchema }),
  z.strictObject({ "$schema": z.string().max(512).optional(), schemaVersion: z.literal(1), deliveryClass: z.literal("theme-skin"), id: ThemeSkinIdSchema, version: ExactSemverSchema, runtimeAbi: ExactSemverSchema, ...bundleEvidenceShape, stylesheets: uniqueArray(ThemeSkinStylesheetSchema).min(1).max(8), resourceBudget: ThemeSkinResourceBudgetSchema })
]).meta({ $id: "https://schemas.k-nex.dev/extension-bundle-manifest/v1.json", title: "K-Nex Extension Bundle Manifest v1" });

const zeroDowntimeEligibleBody = z.strictObject({ outcome: z.literal("zero-downtime-eligible"), checks: z.strictObject({ oldGenerationHealthy: z.literal(true), expandCompatibleMigration: z.literal(true), writerReaderOverlap: z.literal(true), workerDrain: z.literal(true), realtimeConvergence: z.literal(true), targetReadiness: z.literal(true), inventoryMatch: z.literal(true), rollbackCompatible: z.literal(true) }) });
const maintenanceRequiredBody = z.strictObject({ outcome: z.literal("maintenance-required"), reasons: uniqueArray(z.enum(["destructive-migration", "incompatible-overlap", "readiness-unproven", "inventory-mismatch", "rollback-incompatible"])).min(1).max(5) });
const unsupportedBody = z.strictObject({ outcome: z.literal("unsupported"), reasons: uniqueArray(z.enum(["supervisor-unavailable", "gateway-unavailable", "worker-overlap-unsafe", "realtime-convergence-unavailable"])).min(1).max(4) });
const zeroDowntimeBodySchema = z.discriminatedUnion("outcome", [zeroDowntimeEligibleBody, maintenanceRequiredBody, unsupportedBody]);

export const ZeroDowntimeEligibilitySchema = z.strictObject({ "$schema": z.string().max(512).optional(), schemaVersion: z.literal(1), deliveryClass: z.literal("platform-plugin"), id: PluginIdSchema, result: zeroDowntimeBodySchema })
  .meta({ $id: "https://schemas.k-nex.dev/zero-downtime-eligibility/v1.json", title: "K-Nex Zero-Downtime Eligibility v1" });

const liveGenerationAvailabilitySchema = z.strictObject({ outcome: z.literal("live-generation"), activation: z.literal("atomic-generation-pointer") });
const rollbackPlanSchema = z.discriminatedUnion("available", [
  z.strictObject({ available: z.literal(true), windowSeconds: positiveInteger(2_592_000) }),
  z.strictObject({ available: z.literal(false), reason: reasonSchema })
]);
const planBase = {
  "$schema": z.string().max(512).optional(), schemaVersion: z.literal(1), planId: recordIdSchema, operationId: recordIdSchema, operation: ExtensionOperationKindSchema,
  version: ExactSemverSchema, artifactDigest: digestSchema, expectedRevision: revisionSchema,
  currentGenerationId: recordIdSchema.optional(), targetGenerationId: recordIdSchema.optional(), approvalRequired: z.boolean(), rollback: rollbackPlanSchema
} as const;

export const ExtensionInstallPlanSchema = z.discriminatedUnion("deliveryClass", [
  z.strictObject({ ...planBase, deliveryClass: z.literal("platform-plugin"), id: PluginIdSchema, availability: zeroDowntimeBodySchema }),
  z.strictObject({ ...planBase, deliveryClass: z.literal("hot-application"), id: HotApplicationIdSchema, availability: liveGenerationAvailabilitySchema, requiredCapabilities: uniqueArray(ExtensionCapabilityRequestSchema).max(extensionRuntimeCeilings.capabilities), resourceBudget: HotApplicationResourceBudgetSchema }),
  z.strictObject({ ...planBase, deliveryClass: z.literal("theme-skin"), id: ThemeSkinIdSchema, availability: liveGenerationAvailabilitySchema, resourceBudget: ThemeSkinResourceBudgetSchema })
]).meta({ $id: "https://schemas.k-nex.dev/extension-install-plan/v1.json", title: "K-Nex Extension Install Plan v1" });

const actorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("trusted-automation"), identity: z.string().min(1).max(512) }),
  z.strictObject({ kind: z.literal("actor"), id: z.string().min(1).max(160), approvalId: z.string().min(1).max(160) })
]);
const rollbackReceiptSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available"), generationId: recordIdSchema }),
  z.strictObject({ status: z.literal("unavailable"), reason: reasonSchema }),
  z.strictObject({ status: z.literal("not-requested") })
]);
const receiptBase = {
  "$schema": z.string().max(512).optional(), schemaVersion: z.literal(1), receiptId: recordIdSchema, planId: recordIdSchema, operationId: recordIdSchema,
  operation: ExtensionOperationKindSchema, version: ExactSemverSchema, artifactDigest: digestSchema, actor: actorSchema,
  occurredAt: MillisecondTimestampSchema, revisionBefore: revisionSchema, revisionAfter: revisionSchema,
  previousGenerationId: recordIdSchema.optional(), generationId: recordIdSchema.optional(), lifecycleState: ExtensionLifecycleStateSchema,
  outcome: z.enum(["accepted", "rejected", "maintenance-required"]), rollback: rollbackReceiptSchema
} as const;

export const ExtensionInstallReceiptSchema = z.discriminatedUnion("deliveryClass", [
  z.strictObject({ ...receiptBase, deliveryClass: z.literal("platform-plugin"), id: PluginIdSchema, availability: zeroDowntimeBodySchema }),
  z.strictObject({ ...receiptBase, deliveryClass: z.literal("hot-application"), id: HotApplicationIdSchema, availability: liveGenerationAvailabilitySchema }),
  z.strictObject({ ...receiptBase, deliveryClass: z.literal("theme-skin"), id: ThemeSkinIdSchema, availability: liveGenerationAvailabilitySchema })
]).meta({ $id: "https://schemas.k-nex.dev/extension-install-receipt/v1.json", title: "K-Nex Extension Install Receipt v1" });

const generationBase = {
  "$schema": z.string().max(512).optional(), schemaVersion: z.literal(1), generationId: recordIdSchema, version: ExactSemverSchema, artifactDigest: digestSchema,
  manifestDigest: digestSchema, revision: revisionSchema, lifecycleState: ExtensionLifecycleStateSchema,
  previousGenerationId: recordIdSchema.optional(), createdAt: MillisecondTimestampSchema, rollbackEligible: z.boolean()
} as const;

export const ExtensionGenerationSchema = z.discriminatedUnion("deliveryClass", [
  z.strictObject({ ...generationBase, deliveryClass: z.literal("platform-plugin"), id: PluginIdSchema }),
  z.strictObject({ ...generationBase, deliveryClass: z.literal("hot-application"), id: HotApplicationIdSchema }),
  z.strictObject({ ...generationBase, deliveryClass: z.literal("theme-skin"), id: ThemeSkinIdSchema })
]).meta({ $id: "https://schemas.k-nex.dev/extension-generation/v1.json", title: "K-Nex Extension Generation v1" });

export const RemoteUiIsolationProfileSchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  profile: z.literal("credentialless-remote-ui-v1"),
  realm: z.enum(["opaque-origin-sandbox", "dedicated-credentialless-origin"]),
  hostChannel: z.literal("transferred-message-port-only"),
  credentials: z.literal("none"),
  browserStorage: z.literal("none"),
  ambientNetwork: z.literal("denied"),
  directDom: z.literal("denied"),
  hostDynamicImport: z.literal("denied"),
  serviceWorkers: z.literal("denied"),
  sharedWorkers: z.literal("denied"),
  popupTopNavigationDownload: z.literal("denied"),
  responsePolicy: z.strictObject({
    contentSecurityPolicy: z.literal("default-src 'none'; script-src 'self'; connect-src 'none'; worker-src blob:; img-src 'self'; style-src 'self'"),
    crossOriginResourcePolicy: z.literal("cross-origin"),
    opaqueOriginCors: z.literal("null"),
    credentialsMode: z.literal("omit"),
    generationPinnedIntegrity: z.literal(true),
    strictMime: z.literal(true)
  }),
  channelChecks: z.strictObject({
    schema: z.literal(true), generation: z.literal(true), sequence: z.literal(true), replay: z.literal(true),
    size: z.literal(true), depth: z.literal(true), rate: z.literal(true), authorization: z.literal(true)
  })
}).meta({ $id: "https://schemas.k-nex.dev/remote-ui-isolation-profile/v1.json", title: "K-Nex Remote UI Isolation Profile v1" });

const productionRunnerIsolationSchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  scope: z.literal("production"),
  profile: z.literal("os-container-per-generation-v1"),
  isolation: z.literal("os-container-per-generation"),
  workloadIdentity: z.literal("unique-non-root"),
  namespaces: z.strictObject({ pid: z.literal("separate"), mount: z.literal("separate"), user: z.literal("separate"), network: z.literal("separate") }),
  filesystem: z.strictObject({ root: z.literal("read-only"), code: z.literal("read-only"), temporaryStorage: z.literal("bounded-tmpfs"), hostMounts: z.literal("none") }),
  privileges: z.strictObject({ linuxCapabilities: z.literal("dropped"), noNewPrivileges: z.literal(true), dockerSocket: z.literal("none"), databaseCredential: z.literal("none"), hostSecrets: z.literal("none") }),
  policy: z.strictObject({ syscallProfile: digestSchema, macProfile: digestSchema, rawEgress: z.literal("denied"), inboundListener: z.literal("denied"), hostNetworkAdapter: z.literal("allowlisted-proxy-only") }),
  limits: z.strictObject({ cpuMilliCores: positiveInteger(extensionRuntimeCeilings.cpuMilliCores), memoryMiB: positiveInteger(extensionRuntimeCeilings.memoryMiB), processes: positiveInteger(256), openFiles: positiveInteger(4096), tempBytes: positiveInteger(extensionRuntimeCeilings.storageBytes) }),
  rpc: z.strictObject({ transport: z.literal("structured-host-rpc-only"), schemaValidated: z.literal(true), shortLivedGenerationActorIdentity: z.literal(true) })
});

const developmentRunnerIsolationSchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  scope: z.literal("development-test-only"),
  profile: z.literal("local-child-process-v1"),
  isolation: z.literal("same-user-child-process"),
  productionEvidence: z.literal("forbidden")
});

export const RunnerIsolationProfileSchema = z.discriminatedUnion("scope", [productionRunnerIsolationSchema, developmentRunnerIsolationSchema])
  .meta({ $id: "https://schemas.k-nex.dev/runner-isolation-profile/v1.json", title: "K-Nex Runner Isolation Profile v1" });

const migrationStepBase = { stepId: recordIdSchema, migrationDigest: digestSchema } as const;
const MigrationCompatibilityStepSchema = z.discriminatedUnion("phase", [
  z.strictObject({ ...migrationStepBase, phase: z.literal("online-expand"), overlapSafe: z.literal(true) }),
  z.strictObject({ ...migrationStepBase, phase: z.literal("online-backfill"), resumable: z.literal(true), idempotent: z.literal(true), checkpointSchemaDigest: digestSchema }),
  z.strictObject({ ...migrationStepBase, phase: z.literal("post-retirement-contract"), requiresOldGenerationRetired: z.literal(true), requiresRollbackWindowClosed: z.literal(true) }),
  z.strictObject({ ...migrationStepBase, phase: z.literal("offline-required"), availability: z.literal("maintenance-required") })
]);
const RollbackWindowSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("open"), windowId: recordIdSchema, previousApplicationDigest: digestSchema, closesAt: MillisecondTimestampSchema, contractCleanup: z.literal("blocked") }),
  z.strictObject({ state: z.literal("closed"), windowId: recordIdSchema, closedAt: MillisecondTimestampSchema, contractCleanup: z.literal("eligible") }),
  z.strictObject({ state: z.literal("not-applicable"), reason: reasonSchema, contractCleanup: z.literal("blocked") })
]);
const MigrationCompatibilityPlanBodySchema = z.strictObject({
  planId: recordIdSchema,
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  sourceCommit: fullShaSchema,
  targetSourceCommit: fullShaSchema,
  baseRevision: revisionSchema,
  targetRevision: revisionSchema,
  steps: uniqueArray(MigrationCompatibilityStepSchema).min(1).max(128),
  rollbackWindow: RollbackWindowSchema
});

export const MigrationCompatibilityPlanSchema = z.strictObject({
  "$schema": z.string().max(512).optional(), schemaVersion: z.literal(1), plan: MigrationCompatibilityPlanBodySchema
}).meta({ $id: "https://schemas.k-nex.dev/migration-compatibility-plan/v1.json", title: "K-Nex Migration Compatibility Plan v1" });

const compositionEvidenceSchema = z.strictObject({
  applicationManifestDigest: digestSchema,
  lockfileDigest: digestSchema,
  resolvedGraphDigest: digestSchema,
  generatedRegistriesDigest: digestSchema,
  packageClosureDigest: digestSchema,
  migrationPlanDigest: digestSchema
});

export const StaticCompositionChangePlanSchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  planId: recordIdSchema,
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  deliveryClass: z.literal("platform-plugin"),
  plugin: z.strictObject({ id: PluginIdSchema, version: ExactSemverSchema, releaseManifestDigest: digestSchema }),
  authority: z.strictObject({ identity: authorityIdentitySchema, requestDigest: digestSchema }),
  base: z.strictObject({ sourceCommit: fullShaSchema, composition: compositionEvidenceSchema }),
  target: z.strictObject({ sourceCommit: fullShaSchema, composition: compositionEvidenceSchema, applicationSubjectDigest: digestSchema, imageSubjectDigest: digestSchema }),
  migration: MigrationCompatibilityPlanBodySchema,
  status: z.literal("source-change-ready")
}).meta({ $id: "https://schemas.k-nex.dev/static-composition-change-plan/v1.json", title: "K-Nex Static Composition Change Plan v1" });

const buildAuthoritySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("github-hosted"), repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u), workflowPath: z.string().regex(/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/u).max(256), ref: z.literal("source-commit") }),
  z.strictObject({ kind: z.literal("self-hosted-trusted"), builderIdentity: authorityIdentitySchema, trustPolicyDigest: digestSchema, ref: z.literal("source-commit") })
]);

export const TrustedApplicationBuildEvidenceSchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  sourceCommit: fullShaSchema,
  authority: buildAuthoritySchema,
  composition: compositionEvidenceSchema,
  sbomDigest: digestSchema,
  provenanceDigest: digestSchema,
  applicationSubject: z.strictObject({ name: z.string().min(1).max(240), digest: digestSchema }),
  imageSubject: z.strictObject({ repository: z.string().regex(/^[A-Za-z0-9._/-]+$/u).max(240), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u) }),
  signature: z.strictObject({ algorithm: z.literal("ed25519"), keyId: authorityIdentitySchema, value: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u) })
}).meta({ $id: "https://schemas.k-nex.dev/trusted-application-build-evidence/v1.json", title: "K-Nex Trusted Application Build Evidence v1" });

export const WorkerGenerationFenceSchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  activeExecutionGeneration: recordIdSchema,
  fencingToken: z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER),
  lease: z.strictObject({ owner: authorityIdentitySchema, expiresAt: MillisecondTimestampSchema }),
  promotionRevision: revisionSchema,
  mode: z.literal("active")
}).meta({ $id: "https://schemas.k-nex.dev/worker-generation-fence/v1.json", title: "K-Nex Worker Generation Fence v1" });

const staticDeploymentReceiptBase = {
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  receiptId: recordIdSchema,
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  activeGenerationId: recordIdSchema,
  sourceCommit: fullShaSchema,
  compositionChangePlanDigest: digestSchema,
  buildEvidenceDigest: digestSchema,
  applicationDigest: digestSchema,
  imageDigest: digestSchema,
  migrationRevision: revisionSchema,
  workerFencingToken: z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER),
  promotionRevision: revisionSchema,
  revisionBefore: revisionSchema,
  revisionAfter: revisionSchema,
  occurredAt: MillisecondTimestampSchema
} as const;

export const StaticDeploymentReceiptSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...staticDeploymentReceiptBase,
    operation: z.literal("reserve-rollback-retirement"),
    retiredGenerationId: recordIdSchema,
    rollbackWindow: z.strictObject({ state: z.literal("retirement-reserved"), windowId: recordIdSchema, closesAt: MillisecondTimestampSchema, reservedAt: MillisecondTimestampSchema }),
    contractCleanup: z.literal("blocked")
  }),
  z.strictObject({
    ...staticDeploymentReceiptBase,
    operation: z.enum(["promote", "rollback"]),
    previousGenerationId: recordIdSchema,
    rollbackWindow: z.strictObject({ state: z.literal("open"), windowId: recordIdSchema, closesAt: MillisecondTimestampSchema }),
    contractCleanup: z.literal("blocked")
  }),
  z.strictObject({
    ...staticDeploymentReceiptBase,
    operation: z.literal("close-rollback"),
    retiredGenerationId: recordIdSchema,
    rollbackWindow: z.strictObject({ state: z.literal("closed"), windowId: recordIdSchema, closedAt: MillisecondTimestampSchema }),
    contractCleanup: z.literal("eligible")
  })
]).meta({ $id: "https://schemas.k-nex.dev/static-deployment-receipt/v1.json", title: "K-Nex Static Deployment Receipt v1" });

export type ExtensionDeliveryClass = z.infer<typeof ExtensionDeliveryClassSchema>;
export type ExtensionIdentity = z.infer<typeof ExtensionIdentitySchema>;
export type ExtensionCapabilityRequest = z.infer<typeof ExtensionCapabilityRequestSchema>;
export type ExtensionResourceBudget = z.infer<typeof ExtensionResourceBudgetSchema>;
export type HotApplicationManifest = z.infer<typeof HotApplicationManifestSchema>;
export type ThemeSkinManifest = z.infer<typeof ThemeSkinManifestSchema>;
export type ExtensionBundleManifest = z.infer<typeof ExtensionBundleManifestSchema>;
export type ExtensionInstallPlan = z.infer<typeof ExtensionInstallPlanSchema>;
export type ExtensionInstallReceipt = z.infer<typeof ExtensionInstallReceiptSchema>;
export type ExtensionGeneration = z.infer<typeof ExtensionGenerationSchema>;
export type ZeroDowntimeEligibility = z.infer<typeof ZeroDowntimeEligibilitySchema>;
export type RemoteUiIsolationProfile = z.infer<typeof RemoteUiIsolationProfileSchema>;
export type RunnerIsolationProfile = z.infer<typeof RunnerIsolationProfileSchema>;
export type StaticCompositionChangePlan = z.infer<typeof StaticCompositionChangePlanSchema>;
export type TrustedApplicationBuildEvidence = z.infer<typeof TrustedApplicationBuildEvidenceSchema>;
export type MigrationCompatibilityPlan = z.infer<typeof MigrationCompatibilityPlanSchema>;
export type WorkerGenerationFence = z.infer<typeof WorkerGenerationFenceSchema>;
export type StaticDeploymentReceipt = z.infer<typeof StaticDeploymentReceiptSchema>;
