import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

function rowsOf(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value as readonly Record<string, unknown>[];
  if (value !== null && typeof value === "object" && "rows" in value && Array.isArray((value as { rows: unknown }).rows)) {
    return (value as { rows: readonly Record<string, unknown>[] }).rows;
  }
  return [];
}

/** P13.4 is a forward-only identity cutover. The enclosing Payload migration transaction is the rollback boundary. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  const storage = rowsOf(await db.execute(sql`SELECT ARRAY[
    to_regclass('public.sales_pipeline_stage_migration_receipts')::text,
    to_regclass('public.sales_pipeline_stage_translation_evidence')::text,
    to_regclass('public.sales_saved_views')::text
  ] AS names`))[0]?.names as unknown[] | undefined;
  const existing = storage?.filter((name) => name !== null) ?? [];
  if (existing.length > 0) {
    if (existing.length !== 3) throw new Error("maintenance-required: P13.4 partial receipt storage is conflicting");
    const replay = rowsOf(await db.execute(sql`
      SELECT NOT EXISTS (
        SELECT 1 FROM sales_pipeline_stage_migration_receipts r
        LEFT JOIN sales_pipelines p ON p.id=r.pipeline_id AND p.application_id=r.application_id AND p.environment=r.environment
        WHERE p.id IS NULL OR p.revision<>r.target_revision OR CASE WHEN jsonb_typeof(p.audit)='array' THEN jsonb_array_length(p.audit)<>r.target_revision OR
          p.audit->(r.target_revision-1)<>jsonb_build_object('kind','phase-13-pipeline-stage-identity','receiptDigest',r.receipt_digest,'sourceRevision',r.predecessor_revision,'targetRevision',r.target_revision) ELSE true END OR jsonb_array_length(r.mapping)<>6 OR
          (SELECT count(*) FROM sales_pipeline_stage_translation_evidence e WHERE e.receipt_digest=r.receipt_digest)<>6 OR
          r.mapping<>(SELECT jsonb_agg(jsonb_build_object('oldStageId',e.old_stage_id,'newStageId',e.new_stage_id,'semantic',e.semantic,'sourceRevision',e.source_revision,'targetRevision',e.target_revision) ORDER BY e.semantic) FROM sales_pipeline_stage_translation_evidence e WHERE e.receipt_digest=r.receipt_digest) OR
          r.receipt_digest<>'sha256:'||encode(digest(convert_to(r.application_id,'UTF8')||decode('00','hex')||convert_to(r.environment,'UTF8')||decode('00','hex')||convert_to(r.pipeline_id::text,'UTF8')||decode('00','hex')||convert_to(r.predecessor_revision::text,'UTF8')||decode('00','hex')||convert_to((SELECT string_agg(e.old_stage_id||'='||e.new_stage_id||'@'||e.source_revision::text,E'\x1f' ORDER BY e.semantic) FROM sales_pipeline_stage_translation_evidence e WHERE e.receipt_digest=r.receipt_digest),'UTF8'),'sha256'),'hex') OR
          EXISTS (SELECT 1 FROM sales_pipeline_stage_translation_evidence e LEFT JOIN sales_pipeline_stages s
            ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=e.new_stage_id
            WHERE e.receipt_digest=r.receipt_digest AND (s.id IS NULL OR s.semantic<>e.semantic OR s.revision<>e.target_revision OR CASE WHEN jsonb_typeof(s.audit)='array' THEN jsonb_array_length(s.audit)<>e.target_revision OR
              s.audit->(e.target_revision-1)<>jsonb_build_object('kind','phase-13-pipeline-stage-identity','receiptDigest',r.receipt_digest,'sourceRevision',e.source_revision,'targetRevision',e.target_revision) ELSE true END))
      ) AND (SELECT count(*) FROM sales_pipeline_stage_migration_receipts)=(SELECT count(*) FROM sales_pipelines)
        AND NOT EXISTS (SELECT 1 FROM sales_pipelines WHERE status NOT IN ('active','archived') OR is_active<>(status='active'))
        AND NOT EXISTS (SELECT 1 FROM sales_pipeline_stage_migration_receipts scope LEFT JOIN sales_pipelines active
          ON active.application_id=scope.application_id AND active.environment=scope.environment AND active.is_active AND active.status='active'
          GROUP BY scope.application_id,scope.environment HAVING count(DISTINCT active.id)<>1)
        AND NOT EXISTS (SELECT 1 FROM sales_pipelines p LEFT JOIN k_nex_system_settings_state st USING(application_id,environment)
          LEFT JOIN k_nex_system_settings_documents d ON d.application_id=p.application_id AND d.environment=p.environment AND d.descriptor_id='system.general' AND d.descriptor_schema_version=2 AND d.owner_scope_key='platform:system'
          WHERE st.application_id IS NULL OR d.application_id IS NULL OR (SELECT count(*) FROM k_nex_system_settings_documents sibling WHERE sibling.application_id=p.application_id AND sibling.environment=p.environment AND sibling.descriptor_id='system.general')<>1 OR d.settings_revision NOT BETWEEN 1 AND st.settings_revision OR d.document_revision NOT BETWEEN 1 AND st.settings_revision OR d.values_json<>jsonb_build_object('siteName',d.values_json->'siteName','reportingTimezone','UTC') OR jsonb_typeof(d.values_json->'siteName')<>'string') AS valid
    `))[0]?.valid;
    if (replay !== true) throw new Error("maintenance-required: P13.4 receipt mapping or predecessor state conflicts with committed evidence");
    return;
  }
  await db.execute(sql`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    LOCK TABLE sales_pipelines,sales_pipeline_stages,sales_opportunities,k_nex_system_settings_state,k_nex_system_settings_documents,k_nex_workspace_pages,k_nex_workspace_working_copies,k_nex_workspace_published_revisions,sales_action_idempotency IN SHARE ROW EXCLUSIVE MODE;
    CREATE TEMP TABLE p134_scopes(application_id text NOT NULL,environment text NOT NULL,PRIMARY KEY(application_id,environment)) ON COMMIT DROP;
    INSERT INTO p134_scopes SELECT application_id,environment FROM sales_pipelines UNION SELECT application_id,environment FROM sales_pipeline_stages UNION SELECT application_id,environment FROM sales_opportunities UNION SELECT application_id,environment FROM k_nex_system_settings_documents WHERE descriptor_id='sales.settings.workspace';
    CREATE TEMP TABLE p134_immutable_bytes(kind text PRIMARY KEY,digest text NOT NULL) ON COMMIT DROP;
    INSERT INTO p134_immutable_bytes VALUES
      ('idempotency','sha256:'||encode(digest(convert_to(COALESCE((SELECT string_agg(row_to_json(i)::text,E'\x1f' ORDER BY i.application_id,i.environment,i.effective_actor_id,i.action_id,i.idempotency_key) FROM sales_action_idempotency i),''),'UTF8'),'sha256'),'hex')),
      ('published','sha256:'||encode(digest(convert_to(COALESCE((SELECT string_agg(row_to_json(r)::text,E'\x1f' ORDER BY r.application_id,r.environment,r.page_id,r.revision_id) FROM k_nex_workspace_published_revisions r),''),'UTF8'),'sha256'),'hex')),
      ('audit-prefix','sha256:'||encode(digest(convert_to(COALESCE((SELECT string_agg(v,E'\x1f' ORDER BY k) FROM (
        SELECT 'pipeline:'||application_id||':'||environment||':'||id::text k,audit::text v FROM sales_pipelines
        UNION ALL SELECT 'stage:'||application_id||':'||environment||':'||pipeline_id::text||':'||id::text,audit::text FROM sales_pipeline_stages
      ) evidence),''),'UTF8'),'sha256'),'hex'));
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM p134_scopes WHERE application_id<>normalize(application_id,NFC) OR octet_length(application_id) NOT BETWEEN 1 AND 128 OR environment<>normalize(environment,NFC) OR octet_length(environment) NOT BETWEEN 1 AND 64) OR
         EXISTS (SELECT 1 FROM sales_pipelines WHERE id NOT BETWEEN 1 AND 2147483647) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 UUID identity dimensions are invalid';
      END IF;
      IF EXISTS (SELECT 1 FROM sales_pipelines WHERE status NOT IN ('active','archived') OR is_active<>(status='active')) OR
         EXISTS (SELECT 1 FROM p134_scopes scope LEFT JOIN sales_pipelines p ON p.application_id=scope.application_id AND p.environment=scope.environment AND p.is_active AND p.status='active' GROUP BY scope.application_id,scope.environment HAVING count(p.id)<>1) OR
         EXISTS (SELECT 1 FROM sales_pipelines p LEFT JOIN sales_pipeline_stages s ON s.pipeline_id=p.id AND s.application_id=p.application_id AND s.environment=p.environment
           GROUP BY p.id,p.application_id,p.environment HAVING count(s.id)<>6 OR count(*) FILTER (WHERE s.status='active')<>6 OR count(DISTINCT s.position)<>6 OR count(DISTINCT s.semantic)<>6 OR
             count(DISTINCT s.semantic) FILTER (WHERE s.semantic IN ('qualification','discovery','proposal','negotiation','won','lost'))<>6 OR
             CASE WHEN jsonb_typeof(p.ordered_stage_ids)='array' THEN jsonb_array_length(p.ordered_stage_ids)<>6 OR jsonb_array_length(p.ordered_stage_ids)<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p.ordered_stage_ids)) OR p.ordered_stage_ids<>jsonb_agg(to_jsonb(s.stage_id) ORDER BY s.position) ELSE true END) OR
         EXISTS (SELECT 1 FROM sales_pipeline_stages s WHERE s.position NOT BETWEEN 0 AND 5 OR s.semantic='won' AND s.position<>4 OR s.semantic='lost' AND s.position<>5 OR s.semantic NOT IN ('won','lost') AND s.position>3 OR
           CASE WHEN jsonb_typeof(s.allowed_transitions)='array' THEN jsonb_array_length(s.allowed_transitions)<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(s.allowed_transitions)) OR EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(s.allowed_transitions) edge(target_id) LEFT JOIN sales_pipeline_stages target ON target.application_id=s.application_id AND target.environment=s.environment AND target.pipeline_id=s.pipeline_id AND target.stage_id=edge.target_id
             WHERE target.id IS NULL OR NOT ((s.semantic='qualification' AND target.semantic IN ('discovery','lost')) OR (s.semantic='discovery' AND target.semantic IN ('proposal','lost')) OR (s.semantic='proposal' AND target.semantic IN ('negotiation','lost')) OR (s.semantic='negotiation' AND target.semantic IN ('won','lost'))))
           ELSE true END) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 requires one complete active pipeline per scope';
      END IF;
      IF EXISTS (SELECT 1 FROM sales_pipeline_stages WHERE stage_id IS NULL OR octet_length(stage_id) NOT BETWEEN 1 AND 120 OR name<>btrim(name) OR name<>normalize(name,NFC) OR octet_length(name) NOT BETWEEN 1 AND 120) OR
         EXISTS (SELECT 1 FROM sales_pipelines WHERE name<>btrim(name) OR name<>normalize(name,NFC) OR octet_length(name) NOT BETWEEN 1 AND 120) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 pipeline text or stage identity preflight failed';
      END IF;
      IF EXISTS (SELECT 1 FROM sales_pipelines WHERE revision<>1 OR jsonb_typeof(audit)<>'array' OR CASE WHEN jsonb_typeof(audit)='array' THEN jsonb_array_length(audit)<>1 OR audit->0->>'kind' NOT IN ('phase-13-legacy-import','phase-13-settings-migration') ELSE false END) OR
         EXISTS (SELECT 1 FROM sales_pipeline_stages WHERE revision<>1 OR jsonb_typeof(audit)<>'array' OR CASE WHEN jsonb_typeof(audit)='array' THEN jsonb_array_length(audit)<>1 OR audit->0->>'kind' NOT IN ('phase-13-legacy-import','phase-13-settings-migration') ELSE false END) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 pipeline or Stage audit predecessor is invalid';
      END IF;
      IF EXISTS (SELECT 1 FROM p134_scopes scope LEFT JOIN k_nex_system_settings_documents d
          ON d.application_id=scope.application_id AND d.environment=scope.environment AND d.descriptor_id='sales.settings.workspace'
          GROUP BY scope.application_id,scope.environment HAVING count(d.*)<>1) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 requires one Sales settings predecessor per scope';
      END IF;
      IF EXISTS (SELECT 1 FROM k_nex_system_settings_documents WHERE descriptor_id='sales.settings.workspace' AND (descriptor_schema_version<>1 OR values_json->'pipelineStages'<>'["qualification","discovery","proposal","negotiation","won","lost"]'::jsonb)) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 Sales settings predecessor is conflicting';
      END IF;
      IF EXISTS (SELECT 1 FROM k_nex_system_settings_documents d JOIN p134_scopes scope USING(application_id,environment) LEFT JOIN k_nex_system_settings_state st USING(application_id,environment) WHERE d.descriptor_id='system.general' AND
          (d.descriptor_schema_version NOT IN (1,2) OR d.owner_scope_key<>'platform:system' OR d.owner_kind<>'platform' OR d.owner_namespace<>'system' OR d.owner_delivery_class IS NOT NULL OR d.owner_extension_id IS NOT NULL OR d.owner_generation IS NOT NULL OR d.document_revision NOT BETWEEN 1 AND st.settings_revision OR d.settings_revision NOT BETWEEN 1 AND st.settings_revision)) OR
         EXISTS (SELECT 1 FROM k_nex_system_settings_documents d JOIN p134_scopes scope USING(application_id,environment) WHERE d.descriptor_id='system.general' GROUP BY d.application_id,d.environment HAVING count(*)>1) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 system.general predecessor ownership or schema conflicts';
      END IF;
    END $$;

    DO $$ DECLARE scope record; state_revision integer; legacy record; current_v2 record; BEGIN
      FOR scope IN SELECT * FROM p134_scopes ORDER BY application_id,environment LOOP
        SELECT settings_revision INTO STRICT state_revision FROM k_nex_system_settings_state WHERE application_id=scope.application_id AND environment=scope.environment FOR UPDATE;
        SELECT * INTO legacy FROM k_nex_system_settings_documents WHERE application_id=scope.application_id AND environment=scope.environment AND descriptor_id='system.general' AND descriptor_schema_version=1 AND owner_scope_key='platform:system' FOR UPDATE;
        SELECT * INTO current_v2 FROM k_nex_system_settings_documents WHERE application_id=scope.application_id AND environment=scope.environment AND descriptor_id='system.general' AND descriptor_schema_version=2 AND owner_scope_key='platform:system' FOR UPDATE;
        IF legacy.application_id IS NOT NULL AND current_v2.application_id IS NOT NULL THEN RAISE EXCEPTION 'maintenance-required: P13.4 system.general schema collision'; END IF;
        IF legacy.application_id IS NOT NULL AND (legacy.owner_kind<>'platform' OR legacy.owner_namespace<>'system' OR legacy.values_json<>jsonb_build_object('siteName',legacy.values_json->'siteName') OR jsonb_typeof(legacy.values_json->'siteName')<>'string') THEN RAISE EXCEPTION 'maintenance-required: P13.4 system.general v1 is invalid'; END IF;
        IF current_v2.application_id IS NOT NULL THEN
          IF current_v2.owner_kind<>'platform' OR current_v2.owner_namespace<>'system' OR current_v2.settings_revision NOT BETWEEN 1 AND state_revision OR current_v2.document_revision NOT BETWEEN 1 AND state_revision OR current_v2.values_json<>jsonb_build_object('siteName',current_v2.values_json->'siteName','reportingTimezone','UTC') OR jsonb_typeof(current_v2.values_json->'siteName')<>'string' THEN RAISE EXCEPTION 'maintenance-required: P13.4 system.general v2 is invalid'; END IF;
          CONTINUE;
        END IF;
        UPDATE k_nex_system_settings_state SET settings_revision=settings_revision+1,updated_at=now() WHERE application_id=scope.application_id AND environment=scope.environment RETURNING settings_revision INTO state_revision;
        INSERT INTO k_nex_system_settings_documents(application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_namespace,owner_delivery_class,owner_extension_id,owner_generation,document_revision,settings_revision,values_json,updated_at)
          VALUES(scope.application_id,scope.environment,'system.general',2,'platform:system','platform','system',NULL,NULL,NULL,COALESCE(legacy.document_revision,0)+1,state_revision,jsonb_build_object('siteName',COALESCE(legacy.values_json->>'siteName','K-Nex'),'reportingTimezone','UTC'),now());
        IF legacy.application_id IS NOT NULL THEN DELETE FROM k_nex_system_settings_documents WHERE application_id=scope.application_id AND environment=scope.environment AND descriptor_id='system.general' AND descriptor_schema_version=1 AND owner_scope_key='platform:system'; END IF;
      END LOOP;
    EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN RAISE EXCEPTION 'maintenance-required: P13.4 system.general scope state is missing or ambiguous'; END $$;

    ALTER TABLE sales_opportunities DROP CONSTRAINT IF EXISTS sales_opportunities_stage_fk;
    ALTER TABLE sales_pipeline_stages RENAME COLUMN allowed_transitions TO allowed_transition_stage_ids;
    ALTER TABLE sales_pipeline_stages ADD COLUMN required_field_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

    CREATE TEMP TABLE p134_stage_map ON COMMIT DROP AS
    WITH names AS (
      SELECT id,application_id,environment,pipeline_id,stage_id old_stage_id,semantic,revision source_revision,
        digest(decode(replace('13f5fa89-b465-5a7a-a19d-74ed6c5d1ef4','-',''),'hex') ||
          convert_to(normalize('phase13/pipeline-stage/v1',NFC),'UTF8') || decode('00','hex') ||
          convert_to(normalize(application_id,NFC),'UTF8') || decode('00','hex') ||
          convert_to(normalize(environment,NFC),'UTF8') || decode('00','hex') ||
          convert_to(pipeline_id::text,'UTF8') || decode('00','hex') ||
          convert_to(semantic,'UTF8'),'sha1') bytes
      FROM sales_pipeline_stages
    ), hexes AS (
      SELECT *, encode(set_byte(set_byte(substring(bytes from 1 for 16),6,(get_byte(bytes,6)&15)|80),8,(get_byte(bytes,8)&63)|128),'hex') h FROM names
    )
    SELECT id,application_id,environment,pipeline_id,old_stage_id,semantic,source_revision,
      substring(h,1,8)||'-'||substring(h,9,4)||'-'||substring(h,13,4)||'-'||substring(h,17,4)||'-'||substring(h,21,12) new_stage_id
    FROM hexes;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM p134_stage_map WHERE new_stage_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') OR
         EXISTS (SELECT 1 FROM p134_stage_map GROUP BY application_id,environment,pipeline_id,new_stage_id HAVING count(*)<>1) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 UUID mapping is forged or ambiguous';
      END IF;
      IF EXISTS (SELECT 1 FROM sales_pipelines p CROSS JOIN LATERAL jsonb_array_elements_text(p.ordered_stage_ids) e(old_id)
          WHERE (SELECT count(*) FROM p134_stage_map m WHERE m.application_id=p.application_id AND m.environment=p.environment AND m.pipeline_id=p.id AND m.old_stage_id=e.old_id)<>1) OR
         EXISTS (SELECT 1 FROM sales_pipeline_stages s CROSS JOIN LATERAL jsonb_array_elements_text(s.allowed_transition_stage_ids) e(old_id)
          WHERE (SELECT count(*) FROM p134_stage_map m WHERE m.application_id=s.application_id AND m.environment=s.environment AND m.pipeline_id=s.pipeline_id AND m.old_stage_id=e.old_id)<>1) OR
         EXISTS (SELECT 1 FROM sales_opportunities o WHERE (SELECT count(*) FROM p134_stage_map m WHERE m.application_id=o.application_id AND m.environment=o.environment AND m.pipeline_id=o.pipeline_id AND m.old_stage_id=o.stage_id)<>1) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 mutable Stage reference is missing or ambiguous';
      END IF;
    END $$;

    CREATE TEMP TABLE p134_receipt_plan ON COMMIT DROP AS
      SELECT m.application_id,m.environment,m.pipeline_id,p.revision predecessor_revision,p.revision+1 target_revision,
        jsonb_agg(jsonb_build_object('oldStageId',m.old_stage_id,'newStageId',m.new_stage_id,'semantic',m.semantic,'sourceRevision',m.source_revision,'targetRevision',m.source_revision+1) ORDER BY m.semantic) mapping,
        'sha256:'||encode(digest(convert_to(m.application_id,'UTF8')||decode('00','hex')||convert_to(m.environment,'UTF8')||decode('00','hex')||convert_to(m.pipeline_id::text,'UTF8')||decode('00','hex')||convert_to(p.revision::text,'UTF8')||decode('00','hex')||convert_to(string_agg(m.old_stage_id||'='||m.new_stage_id||'@'||m.source_revision::text,E'\x1f' ORDER BY m.semantic),'UTF8'),'sha256'),'hex') receipt_digest
      FROM p134_stage_map m JOIN sales_pipelines p ON p.id=m.pipeline_id AND p.application_id=m.application_id AND p.environment=m.environment
      GROUP BY m.application_id,m.environment,m.pipeline_id,p.revision;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM p134_stage_map GROUP BY application_id,environment,pipeline_id HAVING count(*)<>6 OR count(DISTINCT semantic)<>6) OR
         EXISTS (SELECT 1 FROM p134_receipt_plan WHERE jsonb_typeof(mapping)<>'array' OR jsonb_array_length(mapping)<>6) OR
         (SELECT count(*) FROM p134_receipt_plan)<>(SELECT count(*) FROM sales_pipelines) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 receipt plan is not an exact six-Stage snapshot';
      END IF;
    END $$;

    CREATE FUNCTION pg_temp.p134_translate_sales_bindings(value jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE result jsonb:=value; source jsonb; action jsonb; identity text; version integer; expected_hash text; target_hash text; target_version integer;
    BEGIN
      IF jsonb_typeof(value)<>'object' THEN RETURN value; END IF;
      source=value->'source';
      IF jsonb_typeof(source)='object' THEN
        identity=source->'source'->>'id'; version=CASE WHEN jsonb_typeof(source->'source'->'version')='number' THEN (source->'source'->>'version')::integer END;
        IF identity IN ('sales.opportunities','sales.opportunity.detail') THEN
          expected_hash=CASE identity WHEN 'sales.opportunities' THEN 'sha256:49a707b6f512bc0d8cad02c38a506066e6973e09468e1e3c8373c8e1287ade5d' ELSE 'sha256:13f00de403130aa2e96978e81d8c93da1b7bf30bf8892b708cee12e6781da59a' END;
          target_hash=CASE identity WHEN 'sales.opportunities' THEN 'sha256:82668a173c4ee1ce38924b5f99846f86644f437a3926299927cf979426f826ad' ELSE 'sha256:77e88e1763a20e8ac1c2c2eb41d6a877534ee81cdb02d697dbdf06dbd688225c' END;
          target_version=CASE identity WHEN 'sales.opportunities' THEN 3 ELSE 2 END;
          IF version<>target_version-1 OR source->>'structuralCompatibilityHash'<>expected_hash OR jsonb_typeof(source->'input')<>'object' OR jsonb_typeof(source->'selectedFields')<>'array' THEN RAISE EXCEPTION 'maintenance-required: editable Sales source binding predecessor conflicts'; END IF;
          result=jsonb_set(jsonb_set(result,'{source,source,version}',to_jsonb(target_version)),'{source,structuralCompatibilityHash}',to_jsonb(target_hash));
        END IF;
      END IF;
      action=value->'action';
      IF jsonb_typeof(action)='object' AND action->>'id' IN ('sales.pipeline.update','sales.pipeline.archive','sales.saved-view.create','sales.saved-view.update','sales.saved-view.archive','sales.opportunity.close','sales.opportunity.create','sales.opportunity.stage.update') THEN
        identity=action->>'id'; version=CASE WHEN jsonb_typeof(action->'version')='number' THEN (action->>'version')::integer END;
        target_version=CASE WHEN identity IN ('sales.opportunity.create','sales.opportunity.stage.update') THEN 3 ELSE 2 END;
        IF version<>target_version-1 OR (SELECT count(*) FROM jsonb_object_keys(action))<>2 THEN RAISE EXCEPTION 'maintenance-required: editable Sales action binding predecessor conflicts'; END IF;
        result=jsonb_set(result,'{action,version}',to_jsonb(target_version));
      END IF;
      RETURN result;
    END $fn$;
    CREATE FUNCTION pg_temp.p134_translate_sales_node(value jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE result jsonb:=value; children jsonb;
    BEGIN
      IF jsonb_typeof(value)<>'object' THEN RETURN value; END IF;
      IF jsonb_typeof(value->'bindings')='object' THEN result=jsonb_set(result,'{bindings}',pg_temp.p134_translate_sales_bindings(value->'bindings')); END IF;
      IF jsonb_typeof(value->'children')='array' THEN SELECT jsonb_agg(pg_temp.p134_translate_sales_node(item) ORDER BY ordinal) INTO children FROM jsonb_array_elements(value->'children') WITH ORDINALITY entry(item,ordinal); result=jsonb_set(result,'{children}',COALESCE(children,'[]'::jsonb)); END IF;
      RETURN result;
    END $fn$;
    CREATE FUNCTION pg_temp.p134_translate_editable_document(value jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE result jsonb:=value; regions jsonb:='{}'::jsonb; region record; nodes jsonb;
    BEGIN
      IF jsonb_typeof(value)<>'object' OR jsonb_typeof(value->'regions')<>'object' THEN RETURN value; END IF;
      FOR region IN SELECT key,val FROM jsonb_each(value->'regions') entry(key,val) LOOP
        IF jsonb_typeof(region.val)<>'array' THEN RAISE EXCEPTION 'maintenance-required: editable UiDocument region is invalid'; END IF;
        SELECT jsonb_agg(pg_temp.p134_translate_sales_node(item) ORDER BY ordinal) INTO nodes FROM jsonb_array_elements(region.val) WITH ORDINALITY entry(item,ordinal);
        regions=regions||jsonb_build_object(region.key,COALESCE(nodes,'[]'::jsonb));
      END LOOP;
      RETURN jsonb_set(result,'{regions}',regions);
    END $fn$;

    UPDATE k_nex_workspace_pages page SET page_json=pg_temp.p134_translate_editable_document(page.page_json)
      FROM sales_pipelines pipeline WHERE pipeline.application_id=page.application_id AND pipeline.environment=page.environment AND pipeline.is_active AND page.state<>'published';
    UPDATE k_nex_workspace_working_copies copy SET working_copy_json=pg_temp.p134_translate_editable_document(copy.working_copy_json)
      FROM sales_pipelines pipeline WHERE pipeline.application_id=copy.application_id AND pipeline.environment=copy.environment AND pipeline.is_active;

    DROP TRIGGER IF EXISTS sales_opportunities_stage_lifecycle ON sales_opportunities;
    UPDATE sales_opportunities o SET stage_id=m.new_stage_id FROM p134_stage_map m
      WHERE m.application_id=o.application_id AND m.environment=o.environment AND m.pipeline_id=o.pipeline_id AND m.old_stage_id=o.stage_id;
    UPDATE sales_pipelines p SET ordered_stage_ids=(SELECT jsonb_agg(m.new_stage_id ORDER BY e.ordinality)
      FROM jsonb_array_elements_text(p.ordered_stage_ids) WITH ORDINALITY e(old_id,ordinality)
      JOIN p134_stage_map m ON m.application_id=p.application_id AND m.environment=p.environment AND m.pipeline_id=p.id AND m.old_stage_id=e.old_id),
      revision=plan.target_revision,audit=p.audit||jsonb_build_array(jsonb_build_object('kind','phase-13-pipeline-stage-identity','receiptDigest',plan.receipt_digest,'sourceRevision',plan.predecessor_revision,'targetRevision',plan.target_revision))
      FROM p134_receipt_plan plan WHERE plan.application_id=p.application_id AND plan.environment=p.environment AND plan.pipeline_id=p.id;
    UPDATE sales_pipeline_stages s SET
      allowed_transition_stage_ids=COALESCE((SELECT jsonb_agg(m.new_stage_id ORDER BY e.ordinality)
        FROM jsonb_array_elements_text(s.allowed_transition_stage_ids) WITH ORDINALITY e(old_id,ordinality)
        JOIN p134_stage_map m ON m.application_id=s.application_id AND m.environment=s.environment AND m.pipeline_id=s.pipeline_id AND m.old_stage_id=e.old_id),'[]'::jsonb),
      required_field_ids=CASE WHEN s.semantic='lost' THEN '["lossReason"]'::jsonb ELSE '[]'::jsonb END;
    UPDATE sales_pipeline_stages s SET stage_id=m.new_stage_id,revision=m.source_revision+1,
      audit=s.audit||jsonb_build_array(jsonb_build_object('kind','phase-13-pipeline-stage-identity','receiptDigest',plan.receipt_digest,'sourceRevision',m.source_revision,'targetRevision',m.source_revision+1))
      FROM p134_stage_map m JOIN p134_receipt_plan plan USING(application_id,environment,pipeline_id) WHERE m.id=s.id;

    ALTER TABLE sales_pipeline_stages ADD CONSTRAINT sales_pipeline_stages_p134_check CHECK
      (stage_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND jsonb_typeof(allowed_transition_stage_ids)='array' AND jsonb_typeof(required_field_ids)='array');
    ALTER TABLE sales_opportunities ADD CONSTRAINT sales_opportunities_stage_fk FOREIGN KEY (application_id,environment,pipeline_id,stage_id)
      REFERENCES sales_pipeline_stages(application_id,environment,pipeline_id,stage_id) ON DELETE RESTRICT;
    ALTER TABLE sales_opportunities DROP CONSTRAINT sales_opportunities_check;
    ALTER TABLE sales_opportunities ADD CONSTRAINT sales_opportunities_check CHECK
      (application_id<>'' AND environment<>'' AND owner_id<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND archive_status IN ('active','archived') AND (amount IS NULL)=(currency IS NULL) AND (amount IS NULL OR (length(amount) BETWEEN 1 AND 128 AND amount ~ '^-?(0|[1-9][0-9]*)([.][0-9]{1,18})?$')) AND (currency IS NULL OR currency ~ '^[A-Z]{3}$') AND (expected_close_date IS NULL OR expected_close_date=(expected_close_date::date)::text));
    CREATE OR REPLACE FUNCTION sales_assert_opportunity_stage_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE stage_semantic text;
    BEGIN
      SELECT semantic INTO STRICT stage_semantic FROM sales_pipeline_stages WHERE application_id=NEW.application_id AND environment=NEW.environment AND pipeline_id=NEW.pipeline_id AND stage_id=NEW.stage_id FOR KEY SHARE;
      IF (stage_semantic IN ('won','lost')) <> (NEW.closed_at IS NOT NULL) OR (stage_semantic='lost') <> (NEW.loss_reason IS NOT NULL) THEN RAISE EXCEPTION 'Sales opportunity lifecycle does not match referenced Stage semantic'; END IF;
      RETURN NEW;
    EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN RAISE EXCEPTION 'Sales opportunity Stage identity is invalid'; END $$;
    DROP TRIGGER IF EXISTS sales_opportunities_stage_lifecycle ON sales_opportunities;
    CREATE TRIGGER sales_opportunities_stage_lifecycle BEFORE INSERT OR UPDATE OF application_id,environment,pipeline_id,stage_id,closed_at,loss_reason ON sales_opportunities FOR EACH ROW EXECUTE FUNCTION sales_assert_opportunity_stage_lifecycle();

    CREATE TABLE sales_pipeline_stage_migration_receipts (
      receipt_digest text PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, pipeline_id integer NOT NULL,
      predecessor_revision integer NOT NULL, target_revision integer NOT NULL, mapping jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(application_id,environment,pipeline_id), CHECK(receipt_digest ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof(mapping)='array')
    );
    CREATE TABLE sales_pipeline_stage_translation_evidence (
      receipt_digest text NOT NULL REFERENCES sales_pipeline_stage_migration_receipts(receipt_digest), old_stage_id text NOT NULL, new_stage_id text NOT NULL,
      semantic text NOT NULL, source_revision integer NOT NULL, target_revision integer NOT NULL, PRIMARY KEY(receipt_digest,old_stage_id)
    );
    INSERT INTO sales_pipeline_stage_migration_receipts(receipt_digest,application_id,environment,pipeline_id,predecessor_revision,target_revision,mapping)
      SELECT receipt_digest,application_id,environment,pipeline_id,predecessor_revision,target_revision,mapping FROM p134_receipt_plan;
    INSERT INTO sales_pipeline_stage_translation_evidence
      SELECT r.receipt_digest,m.old_stage_id,m.new_stage_id,m.semantic,m.source_revision,m.source_revision+1 FROM p134_stage_map m JOIN sales_pipeline_stage_migration_receipts r USING(application_id,environment,pipeline_id);
    CREATE FUNCTION public.sales_pipeline_stage_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN RAISE EXCEPTION 'P13.4 pipeline stage migration evidence is immutable' USING ERRCODE='55000'; END; $$;
    REVOKE ALL ON FUNCTION public.sales_pipeline_stage_evidence_immutable() FROM PUBLIC;
    CREATE TRIGGER sales_pipeline_stage_receipts_immutable BEFORE INSERT OR UPDATE OR DELETE ON sales_pipeline_stage_migration_receipts FOR EACH ROW EXECUTE FUNCTION public.sales_pipeline_stage_evidence_immutable();
    CREATE TRIGGER sales_pipeline_stage_translation_immutable BEFORE INSERT OR UPDATE OR DELETE ON sales_pipeline_stage_translation_evidence FOR EACH ROW EXECUTE FUNCTION public.sales_pipeline_stage_evidence_immutable();

    UPDATE k_nex_system_settings_documents SET descriptor_schema_version=2,values_json=values_json-'pipelineStages'
      WHERE descriptor_id='sales.settings.workspace' AND descriptor_schema_version=1;

    CREATE FUNCTION public.sales_saved_view_canonical_json(value jsonb) RETURNS text
      LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public AS $canonical$
    DECLARE rendered text;
    BEGIN
      CASE jsonb_typeof(value)
        WHEN 'object' THEN
          SELECT '{'||COALESCE(string_agg(to_json(key)::text||':'||public.sales_saved_view_canonical_json(item),',' ORDER BY key COLLATE "C"),'')||'}'
            INTO rendered FROM jsonb_each(value) entry(key,item);
        WHEN 'array' THEN
          SELECT '['||COALESCE(string_agg(public.sales_saved_view_canonical_json(item),',' ORDER BY ordinal),'')||']'
            INTO rendered FROM jsonb_array_elements(value) WITH ORDINALITY entry(item,ordinal);
        ELSE rendered=value::text;
      END CASE;
      RETURN rendered;
    END $canonical$;
    REVOKE ALL ON FUNCTION public.sales_saved_view_canonical_json(jsonb) FROM PUBLIC;

    CREATE TABLE sales_saved_views (
      id serial PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, owner_id text NOT NULL, team_id text,
      created_by text NOT NULL, updated_by text NOT NULL, revision integer NOT NULL DEFAULT 1, audit jsonb NOT NULL DEFAULT '[]'::jsonb,
      name text NOT NULL, visibility varchar(16) NOT NULL, visibility_team_id text, view_kind varchar(16) NOT NULL, target_object_id text NOT NULL,
      definition jsonb NOT NULL, status varchar(16) NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK(revision BETWEEN 1 AND 1000000000 AND name=btrim(name) AND name=normalize(name,NFC) AND octet_length(name) BETWEEN 1 AND 120 AND
        octet_length(convert_to(public.sales_saved_view_canonical_json(definition),'UTF8'))<=16384 AND
        ((visibility='personal' AND visibility_team_id IS NULL) OR (visibility='team' AND visibility_team_id IS NOT NULL AND visibility_team_id=normalize(visibility_team_id,NFC) AND octet_length(visibility_team_id) BETWEEN 1 AND 120)) AND
        view_kind IN ('table','kanban','calendar') AND status IN ('active','archived'))
    );
    ALTER TABLE sales_pipelines ADD CONSTRAINT sales_pipelines_p134_name_check CHECK(name=btrim(name) AND name=normalize(name,NFC) AND octet_length(name) BETWEEN 1 AND 120);
    ALTER TABLE sales_pipeline_stages ADD CONSTRAINT sales_pipeline_stages_p134_name_check CHECK(name=btrim(name) AND name=normalize(name,NFC) AND octet_length(name) BETWEEN 1 AND 120);
    CREATE INDEX sales_saved_views_owner_idx ON sales_saved_views(application_id,environment,owner_id,status);
    CREATE INDEX sales_saved_views_team_idx ON sales_saved_views(application_id,environment,visibility_team_id,status);
    ALTER TABLE payload_locked_documents_rels ADD COLUMN sales_saved_views_id integer;
    ALTER TABLE payload_locked_documents_rels ADD CONSTRAINT payload_locked_documents_rels_sales_saved_views_fk
      FOREIGN KEY (sales_saved_views_id) REFERENCES sales_saved_views(id) ON DELETE CASCADE;
    CREATE INDEX payload_locked_documents_rels_sales_saved_views_id_idx ON payload_locked_documents_rels(sales_saved_views_id);
    DO $$ DECLARE idempotency_digest text; published_digest text; audit_prefix_digest text; BEGIN
      SELECT 'sha256:'||encode(digest(convert_to(COALESCE((SELECT string_agg(row_to_json(i)::text,E'\x1f' ORDER BY i.application_id,i.environment,i.effective_actor_id,i.action_id,i.idempotency_key) FROM sales_action_idempotency i),''),'UTF8'),'sha256'),'hex') INTO idempotency_digest;
      SELECT 'sha256:'||encode(digest(convert_to(COALESCE((SELECT string_agg(row_to_json(r)::text,E'\x1f' ORDER BY r.application_id,r.environment,r.page_id,r.revision_id) FROM k_nex_workspace_published_revisions r),''),'UTF8'),'sha256'),'hex') INTO published_digest;
      SELECT 'sha256:'||encode(digest(convert_to(COALESCE((SELECT string_agg(v,E'\x1f' ORDER BY k) FROM (
        SELECT 'pipeline:'||application_id||':'||environment||':'||id::text k,(audit-(jsonb_array_length(audit)-1))::text v FROM sales_pipelines
        UNION ALL SELECT 'stage:'||application_id||':'||environment||':'||pipeline_id::text||':'||id::text,(audit-(jsonb_array_length(audit)-1))::text FROM sales_pipeline_stages
      ) evidence),''),'UTF8'),'sha256'),'hex') INTO audit_prefix_digest;
      IF idempotency_digest<>(SELECT digest FROM p134_immutable_bytes WHERE kind='idempotency') OR published_digest<>(SELECT digest FROM p134_immutable_bytes WHERE kind='published') THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 immutable evidence bytes changed';
      END IF;
      IF audit_prefix_digest<>(SELECT digest FROM p134_immutable_bytes WHERE kind='audit-prefix') THEN RAISE EXCEPTION 'maintenance-required: P13.4 audit genesis bytes changed'; END IF;
      IF EXISTS (SELECT 1 FROM k_nex_system_settings_documents WHERE descriptor_id='sales.settings.workspace' AND (descriptor_schema_version<>2 OR values_json ? 'pipelineStages')) THEN
        RAISE EXCEPTION 'maintenance-required: P13.4 Sales settings cutover is incomplete';
      END IF;
    END $$;
  `);
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error("maintenance-required: P13.4 opaque stage-ID cutover is forward-only after receipt commit");
}
