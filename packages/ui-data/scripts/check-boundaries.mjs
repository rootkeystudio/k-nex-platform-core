import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function filesUnder(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(join(directory, entry.name), extension) : extname(entry.name) === extension ? [join(directory, entry.name)] : []));
  return nested.flat();
}

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.equal(manifest.dependencies.lexical, "0.49.0");
assert.equal(manifest.dependencies["@lexical/react"], "0.49.0");
assert.equal(manifest.dependencies["@tanstack/react-table"], "8.21.3");
for (const file of (await filesUnder(join(root, "dist"), ".ts")).filter((path) => path.endsWith(".d.ts"))) {
  const declaration = await readFile(file, "utf8");
  assert(!/(?:from\s+["'](?:lexical|@lexical\/)|LexicalEditor|EditorState)/.test(declaration), `Public UI data declaration leaks Lexical: ${file}`);
  assert(!/(?:from\s+["']@tanstack\/|\bColumnDef\b|\bTableState\b|\bRowData\b)/.test(declaration), `Public UI data declaration leaks TanStack Table: ${file}`);
}
for (const file of await filesUnder(join(root, "src"), ".tsx")) {
  if (!file.endsWith("rich-text-editor.tsx")) assert(!/from\s+["'](?:lexical|@lexical\/)/.test(await readFile(file, "utf8")), `Lexical escaped the optional editor adapter: ${file}`);
  if (!file.endsWith("data-table.tsx")) assert(!/from\s+["']@tanstack\/react-table/.test(await readFile(file, "utf8")), `TanStack Table escaped its adapter: ${file}`);
}
console.log("UI data adapter boundaries passed.");
