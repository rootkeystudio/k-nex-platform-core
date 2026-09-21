/**
 * A release is one exact database state, not a history. `k_nex_release_revision`
 * records which release a database has reached, and that record must be
 * identical whether the database was freshly installed or upgraded: readiness,
 * provenance, and the next release's transition all name the same tuple. A
 * lineage-dependent record would make one of those two valid histories
 * unrecognisable to the next hop.
 */
const platformReleaseRevisions = Object.freeze({ "1.0.0": 1, "1.1.0": 2 } as const);

export function platformReleaseRevision(version: string): number {
  const revision = (platformReleaseRevisions as Readonly<Record<string, number>>)[version];
  if (revision === undefined) throw new Error(`No release revision is declared for platform release ${version}.`);
  return revision;
}

/**
 * The identity a migrated database carries once it has reached a release. 1.0.0
 * is the frozen bootstrap identity that release's own factory wrote, so it
 * cannot be renamed; later releases record the release they completed.
 */
export function platformReleaseIdentity(version: string): string {
  platformReleaseRevision(version);
  return version === "1.0.0" ? "platform-1.0.0-bootstrap" : `platform-${version}-release`;
}

/**
 * The state a fresh installation carries while its migration set is still
 * running. The release identity is a completion receipt, so it is not written
 * until the exact target set is durably applied; until then the database says
 * what it is doing rather than claiming a release it has not finished.
 */
export function platformInstallingState(version: string): { readonly predecessorRevision: number; readonly revision: number; readonly identity: string } {
  platformReleaseRevision(version);
  return Object.freeze({ predecessorRevision: 0, revision: 0, identity: `platform-${version}-installing` });
}

/** The one canonical record of a database that has reached this release. */
export function platformReleaseState(version: string): { readonly predecessorRevision: number; readonly revision: number; readonly identity: string } {
  return Object.freeze({ predecessorRevision: 0, revision: platformReleaseRevision(version), identity: platformReleaseIdentity(version) });
}

/** Declared release order, so a release can name the one it upgrades from. */
const platformReleaseChain = Object.freeze(["1.0.0", "1.1.0"] as const);

export function platformPredecessorRelease(version: string): string | undefined {
  const index = platformReleaseChain.indexOf(version as (typeof platformReleaseChain)[number]);
  if (index < 0) throw new Error(`Platform release ${version} is outside the declared release chain.`);
  return index === 0 ? undefined : platformReleaseChain[index - 1];
}

/**
 * The exact state a transition to this release may start from: the canonical
 * record of the release immediately before it, whatever history produced that
 * record. Only the upgrade coordinator may execute that transition.
 */
export function platformTransitionSource(version: string): { readonly predecessorRevision: number; readonly revision: number; readonly identity: string } | undefined {
  const predecessor = platformPredecessorRelease(version);
  return predecessor === undefined ? undefined : platformReleaseState(predecessor);
}
