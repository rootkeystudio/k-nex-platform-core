/** Generates P13.6 durable provider, reminder, and notification state. */
export function communicationsMigrationSource(): string {
  return `import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(\`CREATE TABLE sales_provider_configurations (
    application_id text NOT NULL, environment text NOT NULL, provider_id text NOT NULL, secret_reference text NOT NULL,
    revision integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'active', configured_by text NOT NULL, audit jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
    PRIMARY KEY(application_id,environment,provider_id),
    CHECK(provider_id IN ('email.reference.v1','calendar.reference.v1') AND length(secret_reference) BETWEEN 1 AND 512 AND secret_reference !~ '[[:space:]]' AND revision BETWEEN 1 AND 1000000000 AND state IN ('active','revoked') AND jsonb_typeof(audit)='array' AND (state='active')=(revoked_at IS NULL))
  );
  CREATE TABLE sales_provider_configuration_audit (
    application_id text NOT NULL, environment text NOT NULL, provider_id text NOT NULL, revision integer NOT NULL, audit_data jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(application_id,environment,provider_id,revision),
    FOREIGN KEY(application_id,environment,provider_id) REFERENCES sales_provider_configurations(application_id,environment,provider_id) ON DELETE RESTRICT,
    CHECK(provider_id IN ('email.reference.v1','calendar.reference.v1') AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit_data)='object')
  );
  CREATE TABLE sales_provider_operations (
    operation_id text PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, provider_id text NOT NULL, action_id text NOT NULL, actor_id text NOT NULL,
    related_record_type text, related_record_id bigint, idempotency_digest text NOT NULL, payload_json jsonb NOT NULL, configuration_revision integer NOT NULL,
    authorization_revision integer NOT NULL, lifecycle_revision integer NOT NULL, scope_revision integer NOT NULL, state text NOT NULL, attempt integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL, worker_generation_id text, worker_fencing_token bigint, worker_promotion_revision integer, worker_lease_owner text,
    receipt_digest text, failure_code text, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(application_id,environment,idempotency_digest),
    CHECK(provider_id IN ('email.reference.v1','calendar.reference.v1') AND action_id IN ('sales.email.send','sales.calendar.sync','sales.integration.configure') AND idempotency_digest ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=32768 AND configuration_revision BETWEEN 1 AND 1000000000 AND authorization_revision BETWEEN 1 AND 1000000000 AND lifecycle_revision BETWEEN 0 AND 1000000000 AND scope_revision BETWEEN 1 AND 1000000000 AND state IN ('queued','running','accepted','dead-letter') AND attempt BETWEEN 0 AND 3 AND ((related_record_type IS NULL AND related_record_id IS NULL) OR (related_record_type IN ('sales.account','sales.contact','sales.lead','sales.opportunity','sales.task') AND related_record_id>0)) AND ((state='running')=(worker_generation_id IS NOT NULL AND worker_fencing_token IS NOT NULL AND worker_promotion_revision IS NOT NULL AND worker_lease_owner IS NOT NULL)) AND (receipt_digest IS NULL OR receipt_digest ~ '^sha256:[0-9a-f]{64}$'))
  );
  CREATE INDEX sales_provider_operations_ready_idx ON sales_provider_operations(state,next_attempt_at,created_at);
  CREATE TABLE sales_provider_activity_receipts (
    operation_id text PRIMARY KEY REFERENCES sales_provider_operations(operation_id) ON DELETE RESTRICT, activity_id integer NOT NULL UNIQUE REFERENCES sales_activities(id) ON DELETE RESTRICT, receipt_digest text NOT NULL,
    CHECK(receipt_digest ~ '^sha256:[0-9a-f]{64}$')
  );
  CREATE TABLE sales_provider_webhook_events (
    application_id text NOT NULL, environment text NOT NULL, provider_id text NOT NULL, event_id text NOT NULL, operation_id text NOT NULL REFERENCES sales_provider_operations(operation_id) ON DELETE RESTRICT, payload_digest text NOT NULL, recipient_id text NOT NULL, event_kind text NOT NULL, safe_metadata jsonb NOT NULL, received_at timestamptz NOT NULL,
    PRIMARY KEY(application_id,environment,provider_id,event_id),
    CHECK(provider_id IN ('email.reference.v1','calendar.reference.v1') AND payload_digest ~ '^sha256:[0-9a-f]{64}$' AND length(recipient_id) BETWEEN 1 AND 160 AND event_kind IN ('message-delivered','calendar-synced') AND jsonb_typeof(safe_metadata)='object' AND octet_length(safe_metadata::text)<=4096)
  );
  CREATE TABLE sales_reminders (
    id bigserial PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, recipient_id text NOT NULL, reference_kind text NOT NULL, reference_id text NOT NULL, subject text NOT NULL, scheduled_at timestamptz NOT NULL, delivered_at timestamptz, dismissed_at timestamptz, cancelled_at timestamptz, failed_at timestamptz, failure_reason text, dead_letter_reference text, state text NOT NULL DEFAULT 'scheduled', revision integer NOT NULL DEFAULT 1, attempt integer NOT NULL DEFAULT 0, idempotency_digest text NOT NULL, audit jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(application_id,environment,recipient_id,idempotency_digest),
    CHECK(length(recipient_id) BETWEEN 1 AND 160 AND reference_kind IN ('task','activity') AND length(reference_id) BETWEEN 1 AND 160 AND length(subject) BETWEEN 1 AND 256 AND state IN ('scheduled','delivered','dismissed','cancelled','failed') AND revision BETWEEN 1 AND 1000000000 AND attempt BETWEEN 0 AND 3 AND idempotency_digest ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof(audit)='array' AND ((state='scheduled' AND delivered_at IS NULL AND dismissed_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL) OR (state='delivered' AND delivered_at IS NOT NULL AND dismissed_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL) OR (state='dismissed' AND delivered_at IS NOT NULL AND dismissed_at IS NOT NULL AND cancelled_at IS NULL AND failed_at IS NULL) OR (state='cancelled' AND cancelled_at IS NOT NULL AND delivered_at IS NULL AND dismissed_at IS NULL AND failed_at IS NULL) OR (state='failed' AND failed_at IS NOT NULL AND delivered_at IS NULL AND dismissed_at IS NULL AND cancelled_at IS NULL AND failure_reason IS NOT NULL AND dead_letter_reference IS NOT NULL)))
  );
  CREATE INDEX sales_reminders_due_idx ON sales_reminders(application_id,environment,state,scheduled_at);
  CREATE TABLE sales_notifications (
    id bigserial PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, recipient_id text NOT NULL, subject text NOT NULL, reference_kind text, reference_id text, state text NOT NULL DEFAULT 'unread', revision integer NOT NULL DEFAULT 1, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, audit jsonb NOT NULL DEFAULT '[]'::jsonb, delivered_at timestamptz NOT NULL, read_at timestamptz, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(length(recipient_id) BETWEEN 1 AND 160 AND length(subject) BETWEEN 1 AND 256 AND (reference_kind IS NULL)=(reference_id IS NULL) AND (reference_kind IS NULL OR reference_kind IN ('task','activity','provider-webhook')) AND state IN ('unread','read','archived') AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=4096 AND jsonb_typeof(audit)='array' AND delivered_at>=created_at AND ((state='unread' AND read_at IS NULL AND archived_at IS NULL) OR (state='read' AND read_at IS NOT NULL AND archived_at IS NULL) OR (state='archived' AND archived_at IS NOT NULL)))
  );
  CREATE INDEX sales_notifications_recipient_idx ON sales_notifications(application_id,environment,recipient_id,state,created_at DESC);
  ALTER TABLE payload_locked_documents_rels
    ADD COLUMN sales_notifications_id bigint REFERENCES sales_notifications(id) ON DELETE CASCADE,
    ADD COLUMN sales_reminders_id bigint REFERENCES sales_reminders(id) ON DELETE CASCADE;
  CREATE INDEX payload_locked_documents_rels_sales_notifications_id_idx ON payload_locked_documents_rels(sales_notifications_id);
  CREATE INDEX payload_locked_documents_rels_sales_reminders_id_idx ON payload_locked_documents_rels(sales_reminders_id);
  CREATE FUNCTION public.sales_p136_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN RAISE EXCEPTION 'P13.6 provider webhook evidence is immutable' USING ERRCODE='55000'; END; $$;
  REVOKE ALL ON FUNCTION public.sales_p136_evidence_immutable() FROM PUBLIC;
  CREATE TRIGGER sales_provider_webhook_events_immutable BEFORE UPDATE OR DELETE ON sales_provider_webhook_events FOR EACH ROW EXECUTE FUNCTION public.sales_p136_evidence_immutable();
  CREATE TRIGGER sales_provider_configuration_audit_immutable BEFORE UPDATE OR DELETE ON sales_provider_configuration_audit FOR EACH ROW EXECUTE FUNCTION public.sales_p136_evidence_immutable();\`));
}

export async function down(_args: MigrateDownArgs): Promise<void> { throw new Error("maintenance-required: P13.6 provider state is forward-only"); }
`;
}
