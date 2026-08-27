import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "k-nex-p7-matrix-"));
let browser; let server;
try {
  await build({ entryPoints: [new URL("../tests/browser-entry.tsx", import.meta.url).pathname], bundle: true, format: "esm", jsx: "automatic", outfile: join(directory, "app.js") });
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:16px system-ui}main{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px}section{padding:16px;overflow:auto}[data-matrix-state]{margin-inline-end:4px}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  server = createServer(async (request, response) => { const name = request.url === "/app.js" ? "app.js" : "index.html"; response.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : "text/html" }); response.end(await readFile(join(directory, name))); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("P7 browser server failed.");
  const url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); }); page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url); await page.waitForFunction(() => window.__K_NEX_P7_READY__ === true).catch((error) => { throw new Error(`P7 fixture not ready: ${errors.join(" | ") || error.message}`); });
  for (const label of ["Minimal", "Neobrutalism"]) {
    const surface = page.getByTestId(`surface-${label}`);
    assert.equal(await surface.locator("[data-matrix-state]").count(), 16);
    assert.equal(await surface.getByRole("form", { name: "Create task" }).count(), 1);
    assert.equal(await surface.getByRole("grid", { name: "Task grid" }).count(), 1);
    const aria = await surface.ariaSnapshot(); assert.match(aria, /heading "Sales tasks" \[level=1\]/); assert.match(aria, /form "Create task"/); assert.match(aria, /grid "Task grid"/);
  }
  const minimal = page.getByTestId("surface-Minimal");
  assert((await page.evaluate(() => window.__K_NEX_P7_RENDER_MS__)) < 2_000, "initial component matrix render exceeded 2s");
  const switcher = page.getByRole("button", { name: "Switch matrix theme" });
  await switcher.hover(); assert.equal(await switcher.getAttribute("data-hovered"), "true");
  await switcher.focus(); assert.equal(await switcher.evaluate((element) => element === document.activeElement), true);
  await minimal.getByRole("checkbox", { name: "Select row task-1" }).first().click(); await minimal.getByText("1 selected").first().waitFor();
  const cells = minimal.getByRole("gridcell"); await cells.first().focus(); await page.keyboard.press("ArrowRight"); assert.equal(await cells.nth(1).evaluate((element) => element === document.activeElement), true);
  const dialogTrigger = minimal.getByRole("button", { name: "Open Minimal matrix dialog" }); const overlayStart = performance.now(); await dialogTrigger.click(); await page.getByRole("dialog", { name: "Minimal matrix dialog" }).waitFor(); const openMs = performance.now() - overlayStart; assert(openMs < 500, `overlay open exceeded 500ms: ${openMs}`); await page.keyboard.press("Escape"); await page.getByRole("dialog", { name: "Minimal matrix dialog" }).waitFor({ state: "hidden" }); assert(performance.now() - overlayStart < 1_000, "overlay open/close exceeded 1s");
  assert.equal(await minimal.locator('[dir="rtl"]').getAttribute("dir"), "rtl"); assert.match(await minimal.textContent(), /Satış görevleri/);
  await switcher.click(); assert.equal(await minimal.getAttribute("data-theme-id"), "theme.neobrutalism");
  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0); for (let index = 0; index < 20; index += 1) await page.getByRole("button", { name: "Toggle matrix surfaces" }).click(); const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0); if (heapBefore > 0 && heapAfter > 0) assert(heapAfter - heapBefore < 64 * 1024 * 1024, "repeated mount/unmount retained more than 64 MiB");
  assert.deepEqual(errors, []); await context.close();
  const reduced = await browser.newContext({ reducedMotion: "reduce" }); const reducedPage = await reduced.newPage(); await reducedPage.goto(url); await reducedPage.waitForFunction(() => window.__K_NEX_P7_READY__ === true); assert.equal(await reducedPage.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true); assert.equal(await reducedPage.getByRole("button", { name: "Disabled action" }).first().evaluate((element) => getComputedStyle(element).transitionDuration), "0s"); await reduced.close();
  const forced = await browser.newContext({ forcedColors: "active" }); const forcedPage = await forced.newPage(); await forcedPage.goto(url); await forcedPage.waitForFunction(() => window.__K_NEX_P7_READY__ === true); assert.equal(await forcedPage.evaluate(() => matchMedia("(forced-colors: active)").matches), true); assert.notEqual(await forcedPage.getByRole("button", { name: "Disabled action" }).first().evaluate((element) => getComputedStyle(element).borderTopStyle), "none"); await forced.close();
  process.stdout.write("P7_COMPONENT_MATRIX_BROWSER_PASS\n");
} finally {
  await browser?.close(); if (server !== undefined) await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); await rm(directory, { recursive: true, force: true });
}
