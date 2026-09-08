/**
 * P13.8 report persistence is application-owned.  The module owns the closed
 * report catalog; this migration owns only bounded run, schedule, artifact,
 * and immutable evidence storage.
 */
export interface ReportsMigrationOptions {
  /** Factory-bound canonical currency. Omitted means legacy upgrades require persisted evidence. */
  readonly primaryCurrency?: string;
}

export function reportsMigrationSource(options: ReportsMigrationOptions = {}): string {
  const isoCurrencies = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [];
  const isIsoCurrency = (value: unknown): value is string => typeof value === "string" && isoCurrencies.includes(value);
  if (options.primaryCurrency !== undefined && !isIsoCurrency(options.primaryCurrency)) {
    throw new Error("Reports migration primary currency must be an uppercase ISO-4217 code.");
  }
  const configuredPrimaryCurrency = options.primaryCurrency === undefined ? "NULL::text" : `'${options.primaryCurrency}'::text`;
  const isoCurrencySql = isoCurrencies.map((code) => `'${code}'`).join(",");
  return `import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql\`
    DO $$
    DECLARE current_document record; current_currency text; opportunity_currency text; receipt_currency text;
      configured_primary_currency text := ${configuredPrimaryCurrency};
      opportunity_currency_count integer; receipt_currency_count integer;
    BEGIN
      IF to_regclass('public.k_nex_system_settings_documents') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM k_nex_system_settings_documents WHERE descriptor_id='system.general' AND owner_scope_key='platform:system' AND descriptor_schema_version NOT IN (2,3)) OR
           EXISTS (SELECT 1 FROM k_nex_system_settings_documents WHERE descriptor_id='system.general' AND owner_scope_key='platform:system' GROUP BY application_id,environment HAVING count(*)<>1) THEN
          RAISE EXCEPTION 'maintenance-required: system.general reporting settings predecessor is ambiguous';
        END IF;
        FOR current_document IN
          SELECT application_id,environment,descriptor_schema_version,values_json
            FROM k_nex_system_settings_documents
           WHERE descriptor_id='system.general' AND owner_scope_key='platform:system'
           ORDER BY application_id,environment
        LOOP
          IF current_document.descriptor_schema_version = 2 THEN
            current_currency := NULL; opportunity_currency := NULL; receipt_currency := NULL;
            opportunity_currency_count := 0;
            receipt_currency_count := 0;
            IF to_regclass('public.sales_opportunities') IS NOT NULL THEN
              EXECUTE 'SELECT count(DISTINCT currency)::integer, min(currency) FROM sales_opportunities WHERE application_id=$1 AND environment=$2 AND currency IS NOT NULL'
                INTO opportunity_currency_count,opportunity_currency
                USING current_document.application_id,current_document.environment;
            END IF;
            IF to_regclass('public.sales_crm_migration_receipts') IS NOT NULL THEN
              EXECUTE 'SELECT count(DISTINCT currency)::integer, min(currency) FROM sales_crm_migration_receipts WHERE application_id=$1 AND environment=$2 AND currency IS NOT NULL'
                INTO receipt_currency_count,receipt_currency
                USING current_document.application_id,current_document.environment;
            END IF;
            IF opportunity_currency_count > 1 OR receipt_currency_count > 1 OR
               opportunity_currency_count = 1 AND receipt_currency_count = 1 AND opportunity_currency IS DISTINCT FROM receipt_currency THEN
              RAISE EXCEPTION 'maintenance-required: reporting currency evidence is conflicting';
            END IF;
            current_currency := CASE WHEN opportunity_currency_count = 1 THEN opportunity_currency
              WHEN receipt_currency_count = 1 THEN receipt_currency ELSE configured_primary_currency END;
            IF current_currency IS NULL OR NOT (current_currency = ANY(ARRAY[${isoCurrencySql}]::text[])) THEN
              RAISE EXCEPTION 'maintenance-required: reporting currency cannot be proven while upgrading system.general to v3';
            END IF;
            IF (opportunity_currency_count = 1 OR receipt_currency_count = 1) AND configured_primary_currency IS NOT NULL AND current_currency <> configured_primary_currency THEN
              RAISE EXCEPTION 'maintenance-required: configured reporting currency conflicts with predecessor evidence';
            END IF;
            UPDATE k_nex_system_settings_documents
               SET descriptor_schema_version=3,
                   values_json=jsonb_build_object('siteName',current_document.values_json->>'siteName','reportingCurrency',current_currency,'reportingTimezone',current_document.values_json->>'reportingTimezone')
             WHERE application_id=current_document.application_id AND environment=current_document.environment AND descriptor_id='system.general' AND owner_scope_key='platform:system' AND descriptor_schema_version=2;
          ELSIF current_document.descriptor_schema_version IS DISTINCT FROM 3 THEN
            RAISE EXCEPTION 'maintenance-required: system.general reporting settings v3 are unavailable';
          END IF;
        END LOOP;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS sales_report_source_watermarks (
      application_id text NOT NULL,
      environment text NOT NULL,
      source_id text NOT NULL,
      revision bigint NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(application_id,environment,source_id),
      CHECK(application_id<>'' AND environment<>'' AND source_id IN ('sales.report.pipeline-value-by-stage','sales.report.weighted-forecast','sales.report.won-lost-conversion','sales.report.lead-conversion','sales.report.activity-by-owner-team','sales.report.task-aging','sales.report.sales-cycle-duration') AND revision BETWEEN 1 AND 9007199254740991)
    );
    INSERT INTO sales_report_source_watermarks(application_id,environment,source_id,revision)
      SELECT scope.application_id,scope.environment,source_id,1
      FROM (SELECT DISTINCT application_id,environment FROM k_nex_system_settings_state) scope
      CROSS JOIN (VALUES
        ('sales.report.pipeline-value-by-stage'),('sales.report.weighted-forecast'),('sales.report.won-lost-conversion'),
        ('sales.report.lead-conversion'),('sales.report.activity-by-owner-team'),('sales.report.task-aging'),('sales.report.sales-cycle-duration')
      ) sources(source_id)
      ON CONFLICT(application_id,environment,source_id) DO NOTHING;
    CREATE OR REPLACE FUNCTION sales_seed_report_source_watermarks() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO sales_report_source_watermarks(application_id,environment,source_id,revision)
        SELECT NEW.application_id,NEW.environment,source_id,1
        FROM (VALUES
          ('sales.report.pipeline-value-by-stage'),('sales.report.weighted-forecast'),('sales.report.won-lost-conversion'),
          ('sales.report.lead-conversion'),('sales.report.activity-by-owner-team'),('sales.report.task-aging'),('sales.report.sales-cycle-duration')
        ) sources(source_id)
        ON CONFLICT(application_id,environment,source_id) DO NOTHING;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS sales_settings_state_report_watermarks ON k_nex_system_settings_state;
    CREATE TRIGGER sales_settings_state_report_watermarks AFTER INSERT ON k_nex_system_settings_state FOR EACH ROW EXECUTE FUNCTION sales_seed_report_source_watermarks();
    DROP TRIGGER IF EXISTS sales_general_settings_report_watermarks ON k_nex_system_settings_documents;
    CREATE TRIGGER sales_general_settings_report_watermarks AFTER INSERT ON k_nex_system_settings_documents FOR EACH ROW WHEN (NEW.descriptor_id='system.general' AND NEW.owner_scope_key='platform:system') EXECUTE FUNCTION sales_seed_report_source_watermarks();
    CREATE OR REPLACE FUNCTION sales_bump_report_source_watermarks() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE source_name text; old_application text; old_environment text; new_application text; new_environment text;
    BEGIN
      IF TG_OP <> 'INSERT' THEN old_application := OLD.application_id; old_environment := OLD.environment; END IF;
      IF TG_OP <> 'DELETE' THEN new_application := NEW.application_id; new_environment := NEW.environment; END IF;
      FOREACH source_name IN ARRAY TG_ARGV LOOP
        IF TG_OP <> 'INSERT' THEN
          INSERT INTO sales_report_source_watermarks(application_id,environment,source_id) VALUES(old_application,old_environment,source_name) ON CONFLICT DO NOTHING;
          UPDATE sales_report_source_watermarks SET revision=revision+1,updated_at=statement_timestamp() WHERE application_id=old_application AND environment=old_environment AND source_id=source_name;
        END IF;
        IF TG_OP <> 'DELETE' AND (TG_OP <> 'UPDATE' OR old_application IS DISTINCT FROM new_application OR old_environment IS DISTINCT FROM new_environment) THEN
          INSERT INTO sales_report_source_watermarks(application_id,environment,source_id) VALUES(new_application,new_environment,source_name) ON CONFLICT DO NOTHING;
          UPDATE sales_report_source_watermarks SET revision=revision+1,updated_at=statement_timestamp() WHERE application_id=new_application AND environment=new_environment AND source_id=source_name;
        END IF;
      END LOOP;
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $$;
    DROP TRIGGER IF EXISTS sales_opportunities_report_watermark ON sales_opportunities;
    CREATE TRIGGER sales_opportunities_report_watermark AFTER INSERT OR UPDATE OR DELETE ON sales_opportunities FOR EACH ROW EXECUTE FUNCTION sales_bump_report_source_watermarks('sales.report.pipeline-value-by-stage','sales.report.weighted-forecast','sales.report.won-lost-conversion','sales.report.sales-cycle-duration');
    DROP TRIGGER IF EXISTS sales_pipeline_stages_report_watermark ON sales_pipeline_stages;
    CREATE TRIGGER sales_pipeline_stages_report_watermark AFTER INSERT OR UPDATE OR DELETE ON sales_pipeline_stages FOR EACH ROW EXECUTE FUNCTION sales_bump_report_source_watermarks('sales.report.pipeline-value-by-stage','sales.report.weighted-forecast','sales.report.won-lost-conversion','sales.report.sales-cycle-duration');
    DROP TRIGGER IF EXISTS sales_leads_report_watermark ON sales_leads;
    CREATE TRIGGER sales_leads_report_watermark AFTER INSERT OR UPDATE OR DELETE ON sales_leads FOR EACH ROW EXECUTE FUNCTION sales_bump_report_source_watermarks('sales.report.lead-conversion');
    DROP TRIGGER IF EXISTS sales_activities_report_watermark ON sales_activities;
    CREATE TRIGGER sales_activities_report_watermark AFTER INSERT OR UPDATE OR DELETE ON sales_activities FOR EACH ROW EXECUTE FUNCTION sales_bump_report_source_watermarks('sales.report.activity-by-owner-team');
    DROP TRIGGER IF EXISTS sales_tasks_report_watermark ON sales_tasks;
    CREATE TRIGGER sales_tasks_report_watermark AFTER INSERT OR UPDATE OR DELETE ON sales_tasks FOR EACH ROW EXECUTE FUNCTION sales_bump_report_source_watermarks('sales.report.task-aging');

    CREATE TABLE IF NOT EXISTS sales_report_schedules (
      schedule_id text PRIMARY KEY,
      application_id text NOT NULL,
      environment text NOT NULL,
      creator_id text NOT NULL,
      recipient_id text NOT NULL,
      report_id text NOT NULL,
      window_mode text NOT NULL,
      weekday integer NOT NULL,
      local_time text NOT NULL,
      authorization_revision integer NOT NULL,
      lifecycle_revision integer NOT NULL,
      scope_revision integer NOT NULL,
      revision integer NOT NULL DEFAULT 1,
      state text NOT NULL DEFAULT 'active',
      next_run_at timestamptz,
      runtime_generation_id text,
      report_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb,
      object_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb,
      field_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb,
      audit jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(application_id, environment, creator_id, recipient_id, report_id),
      CHECK(application_id<>'' AND environment<>'' AND creator_id<>'' AND recipient_id<>'' AND
        report_id IN ('sales.report.pipeline-value-by-stage','sales.report.weighted-forecast','sales.report.won-lost-conversion','sales.report.lead-conversion','sales.report.activity-by-owner-team','sales.report.task-aging','sales.report.sales-cycle-duration') AND
        window_mode IN ('as-of','current-reporting-week','previous-complete-reporting-week','current-reporting-month','previous-complete-reporting-month') AND
        weekday BETWEEN 1 AND 7 AND local_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND
        authorization_revision BETWEEN 1 AND 1000000000 AND lifecycle_revision BETWEEN 0 AND 1000000000 AND scope_revision BETWEEN 1 AND 1000000000 AND
        revision BETWEEN 1 AND 1000000000 AND state IN ('active','cancelled') AND creator_id=recipient_id AND
        jsonb_typeof(report_permission_grants)='array' AND jsonb_typeof(object_permission_grants)='array' AND jsonb_typeof(field_permission_grants)='array' AND jsonb_typeof(audit)='array' AND
        (state='active' AND next_run_at IS NOT NULL OR state='cancelled' AND next_run_at IS NULL))
    );
    ALTER TABLE sales_report_schedules ADD COLUMN IF NOT EXISTS runtime_generation_id text;
    ALTER TABLE sales_report_schedules ADD COLUMN IF NOT EXISTS report_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE sales_report_schedules ADD COLUMN IF NOT EXISTS object_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE sales_report_schedules ADD COLUMN IF NOT EXISTS field_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb;
    CREATE INDEX IF NOT EXISTS sales_report_schedules_due_idx ON sales_report_schedules(application_id,environment,state,next_run_at,schedule_id);
    CREATE INDEX IF NOT EXISTS sales_report_schedules_creator_idx ON sales_report_schedules(application_id,environment,creator_id,state,report_id);

    CREATE TABLE IF NOT EXISTS sales_report_runs (
      run_id text PRIMARY KEY,
      application_id text NOT NULL,
      environment text NOT NULL,
      creator_id text NOT NULL,
      recipient_id text NOT NULL,
      report_id text NOT NULL,
      window_mode text NOT NULL,
      scheduled_for timestamptz,
      requested_at timestamptz NOT NULL,
      authorization_revision integer NOT NULL,
      lifecycle_revision integer NOT NULL,
      scope_revision integer NOT NULL,
      report_revision integer NOT NULL DEFAULT 1,
      report_digest text NOT NULL,
      idempotency_key text NOT NULL,
      state text NOT NULL DEFAULT 'queued',
      revision integer NOT NULL DEFAULT 1,
      attempt integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      worker_generation_id text,
      worker_fencing_token bigint,
      worker_promotion_revision integer,
      worker_lease_owner text,
      lease_revision integer NOT NULL DEFAULT 0,
      lease_expires_at timestamptz,
      source_id text NOT NULL DEFAULT '',
      source_version integer NOT NULL DEFAULT 1,
      source_schema_version integer NOT NULL DEFAULT 1,
      grouping text NOT NULL DEFAULT 'none',
      reporting_timezone text,
      reporting_currency text,
      settings_revision integer,
      as_of timestamptz,
      authorized_record_count integer,
      source_watermark text,
      runtime_generation_id text,
      report_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb,
      object_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb,
      field_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb,
      execution_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      execution_metadata_digest text,
      artifact_id text,
      artifact_digest text,
      failure_code text,
      audit jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      terminal_at timestamptz,
      UNIQUE(application_id, environment, idempotency_key),
      CHECK(application_id<>'' AND environment<>'' AND creator_id<>'' AND recipient_id<>'' AND
        report_id IN ('sales.report.pipeline-value-by-stage','sales.report.weighted-forecast','sales.report.won-lost-conversion','sales.report.lead-conversion','sales.report.activity-by-owner-team','sales.report.task-aging','sales.report.sales-cycle-duration') AND
        window_mode IN ('as-of','current-reporting-week','previous-complete-reporting-week','current-reporting-month','previous-complete-reporting-month') AND
        requested_at IS NOT NULL AND authorization_revision BETWEEN 1 AND 1000000000 AND lifecycle_revision BETWEEN 0 AND 1000000000 AND scope_revision BETWEEN 1 AND 1000000000 AND
        report_revision BETWEEN 1 AND 1000000000 AND report_digest ~ '^sha256:[0-9a-f]{64}$' AND idempotency_key<>'' AND source_version BETWEEN 1 AND 1000000000 AND source_schema_version BETWEEN 1 AND 1000000000 AND
        (authorized_record_count IS NULL OR authorized_record_count BETWEEN 0 AND 1000000000) AND (source_watermark IS NULL OR source_watermark ~ '^sha256:[0-9a-f]{64}$') AND (settings_revision IS NULL OR settings_revision BETWEEN 1 AND 1000000000) AND
        jsonb_typeof(report_permission_grants)='array' AND jsonb_typeof(object_permission_grants)='array' AND jsonb_typeof(field_permission_grants)='array' AND jsonb_typeof(execution_metadata)='object' AND
        (execution_metadata_digest IS NULL OR execution_metadata_digest ~ '^sha256:[0-9a-f]{64}$') AND
        state IN ('queued','running','succeeded','dead-letter') AND revision BETWEEN 1 AND 1000000000 AND attempt BETWEEN 0 AND 3 AND lease_revision BETWEEN 0 AND 1000000000 AND
        (failure_code IS NULL OR failure_code IN ('crashed','REPORT_AUTHORITY_STALE','REPORT_RECIPIENT_FORBIDDEN','REPORT_SOURCE_STALE','REPORT_CURRENCY_MIXED','REPORT_RETRY_EXHAUSTED','REPORT_IDEMPOTENCY_CONFLICT')) AND
        ((state='running' AND worker_generation_id IS NOT NULL AND worker_fencing_token BETWEEN 1 AND 9007199254740991 AND worker_promotion_revision BETWEEN 0 AND 1000000000 AND worker_lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
         (state<>'running' AND worker_generation_id IS NULL AND worker_fencing_token IS NULL AND worker_promotion_revision IS NULL AND worker_lease_owner IS NULL AND lease_expires_at IS NULL)) AND
        (artifact_digest IS NULL OR artifact_digest ~ '^sha256:[0-9a-f]{64}$') AND jsonb_typeof(audit)='array' AND
        (state IN ('succeeded','dead-letter') AND terminal_at IS NOT NULL OR state IN ('queued','running') AND terminal_at IS NULL))
    );
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS source_id text NOT NULL DEFAULT '';
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS source_version integer NOT NULL DEFAULT 1;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS source_schema_version integer NOT NULL DEFAULT 1;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS grouping text NOT NULL DEFAULT 'none';
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS reporting_timezone text;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS reporting_currency text;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS settings_revision integer;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS as_of timestamptz;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS authorized_record_count integer;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS source_watermark text;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS runtime_generation_id text;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS report_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS object_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS field_permission_grants jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS execution_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE sales_report_runs ADD COLUMN IF NOT EXISTS execution_metadata_digest text;
    CREATE INDEX IF NOT EXISTS sales_report_runs_due_idx ON sales_report_runs(application_id,environment,state,next_attempt_at,run_id);

    CREATE TABLE IF NOT EXISTS sales_report_artifacts (
      artifact_id text PRIMARY KEY,
      run_id text NOT NULL UNIQUE REFERENCES sales_report_runs(run_id) ON DELETE RESTRICT,
      bytes bytea,
      digest text NOT NULL,
      byte_length integer NOT NULL,
      content_type text NOT NULL DEFAULT 'text/csv',
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      metadata_digest text,
      CHECK(digest ~ '^sha256:[0-9a-f]{64}$' AND byte_length BETWEEN 0 AND 1048576 AND content_type='text/csv' AND
        (bytes IS NULL OR octet_length(bytes)=byte_length) AND expires_at=created_at+interval '30 days' AND jsonb_typeof(metadata)='object' AND (metadata_digest IS NULL OR metadata_digest ~ '^sha256:[0-9a-f]{64}$'))
    );
    ALTER TABLE sales_report_artifacts ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE sales_report_artifacts ADD COLUMN IF NOT EXISTS metadata_digest text;
    CREATE TABLE IF NOT EXISTS sales_report_delivery_receipts (
      receipt_id text PRIMARY KEY,
      run_id text NOT NULL UNIQUE REFERENCES sales_report_runs(run_id) ON DELETE RESTRICT,
      application_id text NOT NULL,
      environment text NOT NULL,
      recipient_id text NOT NULL,
      artifact_digest text NOT NULL,
      delivered_at timestamptz NOT NULL,
      evidence jsonb NOT NULL,
      digest text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      metadata_digest text,
      CHECK(application_id<>'' AND environment<>'' AND recipient_id<>'' AND artifact_digest ~ '^sha256:[0-9a-f]{64}$' AND digest ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof(evidence)='object' AND jsonb_typeof(metadata)='object' AND (metadata_digest IS NULL OR metadata_digest ~ '^sha256:[0-9a-f]{64}$'))
    );
    ALTER TABLE sales_report_delivery_receipts ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE sales_report_delivery_receipts ADD COLUMN IF NOT EXISTS metadata_digest text;
    CREATE TABLE IF NOT EXISTS sales_report_run_audit (
      audit_id text PRIMARY KEY,
      run_id text NOT NULL REFERENCES sales_report_runs(run_id) ON DELETE RESTRICT,
      application_id text NOT NULL,
      environment text NOT NULL,
      revision integer NOT NULL,
      from_state text NOT NULL,
      to_state text NOT NULL,
      action_id text NOT NULL,
      evidence jsonb NOT NULL,
      digest text NOT NULL,
      occurred_at timestamptz NOT NULL,
      CHECK(application_id<>'' AND environment<>'' AND revision BETWEEN 1 AND 1000000000 AND
        from_state IN ('absent','queued','running','succeeded','dead-letter') AND to_state IN ('queued','running','succeeded','dead-letter') AND
        action_id IN ('sales.report.run','sales.report.schedule','sales.job.report-delivery') AND jsonb_typeof(evidence)='object' AND digest ~ '^sha256:[0-9a-f]{64}$')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sales_report_run_audit_revision_idx ON sales_report_run_audit(run_id,revision);
    CREATE TABLE IF NOT EXISTS sales_report_schedule_audit (
      audit_id text PRIMARY KEY,
      schedule_id text NOT NULL REFERENCES sales_report_schedules(schedule_id) ON DELETE RESTRICT,
      application_id text NOT NULL,
      environment text NOT NULL,
      revision integer NOT NULL,
      evidence jsonb NOT NULL,
      digest text NOT NULL,
      occurred_at timestamptz NOT NULL,
      CHECK(application_id<>'' AND environment<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(evidence)='object' AND digest ~ '^sha256:[0-9a-f]{64}$')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sales_report_schedule_audit_revision_idx ON sales_report_schedule_audit(schedule_id,revision);

    CREATE FUNCTION public.sales_report_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN RAISE EXCEPTION 'P13.8 report evidence is immutable' USING ERRCODE='55000'; END; $$;
    REVOKE ALL ON FUNCTION public.sales_report_evidence_immutable() FROM PUBLIC;
    DROP TRIGGER IF EXISTS sales_report_delivery_receipts_immutable ON sales_report_delivery_receipts;
    CREATE TRIGGER sales_report_delivery_receipts_immutable BEFORE UPDATE OR DELETE ON sales_report_delivery_receipts FOR EACH ROW EXECUTE FUNCTION public.sales_report_evidence_immutable();
    DROP TRIGGER IF EXISTS sales_report_run_audit_immutable ON sales_report_run_audit;
    CREATE TRIGGER sales_report_run_audit_immutable BEFORE UPDATE OR DELETE ON sales_report_run_audit FOR EACH ROW EXECUTE FUNCTION public.sales_report_evidence_immutable();
    DROP TRIGGER IF EXISTS sales_report_schedule_audit_immutable ON sales_report_schedule_audit;
    CREATE TRIGGER sales_report_schedule_audit_immutable BEFORE UPDATE OR DELETE ON sales_report_schedule_audit FOR EACH ROW EXECUTE FUNCTION public.sales_report_evidence_immutable();
    CREATE FUNCTION public.sales_report_artifact_purge_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        IF TG_OP='UPDATE' AND OLD.bytes IS NOT NULL AND NEW.bytes IS NULL AND NEW.artifact_id=OLD.artifact_id AND NEW.run_id=OLD.run_id AND NEW.digest=OLD.digest AND NEW.byte_length=OLD.byte_length AND NEW.content_type=OLD.content_type AND NEW.created_at=OLD.created_at AND NEW.expires_at=OLD.expires_at AND NEW.metadata=OLD.metadata AND NEW.metadata_digest IS NOT DISTINCT FROM OLD.metadata_digest AND OLD.expires_at<=statement_timestamp() THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'P13.8 report artifact is immutable' USING ERRCODE='55000';
      END; $$;
    REVOKE ALL ON FUNCTION public.sales_report_artifact_purge_only() FROM PUBLIC;
    DROP TRIGGER IF EXISTS sales_report_artifact_purge_only ON sales_report_artifacts;
    CREATE TRIGGER sales_report_artifact_purge_only BEFORE UPDATE OR DELETE ON sales_report_artifacts FOR EACH ROW EXECUTE FUNCTION public.sales_report_artifact_purge_only();
  \`);
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error("maintenance-required: P13.8 report runs, schedules, and evidence are forward-only");
}
`;
}
