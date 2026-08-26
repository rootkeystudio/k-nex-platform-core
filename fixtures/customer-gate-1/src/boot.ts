import { getPayload, type Payload, type SanitizedConfig } from "payload";

import payloadConfig from "./payload.config.js";
import { assertApplicationMigrationRevision } from "./migration-revision.js";

export interface BootGate1ApplicationOptions {
  readonly config?: Promise<SanitizedConfig>;
  readonly key: string;
}

export async function bootGate1Application(options: BootGate1ApplicationOptions): Promise<Payload> {
  const payload = await getPayload({ config: options.config ?? payloadConfig, key: options.key });
  try {
    await assertApplicationMigrationRevision(payload);
    return payload;
  } catch (error) {
    await payload.destroy();
    throw error;
  }
}
