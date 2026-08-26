import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query("DELETE FROM k_nex_outbox WHERE event_id IN ('p3-6-worker-event', 'p3-9-backplane-event')");
  await client.query(`
    INSERT INTO k_nex_outbox (
      event_id, event_type, schema_version, message_class, occurred_at,
      application_id, plugin_id, correlation_id, idempotency_key, payload, retention_until
    ) VALUES (
      'p3-6-worker-event', 'sales.task.created', 1, 'durable-workflow', now(),
      'customer-gate-1', 'module.sales', 'p3-6-worker-correlation', 'p3-6-worker-event',
      '{"ownerId":"owner-1","revision":6}'::jsonb, now() + interval '1 day'
    ), (
      'p3-9-backplane-event', 'sales.task.created', 1, 'durable-workflow', now(),
      'customer-gate-1', 'module.sales', 'p3-9-backplane-correlation', 'p3-9-backplane-event',
      '{"ownerId":"owner-1","revision":7}'::jsonb, now() + interval '1 day'
    )
  `);
  await client.query("COMMIT");
  process.stdout.write("P3_6_WORKER_COMMIT_PASS\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

process.exit(0);
