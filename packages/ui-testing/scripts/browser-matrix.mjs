import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "k-nex-p7-matrix-"));
let browser; let server;
try {
  await build({ entryPoints: [new URL("../tests/browser-entry.tsx", import.meta.url).pathname], bundle: true, format: "esm", jsx: "automatic", outfile: join(directory, "app.js") });
  await build({ entryPoints: [new URL("../tests/browser-hydration-entry.tsx", import.meta.url).pathname], bundle: true, format: "esm", jsx: "automatic", outfile: join(directory, "hydrate.js") });
  await build({ entryPoints: [new URL("../tests/server-hydration-entry.tsx", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", jsx: "automatic", banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' }, outfile: join(directory, "server.mjs") });
  const { hydrationMarkup } = await import(`${pathToFileURL(join(directory, "server.mjs")).href}?t=${Date.now()}`);
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:16px system-ui}main{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px}section{padding:16px;overflow:auto}[data-matrix-state]{margin-inline-end:4px}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  await writeFile(join(directory, "hydrate.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="root">${hydrationMarkup}</div><script type="module" src="/hydrate.js"></script></body></html>`);
  server = createServer(async (request, response) => { const name = request.url === "/app.js" ? "app.js" : request.url === "/hydrate.js" ? "hydrate.js" : request.url === "/hydrate" ? "hydrate.html" : "index.html"; response.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : "text/html" }); response.end(await readFile(join(directory, name))); });
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
  const hoverProbe = minimal.getByRole("button", { name: "Minimal hover probe" }); await hoverProbe.hover(); assert.equal(await hoverProbe.getAttribute("data-hovered"), "true"); const focusProbe = minimal.getByRole("button", { name: "Minimal focus probe" }); await focusProbe.focus(); assert.equal(await focusProbe.evaluate((element) => element === document.activeElement), true); const pressedProbe = minimal.getByRole("button", { name: "Minimal pressed probe" }); await pressedProbe.hover(); await page.mouse.down(); assert.equal(await pressedProbe.getAttribute("data-pressed"), "true"); await page.mouse.up();
  const switcher = page.getByRole("button", { name: "Switch matrix theme" });
  await switcher.hover(); assert.equal(await switcher.getAttribute("data-hovered"), "true");
  await switcher.focus(); assert.equal(await switcher.evaluate((element) => element === document.activeElement), true);
  await minimal.getByRole("checkbox", { name: "Select row task-1" }).first().click(); await minimal.getByText("1 selected").first().waitFor();
  const cells = minimal.getByRole("gridcell"); assert.equal(await minimal.getByRole("grid", { name: "Task grid" }).locator('[role="gridcell"][tabindex="0"]').count(), 1); await cells.first().focus(); await page.keyboard.press("ArrowRight"); assert.equal(await cells.nth(1).evaluate((element) => element === document.activeElement), true); assert.equal(await cells.first().getAttribute("tabindex"), "-1"); assert.equal(await cells.nth(1).getAttribute("tabindex"), "0");
  const virtualList = minimal.getByRole("list", { name: "Minimal virtual tasks" }); assert((await virtualList.getByRole("listitem").count()) < 100); const virtualStart = performance.now(); await virtualList.getByRole("listitem").first().focus(); await page.keyboard.press("End"); await virtualList.getByText("Virtual row 9999").waitFor(); await page.waitForFunction(() => document.activeElement?.textContent === "Virtual row 9999"); assert(performance.now() - virtualStart < 500, "10,000-row virtual scroll exceeded 500ms"); assert((await virtualList.evaluate((element) => element.scrollTop)) > 0); assert.equal(await virtualList.getByText("Virtual row 9999").evaluate((element) => element.closest('[role="listitem"]') === document.activeElement), true);
  const dialogTrigger = minimal.getByRole("button", { name: "Open Minimal matrix dialog" }); const overlayStart = performance.now(); await dialogTrigger.click(); await page.getByRole("dialog", { name: "Minimal matrix dialog" }).waitFor(); const openMs = performance.now() - overlayStart; assert(openMs < 500, `overlay open exceeded 500ms: ${openMs}`); await page.keyboard.press("Escape"); await page.getByRole("dialog", { name: "Minimal matrix dialog" }).waitFor({ state: "hidden" }); assert(performance.now() - overlayStart < 1_000, "overlay open/close exceeded 1s");
  assert.equal(await minimal.locator('[data-matrix-state="rtl"]').getAttribute("dir"), "rtl"); assert.match(await minimal.textContent(), /Satış görevleri/);
  await switcher.click(); assert.equal(await minimal.getAttribute("data-theme-id"), "theme.neobrutalism");
  const cdp = await context.newCDPSession(page); await cdp.send("HeapProfiler.enable"); await cdp.send("HeapProfiler.collectGarbage"); const heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize; for (let index = 0; index < 20; index += 1) await page.getByRole("button", { name: "Toggle matrix surfaces" }).click(); await cdp.send("HeapProfiler.collectGarbage"); const heapAfter = (await cdp.send("Runtime.getHeapUsage")).usedSize; assert(heapAfter - heapBefore < 64 * 1024 * 1024, "repeated mount/unmount retained more than 64 MiB"); await cdp.detach();
  assert.deepEqual(errors, []); await context.close();
  const reduced = await browser.newContext({ reducedMotion: "reduce" }); const reducedPage = await reduced.newPage(); await reducedPage.goto(url); await reducedPage.waitForFunction(() => window.__K_NEX_P7_READY__ === true); assert.equal(await reducedPage.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true); assert.equal(await reducedPage.getByRole("button", { name: "Minimal reduced motion probe" }).evaluate((element) => getComputedStyle(element).transitionDuration), "0s"); await reduced.close();
  const forced = await browser.newContext({ forcedColors: "active" }); const forcedPage = await forced.newPage(); await forcedPage.goto(url); await forcedPage.waitForFunction(() => window.__K_NEX_P7_READY__ === true); assert.equal(await forcedPage.evaluate(() => matchMedia("(forced-colors: active)").matches), true); assert.notEqual(await forcedPage.getByRole("button", { name: "Minimal high contrast probe" }).evaluate((element) => getComputedStyle(element).borderTopStyle), "none"); await forced.close();
  const hydration = await browser.newContext(); const hydrationPage = await hydration.newPage(); const hydrationErrors = []; hydrationPage.on("pageerror", (error) => hydrationErrors.push(error.message)); await hydrationPage.goto(`${url}/hydrate`); await hydrationPage.waitForFunction(() => window.__K_NEX_P7_HYDRATION_READY__ === true); assert.deepEqual(await hydrationPage.evaluate(() => window.__K_NEX_P7_HYDRATION_ERRORS__), []); await hydrationPage.getByRole("button", { name: "Open hydration portal" }).click(); await hydrationPage.getByRole("dialog", { name: "Hydration portal" }).waitFor(); assert.match(await hydrationPage.getByRole("dialog", { name: "Hydration portal" }).ariaSnapshot(), /Hydrated overlay/); await hydrationPage.keyboard.press("Escape"); assert.deepEqual(hydrationErrors, []); await hydration.close();
  process.stdout.write("P7_COMPONENT_MATRIX_BROWSER_PASS\n");
} finally {
  await browser?.close(); if (server !== undefined) await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); await rm(directory, { recursive: true, force: true });
}
