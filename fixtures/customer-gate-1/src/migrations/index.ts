import * as migration_20260826_000001_gate1 from "./20260826_000001_gate1.js";
import * as migration_20260826_000002_sales_sources from "./20260826_000002_sales_sources.js";
import * as migration_20260826_000003_payload_mcp from "./20260826_000003_payload_mcp.js";
import * as migration_20260826_000004_event_outbox from "./20260826_000004_event_outbox.js";
import * as migration_20260826_000005_outbox_processor from "./20260826_000005_outbox_processor.js";
import * as migration_20260827_000006_sales_opportunities from "./20260827_000006_sales_opportunities.js";
import * as migration_20260829_000007_runtime_extensions from "./20260829_000007_runtime_extensions.js";
import * as migration_20260829_000008_app_storage from "./20260829_000008_app_storage.js";
import * as migration_20260829_000009_extension_activation from "./20260829_000009_extension_activation.js";

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
  },
  {
    up: migration_20260827_000006_sales_opportunities.up,
    down: migration_20260827_000006_sales_opportunities.down,
    name: "20260827_000006_sales_opportunities"
  },
  {
    up: migration_20260829_000007_runtime_extensions.up,
    down: migration_20260829_000007_runtime_extensions.down,
    name: "20260829_000007_runtime_extensions"
  },
  {
    up: migration_20260829_000008_app_storage.up,
    down: migration_20260829_000008_app_storage.down,
    name: "20260829_000008_app_storage"
  },
  {
    up: migration_20260829_000009_extension_activation.up,
    down: migration_20260829_000009_extension_activation.down,
    name: "20260829_000009_extension_activation"
  }
];
