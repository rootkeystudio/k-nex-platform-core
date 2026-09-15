import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE sales_import_uploads (
      artifact_id text PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, actor_id text NOT NULL,
      content_type text NOT NULL DEFAULT 'text/csv', bytes bytea, digest text NOT NULL, byte_length integer NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
      CHECK(artifact_id<>'' AND content_type='text/csv' AND digest ~ '^sha256:[0-9a-f]{64}$' AND byte_length BETWEEN 1 AND 16777219 AND
        (bytes IS NULL OR octet_length(bytes)=byte_length) AND expires_at=received_at+interval '30 days')
    );
    CREATE TABLE sales_import_jobs (
      id bigserial PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, actor_id text NOT NULL,
      target_object_type text NOT NULL, upload_artifact_id text, upload_digest text NOT NULL,
      mapping_canonical_json jsonb, mapping_digest text NOT NULL, schema_revision integer NOT NULL,
      authorization_revision integer NOT NULL, lifecycle_revision integer NOT NULL, scope_revision integer NOT NULL DEFAULT 1,
      field_grants jsonb NOT NULL DEFAULT '[]'::jsonb, permission_grants jsonb NOT NULL, state text NOT NULL, revision integer NOT NULL,
      row_count integer NOT NULL, accepted_rows integer NOT NULL DEFAULT 0, rejected_rows integer NOT NULL DEFAULT 0,
      diagnostic_artifact_id text, diagnostic_digest text, receipt_id text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
      FOREIGN KEY(upload_artifact_id) REFERENCES sales_import_uploads(artifact_id) ON DELETE RESTRICT,
      CHECK(target_object_type IN ('sales.object.lead','sales.object.account','sales.object.contact') AND
        upload_digest ~ '^sha256:[0-9a-f]{64}$' AND mapping_digest ~ '^sha256:[0-9a-f]{64}$' AND
        (mapping_canonical_json IS NULL OR jsonb_typeof(mapping_canonical_json)='array') AND schema_revision BETWEEN 1 AND 1000000000 AND
        authorization_revision BETWEEN 1 AND 1000000000 AND lifecycle_revision BETWEEN 0 AND 1000000000 AND scope_revision BETWEEN 1 AND 1000000000 AND
        jsonb_typeof(field_grants)='array' AND jsonb_typeof(permission_grants)='array' AND state IN ('draft','validated','queued','running','succeeded','partially-failed','failed','cancelled') AND
        revision BETWEEN 1 AND 1000000000 AND row_count BETWEEN 1 AND 10000 AND accepted_rows>=0 AND rejected_rows>=0 AND
        accepted_rows+rejected_rows<=row_count AND (diagnostic_digest IS NULL OR diagnostic_digest ~ '^sha256:[0-9a-f]{64}$') AND
        expires_at=created_at+interval '30 days')
    );
    CREATE INDEX sales_import_jobs_scope_idx ON sales_import_jobs(application_id,environment,actor_id,id);
    CREATE TABLE sales_import_chunks (
      id bigserial UNIQUE,
      import_job_id bigint NOT NULL REFERENCES sales_import_jobs(id) ON DELETE RESTRICT, chunk_index integer NOT NULL,
      row_start integer NOT NULL, row_end_exclusive integer NOT NULL, input_digest text NOT NULL,
      state text NOT NULL DEFAULT 'queued', attempt integer NOT NULL DEFAULT 0, worker_generation_id text,
      worker_fencing_token bigint, worker_promotion_revision integer, worker_lease_owner text,
      lease_revision integer NOT NULL DEFAULT 0, lease_expires_at timestamptz,
      completed_at timestamptz, result_digest text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(import_job_id,chunk_index),
      CHECK(chunk_index>=0 AND row_start=chunk_index*250 AND row_end_exclusive>row_start AND row_end_exclusive<=row_start+250 AND
        input_digest ~ '^sha256:[0-9a-f]{64}$' AND state IN ('queued','claimed','completed','failed') AND attempt BETWEEN 0 AND 3 AND
        lease_revision BETWEEN 0 AND 1000000000 AND
        ((state='claimed' AND attempt>=1 AND worker_generation_id IS NOT NULL AND worker_fencing_token BETWEEN 1 AND 9007199254740991 AND worker_promotion_revision BETWEEN 0 AND 1000000000 AND worker_lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
         (state<>'claimed' AND worker_generation_id IS NULL AND worker_fencing_token IS NULL AND worker_promotion_revision IS NULL AND worker_lease_owner IS NULL)) AND
        (result_digest IS NULL OR result_digest ~ '^sha256:[0-9a-f]{64}$'))
    );
    CREATE TABLE sales_import_rows (
      id bigserial UNIQUE,
      import_job_id bigint NOT NULL REFERENCES sales_import_jobs(id) ON DELETE RESTRICT, one_based_data_row integer NOT NULL,
      row_digest text NOT NULL, canonical_mapped_json jsonb, mapped_digest text, outcome text NOT NULL DEFAULT 'pending', target_record_id bigint,
      diagnostic_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(import_job_id,one_based_data_row),
      CHECK(one_based_data_row BETWEEN 1 AND 10000 AND row_digest ~ '^sha256:[0-9a-f]{64}$' AND
        (canonical_mapped_json IS NULL OR jsonb_typeof(canonical_mapped_json)='object') AND (mapped_digest IS NULL OR mapped_digest ~ '^sha256:[0-9a-f]{64}$') AND outcome IN ('pending','accepted','rejected') AND
        ((outcome='pending' AND canonical_mapped_json IS NOT NULL AND mapped_digest IS NOT NULL AND target_record_id IS NULL AND diagnostic_code IS NULL) OR
         (outcome='accepted' AND canonical_mapped_json IS NULL AND mapped_digest IS NOT NULL AND target_record_id IS NOT NULL AND diagnostic_code IS NULL) OR
         (outcome='rejected' AND target_record_id IS NULL AND diagnostic_code IS NOT NULL)))
    );
    CREATE TABLE sales_import_diagnostics (
      id bigserial PRIMARY KEY, job_id bigint NOT NULL REFERENCES sales_import_jobs(id) ON DELETE RESTRICT,
      one_based_data_row integer NOT NULL, column_name text, code text NOT NULL, public_message text,
      artifact_offset integer, UNIQUE(job_id,one_based_data_row),
      CHECK(one_based_data_row BETWEEN 1 AND 10000 AND code<>'' AND (public_message IS NULL OR public_message<>'') AND (artifact_offset IS NULL OR artifact_offset>=0))
    );
    CREATE TABLE sales_import_diagnostic_artifacts (
      artifact_id text PRIMARY KEY, import_job_id bigint NOT NULL UNIQUE REFERENCES sales_import_jobs(id) ON DELETE RESTRICT,
      bytes bytea, digest text NOT NULL, content_type text NOT NULL DEFAULT 'text/csv', byte_length integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
      CHECK(digest ~ '^sha256:[0-9a-f]{64}$' AND content_type='text/csv' AND byte_length BETWEEN 0 AND 16777216 AND
        (bytes IS NULL OR octet_length(bytes)=byte_length) AND expires_at=created_at+interval '30 days')
    );
    CREATE TABLE sales_import_receipts (
      receipt_id text PRIMARY KEY, job_id bigint NOT NULL UNIQUE REFERENCES sales_import_jobs(id) ON DELETE RESTRICT,
      evidence jsonb NOT NULL, digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(jsonb_typeof(evidence)='object' AND digest ~ '^sha256:[0-9a-f]{64}$')
    );

    CREATE TABLE sales_export_jobs (
      id bigserial PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, actor_id text NOT NULL,
      target_object_type text NOT NULL, source_id text NOT NULL, source_version integer NOT NULL, source_schema_version integer NOT NULL,
      source_hash text NOT NULL, query_canonical_json jsonb, query_digest text NOT NULL, selected_fields jsonb NOT NULL,
      authorization_revision integer NOT NULL, lifecycle_revision integer NOT NULL, scope_revision integer NOT NULL DEFAULT 1,
      field_grants jsonb NOT NULL DEFAULT '[]'::jsonb, permission_grants jsonb NOT NULL, snapshot_revision integer NOT NULL, snapshot_digest text NOT NULL,
      state text NOT NULL DEFAULT 'queued', revision integer NOT NULL DEFAULT 1, row_count integer NOT NULL,
      worker_generation_id text, worker_fencing_token bigint, worker_promotion_revision integer, worker_lease_owner text, lease_revision integer NOT NULL DEFAULT 0,
      lease_expires_at timestamptz, attempt integer NOT NULL DEFAULT 0, artifact_id text, artifact_digest text,
      receipt_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
      CHECK(target_object_type IN ('sales.object.lead','sales.object.account','sales.object.contact') AND source_version=1 AND source_schema_version=1 AND
        source_hash ~ '^sha256:[0-9a-f]{64}$' AND (query_canonical_json IS NULL OR jsonb_typeof(query_canonical_json)='object') AND query_digest ~ '^sha256:[0-9a-f]{64}$' AND
        jsonb_typeof(selected_fields)='array' AND authorization_revision BETWEEN 1 AND 1000000000 AND lifecycle_revision BETWEEN 0 AND 1000000000 AND scope_revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(field_grants)='array' AND jsonb_typeof(permission_grants)='array' AND snapshot_revision BETWEEN 1 AND 1000000000 AND
        snapshot_digest ~ '^sha256:[0-9a-f]{64}$' AND state IN ('queued','running','succeeded','failed','cancelled') AND revision BETWEEN 1 AND 1000000000 AND
        row_count BETWEEN 0 AND 10000 AND lease_revision BETWEEN 0 AND 1000000000 AND attempt BETWEEN 0 AND 3 AND
        ((state='running' AND worker_generation_id IS NOT NULL AND worker_fencing_token BETWEEN 1 AND 9007199254740991 AND worker_promotion_revision BETWEEN 0 AND 1000000000 AND worker_lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
         (state<>'running' AND worker_generation_id IS NULL AND worker_fencing_token IS NULL AND worker_promotion_revision IS NULL AND worker_lease_owner IS NULL AND lease_expires_at IS NULL)) AND
        (artifact_digest IS NULL OR artifact_digest ~ '^sha256:[0-9a-f]{64}$') AND expires_at=created_at+interval '30 days')
    );
    CREATE INDEX sales_export_jobs_scope_idx ON sales_export_jobs(application_id,environment,actor_id,id);
    CREATE TABLE sales_export_snapshot_rows (
      export_job_id bigint NOT NULL REFERENCES sales_export_jobs(id) ON DELETE RESTRICT, ordinal integer NOT NULL,
      record_id bigint NOT NULL, record_revision integer NOT NULL, row_json jsonb, row_digest text NOT NULL,
      PRIMARY KEY(export_job_id,ordinal), UNIQUE(export_job_id,record_id),
      CHECK(ordinal BETWEEN 0 AND 9999 AND record_id>=1 AND record_revision BETWEEN 1 AND 1000000000 AND
        (row_json IS NULL OR jsonb_typeof(row_json)='object') AND row_digest ~ '^sha256:[0-9a-f]{64}$')
    );
    CREATE TABLE sales_export_artifacts (
      artifact_id text PRIMARY KEY, export_job_id bigint NOT NULL UNIQUE REFERENCES sales_export_jobs(id) ON DELETE RESTRICT,
      bytes bytea, digest text NOT NULL, content_type text NOT NULL DEFAULT 'text/csv', byte_length integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
      CHECK(digest ~ '^sha256:[0-9a-f]{64}$' AND content_type='text/csv' AND byte_length BETWEEN 0 AND 16777216 AND
        (bytes IS NULL OR octet_length(bytes)=byte_length) AND expires_at=created_at+interval '30 days')
    );
    CREATE TABLE sales_export_receipts (
      receipt_id text PRIMARY KEY, job_id bigint NOT NULL UNIQUE REFERENCES sales_export_jobs(id) ON DELETE RESTRICT,
      evidence jsonb NOT NULL, digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(jsonb_typeof(evidence)='object' AND digest ~ '^sha256:[0-9a-f]{64}$')
    );

    CREATE TABLE sales_merge_lineage (
      id bigserial UNIQUE, lineage_id text PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, target_object_type text NOT NULL,
      winner_id bigint NOT NULL, winner_pre_revision integer NOT NULL, winner_post_revision integer NOT NULL,
      loser_id bigint NOT NULL, loser_pre_revision integer NOT NULL, loser_post_revision integer NOT NULL,
      match_kind text NOT NULL, normalizer_version text NOT NULL, actor_id text NOT NULL, authorization_revision integer NOT NULL,
      winner_pre_digest text NOT NULL, winner_post_digest text NOT NULL, loser_pre_digest text NOT NULL, loser_post_digest text NOT NULL,
      rewritten_relation_counts jsonb NOT NULL, lineage_digest text NOT NULL, committed_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(application_id,environment,target_object_type,loser_id),
      CHECK(target_object_type IN ('sales.object.account','sales.object.contact') AND winner_id<>loser_id AND
        winner_post_revision=winner_pre_revision+1 AND loser_post_revision=loser_pre_revision+1 AND
        match_kind IN ('account-name','contact-email','contact-phone','contact-email-and-phone') AND normalizer_version='node24.19-unicode17-v1' AND
        authorization_revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(rewritten_relation_counts)='array' AND
        winner_pre_digest ~ '^sha256:[0-9a-f]{64}$' AND winner_post_digest ~ '^sha256:[0-9a-f]{64}$' AND
        loser_pre_digest ~ '^sha256:[0-9a-f]{64}$' AND loser_post_digest ~ '^sha256:[0-9a-f]{64}$' AND lineage_digest ~ '^sha256:[0-9a-f]{64}$')
    );
    ALTER TABLE payload_locked_documents_rels
      ADD COLUMN sales_import_jobs_id bigint REFERENCES sales_import_jobs(id) ON DELETE CASCADE,
      ADD COLUMN sales_import_rows_id bigint REFERENCES sales_import_rows(id) ON DELETE CASCADE,
      ADD COLUMN sales_import_chunks_id bigint REFERENCES sales_import_chunks(id) ON DELETE CASCADE,
      ADD COLUMN sales_export_jobs_id bigint REFERENCES sales_export_jobs(id) ON DELETE CASCADE,
      ADD COLUMN sales_merge_lineage_id bigint REFERENCES sales_merge_lineage(id) ON DELETE CASCADE;
    CREATE INDEX payload_locked_documents_rels_sales_import_jobs_id_idx ON payload_locked_documents_rels(sales_import_jobs_id);
    CREATE INDEX payload_locked_documents_rels_sales_import_rows_id_idx ON payload_locked_documents_rels(sales_import_rows_id);
    CREATE INDEX payload_locked_documents_rels_sales_import_chunks_id_idx ON payload_locked_documents_rels(sales_import_chunks_id);
    CREATE INDEX payload_locked_documents_rels_sales_export_jobs_id_idx ON payload_locked_documents_rels(sales_export_jobs_id);
    CREATE INDEX payload_locked_documents_rels_sales_merge_lineage_id_idx ON payload_locked_documents_rels(sales_merge_lineage_id);
    CREATE TABLE sales_data_movement_audit (
      audit_id text PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, actor_id text NOT NULL,
      action_id text NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL, evidence jsonb NOT NULL,
      digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(jsonb_typeof(evidence)='object' AND digest ~ '^sha256:[0-9a-f]{64}$')
    );

    CREATE FUNCTION public.sales_data_movement_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN RAISE EXCEPTION 'P13.5 data-movement evidence is immutable' USING ERRCODE='55000'; END; $$;
    REVOKE ALL ON FUNCTION public.sales_data_movement_evidence_immutable() FROM PUBLIC;
    CREATE TRIGGER sales_import_receipts_immutable BEFORE UPDATE OR DELETE ON sales_import_receipts FOR EACH ROW EXECUTE FUNCTION public.sales_data_movement_evidence_immutable();
    CREATE TRIGGER sales_export_receipts_immutable BEFORE UPDATE OR DELETE ON sales_export_receipts FOR EACH ROW EXECUTE FUNCTION public.sales_data_movement_evidence_immutable();
    CREATE TRIGGER sales_merge_lineage_immutable BEFORE UPDATE OR DELETE ON sales_merge_lineage FOR EACH ROW EXECUTE FUNCTION public.sales_data_movement_evidence_immutable();
    CREATE TRIGGER sales_data_movement_audit_immutable BEFORE UPDATE OR DELETE ON sales_data_movement_audit FOR EACH ROW EXECUTE FUNCTION public.sales_data_movement_evidence_immutable();
    CREATE FUNCTION public.sales_export_snapshot_payload_purge_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        IF TG_OP='UPDATE' AND OLD.row_json IS NOT NULL AND NEW.row_json IS NULL AND
          NEW.export_job_id=OLD.export_job_id AND NEW.ordinal=OLD.ordinal AND NEW.record_id=OLD.record_id AND
          NEW.record_revision=OLD.record_revision AND NEW.row_digest=OLD.row_digest AND
          EXISTS(SELECT 1 FROM public.sales_export_jobs j WHERE j.id=OLD.export_job_id AND j.expires_at<=statement_timestamp()) THEN RETURN NEW;
        END IF;
        RAISE EXCEPTION 'P13.5 export snapshot is immutable' USING ERRCODE='55000';
      END; $$;
    REVOKE ALL ON FUNCTION public.sales_export_snapshot_payload_purge_only() FROM PUBLIC;
    CREATE TRIGGER sales_export_snapshot_payload_purge_only BEFORE UPDATE OR DELETE ON sales_export_snapshot_rows FOR EACH ROW EXECUTE FUNCTION public.sales_export_snapshot_payload_purge_only();
    CREATE FUNCTION public.sales_export_artifact_payload_purge_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        IF TG_OP='UPDATE' AND OLD.bytes IS NOT NULL AND NEW.bytes IS NULL AND
          NEW.artifact_id=OLD.artifact_id AND NEW.export_job_id=OLD.export_job_id AND NEW.digest=OLD.digest AND
          NEW.content_type=OLD.content_type AND NEW.byte_length=OLD.byte_length AND NEW.created_at=OLD.created_at AND NEW.expires_at=OLD.expires_at AND
          OLD.expires_at<=statement_timestamp() THEN RETURN NEW;
        END IF;
        RAISE EXCEPTION 'P13.5 export artifact is immutable' USING ERRCODE='55000';
      END; $$;
    REVOKE ALL ON FUNCTION public.sales_export_artifact_payload_purge_only() FROM PUBLIC;
    CREATE TRIGGER sales_export_artifact_payload_purge_only BEFORE UPDATE OR DELETE ON sales_export_artifacts FOR EACH ROW EXECUTE FUNCTION public.sales_export_artifact_payload_purge_only();
  `);
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error("maintenance-required: P13.5 durable data-movement evidence is forward-only");
}
