import * as migration_20260826_000001_gate1 from "./20260826_000001_gate1.js";
import * as migration_20260826_000002_sales_sources from "./20260826_000002_sales_sources.js";
import * as migration_20260826_000003_payload_mcp from "./20260826_000003_payload_mcp.js";
import * as migration_20260826_000004_event_outbox from "./20260826_000004_event_outbox.js";
import * as migration_20260826_000005_outbox_processor from "./20260826_000005_outbox_processor.js";
import * as migration_20260827_000006_sales_opportunities from "./20260827_000006_sales_opportunities.js";
import * as migration_20260829_000007_runtime_extensions from "./20260829_000007_runtime_extensions.js";
import * as migration_20260829_000008_app_storage from "./20260829_000008_app_storage.js";
import * as migration_20260829_000009_extension_activation from "./20260829_000009_extension_activation.js";
import * as migration_20260829_000010_theme_skin_profiles from "./20260829_000010_theme_skin_profiles.js";
import * as migration_20260829_000011_static_deployment from "./20260829_000011_static_deployment.js";
import * as migration_20260829_000012_verified_artifacts from "./20260829_000012_verified_artifacts.js";
import * as migration_20260829_000013_catalog_checkpoints from "./20260829_000013_catalog_checkpoints.js";
import * as migration_20260829_000014_theme_skin_verified_artifacts from "./20260829_000014_theme_skin_verified_artifacts.js";
import * as migration_20260829_000015_extension_capability_authority from "./20260829_000015_extension_capability_authority.js";
import * as migration_20260829_000016_extension_security_quarantine from "./20260829_000016_extension_security_quarantine.js";
import * as migration_20260829_000017_static_release_authority from "./20260829_000017_static_release_authority.js";
import * as migration_20260829_000018_runner_quarantine from "./20260829_000018_runner_quarantine.js";
import * as migration_20260901_000019_authorization_storage from "./20260901_000019_authorization_storage.js";

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
  },
  {
    up: migration_20260829_000010_theme_skin_profiles.up,
    down: migration_20260829_000010_theme_skin_profiles.down,
    name: "20260829_000010_theme_skin_profiles"
  },
  {
    up: migration_20260829_000011_static_deployment.up,
    down: migration_20260829_000011_static_deployment.down,
    name: "20260829_000011_static_deployment"
  },
  {
    up: migration_20260829_000012_verified_artifacts.up,
    down: migration_20260829_000012_verified_artifacts.down,
    name: "20260829_000012_verified_artifacts"
  },
  {
    up: migration_20260829_000013_catalog_checkpoints.up,
    down: migration_20260829_000013_catalog_checkpoints.down,
    name: "20260829_000013_catalog_checkpoints"
  },
  {
    up: migration_20260829_000014_theme_skin_verified_artifacts.up,
    down: migration_20260829_000014_theme_skin_verified_artifacts.down,
    name: "20260829_000014_theme_skin_verified_artifacts"
  },
  {
    up: migration_20260829_000015_extension_capability_authority.up,
    down: migration_20260829_000015_extension_capability_authority.down,
    name: "20260829_000015_extension_capability_authority"
  },
  {
    up: migration_20260829_000016_extension_security_quarantine.up,
    down: migration_20260829_000016_extension_security_quarantine.down,
    name: "20260829_000016_extension_security_quarantine"
  },
  {
    up: migration_20260829_000017_static_release_authority.up,
    down: migration_20260829_000017_static_release_authority.down,
    name: "20260829_000017_static_release_authority"
  },
  {
    up: migration_20260829_000018_runner_quarantine.up,
    down: migration_20260829_000018_runner_quarantine.down,
    name: "20260829_000018_runner_quarantine"
  },
  {
    up: migration_20260901_000019_authorization_storage.up,
    down: migration_20260901_000019_authorization_storage.down,
    name: "20260901_000019_authorization_storage"
  }
];
