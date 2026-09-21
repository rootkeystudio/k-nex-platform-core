import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(`CREATE TABLE sales_workflow_executions (
    id bigserial PRIMARY KEY,
    application_id varchar(128) NOT NULL,
    environment varchar(64) NOT NULL,
    source_event_id varchar(128) NOT NULL,
    source_event_digest varchar(71) NOT NULL,
    source_occurred_at timestamptz NOT NULL,
    source_idempotency_key varchar(128),
    workflow_id varchar(128) NOT NULL,
    workflow_version integer NOT NULL,
    trigger_event_type varchar(128) NOT NULL,
    message_class varchar(32) NOT NULL,
    effect_kind varchar(32) NOT NULL,
    target_object_type varchar(64) NOT NULL,
    target_record_id varchar(128) NOT NULL,
    target_revision integer NOT NULL,
    actor_id varchar(160) NOT NULL,
    recipient_id varchar(160) NOT NULL,
    accepted_owner_id varchar(160) NOT NULL,
    authorization_revision integer NOT NULL,
    lifecycle_revision integer NOT NULL,
    scope_revision integer NOT NULL,
    accepted_at timestamptz NOT NULL,
    scheduled_at timestamptz,
    payload_json jsonb NOT NULL,
    payload_digest varchar(71) NOT NULL,
    effect_key varchar(71) NOT NULL,
    state varchar(16) NOT NULL DEFAULT 'queued',
    attempt integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    worker_generation_id varchar(128),
    worker_fencing_token bigint,
    worker_promotion_revision integer,
    worker_lease_owner varchar(160),
    lease_revision integer NOT NULL DEFAULT 0,
    lease_expires_at timestamptz,
    failure_code varchar(64),
    revision integer NOT NULL DEFAULT 1,
    audit jsonb NOT NULL DEFAULT '[]'::jsonb,
    terminal_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(application_id,environment,source_event_id),
    UNIQUE(application_id,environment,effect_key),
    UNIQUE(application_id,environment,id),
    CHECK(application_id<>'' AND environment<>'' AND source_event_id<>'' AND source_event_digest ~ '^sha256:[0-9a-f]{64}$' AND
      workflow_id IN ('sales.workflow.opportunity-proposal-follow-up','sales.workflow.lead-owner-assigned-notification','sales.workflow.scheduled-activity-reminder') AND workflow_version=1 AND
      trigger_event_type IN ('sales.event.workflow.opportunity-proposal-entered','sales.event.workflow.lead-owner-assigned','sales.event.workflow.activity-scheduled') AND message_class='durable-workflow' AND
      effect_kind IN ('task','notification','reminder') AND target_object_type IN ('sales.object.opportunity','sales.object.lead','sales.object.activity') AND target_record_id ~ '^[1-9][0-9]*$' AND target_revision BETWEEN 1 AND 1000000000 AND
      length(actor_id) BETWEEN 1 AND 160 AND length(recipient_id) BETWEEN 1 AND 160 AND length(accepted_owner_id) BETWEEN 1 AND 160 AND
      authorization_revision BETWEEN 1 AND 1000000000 AND lifecycle_revision BETWEEN 0 AND 1000000000 AND scope_revision BETWEEN 1 AND 1000000000 AND
      payload_digest ~ '^sha256:[0-9a-f]{64}$' AND effect_key ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=32768 AND
      state IN ('queued','running','succeeded','dead-letter') AND attempt BETWEEN 0 AND 3 AND lease_revision BETWEEN 0 AND 1000000000 AND revision BETWEEN 1 AND 1000000000 AND
      jsonb_typeof(audit)='array' AND jsonb_array_length(audit)=revision AND
      (source_idempotency_key IS NULL OR source_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') AND
      (failure_code IS NULL OR failure_code IN ('WORKFLOW_AUTH_RECHECK_FAILED','WORKFLOW_SCOPE_RECHECK_FAILED','WORKFLOW_STALE_FENCE','WORKFLOW_IDEMPOTENCY_CONFLICT','WORKFLOW_TARGET_MISSING','WORKFLOW_EFFECT_FAILED','WORKFLOW_RETRY_EXHAUSTED')) AND
      ((state='running' AND worker_generation_id IS NOT NULL AND worker_fencing_token BETWEEN 1 AND 9007199254740991 AND worker_promotion_revision BETWEEN 0 AND 1000000000 AND worker_lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
       (state<>'running' AND worker_generation_id IS NULL AND worker_fencing_token IS NULL AND worker_promotion_revision IS NULL AND worker_lease_owner IS NULL AND lease_expires_at IS NULL)) AND
      ((workflow_id='sales.workflow.opportunity-proposal-follow-up' AND trigger_event_type='sales.event.workflow.opportunity-proposal-entered' AND effect_kind='task' AND target_object_type='sales.object.opportunity' AND scheduled_at IS NULL AND recipient_id=accepted_owner_id) OR
       (workflow_id='sales.workflow.lead-owner-assigned-notification' AND trigger_event_type='sales.event.workflow.lead-owner-assigned' AND effect_kind='notification' AND target_object_type='sales.object.lead' AND scheduled_at IS NULL AND recipient_id=accepted_owner_id) OR
       (workflow_id='sales.workflow.scheduled-activity-reminder' AND trigger_event_type='sales.event.workflow.activity-scheduled' AND effect_kind='reminder' AND target_object_type='sales.object.activity' AND scheduled_at IS NOT NULL AND recipient_id=actor_id)))
  );
  CREATE INDEX sales_workflow_executions_ready_idx ON sales_workflow_executions(application_id,environment,state,next_attempt_at,id) WHERE state='queued';
  CREATE INDEX sales_workflow_executions_lease_idx ON sales_workflow_executions(application_id,environment,lease_expires_at,id) WHERE state='running';

  CREATE TABLE sales_workflow_trigger_receipts (
    application_id varchar(128) NOT NULL,
    environment varchar(64) NOT NULL,
    source_event_id varchar(128) NOT NULL,
    source_event_digest varchar(71) NOT NULL,
    payload_digest varchar(71) NOT NULL,
    state varchar(16) NOT NULL,
    execution_id bigint,
    failure_code varchar(64),
    audit jsonb NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(application_id,environment,source_event_id),
    CHECK(application_id<>'' AND environment<>'' AND source_event_id<>'' AND source_event_digest ~ '^sha256:[0-9a-f]{64}$' AND payload_digest ~ '^sha256:[0-9a-f]{64}$' AND
      state IN ('accepted','rejected') AND jsonb_typeof(audit)='array' AND jsonb_array_length(audit)=1 AND
      ((state='accepted' AND execution_id IS NOT NULL AND failure_code IS NULL) OR (state='rejected' AND execution_id IS NULL AND failure_code='WORKFLOW_PAYLOAD_INVALID'))),
    FOREIGN KEY(application_id,environment,execution_id) REFERENCES sales_workflow_executions(application_id,environment,id) ON DELETE RESTRICT
  );
  CREATE INDEX sales_workflow_trigger_receipts_lookup_idx ON sales_workflow_trigger_receipts(application_id,environment,state,source_event_id);
  CREATE FUNCTION public.sales_workflow_trigger_receipt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    BEGIN RAISE EXCEPTION 'P13.7 workflow trigger receipt is immutable' USING ERRCODE='55000'; END; $$;
  REVOKE ALL ON FUNCTION public.sales_workflow_trigger_receipt_immutable() FROM PUBLIC;
  CREATE TRIGGER sales_workflow_trigger_receipt_immutable BEFORE UPDATE OR DELETE ON sales_workflow_trigger_receipts FOR EACH ROW EXECUTE FUNCTION public.sales_workflow_trigger_receipt_immutable();

  CREATE TABLE sales_workflow_effect_receipts (
    effect_key varchar(71) PRIMARY KEY,
    execution_id bigint NOT NULL,
    application_id varchar(128) NOT NULL,
    environment varchar(64) NOT NULL,
    effect_kind varchar(32) NOT NULL,
    target_object_type varchar(64) NOT NULL,
    target_record_id varchar(128) NOT NULL,
    recipient_id varchar(160) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(execution_id),
    FOREIGN KEY(application_id,environment,execution_id) REFERENCES sales_workflow_executions(application_id,environment,id) ON DELETE RESTRICT,
    CHECK(effect_key ~ '^sha256:[0-9a-f]{64}$' AND effect_kind IN ('task','notification','reminder') AND target_object_type IN ('sales.object.opportunity','sales.object.lead','sales.object.activity') AND target_record_id ~ '^[1-9][0-9]*$' AND recipient_id<>'')
  );
  CREATE INDEX sales_workflow_effect_receipts_execution_idx ON sales_workflow_effect_receipts(application_id,environment,execution_id);
  CREATE FUNCTION public.sales_workflow_effect_receipt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    BEGIN RAISE EXCEPTION 'P13.7 workflow effect receipt is immutable' USING ERRCODE='55000'; END; $$;
  REVOKE ALL ON FUNCTION public.sales_workflow_effect_receipt_immutable() FROM PUBLIC;
  CREATE TRIGGER sales_workflow_effect_receipt_immutable BEFORE UPDATE OR DELETE ON sales_workflow_effect_receipts FOR EACH ROW EXECUTE FUNCTION public.sales_workflow_effect_receipt_immutable();

  CREATE TABLE sales_workflow_execution_audit (
    application_id varchar(128) NOT NULL,
    environment varchar(64) NOT NULL,
    execution_id bigint NOT NULL,
    revision integer NOT NULL,
    from_state varchar(16) NOT NULL,
    to_state varchar(16) NOT NULL,
    action_id varchar(128) NOT NULL,
    evidence jsonb NOT NULL,
    digest varchar(71) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(application_id,environment,execution_id,revision),
    FOREIGN KEY(application_id,environment,execution_id) REFERENCES sales_workflow_executions(application_id,environment,id) ON DELETE RESTRICT,
    CHECK(from_state IN ('absent','queued','running','succeeded','dead-letter') AND to_state IN ('queued','running','succeeded','dead-letter') AND action_id='sales.job.crm-workflow-execution' AND jsonb_typeof(evidence)='object' AND evidence ?& ARRAY['actionId','resourceId','applicationId','environment','fromState','toState','occurredAt','actorId','revision','idempotencyKey'] AND digest ~ '^sha256:[0-9a-f]{64}$')
  );
  CREATE FUNCTION public.sales_workflow_execution_audit_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    BEGIN RAISE EXCEPTION 'P13.7 workflow execution audit is immutable' USING ERRCODE='55000'; END; $$;
  REVOKE ALL ON FUNCTION public.sales_workflow_execution_audit_immutable() FROM PUBLIC;
  CREATE TRIGGER sales_workflow_execution_audit_immutable BEFORE UPDATE OR DELETE ON sales_workflow_execution_audit FOR EACH ROW EXECUTE FUNCTION public.sales_workflow_execution_audit_immutable();

  ALTER TABLE sales_notifications DROP CONSTRAINT IF EXISTS sales_notifications_check;
  ALTER TABLE sales_notifications ADD CONSTRAINT sales_notifications_check CHECK(length(recipient_id) BETWEEN 1 AND 160 AND length(subject) BETWEEN 1 AND 256 AND (reference_kind IS NULL)=(reference_id IS NULL) AND (reference_kind IS NULL OR reference_kind IN ('task','activity','lead','provider-webhook')) AND state IN ('unread','read','archived') AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=4096 AND jsonb_typeof(audit)='array' AND delivered_at>=created_at AND ((state='unread' AND read_at IS NULL AND archived_at IS NULL) OR (state='read' AND read_at IS NOT NULL AND archived_at IS NULL) OR (state='archived' AND archived_at IS NOT NULL)));
`));
}

export async function down(_args: MigrateDownArgs): Promise<void> { throw new Error("maintenance-required: P13.7 workflow execution evidence is forward-only"); }
