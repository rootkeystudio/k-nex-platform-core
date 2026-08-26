import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(packageRoot, ".hydration-"));
let browser;
let server;
try {
  await build({ entryPoints: [new URL("../tests/hydration-fixture.tsx", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", outfile: join(directory, "server.mjs"), packages: "external" });
  await build({ entryPoints: [new URL("../tests/browser-entry.tsx", import.meta.url).pathname], bundle: true, platform: "browser", format: "esm", outfile: join(directory, "app.js") });
  const [{ renderToString }, { HydrationFixture }, React] = await Promise.all([import("react-dom/server"), import(pathToFileURL(join(directory, "server.mjs")).href), import("react")]);
  const markup = renderToString(React.createElement(HydrationFixture));
  await writeFile(join(directory, "index.html"), `<!doctype html><html><body><div id="root">${markup}</div><script type="module" src="/app.js"></script></body></html>`);
  server = createServer(async (request, response) => {
    const name = request.url === "/app.js" ? "app.js" : "index.html";
    response.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : "text/html" });
    response.end(await readFile(join(directory, name)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Minimal hydration server did not bind.");
  browser = await chromium.launch();
  const page = await browser.newPage();
  const hydrationErrors = [];
  page.on("console", (message) => { if (message.type() === "error") hydrationErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => window.__kNexHydrated === true);
  assert.deepEqual(hydrationErrors, [], `Hydration emitted errors: ${hydrationErrors.join("\n")}`);
  assert.equal(await page.getByRole("heading", { name: "Minimal" }).count(), 1);
  assert.equal(await page.locator('[data-k-nex-theme-profile="theme-revision.hydration-1"]').count(), 1);
  console.log("Minimal theme server/client hydration passed.");
} finally {
  await browser?.close();
  if (server !== undefined) await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  await rm(directory, { recursive: true, force: true });
}
