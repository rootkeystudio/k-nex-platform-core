export const officialFirstPartyPackages = Object.freeze([
  "@k-nex/builder-puck",
  "@k-nex/composition",
  "@k-nex/contracts",
  "@k-nex/extension-bundler",
  "@k-nex/module-sales",
  "@k-nex/payload-adapter",
  "@k-nex/provider-realtime-socketio",
  "@k-nex/runtime",
  "@k-nex/theme-minimal",
  "@k-nex/theme-neobrutalism",
  "@k-nex/ui-builder-blocks",
  "@k-nex/ui-components",
  "@k-nex/ui-data",
  "@k-nex/ui-design-system-contracts",
  "@k-nex/ui-forms",
  "@k-nex/ui-pages",
  "@k-nex/ui-runtime"
]);

export function releaseFrameworkTuple(version, baseFramework) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`Invalid release framework version: ${version}`);
  return Object.freeze({ ...baseFramework, core: version });
}

export function assertExactReleasePackageSet(packages, version) {
  const expected = new Set(officialFirstPartyPackages);
  const actual = new Map(packages.map(({ package: name, version: entryVersion }) => [name, entryVersion]));
  const missing = officialFirstPartyPackages.filter((name) => !actual.has(name));
  const extra = [...actual.keys()].filter((name) => !expected.has(name));
  const wrongVersion = officialFirstPartyPackages.filter((name) => actual.get(name) !== undefined && actual.get(name) !== version);
  if (missing.length > 0 || extra.length > 0 || wrongVersion.length > 0 || actual.size !== packages.length) {
    throw new Error(`Release train package closure mismatch for ${version}: missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}; wrongVersion=${wrongVersion.join(",") || "none"}.`);
  }
  return packages;
}
