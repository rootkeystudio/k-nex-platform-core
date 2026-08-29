import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5432/customer-alpha";
process.env.PAYLOAD_SECRET = "fixture-static-customer-build";

const { kNexSalesRegistry } = await import("./dist/k-nex-registry.js");
const payloadConfig = await import("./dist/payload.config.js");
const config = await payloadConfig.default;

assert.equal(kNexSalesRegistry.registration.pluginId, "module.sales");
assert.equal(kNexSalesRegistry.collections.length, 2);
assert.ok(config.collections.some(({ slug }) => slug === "sales-opportunities"));
assert.ok(config.collections.some(({ slug }) => slug === "sales-tasks"));
console.log("P9_STATIC_CUSTOMER_PAYLOAD_BUILD_PASS");
