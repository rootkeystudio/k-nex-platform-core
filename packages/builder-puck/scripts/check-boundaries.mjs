import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const importPattern = /(?:from\s*|import\s*)["']([^"']+)["']/g;

async function localGraph(entry) {
  const pending = [entry];
  const seen = new Set();
  const external = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier));
      else external.add(specifier);
    }
  }
  return { files: [...seen], external: [...external] };
}

async function filesUnder(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path, suffix) : extname(path) === suffix ? [path] : [];
  }));
  return nested.flat();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runtimeGraph = await localGraph(join(repositoryRoot, "packages/ui-runtime/dist/index.js"));
const publicBuilderGraph = await localGraph(join(packageRoot, "dist/index.js"));
const editorGraph = await localGraph(join(packageRoot, "dist/editor.js"));

const browserForbidden = ["node:", "payload", "@k-nex/payload-adapter", "@k-nex/runtime"];
for (const graph of [runtimeGraph, publicBuilderGraph, editorGraph]) {
  assert(!graph.external.some((specifier) => browserForbidden.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))),
    `Browser export contains a server-only dependency: ${graph.external.join(", ")}`);
}
assert(!runtimeGraph.external.some((specifier) => specifier === "@puckeditor/core" || specifier === "react"),
  "The production UI renderer initializes editor or React packages.");
assert(!publicBuilderGraph.external.some((specifier) => specifier === "@puckeditor/core" || specifier === "react"),
  "The builder's canonical adapter export initializes the editor package.");
assert(editorGraph.external.includes("@puckeditor/core") && editorGraph.external.includes("react"),
  "The explicit editor export does not contain the isolated Puck host.");

const contractSources = await filesUnder(join(repositoryRoot, "packages/contracts/src"), ".ts");
for (const file of contractSources) {
  const source = await readFile(file, "utf8");
  assert(!/@puckeditor\/|from\s*["'][^"']*puck|import\s+type\s+[^;]*puck/i.test(source),
    `Contract source contains a Puck implementation type or import: ${file}`);
}

const fixtures = await filesUnder(join(repositoryRoot, "fixtures/ui-documents"), ".json");
for (const file of fixtures) {
  assert(!/puck/i.test(await readFile(file, "utf8")), `Persisted fixture contains a Puck implementation reference: ${file}`);
}

await import(join(repositoryRoot, "packages/ui-runtime/dist/index.js"));
console.log("UI bundle and runtime boundaries passed.");
