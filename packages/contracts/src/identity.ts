import * as z from "zod";

export const pluginKinds = ["module", "provider", "builder", "theme", "integration", "preset"] as const;
const pluginKindPattern = pluginKinds.join("|");
const hotApplicationKindPattern = "app";
const themeSkinKindPattern = "skin";

export const identityPatterns = {
  plugin: `^(${pluginKindPattern})(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$`,
  hotApplication: `^${hotApplicationKindPattern}(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$`,
  themeSkin: `^${themeSkinKindPattern}(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$`,
  capability: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$",
  resource: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$",
  outputContract: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+@[1-9][0-9]*$"
} as const;

const semverNumericIdentifierPattern = "(?:0|[1-9][0-9]*)";
const semverNonNumericIdentifierPattern = "(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
const semverPrereleaseIdentifierPattern = `(?:${semverNumericIdentifierPattern}|${semverNonNumericIdentifierPattern})`;

export const exactSemverPattern = `^${semverNumericIdentifierPattern}\\.${semverNumericIdentifierPattern}\\.${semverNumericIdentifierPattern}(?:-${semverPrereleaseIdentifierPattern}(?:\\.${semverPrereleaseIdentifierPattern})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`;

export const PluginIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.plugin));
export const HotApplicationIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.hotApplication));
export const ThemeSkinIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.themeSkin));
export const CapabilityIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.capability));
export const ResourceIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.resource));
export const OutputContractIdSchema = z.string().max(160).regex(new RegExp(identityPatterns.outputContract));
export const ExactSemverSchema = z.string().regex(new RegExp(exactSemverPattern));

/**
 * Compares exact-version precedence without converting numeric identifiers to
 * JavaScript numbers. Build metadata is intentionally excluded from precedence.
 */
export function compareExactSemverPrecedence(left: string, right: string): -1 | 0 | 1 {
  const first = parseExactSemver(left);
  const second = parseExactSemver(right);

  for (let index = 0; index < first.core.length; index += 1) {
    const comparison = compareNumericIdentifier(first.core[index]!, second.core[index]!);
    if (comparison !== 0) return comparison;
  }

  if (first.prerelease.length === 0 || second.prerelease.length === 0) {
    return first.prerelease.length === second.prerelease.length ? 0 : first.prerelease.length === 0 ? 1 : -1;
  }

  for (let index = 0; index < Math.max(first.prerelease.length, second.prerelease.length); index += 1) {
    const firstIdentifier = first.prerelease[index];
    const secondIdentifier = second.prerelease[index];
    if (firstIdentifier === undefined || secondIdentifier === undefined) return firstIdentifier === undefined ? -1 : 1;
    if (firstIdentifier === secondIdentifier) continue;
    const firstNumeric = /^\d+$/u.test(firstIdentifier);
    const secondNumeric = /^\d+$/u.test(secondIdentifier);
    if (firstNumeric && secondNumeric) return compareNumericIdentifier(firstIdentifier, secondIdentifier);
    if (firstNumeric !== secondNumeric) return firstNumeric ? -1 : 1;
    return firstIdentifier < secondIdentifier ? -1 : 1;
  }
  return 0;
}

function parseExactSemver(value: string): Readonly<{ core: readonly [string, string, string]; prerelease: readonly string[] }> {
  if (!ExactSemverSchema.safeParse(value).success) throw new TypeError("Exact SemVer value is invalid.");
  const buildIndex = value.indexOf("+");
  const withoutBuild = buildIndex === -1 ? value : value.slice(0, buildIndex);
  const prereleaseIndex = withoutBuild.indexOf("-");
  const core = prereleaseIndex === -1 ? withoutBuild : withoutBuild.slice(0, prereleaseIndex);
  const prerelease = prereleaseIndex === -1 ? undefined : withoutBuild.slice(prereleaseIndex + 1);
  const parts = core.split(".");
  return Object.freeze({ core: [parts[0]!, parts[1]!, parts[2]!], prerelease: Object.freeze(prerelease?.split(".") ?? []) });
}

function compareNumericIdentifier(left: string, right: string): -1 | 0 | 1 {
  const normalizedLeft = left.replace(/^0+(?=\d)/u, "");
  const normalizedRight = right.replace(/^0+(?=\d)/u, "");
  if (normalizedLeft.length !== normalizedRight.length) return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft < normalizedRight ? -1 : 1;
}

export type PluginId = z.infer<typeof PluginIdSchema>;
export type HotApplicationId = z.infer<typeof HotApplicationIdSchema>;
export type ThemeSkinId = z.infer<typeof ThemeSkinIdSchema>;
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export type ResourceId = z.infer<typeof ResourceIdSchema>;
export type OutputContractId = z.infer<typeof OutputContractIdSchema>;
