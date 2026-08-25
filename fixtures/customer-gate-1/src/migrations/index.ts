import * as migration_20260826_000001_gate1 from "./20260826_000001_gate1.js";

import type { CustomerPayloadMigration } from "@k-nex/payload-adapter";

export const migrations: CustomerPayloadMigration[] = [
  {
    up: migration_20260826_000001_gate1.up,
    down: migration_20260826_000001_gate1.down,
    name: "20260826_000001_gate1"
  }
];
