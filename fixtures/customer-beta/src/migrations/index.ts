import * as baseline from "./20260827_000001_sales_baseline.js";
import * as bootstrap from "./20260827_000002_knex_bootstrap.js";

export const migrations = [
  { name: "20260827_000001_sales_baseline", up: baseline.up, down: baseline.down },
  { name: "20260827_000002_knex_bootstrap", up: bootstrap.up, down: bootstrap.down }
];
