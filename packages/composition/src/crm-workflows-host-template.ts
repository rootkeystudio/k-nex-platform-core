/** Generates P13.7's closed, persisted, fenced workflow executor. */
export function crmWorkflowsHostSource(): string {
  return `import { createHash } from "node:crypto";
import { canonicalJson } from "@k-nex/contracts";

type Row = Record<string, any>;
type Result = Readonly<{ rows: readonly Row[] }>;
type Sql = Readonly<{ query(text: string, values?: readonly unknown[]): Promise<Result> }>;
type Client = Sql & Readonly<{ release(): void }>;
type Pool = Sql & Readonly<{ connect(): Promise<Client> }>;
export type GeneratedSalesWorkflowFence = Readonly<{ applicationId: string; environment: string; activeExecutionGeneration: string; fencingToken: number; leaseOwner: string; promotionRevision: number }>;

const batchSize = 16;
const hardCallCap = 32;
const maxAttempts = 3;
const jobId = "sales.job.crm-workflow-execution";
const eventTypes = Object.freeze(["sales.event.workflow.opportunity-proposal-entered", "sales.event.workflow.lead-owner-assigned", "sales.event.workflow.activity-scheduled"]);
const definitions = Object.freeze({
  "sales.workflow.opportunity-proposal-follow-up": Object.freeze({ event: "sales.event.workflow.opportunity-proposal-entered", effectKind: "create-owner-follow-up-task", dbEffect: "task", target: "sales.object.opportunity" }),
  "sales.workflow.lead-owner-assigned-notification": Object.freeze({ event: "sales.event.workflow.lead-owner-assigned", effectKind: "notify-new-owner", dbEffect: "notification", target: "sales.object.lead" }),
  "sales.workflow.scheduled-activity-reminder": Object.freeze({ event: "sales.event.workflow.activity-scheduled", effectKind: "schedule-reminder", dbEffect: "reminder", target: "sales.object.activity" })
});
const workflowEvent = "sales.event.workflow-execution-changed";
const terminalCodes = Object.freeze(["WORKFLOW_AUTH_RECHECK_FAILED", "WORKFLOW_SCOPE_RECHECK_FAILED", "WORKFLOW_TARGET_MISSING"]);

function sha(value: unknown): string { return "sha256:" + createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function text(value: unknown, max = 160): string | undefined { return typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value) ? value : undefined; }
function integer(value: unknown): number | undefined { return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined; }
function iso(value: unknown): string | undefined { if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString(); if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined; const canonical = new Date(value).toISOString(); return canonical === value ? value : undefined; }
function exact(value: unknown, keys: readonly string[]): value is Row { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Row).sort().join("\\0") === [...keys].sort().join("\\0"); }
function rowId(value: unknown): string { const result = text(value, 128); if (result === undefined) throw new Error("WORKFLOW_EXECUTION_ID_INVALID"); return result; }
function resultRows(result: Result): readonly Row[] { return Array.isArray(result.rows) ? result.rows : []; }
function liveValues(fence: GeneratedSalesWorkflowFence): readonly unknown[] { return [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]; }
function validFence(fence: GeneratedSalesWorkflowFence): boolean { return text(fence.applicationId, 128) !== undefined && text(fence.environment, 64) !== undefined && text(fence.activeExecutionGeneration, 128) !== undefined && Number.isSafeInteger(fence.fencingToken) && fence.fencingToken > 0 && text(fence.leaseOwner, 160) !== undefined && Number.isSafeInteger(fence.promotionRevision) && fence.promotionRevision >= 0; }
async function transaction<T>(pool: Pool, work: (client: Client) => Promise<T>): Promise<T> { const client = await pool.connect(); try { await client.query("BEGIN"); const value = await work(client); await client.query("COMMIT"); return value; } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); } }
async function lockLive(client: Sql, fence: GeneratedSalesWorkflowFence): Promise<boolean> { const result = await client.query("SELECT 1 FROM runtime_worker_generation_fences WHERE application_id=$1 AND environment=$2 AND active_execution_generation=$3 AND fencing_token=$4 AND promotion_revision=$5 AND lease_owner=$6 AND lease_expires_at>now() FOR UPDATE", liveValues(fence)); return resultRows(result).length === 1; }

class WorkflowCollision extends Error { constructor() { super("WORKFLOW_IDEMPOTENCY_CONFLICT"); this.name = "WorkflowCollision"; } }
class WorkflowTransitionCollision extends WorkflowCollision { constructor() { super(); this.name = "WorkflowTransitionCollision"; } }
function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505"; }

type Trigger = Readonly<{ payload: Row; workflowId: keyof typeof definitions; effectKind: "task" | "notification" | "reminder"; targetId: string; actorId: string; recipientId: string; acceptedOwnerId: string; acceptedRevision: number; authorizationRevision: number; lifecycleRevision: number; scopeRevision: number; acceptedAt: string; scheduledAt?: string }>;
function parseTrigger(event: Row): Trigger | undefined {
  const payload = event.payload;
  const base = ["acceptedAt", "acceptedOwnerId", "acceptedRevision", "applicationId", "authRevision", "effectKind", "environment", "lifecycleRevision", "originalActorId", "recipientId", "scopeRevision", "targetId", "workflowId", "workflowVersion"];
  const withSchedule = [...base, "scheduledAt"];
  if (!exact(payload, withSchedule) && !exact(payload, base)) return undefined;
  const workflowId = text(payload.workflowId, 128) as keyof typeof definitions | undefined;
  const definition = workflowId === undefined ? undefined : definitions[workflowId];
  const eventId = text(event.event_id, 128);
  const app = text(event.application_id, 128);
  const payloadApp = text(payload.applicationId, 128);
  const environment = text(payload.environment, 64);
  const effect = definition !== undefined && payload.effectKind === definition.effectKind ? definition.dbEffect : undefined;
  const targetId = text(payload.targetId, 128);
  const actorId = text(payload.originalActorId);
  const recipientId = text(payload.recipientId);
  const acceptedOwnerId = text(payload.acceptedOwnerId);
  const acceptedAt = iso(payload.acceptedAt);
  const scheduledAt = payload.scheduledAt === undefined ? undefined : iso(payload.scheduledAt);
  const acceptedRevision = integer(payload.acceptedRevision);
  const authorizationRevision = integer(payload.authRevision);
  const lifecycleRevision = integer(payload.lifecycleRevision);
  const scopeRevision = integer(payload.scopeRevision);
  const sourceOccurredAt = iso(event.occurred_at);
  const sourceIdempotencyKey = event.idempotency_key === undefined || event.idempotency_key === null ? eventId : text(event.idempotency_key, 128);
  const validSource = eventId !== undefined && app !== undefined && sourceOccurredAt !== undefined && sourceIdempotencyKey !== undefined && event.schema_version === 1 && event.message_class === "durable-workflow" && event.plugin_id === "module.sales" && event.actor_type === "user" && text(event.actor_id, 160) === actorId;
  const validFacts = definition !== undefined && event.event_type === definition.event && payloadApp === app && environment !== undefined && payload.workflowVersion === 1 && effect === definition.dbEffect && targetId !== undefined && actorId !== undefined && recipientId !== undefined && acceptedOwnerId !== undefined && acceptedAt !== undefined && acceptedRevision !== undefined && acceptedRevision >= 1 && authorizationRevision !== undefined && authorizationRevision >= 1 && lifecycleRevision !== undefined && lifecycleRevision >= 0 && scopeRevision !== undefined && scopeRevision >= 1 && ((definition.dbEffect === "reminder") === (scheduledAt !== undefined)) && (definition.dbEffect === "reminder" ? recipientId === actorId : recipientId === acceptedOwnerId);
  if (!validSource || !validFacts) return undefined;
  return Object.freeze({ payload, workflowId: workflowId!, effectKind: effect!, targetId: targetId!, actorId: actorId!, recipientId: recipientId!, acceptedOwnerId: acceptedOwnerId!, acceptedRevision: acceptedRevision!, authorizationRevision: authorizationRevision!, lifecycleRevision: lifecycleRevision!, scopeRevision: scopeRevision!, acceptedAt: acceptedAt!, ...(scheduledAt === undefined ? {} : { scheduledAt }) });
}

function evidence(row: Row, fromState: string, toState: string, revision: number, occurredAt: string, idempotencyKey: string, failureCode: string | null, attempt: number): Row {
  return Object.freeze({ actionId: jobId, resourceId: String(row.id), applicationId: String(row.application_id), environment: String(row.environment), workflowId: String(row.workflow_id), effectKind: String(row.effect_kind), targetRecordId: String(row.target_record_id), sourceEventId: String(row.source_event_id), payloadDigest: String(row.payload_digest), effectKey: String(row.effect_key), fromState, toState, occurredAt, actorId: String(row.actor_id), revision, attempt, idempotencyKey, ...(failureCode === null ? {} : { failureCode }) });
}
function transitionCollisionEventId(row: Row, revision: number): string { return "sales-workflow-execution-conflict-" + sha({ executionId: String(row.id), revision, failureCode: "WORKFLOW_IDEMPOTENCY_CONFLICT" }).slice(7); }
async function insertWorkflowEvent(client: Sql, row: Row, state: string, revision: number, occurredAt: string, idempotencyKey: string, failureCode: string | null, eventIdOverride?: string): Promise<void> {
  const eventId = eventIdOverride ?? "sales-workflow-execution-" + sha({ executionId: String(row.id), revision }).slice(7);
  const payload = { actionId: jobId, resourceId: String(row.id), applicationId: String(row.application_id), environment: String(row.environment), workflowId: String(row.workflow_id), effectKind: String(row.effect_kind), sourceEventId: String(row.source_event_id), payloadDigest: String(row.payload_digest), effectKey: String(row.effect_key), state, revision, idempotencyKey, ...(failureCode === null ? {} : { failureCode }) };
  const retentionUntil = new Date(Date.parse(occurredAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const envelope = Object.freeze({ eventId, eventType: workflowEvent, schemaVersion: 1, messageClass: "durable-integration", occurredAt, applicationId: String(row.application_id), pluginId: "module.sales", actorId: String(row.actor_id), actorType: "system", correlationId: String(row.id), causationId: String(row.source_event_id), idempotencyKey: eventId, payload, retentionUntil });
  let inserted: Result;
  await client.query("SAVEPOINT crm_workflow_event_insert");
  try {
    inserted = await client.query("INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) VALUES($1,$2,$3,$4,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'pending',$14::timestamptz) RETURNING event_id", [envelope.eventId, envelope.eventType, envelope.schemaVersion, envelope.messageClass, envelope.occurredAt, envelope.applicationId, envelope.pluginId, envelope.actorId, envelope.actorType, envelope.correlationId, envelope.causationId, envelope.idempotencyKey, JSON.stringify(envelope.payload), envelope.retentionUntil]);
    await client.query("RELEASE SAVEPOINT crm_workflow_event_insert");
  }
  catch (error) {
    if (!isUniqueViolation(error)) { await client.query("ROLLBACK TO SAVEPOINT crm_workflow_event_insert"); await client.query("RELEASE SAVEPOINT crm_workflow_event_insert"); throw error; }
    await client.query("ROLLBACK TO SAVEPOINT crm_workflow_event_insert");
    try {
      const prior = resultRows(await client.query("SELECT event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,retention_until FROM k_nex_outbox WHERE event_id=$1 FOR SHARE", [envelope.eventId]))[0];
      const sameEnvelope = prior !== undefined && String(prior.event_id) === envelope.eventId && prior.event_type === envelope.eventType && Number(prior.schema_version) === envelope.schemaVersion && prior.message_class === envelope.messageClass && iso(prior.occurred_at) === envelope.occurredAt && prior.application_id === envelope.applicationId && prior.plugin_id === envelope.pluginId && prior.actor_id === envelope.actorId && prior.actor_type === envelope.actorType && prior.correlation_id === envelope.correlationId && prior.causation_id === envelope.causationId && prior.idempotency_key === envelope.idempotencyKey && sha(prior.payload) === sha(envelope.payload) && iso(prior.retention_until) === envelope.retentionUntil;
      if (!sameEnvelope) throw new WorkflowTransitionCollision();
      return;
    } finally { await client.query("RELEASE SAVEPOINT crm_workflow_event_insert"); }
  }
  if (resultRows(inserted).length !== 1) throw new WorkflowCollision();
}
async function appendTransition(client: Sql, row: Row, fromState: string, toState: string, options: Readonly<{ attempt: number; failureCode: string | null; nextAttemptSeconds: number | null; fence?: GeneratedSalesWorkflowFence; eventId?: string }>): Promise<Row> {
  const revision = Number(row.revision) + 1;
  const occurredAt = new Date().toISOString();
  const idempotencyKey = options.eventId ?? "sales-workflow-execution-" + String(row.id) + "-" + String(revision);
  const current = evidence(row, fromState, toState, revision, occurredAt, idempotencyKey, options.failureCode, options.attempt);
  const worker = toState === "running" && options.fence !== undefined;
  const values: unknown[] = [toState, revision, JSON.stringify(current), options.failureCode, options.attempt, row.id, fromState, row.revision];
  let sql = "UPDATE sales_workflow_executions SET state=$1::varchar,revision=$2,audit=audit||$3::jsonb,failure_code=$4::varchar,attempt=$5,updated_at=now(),terminal_at=CASE WHEN $1::varchar IN ('succeeded','dead-letter') THEN now() ELSE NULL END";
  if (worker) { sql += ",worker_generation_id=$9,worker_fencing_token=$10,worker_promotion_revision=$11,worker_lease_owner=$12,lease_revision=lease_revision+1,lease_expires_at=now()+interval '30 seconds',next_attempt_at=now()"; values.push(options.fence!.activeExecutionGeneration, options.fence!.fencingToken, options.fence!.promotionRevision, options.fence!.leaseOwner); }
  else { sql += ",worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL"; if (options.nextAttemptSeconds === null) sql += ",next_attempt_at=now()"; else { sql += ",next_attempt_at=now()+($9::integer*interval '1 second')"; values.push(options.nextAttemptSeconds); } }
  sql += " WHERE id=$6 AND state=$7::varchar AND revision=$8 AND jsonb_array_length(audit)=revision RETURNING *";
  const updated = await client.query(sql, values);
  const next = resultRows(updated)[0];
  if (next === undefined) throw new Error("WORKFLOW_CAS_FAILED");
  let auditRow: Result;
  try { auditRow = await client.query("INSERT INTO sales_workflow_execution_audit(application_id,environment,execution_id,revision,from_state,to_state,action_id,evidence,digest,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING execution_id", [next.application_id, next.environment, next.id, revision, fromState, toState, jobId, JSON.stringify(current), sha(current), occurredAt]); }
  catch (error) { if (isUniqueViolation(error)) throw new WorkflowCollision(); throw error; }
  if (resultRows(auditRow).length !== 1) throw new WorkflowCollision();
  await insertWorkflowEvent(client, next, toState, revision, occurredAt, idempotencyKey, options.failureCode, options.eventId);
  return next;
}

function sourceEventDigest(event: Row): string { return sha({ eventId: event.event_id, eventType: event.event_type, schemaVersion: event.schema_version, messageClass: event.message_class, applicationId: event.application_id, pluginId: event.plugin_id, actorId: event.actor_id, actorType: event.actor_type, correlationId: event.correlation_id, causationId: event.causation_id, idempotencyKey: event.idempotency_key, occurredAt: iso(event.occurred_at), payload: event.payload }); }
function sourceMatchesExecution(row: Row, event: Row): boolean {
  const parsed = parseTrigger(event);
  if (parsed === undefined) return false;
  const effectKey = sha({ applicationId: row.application_id, environment: row.environment, sourceEventId: event.event_id, sourceEventDigest: sourceEventDigest(event), workflowId: parsed.workflowId, workflowVersion: 1, effectKind: parsed.effectKind, targetObjectType: definitions[parsed.workflowId].target, targetRecordId: parsed.targetId, targetRevision: parsed.acceptedRevision, recipientId: parsed.recipientId });
  return String(event.event_id) === String(row.source_event_id) && String(event.application_id) === String(row.application_id) && event.event_type === row.trigger_event_type && event.message_class === row.message_class && sourceEventDigest(event) === String(row.source_event_digest) && sha(event.payload) === String(row.payload_digest) && iso(event.occurred_at) === iso(row.source_occurred_at) && String(event.idempotency_key ?? event.event_id) === String(row.source_idempotency_key ?? event.event_id) && parsed.actorId === String(row.actor_id) && parsed.recipientId === String(row.recipient_id) && parsed.targetId === String(row.target_record_id) && parsed.acceptedRevision === Number(row.target_revision) && effectKey === String(row.effect_key);
}
function triggerReceiptEvidence(event: Row, environment: string, sourceDigest: string, payloadDigest: string, state: "accepted" | "rejected", failureCode: string | null): Row {
  return Object.freeze({ actionId: jobId, resourceId: String(event.event_id), applicationId: String(event.application_id), environment, sourceEventId: String(event.event_id), sourceEventDigest: sourceDigest, payloadDigest, fromState: "absent", toState: state, occurredAt: iso(event.occurred_at) ?? new Date().toISOString(), actorId: text(event.actor_id, 160) ?? "system", revision: 1, idempotencyKey: String(event.idempotency_key ?? event.event_id), ...(failureCode === null ? {} : { failureCode }) });
}
async function insertTriggerReceipt(client: Sql, event: Row, environment: string, sourceDigest: string, payloadDigest: string, state: "accepted" | "rejected", executionId: string | null, failureCode: string | null): Promise<void> {
  const audit = triggerReceiptEvidence(event, environment, sourceDigest, payloadDigest, state, failureCode);
  let inserted: Result;
  try { inserted = await client.query("INSERT INTO sales_workflow_trigger_receipts(application_id,environment,source_event_id,source_event_digest,payload_digest,state,execution_id,failure_code,audit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING source_event_id", [event.application_id, environment, event.event_id, sourceDigest, payloadDigest, state, executionId, failureCode, JSON.stringify([audit])]); }
  catch (error) { if (isUniqueViolation(error)) throw new WorkflowCollision(); throw error; }
  if (resultRows(inserted).length !== 1) throw new WorkflowCollision();
}

export async function ingestGeneratedSalesWorkflowTriggers(pool: Pool, fence: GeneratedSalesWorkflowFence): Promise<number> {
  if (!validFence(fence)) return 0;
  return transaction(pool, async (client) => {
    if (!await lockLive(client, fence)) return 0;
    const source = await client.query("SELECT id,event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload FROM k_nex_outbox WHERE application_id=$1 AND plugin_id='module.sales' AND message_class='durable-workflow' AND event_type=ANY($2::text[]) AND payload->>'environment'=$3 AND NOT EXISTS (SELECT 1 FROM sales_workflow_trigger_receipts r WHERE r.application_id=k_nex_outbox.application_id AND r.environment=$3 AND r.source_event_id=k_nex_outbox.event_id) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 16", [fence.applicationId, eventTypes, fence.environment]);
    let inserted = 0;
    for (const event of resultRows(source)) {
      const parsed = parseTrigger(event);
      const sourceDigest = sourceEventDigest(event);
      const payloadDigest = sha(event.payload);
      if (parsed === undefined) { await insertTriggerReceipt(client, event, fence.environment, sourceDigest, payloadDigest, "rejected", null, "WORKFLOW_PAYLOAD_INVALID"); continue; }
      const effectKey = sha({ applicationId: fence.applicationId, environment: fence.environment, sourceEventId: event.event_id, sourceEventDigest: sourceDigest, workflowId: parsed.workflowId, workflowVersion: 1, effectKind: parsed.effectKind, targetObjectType: definitions[parsed.workflowId].target, targetRecordId: parsed.targetId, targetRevision: parsed.acceptedRevision, recipientId: parsed.recipientId });
      const old = resultRows(await client.query("SELECT * FROM sales_workflow_executions WHERE application_id=$1 AND environment=$2 AND source_event_id=$3 FOR UPDATE", [fence.applicationId, fence.environment, event.event_id]))[0];
      if (old !== undefined) {
        if (old.source_event_digest !== sourceDigest || old.payload_digest !== payloadDigest || old.effect_key !== effectKey || old.trigger_event_type !== event.event_type || old.message_class !== event.message_class || old.actor_id !== parsed.actorId || old.recipient_id !== parsed.recipientId || old.target_record_id !== parsed.targetId || Number(old.target_revision) !== parsed.acceptedRevision) throw new WorkflowCollision();
        await insertTriggerReceipt(client, event, fence.environment, sourceDigest, payloadDigest, "accepted", String(old.id), null);
        continue;
      }
      const allocated = resultRows(await client.query("SELECT nextval(pg_get_serial_sequence('sales_workflow_executions','id')) AS id"))[0];
      const executionId = rowId(allocated?.id);
      const initial = Object.freeze({ actionId: jobId, resourceId: executionId, applicationId: fence.applicationId, environment: fence.environment, workflowId: parsed.workflowId, effectKind: parsed.effectKind, targetRecordId: parsed.targetId, sourceEventId: String(event.event_id), payloadDigest, effectKey, fromState: "absent", toState: "queued", occurredAt: parsed.acceptedAt, actorId: parsed.actorId, revision: 1, attempt: 0, idempotencyKey: String(event.idempotency_key ?? event.event_id) });
      const created = resultRows(await client.query("INSERT INTO sales_workflow_executions(id,application_id,environment,source_event_id,source_event_digest,source_occurred_at,source_idempotency_key,workflow_id,workflow_version,trigger_event_type,message_class,effect_kind,target_object_type,target_record_id,target_revision,actor_id,recipient_id,accepted_owner_id,authorization_revision,lifecycle_revision,scope_revision,accepted_at,scheduled_at,payload_json,payload_digest,effect_key,state,attempt,next_attempt_at,audit) VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,1,$9,'durable-workflow',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::timestamptz,$21::timestamptz,$22::jsonb,$23,$24,'queued',0,now(),$25::jsonb) RETURNING *", [executionId, fence.applicationId, fence.environment, event.event_id, sourceDigest, iso(event.occurred_at), event.idempotency_key ?? event.event_id, parsed.workflowId, event.event_type, parsed.effectKind, definitions[parsed.workflowId].target, parsed.targetId, parsed.acceptedRevision, parsed.actorId, parsed.recipientId, parsed.acceptedOwnerId, parsed.authorizationRevision, parsed.lifecycleRevision, parsed.scopeRevision, parsed.acceptedAt, parsed.scheduledAt ?? null, JSON.stringify(parsed.payload), payloadDigest, effectKey, JSON.stringify([initial])]))[0];
      if (created === undefined) throw new WorkflowCollision();
      const auditRow = await client.query("INSERT INTO sales_workflow_execution_audit(application_id,environment,execution_id,revision,from_state,to_state,action_id,evidence,digest,occurred_at) VALUES($1,$2,$3,1,'absent','queued',$4,$5::jsonb,$6,$7) RETURNING execution_id", [fence.applicationId, fence.environment, created.id, jobId, JSON.stringify(initial), sha(initial), parsed.acceptedAt]);
      if (resultRows(auditRow).length !== 1) throw new WorkflowCollision();
      await insertWorkflowEvent(client, created, "queued", 1, parsed.acceptedAt, String(event.idempotency_key ?? event.event_id), null);
      await insertTriggerReceipt(client, event, fence.environment, sourceDigest, payloadDigest, "accepted", String(created.id), null);
      inserted += 1;
    }
    return inserted;
  });
}

async function insertEffectReceipt(client: Sql, row: Row): Promise<void> {
  const added = await client.query("INSERT INTO sales_workflow_effect_receipts(effect_key,execution_id,application_id,environment,effect_kind,target_object_type,target_record_id,recipient_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(effect_key) DO NOTHING RETURNING effect_key", [row.effect_key, row.id, row.application_id, row.environment, row.effect_kind, row.target_object_type, row.target_record_id, row.recipient_id]);
  if (resultRows(added).length === 1) return;
  const prior = resultRows(await client.query("SELECT execution_id,effect_kind,target_object_type,target_record_id,recipient_id FROM sales_workflow_effect_receipts WHERE effect_key=$1 FOR UPDATE", [row.effect_key]))[0];
  if (prior === undefined || String(prior.execution_id) !== String(row.id) || prior.effect_kind !== row.effect_kind || prior.target_object_type !== row.target_object_type || String(prior.target_record_id) !== String(row.target_record_id) || prior.recipient_id !== row.recipient_id) throw new WorkflowCollision();
  throw new WorkflowCollision();
}
function domainAudit(actionId: string, resourceId: string, row: Row, fromState: string, toState: string, idempotencyKey: string, occurredAt: string): Row { return Object.freeze({ actionId, resourceId, applicationId: String(row.application_id), environment: String(row.environment), fromState, toState, occurredAt, actorId: String(row.actor_id), revision: 1, idempotencyKey }); }
async function insertDomainEvent(client: Sql, row: Row, kind: string, resourceId: string, actionId: string, fromState: string, toState: string, idempotencyKey: string, occurredAt: string): Promise<void> {
  const eventId = "sales-workflow-domain-" + sha({ kind, idempotencyKey }).slice(7);
  const payload = { actionId, resourceId, applicationId: String(row.application_id), environment: String(row.environment), fromState, toState, revision: 1, occurredAt, actorId: String(row.actor_id), idempotencyKey };
  let result: Result;
  try { result = await client.query("INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) VALUES($1,$2,1,'durable-integration',$3,$4,'module.sales',$5,'user',$6,$7,$1,$8::jsonb,'pending',$3::timestamptz+interval '30 days') RETURNING event_id", [eventId, kind, occurredAt, row.application_id, row.actor_id, String(row.id), String(row.source_event_id), JSON.stringify(payload)]); }
  catch (error) { if (isUniqueViolation(error)) throw new WorkflowCollision(); throw error; }
  if (resultRows(result).length !== 1) throw new WorkflowCollision();
}
async function createEffect(client: Client, row: Row): Promise<string | null> {
  const now = new Date().toISOString();
  if (row.effect_kind === "task") {
    const auth = resultRows(await client.query("SELECT 1 FROM k_nex_authorization_state WHERE application_id=$1 AND authorization_revision=$2 AND lifecycle_revision=$3 FOR SHARE", [row.application_id, row.authorization_revision, row.lifecycle_revision]));
    if (auth.length !== 1) return "WORKFLOW_AUTH_RECHECK_FAILED";
    const scope = resultRows(await client.query("SELECT 1 FROM sales_current_authority_scopes WHERE application_id=$1 AND environment=$2 AND principal_id=$3 AND state='active' AND mutation_allowed=true AND revision=$4 FOR SHARE", [row.application_id, row.environment, row.actor_id, row.scope_revision]));
    if (scope.length !== 1) return "WORKFLOW_SCOPE_RECHECK_FAILED";
  }
  if (row.effect_kind === "task") {
    const target = resultRows(await client.query("SELECT o.id,o.team_id FROM sales_opportunities o JOIN sales_pipeline_stages s ON s.application_id=o.application_id AND s.environment=o.environment AND s.pipeline_id=o.pipeline_id AND s.stage_id=o.stage_id AND s.status='active' AND s.semantic='proposal' WHERE o.id::text=$1 AND o.application_id=$2 AND o.environment=$3 AND o.revision=$4 AND o.owner_id=$5 AND o.archive_status='active' FOR UPDATE", [row.target_record_id, row.application_id, row.environment, row.target_revision, row.accepted_owner_id]));
    if (target.length !== 1) return "WORKFLOW_TARGET_MISSING";
    await insertEffectReceipt(client, row);
    const taskId = String(resultRows(await client.query("SELECT nextval(pg_get_serial_sequence('sales_tasks','id')) AS id"))[0]?.id);
    if (!/^\\d+$/u.test(taskId) || taskId === "0") throw new Error("WORKFLOW_EFFECT_FAILED");
    const audit = domainAudit("sales.task.create", taskId, row, "absent", "open", String(row.effect_key), now);
    const created = await client.query("INSERT INTO sales_tasks(id,application_id,environment,owner_id,team_id,created_by,updated_by,revision,audit,due_date,related_record_id,related_record_type,archive_status,status,title) VALUES($1,$2,$3,$4,$5,$6,$6,1,$7::jsonb,NULL,$8,'sales.opportunity','active','open','Follow up proposal') RETURNING id", [taskId, row.application_id, row.environment, row.accepted_owner_id, target[0]!.team_id ?? null, row.actor_id, JSON.stringify([audit]), row.target_record_id]);
    if (resultRows(created).length !== 1) throw new WorkflowCollision();
    await insertDomainEvent(client, row, "sales.event.task-changed", taskId, "sales.task.create", "absent", "open", String(row.effect_key), now);
    return null;
  }
  if (row.effect_kind === "notification") {
    const target = resultRows(await client.query("SELECT id FROM sales_leads WHERE id::text=$1 AND application_id=$2 AND environment=$3 AND revision=$4 AND owner_id=$5 AND archive_status='active' FOR UPDATE", [row.target_record_id, row.application_id, row.environment, row.target_revision, row.accepted_owner_id]));
    if (target.length !== 1) return "WORKFLOW_TARGET_MISSING";
    await insertEffectReceipt(client, row);
    const notificationId = String(resultRows(await client.query("SELECT nextval(pg_get_serial_sequence('sales_notifications','id')) AS id"))[0]?.id);
    const audit = domainAudit("sales.notification.deliver", notificationId, row, "absent", "unread", String(row.effect_key), now);
    const created = await client.query("INSERT INTO sales_notifications(id,application_id,environment,recipient_id,subject,reference_kind,reference_id,state,revision,metadata,audit,delivered_at,created_at,updated_at) VALUES($1,$2,$3,$4,'Lead assigned to you; open Lead only after current authorization recheck','lead',$5,'unread',1,'{}'::jsonb,$6::jsonb,$7::timestamptz,$7::timestamptz,$7::timestamptz) RETURNING id", [notificationId, row.application_id, row.environment, row.recipient_id, row.target_record_id, JSON.stringify([audit]), now]);
    if (resultRows(created).length !== 1) throw new WorkflowCollision();
    await insertDomainEvent(client, row, "sales.event.notification-changed", notificationId, "sales.notification.deliver", "absent", "unread", String(row.effect_key), now);
    return null;
  }
  const target = resultRows(await client.query("SELECT id FROM sales_activities WHERE id::text=$1 AND application_id=$2 AND environment=$3 AND revision=$4 AND status='scheduled' AND actor_id=$5 AND scheduled_at=$6::timestamptz FOR UPDATE", [row.target_record_id, row.application_id, row.environment, row.target_revision, row.actor_id, row.scheduled_at]));
  if (target.length !== 1) return "WORKFLOW_TARGET_MISSING";
  await insertEffectReceipt(client, row);
  const reminderId = String(resultRows(await client.query("SELECT nextval(pg_get_serial_sequence('sales_reminders','id')) AS id"))[0]?.id);
  const audit = domainAudit("sales.reminder.schedule", reminderId, row, "absent", "scheduled", String(row.effect_key), now);
  const created = await client.query("INSERT INTO sales_reminders(id,application_id,environment,recipient_id,reference_kind,reference_id,subject,scheduled_at,state,revision,attempt,idempotency_digest,audit,created_at,updated_at) VALUES($1,$2,$3,$4,'activity',$5,'Activity reminder',GREATEST($6::timestamptz,$7::timestamptz-interval '15 minutes'),'scheduled',1,0,$8,$9::jsonb,$10::timestamptz,$10::timestamptz) RETURNING id", [reminderId, row.application_id, row.environment, row.recipient_id, row.target_record_id, row.accepted_at, row.scheduled_at, row.effect_key, JSON.stringify([audit]), now]);
  if (resultRows(created).length !== 1) throw new WorkflowCollision();
  await insertDomainEvent(client, row, "sales.event.reminder-changed", reminderId, "sales.reminder.schedule", "absent", "scheduled", String(row.effect_key), now);
  return null;
}

async function claimBatch(pool: Pool, fence: GeneratedSalesWorkflowFence): Promise<readonly Row[]> {
  return transaction(pool, async (client) => {
    if (!await lockLive(client, fence)) return [];
    const exhausted = resultRows(await client.query("SELECT * FROM sales_workflow_executions WHERE application_id=$1 AND environment=$2 AND state='running' AND lease_expires_at<=now() AND attempt>=3 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 16", [fence.applicationId, fence.environment]));
    const candidates = resultRows(await client.query("SELECT * FROM sales_workflow_executions WHERE application_id=$1 AND environment=$2 AND ((state='queued' AND next_attempt_at<=now() AND attempt<3) OR (state='running' AND lease_expires_at<=now() AND attempt<3)) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 16", [fence.applicationId, fence.environment]));
    const claimed: Row[] = [];
    let savepointIndex = 0;
    const isolate = async <T>(work: () => Promise<T>, onTransitionCollision?: () => Promise<T | undefined>): Promise<T | undefined> => {
      const savepoint = \`crm_workflow_claim_\${savepointIndex++}\`;
      await client.query(\`SAVEPOINT \${savepoint}\`);
      try {
        const value = await work();
        await client.query(\`RELEASE SAVEPOINT \${savepoint}\`);
        return value;
      } catch (error) {
        await client.query(\`ROLLBACK TO SAVEPOINT \${savepoint}\`);
        await client.query(\`RELEASE SAVEPOINT \${savepoint}\`);
        if (error instanceof WorkflowTransitionCollision && onTransitionCollision !== undefined) return onTransitionCollision();
        if (error instanceof WorkflowCollision) return undefined;
        throw error;
      }
    };
    const terminalizeCollision = async (row: Row): Promise<undefined> => {
      await client.query("SAVEPOINT crm_workflow_collision_terminal");
      try {
        if (!await lockLive(client, fence)) { await client.query("RELEASE SAVEPOINT crm_workflow_collision_terminal"); return undefined; }
        const current = resultRows(await client.query("SELECT * FROM sales_workflow_executions WHERE id=$1 AND application_id=$2 AND environment=$3 AND state IN ('queued','running') FOR UPDATE", [row.id, fence.applicationId, fence.environment]))[0];
        if (current !== undefined && await lockLive(client, fence)) {
          if (current.state === "queued") {
            const claimed = await appendTransition(client, current, "queued", "running", { attempt: Number(current.attempt) + 1, failureCode: null, nextAttemptSeconds: null, fence, eventId: transitionCollisionEventId(current, Number(current.revision) + 1) });
            await appendTransition(client, claimed, "running", "dead-letter", { attempt: Number(claimed.attempt), failureCode: "WORKFLOW_IDEMPOTENCY_CONFLICT", nextAttemptSeconds: null });
          } else await appendTransition(client, current, "running", "dead-letter", { attempt: Number(current.attempt), failureCode: "WORKFLOW_IDEMPOTENCY_CONFLICT", nextAttemptSeconds: null, eventId: transitionCollisionEventId(current, Number(current.revision) + 1) });
        }
        await client.query("RELEASE SAVEPOINT crm_workflow_collision_terminal");
        return undefined;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT crm_workflow_collision_terminal");
        await client.query("RELEASE SAVEPOINT crm_workflow_collision_terminal");
        if (error instanceof WorkflowCollision) return undefined;
        throw error;
      }
    };
    for (const row of exhausted) {
      const source = resultRows(await client.query("SELECT event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload FROM k_nex_outbox WHERE application_id=$2 AND event_id=$1 FOR SHARE", [row.source_event_id, fence.applicationId]))[0];
      if (source === undefined || !sourceMatchesExecution(row, source)) { await terminalizeCollision(row); continue; }
      await isolate(() => appendTransition(client, row, "running", "dead-letter", { attempt: Number(row.attempt), failureCode: "WORKFLOW_RETRY_EXHAUSTED", nextAttemptSeconds: null }), () => terminalizeCollision(row));
    }
    for (const row of candidates) {
      const source = resultRows(await client.query("SELECT event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload FROM k_nex_outbox WHERE application_id=$2 AND event_id=$1 FOR SHARE", [row.source_event_id, fence.applicationId]))[0];
      if (source === undefined || !sourceMatchesExecution(row, source)) { await terminalizeCollision(row); continue; }
      const next = await isolate(() => appendTransition(client, row, String(row.state), "running", { attempt: Number(row.attempt) + 1, failureCode: null, nextAttemptSeconds: null, fence }), () => terminalizeCollision(row));
      if (next !== undefined) claimed.push(next);
    }
    return claimed;
  });
}
async function executeOne(pool: Pool, row: Row, fence: GeneratedSalesWorkflowFence): Promise<"stale" | "done"> {
  return transaction(pool, async (client) => {
    if (!await lockLive(client, fence)) return "stale";
    const current = resultRows(await client.query("SELECT * FROM sales_workflow_executions WHERE id=$1 AND state='running' AND revision=$2 AND lease_revision=$3 AND worker_generation_id=$4 AND worker_fencing_token=$5 AND worker_promotion_revision=$6 AND worker_lease_owner=$7 AND lease_expires_at>now() FOR UPDATE", [row.id, row.revision, row.lease_revision, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]))[0];
    if (current === undefined || !await lockLive(client, fence)) return "stale";
    const failure = await createEffect(client, current);
    if (failure !== null && !terminalCodes.includes(failure)) throw new Error(failure);
    await appendTransition(client, current, "running", failure === null ? "succeeded" : "dead-letter", { attempt: Number(current.attempt), failureCode: failure, nextAttemptSeconds: null });
    return "done";
  });
}
async function recordFailure(pool: Pool, row: Row, fence: GeneratedSalesWorkflowFence, failureCode: "WORKFLOW_EFFECT_FAILED" | "WORKFLOW_IDEMPOTENCY_CONFLICT", terminalizeConflict = false): Promise<void> {
  await transaction(pool, async (client) => {
    if (!await lockLive(client, fence)) return;
    const current = resultRows(await client.query("SELECT * FROM sales_workflow_executions WHERE id=$1 AND state='running' AND revision=$2 AND lease_revision=$3 AND worker_generation_id=$4 AND worker_fencing_token=$5 AND worker_promotion_revision=$6 AND worker_lease_owner=$7 FOR UPDATE", [row.id, row.revision, row.lease_revision, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]))[0];
    if (current === undefined || !await lockLive(client, fence)) return;
    if (terminalizeConflict) await appendTransition(client, current, "running", "dead-letter", { attempt: Number(current.attempt), failureCode: "WORKFLOW_IDEMPOTENCY_CONFLICT", nextAttemptSeconds: null, eventId: transitionCollisionEventId(current, Number(current.revision) + 1) });
    else if (Number(current.attempt) >= maxAttempts) await appendTransition(client, current, "running", "dead-letter", { attempt: Number(current.attempt), failureCode: failureCode === "WORKFLOW_IDEMPOTENCY_CONFLICT" ? failureCode : "WORKFLOW_RETRY_EXHAUSTED", nextAttemptSeconds: null });
    else await appendTransition(client, current, "running", "queued", { attempt: Number(current.attempt), failureCode, nextAttemptSeconds: Number(current.attempt) * 15 });
  });
}
export async function processGeneratedSalesWorkflows(pool: Pool, fence: GeneratedSalesWorkflowFence): Promise<number> {
  if (!validFence(fence)) return 0;
  const ingested = await ingestGeneratedSalesWorkflowTriggers(pool, fence);
  const claimed = await claimBatch(pool, fence);
  const limit = Math.min(claimed.length, batchSize, Math.max(0, hardCallCap - Math.min(ingested, batchSize)));
  for (const row of claimed.slice(0, limit)) {
    try { await executeOne(pool, row, fence); }
    catch (error) {
      if (error instanceof WorkflowTransitionCollision) {
        try { await recordFailure(pool, row, fence, "WORKFLOW_IDEMPOTENCY_CONFLICT", true); }
        catch (recoveryError) { if (!(recoveryError instanceof WorkflowCollision)) throw recoveryError; }
        continue;
      }
      const failureCode = error instanceof WorkflowCollision ? "WORKFLOW_IDEMPOTENCY_CONFLICT" : "WORKFLOW_EFFECT_FAILED";
      try { await recordFailure(pool, row, fence, failureCode); }
      catch (recoveryError) { if (!(recoveryError instanceof WorkflowCollision)) throw recoveryError; }
    }
  }
  return limit;
}
`;
}
