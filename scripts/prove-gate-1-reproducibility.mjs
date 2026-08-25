import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const generatedDirectory = join("fixtures", "customer-gate-1", ".k-nex", "generated");
const expectedArtifacts = [
  "environment-schema.ts",
  "k-nex.resolved.json",
  "payload-contributions.ts",
  "plugin-registry.ts",
  "runtime-registration.ts"
];

async function copyTrackedFiles(target) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: repositoryRoot })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    const source = join(repositoryRoot, file);
    const destination = join(target, file);
    const metadata = await lstat(source).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!metadata) continue;
    await mkdir(dirname(destination), { recursive: true });
    if (metadata.isSymbolicLink()) await symlink(await readlink(source), destination);
    else await copyFile(source, destination);
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`)));
  });
}

async function generate(root) {
  await copyTrackedFiles(root);
  await run("pnpm", ["install", "--frozen-lockfile"], root);
  await run("pnpm", ["--filter", "@k-nex/contracts", "build"], root);
  await run("pnpm", ["--filter", "@k-nex/composition", "build"], root);
  await rm(join(root, generatedDirectory), { recursive: true, force: true });
  await run("pnpm", ["--filter", "@k-nex/composition", "generate:gate-1"], root);

  const directory = join(root, generatedDirectory);
  const names = (await readdir(directory)).sort();
  if (names.join("\0") !== expectedArtifacts.join("\0")) throw new Error("Gate 1 generated artifact inventory differs.");
  return Promise.all(names.map(async (name) => [name, await readFile(join(directory, name))]));
}

const staging = await mkdtemp(join(tmpdir(), "k-nex-gate-1-"));
try {
  const [first, second] = await Promise.all([
    generate(join(staging, "first")),
    generate(join(staging, "second"))
  ]);
  const hash = createHash("sha256");
  for (let index = 0; index < first.length; index += 1) {
    const [name, content] = first[index];
    const [otherName, otherContent] = second[index];
    if (name !== otherName || !content.equals(otherContent)) throw new Error(`Gate 1 artifact ${name} is not reproducible.`);
    hash.update(name).update("\0").update(content).update("\0");
  }
  console.log(`Gate 1 static artifacts are reproducible. sha256=${hash.digest("hex")}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
