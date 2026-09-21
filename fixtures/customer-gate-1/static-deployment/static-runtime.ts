import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { sql } from "@payloadcms/db-postgres";
import { createPayloadRequest, getPayload, type PayloadRequest } from "payload";
import { activePayloadPostgresTransaction, admitTrustedSalesTaskCreateId, createPayloadPersistenceCapability, CurrentAuthorityPayloadPersistenceAuthorizer, revokeTrustedSalesTaskCreateId, runtimeExtensionIdentityKey } from "@k-nex/payload-adapter";
import { canonicalJson, PluginManifestSchema } from "@k-nex/contracts";
import { ActionGatewayError, CurrentAuthorityActionGatewayPolicy, RegisteredActionGateway } from "@k-nex/runtime";
import { salesTaskCreateDefinition } from "@k-nex/module-sales/server";
import { createHash } from "node:crypto";
import {
  createPlatformPluginLifecycleState,
  executeRegistration,
  reconcilePlatformPluginAvailability,
  scopePlatformPluginRegistration
} from "@k-nex/runtime";
import salesManifest from "@k-nex/module-sales/manifest" with { type: "json" };

import config from "@payload-config";
import resolvedJson from "./k-nex-generated/k-nex.resolved.json" with { type: "json" };
import { runtimeRegistration } from "./k-nex-generated/runtime-registration";
import { createFixtureCurrentAuthority, createFixtureStaticProcessIdentityProvider } from "./current-authority";
import type { FixtureAuthorityContext, FixtureDurableSalesAuthority } from "./current-authority";

let runtimePromise: ReturnType<typeof initializeRuntime> | undefined;
const staticOwner = Object.freeze({ applicationId: "customer-alpha", environment: "production" });
const staticIdentity = createFixtureStaticProcessIdentityProvider(staticOwner);
const staticRegistration = (() => {
  const manifest = PluginManifestSchema.parse(salesManifest);
  const plugin = resolvedJson.plugins.find(({ id }) => id === manifest.id);
  if (!plugin) throw new Error("Static release is missing Sales registration identity.");
  const registration = executeRegistration({
    graph: { resolverVersion: "1.0.0", plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: plugin.integrity, required: plugin.required, optional: plugin.optional }], capabilityProviders: [], registrationOrder: [manifest.id] },
    installed: [{ package: { name: manifest.package, version: manifest.version, integrity: plugin.integrity }, manifest }],
    registrations: [runtimeRegistration["module.sales"].salesRegistration]
  });
  return scopePlatformPluginRegistration(registration, [reconcilePlatformPluginAvailability(registration, createPlatformPluginLifecycleState({
    pluginId: manifest.id, catalogStatus: "supported", package: { status: "installed", name: manifest.package, version: manifest.version, integrity: plugin.integrity }, enabled: true,
    configuration: { revision: 1, ready: true }, migration: { current: 1, required: 1, ready: true }, dataState: "active", releaseStatus: "supported"
  }))]);
})();
const staticAuthority = createFixtureCurrentAuthority(staticRegistration, staticIdentity, undefined, staticOwner);

async function initializeRuntime() {
  const payload = await getPayload({ config });
  const release = JSON.parse(await readFile(join(process.cwd(), "release.json"), "utf8"));
  const generation = process.env.K_NEX_GENERATION;
  const sourceCommit = process.env.K_NEX_SOURCE_COMMIT;
  const applicationDigest = process.env.K_NEX_APPLICATION_DIGEST;
  const smokeToken = process.env.K_NEX_SMOKE_TOKEN;
  const databaseUrl = process.env.DATABASE_URL;
  const expectedSchemaRevision = Number(process.env.K_NEX_SCHEMA_REVISION);
  const processIdentity = process.env.K_NEX_WEB_PROCESS_IDENTITY;
  if (!databaseUrl || !generation || !smokeToken || !Number.isSafeInteger(expectedSchemaRevision) || !processIdentity || !payload.config.collections.some(({ slug }) => slug === "sales-opportunities") || !payload.config.collections.some(({ slug }) => slug === "sales-tasks")) {
    throw new Error("Customer Payload/Next runtime is missing its registry or versioned database authority.");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  await pool.query(
    "insert into p9_static_process_events (role, instance_id, event, generation_id, detail) values ('web',$1,'web-started',$2,$3::jsonb)",
    [processIdentity, generation, JSON.stringify({ processId: process.pid, processIdentity, customerPayloadRegistry: true, payloadNextRuntime: true })]
  );
  return { applicationDigest, expectedSchemaRevision, generation, payload, pluginVersion: release.plugin.version, pool, processIdentity, smokeToken, sourceCommit };
}

function runtime() {
  return runtimePromise ??= initializeRuntime();
}

async function schemaProof() {
  const { expectedSchemaRevision, generation, pool } = await runtime();
  const authority = await pool.query("select revision, last_step_id from p9_static_migration_authority where authority_id='customer-alpha'");
  const revision = authority.rows[0];
  if (!revision || Number(revision.revision) < expectedSchemaRevision) throw new Error("INCOMPATIBLE_SCHEMA_REVISION");
  await pool.query(
    "insert into p9_static_binary_observations (generation_id, binary_revision, database_role, observed_step) values ($1,$2,current_user,$3)",
    [generation, expectedSchemaRevision, revision.last_step_id]
  );
  const role = await pool.query("select current_user database_role");
  const overlap = expectedSchemaRevision === 11
    ? await pool.query("select array_agg(legacy_value order by id) values from p9_static_overlap")
    : await pool.query("select array_agg(expanded_value order by id) values from p9_static_overlap");
  return { databaseRole: role.rows[0].database_role, schemaRevision: Number(revision.revision), values: overlap.rows[0].values };
}

async function leastPrivilegeProof() {
  const { pool } = await runtime();
  try { await pool.query("create table p9_static_privilege_escape (id integer)"); return { rejected: false }; }
  catch (error) { return { rejected: typeof error === "object" && error !== null && "code" in error && error.code === "42501" }; }
}

type StaticTaskOperation = {
  readonly request: PayloadRequest;
  readonly key: string;
  readonly digest: string;
  readonly durable: FixtureDurableSalesAuthority;
  replay?: unknown;
};

function staticDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function staticTaskEventId(operation: StaticTaskOperation) {
  return `sales-action-${createHash("sha256").update(canonicalJson({
    applicationId: operation.durable.context.applicationId,
    environment: operation.durable.context.environment,
    actorId: operation.durable.context.actorId,
    actionId: salesTaskCreateDefinition.descriptor.id,
    key: operation.key,
    digest: operation.digest
  })).digest("hex")}`;
}

function resultRows(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || !("rows" in value) || !Array.isArray(value.rows)) throw new Error("Static Sales action received an invalid Postgres result.");
  return value.rows as readonly Record<string, unknown>[];
}

/** This is the static release's bounded coordinator: same durable reservation
 * and finalization records as its host action counterpart, without importing
 * the unrelated live/dev action endpoint closure into the immutable image. */
async function reserveStaticTask(operation: StaticTaskOperation) {
  const transaction = await activePayloadPostgresTransaction(operation.request);
  const pending = { state: "pending" };
  let row = resultRows(await transaction.execute(sql`INSERT INTO "sales_action_idempotency" ("application_id","environment","effective_actor_id","action_id","idempotency_key","request_digest","result_json","result_digest","authorization_revision","lifecycle_revision") VALUES (${operation.durable.context.applicationId},${operation.durable.context.environment},${operation.durable.context.actorId},${salesTaskCreateDefinition.descriptor.id},${operation.key},${operation.digest},${JSON.stringify(pending)}::jsonb,${staticDigest(pending)},${operation.durable.authorizationRevision},${operation.durable.lifecycleRevision}) ON CONFLICT ("application_id","environment","effective_actor_id","action_id","idempotency_key") DO NOTHING RETURNING "request_digest","result_json","result_digest"`))[0];
  if (row === undefined) row = resultRows(await transaction.execute(sql`SELECT "request_digest","result_json","result_digest" FROM "sales_action_idempotency" WHERE "application_id"=${operation.durable.context.applicationId} AND "environment"=${operation.durable.context.environment} AND "effective_actor_id"=${operation.durable.context.actorId} AND "action_id"=${salesTaskCreateDefinition.descriptor.id} AND "idempotency_key"=${operation.key} FOR UPDATE`))[0];
  if (row === undefined) throw new Error("Static Sales action idempotency reservation was lost.");
  if (row.request_digest !== operation.digest) throw new ActionGatewayError("IDEMPOTENCY_CONFLICT", 409, "Sales action idempotency key was reused for different input.");
  if (row.result_json === null || typeof row.result_json !== "object" || Array.isArray(row.result_json) || row.result_digest !== staticDigest(row.result_json)) throw new Error("Static Sales action idempotency evidence is invalid.");
  const result = row.result_json as Record<string, unknown>;
  if (result.state === "succeeded" && Object.keys(result).sort().join("\0") === "data\0state") operation.replay = result.data;
  else if (result.state !== "pending" || Object.keys(result).join("\0") !== "state") throw new Error("Static Sales action idempotency state is invalid.");
}

async function completeStaticTask(operation: StaticTaskOperation, data: unknown) {
  const transaction = await activePayloadPostgresTransaction(operation.request);
  const result = { state: "succeeded", data };
  if (resultRows(await transaction.execute(sql`UPDATE "sales_action_idempotency" SET "result_json"=${JSON.stringify(result)}::jsonb,"result_digest"=${staticDigest(result)} WHERE "application_id"=${operation.durable.context.applicationId} AND "environment"=${operation.durable.context.environment} AND "effective_actor_id"=${operation.durable.context.actorId} AND "action_id"=${salesTaskCreateDefinition.descriptor.id} AND "idempotency_key"=${operation.key} AND "request_digest"=${operation.digest} AND "result_json"='{"state":"pending"}'::jsonb RETURNING "idempotency_key"`)).length !== 1) throw new Error("Static Sales action idempotency finalization was lost.");
}

async function durableStaticTaskFence(request: PayloadRequest, durable: FixtureDurableSalesAuthority) {
  const transaction = await activePayloadPostgresTransaction(request);
  const state = resultRows(await transaction.execute(sql`SELECT "authorization_revision", "lifecycle_revision" FROM public."k_nex_authorization_state" WHERE "application_id"=${durable.context.applicationId}`))[0];
  const scope = resultRows(await transaction.execute(sql`SELECT "revision" FROM public."sales_current_authority_scopes" WHERE "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment} AND "principal_id"=${durable.context.actorId} AND "state"='active' AND "mutation_allowed"=true`))[0];
  return state?.authorization_revision === durable.authorizationRevision && state?.lifecycle_revision === durable.lifecycleRevision && scope?.revision === durable.scopeRevision;
}

async function executeStaticCreateOnlyTask(input: unknown, request: PayloadRequest, correlationId: string, idempotencyKey: string, generation: string) {
  const context: FixtureAuthorityContext = staticAuthority.context(request, correlationId);
  const transactionID = await request.payload.db.beginTransaction();
  if (transactionID === null || transactionID === undefined) throw new Error("Static Sales action could not open a Payload transaction.");
  request.transactionID = transactionID;
  let trustedIdAdmissionMinted = false;
  try {
    const admissionTransaction = await activePayloadPostgresTransaction(request);
    // Readers share the same canonical keys as lifecycle writers. Writers take
    // global static then exclusive runtime/auth keys, preventing a create from
    // crossing promotion or authority mutation while independent creates proceed.
    await admissionTransaction.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${runtimeExtensionIdentityKey({ applicationId: "customer-alpha", environment: "production", deliveryClass: "platform-plugin", extensionId: "module.sales" })}, 0))`);
    await admissionTransaction.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${canonicalJson(["customer-alpha", "authorization-state"])}, 0))`);
    const lifecycle = resultRows(await admissionTransaction.execute(sql`select disposition, active_generation_id from runtime_extensions where application_id='customer-alpha' and environment='production' and delivery_class='platform-plugin' and extension_id='module.sales'`))[0];
    if (lifecycle?.disposition !== "active" || lifecycle.active_generation_id !== generation) {
      await request.payload.db.rollbackTransaction(transactionID);
      return undefined;
    }
    let durable: FixtureDurableSalesAuthority;
    try { durable = await staticAuthority.resolveDurableSalesAuthority(request, correlationId); }
    catch {
      await request.payload.db.rollbackTransaction(transactionID);
      return undefined;
    }
    if (!durable.mutationAllowed) {
      await request.payload.db.rollbackTransaction(transactionID);
      return undefined;
    }
    const persistence = createPayloadPersistenceCapability(request, [{ collection: "sales-tasks", operations: ["create"] }] as const, new CurrentAuthorityPayloadPersistenceAuthorizer(staticAuthority.adapter, context, ({ collection, operation }) => staticAuthority.payloadAction(salesTaskCreateDefinition.descriptor.id, collection, operation)), {
      guard: async (candidate) => {
        if (!await durableStaticTaskFence(request, durable) || candidate.collection !== "sales-tasks" || candidate.operation !== "create") return false;
        try { return await staticAuthority.adapter.allows(context, staticAuthority.payloadAction(salesTaskCreateDefinition.descriptor.id, candidate.collection, candidate.operation)); }
        catch { return false; }
      }
    });
    const operation: StaticTaskOperation = { request, key: idempotencyKey, digest: staticDigest({ actionId: salesTaskCreateDefinition.descriptor.id, input }), durable };
    const policy = new CurrentAuthorityActionGatewayPolicy(
      staticAuthority.adapter,
      () => context,
      (action, candidate) => staticAuthority.action(action, candidate),
      { authorize: async ({ action }) => {
        if (action.descriptor.id !== salesTaskCreateDefinition.descriptor.id) throw new ActionGatewayError("ACTION_NOT_FOUND", 404, "Action is not available.");
        await persistence.transaction.begin();
        await reserveStaticTask(operation);
        if (!await persistence.guard({ collection: "sales-tasks", operation: "create" })) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action authority changed.");
        if (operation.replay !== undefined) {
          return Object.freeze({
            actionId: action.descriptor.id,
            applicationId: context.applicationId,
            environment: context.environment,
            actorId: context.actorId,
            ownerId: context.ownerId,
            ...(context.teamId === undefined ? {} : { teamId: context.teamId }),
            authorizationRevision: durable.authorizationRevision,
            lifecycleRevision: durable.lifecycleRevision,
            salesScopeRevision: durable.scopeRevision,
            idempotencyReplay: operation.replay
          });
        }
        const transaction = await activePayloadPostgresTransaction(request);
        const allocated = resultRows(await transaction.execute(sql`SELECT nextval(pg_get_serial_sequence('public.sales_tasks','id')) AS id`))[0];
        const resourceId = allocated?.id === undefined ? undefined : String(allocated.id);
        const numericResourceId = resourceId === undefined ? undefined : Number(resourceId);
        if (resourceId === undefined || !/^[1-9][0-9]*$/u.test(resourceId) || typeof numericResourceId !== "number" || !Number.isSafeInteger(numericResourceId) || numericResourceId < 1 || numericResourceId > 2_147_483_647) throw new Error("Static Sales task sequence allocation is invalid.");
        await admitTrustedSalesTaskCreateId(request, { id: numericResourceId, resourceId });
        trustedIdAdmissionMinted = true;
        return Object.freeze({
          actionId: action.descriptor.id,
          resourceId,
          applicationId: context.applicationId,
          environment: context.environment,
          actorId: context.actorId,
          ownerId: context.ownerId,
          ...(context.teamId === undefined ? {} : { teamId: context.teamId }),
          authorizationRevision: durable.authorizationRevision,
          lifecycleRevision: durable.lifecycleRevision,
          salesScopeRevision: durable.scopeRevision,
          eventId: staticTaskEventId(operation)
        });
      } }
    );
    const gateway = new RegisteredActionGateway(staticRegistration, {
      authenticate: () => {
        if (request.user === null || request.user === undefined || request.user.collection !== "users" || request.user.id === null || request.user.id === undefined) {
          throw new ActionGatewayError("INVALID_ACTOR_CONTEXT", 401, "Authentication context is invalid.");
        }
        const id = String(request.user.id);
        return Object.freeze({ actor: Object.freeze({ principal: Object.freeze({ kind: "user", id }), effectiveActor: Object.freeze({ kind: "user", id }) }), request: persistence, authorizationContext: context });
      }
    }, { authorize: policy.authorize.bind(policy) });
    const response = await gateway.execute({
      correlationId,
      rawRequest: request,
      actionId: salesTaskCreateDefinition.descriptor.id,
      input,
      idempotencyKey,
      signal: request.signal ?? new AbortController().signal
    });
    if (!response.ok) {
      await persistence.transaction.rollback();
      await request.payload.db.rollbackTransaction(transactionID);
      return response;
    }
    if (operation.replay === undefined) await completeStaticTask(operation, response.body.data);
    await persistence.transaction.commit();
    await request.payload.db.commitTransaction(transactionID);
    return response;
  } catch (error) {
    await request.payload.db.rollbackTransaction(transactionID);
    throw error;
  } finally {
    if (trustedIdAdmissionMinted) revokeTrustedSalesTaskCreateId(request);
  }
}

async function salesOperationProof(request: Request) {
  const { generation, payload, pool, smokeToken } = await runtime();
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${smokeToken}:p10-static-sales-user`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return { authorized: false };
  const user = { collection: "users" as const, id: "p10-static-sales-user", email: "fixture@example.test" };
  const payloadRequest = await createPayloadRequest({ config: payload.config, request });
  payloadRequest.user = user;
  const action = await executeStaticCreateOnlyTask(await request.json(), payloadRequest, "p10-static-sales-operation", request.headers.get("x-idempotency-key") ?? "p9-static-sales-action", generation);
  if (action === undefined || !action.ok) return { authorized: false };
  const role = await pool.query("select current_user database_role");
  return { authorized: true, databaseRole: role.rows[0]?.database_role, task: action.body.data };
}

function json(status: number, value: unknown) {
  return Response.json(value, { status });
}

export async function handleStaticRuntimeRequest(request: Request) {
  const { applicationDigest, generation, pluginVersion, processIdentity, smokeToken, sourceCommit } = await runtime();
  const path = new URL(request.url).pathname;
  if (path === "/slow") await new Promise((resolve) => setTimeout(resolve, 250));
  if (path === "/health" && process.env.K_NEX_FAIL_HEALTH === "1") return json(500, { status: "failed" });
  if (path === "/authenticated" && request.headers.get("x-k-nex-smoke-auth") !== smokeToken) return json(401, { error: "authentication-required" });
  if (path === "/schema-proof") return json(200, await schemaProof());
  if (path === "/least-privilege") return json(200, await leastPrivilegeProof());
  if (path === "/sales-operation") {
    if (request.method !== "POST") return json(405, { error: "method-not-allowed" });
    try {
      const proof = await salesOperationProof(request);
      return json(proof.authorized ? 200 : 403, proof);
    } catch (error) {
      console.error("P9_SALES_OPERATION_FAILURE", error);
      return json(500, { error: error instanceof Error ? { name: error.name, message: error.message } : { name: "Error", message: "Unknown Sales operation failure." } });
    }
  }
  if (path === "/process-identity") return json(200, { processIdentity, processId: process.pid, generation, payloadNextRuntime: true });
  return json(200, { applicationDigest, generation, module: "module.sales", path, payloadNextRuntime: true, pluginVersion, sourceCommit, workerMode: process.env.K_NEX_WORKER_MODE });
}
