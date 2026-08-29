import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const release = JSON.parse(await readFile(new URL("./release.json", import.meta.url), "utf8"));
const installedPlugin = JSON.parse(await readFile(new URL("./node_modules/@k-nex/module-sales/package.json", import.meta.url), "utf8"));
if (installedPlugin.name !== release.plugin.id.replace("module.", "@k-nex/module-") || installedPlugin.version !== release.plugin.version) {
  throw new Error("Installed module.sales package does not match the customer release.");
}
const generation = process.env.K_NEX_GENERATION;
const sourceCommit = process.env.K_NEX_SOURCE_COMMIT;
const applicationDigest = process.env.K_NEX_APPLICATION_DIGEST;
const smokeToken = process.env.K_NEX_SMOKE_TOKEN;

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

createServer((request, response) => {
  const respond = () => {
    if (request.url === "/health" && process.env.K_NEX_FAIL_HEALTH === "1") return send(response, 500, { status: "failed" });
    if (request.url === "/authenticated" && request.headers["x-k-nex-smoke-auth"] !== smokeToken) return send(response, 401, { error: "authentication-required" });
    return send(response, 200, {
      applicationDigest,
      generation,
      module: release.plugin.id,
      path: request.url,
      pluginVersion: installedPlugin.version,
      sourceCommit,
      workerMode: process.env.K_NEX_WORKER_MODE
    });
  };
  if (request.url === "/slow") setTimeout(respond, 250); else respond();
}).listen(3000, "0.0.0.0");
