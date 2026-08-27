import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";
import { chromium } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "k-nex-gate-5-browser-"));
let browser;
let server;
try {
  await build({ entryPoints: [new URL("../tests/browser-entry.tsx", import.meta.url).pathname], bundle: true, format: "esm", outfile: join(directory, "app.js") });
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;padding:24px}section{padding:20px}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  server = createServer(async (request, response) => {
    const name = request.url === "/app.js" ? "app.js" : "index.html";
    response.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : "text/html" });
    response.end(await readFile(join(directory, name)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Gate 5 browser server did not bind.");
  const url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__K_NEX_READY__ === true).catch((error) => {
    throw new Error(`Gate 5 browser fixture did not become ready: ${browserErrors.join(" | ") || error.message}`);
  });
  const surfaces = Object.fromEntries(["Minimal", "Neobrutalism", "Customer"].map((label) => [label, page.getByTestId(`surface-${label}`)]));
  const borderWidth = (label) => surfaces[label].locator('[data-k-nex-primitive="card"]').first().evaluate((element) => getComputedStyle(element).borderTopWidth);
  const nestedBorderWidth = () => page.getByTestId("surface-Nested").locator('[data-k-nex-primitive="card"]').evaluate((element) => getComputedStyle(element).borderTopWidth);
  assert.deepEqual(await Promise.all([borderWidth("Minimal"), borderWidth("Neobrutalism"), borderWidth("Customer")]), ["1px", "3px", "5px"], "simultaneous theme roots must remain isolated");
  assert.equal(await nestedBorderWidth(), "5px", "nested theme root must own its descendants independently of the outer stylesheet");
  assert.deepEqual(await page.getByTestId("surface-Nested").evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderRadius: style.borderTopLeftRadius, outlineOffset: style.outlineOffset };
  }), { borderRadius: "0px", outlineOffset: "0px" }, "outer universal and root-targeting rules must not style the nested root element");
  assert.equal(await page.getByTestId("outside-sibling").locator('[data-k-nex-primitive="card"]').evaluate((element) => getComputedStyle(element).borderTopWidth), "0px", "theme structural CSS must not style siblings outside every theme root");

  const increment = page.getByRole("button", { name: "Increment Minimal" });
  await page.keyboard.press("Tab");
  assert.equal(await increment.evaluate((element) => element === document.activeElement && element.hasAttribute("data-focus-visible")), true, "actual React Aria button must expose keyboard focus");
  const target = await increment.boundingBox();
  assert(target !== null && target.width >= 44 && target.height >= 44);
  assert.notEqual(await increment.evaluate((element) => getComputedStyle(element).outlineStyle), "none");
  await page.keyboard.press("Enter");
  await surfaces.Minimal.getByRole("status").filter({ hasText: "Count 1" }).waitFor();
  const move = page.getByRole("button", { name: "Move Beta earlier Minimal" });
  await move.focus();
  await page.keyboard.press("Enter");
  await surfaces.Minimal.getByRole("status").filter({ hasText: "Beta moved earlier" }).waitFor();

  const dialogTrigger = page.getByRole("button", { name: "Open Minimal dialog" });
  await dialogTrigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Minimal dialog" });
  await dialog.waitFor();
  assert(await dialog.evaluate((element) => element.contains(document.activeElement)), "dialog must contain focus");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent === "Open Minimal dialog");
  const aria = await surfaces.Minimal.ariaSnapshot();
  assert.match(aria, /heading "Operations at a glance" \[level=1\]/);
  assert.match(aria, /button "Increment Minimal"/);
  assert.match(aria, /status/);

  const digests = {};
  for (const label of Object.keys(surfaces)) digests[label] = createHash("sha256").update(await surfaces[label].screenshot({ animations: "disabled" })).digest("hex");
  assert.equal(new Set(Object.values(digests)).size, 3, "theme and customer visuals must be materially distinct");
  if (process.env.K_NEX_EVIDENCE_PATH) await page.screenshot({ animations: "disabled", path: process.env.K_NEX_EVIDENCE_PATH, fullPage: true });
  await page.getByRole("button", { name: "Switch Minimal theme" }).click();
  assert.deepEqual(await Promise.all([borderWidth("Minimal"), borderWidth("Neobrutalism"), borderWidth("Customer")]), ["3px", "3px", "5px"], "theme switching must not restyle sibling roots");
  assert.equal(await nestedBorderWidth(), "5px", "outer theme switching must not restyle a nested theme root");
  assert.deepEqual(browserErrors, []);
  await context.close();

  const reduced = await browser.newContext({ reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(url);
  await reducedPage.waitForFunction(() => window.__K_NEX_READY__ === true);
  assert.equal(await reducedPage.getByRole("button", { name: "Increment Minimal" }).evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
  await reduced.close();

  const forced = await browser.newContext({ forcedColors: "active" });
  const forcedPage = await forced.newPage();
  await forcedPage.goto(url);
  await forcedPage.waitForFunction(() => window.__K_NEX_READY__ === true);
  assert.equal(await forcedPage.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
  assert.notEqual(await forcedPage.getByRole("button", { name: "Increment Minimal" }).evaluate((element) => getComputedStyle(element).borderTopStyle), "none");
  await forced.close();
  process.stdout.write(`P5_8_ACTUAL_INTEGRATION_PASS ${JSON.stringify(digests)}\n`);
} finally {
  await browser?.close();
  if (server !== undefined) await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  await rm(directory, { recursive: true, force: true });
}
