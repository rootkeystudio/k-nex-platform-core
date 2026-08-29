import { kNexSalesRegistry } from "./k-nex-registry.js";

if (kNexSalesRegistry.collections.length !== 2 || kNexSalesRegistry.registration.pluginId !== "module.sales" || kNexSalesRegistry.readiness.currentRevision < 1 || kNexSalesRegistry.defaultPages.length === 0) {
  throw new Error("K-Nex Sales readiness is incomplete.");
}
console.log("K_NEX_SALES_READY");
