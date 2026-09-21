import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@k-nex/contracts";
import { activePayloadPostgresTransaction } from "@k-nex/payload-adapter";
import { ActionGatewayError } from "@k-nex/runtime";
import { sql } from "@payloadcms/db-postgres";
import type { Endpoint, PayloadRequest } from "payload";

type Row = Record<string, unknown>;
type ProviderId = "email.reference.v1" | "calendar.reference.v1";
type ProviderActionId = "sales.email.send" | "sales.calendar.sync" | "sales.integration.configure";
export type GeneratedSalesProviderIntent = Readonly<{ actionId: ProviderActionId; idempotencyKey: string; relatedRecord: Readonly<{ type: "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity" | "sales.task"; id: number }> | null; payload: Readonly<Record<string, unknown>> }>;
export type GeneratedSalesProviderResult = Readonly<{ operationId: string; state: "queued" | "accepted"; providerId: ProviderId; receipt: Readonly<{ idempotencyDigest: string; relatedRecord: GeneratedSalesProviderIntent["relatedRecord"] }> }>;
export type GeneratedSalesProviderGateway = Readonly<{ dispatch(intent: GeneratedSalesProviderIntent): Promise<GeneratedSalesProviderResult> }>;
export type GeneratedSalesProviderConfigurationReadGateway = Readonly<{ read(input: Readonly<{ applicationId: string; environment: string; actorId: string }>): Promise<readonly Readonly<{ providerId: ProviderId; state: "active" | "revoked"; revision: number; updatedAt: string; revokedAt: string | null }>[]> }>;
/** Host-owned fixed adapter; callers receive neither endpoint authority nor provider credentials. */
type ProviderSql = Readonly<{ query(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[] }> }>;
type ProviderClient = ProviderSql & Readonly<{ release(): void }>;
type ProviderPool = ProviderSql & Readonly<{ connect(): Promise<ProviderClient> }>;
export type GeneratedSalesProviderSecretPurpose = "provider-api" | "webhook-signature";
export type GeneratedSalesProviderSecretResolver = Readonly<{ resolve(reference: string, purpose: GeneratedSalesProviderSecretPurpose): Promise<Readonly<{ value: string }>> }>;
/**
 * A post-effect check cannot unsend a message, so exactly-once here is the
 * provider's promise, not the host's hope.  This release admits exactly one
 * provider family: the bounded reference provider.  It enters the lane only by
 * declaring durable, key-scoped exactly-once delivery plus a receipt lookup the
 * worker can use to reconcile a lost response, and the host verifies that
 * declaration before every effect.
 */
export type GeneratedSalesProviderContractId = "k-nex.reference-provider.v1";
export type GeneratedSalesProviderIdempotencyCapability = Readonly<{ contractId: GeneratedSalesProviderContractId; version: 1; providerId: ProviderId; idempotency: "durable-key-scoped-exactly-once"; idempotencyKeyFormat: "sha256-canonical-json-v1"; reconciliation: "receipt-lookup-by-idempotency-key"; durability: "survives-provider-restart" }>;
export type GeneratedSalesProviderEffectReceipt = Readonly<{ providerReceiptId: string; idempotencyKey: string; duplicate: boolean }>;
export type GeneratedSalesProviderTransport = Readonly<{
  capability(providerId: ProviderId): GeneratedSalesProviderIdempotencyCapability;
  invoke(input: Readonly<{ providerId: ProviderId; credential: string; idempotencyKey: string; payload: Readonly<Record<string, unknown>> }>): Promise<GeneratedSalesProviderEffectReceipt>;
  reconcile(input: Readonly<{ providerId: ProviderId; credential: string; idempotencyKey: string }>): Promise<GeneratedSalesProviderEffectReceipt | null>;
}>;
export type GeneratedSalesDurableAuthority = Readonly<{ context: Readonly<{ applicationId: string; environment: string; actorId: string }>; authorizationRevision: number; lifecycleRevision: number; scopeRevision: number; permissionGrants?: readonly string[] }>;
export type SalesCommunicationWorkerFence = Readonly<{ applicationId: string; environment: string; activeExecutionGeneration: string; fencingToken: number; leaseOwner: string; promotionRevision: number }>;

class ProviderHostInvariantError extends Error {}
/** A provider that refuses an idempotency key already bound to other bytes is stating a permanent fact, not a transient one. */
class ProviderDuplicateKeyError extends Error {}
class ProviderReplayRace extends Error {}
class ProviderStaleWorker extends Error {}
const sha256 = (value: string | Uint8Array) => "sha256:" + createHash("sha256").update(value).digest("hex");
const rows = (value: unknown): readonly Row[] => typeof value === "object" && value !== null && "rows" in value && Array.isArray((value as Row).rows) ? (value as { rows: Row[] }).rows : (() => { throw new Error("Provider SQL result is invalid."); })();
async function checkedTransaction<T>(pool: ProviderPool, work: (client: ProviderClient) => Promise<T>): Promise<T> { const client = await pool.connect(); try { await client.query("begin"); const value = await work(client); await client.query("commit"); return value; } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } }
const actionError = (code: string, status: number, detail: string): never => { throw new ActionGatewayError(code, status, detail); };
const safeInteger = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) ? value : typeof value === "string" && /^-?[0-9]+$/u.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
const webhookMetadata = (providerId: ProviderId, value: unknown): Readonly<Record<string, string>> | undefined =>
  providerId === "email.reference.v1" && exactObject(value, ["providerMessageId"]) && typeof value.providerMessageId === "string" && /^[A-Za-z0-9._:-]{1,160}$/u.test(value.providerMessageId) ? Object.freeze({ providerMessageId: value.providerMessageId }) :
  providerId === "calendar.reference.v1" && exactObject(value, ["providerEventId"]) && typeof value.providerEventId === "string" && /^[A-Za-z0-9._:-]{1,160}$/u.test(value.providerEventId) ? Object.freeze({ providerEventId: value.providerEventId }) : undefined;
const requiredPermission = (action: ProviderActionId) => action === "sales.email.send" ? "sales.communications.email.send" : action === "sales.calendar.sync" ? "sales.communications.calendar.sync" : "sales.settings.write";
const providerFor = (action: ProviderActionId, payload: Readonly<Record<string, unknown>>): ProviderId | undefined => action === "sales.email.send" ? "email.reference.v1" : action === "sales.calendar.sync" ? "calendar.reference.v1" : payload.providerId === "email.reference.v1" || payload.providerId === "calendar.reference.v1" ? payload.providerId : undefined;
function exactObject(value: unknown, keys: readonly string[]): value is Row { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Row).sort().join("\u0000") === [...keys].sort().join("\u0000"); }
function validIntent(value: GeneratedSalesProviderIntent): boolean {
  return ["sales.email.send", "sales.calendar.sync", "sales.integration.configure"].includes(value.actionId) && typeof value.idempotencyKey === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(value.idempotencyKey) &&
    (value.relatedRecord === null || ["sales.account", "sales.contact", "sales.lead", "sales.opportunity", "sales.task"].includes(value.relatedRecord.type) && Number.isSafeInteger(value.relatedRecord.id) && value.relatedRecord.id > 0) &&
    (value.actionId !== "sales.email.send" || value.relatedRecord !== null && (value.relatedRecord.type === "sales.contact" || value.relatedRecord.type === "sales.lead")) &&
    (value.actionId === "sales.integration.configure" || Number.isSafeInteger(value.payload.activityId) && Number(value.payload.activityId) > 0 && Number.isSafeInteger(value.payload.expectedRevision) && Number(value.payload.expectedRevision) > 0) &&
    value.payload !== null && typeof value.payload === "object" && !Array.isArray(value.payload) && Buffer.byteLength(canonicalJson(value.payload), "utf8") <= 32_768 &&
    (value.actionId === "sales.integration.configure" ? configureInput(value.payload) : providerPayload(value.actionId, value.payload));
}
function providerPayload(actionId: ProviderActionId, value: Readonly<Record<string, unknown>>): boolean {
  if (Object.keys(value).some((key) => /(?:secret|token|credential|password|authorization|url|uri|address|recipient)/iu.test(key))) return false;
  return actionId === "sales.email.send" ? exactObject(value, ["activityId", "body", "expectedRevision", "subject"]) && Number.isSafeInteger(value.activityId) && Number(value.activityId) > 0 && Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) > 0 && typeof value.subject === "string" && value.subject.length > 0 && value.subject.length <= 256 && typeof value.body === "string" && value.body.length > 0 && value.body.length <= 16_384 : actionId === "sales.calendar.sync" ? exactObject(value, ["activityId", "expectedRevision"]) && Number.isSafeInteger(value.activityId) && Number(value.activityId) > 0 && Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) > 0 : false;
}
const secretReferencePattern = /^secret-ref:v1:(email-reference|calendar-reference):(provider-api|webhook-signature):[A-Za-z0-9._-]{1,160}$/u;
function validSecretReference(value: unknown, purpose: GeneratedSalesProviderSecretPurpose): value is string { return typeof value === "string" && secretReferencePattern.exec(value)?.[2] === purpose; }
const providerReceiptIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
function admittedProviderReceipt(value: unknown, idempotencyKey: string): GeneratedSalesProviderEffectReceipt {
  if (!exactObject(value, ["duplicate", "idempotencyKey", "providerReceiptId"]) || typeof value.providerReceiptId !== "string" || !providerReceiptIdPattern.test(value.providerReceiptId) ||
    value.idempotencyKey !== idempotencyKey || typeof value.duplicate !== "boolean") throw new ProviderHostInvariantError("Provider receipt is invalid.");
  return Object.freeze({ providerReceiptId: value.providerReceiptId, idempotencyKey, duplicate: value.duplicate });
}
function admittedProviderCapability(transport: GeneratedSalesProviderTransport, providerId: ProviderId): void {
  let capability: GeneratedSalesProviderIdempotencyCapability; try { capability = transport.capability(providerId); } catch { throw new ProviderHostInvariantError("Provider idempotency capability is unavailable."); }
  if (capability === null || typeof capability !== "object" || capability.contractId !== "k-nex.reference-provider.v1" || capability.version !== 1 || capability.providerId !== providerId ||
    capability.idempotency !== "durable-key-scoped-exactly-once" || capability.idempotencyKeyFormat !== "sha256-canonical-json-v1" ||
    capability.reconciliation !== "receipt-lookup-by-idempotency-key" || capability.durability !== "survives-provider-restart") throw new ProviderHostInvariantError("Provider idempotency capability is not admitted.");
}
function configureInput(value: Readonly<Record<string, unknown>>): value is Readonly<{ providerId: ProviderId; expectedRevision: number; operation: "activate" | "revoke" }> { return exactObject(value, ["expectedRevision", "operation", "providerId"]) && (value.providerId === "email.reference.v1" || value.providerId === "calendar.reference.v1") && Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0 && (value.operation === "activate" || value.operation === "revoke"); }
const secretSlotFor = (providerId: ProviderId) => providerId === "email.reference.v1" ? "email-reference" : "calendar-reference";
const secretReferenceFor = (providerId: ProviderId) => "secret-ref:v1:" + secretSlotFor(providerId) + ":provider-api:default";
const webhookSecretReferenceFor = (providerId: ProviderId) => "secret-ref:v1:" + secretSlotFor(providerId) + ":webhook-signature:default";
function currentFence(value: SalesCommunicationWorkerFence): boolean { return typeof value.applicationId === "string" && value.applicationId.length > 0 && typeof value.environment === "string" && value.environment.length > 0 && typeof value.activeExecutionGeneration === "string" && /^[a-z][a-z0-9-]{2,127}$/u.test(value.activeExecutionGeneration) && Number.isSafeInteger(value.fencingToken) && value.fencingToken > 0 && typeof value.leaseOwner === "string" && value.leaseOwner.length > 0 && Number.isSafeInteger(value.promotionRevision) && value.promotionRevision >= 0; }

export class GeneratedSalesCommunicationStore {
  constructor(private readonly request: PayloadRequest, private readonly authority: GeneratedSalesDurableAuthority) {}
  private allowed(permission: string) { if (!this.authority.permissionGrants?.includes(permission)) actionError("ACTION_FORBIDDEN", 403, "Sales provider permission is unavailable."); }
  async dispatch(intent: GeneratedSalesProviderIntent): Promise<GeneratedSalesProviderResult> {
    if (!validIntent(intent)) actionError("PROVIDER_INTENT_INVALID", 400, "Sales provider request is invalid.");
    this.allowed(requiredPermission(intent.actionId));
    const transaction = await activePayloadPostgresTransaction(this.request);
    const resolvedProviderId = providerFor(intent.actionId, intent.payload); if (resolvedProviderId === undefined) return actionError("PROVIDER_INTENT_INVALID", 400, "Sales provider request is invalid."); let providerId: ProviderId = resolvedProviderId; const idempotencyDigest = sha256(canonicalJson({ applicationId: this.authority.context.applicationId, environment: this.authority.context.environment, actorId: this.authority.context.actorId, actionId: intent.actionId, key: intent.idempotencyKey }));
    if (intent.actionId === "sales.integration.configure") {
      const configurationInput = intent.payload as Readonly<{ providerId: ProviderId; expectedRevision: number; operation: "activate" | "revoke" }>; if (!configureInput(configurationInput)) actionError("PROVIDER_INTENT_INVALID", 400, "Sales provider configuration is invalid.");
      const existing = rows(await transaction.execute(sql`SELECT revision,state FROM sales_provider_configurations WHERE application_id=${this.authority.context.applicationId} AND environment=${this.authority.context.environment} AND provider_id=${providerId} FOR UPDATE`))[0];
      const fromState = existing === undefined ? "absent" : existing.state === "active" || existing.state === "revoked" ? existing.state : undefined;
      if (fromState === undefined || (existing === undefined ? 0 : safeInteger(existing.revision)) !== configurationInput.expectedRevision) actionError("STALE_RECORD", 409, "Sales provider configuration is stale.");
      const nextState = configurationInput.operation === "activate" ? "active" : "revoked"; const nextRevision = configurationInput.expectedRevision + 1; const occurredAt = new Date().toISOString(); const resourceId = providerId; const audit = JSON.stringify({ actionId: "sales.integration.configure", resourceId, applicationId: this.authority.context.applicationId, environment: this.authority.context.environment, providerId, fromState, toState: nextState, occurredAt, actorId: this.authority.context.actorId, revision: nextRevision, idempotencyKey: idempotencyDigest }); const eventId = "sales-provider-config-" + sha256(canonicalJson({ applicationId: this.authority.context.applicationId, environment: this.authority.context.environment, providerId, revision: nextRevision })).slice(7); const resultProviderId = providerId;
      const changed = existing === undefined ? rows(await transaction.execute(sql`WITH changed AS (INSERT INTO sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,revision,state,configured_by,audit,created_at,updated_at,revoked_at) VALUES(${this.authority.context.applicationId},${this.authority.context.environment},${resultProviderId},${secretReferenceFor(resultProviderId)},${webhookSecretReferenceFor(resultProviderId)},1,${nextState},${this.authority.context.actorId},jsonb_build_array(${audit}::jsonb),${occurredAt}::timestamptz,${occurredAt}::timestamptz,${nextState === "active" ? null : occurredAt}) RETURNING revision,state,updated_at,revoked_at), outbox AS (INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) SELECT ${eventId},'sales.event.provider-configuration-changed',1,'durable-integration',${occurredAt}::timestamptz,${this.authority.context.applicationId},'module.sales',${this.authority.context.actorId},'user',${resultProviderId},${resultProviderId},${idempotencyDigest},jsonb_build_object('providerId',${resultProviderId}::text,'state',changed.state,'revision',changed.revision,'updatedAt',changed.updated_at,'revokedAt',changed.revoked_at),'pending',${occurredAt}::timestamptz+interval '30 days' FROM changed ON CONFLICT(event_id) DO NOTHING RETURNING event_id) SELECT revision FROM changed WHERE EXISTS(SELECT 1 FROM outbox)`)) : rows(await transaction.execute(sql`WITH changed AS (UPDATE sales_provider_configurations SET revision=revision+1,state=${nextState},configured_by=${this.authority.context.actorId},audit=coalesce(audit,'[]'::jsonb)||jsonb_build_array(${audit}::jsonb),updated_at=${occurredAt}::timestamptz,revoked_at=${nextState === "active" ? null : occurredAt} WHERE application_id=${this.authority.context.applicationId} AND environment=${this.authority.context.environment} AND provider_id=${resultProviderId} AND revision=${intent.payload.expectedRevision} RETURNING revision,state,updated_at,revoked_at), outbox AS (INSERT INTO k_nex_outbox(event_id,event_type,schema_version, message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) SELECT ${eventId},'sales.event.provider-configuration-changed',1,'durable-integration',${occurredAt}::timestamptz,${this.authority.context.applicationId},'module.sales',${this.authority.context.actorId},'user',${resultProviderId},${resultProviderId},${idempotencyDigest},jsonb_build_object('providerId',${resultProviderId}::text,'state',changed.state,'revision',changed.revision,'updatedAt',changed.updated_at,'revokedAt',changed.revoked_at),'pending',${occurredAt}::timestamptz+interval '30 days' FROM changed ON CONFLICT(event_id) DO NOTHING RETURNING event_id) SELECT revision FROM changed WHERE EXISTS(SELECT 1 FROM outbox)`));
      if (changed.length !== 1) actionError("STALE_RECORD", 409, "Sales provider configuration is stale.");
      await transaction.execute(sql`INSERT INTO sales_provider_configuration_audit(application_id,environment,provider_id,revision,audit_data,occurred_at) VALUES(${this.authority.context.applicationId},${this.authority.context.environment},${resultProviderId},${nextRevision},${audit}::jsonb,${occurredAt}::timestamptz)`);
      return Object.freeze({ operationId: "configuration-" + resultProviderId.replaceAll(".", "-"), state: "accepted", providerId: resultProviderId, receipt: Object.freeze({ idempotencyDigest, relatedRecord: null }) });
    }
    const configuration = rows(await transaction.execute(sql`SELECT secret_reference,revision,state FROM sales_provider_configurations WHERE application_id=${this.authority.context.applicationId} AND environment=${this.authority.context.environment} AND provider_id=${providerId} FOR SHARE`))[0];
    if (configuration === undefined || configuration.state !== "active" || typeof configuration.secret_reference !== "string") return actionError("PROVIDER_UNAVAILABLE", 503, "Sales provider is unavailable.");
    const existing = rows(await transaction.execute(sql`SELECT operation_id,state,provider_id FROM sales_provider_operations WHERE application_id=${this.authority.context.applicationId} AND environment=${this.authority.context.environment} AND idempotency_digest=${idempotencyDigest} FOR SHARE`))[0];
    if (existing !== undefined) return Object.freeze({ operationId: String(existing.operation_id), state: existing.state === "accepted" ? "accepted" : "queued", providerId: existing.provider_id as ProviderId, receipt: Object.freeze({ idempotencyDigest, relatedRecord: intent.relatedRecord }) });
    const operationId = "provider-" + crypto.randomUUID();
    await transaction.execute(sql`INSERT INTO sales_provider_operations(operation_id,application_id,environment,provider_id,action_id,actor_id,related_record_type,related_record_id,idempotency_digest,payload_json,configuration_revision,authorization_revision,lifecycle_revision,scope_revision,state,attempt,next_attempt_at,created_at,updated_at)
      VALUES(${operationId},${this.authority.context.applicationId},${this.authority.context.environment},${providerId},${intent.actionId},${this.authority.context.actorId},${intent.relatedRecord?.type ?? null},${intent.relatedRecord?.id ?? null},${idempotencyDigest},${JSON.stringify(intent.payload)}::jsonb,${safeInteger(configuration.revision) ?? 1},${this.authority.authorizationRevision},${this.authority.lifecycleRevision},${this.authority.scopeRevision},'queued',0,now(),now(),now())`);
    return Object.freeze({ operationId, state: "queued", providerId, receipt: Object.freeze({ idempotencyDigest, relatedRecord: intent.relatedRecord }) });
  }
}

export function createGeneratedSalesProviderGateway(request: PayloadRequest, authority: GeneratedSalesDurableAuthority): GeneratedSalesProviderGateway { const store = new GeneratedSalesCommunicationStore(request, authority); return Object.freeze({ dispatch: (intent) => store.dispatch(intent) }); }
export function createGeneratedSalesProviderConfigurationReadGateway(request: PayloadRequest, authority: GeneratedSalesDurableAuthority): GeneratedSalesProviderConfigurationReadGateway { return Object.freeze({ read: async (input) => { if (!authority.permissionGrants?.includes("sales.settings.read") || input.applicationId !== authority.context.applicationId || input.environment !== authority.context.environment || input.actorId !== authority.context.actorId) throw new ProviderHostInvariantError("Provider configuration scope is invalid."); const transaction = await activePayloadPostgresTransaction(request); const result = rows(await transaction.execute(sql`SELECT provider_id,state,revision,updated_at,revoked_at FROM sales_provider_configurations WHERE application_id=${input.applicationId} AND environment=${input.environment} ORDER BY provider_id ASC`)); if (result.length > 2) throw new ProviderHostInvariantError("Provider configuration result is invalid."); return Object.freeze(result.map((row) => { const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at; const revokedAt = row.revoked_at instanceof Date ? row.revoked_at.toISOString() : row.revoked_at; if ((row.provider_id !== "email.reference.v1" && row.provider_id !== "calendar.reference.v1") || (row.state !== "active" && row.state !== "revoked") || !Number.isSafeInteger(row.revision) || typeof updatedAt !== "string" || (revokedAt !== null && typeof revokedAt !== "string")) throw new ProviderHostInvariantError("Provider configuration result is invalid."); return Object.freeze({ providerId: row.provider_id as ProviderId, state: row.state as "active" | "revoked", revision: row.revision as number, updatedAt, revokedAt }); })); } }); }
/**
 * Trusted deployment maps four fixed opaque references to host-only environment
 * secrets.  Outbound credentials and inbound signing keys are separate slots
 * that rotate independently, and a reference minted for one purpose never
 * resolves under the other, so a leaked API credential cannot forge a webhook.
 */
export function createGeneratedEnvironmentProviderSecretResolver(environment: NodeJS.ProcessEnv = process.env): GeneratedSalesProviderSecretResolver {
  return Object.freeze({ resolve: async (reference, purpose) => {
    const parsed = typeof reference === "string" ? secretReferencePattern.exec(reference) : null;
    if (parsed === null || parsed[2] !== purpose) throw new Error("Provider secret reference is unavailable.");
    const value = purpose === "provider-api"
      ? parsed[1] === "email-reference" ? environment.K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE : environment.K_NEX_PROVIDER_SECRET_CALENDAR_REFERENCE
      : parsed[1] === "email-reference" ? environment.K_NEX_WEBHOOK_SECRET_EMAIL_REFERENCE : environment.K_NEX_WEBHOOK_SECRET_CALENDAR_REFERENCE;
    if (typeof value !== "string" || value.length < 1 || value.length > 16_384) throw new Error("Provider secret reference is unavailable.");
    return Object.freeze({ value });
  } });
}

/** Static host config supplies only loopback reference transport. App/browser input never controls origin. */
export function createGeneratedBoundedReferenceProviderTransport(endpoint: string | undefined): GeneratedSalesProviderTransport {
  const boundedOrigin = (): URL => { let origin: URL; try { origin = new URL(endpoint ?? ""); } catch { throw new ProviderHostInvariantError("Provider transport is not configured."); } if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/k-nex/reference-provider") throw new ProviderHostInvariantError("Provider transport is not configured."); return origin; };
  const boundedCredential = (providerId: ProviderId, credential: string, idempotencyKey: string): void => { if ((providerId !== "email.reference.v1" && providerId !== "calendar.reference.v1") || !/^sha256:[0-9a-f]{64}$/u.test(idempotencyKey) || typeof credential !== "string" || credential.length < 1) throw new ProviderHostInvariantError("Provider transport input is invalid."); };
  return Object.freeze({
    capability: (providerId) => { if (providerId !== "email.reference.v1" && providerId !== "calendar.reference.v1") throw new ProviderHostInvariantError("Provider transport input is invalid."); return Object.freeze({ contractId: "k-nex.reference-provider.v1", version: 1, providerId, idempotency: "durable-key-scoped-exactly-once", idempotencyKeyFormat: "sha256-canonical-json-v1", reconciliation: "receipt-lookup-by-idempotency-key", durability: "survives-provider-restart" }); },
    invoke: async (input) => {
      const origin = boundedOrigin(); boundedCredential(input.providerId, input.credential, input.idempotencyKey);
      const validPayload = input.providerId === "email.reference.v1" ? exactObject(input.payload, ["activityId", "body", "expectedRevision", "recipient", "subject"]) && typeof input.payload.recipient === "string" && input.payload.recipient.length >= 3 && providerPayload("sales.email.send", Object.freeze({ activityId: input.payload.activityId, body: input.payload.body, expectedRevision: input.payload.expectedRevision, subject: input.payload.subject })) : providerPayload("sales.calendar.sync", input.payload);
      if (!validPayload) throw new ProviderHostInvariantError("Provider transport input is invalid.");
      const response = await fetch(origin, { method: "POST", redirect: "error", headers: { authorization: "Bearer " + input.credential, "content-type": "application/json", "idempotency-key": input.idempotencyKey, "x-k-nex-provider": input.providerId }, body: canonicalJson(input.payload), signal: AbortSignal.timeout(10_000) });
      if (response.status === 409) throw new ProviderDuplicateKeyError();
      if (!response.ok) throw new Error("Provider transport failed.");
      return admittedProviderReceipt(await boundedJson(response), input.idempotencyKey);
    },
    // Reconciliation is a lookup, never a resend; a provider that cannot answer
    // it leaves the effect unresolved rather than duplicating a sent message.
    reconcile: async (input) => {
      const origin = boundedOrigin(); boundedCredential(input.providerId, input.credential, input.idempotencyKey);
      const response = await fetch(origin, { method: "POST", redirect: "error", headers: { authorization: "Bearer " + input.credential, "content-type": "application/json", "idempotency-key": input.idempotencyKey, "x-k-nex-provider": input.providerId, "x-k-nex-reconcile": "1" }, body: "{}", signal: AbortSignal.timeout(10_000) });
      if (response.status === 404) return null;
      if (response.status === 409) throw new ProviderDuplicateKeyError();
      if (!response.ok) throw new Error("Provider transport failed.");
      return admittedProviderReceipt(await boundedJson(response), input.idempotencyKey);
    }
  });
}

const providerWebhookRequestByteLimit = 65_536;
const providerReceiptByteLimit = 4_096;
const boundedBodyIdleTimeoutMs = 1_000;
type BoundedBodySource = Readonly<{ headers: Headers; body?: ReadableStream<Uint8Array> | null }>;
type BoundedBodyRefusal = "declared-length" | "missing-body" | "too-large" | "timed-out";
class BoundedBodyError extends Error {
  readonly refusal: BoundedBodyRefusal;
  constructor(refusal: BoundedBodyRefusal) { super("Body was refused: " + refusal); this.name = "BoundedBodyError"; this.refusal = refusal; }
}

/** Resolves the read or the bound, whichever comes first, and never twice. */
async function boundedChunk(reader: ReadableStreamDefaultReader<Uint8Array>, idleTimeoutMs: number, deadline: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new BoundedBodyError("timed-out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => { if (settled) return; settled = true; callback(); };
      timer = setTimeout(() => finish(() => reject(new BoundedBodyError("timed-out"))), Math.min(idleTimeoutMs, remaining));
      void reader.read().then((value) => finish(() => resolve(value)), (error: unknown) => finish(() => reject(error)));
    });
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/**
 * The generated application reads every body through readBoundedRequestBody in
 * k-nex-authority.ts.  This customer application carries no authority module,
 * so the same reader lives here and both boundaries share it: an inbound
 * webhook and an outbound provider receipt are equally bytes from a process
 * this host does not run, and neither is allocated whole before its size is
 * known.  A byte cap alone is not enough, because a body that trickles, a body
 * that never ends, and an oversize body all cost the sender nothing.
 */
async function readBoundedBody(source: BoundedBodySource, limits: Readonly<{ maxBytes: number; deadlineMs: number; overLimit?: "drain" | "cancel" }>): Promise<Uint8Array> {
  const declared = source.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > limits.maxBytes)) throw new BoundedBodyError("declared-length");
  const body = source.body;
  if (body === null || body === undefined) throw new BoundedBodyError("missing-body");
  const deadline = performance.now() + limits.deadlineMs;
  const reader = body.getReader();
  let cancelled = false;
  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    try { void reader.cancel().catch(() => undefined); } catch { /* a stream that refuses cancellation is already gone */ }
  };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let oversize = false;
  try {
    while (true) {
      const next = await boundedChunk(reader, boundedBodyIdleTimeoutMs, deadline);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limits.maxBytes) {
        if (!oversize) { oversize = true; chunks.length = 0; }
        // Nothing is owed to the far end of a response, and the answer is
        // already known, so the stream is reset on the crossing chunk rather
        // than given the rest of the deadline to keep this worker reading.
        if (limits.overLimit === "cancel") throw new BoundedBodyError("too-large");
        // An inbound oversize body is drained rather than reset, because
        // cancelling that stream makes some HTTP runtimes destroy the
        // connection before the refusal is written. The drain answers to the
        // same idle timeout and deadline as the read it replaces.
        continue;
      }
      chunks.push(next.value);
    }
  } catch (error) {
    cancel();
    throw oversize ? new BoundedBodyError("too-large") : error;
  } finally { reader.releaseLock(); }
  if (oversize) throw new BoundedBodyError("too-large");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function boundedJson(response: Response): Promise<unknown> {
  let bytes: Uint8Array;
  // An oversize, over-declared, or absent body breaks the receipt contract and
  // is terminal.  A stalled one says nothing about the effect, so it stays an
  // outage the operation reconciles by receipt lookup instead of resending.
  try { bytes = await readBoundedBody(response, { maxBytes: providerReceiptByteLimit, deadlineMs: 5_000, overLimit: "cancel" }); }
  catch (error) { if (error instanceof BoundedBodyError && error.refusal !== "timed-out") throw new ProviderHostInvariantError("Provider receipt is invalid."); throw new Error("Provider transport failed."); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ProviderHostInvariantError("Provider receipt is invalid."); }
}

async function providerCredential(secretReference: string, resolver: GeneratedSalesProviderSecretResolver): Promise<string> {
  if (!validSecretReference(secretReference, "provider-api")) throw new ProviderHostInvariantError("Provider secret reference is unavailable.");
  let resolved: Readonly<{ value: string }>; try { resolved = await resolver.resolve(secretReference, "provider-api"); } catch { throw new ProviderHostInvariantError("Provider secret reference is unavailable."); }
  if (typeof resolved.value !== "string" || resolved.value.length < 1 || resolved.value.length > 16_384) throw new ProviderHostInvariantError("Provider secret reference is unavailable.");
  return resolved.value;
}

export async function processGeneratedSalesCommunications(pool: ProviderPool, fence: SalesCommunicationWorkerFence, resolver: GeneratedSalesProviderSecretResolver, transport: GeneratedSalesProviderTransport): Promise<number> {
  if (!currentFence(fence)) return 0;
  const live = await pool.query("select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now()", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
  if (live.rows.length !== 1) return 0;
  // Four fixed 10s adapter calls cap this lane below the 60s reminder SLA.
  const claimed = await checkedTransaction(pool, async (client) => {
    const liveFence = await client.query("select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now() for update", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
    if (liveFence.rows.length !== 1) return { rows: [] };
    return client.query("with live as (select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now()), candidate as (select o.operation_id from sales_provider_operations o where o.application_id=$1 and o.environment=$2 and (o.state='queued' and o.next_attempt_at<=now() or o.state='running' and not exists(select 1 from runtime_worker_generation_fences prior where prior.application_id=o.application_id and prior.environment=o.environment and prior.active_execution_generation=o.worker_generation_id and prior.fencing_token=o.worker_fencing_token and prior.promotion_revision=o.worker_promotion_revision and prior.lease_owner=o.worker_lease_owner and prior.lease_expires_at>now())) and exists(select 1 from live) order by o.created_at for update skip locked limit 4) update sales_provider_operations o set state='running',worker_generation_id=$3,worker_fencing_token=$4,worker_promotion_revision=$5,worker_lease_owner=$6,updated_at=now() from candidate where o.operation_id=candidate.operation_id returning o.*", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
  });
  for (const operation of claimed.rows) {
    let failureCode = "HOST_INVARIANT";
    try {
      const providerId = operation.provider_id as ProviderId;
      const idempotencyKey = operation.idempotency_digest as string;
      // A provider that does not declare durable exactly-once plus receipt
      // lookup never reaches the dispatch marker, let alone the network.
      admittedProviderCapability(transport, providerId);
      // Claim, provider call, and terminal commit are separate transactions.
      // The promotion fence and every record lock are released before the
      // bounded 10s network call, and the fence is proved again only where a
      // local domain transition is actually written.
      const prepared = await checkedTransaction(pool, async (client) => {
        const running = await client.query("select payload_json,effect_dispatched_at,provider_receipt_id from sales_provider_operations where application_id=$1 and environment=$2 and operation_id=$3 and state='running' and worker_generation_id=$4 and worker_fencing_token=$5 and worker_promotion_revision=$6 and worker_lease_owner=$7 for update", [fence.applicationId, fence.environment, operation.operation_id, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
        const liveFence = await client.query("select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now() for share", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
        const authorization = await client.query("select 1 from k_nex_authorization_state where application_id=$1 and authorization_revision=$2 and lifecycle_revision=$3 for share", [fence.applicationId, operation.authorization_revision, operation.lifecycle_revision]);
        const scope = await client.query("select 1 from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 and state='active' and revision=$4 for share", [fence.applicationId, fence.environment, operation.actor_id, operation.scope_revision]);
        const config = await client.query("select secret_reference from sales_provider_configurations where application_id=$1 and environment=$2 and provider_id=$3 and state='active' and revision=$4 for share", [fence.applicationId, fence.environment, operation.provider_id, operation.configuration_revision]);
        const configuration = config.rows[0];
        if (running.rows.length !== 1 || liveFence.rows.length !== 1 || authorization.rows.length !== 1 || scope.rows.length !== 1 || typeof configuration?.secret_reference !== "string") { failureCode = "PROVIDER_REVOKED"; throw new Error("Provider authority is stale."); }
        const claim = running.rows[0]!;
        const payload = claim.payload_json as Record<string, unknown>;
        const activityId = safeInteger(payload.activityId); const expectedRevision = safeInteger(payload.expectedRevision);
        if (activityId === undefined || activityId <= 0 || expectedRevision === undefined || expectedRevision <= 0 || operation.related_record_id === null || operation.related_record_type === null) throw new Error("Provider activity binding is unavailable.");
        const activity = await client.query("select 1 from sales_activities a where a.id=$1 and a.application_id=$2 and a.environment=$3 and a.status='scheduled' and a.revision=$4 and a.related_record_type=$5 and a.related_record_id=$6 and exists(select 1 from sales_current_authority_scopes s where s.application_id=a.application_id and s.environment=a.environment and s.principal_id=$7 and s.state='active' and s.revision=$8 and (s.record_scope='application-sales-scope' or (s.record_scope='explicit-application-or-team-scope' and s.application_wide) or a.owner_id=$7 or a.team_id in (select jsonb_array_elements_text(s.authorized_team_ids)))) for share of a", [activityId, fence.applicationId, fence.environment, expectedRevision, operation.related_record_type, String(operation.related_record_id), operation.actor_id, operation.scope_revision]);
        if (activity.rows.length !== 1) throw new Error("Provider activity binding is unavailable.");
        let outboundPayload: Readonly<Record<string, unknown>> = payload;
        if (operation.provider_id === "email.reference.v1") {
          const recipientTable = operation.related_record_type === "sales.contact" ? "sales_contacts" : operation.related_record_type === "sales.lead" ? "sales_leads" : undefined;
          if (recipientTable === undefined) throw new Error("Provider recipient binding is unavailable.");
          const recipient = await client.query("select r.email from " + recipientTable + " r where r.id=$1 and r.application_id=$2 and r.environment=$3 and exists(select 1 from sales_current_authority_scopes s where s.application_id=r.application_id and s.environment=r.environment and s.principal_id=$4 and s.state='active' and s.revision=$5 and (s.record_scope='application-sales-scope' or (s.record_scope='explicit-application-or-team-scope' and s.application_wide) or r.owner_id=$4 or r.team_id in (select jsonb_array_elements_text(s.authorized_team_ids)))) for share of r", [operation.related_record_id, fence.applicationId, fence.environment, operation.actor_id, operation.scope_revision]);
          if (recipient.rows.length !== 1 || typeof recipient.rows[0]?.email !== "string" || recipient.rows[0].email.length < 3) throw new Error("Provider recipient binding is unavailable.");
          outboundPayload = { ...payload, recipient: recipient.rows[0].email };
        }
        // The dispatch marker commits before the network call, so a worker that
        // dies mid-flight reconciles by receipt lookup instead of resending.
        const dispatched = await client.query("update sales_provider_operations set effect_claim_id=coalesce(effect_claim_id,$1),effect_dispatched_at=coalesce(effect_dispatched_at,now()),updated_at=now() where application_id=$2 and environment=$3 and operation_id=$4 and state='running' and worker_generation_id=$5 and worker_fencing_token=$6 and worker_promotion_revision=$7 and worker_lease_owner=$8 returning effect_claim_id", [crypto.randomUUID(), fence.applicationId, fence.environment, operation.operation_id, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
        if (dispatched.rows.length !== 1) throw new Error("Provider effect claim could not be committed.");
        const priorReceiptId = claim.provider_receipt_id;
        return { secretReference: configuration.secret_reference as string, outboundPayload, activityId, expectedRevision, priorDispatch: claim.effect_dispatched_at !== null, priorReceiptId: typeof priorReceiptId === "string" ? priorReceiptId : null };
      });
      let receipt: GeneratedSalesProviderEffectReceipt;
      try {
        const credential = await providerCredential(prepared.secretReference, resolver);
        if (prepared.priorReceiptId !== null) receipt = Object.freeze({ providerReceiptId: prepared.priorReceiptId, idempotencyKey, duplicate: true });
        else {
          const reconciled = prepared.priorDispatch ? await transport.reconcile(Object.freeze({ providerId, credential, idempotencyKey })) : null;
          receipt = reconciled ?? await transport.invoke(Object.freeze({ providerId, credential, idempotencyKey, payload: prepared.outboundPayload }));
        }
      } catch (error) { if (error instanceof ProviderHostInvariantError) throw error; if (error instanceof ProviderDuplicateKeyError) { failureCode = "PROVIDER_DUPLICATE_KEY"; throw error; } failureCode = "PROVIDER_OUTAGE"; throw new Error("Provider reference adapter failed."); }
      // The receipt records an external fact that already happened, so it is
      // persisted monotonically and without a fence predicate. Only the local
      // domain transition below is fenced.
      await checkedTransaction(pool, async (client) => {
        const stored = await client.query("update sales_provider_operations set provider_receipt_id=coalesce(provider_receipt_id,$1),provider_receipt_at=coalesce(provider_receipt_at,now()),updated_at=now() where application_id=$2 and environment=$3 and operation_id=$4 and state='running' returning provider_receipt_id", [receipt.providerReceiptId, fence.applicationId, fence.environment, operation.operation_id]);
        if (stored.rows.length !== 1) throw new Error("Provider receipt could not be committed.");
      });
      await checkedTransaction(pool, async (client) => {
        const running = await client.query("select 1 from sales_provider_operations where application_id=$1 and environment=$2 and operation_id=$3 and state='running' and worker_generation_id=$4 and worker_fencing_token=$5 and worker_promotion_revision=$6 and worker_lease_owner=$7 for update", [fence.applicationId, fence.environment, operation.operation_id, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
        const terminalFence = await client.query("select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now() for update", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
        if (running.rows.length !== 1 || terminalFence.rows.length !== 1) { failureCode = "STALE_WORKER"; throw new ProviderStaleWorker(); }
        const receiptDigest = sha256(canonicalJson({ operationId: operation.operation_id, providerId: operation.provider_id, actionId: operation.action_id, idempotencyDigest: operation.idempotency_digest, providerReceiptId: receipt.providerReceiptId }));
        const accepted = await client.query("with completed as (update sales_activities a set status='completed',occurred_at=now(),provider_metadata=jsonb_build_object('providerId',$1::text,'operationId',$2::text,'receiptDigest',$3::text,'providerReceiptId',$15::text),audit=coalesce(a.audit,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('actionId','sales.activity.complete','resourceId',a.id::text,'applicationId',a.application_id,'environment',a.environment,'fromState','scheduled','toState','completed','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',$4::text,'revision',a.revision+1,'idempotencyKey','sales-provider-activity-complete-'||$2::text)),revision=a.revision+1,updated_by=$4,updated_at=now() where a.id=$5 and a.application_id=$6 and a.environment=$7 and a.status='scheduled' and a.revision=$8 and a.related_record_type=$9 and a.related_record_id=$10 returning a.id), receipt as (insert into sales_provider_activity_receipts(operation_id,activity_id,receipt_digest,provider_receipt_id) select $2,completed.id,$3,$15 from completed on conflict(operation_id) do nothing returning operation_id), accepted as (update sales_provider_operations set state='accepted',receipt_digest=$3,accepted_at=now(),worker_generation_id=null,worker_fencing_token=null,worker_promotion_revision=null,worker_lease_owner=null,updated_at=now() where application_id=$6 and environment=$7 and operation_id=$2 and state='running' and worker_generation_id=$11 and worker_fencing_token=$12 and worker_promotion_revision=$13 and worker_lease_owner=$14 and exists(select 1 from receipt) returning operation_id), outbox as (insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) select 'sales-provider-activity-'||operation_id,'sales.event.timeline-changed',1,'durable-integration',now(),$6,'module.sales',$4,'user',operation_id,operation_id,operation_id,jsonb_build_object('actionId','sales.activity.complete','resourceId',$5::text,'applicationId',$6::text,'environment',$7::text,'state','completed','revision',$8+1),'pending',now()+interval '30 days' from accepted on conflict(event_id) do nothing returning event_id) select operation_id from accepted where exists(select 1 from outbox)", [operation.provider_id, operation.operation_id, receiptDigest, operation.actor_id, prepared.activityId, fence.applicationId, fence.environment, prepared.expectedRevision, operation.related_record_type, String(operation.related_record_id), fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner, receipt.providerReceiptId]);
        // The effect is already durable upstream, so a local completion that no
        // longer matches its record is a reconciliation duty, not a resend.
        if (accepted.rows.length !== 1) { failureCode = "PROVIDER_EFFECT_UNRECONCILED"; throw new Error("Provider completion could not be committed."); }
      });
    } catch (error) {
      if (error instanceof ProviderStaleWorker) continue;
      const retry = Number(operation.attempt) < 2 && failureCode === "PROVIDER_OUTAGE";
      try {
        await checkedTransaction(pool, async (client) => {
          const running = await client.query("select 1 from sales_provider_operations where application_id=$1 and environment=$2 and operation_id=$3 and state='running' and worker_generation_id=$4 and worker_fencing_token=$5 and worker_promotion_revision=$6 and worker_lease_owner=$7 for update", [fence.applicationId, fence.environment, operation.operation_id, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
          if (running.rows.length !== 1) return;
          const liveFence = await client.query("select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now() for update", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
          if (liveFence.rows.length !== 1) return;
          await client.query("update sales_provider_operations set state=$1,attempt=attempt+1,next_attempt_at=case when $1='queued' then now()+((attempt+1)*interval '15 seconds') else now() end,failure_code=$2,worker_generation_id=null,worker_fencing_token=null,worker_promotion_revision=null,worker_lease_owner=null,updated_at=now() where application_id=$3 and environment=$4 and operation_id=$5 and state='running' and worker_generation_id=$6 and worker_fencing_token=$7 and worker_promotion_revision=$8 and worker_lease_owner=$9", [retry ? "queued" : "dead-letter", failureCode, fence.applicationId, fence.environment, operation.operation_id, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
        });
      } catch { /* A stale or failed failure transition leaves the claim reclaimable. */ }
    }
  }
  return claimed.rows.length;
}

export async function acceptGeneratedSalesProviderWebhook(input: Readonly<{ pool: ProviderPool; resolver: GeneratedSalesProviderSecretResolver; providerId: ProviderId; applicationId: string; environment: string; signature: string | null; timestamp: string | null; body: Uint8Array }>): Promise<Readonly<{ accepted: true; replay: boolean }>> {
  if (input.body.byteLength > 65_536 || input.signature === null || input.timestamp === null || !/^[0-9]{13}$/u.test(input.timestamp) || Math.abs(Date.now() - Number(input.timestamp)) > 300_000) actionError("WEBHOOK_INVALID", 401, "Provider webhook is invalid.");
  const config = await input.pool.query("select webhook_secret_reference,state from sales_provider_configurations where application_id=$1 and environment=$2 and provider_id=$3", [input.applicationId, input.environment, input.providerId]);
  const configuration = config.rows[0];
  // Signature verification reads the webhook slot only. The outbound API slot is
  // a different reference with its own rotation and cannot satisfy this purpose.
  const reference = configuration?.webhook_secret_reference; if (configuration?.state !== "active" || !validSecretReference(reference, "webhook-signature")) return actionError("WEBHOOK_INVALID", 401, "Provider webhook is invalid.");
  const signature = input.signature; const timestamp = input.timestamp; if (signature === null || timestamp === null) return actionError("WEBHOOK_INVALID", 401, "Provider webhook is invalid.");
  let secret: Readonly<{ value: string }>; try { secret = await input.resolver.resolve(reference, "webhook-signature"); } catch { return actionError("WEBHOOK_INVALID", 401, "Provider webhook is invalid."); }
  const expected = "v1=" + createHmac("sha256", secret.value).update(timestamp).update(".").update(input.body).digest("hex");
  const provided = Buffer.from(signature, "utf8"); const wanted = Buffer.from(expected, "utf8");
  if (provided.byteLength !== wanted.byteLength || !timingSafeEqual(provided, wanted)) actionError("WEBHOOK_INVALID", 401, "Provider webhook is invalid.");
  let event: unknown; try { event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.body)); } catch { return actionError("WEBHOOK_INVALID", 400, "Provider webhook is invalid."); }
  const eventRecord = exactObject(event, ["applicationId", "environment", "eventId", "operationId", "recipientId", "kind", "metadata"]) ? event : undefined;
  const metadata = webhookMetadata(input.providerId, eventRecord?.metadata);
  if (eventRecord === undefined || eventRecord.applicationId !== input.applicationId || eventRecord.environment !== input.environment || typeof eventRecord.eventId !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/u.test(eventRecord.eventId) || typeof eventRecord.operationId !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/u.test(eventRecord.operationId) || typeof eventRecord.recipientId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/u.test(eventRecord.recipientId) || typeof eventRecord.kind !== "string" || (input.providerId === "email.reference.v1" ? eventRecord.kind !== "message-delivered" : eventRecord.kind !== "calendar-synced") || metadata === undefined) return actionError("WEBHOOK_INVALID", 400, "Provider webhook is invalid.");
  const boundOperation = await input.pool.query("select actor_id from sales_provider_operations where application_id=$1 and environment=$2 and provider_id=$3 and operation_id=$4 and state='accepted' for key share", [input.applicationId, input.environment, input.providerId, eventRecord.operationId]);
  const recipientId = boundOperation.rows[0]?.actor_id;
  if (boundOperation.rows.length !== 1 || typeof recipientId !== "string" || recipientId !== eventRecord.recipientId) return actionError("WEBHOOK_INVALID", 400, "Provider webhook is invalid.");
  const digest = sha256(input.body); const deliveredAt = new Date().toISOString(); const auditKey = "sales-notification-delivery-" + sha256(canonicalJson({ providerId: input.providerId, eventId: eventRecord.eventId, operationId: eventRecord.operationId })).slice(7); const outboxEventId = "sales-webhook-" + sha256(canonicalJson({ applicationId: input.applicationId, environment: input.environment, providerId: input.providerId, eventId: eventRecord.eventId })).slice(7);
  // Evidence and recipient-visible notification succeed or roll back together.
  try {
    await checkedTransaction(input.pool, async (client) => { const inserted = await client.query("with evidence as (insert into sales_provider_webhook_events(application_id,environment,provider_id,event_id,operation_id,payload_digest,recipient_id,event_kind,safe_metadata,received_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now()) on conflict(application_id,environment,provider_id,event_id) do nothing returning event_id), allocated as (select evidence.event_id,nextval(pg_get_serial_sequence('sales_notifications','id'))::bigint as id from evidence), notification as (insert into sales_notifications(id,application_id,environment,recipient_id,subject,reference_kind,reference_id,state,revision,metadata,audit,delivered_at,created_at,updated_at) select allocated.id,$1,$2,$7,$8,'provider-webhook',$4,'unread',1,$9::jsonb,jsonb_build_array(jsonb_build_object('actionId','sales.notification.deliver','resourceId',allocated.id::text,'applicationId',$1::text,'environment',$2::text,'fromState','absent','toState','unread','occurredAt',$10::text,'actorId',$7::text,'revision',1,'idempotencyKey',$11::text)),$10::timestamptz,$10::timestamptz,$10::timestamptz from allocated returning id), outbox as (insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) select $12,'sales.event.notification-changed',1,'durable-integration',now(),$1,'module.sales',$7,'user',$12,$12,$12,jsonb_build_object('actionId','sales.notification.deliver','resourceId',notification.id::text,'applicationId',$1::text,'environment',$2::text,'state','unread','revision',1),'pending',now()+interval '30 days' from notification on conflict(event_id) do nothing returning event_id) select id from notification where exists(select 1 from outbox)", [input.applicationId, input.environment, input.providerId, eventRecord.eventId, eventRecord.operationId, digest, recipientId, eventRecord.kind, JSON.stringify(metadata), deliveredAt, auditKey, outboxEventId]); if (inserted.rows.length !== 1) throw new ProviderReplayRace(); });
  } catch (error) {
    if (!(error instanceof ProviderReplayRace)) throw error;
    const prior = await input.pool.query("select payload_digest from sales_provider_webhook_events where application_id=$1 and environment=$2 and provider_id=$3 and event_id=$4", [input.applicationId, input.environment, input.providerId, eventRecord.eventId]);
    if (prior.rows.length !== 1 || prior.rows[0]?.payload_digest !== digest) return actionError("WEBHOOK_INVALID", 409, "Provider webhook is invalid.");
    return Object.freeze({ accepted: true, replay: true });
  }
  return Object.freeze({ accepted: true, replay: false });
}

export function generatedSalesProviderWebhookEndpoints(applicationId: string, environment: string, resolver: GeneratedSalesProviderSecretResolver): readonly Endpoint[] {
  const endpoint = (providerId: ProviderId, path: string): Endpoint => ({ method: "post", path, handler: async (request) => {
    try { const body = await readBoundedBody(request, { maxBytes: providerWebhookRequestByteLimit, deadlineMs: 30_000 }); const pool = request.payload.db.pool as unknown as ProviderPool; const result = await acceptGeneratedSalesProviderWebhook({ pool, resolver, providerId, applicationId, environment, signature: request.headers.get("x-k-nex-signature"), timestamp: request.headers.get("x-k-nex-timestamp"), body }); return Response.json(result, { status: 202, headers: { "cache-control": "no-store" } }); }
    catch (error) { const status = error instanceof ActionGatewayError ? error.status : 400; return Response.json({ code: "WEBHOOK_INVALID", status }, { status, headers: { "cache-control": "no-store" } }); }
  } });
  return Object.freeze([endpoint("email.reference.v1", "/k-nex/sales/providers/email-reference/webhook"), endpoint("calendar.reference.v1", "/k-nex/sales/providers/calendar-reference/webhook")]);
}

/** Reminder delivery is an accepted duty; it is fenced but not re-authorized as the original user. */
export async function processGeneratedSalesReminders(pool: ProviderPool, fence: SalesCommunicationWorkerFence): Promise<number> {
  if (!currentFence(fence)) return 0;
  const live = await pool.query("select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now()", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]); if (live.rows.length !== 1) return 0;
  const candidates = await pool.query("select r.id from sales_reminders r where r.application_id=$1 and r.environment=$2 and r.state='scheduled' and r.scheduled_at<=now() and jsonb_array_length(r.audit)=r.revision and exists(select 1 from runtime_worker_generation_fences f where f.application_id=$1 and f.environment=$2 and f.active_execution_generation=$3 and f.fencing_token=$4 and f.promotion_revision=$5 and f.lease_owner=$6 and f.lease_expires_at>now()) order by r.scheduled_at limit 32", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
  let completed = 0;
  for (const candidate of candidates.rows) {
    const reminderId = safeInteger(candidate.id); if (reminderId === undefined || reminderId <= 0) continue;
    try {
      const delivered = await checkedTransaction(pool, async (client) => { const liveFence = await client.query("select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now() for update", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]); if (liveFence.rows.length !== 1) throw new ProviderStaleWorker(); const result = await client.query("with live as (select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now()), candidate as (select id from sales_reminders where id=$7 and application_id=$1 and environment=$2 and state='scheduled' and scheduled_at<=now() and jsonb_array_length(audit)=revision and exists(select 1 from live) for update skip locked), delivered as (update sales_reminders r set state='delivered',delivered_at=now(),revision=revision+1,audit=r.audit||jsonb_build_array(jsonb_build_object('actionId','sales.job.reminder-delivery','resourceId',r.id::text,'applicationId',r.application_id,'environment',r.environment,'fromState','scheduled','toState','delivered','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',r.recipient_id,'revision',r.revision+1,'idempotencyKey','sales-job-reminder-delivery-'||r.id::text)),updated_at=now() from candidate where r.id=candidate.id returning r.id as reminder_id,r.application_id,r.environment,r.recipient_id,r.subject,r.reference_kind,r.reference_id), allocated as (select delivered.*,nextval(pg_get_serial_sequence('sales_notifications','id'))::bigint as id from delivered), notifications as (insert into sales_notifications(id,application_id,environment,recipient_id,subject,reference_kind,reference_id,state,revision,metadata,audit,delivered_at,created_at,updated_at) select allocated.id,application_id,environment,recipient_id,subject,reference_kind,reference_id,'unread',1,'{}'::jsonb,jsonb_build_array(jsonb_build_object('actionId','sales.notification.deliver','resourceId',allocated.id::text,'applicationId',application_id,'environment',environment,'fromState','absent','toState','unread','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',recipient_id,'revision',1,'idempotencyKey','sales-notification-delivery-'||allocated.id::text)),now(),now(),now() from allocated returning id), outbox as (insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) select 'sales-reminder-delivered-'||allocated.reminder_id::text,'sales.event.reminder-changed',1,'durable-integration',now(),allocated.application_id,'module.sales',allocated.recipient_id,'user',allocated.reminder_id::text,allocated.reminder_id::text,'sales-job-reminder-delivery-'||allocated.reminder_id::text,jsonb_build_object('actionId','sales.job.reminder-delivery','resourceId',allocated.reminder_id::text,'applicationId',allocated.application_id,'environment',allocated.environment,'state','delivered','revision',2),'pending',now()+interval '30 days' from allocated join notifications on true union all select 'sales-reminder-notification-'||notifications.id::text,'sales.event.notification-changed',1,'durable-integration',now(),allocated.application_id,'module.sales',allocated.recipient_id,'user',allocated.reminder_id::text,allocated.reminder_id::text,'sales-notification-delivery-'||notifications.id::text,jsonb_build_object('actionId','sales.notification.deliver','resourceId',notifications.id::text,'applicationId',allocated.application_id,'environment',allocated.environment,'state','unread','revision',1),'pending',now()+interval '30 days' from allocated join notifications on true on conflict(event_id) do nothing returning event_id) select id,(select count(*)::int from outbox) event_count from notifications", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner, reminderId]); if (result.rows.length !== 1 || Number(result.rows[0]?.event_count) !== 2) throw new Error("Reminder delivery could not be committed."); return result; });
      completed += delivered.rows.length;
    } catch {
      try {
        await checkedTransaction(pool, async (client) => {
          const liveFence = await client.query("select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and promotion_revision=$5 and lease_owner=$6 and lease_expires_at>now() for update", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
          if (liveFence.rows.length !== 1) throw new ProviderStaleWorker();
          const failed = await client.query("with updated as (update sales_reminders r set attempt=attempt+1,state=case when attempt+1>=3 then 'failed' else 'scheduled' end,failed_at=case when attempt+1>=3 then now() else null end,failure_reason=case when attempt+1>=3 then 'REMINDER_DELIVERY_FAILED' else failure_reason end,dead_letter_reference=case when attempt+1>=3 then 'sales-reminder-dead-letter-'||r.id::text else dead_letter_reference end,revision=case when attempt+1>=3 then revision+1 else revision end,audit=case when attempt+1>=3 then audit||jsonb_build_array(jsonb_build_object('actionId','sales.job.reminder-delivery','resourceId',r.id::text,'applicationId',r.application_id,'environment',r.environment,'fromState','scheduled','toState','failed','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',r.recipient_id,'revision',r.revision+1,'idempotencyKey','sales-job-reminder-delivery-failed-'||r.id::text)) else audit end,updated_at=now() where r.id=$3 and r.application_id=$1 and r.environment=$2 and r.state='scheduled' and jsonb_array_length(r.audit)=r.revision returning r.id,r.application_id,r.environment,r.recipient_id,r.state,r.revision), failure_outbox as (insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) select 'sales-reminder-failed-'||id::text,'sales.event.reminder-changed',1,'durable-integration',now(),application_id,'module.sales',recipient_id,'user',id::text,id::text,'sales-job-reminder-delivery-failed-'||id::text,jsonb_build_object('actionId','sales.job.reminder-delivery','resourceId',id::text,'applicationId',application_id,'environment',environment,'state','failed','revision',revision),'pending',now()+interval '30 days' from updated where state='failed' on conflict(event_id) do nothing returning event_id) select id,state,(select count(*)::int from failure_outbox) event_count from updated", [fence.applicationId, fence.environment, reminderId]);
          if (failed.rows.length !== 1) return;
          if (failed.rows[0]?.state === "failed" && Number(failed.rows[0]?.event_count) !== 1) throw new Error("Reminder failure event could not be committed.");
        });
      } catch { /* Stale workers and collision failures leave the reminder reclaimable. */ }
    }
  }
  return completed;
}
