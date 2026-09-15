import * as z from "zod";

import { canonicalJson } from "./canonical-json.js";
import { FrameworkTupleSchema } from "./framework-tuple.js";
import { compareExactSemverPrecedence, ExactSemverSchema, PluginIdSchema } from "./identity.js";
import { PackageReleaseManifestSchema, type PackageReleaseManifest } from "./package-release-manifest.js";
import { uniqueArray } from "./schema-helpers.js";

const packageNamePattern = /^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u;
const transitionIdPattern = /^[a-z0-9][a-z0-9._:-]{2,159}$/u;
const reasonCodePattern = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;
const migrationIdSchema = z.string().min(3).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const sha512IntegritySchema = z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/u);
const packageNameSchema = z.string().max(214).regex(packageNamePattern);

const releaseIdentitySchema = z.strictObject({
  release: ExactSemverSchema,
  manifestDigest: sha256DigestSchema
});

const packageEndpointSchema = z.strictObject({
  version: ExactSemverSchema,
  integrity: sha512IntegritySchema
});

const packageIdentitySchema = z.discriminatedUnion("role", [
  z.strictObject({ package: packageNameSchema, role: z.literal("plugin"), pluginId: PluginIdSchema }),
  z.strictObject({ package: packageNameSchema, role: z.enum(["core", "provider", "builder", "theme", "tooling"]) })
]);

const packageTransitionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({ identity: packageIdentitySchema, disposition: z.literal("upgrade"), source: packageEndpointSchema, target: packageEndpointSchema }),
  z.strictObject({ identity: packageIdentitySchema, disposition: z.literal("add-for-generator"), target: packageEndpointSchema }),
  z.strictObject({ identity: packageIdentitySchema, disposition: z.literal("remove"), source: packageEndpointSchema }),
  z.strictObject({ identity: packageIdentitySchema, disposition: z.literal("replacement-required"), source: packageEndpointSchema })
]);

const migrationPhaseSchema = z.enum(["online-expand", "online-backfill", "post-retirement-contract", "offline-required"]);

const revocationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("active") }),
  z.strictObject({
    status: z.literal("revoked"),
    revokedAt: z.iso.datetime({ offset: true }),
    reasonCode: z.string().max(96).regex(reasonCodePattern)
  })
]);

/**
 * Signed, data-only description of one immutable direct platform release hop.
 * Deployment commands, source paths, URLs, credentials, SQL, and executable
 * migration material are deliberately absent from this closed contract.
 */
export const PlatformReleaseTransitionManifestSchema = z.strictObject({
  "$schema": z.literal("../../schemas/platform-release-transition-manifest.v1.schema.json").optional(),
  schemaVersion: z.literal(1),
  transitionId: z.string().max(160).regex(transitionIdPattern),
  source: releaseIdentitySchema,
  target: releaseIdentitySchema,
  directPredecessors: uniqueArray(ExactSemverSchema).length(1),
  packages: z.array(packageTransitionSchema).min(1).max(256),
  generator: z.strictObject({
    package: packageNameSchema,
    sourceVersion: ExactSemverSchema,
    targetVersion: ExactSemverSchema,
    sourceSchemaVersion: z.number().int().positive().max(65_535),
    targetSchemaVersion: z.number().int().positive().max(65_535),
    managedOutputContractDigest: sha256DigestSchema
  }),
  applicationManifest: z.strictObject({
    sourceSchemaVersion: z.number().int().positive().max(65_535),
    targetSchemaVersion: z.number().int().positive().max(65_535)
  }),
  framework: z.strictObject({ source: FrameworkTupleSchema, target: FrameworkTupleSchema }),
  migrations: z.strictObject({
    graphDigest: sha256DigestSchema,
    phases: uniqueArray(migrationPhaseSchema).min(1).max(4),
    steps: z.array(z.strictObject({ id: migrationIdSchema, phase: migrationPhaseSchema })).min(1).max(256),
    deliveryClassification: z.enum(["zero-downtime-eligible", "maintenance-required"]),
    rollbackClassification: z.enum(["source-generation", "source-restore-required"])
  }),
  compatibility: z.strictObject({
    storedDocuments: z.enum(["compatible", "migration-required", "unsupported"]),
    settings: z.enum(["compatible", "migration-required", "unsupported"]),
    themeProfiles: z.enum(["compatible", "migration-required", "unsupported"]),
    hotApplicationHostAbiFrom: ExactSemverSchema,
    hotApplicationHostAbiTo: ExactSemverSchema,
    themeSkinHostAbiFrom: ExactSemverSchema,
    themeSkinHostAbiTo: ExactSemverSchema,
    catalogDigest: sha256DigestSchema
  }),
  protection: z.strictObject({
    preUpgradeBackup: z.enum(["fresh-required", "restore-verified-within-window"]),
    maximumBackupAgeSeconds: z.number().int().positive().max(2_592_000),
    cleanRestoreDrill: z.enum(["required", "risk-policy"]),
    failureRecovery: z.literal("restore-source-protection-point"),
    postUpgradeBackup: z.literal("required"),
    rollbackWindowSeconds: z.number().int().positive().max(31_536_000)
  }),
  lifecycle: z.strictObject({
    publishedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    support: z.enum(["supported", "security-only"]),
    security: z.enum(["standard", "security-mandated"]),
    revocation: revocationSchema
  })
}).superRefine((manifest, context) => {
  if (compareExactSemverPrecedence(manifest.source.release, manifest.target.release) >= 0) {
    context.addIssue({ code: "custom", path: ["target", "release"], message: "Target release must have greater SemVer precedence than source release." });
  }
  if (manifest.directPredecessors[0] !== manifest.source.release) {
    context.addIssue({ code: "custom", path: ["directPredecessors", 0], message: "A direct transition must name source.release as its only predecessor." });
  }
  if (Date.parse(manifest.lifecycle.expiresAt) <= Date.parse(manifest.lifecycle.publishedAt)) {
    context.addIssue({ code: "custom", path: ["lifecycle", "expiresAt"], message: "Transition expiry must be after publication." });
  }

  const packages = new Set<string>();
  const pluginIds = new Set<string>();
  for (const [index, mapping] of manifest.packages.entries()) {
    if (packages.has(mapping.identity.package)) context.addIssue({ code: "custom", path: ["packages", index, "identity", "package"], message: `Transition package is duplicated: ${mapping.identity.package}.` });
    packages.add(mapping.identity.package);
    if ("source" in mapping && mapping.source.version !== manifest.source.release) context.addIssue({ code: "custom", path: ["packages", index, "source", "version"], message: "First-party source package version must equal source.release." });
    if ("target" in mapping && mapping.target.version !== manifest.target.release) context.addIssue({ code: "custom", path: ["packages", index, "target", "version"], message: "First-party target package version must equal target.release." });
    if (mapping.identity.role === "plugin") {
      if (pluginIds.has(mapping.identity.pluginId)) context.addIssue({ code: "custom", path: ["packages", index, "identity", "pluginId"], message: `Transition plugin is duplicated: ${mapping.identity.pluginId}.` });
      pluginIds.add(mapping.identity.pluginId);
    }
  }

  const generatorMapping = manifest.packages.find((mapping) => mapping.identity.package === manifest.generator.package);
  if (generatorMapping === undefined || generatorMapping.disposition !== "upgrade" || generatorMapping.source.version !== manifest.generator.sourceVersion || generatorMapping.target.version !== manifest.generator.targetVersion) {
    context.addIssue({ code: "custom", path: ["generator"], message: "Generator must reconcile to one exact package transition mapping." });
  }
  if (manifest.framework.source.core !== manifest.source.release || manifest.framework.target.core !== manifest.target.release) {
    context.addIssue({ code: "custom", path: ["framework"], message: "Framework core versions must equal their source and target train releases." });
  }
  if (manifest.migrations.phases.includes("offline-required") && manifest.migrations.deliveryClassification !== "maintenance-required") {
    context.addIssue({ code: "custom", path: ["migrations", "deliveryClassification"], message: "Offline-required migration work must be maintenance-required." });
  }
  const phaseOrder = ["online-expand", "online-backfill", "post-retirement-contract", "offline-required"] as const;
  for (let index = 1; index < manifest.migrations.phases.length; index += 1) {
    if (phaseOrder.indexOf(manifest.migrations.phases[index]!) <= phaseOrder.indexOf(manifest.migrations.phases[index - 1]!)) {
      context.addIssue({ code: "custom", path: ["migrations", "phases", index], message: "Migration phases must use canonical execution order." });
    }
  }
  const migrationIds = new Set<string>();
  for (const [index, step] of manifest.migrations.steps.entries()) {
    if (migrationIds.has(step.id)) context.addIssue({ code: "custom", path: ["migrations", "steps", index, "id"], message: `Migration step is duplicated: ${step.id}.` });
    migrationIds.add(step.id);
  }
  const declaredPhases = [...new Set(manifest.migrations.steps.map(({ phase }) => phase))];
  if (canonicalJson(declaredPhases) !== canonicalJson(manifest.migrations.phases)) {
    context.addIssue({ code: "custom", path: ["migrations", "phases"], message: "Migration phases must equal the ordered phases used by migration steps." });
  }
  if (manifest.migrations.rollbackClassification === "source-restore-required" && manifest.protection.cleanRestoreDrill !== "required") {
    context.addIssue({ code: "custom", path: ["protection", "cleanRestoreDrill"], message: "Restore-required rollback requires a clean restore drill." });
  }
  const frameworkChanged = canonicalJson(manifest.framework.source) !== canonicalJson(manifest.framework.target);
  const schemaChanged = manifest.generator.sourceSchemaVersion !== manifest.generator.targetSchemaVersion || manifest.applicationManifest.sourceSchemaVersion !== manifest.applicationManifest.targetSchemaVersion;
  const dataChanged = manifest.compatibility.storedDocuments === "migration-required" || manifest.compatibility.settings === "migration-required" || manifest.compatibility.themeProfiles === "migration-required";
  const destructive = manifest.migrations.phases.includes("post-retirement-contract") || manifest.migrations.phases.includes("offline-required");
  const highRisk = frameworkChanged || schemaChanged || dataChanged || destructive || manifest.migrations.deliveryClassification === "maintenance-required";
  if (highRisk && manifest.protection.preUpgradeBackup !== "fresh-required") {
    context.addIssue({ code: "custom", path: ["protection", "preUpgradeBackup"], message: "Framework, schema, data, destructive, offline, or maintenance transitions require a fresh pre-upgrade backup." });
  }
  if (highRisk && (manifest.protection.cleanRestoreDrill !== "required" || manifest.migrations.rollbackClassification !== "source-restore-required")) {
    context.addIssue({ code: "custom", path: ["protection"], message: "Maintenance and high-risk transitions require a clean restore drill and source-restore-required rollback." });
  }
  if (manifest.lifecycle.revocation.status === "revoked" && Date.parse(manifest.lifecycle.revocation.revokedAt) < Date.parse(manifest.lifecycle.publishedAt)) {
    context.addIssue({ code: "custom", path: ["lifecycle", "revocation", "revokedAt"], message: "Revocation cannot predate publication." });
  }
}).meta({
  $id: "https://schemas.k-nex.dev/platform-release-transition-manifest/v1.json",
  title: "K-Nex Platform Release Transition Manifest v1"
});

export type PlatformReleaseTransitionManifest = z.infer<typeof PlatformReleaseTransitionManifestSchema>;

export interface PlatformReleaseTransitionEndpoint {
  manifest: PackageReleaseManifest;
  digest: string;
}

/** Exact canonical bytes which a transition-manifest digest or signature covers. */
export function canonicalPlatformReleaseTransitionManifest(value: unknown): string {
  return canonicalJson(PlatformReleaseTransitionManifestSchema.parse(value));
}

/**
 * Cross-checks the transition against two already verified release-manifest
 * endpoints. Signature verification remains an injected authority concern.
 */
export function validatePlatformReleaseTransition(
  value: unknown,
  sourceEndpoint: PlatformReleaseTransitionEndpoint,
  targetEndpoint: PlatformReleaseTransitionEndpoint,
  evaluatedAt: string
): PlatformReleaseTransitionManifest {
  const transition = PlatformReleaseTransitionManifestSchema.parse(value);
  const evaluationTime = z.iso.datetime({ offset: true }).parse(evaluatedAt);
  const sourceManifest = PackageReleaseManifestSchema.parse(sourceEndpoint.manifest);
  const targetManifest = PackageReleaseManifestSchema.parse(targetEndpoint.manifest);
  const errors: string[] = [];

  if (transition.source.release !== sourceManifest.release.version || transition.source.manifestDigest !== sourceEndpoint.digest) errors.push("source release identity or manifest digest does not match the verified source endpoint");
  if (transition.target.release !== targetManifest.release.version || transition.target.manifestDigest !== targetEndpoint.digest) errors.push("target release identity or manifest digest does not match the verified target endpoint");
  if (transition.lifecycle.revocation.status === "revoked") errors.push("transition is revoked");
  if (Date.parse(evaluationTime) < Date.parse(transition.lifecycle.publishedAt)) errors.push("transition is not yet published");
  if (Date.parse(evaluationTime) >= Date.parse(transition.lifecycle.expiresAt)) errors.push("transition is expired");
  if (canonicalJson(transition.framework.source) !== canonicalJson(sourceManifest.framework)) errors.push("source framework tuple does not match the verified source release");
  if (canonicalJson(transition.framework.target) !== canonicalJson(targetManifest.framework)) errors.push("target framework tuple does not match the verified target release");

  const sourcePackages = new Map(sourceManifest.packages.map((entry) => [entry.package, entry]));
  const targetPackages = new Map(targetManifest.packages.map((entry) => [entry.package, entry]));
  const mappings = new Map(transition.packages.map((entry) => [entry.identity.package, entry]));
  const packageNames = new Set([...sourcePackages.keys(), ...targetPackages.keys()]);
  for (const packageName of packageNames) {
    const source = sourcePackages.get(packageName);
    const target = targetPackages.get(packageName);
    const mapping = mappings.get(packageName);
    if (mapping === undefined) {
      errors.push(`package ${packageName} is missing from the transition mapping`);
      continue;
    }
    const expectedDisposition = source !== undefined && target !== undefined ? "upgrade" : source === undefined ? "add-for-generator" : undefined;
    if (expectedDisposition === undefined) {
      if (mapping.disposition !== "remove" && mapping.disposition !== "replacement-required") errors.push(`source-only package ${packageName} must be remove or replacement-required`);
    } else if (mapping.disposition !== expectedDisposition) errors.push(`package ${packageName} disposition must be ${expectedDisposition}`);
    if (source !== undefined && (!("source" in mapping) || mapping.identity.role !== source.role || mapping.source.version !== source.version || mapping.source.integrity !== source.integrity)) {
      errors.push(`package ${packageName} mapping does not equal the exact source and target release entries`);
    }
    if (target !== undefined && (!("target" in mapping) || mapping.identity.role !== target.role || mapping.target.version !== target.version || mapping.target.integrity !== target.integrity)) errors.push(`package ${packageName} mapping does not equal the exact source and target release entries`);
  }
  for (const packageName of mappings.keys()) if (!packageNames.has(packageName)) errors.push(`package ${packageName} is not present in either verified release closure`);

  if (errors.length > 0) throw new TypeError(`Platform release transition does not reconcile: ${errors.join("; ")}.`);
  return transition;
}
