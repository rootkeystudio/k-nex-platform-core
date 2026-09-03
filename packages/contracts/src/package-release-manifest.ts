import * as z from "zod";

import { SupportedFrameworkTupleSchema } from "./framework-tuple.js";
import { ExactSemverSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

const packageNamePattern = /^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/;
const sha256DigestPattern = /^sha256:[0-9a-f]{64}$/;

export const ReleasePackageSchema = z.strictObject({
  package: z.string().regex(packageNamePattern),
  version: ExactSemverSchema,
  role: z.enum(["core", "plugin", "provider", "builder", "theme", "tooling"]),
  integrity: z.string().regex(sha512IntegrityPattern),
  peerCompatibility: SupportedFrameworkTupleSchema
});

const factoryLockTemplate = <Theme extends "minimal" | "neobrutalism">(theme: Theme) => z.strictObject({
  preset: z.literal("sales-reference"), theme: z.literal(theme), digest: z.string().regex(sha256DigestPattern)
});

export const FactoryLockTemplateSchema = z.discriminatedUnion("theme", [factoryLockTemplate("minimal"), factoryLockTemplate("neobrutalism")]);

export const PackageReleaseManifestSchema = z.strictObject({
  "$schema": z.string().optional(),
  schemaVersion: z.literal(1),
  release: z.strictObject({
    version: ExactSemverSchema,
    channel: z.literal("current"),
    versioningPolicy: z.literal("semver-v1"),
    compatibilityPolicy: z.literal("exact-framework-tuple")
  }),
  framework: SupportedFrameworkTupleSchema,
  packages: z.array(ReleasePackageSchema).min(1),
  factoryLockTemplates: z.strictObject({
    minimal: factoryLockTemplate("minimal"),
    neobrutalism: factoryLockTemplate("neobrutalism")
  }),
  supportWindow: z.strictObject({
    policy: z.literal("single-current-release"),
    supportedReleases: uniqueArray(ExactSemverSchema).length(1),
    securityFixes: z.literal("all-supported-releases")
  })
}).superRefine((manifest, context) => {
  const packageNames = new Set<string>();
  for (const [index, entry] of manifest.packages.entries()) {
    if (packageNames.has(entry.package)) context.addIssue({ code: "custom", path: ["packages", index, "package"], message: `Release package is duplicated: ${entry.package}.` });
    packageNames.add(entry.package);
    if (JSON.stringify(entry.peerCompatibility) !== JSON.stringify(manifest.framework)) context.addIssue({ code: "custom", path: ["packages", index, "peerCompatibility"], message: "Release package peer compatibility must equal the exact release framework tuple." });
  }
  const [current] = manifest.supportWindow.supportedReleases;
  if (current !== manifest.release.version) context.addIssue({ code: "custom", path: ["supportWindow", "supportedReleases", 0], message: "The current supported release must equal release.version." });
}).meta({
  $id: "https://schemas.k-nex.dev/package-release-manifest/v1.json",
  title: "K-Nex Package Release Manifest v1"
});

export type ReleasePackage = z.infer<typeof ReleasePackageSchema>;
export type PackageReleaseManifest = z.infer<typeof PackageReleaseManifestSchema>;

declare const verifiedPackageReleaseManifest: unique symbol;
export interface VerifiedPackageReleaseManifest {
  readonly [verifiedPackageReleaseManifest]: true;
}

export interface PackageReleaseManifestAuthority<Attestation = unknown> {
  verify(manifest: PackageReleaseManifest, attestation: unknown): Promise<VerifiedPackageReleaseManifest>;
  read(token: VerifiedPackageReleaseManifest): Readonly<{ manifest: PackageReleaseManifest; digest: string; attestation: Attestation }>;
}
