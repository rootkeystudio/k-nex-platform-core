export const staticAuthorizationBuild = Object.freeze({
  authority: "static-build",
  generationId: "static-module-sales-1",
  version: "1.0.0",
  sourceCommit: "a".repeat(40),
  compositionChangePlanDigest: `sha256:${"c".repeat(64)}`,
  buildEvidenceDigest: `sha256:${"d".repeat(64)}`,
  applicationDigest: "sha256:474447597887192457f6eb22c3e512e3a27294a060798fae58b9f9e6e53a3f2f",
  imageDigest: `sha256:${"e".repeat(64)}`,
  migrationRevision: 1
});

export function installStaticAuthorizationEnvironment() {
  process.env.K_NEX_GENERATION = staticAuthorizationBuild.generationId;
  process.env.K_NEX_SOURCE_COMMIT = staticAuthorizationBuild.sourceCommit;
  process.env.K_NEX_APPLICATION_DIGEST = staticAuthorizationBuild.applicationDigest;
}
