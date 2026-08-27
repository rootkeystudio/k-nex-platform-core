import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromComposition = createRequire(resolve(repositoryRoot, "packages/composition/package.json"));
const YAML = requireFromComposition("yaml");
const root = YAML.parse(readFileSync(resolve(repositoryRoot, "pnpm-lock.yaml"), "utf8"));

for (const customer of ["customer-alpha", "customer-beta"]) {
  const importer = root.importers?.[`fixtures/${customer}`];
  if (!importer) throw new Error(`Root lockfile is missing ${customer}.`);
  const dedicated = {
    lockfileVersion: root.lockfileVersion,
    settings: root.settings,
    importers: { ".": importer },
    packages: root.packages,
    snapshots: root.snapshots
  };
  writeFileSync(resolve(repositoryRoot, `fixtures/${customer}/pnpm-lock.yaml`), YAML.stringify(dedicated, { lineWidth: 0 }), "utf8");
}
