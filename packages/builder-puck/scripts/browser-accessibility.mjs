import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";
import { chromium } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "k-nex-builder-browser-"));
let browser;
let server;
try {
  await build({
    entryPoints: [new URL("../tests/browser-entry.ts", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    outfile: join(directory, "app.js"),
    loader: { ".css": "css" }
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><section aria-label="Production runtime"><div id="production"></div></section><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  server = createServer(async (request, response) => {
    const name = request.url === "/app.js" ? "app.js" : request.url === "/app.css" ? "app.css" : "index.html";
    const body = await readFile(join(directory, name));
    response.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html" });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Browser fixture server did not bind.");

  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`);
  const controls = page.getByRole("region", { name: "Canvas block keyboard controls" });
  const selector = controls.getByRole("combobox", { name: "Selected canvas block" });
  const tabTo = async (locator, label) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await page.keyboard.press("Tab");
      if (await locator.evaluate((element) => document.activeElement === element).catch(() => false)) return;
    }
    throw new Error(`Keyboard focus did not reach ${label}.`);
  };
  await tabTo(selector, "the block selector");
  await page.keyboard.type("Nested content.text__v1 2");
  assert.equal(await selector.inputValue(), "3", "Keyboard selection did not reach the second nested block.");

  const earlier = controls.getByRole("button", { name: /Move content\.text__v1 2 earlier/ });
  await page.keyboard.press("Tab");
  const box = await earlier.boundingBox();
  assert(box !== null && box.width >= 44 && box.height >= 44, "Move target must be at least 44 by 44 CSS pixels.");
  assert(await earlier.evaluate((element) => document.activeElement === element), "Keyboard focus did not reach the move control.");
  assert.notEqual(await earlier.evaluate((element) => getComputedStyle(element).outlineStyle), "none", "Focused control has no visible outline.");
  assert(await earlier.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit === element || element.contains(hit);
  }), "Focused move control is obscured.");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__kNexDocument?.regions?.main?.[1]?.children?.[0]?.id === "second");

  const field = page.getByRole("textbox", { name: "Text" }).last();
  await tabTo(field, "the selected block field");
  assert(await field.evaluate((element) => document.activeElement === element), "Keyboard focus did not reach the selected block field.");
  assert(await field.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit === element || element.contains(hit);
  }), "Focused block field is obscured.");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("Edited by keyboard");
  await page.waitForFunction(() => window.__kNexDocument?.regions?.main?.[1]?.children?.[0]?.props?.text === "Edited by keyboard");
  assert.match(await controls.getByRole("status").innerText(), /position 1 of 2/);
  await page.getByRole("region", { name: "Production runtime" }).getByText(/Open tasks \(success, 1 rows\)/).waitFor();
  await page.getByText("Open tasks (success, 1 rows)").last().waitFor();
  await page.getByText("Group").last().waitFor();
  console.log("Builder browser accessibility journey passed.");
} finally {
  await browser?.close();
  if (server !== undefined) await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  await rm(directory, { recursive: true, force: true });
}
