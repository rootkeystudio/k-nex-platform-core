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
