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
