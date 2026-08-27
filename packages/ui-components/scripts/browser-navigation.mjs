import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";
import { chromium } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "k-nex-components-browser-"));
let browser;
let server;
try {
  await build({ entryPoints: [new URL("../tests/browser-navigation-entry.tsx", import.meta.url).pathname], bundle: true, format: "esm", outfile: join(directory, "app.js") });
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><main id="main"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>');
  server = createServer(async (request, response) => {
    const name = request.url === "/app.js" ? "app.js" : "index.html";
    response.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : "text/html" });
    response.end(await readFile(join(directory, name)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Component browser fixture did not bind.");
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`http://127.0.0.1:${address.port}`);

  const firstTab = page.getByRole("tab", { name: "One" });
  await firstTab.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("tabpanel").filter({ hasText: "Panel two" }).waitFor();

  await page.getByRole("button", { name: "More actions" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Archive" }).waitFor();
  await page.keyboard.press("Enter");
  await page.getByRole("status", { name: "Last action" }).filter({ hasText: "archive" }).waitFor();

  const tree = page.getByRole("tree", { name: "Workspace pages" });
  const home = tree.getByRole("treeitem", { name: "Home", exact: true });
  const projects = tree.getByRole("treeitem", { name: "Projects", exact: true });
  const activeProjects = tree.getByRole("treeitem", { name: "Active projects", exact: true });
  const archivedProjects = tree.getByRole("treeitem", { name: "Archived projects", exact: true });
  const archive2026 = tree.getByRole("treeitem", { name: "2026 archive", exact: true });
  const settings = tree.getByRole("treeitem", { name: "Settings", exact: true });
  await home.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Projects", "ArrowDown did not move tree roving focus.");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Active projects", "ArrowRight did not descend into an expanded tree branch.");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Archived projects", "ArrowDown did not follow visible tree order.");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "2026 archive", "ArrowRight did not descend into nested tree branch.");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Archived projects", "ArrowLeft did not move to tree parent.");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await archivedProjects.getAttribute("aria-expanded"), "false", "ArrowLeft did not collapse expanded tree branch.");
  await page.keyboard.press("ArrowRight");
  assert.equal(await archivedProjects.getAttribute("aria-expanded"), "true", "ArrowRight did not expand collapsed tree branch.");
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Settings", "End did not move focus to final visible tree item.");
  await page.keyboard.press("Home");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Home", "Home did not move focus to first visible tree item.");
  await page.keyboard.press(" ");
  assert.equal(await home.getAttribute("aria-selected"), "true", "Space did not select tree item.");
  await page.getByRole("status", { name: "Last action" }).filter({ hasText: "selected:home" }).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await projects.getAttribute("aria-selected"), "true", "Enter did not select tree item.");
  await activeProjects.click();
  assert.equal(await activeProjects.getAttribute("aria-selected"), "true", "Pointer did not select the nested tree item.");
  assert.equal(await projects.getAttribute("aria-selected"), "false", "Nested pointer selection bubbled to its ancestor.");
  await page.getByRole("status", { name: "Last action" }).filter({ hasText: "selected:active" }).waitFor();

  const dialogTrigger = page.getByRole("button", { name: "Open dialog" });
  await dialogTrigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Account dialog" });
  await dialog.waitFor();
  assert(await dialog.evaluate((element) => element.contains(document.activeElement)), "Dialog did not contain focus.");
  assert.equal(await dialog.evaluate((element) => document.getElementById("root")?.contains(element)), false, "Modal stayed inside the application root instead of its portal boundary.");

  const nestedTrigger = page.getByRole("button", { name: "Open nested popover" });
  await nestedTrigger.focus();
  await page.keyboard.press("Enter");
  const nested = page.getByRole("dialog", { name: "Nested options" });
  await nested.waitFor();
  const bounds = await nested.boundingBox();
  assert(bounds !== null && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 800 && bounds.y + bounds.height <= 600, "Popover collision handling escaped the viewport.");
  await page.keyboard.press("Escape");
  await nested.waitFor({ state: "hidden" });
  await page.waitForFunction((element) => document.activeElement === element, await nestedTrigger.elementHandle());
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction((element) => document.activeElement === element, await dialogTrigger.elementHandle());
  console.log("Component navigation and nested overlay browser journey passed.");
} finally {
  await browser?.close();
  if (server !== undefined) await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  await rm(directory, { recursive: true, force: true });
}
