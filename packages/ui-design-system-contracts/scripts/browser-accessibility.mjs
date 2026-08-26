import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";
import { chromium } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "k-nex-primitives-browser-"));
let browser;
let server;
try {
  await build({
    entryPoints: [new URL("../tests/browser-entry.tsx", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    outfile: join(directory, "app.js")
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><main><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>');
  server = createServer(async (request, response) => {
    const name = request.url === "/app.js" ? "app.js" : "index.html";
    response.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : "text/html" });
    response.end(await readFile(join(directory, name)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Primitive browser fixture server did not bind.");

  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`);

  const increment = page.getByRole("button", { name: "Increment" });
  await increment.focus();
  await page.keyboard.press("Enter");
  await page.getByText("Presses: 1", { exact: true }).waitFor();

  const checkbox = page.getByRole("checkbox", { name: "Receive updates" });
  await checkbox.focus();
  await page.keyboard.press("Space");
  await page.getByText("Checked: true", { exact: true }).waitFor();

  const select = page.locator('[data-k-nex-primitive="select"] button');
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "Urgent" }).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.getByText("Priority: urgent", { exact: true }).waitFor();

  const dialogTrigger = page.getByRole("button", { name: "Open dialog" });
  await dialogTrigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Confirm action" });
  await dialog.waitFor();
  assert(await dialog.evaluate((element) => element.contains(document.activeElement)), "Dialog did not contain keyboard focus.");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert(await dialogTrigger.evaluate((element) => document.activeElement === element), "Dialog did not restore trigger focus.");

  const tooltipTrigger = page.getByRole("button", { name: "More information" });
  await tooltipTrigger.focus();
  await page.getByRole("tooltip", { name: "Helpful details" }).waitFor();

  assert.equal(await page.getByRole("table", { name: "People" }).count(), 1);
  assert.equal(await page.getByRole("rowheader", { name: "Ada" }).count(), 1);
  console.log("Semantic primitive browser accessibility journey passed.");
} finally {
  await browser?.close();
  if (server !== undefined) await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  await rm(directory, { recursive: true, force: true });
}
