import * as z from "zod";

import { ExactSemverSchema, PluginIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const FullShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);

export const RuntimeInventorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  applicationId: z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u),
  repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u),
  environment: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u),
  platformRelease: ExactSemverSchema,
  observedAt: z.iso.datetime({ offset: true }),
  artifactDigest: DigestSchema,
  releaseEvidence: z.strictObject({
    sourceCommit: FullShaSchema,
    workflowIdentity: z.string().min(1).max(512),
    manifestDigest: DigestSchema,
    lockfileDigest: DigestSchema,
    resolvedGraphDigest: DigestSchema,
    frameworkDigest: DigestSchema,
    sbomDigest: DigestSchema,
    provenanceDigest: DigestSchema
  }),
  packages: z.array(z.strictObject({
    package: z.string().regex(/^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u),
    version: ExactSemverSchema,
    integrity: z.string().regex(/^(?:sha256:[0-9a-f]{64}|sha512-[A-Za-z0-9+/]{86}==)$/u)
  })).min(1),
  plugins: z.array(z.strictObject({
    id: PluginIdSchema,
    package: z.string(),
    version: ExactSemverSchema,
    enabled: z.boolean()
  })),
  migrationRevision: z.number().int().nonnegative(),
  settings: z.array(z.strictObject({ id: z.string(), schemaVersion: z.number().int().positive(), revision: z.number().int().positive() })),
  templates: z.array(z.strictObject({ id: z.string(), templateVersion: z.number().int().positive(), revision: z.number().int().positive() })),
  health: z.strictObject({
    status: z.enum(["ready", "not-ready"]),
    checks: uniqueArray(z.string().min(1)).min(1)
  })
}).superRefine((inventory, context) => {
  const packages = new Set(inventory.packages.map((entry) => `${entry.package}@${entry.version}`));
  if (packages.size !== inventory.packages.length) context.addIssue({ code: "custom", path: ["packages"], message: "Runtime packages must be unique." });
  for (const [index, plugin] of inventory.plugins.entries()) {
    if (!packages.has(`${plugin.package}@${plugin.version}`)) context.addIssue({ code: "custom", path: ["plugins", index], message: "Runtime plugin must reconcile to exact package inventory." });
  }
  if (!inventory.releaseEvidence.workflowIdentity.endsWith(`@${inventory.releaseEvidence.sourceCommit}`)) {
    context.addIssue({ code: "custom", path: ["releaseEvidence", "workflowIdentity"], message: "Runtime workflow identity must be pinned to the observed source commit." });
  }
}).meta({ $id: "https://schemas.k-nex.dev/runtime-inventory/v1.json", title: "K-Nex Runtime Inventory v1" });

export const DeploymentReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  deploymentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/u),
  applicationId: z.string(),
  environment: z.string(),
  deployedAt: z.iso.datetime({ offset: true }),
  approvedBy: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("actor"), id: z.string().min(1).max(160), approvalId: z.string().min(1).max(160) }),
    z.strictObject({ kind: z.literal("workflow"), identity: z.string().min(1).max(512) })
  ]),
  artifactDigest: DigestSchema,
  inventoryDigest: DigestSchema,
  migrationRevision: z.number().int().nonnegative(),
  smoke: z.strictObject({ status: z.enum(["passed", "failed"]), checks: uniqueArray(z.string().min(1)).min(1) }),
  readiness: z.enum(["ready", "not-ready"])
}).meta({ $id: "https://schemas.k-nex.dev/deployment-receipt/v1.json", title: "K-Nex Deployment Receipt v1" });

export type RuntimeInventory = z.infer<typeof RuntimeInventorySchema>;
export type DeploymentReceipt = z.infer<typeof DeploymentReceiptSchema>;
