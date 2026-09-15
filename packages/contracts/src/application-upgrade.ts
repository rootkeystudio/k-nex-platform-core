import * as z from "zod";

import { canonicalJson, sha256CanonicalJson } from "./canonical-json.js";
import { ExactSemverSchema, PluginIdSchema } from "./identity.js";

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const sourceCommitSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const packageNameSchema = z.string().max(214).regex(/^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u);
const generatorIdSchema = z.string().min(3).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const relativePathSchema = z.string().min(1).max(512).superRefine((path, context) => {
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path) || path.includes("\\") || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") || /[\u0000-\u001f\u007f-\u009f]/u.test(path)) {
    context.addIssue({ code: "custom", message: "Upgrade paths must be normalized repository-relative POSIX paths." });
  }
});

const releaseControlPaths = new Set([
  "k-nex.app.json", "package.json", "pnpm-lock.yaml", ".k-nex/release-lock.json", ".k-nex/generated-files.json"
]);
const isReleaseControlPath = (path: string) => releaseControlPaths.has(path) || path.startsWith(".k-nex/packages/") || path.startsWith(".k-nex/upgrades/");

const producerSchema = z.strictObject({ package: packageNameSchema, version: ExactSemverSchema, generatorId: generatorIdSchema });
export const GeneratedFileRecordSchema = z.strictObject({
  path: relativePathSchema,
  mode: z.enum(["managed", "append-only", "template"]),
  producer: producerSchema,
  digest: digestSchema
});

export const GeneratedFileOwnershipManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  applicationId: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u),
  files: z.array(GeneratedFileRecordSchema).max(10_000)
}).superRefine((manifest, context) => {
  let prior = "";
  const paths = new Set<string>();
  for (const [index, file] of manifest.files.entries()) {
    if (paths.has(file.path)) context.addIssue({ code: "custom", path: ["files", index, "path"], message: `Generated ownership path is duplicated: ${file.path}.` });
    if (file.path <= prior) context.addIssue({ code: "custom", path: ["files", index, "path"], message: "Generated ownership files must be sorted by path." });
    if (isReleaseControlPath(file.path)) context.addIssue({ code: "custom", path: ["files", index, "path"], message: "Release-control paths cannot appear in generated ownership." });
    paths.add(file.path);
    prior = file.path;
  }
}).meta({ $id: "https://schemas.k-nex.dev/generated-file-ownership-manifest/v1.json", title: "K-Nex Generated File Ownership Manifest v1" });

const releasePackageSchema = z.strictObject({
  package: packageNameSchema,
  version: ExactSemverSchema,
  role: z.enum(["core", "plugin", "provider", "builder", "theme", "tooling"]),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/u)
});
const releasePluginSchema = z.strictObject({ id: PluginIdSchema, package: packageNameSchema, version: ExactSemverSchema, integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/u) });

export const ApplicationReleaseLockSchema = z.strictObject({
  schemaVersion: z.literal(1),
  applicationId: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u),
  platformRelease: ExactSemverSchema,
  releaseManifestDigest: digestSchema,
  frameworkTupleDigest: digestSchema,
  packages: z.array(releasePackageSchema).min(1).max(256),
  plugins: z.array(releasePluginSchema).max(128),
  generator: z.strictObject({ package: packageNameSchema, version: ExactSemverSchema, schemaVersion: z.number().int().positive().max(65_535), generatorId: generatorIdSchema }),
  sourceOwnershipDigest: digestSchema,
  migrationSetDigest: digestSchema,
  transitionChain: z.array(z.strictObject({ transitionId: generatorIdSchema, sourceRelease: ExactSemverSchema, targetRelease: ExactSemverSchema, manifestDigest: digestSchema })).max(64)
}).superRefine((lock, context) => {
  const checkSortedUnique = (values: readonly string[], path: "packages" | "plugins") => {
    for (let index = 0; index < values.length; index += 1) {
      if (index > 0 && values[index]! <= values[index - 1]!) context.addIssue({ code: "custom", path: [path, index], message: `${path} must be sorted and unique.` });
    }
  };
  checkSortedUnique(lock.packages.map((entry) => entry.package), "packages");
  checkSortedUnique(lock.plugins.map((entry) => entry.id), "plugins");
  const packages = new Map(lock.packages.map((entry) => [entry.package, entry]));
  for (const [index, plugin] of lock.plugins.entries()) {
    const entry = packages.get(plugin.package);
    const expectedRole = plugin.id.startsWith("provider.") ? "provider" : plugin.id.startsWith("builder.") ? "builder" : plugin.id.startsWith("theme.") ? "theme" : "plugin";
    if (entry?.role !== expectedRole || entry.version !== plugin.version || entry.integrity !== plugin.integrity) context.addIssue({ code: "custom", path: ["plugins", index], message: "Release-lock plugin must reconcile to its exact package role and entry." });
  }
  const generator = packages.get(lock.generator.package);
  if (generator === undefined || generator.version !== lock.generator.version) context.addIssue({ code: "custom", path: ["generator"], message: "Release-lock generator must reconcile to its exact package entry." });
  const transitionIds = new Set<string>();
  for (const [index, transition] of lock.transitionChain.entries()) {
    if (transitionIds.has(transition.transitionId)) context.addIssue({ code: "custom", path: ["transitionChain", index, "transitionId"], message: "Release-lock transition identities must be unique." });
    if (index > 0 && lock.transitionChain[index - 1]!.targetRelease !== transition.sourceRelease) context.addIssue({ code: "custom", path: ["transitionChain", index, "sourceRelease"], message: "Release-lock transition lineage must be contiguous." });
    transitionIds.add(transition.transitionId);
  }
  if (lock.transitionChain.length > 0 && lock.transitionChain.at(-1)!.targetRelease !== lock.platformRelease) context.addIssue({ code: "custom", path: ["transitionChain"], message: "Release-lock transition lineage must end at platformRelease." });
}).meta({ $id: "https://schemas.k-nex.dev/application-release-lock/v1.json", title: "K-Nex Application Release Lock v1" });

const operationPathShape = { path: relativePathSchema } as const;
export const ApplicationUpgradeOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...operationPathShape, kind: z.enum(["add", "replace", "append", "conflict"]) }),
  z.strictObject({ ...operationPathShape, kind: z.literal("blocked"), reason: z.literal("managed-delete-reference-proof-required") })
]);

export const ApplicationUpgradePlanEnvelopeV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  planId: z.string().min(3).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/u),
  inputSnapshotDigest: digestSchema,
  targetTransitionManifestDigest: digestSchema,
  operations: z.array(ApplicationUpgradeOperationSchema).max(20_000),
  digest: digestSchema
}).superRefine((plan, context) => {
  let prior = "";
  for (const [index, operation] of plan.operations.entries()) {
    if (operation.path <= prior) context.addIssue({ code: "custom", path: ["operations", index, "path"], message: "Upgrade operations must be sorted and unique by path." });
    prior = operation.path;
  }
  if (plan.digest !== sha256CanonicalJson(applicationUpgradePlanDigestInput(plan))) context.addIssue({ code: "custom", path: ["digest"], message: "Upgrade plan digest does not equal its canonical digest projection." });
}).meta({ $id: "https://schemas.k-nex.dev/application-upgrade-plan-envelope/v1.json", title: "K-Nex Application Upgrade Plan Envelope v1" });

export const PreparationResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  planDigest: digestSchema,
  preparedSourceCommit: sourceCommitSchema,
  preparedReleaseLockDigest: digestSchema,
  resultDigest: digestSchema
}).superRefine((result, context) => {
  if (result.resultDigest !== sha256CanonicalJson(preparationResultDigestInput(result))) context.addIssue({ code: "custom", path: ["resultDigest"], message: "Preparation result digest does not equal its canonical digest projection." });
}).meta({ $id: "https://schemas.k-nex.dev/application-upgrade-preparation-result/v1.json", title: "K-Nex Application Upgrade Preparation Result v1" });

export function applicationUpgradePlanDigestInput(plan: Omit<z.input<typeof ApplicationUpgradePlanEnvelopeV1Schema>, "digest">) {
  return Object.freeze({ schemaVersion: plan.schemaVersion, planId: plan.planId, inputSnapshotDigest: plan.inputSnapshotDigest, targetTransitionManifestDigest: plan.targetTransitionManifestDigest, operations: plan.operations });
}

export function preparationResultDigestInput(result: Omit<z.input<typeof PreparationResultV1Schema>, "resultDigest">) {
  return Object.freeze({ schemaVersion: result.schemaVersion, planDigest: result.planDigest, preparedSourceCommit: result.preparedSourceCommit, preparedReleaseLockDigest: result.preparedReleaseLockDigest });
}

export function canonicalGeneratedFileOwnershipManifest(value: unknown): string { return canonicalJson(GeneratedFileOwnershipManifestSchema.parse(value)); }
export function canonicalApplicationReleaseLock(value: unknown): string { return canonicalJson(ApplicationReleaseLockSchema.parse(value)); }

export type GeneratedFileRecord = z.infer<typeof GeneratedFileRecordSchema>;
export type GeneratedFileOwnershipManifest = z.infer<typeof GeneratedFileOwnershipManifestSchema>;
export type ApplicationReleaseLock = z.infer<typeof ApplicationReleaseLockSchema>;
export type ApplicationUpgradePlanEnvelopeV1 = z.infer<typeof ApplicationUpgradePlanEnvelopeV1Schema>;
export type PreparationResultV1 = z.infer<typeof PreparationResultV1Schema>;
