import * as migration_20260826_000001_gate1 from "./20260826_000001_gate1.js";
import * as migration_20260826_000002_sales_sources from "./20260826_000002_sales_sources.js";
import * as migration_20260826_000003_payload_mcp from "./20260826_000003_payload_mcp.js";
import * as migration_20260826_000004_event_outbox from "./20260826_000004_event_outbox.js";
import * as migration_20260826_000005_outbox_processor from "./20260826_000005_outbox_processor.js";

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
  },
  {
    up: migration_20260826_000003_payload_mcp.up,
    down: migration_20260826_000003_payload_mcp.down,
    name: "20260826_000003_payload_mcp"
  },
  {
    up: migration_20260826_000004_event_outbox.up,
    down: migration_20260826_000004_event_outbox.down,
    name: "20260826_000004_event_outbox"
  },
  {
    up: migration_20260826_000005_outbox_processor.up,
    down: migration_20260826_000005_outbox_processor.down,
    name: "20260826_000005_outbox_processor"
  }
];
