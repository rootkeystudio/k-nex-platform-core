import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { generatedPnpmWorkspace, payloadPostgresPatchFilename, payloadPostgresPatchSource, planCreateKnexApplication } from "../packages/composition/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const mirror = resolve(root, "fixtures/customer-gate-1/packages");
const check = process.argv.includes("--check");

function packageIdentity(path) {
  const tar = gunzipSync(readFileSync(path));
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim() || "0", 8);
    if (name === "package/package.json") return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString("utf8"));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Packed artifact has no package identity: ${path}`);
}

const archives = readdirSync(mirror).filter((name) => /^k-nex-.*\.tgz$/u.test(name)).sort();
const packages = archives.map((filename) => ({ filename, ...packageIdentity(resolve(mirror, filename)) }));
const packageFiles = new Map(packages.map((entry) => [entry.name, `file:.k-nex/packages/${entry.filename}`]));
const overrides = Object.fromEntries([
  ...packages.map(({ name, filename }) => [name, `file:.k-nex/packages/${filename}`]),
  // @puckeditor/core declares this transitive dependency as ^3.13.9. Keep the
  // factory lock tied to the reviewed release closure instead of registry time.
  ["@puckeditor/core>@tanstack/react-virtual", "3.14.11"]
].sort(([left], [right]) => left.localeCompare(right)));
const workspace = generatedPnpmWorkspace(overrides);
const generated = [];

for (const theme of ["minimal", "neobrutalism"]) {
  const directory = mkdtempSync(join(tmpdir(), `k-nex-factory-lock-${theme}-`));
  try {
    const matches = readdirSync(mirror).filter((name) => new RegExp(`^factory-lock-sales-reference-${theme}-[0-9a-f]{64}\\.yaml$`, "u").test(name));
    if (check && matches.length !== 1) throw new Error(`Expected exactly one ${theme} factory lock template.`);
    const existing = check ? { filename: matches[0], content: readFileSync(resolve(mirror, matches[0]), "utf8") } : undefined;
    if (existing && `factory-lock-sales-reference-${theme}-${createHash("sha256").update(existing.content).digest("hex")}.yaml` !== existing.filename) {
      throw new Error(`Factory lock filename digest differs for ${theme}.`);
    }
    const plan = planCreateKnexApplication({ applicationId: "factory-lock-template", applicationName: "Factory Lock Template", theme, database: "external" });
    const manifest = JSON.parse(plan.files["package.json"]);
    manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies).map(([name, version]) => [name, name.startsWith("@k-nex/") ? packageFiles.get(name) : version]));
    if (Object.values(manifest.dependencies).includes(undefined)) throw new Error(`Packed mirror is incomplete for the ${theme} factory lock.`);
    mkdirSync(resolve(directory, ".k-nex/packages"), { recursive: true });
    for (const filename of archives) copyFileSync(resolve(mirror, filename), resolve(directory, ".k-nex/packages", filename));
    mkdirSync(resolve(directory, "patches"), { recursive: true });
    writeFileSync(resolve(directory, payloadPostgresPatchFilename), payloadPostgresPatchSource());
    writeFileSync(resolve(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(resolve(directory, ".npmrc"), "link-workspace-packages=false\nshared-workspace-lockfile=false\n");
    writeFileSync(resolve(directory, "pnpm-workspace.yaml"), workspace);
    if (existing) {
      writeFileSync(resolve(directory, "pnpm-lock.yaml"), existing.content);
      execFileSync("pnpm", ["install", "--lockfile-only", "--frozen-lockfile", "--ignore-scripts"], { cwd: directory, stdio: "pipe" });
      if (readFileSync(resolve(directory, "pnpm-lock.yaml"), "utf8") !== existing.content) throw new Error(`Factory lock changed while checking ${theme}.`);
      generated.push(existing);
    } else {
      execFileSync("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], { cwd: directory, stdio: "pipe" });
      const content = readFileSync(resolve(directory, "pnpm-lock.yaml"), "utf8");
      const digest = createHash("sha256").update(content).digest("hex");
      generated.push({ filename: `factory-lock-sales-reference-${theme}-${digest}.yaml`, content });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const existing = readdirSync(mirror).filter((name) => /^factory-lock-sales-reference-.*\.yaml$/u.test(name)).sort();
if (check) {
  if (existing.length !== generated.length || generated.some(({ filename, content }) => !existing.includes(filename) || readFileSync(resolve(mirror, filename), "utf8") !== content)) {
    throw new Error("Phase 12 factory lock templates are stale.");
  }
} else {
  for (const filename of existing) rmSync(resolve(mirror, filename));
  for (const { filename, content } of generated) writeFileSync(resolve(mirror, filename), content);
}
process.stdout.write(`P12_FACTORY_LOCKS_${check ? "CHECK" : "GENERATED"}_PASS ${generated.length}\n`);
