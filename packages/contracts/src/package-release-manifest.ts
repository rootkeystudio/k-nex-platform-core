import * as z from "zod";

import { SupportedFrameworkTupleSchema } from "./framework-tuple.js";
import { ExactSemverSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

const packageNamePattern = /^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/;

export const ReleasePackageSchema = z.strictObject({
  package: z.string().regex(packageNamePattern),
  version: ExactSemverSchema,
  role: z.enum(["core", "plugin", "provider", "builder", "theme", "tooling"]),
  integrity: z.string().regex(sha512IntegrityPattern),
  peerCompatibility: SupportedFrameworkTupleSchema
});

export const PackageReleaseManifestSchema = z.strictObject({
  "$schema": z.string().optional(),
  schemaVersion: z.literal(1),
  release: z.strictObject({
    version: ExactSemverSchema,
    channel: z.literal("pre-v1"),
    versioningPolicy: z.literal("semver-pre-v1"),
    compatibilityPolicy: z.literal("exact-framework-tuple")
  }),
  framework: SupportedFrameworkTupleSchema,
  packages: z.array(ReleasePackageSchema).min(1),
  supportWindow: z.strictObject({
    policy: z.literal("current-and-one-prior-minor"),
    supportedReleases: uniqueArray(ExactSemverSchema).min(1).max(2),
    securityFixes: z.literal("all-supported-releases")
  })
}).superRefine((manifest, context) => {
  const packageNames = new Set<string>();
  for (const [index, entry] of manifest.packages.entries()) {
    if (packageNames.has(entry.package)) context.addIssue({ code: "custom", path: ["packages", index, "package"], message: `Release package is duplicated: ${entry.package}.` });
    packageNames.add(entry.package);
    if (JSON.stringify(entry.peerCompatibility) !== JSON.stringify(manifest.framework)) context.addIssue({ code: "custom", path: ["packages", index, "peerCompatibility"], message: "Release package peer compatibility must equal the exact release framework tuple." });
  }
  const [current, prior] = manifest.supportWindow.supportedReleases;
  if (current !== manifest.release.version) context.addIssue({ code: "custom", path: ["supportWindow", "supportedReleases", 0], message: "The current supported release must equal release.version." });
  if (prior !== undefined) {
    const [currentMajor, currentMinor] = current!.split(".").map(Number);
    const [priorMajor, priorMinor] = prior.split(".").map(Number);
    if (priorMajor !== currentMajor || priorMinor !== currentMinor! - 1) context.addIssue({ code: "custom", path: ["supportWindow", "supportedReleases", 1], message: "The supported prior release must be from the immediately preceding minor in the same major line." });
  }
}).meta({
  $id: "https://schemas.k-nex.dev/package-release-manifest/v1.json",
  title: "K-Nex Package Release Manifest v1"
});

export type ReleasePackage = z.infer<typeof ReleasePackageSchema>;
export type PackageReleaseManifest = z.infer<typeof PackageReleaseManifestSchema>;
