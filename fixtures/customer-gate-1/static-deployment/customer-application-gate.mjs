import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5432/customer-alpha";
process.env.PAYLOAD_SECRET = "fixture-static-customer-build";

const { kNexSalesRegistry } = await import("./dist/k-nex-registry.js");
const payloadConfig = await import("./dist/payload.config.js");
const config = await payloadConfig.default;

assert.equal(kNexSalesRegistry.registration.pluginId, "module.sales");
assert.equal(kNexSalesRegistry.collections.length, 2);
assert.ok(config.collections.some(({ slug }) => slug === "sales-opportunities"));
assert.ok(config.collections.some(({ slug }) => slug === "sales-tasks"));
const manifest = JSON.parse(await readFile("k-nex.app.json", "utf8"));
const expectsProvider = manifest.plugins.some(({ id }) => id === "provider.realtime.socketio");
if (expectsProvider) {
  const { kNexProviderRegistry } = await import("./dist/k-nex-provider-registry.js");
  const provided = [];
  kNexProviderRegistry.registration.providers({
    pluginId: kNexProviderRegistry.registration.pluginId,
    services: { get: () => { throw new Error("Provider composition proof must not resolve ambient services."); } },
    provide: (capability, service) => provided.push({ capability, pluginId: service.pluginId })
  });
  assert.deepEqual(provided, [{ capability: "realtime.gateway", pluginId: "provider.realtime.socketio" }]);
} else {
  await assert.rejects(access("./dist/k-nex-provider-registry.js"));
}
console.log("P9_STATIC_CUSTOMER_PAYLOAD_BUILD_PASS");
