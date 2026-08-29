import { ExtensionLifecycleEventSchema } from "@k-nex/contracts";
import type { RuntimeExtensionInvalidation } from "@k-nex/runtime";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export interface RuntimeExtensionInvalidationSink {
  publish(invalidation: RuntimeExtensionInvalidation): Promise<void>;
}

export type DispatchRuntimeExtensionOutboxResult =
  | Readonly<{ status: "idle" }>
  | Readonly<{ eventId: string; invalidation: RuntimeExtensionInvalidation; status: "delivered" }>;

interface RuntimeExtensionOutboxRow {
  event_id: string;
  application_id: string;
  environment: string;
  delivery_class: "platform-plugin" | "hot-application" | "theme-skin";
  extension_id: string;
  inventory_revision: number;
  event_json: unknown;
}

function invalidation(row: RuntimeExtensionOutboxRow): RuntimeExtensionInvalidation {
  const event = ExtensionLifecycleEventSchema.parse(row.event_json);
  if (event.applicationId !== row.application_id || event.environment !== row.environment || event.deliveryClass !== row.delivery_class ||
    event.id !== row.extension_id || event.inventoryRevision !== row.inventory_revision) {
    throw new Error("Runtime extension outbox event does not match its persisted invalidation identity.");
  }
  return Object.freeze({
    applicationId: row.application_id,
    environment: row.environment,
    extension: Object.freeze({ deliveryClass: row.delivery_class, id: row.extension_id }),
    inventoryRevision: row.inventory_revision
  });
}

/** Claims the persisted runtime outbox before publishing a reconstructible invalidation. */
export class PostgresRuntimeExtensionOutboxDispatcher {
  constructor(private readonly pool: RuntimeExtensionPool) {}

  async dispatchNext(sink: RuntimeExtensionInvalidationSink): Promise<DispatchRuntimeExtensionOutboxResult> {
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      const selected = await session.query<RuntimeExtensionOutboxRow>(
        `select event_id, application_id, environment, delivery_class, extension_id, inventory_revision, event_json
         from runtime_extension_outbox where status='pending'
         order by inventory_revision, event_id for update skip locked limit 1`
      );
      const row = selected.rows[0];
      if (!row) {
        await session.query("commit");
        return Object.freeze({ status: "idle" });
      }
      const message = invalidation(row);
      await sink.publish(message);
      const delivered = await session.query(
        `update runtime_extension_outbox set status='delivered' where event_id=$1 and status='pending'`,
        [row.event_id]
      );
      if (delivered.rowCount !== 1) throw new Error("Runtime extension outbox claim was lost.");
      await session.query("commit");
      return Object.freeze({ eventId: row.event_id, invalidation: message, status: "delivered" });
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve the dispatch error */ }
      throw error;
    } finally {
      session.release();
    }
  }
}
