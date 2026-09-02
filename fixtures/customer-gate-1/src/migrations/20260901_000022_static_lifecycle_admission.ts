import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE FUNCTION public.k_nex_static_lifecycle_admission(
      p_operation_id varchar,
      p_application_id varchar,
      p_environment varchar,
      p_extension_id varchar
    ) RETURNS TABLE (
      operation_id varchar,
      expected_revision integer,
      phase varchar,
      plan_json jsonb,
      authorization_json jsonb,
      lifecycle_revision integer,
      disposition varchar
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    BEGIN
      RETURN QUERY
        SELECT o.operation_id, o.expected_revision, o.phase, o.plan_json, o.authorization_json, e.revision, e.disposition
        FROM public.runtime_extension_operations AS o
        JOIN public.runtime_extensions AS e
          ON e.application_id=o.application_id
          AND e.environment=o.environment
          AND e.delivery_class=o.delivery_class
          AND e.extension_id=o.extension_id
        WHERE o.operation_id=p_operation_id
          AND o.application_id=p_application_id
          AND o.environment=p_environment
          AND o.delivery_class='platform-plugin'
          AND o.extension_id=p_extension_id
          AND e.last_operation_id=o.operation_id
        FOR UPDATE OF o, e;
    END;
    $$;

    REVOKE ALL ON FUNCTION public.k_nex_static_lifecycle_admission(character varying, character varying, character varying, character varying) FROM PUBLIC;

    CREATE FUNCTION public.k_nex_static_impact_plan(
      p_operation_id varchar,
      p_application_id varchar,
      p_environment varchar,
      p_extension_id varchar
    ) RETURNS TABLE (
      operation_id varchar,
      application_id varchar,
      environment varchar,
      expected_revision integer,
      phase varchar,
      plan_json jsonb,
      authorization_json jsonb,
      lifecycle_revision integer,
      disposition varchar
    )
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
      SELECT o.operation_id, o.application_id, o.environment, o.expected_revision, o.phase,
        o.plan_json, o.authorization_json, e.revision, e.disposition
      FROM public.runtime_extension_operations AS o
      JOIN public.runtime_extensions AS e
        ON e.application_id=o.application_id AND e.environment=o.environment
        AND e.delivery_class=o.delivery_class AND e.extension_id=o.extension_id
      WHERE o.operation_id=p_operation_id AND o.application_id=p_application_id
        AND o.environment=p_environment AND o.delivery_class='platform-plugin'
        AND o.extension_id=p_extension_id AND o.phase='planning'
        AND o.expected_revision=e.revision
        AND o.plan_json->>'executionClass'='static-release'
        AND o.plan_json->>'preparation'='impact-only';
    $$;

    REVOKE ALL ON FUNCTION public.k_nex_static_impact_plan(character varying, character varying, character varying, character varying) FROM PUBLIC;

    CREATE FUNCTION public.k_nex_static_shared_generation_rebind(
      p_application_id varchar,
      p_environment varchar,
      p_previous_generation_id varchar,
      p_receipt jsonb,
      p_exclude_extension_id varchar DEFAULT NULL,
      p_operation_id varchar DEFAULT NULL
    ) RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    DECLARE
      v_extension_ids text[] := ARRAY[]::text[];
      v_generation jsonb;
      v_authorization_revision integer;
      v_lifecycle_revision integer;
      v_next_lifecycle_revision integer;
      v_inventory_revision integer;
      v_revision integer;
      v_updated integer;
      v_event_id varchar;
      v_evidence jsonb;
      v_event jsonb;
      v_invalidation jsonb;
      v_row record;
    BEGIN
      IF pg_catalog.jsonb_typeof(p_receipt) <> 'object'
        OR p_receipt->>'receiptId' IS NULL
        OR p_receipt->>'applicationId' IS DISTINCT FROM p_application_id
        OR p_receipt->>'environment' IS DISTINCT FROM p_environment
        OR p_receipt->>'previousGenerationId' IS DISTINCT FROM p_previous_generation_id
        OR (p_exclude_extension_id IS NULL) <> (p_operation_id IS NULL) THEN
        RAISE EXCEPTION 'Shared static generation rebind input is invalid.' USING ERRCODE = '22023';
      END IF;

      SELECT d.active_generation INTO v_generation
      FROM public.runtime_static_deployments AS d
      JOIN public.runtime_static_deployment_outbox AS x
        ON x.application_id=d.application_id AND x.environment=d.environment
        AND x.revision=(p_receipt->>'revisionAfter')::integer
      WHERE d.application_id=p_application_id AND d.environment=p_environment
        AND d.revision=(p_receipt->>'revisionAfter')::integer
        AND d.active_generation_id=p_receipt->>'activeGenerationId'
        AND d.active_generation->>'generationId'=p_receipt->>'activeGenerationId'
        AND x.event_id=p_receipt->>'receiptId' AND x.event_json=p_receipt
      FOR UPDATE OF d, x;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Shared static generation rebind is not bound to the committed deployment receipt.' USING ERRCODE = '40001';
      END IF;

      IF p_exclude_extension_id IS NOT NULL THEN
        PERFORM 1
        FROM public.runtime_extensions AS e
        JOIN public.runtime_extension_operations AS o ON o.operation_id=e.last_operation_id
        JOIN public.runtime_extension_transition_receipts AS t
          ON t.receipt_id=e.last_receipt_id AND t.operation_id=o.operation_id AND t.revision=e.revision
        WHERE e.application_id=p_application_id AND e.environment=p_environment
          AND e.delivery_class='platform-plugin' AND e.extension_id=p_exclude_extension_id
          AND o.operation_id=p_operation_id AND o.application_id=e.application_id AND o.environment=e.environment
          AND o.delivery_class=e.delivery_class AND o.extension_id=e.extension_id
          AND o.plan_json->>'generationId'=p_receipt->>'activeGenerationId'
          AND o.plan_json->'sourceChange'->>'targetSourceCommit'=p_receipt->>'sourceCommit'
          AND o.plan_json->'sourceChange'->>'planDigest'=p_receipt->>'compositionChangePlanDigest'
          AND t.event_json->>'receiptId'=p_receipt->>'receiptId'
          AND (t.event_json->>'revision')::integer=e.revision
          AND t.event_json->'evidence'->>'generationId'=p_receipt->>'activeGenerationId'
          AND t.event_json->'evidence'->>'sourceCommit'=p_receipt->>'sourceCommit'
          AND t.event_json->'evidence'->>'compositionChangePlanDigest'=p_receipt->>'compositionChangePlanDigest'
          AND t.event_json->'evidence'->>'buildEvidenceDigest'=p_receipt->>'buildEvidenceDigest'
          AND t.event_json->'evidence'->>'applicationDigest'=p_receipt->>'applicationDigest'
          AND t.event_json->'evidence'->>'imageDigest'=p_receipt->>'imageDigest'
          AND (
            (
              o.operation_kind<>'uninstall'
              AND e.disposition='active' AND e.active_generation_id=p_receipt->>'activeGenerationId'
              AND e.active_generation->>'authority'='static-build'
              AND e.active_generation->>'generationId'=p_receipt->>'activeGenerationId'
              AND e.active_generation->>'receiptId'=p_receipt->>'receiptId'
              AND (SELECT pg_catalog.count(*) FROM public.k_nex_extension_authorization_generations AS g
                   WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                     AND g.extension_id=e.extension_id AND g.state='current')=1
              AND EXISTS (
                SELECT 1 FROM public.k_nex_extension_authorization_generations AS g
                WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                  AND g.extension_id=e.extension_id AND g.state='current'
                  AND g.runtime_generation_ids=pg_catalog.jsonb_build_array(p_receipt->>'activeGenerationId')
              )
            ) OR (
              o.operation_kind='uninstall' AND e.disposition='removed' AND e.active_generation_id IS NULL
              AND e.retained_generation->>'generationId'=p_previous_generation_id
              AND NOT EXISTS (
                SELECT 1 FROM public.k_nex_extension_authorization_generations AS g
                WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                  AND g.extension_id=e.extension_id AND g.state='current'
              )
            )
          )
        FOR UPDATE OF e, o, t;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Excluded Platform Plugin is not owned by the admitted lifecycle operation.' USING ERRCODE = '40001';
        END IF;
      END IF;

      FOR v_row IN
        SELECT e.extension_id, e.revision, e.active_generation
        FROM public.runtime_extensions AS e
        JOIN public.runtime_extension_operations AS o ON o.operation_id=e.last_operation_id
        WHERE e.application_id=p_application_id AND e.environment=p_environment
          AND e.delivery_class='platform-plugin' AND e.disposition='active'
          AND (p_exclude_extension_id IS NULL OR e.extension_id<>p_exclude_extension_id)
          AND o.application_id=e.application_id AND o.environment=e.environment
          AND o.delivery_class=e.delivery_class AND o.extension_id=e.extension_id
        ORDER BY e.extension_id
        FOR UPDATE OF e, o
      LOOP
        IF v_row.active_generation->>'authority' IS DISTINCT FROM 'static-build'
          OR v_row.active_generation->>'generationId' IS DISTINCT FROM p_previous_generation_id
          OR v_row.active_generation->>'version' IS NULL THEN
          RAISE EXCEPTION 'Retained Platform Plugin does not bind the prior shared generation.' USING ERRCODE = '40001';
        END IF;
        v_extension_ids := pg_catalog.array_append(v_extension_ids, v_row.extension_id::text);
      END LOOP;

      IF pg_catalog.cardinality(v_extension_ids)=0 THEN
        RETURN 0;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.jsonb_build_array(p_application_id, 'authorization-state')::text, 0));
      SELECT authorization_revision, lifecycle_revision
      INTO STRICT v_authorization_revision, v_lifecycle_revision
      FROM public.k_nex_authorization_state
      WHERE application_id=p_application_id
      FOR UPDATE;
      v_next_lifecycle_revision := v_lifecycle_revision + 1;

      PERFORM 1
      FROM public.k_nex_extension_authorization_generations AS g
      WHERE g.application_id=p_application_id AND g.delivery_class='platform-plugin'
        AND g.extension_id=ANY(v_extension_ids) AND g.state='current'
      ORDER BY g.extension_id, g.authorization_generation
      FOR UPDATE;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.unnest(v_extension_ids) AS retained(extension_id)
        WHERE (SELECT pg_catalog.count(*) FROM public.k_nex_extension_authorization_generations AS g
               WHERE g.application_id=p_application_id AND g.delivery_class='platform-plugin'
                 AND g.extension_id=retained.extension_id AND g.state='current')<>1
          OR NOT EXISTS (
            SELECT 1 FROM public.k_nex_extension_authorization_generations AS g
            WHERE g.application_id=p_application_id AND g.delivery_class='platform-plugin'
              AND g.extension_id=retained.extension_id AND g.state='current'
              AND g.runtime_generation_ids=pg_catalog.jsonb_build_array(p_previous_generation_id)
          )
      ) THEN
        RAISE EXCEPTION 'Retained Platform Plugin authorization generation does not bind the prior shared generation.' USING ERRCODE = '40001';
      END IF;

      FOR v_row IN
        SELECT e.extension_id, e.revision, e.active_generation
        FROM public.runtime_extensions AS e
        WHERE e.application_id=p_application_id AND e.environment=p_environment
          AND e.delivery_class='platform-plugin' AND e.extension_id=ANY(v_extension_ids)
        ORDER BY e.extension_id
      LOOP
        UPDATE public.runtime_extension_inventory_revisions
        SET revision=revision+1
        WHERE application_id=p_application_id AND environment=p_environment
        RETURNING revision INTO STRICT v_inventory_revision;
        v_revision := v_row.revision + 1;
        v_evidence := pg_catalog.jsonb_build_object(
          'authority','static-build', 'generationId',v_generation->>'generationId', 'version',v_row.active_generation->>'version',
          'sourceCommit',p_receipt->>'sourceCommit', 'compositionChangePlanDigest',p_receipt->>'compositionChangePlanDigest',
          'buildEvidenceDigest',p_receipt->>'buildEvidenceDigest', 'applicationDigest',p_receipt->>'applicationDigest',
          'imageDigest',p_receipt->>'imageDigest', 'migrationRevision',(p_receipt->>'migrationRevision')::integer,
          'workerFencingToken',(p_receipt->>'workerFencingToken')::bigint, 'receiptId',p_receipt->>'receiptId'
        );
        v_event_id := 'static-rebind-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to((p_receipt->>'receiptId') || ':' || v_row.extension_id, 'UTF8')
        ), 'hex'), 1, 26);
        v_event := pg_catalog.jsonb_build_object(
          'schemaVersion',1, 'eventId',v_event_id, 'eventType','extension.shared-static-generation-rebind',
          'receiptId',p_receipt->>'receiptId', 'applicationId',p_application_id, 'environment',p_environment,
          'deliveryClass','platform-plugin', 'id',v_row.extension_id, 'expectedRevision',v_row.revision,
          'revision',v_revision, 'inventoryRevision',v_inventory_revision, 'previousGenerationId',p_previous_generation_id,
          'evidence',pg_catalog.jsonb_build_object(
            'sourceCommit',p_receipt->>'sourceCommit', 'compositionChangePlanDigest',p_receipt->>'compositionChangePlanDigest',
            'generationId',v_generation->>'generationId', 'buildEvidenceDigest',p_receipt->>'buildEvidenceDigest',
            'applicationDigest',p_receipt->>'applicationDigest', 'imageDigest',p_receipt->>'imageDigest',
            'workerFencingToken',(p_receipt->>'workerFencingToken')::bigint
          ),
          'occurredAt',p_receipt->>'occurredAt'
        );
        UPDATE public.runtime_extensions
        SET revision=v_revision, active_generation_id=v_generation->>'generationId', active_generation=v_evidence,
          rollback_generation_id=p_previous_generation_id, rollback_generation=v_row.active_generation, retained_generation=NULL,
          last_receipt_id=p_receipt->>'receiptId',
          state_digest='sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_event::text, 'UTF8')), 'hex'),
          updated_at=pg_catalog.now()
        WHERE application_id=p_application_id AND environment=p_environment AND delivery_class='platform-plugin'
          AND extension_id=v_row.extension_id AND revision=v_row.revision AND active_generation_id=p_previous_generation_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated<>1 THEN
          RAISE EXCEPTION 'Retained Platform Plugin changed during shared generation rebind.' USING ERRCODE = '40001';
        END IF;
        INSERT INTO public.runtime_extension_outbox
          (event_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
        VALUES (v_event_id, p_application_id, p_environment, 'platform-plugin', v_row.extension_id, v_revision, v_inventory_revision, v_event);
      END LOOP;

      UPDATE public.k_nex_extension_authorization_generations
      SET runtime_generation_ids=pg_catalog.jsonb_build_array(v_generation->>'generationId'),
        lifecycle_revision=v_next_lifecycle_revision, updated_at=pg_catalog.now()
      WHERE application_id=p_application_id AND delivery_class='platform-plugin'
        AND extension_id=ANY(v_extension_ids) AND state='current'
        AND runtime_generation_ids=pg_catalog.jsonb_build_array(p_previous_generation_id);
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated<>pg_catalog.cardinality(v_extension_ids) THEN
        RAISE EXCEPTION 'Authorization generation changed during shared static generation rebind.' USING ERRCODE = '40001';
      END IF;

      UPDATE public.k_nex_authorization_state
      SET lifecycle_revision=v_next_lifecycle_revision, updated_at=pg_catalog.now()
      WHERE application_id=p_application_id AND authorization_revision=v_authorization_revision AND lifecycle_revision=v_lifecycle_revision;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated<>1 THEN
        RAISE EXCEPTION 'Authorization state changed during shared static generation rebind.' USING ERRCODE = '40001';
      END IF;
      v_invalidation := pg_catalog.jsonb_build_object(
        'applicationId',p_application_id, 'environment',p_environment, 'scope','environment',
        'authorizationRevision',v_authorization_revision, 'lifecycleRevision',v_next_lifecycle_revision
      );
      INSERT INTO public.k_nex_authorization_outbox
        (event_id, application_id, environment, authorization_revision, lifecycle_revision, event_json)
      VALUES (pg_catalog.gen_random_uuid(), p_application_id, p_environment, v_authorization_revision, v_next_lifecycle_revision, v_invalidation)
      ON CONFLICT (application_id, environment, authorization_revision, lifecycle_revision) DO NOTHING;
      RETURN pg_catalog.cardinality(v_extension_ids);
    END;
    $$;

    REVOKE ALL ON FUNCTION public.k_nex_static_shared_generation_rebind(character varying, character varying, character varying, jsonb, character varying, character varying) FROM PUBLIC;

    CREATE FUNCTION public.k_nex_static_serving_generation(
      p_application_id varchar,
      p_environment varchar
    ) RETURNS varchar
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    DECLARE
      v_revision integer;
      v_active_generation_id varchar;
      v_previous_generation_id varchar;
      v_receipt jsonb;
    BEGIN
      SELECT d.revision, d.active_generation_id, x.event_json->>'previousGenerationId', x.event_json
      INTO v_revision, v_active_generation_id, v_previous_generation_id, v_receipt
      FROM public.runtime_static_deployments AS d
      LEFT JOIN LATERAL (
        SELECT event_json
        FROM public.runtime_static_deployment_outbox
        WHERE application_id=d.application_id AND environment=d.environment
          AND event_json->>'activeGenerationId'=d.active_generation_id
          AND event_json->>'operation' IN ('promote','rollback')
        ORDER BY revision DESC
        LIMIT 1
      ) AS x ON true
      WHERE d.application_id=p_application_id AND d.environment=p_environment;

      IF v_active_generation_id IS NULL THEN
        RETURN NULL;
      END IF;

      IF v_revision=0 THEN
        RETURN v_active_generation_id;
      END IF;

      IF v_receipt IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.runtime_extension_transition_receipts AS t
        JOIN public.runtime_extension_operations AS o ON o.operation_id=t.operation_id
        WHERE t.receipt_id=v_receipt->>'receiptId'
          AND o.application_id=p_application_id AND o.environment=p_environment
          AND o.delivery_class='platform-plugin'
          AND o.phase='completed' AND o.result_json=v_receipt
          AND o.plan_json->>'generationId'=v_active_generation_id
          AND o.plan_json->'sourceChange'->>'targetSourceCommit'=v_receipt->>'sourceCommit'
          AND o.plan_json->'sourceChange'->>'planDigest'=v_receipt->>'compositionChangePlanDigest'
          AND t.event_json->>'receiptId'=v_receipt->>'receiptId'
          AND t.event_json->>'operationId'=o.operation_id
          AND t.event_json->>'operation'=o.operation_kind
          AND t.event_json->>'operationPhase'='completed'
          AND t.event_json->'evidence'->>'generationId'=v_active_generation_id
          AND t.event_json->'evidence'->>'sourceCommit'=v_receipt->>'sourceCommit'
          AND t.event_json->'evidence'->>'compositionChangePlanDigest'=v_receipt->>'compositionChangePlanDigest'
          AND t.event_json->'evidence'->>'buildEvidenceDigest'=v_receipt->>'buildEvidenceDigest'
          AND t.event_json->'evidence'->>'applicationDigest'=v_receipt->>'applicationDigest'
          AND t.event_json->'evidence'->>'imageDigest'=v_receipt->>'imageDigest'
      ) THEN
        RETURN v_previous_generation_id;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.runtime_extensions AS e
        WHERE e.application_id=p_application_id AND e.environment=p_environment
          AND e.delivery_class='platform-plugin' AND e.disposition='active'
          AND (
            e.active_generation_id IS DISTINCT FROM v_active_generation_id
            OR e.active_generation->>'generationId' IS DISTINCT FROM v_active_generation_id
            OR (SELECT pg_catalog.count(*) FROM public.k_nex_extension_authorization_generations AS g
                WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                  AND g.extension_id=e.extension_id AND g.state='current')<>1
            OR NOT EXISTS (
              SELECT 1 FROM public.k_nex_extension_authorization_generations AS g
              WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                AND g.extension_id=e.extension_id AND g.state='current'
                AND g.runtime_generation_ids=pg_catalog.jsonb_build_array(v_active_generation_id)
            )
          )
      ) THEN
        RETURN v_previous_generation_id;
      END IF;
      RETURN v_active_generation_id;
    END;
    $$;

    REVOKE ALL ON FUNCTION public.k_nex_static_serving_generation(character varying, character varying) FROM PUBLIC;

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=21, "revision"=22 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP FUNCTION public.k_nex_static_serving_generation(character varying, character varying);
    DROP FUNCTION public.k_nex_static_shared_generation_rebind(character varying, character varying, character varying, jsonb, character varying, character varying);
    DROP FUNCTION public.k_nex_static_impact_plan(character varying, character varying, character varying, character varying);
    DROP FUNCTION public.k_nex_static_lifecycle_admission(character varying, character varying, character varying, character varying);
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=20, "revision"=21 WHERE "id"=1;
  `);
}
