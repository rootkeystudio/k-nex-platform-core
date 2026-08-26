import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(moduleDirectory, "..");
const runtimeRequire = createRequire(resolve(toolsRoot, "package.json"));
const inventoryPath = "contracts/generated-contracts.v1.json";

interface OutputTree { files: Map<string, Buffer>; root: string }
interface StageFile { content: Buffer; path: string }
interface Workspace { entrypoint: string; outputRoot: string; root: string; workingDirectory: string }
interface RunEnvironment extends Record<string, string> { HOME: string }

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function directoryFiles(source: string, destination: string): Promise<StageFile[]> {
  const files: StageFile[] = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = `${destination}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await directoryFiles(sourcePath, destinationPath));
    else if (entry.isFile()) files.push({ content: await readFile(sourcePath), path: destinationPath });
  }
  return files;
}

async function runtimeFiles(): Promise<StageFile[]> {
  const contractsRoot = resolve(dirname(runtimeRequire.resolve("@k-nex/contracts")), "..");
  const zodRoot = dirname(runtimeRequire.resolve("zod/package.json"));
  return [
    { content: Buffer.from('{"private":true,"type":"module"}\n'), path: "generator/package.json" },
    { content: await readFile(resolve(toolsRoot, "dist/generate.js")), path: "generator/generate.js" },
    { content: await readFile(resolve(contractsRoot, "package.json")), path: "node_modules/@k-nex/contracts/package.json" },
    ...await directoryFiles(resolve(contractsRoot, "dist"), "node_modules/@k-nex/contracts/dist"),
    ...await directoryFiles(zodRoot, "node_modules/zod")
  ];
}

async function stageWorkspace(root: string, files: readonly StageFile[], reverse: boolean): Promise<Workspace> {
  const workingDirectory = resolve(root, "workspace");
  const ordered = [...files].sort((left, right) => compare(left.path, right.path));
  if (reverse) ordered.reverse();
  for (const file of ordered) {
    const destination = resolve(workingDirectory, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
  }
  const entrypoint = resolve(workingDirectory, "generator/generate.js");
  const entrypointRelative = relative(root, entrypoint);
  if (entrypointRelative === "" || entrypointRelative.startsWith("..") || isAbsolute(entrypointRelative)) {
    throw new Error(`Staged generator entrypoint is outside its workspace: ${entrypoint}`);
  }
  return { entrypoint, outputRoot: resolve(root, "output"), root, workingDirectory };
}

async function runGenerator(workspace: Workspace, environment: RunEnvironment): Promise<void> {
  await mkdir(environment.HOME, { recursive: true });
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [workspace.entrypoint, "--output-root", workspace.outputRoot], {
      cwd: workspace.workingDirectory,
      env: environment,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`Generation failed in ${workspace.root} with exit ${String(code)}: ${stderr.trim()}`)));
  });
}

async function loadOutputTree(root: string): Promise<OutputTree> {
  const inventoryContent = await readFile(resolve(root, inventoryPath));
  const inventory = JSON.parse(inventoryContent.toString("utf8")) as { artifacts?: unknown };
  if (!Array.isArray(inventory.artifacts) || inventory.artifacts.some((path) => typeof path !== "string")) throw new Error(`${inventoryPath} has an invalid artifact inventory.`);
  const paths = [inventoryPath, ...(inventory.artifacts as string[])].sort(compare);
  const files = new Map<string, Buffer>();
  for (const path of paths) files.set(path, await readFile(resolve(root, path)));
  return { files, root };
}

export function contentDigest(files: ReadonlyMap<string, Uint8Array>): string {
  const hash = createHash("sha256");
  for (const [path, content] of [...files.entries()].sort(([left], [right]) => compare(left, right))) {
    hash.update(path, "utf8").update("\0").update(content).update("\0");
  }
  return hash.digest("hex");
}

export function firstDifference(left: ReadonlyMap<string, Uint8Array>, right: ReadonlyMap<string, Uint8Array>): string | undefined {
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort(compare);
  for (const path of paths) {
    const leftContent = left.get(path);
    const rightContent = right.get(path);
    if (leftContent === undefined || rightContent === undefined) return `${path}: ${leftContent === undefined ? "missing from first tree" : "missing from second tree"}`;
    if (Buffer.compare(Buffer.from(leftContent), Buffer.from(rightContent)) === 0) continue;
    const leftLines = Buffer.from(leftContent).toString("utf8").split("\n");
    const rightLines = Buffer.from(rightContent).toString("utf8").split("\n");
    const line = Array.from({ length: Math.max(leftLines.length, rightLines.length) }, (_, index) => index).find((index) => leftLines[index] !== rightLines[index]) ?? 0;
    return `${path}:${line + 1}\n- ${leftLines[line] ?? "<missing>"}\n+ ${rightLines[line] ?? "<missing>"}`;
  }
  return undefined;
}

export async function proveReproducibility(): Promise<string> {
  const firstRoot = await mkdtemp(resolve(tmpdir(), "k-nex-repro-a-"));
  const secondRoot = await mkdtemp(resolve(tmpdir(), "k-nex-repro-b-"));
  try {
    const files = await runtimeFiles();
    const firstWorkspace = await stageWorkspace(firstRoot, files, false);
    const secondWorkspace = await stageWorkspace(secondRoot, files, true);
    await runGenerator(firstWorkspace, {
      HOME: resolve(firstRoot, "home-a"), K_NEX_REPRO_MARKER: "first-workspace", LANG: "C", LC_ALL: "C",
      PWD: firstWorkspace.workingDirectory, TZ: "UTC"
    });
    await runGenerator(secondWorkspace, {
      HOME: resolve(secondRoot, "home-b"), K_NEX_REPRO_MARKER: "second-workspace", LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8",
      PWD: secondWorkspace.workingDirectory, TZ: "Pacific/Kiritimati"
    });
    const first = await loadOutputTree(firstWorkspace.outputRoot);
    const second = await loadOutputTree(secondWorkspace.outputRoot);
    const difference = firstDifference(first.files, second.files);
    if (difference !== undefined) throw new Error(`Generated output differs between ${first.root} and ${second.root}:\n${difference}`);
    const digest = contentDigest(first.files);
    if (digest !== contentDigest(second.files)) throw new Error("Generated output digests differ despite byte comparison.");
    return digest;
  } finally {
    await rm(firstRoot, { recursive: true });
    await rm(secondRoot, { recursive: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const digest = await proveReproducibility();
  console.log(`Contract generation is reproducible. sha256=${digest}`);
}
