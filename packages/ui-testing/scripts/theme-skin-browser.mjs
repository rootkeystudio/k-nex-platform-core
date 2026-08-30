import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";
import { chromium } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "k-nex-p9-theme-skin-"));
let browser; let server;
const close = () => server === undefined ? Promise.resolve() : new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
try {
  await build({ entryPoints: [new URL("../tests/theme-skin-browser-entry.tsx", import.meta.url).pathname], bundle: true, format: "esm", outfile: join(directory, "fixture.js") });
  const script = await readFile(join(directory, "fixture.js"));
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Theme Skin proof</title><style id="theme"></style></head><body><main id="root"></main><script type="module" src="/fixture.js"></script></body></html>';
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "text/javascript", "x-content-type-options": "nosniff" }); response.end(script); return; }
    response.writeHead(200, { "content-type": "text/html" }); response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("Theme Skin fixture server failed.");
  const url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();

  const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const page = await context.newPage();
  const diagnostics = [];
  const unexpectedRequests = [];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("console", (message) => diagnostics.push(`${message.type()}:${message.text()}`));
  page.on("request", (request) => { if (new URL(request.url()).origin !== url) unexpectedRequests.push(request.url()); });
  await page.goto(url); await page.waitForFunction(() => window.__K_NEX_SKIN_READY__ === true).catch((error) => { throw new Error(`Theme Skin fixture did not become ready: ${error.message}; ${diagnostics.join(" | ")}`); });
  const root = page.locator("#root"); const button = page.getByRole("button", { name: "Save sales view" });
  assert.equal(await root.getAttribute("data-skin-generation"), "skin-browser-1");
  assert.equal(await root.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
  assert.match(await page.getByRole("heading", { name: "Sales skin proof" }).ariaSnapshot(), /heading "Sales skin proof" \[level=1\]/);
  const box = await button.boundingBox(); assert.ok(box && box.width >= 44 && box.height >= 44, "Skin reduced the platform target size.");
  await page.keyboard.press("Tab");
  assert.notEqual(await button.evaluate((element) => getComputedStyle(element).outlineStyle), "none", "Skin removed keyboard focus visibility.");
  const before = createHash("sha256").update(await page.screenshot()).digest("hex");
  await page.evaluate(() => window.__K_NEX_SKIN_SWITCH__?.());
  assert.equal(await root.getAttribute("data-skin-generation"), "skin-browser-2");
  assert.equal(await root.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(17, 17, 17)");
  assert.equal(await page.evaluate(() => window.__K_NEX_SKIN_SAME_DOCUMENT__), true);
  assert.equal(await page.evaluate(() => window.__K_NEX_BAD_SKIN_REJECTED__), true);
  assert.equal(await page.evaluate(() => window.__K_NEX_ATTACK_SKIN_REJECTED__), true, "Escaped URL and cascade bypass skin was accepted.");
  assert.deepEqual(unexpectedRequests, [], "Theme Skin emitted unexpected network requests.");
  const after = createHash("sha256").update(await page.screenshot()).digest("hex");
  assert.notEqual(after, before, "Old and new skin visual captures were identical.");
  await context.close();

  const reduced = await browser.newContext({ reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage(); await reducedPage.goto(url); await reducedPage.waitForFunction(() => window.__K_NEX_SKIN_READY__ === true);
  assert.equal(await reducedPage.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
  assert.equal(await reducedPage.getByRole("button", { name: "Save sales view" }).evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
  await reduced.close();

  const forced = await browser.newContext({ forcedColors: "active" });
  const forcedPage = await forced.newPage(); await forcedPage.goto(url); await forcedPage.waitForFunction(() => window.__K_NEX_SKIN_READY__ === true);
  assert.equal(await forcedPage.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
  await forcedPage.keyboard.press("Tab");
  const forcedColors = await forcedPage.getByRole("button", { name: "Save sales view" }).evaluate((element) => {
    const probe = document.createElement("span"); probe.style.color = "CanvasText"; document.body.append(probe);
    const canvasText = getComputedStyle(probe).color; probe.remove();
    const style = getComputedStyle(element);
    return { border: style.borderTopColor, outline: style.outlineColor, outlineStyle: style.outlineStyle, canvasText };
  });
  assert.equal(forcedColors.border, forcedColors.canvasText, "Host forced-color border guard was overridden.");
  assert.equal(forcedColors.outline, forcedColors.canvasText, "Host forced-color focus guard was overridden.");
  assert.notEqual(forcedColors.outlineStyle, "none", "Host forced-color focus outline was removed.");
  await forced.close();
  process.stdout.write("P9_THEME_SKIN_BROWSER_PASS\n");
} finally {
  await browser?.close(); await close(); await rm(directory, { recursive: true, force: true });
}
