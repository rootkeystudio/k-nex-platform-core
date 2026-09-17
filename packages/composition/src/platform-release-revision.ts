/**
 * Every platform release contributes exactly one release-revision step, and
 * `k_nex_release_revision` records which one a database has reached. A fresh
 * install gets there through the bootstrap migration; an upgraded install gets
 * there through that release's own release-revision migration, because the
 * bootstrap it already ran is append-only and still names the release it was
 * generated for. Readiness compares against this table, so without such a step
 * an upgraded database keeps the predecessor's identity and can never report
 * ready. A new release appends one entry here.
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
 * cannot be renamed; later releases record the release they advanced to.
 */
export function platformReleaseIdentity(version: string): string {
  platformReleaseRevision(version);
  return version === "1.0.0" ? "platform-1.0.0-bootstrap" : `platform-${version}-release`;
}

/** Declared release order, so a release can name the one it upgrades from. */
const platformReleaseChain = Object.freeze(["1.0.0", "1.1.0"] as const);

export function platformPredecessorRelease(version: string): string | undefined {
  const index = platformReleaseChain.indexOf(version as (typeof platformReleaseChain)[number]);
  if (index < 0) throw new Error(`Platform release ${version} is outside the declared release chain.`);
  return index === 0 ? undefined : platformReleaseChain[index - 1];
}

/**
 * The exact database states from which this release may be reached: a fresh
 * install of this release, which its own bootstrap migration wrote, or a
 * database still recording the release immediately before it. Anything else -
 * a zero revision, an unknown identity, a skipped release, a missing row - is
 * not a supported predecessor, and must be refused before the target
 * transition mutates anything rather than normalized after it.
 */
/**
 * A fresh install records the release it is, directly: its bootstrap migration
 * writes that release's revision and identity, so it never walks the historical
 * transition steps of releases it was never on. Those steps exist for one
 * database state only - the release immediately before them - which is the
 * exact tuple returned here, and which only the upgrade coordinator may
 * execute. Returning `undefined` means the release has no predecessor to
 * transition from.
 */
export function platformTransitionSource(version: string): {
  readonly predecessorRevision: number;
  readonly revision: number;
  readonly identity: string;
} | undefined {
  const predecessor = platformPredecessorRelease(version);
  if (predecessor === undefined) return undefined;
  // A bootstrap writes predecessor revision 0 and no release advances past its
  // own step, so the source chain field is 0. Binding it matters: a row whose
  // chain field is impossible is not the attested source, and overwriting it
  // would erase that evidence.
  return Object.freeze({ predecessorRevision: 0, revision: platformReleaseRevision(predecessor), identity: platformReleaseIdentity(predecessor) });
}
