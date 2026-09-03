import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");

function source(name) {
  return readFileSync(resolve(packageRoot, "src", `${name}.ts`), "utf8");
}

function declaration(name) {
  return readFileSync(resolve(packageRoot, "dist", `${name}.d.ts`), "utf8");
}

const pages = readFileSync(resolve(packageRoot, "src", "pages.tsx"), "utf8").toLowerCase();
for (const dependency of ["payload", "@puckeditor", "@tanstack", "socket.io", "theme-"]) {
  assert.equal(pages.includes(dependency), false, `pages imports forbidden dependency ${dependency}`);
}

const forbiddenNeutralImports = [
  "@k-nex/runtime",
  "@modelcontextprotocol/sdk",
  "@puckeditor/core",
  "@tanstack/",
  "payload",
  "react",
  "socket.io",
  "./server.js"
];

for (const entrypoint of ["contracts", "browser"]) {
  const content = source(entrypoint).toLowerCase();
  for (const dependency of forbiddenNeutralImports) {
    assert.equal(content.includes(dependency.toLowerCase()), false, `${entrypoint} imports forbidden dependency ${dependency}`);
  }
}
const ui = source("ui").toLowerCase();
for (const dependency of forbiddenNeutralImports.filter((value) => value !== "react")) {
  assert.equal(ui.includes(dependency.toLowerCase()), false, `ui imports forbidden dependency ${dependency}`);
}

for (const symbol of ["ActionHandler", "DataSourceHandler", "PluginRegistration", "context.bind"]) {
  assert.equal(source("contracts").includes(symbol), false, `contracts contains executable binding symbol ${symbol}`);
}

for (const entrypoint of ["contracts", "browser", "ui", "migrations", "testing"]) {
  const content = declaration(entrypoint).toLowerCase();
  for (const dependency of ["payload", "react", "@puckeditor", "@modelcontextprotocol", "@tanstack", "socket.io"]) {
    assert.equal(content.includes(dependency), false, `${entrypoint} declaration leaks third-party type ${dependency}`);
  }
}
for (const dependency of ["payload", "@puckeditor", "@tanstack", "socket.io", "theme-"]) {
  assert.equal(declaration("pages").toLowerCase().includes(dependency), false, `pages declaration leaks forbidden type ${dependency}`);
}

console.log("Sales contracts, browser, UI, migrations, and testing entrypoints preserve package boundaries.");
