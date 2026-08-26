import * as migration_20260826_000001_gate1 from "./20260826_000001_gate1.js";
import * as migration_20260826_000002_sales_sources from "./20260826_000002_sales_sources.js";

import type { CustomerPayloadMigration } from "@k-nex/payload-adapter";

export const migrations: CustomerPayloadMigration[] = [
  {
    up: migration_20260826_000001_gate1.up,
    down: migration_20260826_000001_gate1.down,
    name: "20260826_000001_gate1"
  },
  {
    up: migration_20260826_000002_sales_sources.up,
    down: migration_20260826_000002_sales_sources.down,
    name: "20260826_000002_sales_sources"
  }
];
