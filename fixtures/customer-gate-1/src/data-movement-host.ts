import { createHash, randomUUID } from "node:crypto";

import { canonicalJson } from "@k-nex/contracts";
import { salesAccountsDescriptor, salesContactsDescriptor, salesLeadsDescriptor } from "@k-nex/module-sales-current/contracts";
import { buildSalesExportCsv, createSalesDataMovementJobAudit, createSalesDataMovementJobOutbox, createSalesImportGenesisAudit, createSalesMergeAuditTransition, parseSalesImportCsv, salesDataMovementObjectEvent, salesDedupeMatch, type SalesImportMapping } from "@k-nex/module-sales-current/server";
import { activePayloadPostgresTransaction } from "@k-nex/payload-adapter";
import { ActionGatewayError, DataSourceGatewayError } from "@k-nex/runtime";
import { sql } from "@payloadcms/db-postgres";
import type { Endpoint, PayloadRequest } from "payload";

import type { FixtureCurrentAuthority, FixtureDurableSalesAuthority } from "./current-authority.js";

type Row = Record<string, unknown>;
type Target = "sales.object.lead" | "sales.object.account" | "sales.object.contact";
type MergeTarget = Exclude<Target, "sales.object.lead">;
type MovementAuthority = FixtureDurableSalesAuthority & Readonly<{ fieldGrants?: readonly `${Target}:${string}`[]; permissionGrants?: readonly string[] }>;
export type SalesDataMovementWorkerFence = Readonly<{ activeExecutionGeneration: string; fencingToken: number; leaseOwner: string; promotionRevision: number }>;

const sha256 = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digest = (value: unknown) => sha256(canonicalJson(value));
const rows = (value: unknown): readonly Row[] => typeof value === "object" && value !== null && "rows" in value && Array.isArray(value.rows) ? value.rows as Row[] : (() => { throw new Error("Data-movement SQL result is invalid."); })();
const safeId = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : (() => { throw new ActionGatewayError("NOT_FOUND", 404, "Sales data-movement resource is unavailable."); })();
const now = () => new Date().toISOString();
const protectedFields = new Set(["email", "phone"]);
function cursor(after: number) { return Buffer.from(canonicalJson({ after }), "utf8").toString("base64url"); }
function cursorAfter(value: string | undefined): number {
  if (value === undefined) return 0;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown; if (typeof parsed === "object" && parsed !== null && Object.keys(parsed).join("") === "after" && Number.isSafeInteger((parsed as Row).after) && Number((parsed as Row).after) > 0) return Number((parsed as Row).after); } catch {}
  sourceError("NOT_FOUND", 404, "Sales duplicate cursor is unavailable.");
}

function actionError(code: string, status: number, detail: string): never { throw new ActionGatewayError(code, status, detail); }
function sourceError(code: string, status: number, detail: string): never { throw new DataSourceGatewayError(code, status, detail); }

function tableFor(target: Target) { return target === "sales.object.account" ? "sales_accounts" : target === "sales.object.contact" ? "sales_contacts" : "sales_leads"; }
function sourceFor(target: Target) { return target === "sales.object.account" ? "sales.accounts" : target === "sales.object.contact" ? "sales.contacts" : "sales.leads"; }
function readPermission(target: Target) { return target === "sales.object.account" ? "sales.accounts.read" : target === "sales.object.contact" ? "sales.contacts.read" : "sales.leads.read"; }
function writePermission(target: Target) { return target === "sales.object.account" ? "sales.accounts.write" : target === "sales.object.contact" ? "sales.contacts.write" : "sales.leads.write"; }
function requiredImportPermissions(target: Target) { return ["sales.imports.execute", writePermission(target), ...(target === "sales.object.contact" ? ["sales.accounts.read"] : [])]; }
function requiredExportPermissions(target: Target) { return ["sales.exports.execute", readPermission(target)]; }
function hasPermissions(value: unknown, required: readonly string[]): value is readonly string[] { return Array.isArray(value) && value.every((entry) => typeof entry === "string") && required.every((permission) => value.includes(permission)); }
function validWorkerFence(value: SalesDataMovementWorkerFence) { return typeof value.activeExecutionGeneration === "string" && value.activeExecutionGeneration.length > 0 && Number.isSafeInteger(value.fencingToken) && value.fencingToken > 0 && typeof value.leaseOwner === "string" && value.leaseOwner.length > 0 && Number.isSafeInteger(value.promotionRevision) && value.promotionRevision >= 0; }
function terminalJobEvidence(job: Row, evidence: Row) { return { applicationId: job.application_id, environment: job.environment, actorId: job.actor_id, jobId: Number(job.id), targetObjectType: job.target_object_type, authorizationRevision: Number(job.authorization_revision), lifecycleRevision: Number(job.lifecycle_revision), scopeRevision: Number(job.scope_revision), ...evidence }; }
const exportFields = Object.freeze({
  "sales.object.lead": Object.freeze(["display-name", "owner-id", "team-id", "status", "archive-status", "revision", "email", "phone"]),
  "sales.object.account": Object.freeze(["name", "owner-id", "team-id", "status", "revision"]),
  "sales.object.contact": Object.freeze(["display-name", "owner-id", "team-id", "account-id", "status", "revision", "email", "phone"])
} satisfies Readonly<Record<Target, readonly string[]>>);
const exportSourceHashes = Object.freeze({
  "sales.object.lead": "sha256:72bbddf594ce5a08bc0d1bf844f6803f767e8293ca2a999fc0c88d90d85cfe91",
  "sales.object.account": "sha256:9610899be1f882239297a5aea011ac2860e5dd7b57afe821bc8e08257aeffe11",
  "sales.object.contact": "sha256:7a05053c0eed840b9abb487c6817462ff3f9edf6ebd30b9b97e200f05b18a99e"
} satisfies Readonly<Record<Target, string>>);
function validExportSelection(target: Target, fields: unknown): fields is readonly string[] { return Array.isArray(fields) && fields.length > 0 && fields.length === new Set(fields).size && fields.every((field) => typeof field === "string" && exportFields[target].includes(field)); }
const importFields = Object.freeze({
  "sales.object.lead": Object.freeze(["displayName", "source", "email", "phone"]),
  "sales.object.account": Object.freeze(["name"]),
  "sales.object.contact": Object.freeze(["displayName", "accountId", "email", "phone"])
} satisfies Readonly<Record<Target, readonly string[]>>);
const requiredImportFields = Object.freeze({
  "sales.object.lead": Object.freeze(["displayName", "source"]),
  "sales.object.account": Object.freeze(["name"]),
  "sales.object.contact": Object.freeze(["displayName", "accountId"])
} satisfies Readonly<Record<Target, readonly string[]>>);
function validImportMapping(target: Target, value: unknown): value is readonly SalesImportMapping[] {
  if (!Array.isArray(value) || value.length < requiredImportFields[target].length || value.length > importFields[target].length) return false;
  const headers = new Set<string>(); const fields = new Set<string>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "fieldId,header") return false;
    const { header, fieldId } = entry as Row;
    if (typeof header !== "string" || header.length === 0 || Buffer.byteLength(header) > 120 || header !== header.normalize("NFC") || typeof fieldId !== "string" || !importFields[target].includes(fieldId) || headers.has(header) || fields.has(fieldId)) return false;
    headers.add(header); fields.add(fieldId);
  }
  return requiredImportFields[target].every((field) => fields.has(field));
}
function importValueCode(target: Target, mapping: readonly SalesImportMapping[], value: unknown): "IMPORT_REQUIRED_VALUE" | "IMPORT_VALUE_INVALID" | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "IMPORT_VALUE_INVALID";
  const record = value as Row; const keys = Object.keys(record).sort(); const expected = mapping.map(({ fieldId }) => fieldId).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return "IMPORT_VALUE_INVALID";
  for (const field of requiredImportFields[target]) if (record[field] === null || record[field] === undefined) return "IMPORT_REQUIRED_VALUE";
  for (const [field, scalar] of Object.entries(record)) {
    if (!importFields[target].includes(field)) return "IMPORT_VALUE_INVALID";
    if (field === "accountId") { if (!Number.isSafeInteger(scalar) || Number(scalar) < 1) return "IMPORT_VALUE_INVALID"; continue; }
    if (scalar === null && (field === "email" || field === "phone")) continue;
    const limit = field === "email" ? 320 : field === "phone" ? 64 : 120;
    if (typeof scalar !== "string" || scalar !== scalar.normalize("NFC") || Buffer.byteLength(scalar) > limit || scalar.length === 0 || /^[=+@-]/u.test(scalar.replace(/^[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u, ""))) return "IMPORT_VALUE_INVALID";
  }
}
const importUploadRequestByteLimit = 22_369_920;
async function boundedUploadBody(request: Request): Promise<Row> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^[0-9]+$/u.test(declaredLength) || Number(declaredLength) > importUploadRequestByteLimit) || request.body === null) throw new RangeError("upload body is invalid");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total <= importUploadRequestByteLimit) chunks.push(next.value); } }
  finally { reader.releaseLock(); }
  if (total > importUploadRequestByteLimit) throw new RangeError("upload body is too large");
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("upload body is invalid");
  return value as Row;
}
function scopeSql(durable: MovementAuthority, alias: string) {
  if (durable.recordScope === "application-sales-scope" || durable.recordScope === "explicit-application-or-team-scope" && durable.applicationWide) return sql`TRUE`;
  if (durable.recordScope === "explicit-application-or-team-scope") return durable.authorizedTeamIds.length === 0 ? sql`FALSE` : sql`${sql.raw(`${alias}.team_id`)} IN (${sql.join(durable.authorizedTeamIds.map((team) => sql`${team}`), sql`, `)})`;
  const teams = durable.authorizedTeamIds.length === 0 ? sql`FALSE` : sql`${sql.raw(`${alias}.team_id`)} IN (${sql.join(durable.authorizedTeamIds.map((team) => sql`${team}`), sql`, `)})`;
  return sql`(${sql.raw(`${alias}.owner_id`)}=${durable.context.actorId} OR ${teams})`;
}

export class FixtureSalesDataMovementStore {
  constructor(private readonly request: PayloadRequest, private readonly durable: MovementAuthority) {}
  private permissions(required: readonly string[]) { if (!hasPermissions(this.durable.permissionGrants, required)) actionError("ACTION_FORBIDDEN", 403, "Sales data-movement permission is unavailable."); }
  private fields(target: Target, fields: readonly string[]) { if (fields.some((field) => protectedFields.has(field) && !this.durable.fieldGrants?.includes(`${target}:${field}`))) actionError("ACTION_FORBIDDEN", 403, "Sales protected field is unavailable."); }
  private match(target: MergeTarget, subject: Row, candidate: Row) {
    if (target === "sales.object.account") return salesDedupeMatch(target, subject, candidate);
    const readable = new Set(this.durable.fieldGrants ?? []); const redact = (row: Row) => ({ ...(readable.has("sales.object.contact:email") ? { email: row.email } : {}), ...(readable.has("sales.object.contact:phone") ? { phone: row.phone } : {}) });
    return salesDedupeMatch(target, redact(subject), redact(candidate));
  }
  private async tx() { return await activePayloadPostgresTransaction(this.request); }
  private async fence(required: readonly string[]) {
    this.permissions(required);
    const transaction = await this.tx();
    const state = rows(await transaction.execute(sql`SELECT authorization_revision,lifecycle_revision FROM k_nex_authorization_state WHERE application_id=${this.durable.context.applicationId} FOR SHARE`))[0];
    const scope = rows(await transaction.execute(sql`SELECT revision FROM sales_current_authority_scopes WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND principal_id=${this.durable.context.actorId} AND state='active' FOR SHARE`))[0];
    if (state?.authorization_revision !== this.durable.authorizationRevision || state.lifecycle_revision !== this.durable.lifecycleRevision || scope?.revision !== this.durable.scopeRevision) actionError("ACTION_FORBIDDEN", 403, "Sales current authority changed.");
  }
  async dryRunImport(call: Readonly<{ input: Readonly<{ request: { uploadArtifactId: string; targetObjectType: Target; columnMapping: unknown; expectedAuthorizationRevision: number } }> }>) {
    const input = call.input;
    const request = input.request; const requiredPermissions = requiredImportPermissions(request.targetObjectType);
    await this.fence(requiredPermissions); const transaction = await this.tx();
    if (request.expectedAuthorizationRevision !== this.durable.authorizationRevision) actionError("ACTION_FORBIDDEN", 403, "Sales import authorization is stale.");
    const upload = rows(await transaction.execute(sql`SELECT artifact_id,bytes,digest FROM sales_import_uploads WHERE artifact_id=${request.uploadArtifactId} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND actor_id=${this.durable.context.actorId} AND bytes IS NOT NULL AND expires_at>now() FOR UPDATE`))[0];
    if (upload === undefined || !(upload.bytes instanceof Uint8Array)) actionError("IMPORT_UPLOAD_BINDING_INVALID", 400, "CSV upload binding is invalid.");
    let parsed: ReturnType<typeof parseSalesImportCsv>;
    try { parsed = parseSalesImportCsv(upload.bytes, request.targetObjectType, request.columnMapping as readonly SalesImportMapping[]); }
    catch (error) { const code = error instanceof Error && "code" in error ? String(error.code) : "IMPORT_INVALID_CSV"; actionError(code, 400, "CSV validation failed."); }
    this.fields(request.targetObjectType, (request.columnMapping as readonly SalesImportMapping[]).map(({ fieldId }) => fieldId));
    const mappingJson = (request.columnMapping as readonly unknown[]).map((entry) => entry); const mappingDigest = digest(mappingJson);
    const inserted = rows(await transaction.execute(sql`INSERT INTO sales_import_jobs(application_id,environment,actor_id,target_object_type,upload_artifact_id,upload_digest,mapping_canonical_json,mapping_digest,schema_revision,authorization_revision,lifecycle_revision,scope_revision,field_grants,permission_grants,state,revision,row_count,expires_at)
      VALUES(${this.durable.context.applicationId},${this.durable.context.environment},${this.durable.context.actorId},${request.targetObjectType},${request.uploadArtifactId},${parsed.uploadDigest},${JSON.stringify(mappingJson)}::jsonb,${mappingDigest},1,${this.durable.authorizationRevision},${this.durable.lifecycleRevision},${this.durable.scopeRevision},${JSON.stringify(this.durable.fieldGrants ?? [])}::jsonb,${JSON.stringify(requiredPermissions)}::jsonb,'draft',1,${parsed.rows.length + parsed.diagnostics.length},now()+interval '30 days') RETURNING id`))[0];
    const jobId = safeId(inserted?.id);
    for (const entry of parsed.rows) await transaction.execute(sql`INSERT INTO sales_import_rows(import_job_id,one_based_data_row,row_digest,canonical_mapped_json,mapped_digest) VALUES(${jobId},${entry.oneBasedDataRow},${entry.rowDigest},${JSON.stringify(entry.values)}::jsonb,${digest(entry.values)})`);
    for (const diagnostic of parsed.diagnostics) {
      const rowDigest = digest({ oneBasedDataRow: diagnostic.oneBasedDataRow, code: diagnostic.code });
      await transaction.execute(sql`INSERT INTO sales_import_rows(import_job_id,one_based_data_row,row_digest,outcome,diagnostic_code) VALUES(${jobId},${diagnostic.oneBasedDataRow},${rowDigest},'rejected',${diagnostic.code})`);
      await transaction.execute(sql`INSERT INTO sales_import_diagnostics(job_id,one_based_data_row,code,public_message) VALUES(${jobId},${diagnostic.oneBasedDataRow},${diagnostic.code},'Imported row was rejected.')`);
    }
    for (const chunk of parsed.chunks) {
      const chunkRows = rows(await transaction.execute(sql`SELECT one_based_data_row,row_digest,mapped_digest FROM sales_import_rows WHERE import_job_id=${jobId} AND one_based_data_row>${chunk.rowStart} AND one_based_data_row<=${chunk.rowEndExclusive} ORDER BY one_based_data_row`));
      await transaction.execute(sql`INSERT INTO sales_import_chunks(import_job_id,chunk_index,row_start,row_end_exclusive,input_digest,lease_revision) VALUES(${jobId},${chunk.chunkIndex},${chunk.rowStart},${chunk.rowEndExclusive},${digest(chunkRows)},1)`);
    }
    const validated = rows(await transaction.execute(sql`UPDATE sales_import_jobs SET state='validated',revision=2,rejected_rows=${parsed.rejectedRows},diagnostic_digest=${parsed.diagnosticDigest},updated_at=now() WHERE id=${jobId} AND state='draft' AND revision=1 RETURNING id`))[0];
    if (validated === undefined) actionError("STALE_RECORD", 409, "Sales import validation is stale.");
    const audit = { actionId: "sales.import.dry-run", jobId, state: "validated", revision: 2, uploadDigest: parsed.uploadDigest, mappingDigest, rowCount: parsed.rows.length + parsed.diagnostics.length, authorizationRevision: this.durable.authorizationRevision };
    await this.audit("sales.import.dry-run", "import-job", String(jobId), audit);
    return Object.freeze({ importJobId: jobId, revision: 2, state: "validated" as const, uploadDigest: parsed.uploadDigest, acceptedRows: parsed.acceptedRows, rejectedRows: parsed.rejectedRows, diagnosticDigest: parsed.diagnosticDigest });
  }
  async commitImport(call: Readonly<{ input: Readonly<{ importJobId: number; expectedRevision: number; expectedAuthorizationRevision: number }> }>) {
    const input = call.input;
    await this.fence(["sales.imports.execute"]); const transaction = await this.tx();
    if (input.expectedAuthorizationRevision !== this.durable.authorizationRevision) actionError("ACTION_FORBIDDEN", 403, "Sales import authorization is stale.");
    const receiptId = `import-${randomUUID()}`;
    const result = rows(await transaction.execute(sql`UPDATE sales_import_jobs SET state='queued',revision=revision+1,receipt_id=${receiptId},updated_at=now() WHERE id=${input.importJobId} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND actor_id=${this.durable.context.actorId} AND state='validated' AND revision=${input.expectedRevision} AND authorization_revision=${this.durable.authorizationRevision} AND lifecycle_revision=${this.durable.lifecycleRevision} AND permission_grants @> '["sales.imports.execute"]'::jsonb RETURNING *`))[0];
    if (result === undefined) actionError("STALE_RECORD", 409, "Sales import job is stale.");
    await this.jobAudit("import", "sales.import.commit", result, "validated", "queued", false);
    return Object.freeze({ importJobId: input.importJobId, revision: Number(result.revision), state: "queued" as const, receiptId });
  }
  async cancelImport(call: Readonly<{ input: Readonly<{ importJobId: number; expectedRevision: number }> }>) {
    const input = call.input;
    await this.fence(["sales.imports.execute"]); const transaction = await this.tx(); const receiptId = `import-${randomUUID()}`;
    const prior = rows(await transaction.execute(sql`SELECT state FROM sales_import_jobs WHERE id=${input.importJobId} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND actor_id=${this.durable.context.actorId} AND state IN ('validated','queued') AND revision=${input.expectedRevision} FOR UPDATE`))[0];
    const result = prior === undefined ? undefined : rows(await transaction.execute(sql`UPDATE sales_import_jobs SET state='cancelled',revision=revision+1,receipt_id=COALESCE(receipt_id,${receiptId}),updated_at=now() WHERE id=${input.importJobId} AND state=${prior.state} AND revision=${input.expectedRevision} AND authorization_revision=${this.durable.authorizationRevision} AND lifecycle_revision=${this.durable.lifecycleRevision} AND permission_grants @> '["sales.imports.execute"]'::jsonb RETURNING *`))[0];
    if (result === undefined) actionError("STALE_RECORD", 409, "Sales import job is stale.");
    await transaction.execute(sql`UPDATE sales_import_chunks SET state='failed',worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL WHERE import_job_id=${input.importJobId} AND state IN ('queued','claimed')`);
    const chunkResultDigests = rows(await transaction.execute(sql`SELECT result_digest FROM sales_import_chunks WHERE import_job_id=${input.importJobId} ORDER BY chunk_index FOR SHARE`)).map(({ result_digest }) => result_digest ?? null);
    const diagnostics = rows(await transaction.execute(sql`SELECT one_based_data_row,code FROM sales_import_diagnostics WHERE job_id=${input.importJobId} ORDER BY one_based_data_row FOR SHARE`));
    const evidence = terminalJobEvidence(result, { actionId: "sales.import.cancel", actionVersion: 1, uploadDigest: result.upload_digest, mappingDigest: result.mapping_digest, schemaRevision: Number(result.schema_revision), rowCount: Number(result.row_count), acceptedRows: Number(result.accepted_rows), rejectedRows: Number(result.rejected_rows), chunkResultDigests, diagnosticDigest: diagnostics.length === 0 ? null : digest(diagnostics), diagnosticArtifactId: result.diagnostic_artifact_id ?? null, diagnosticArtifactDigest: result.diagnostic_digest ?? null, failureCode: null, state: "cancelled", revision: Number(result.revision) });
    await terminalReceipt(transaction, "import", result, evidence);
    await this.jobAudit("import", "sales.import.cancel", result, String(prior!.state), "cancelled", true);
    return Object.freeze({ importJobId: input.importJobId, revision: Number(result.revision), state: "cancelled" as const });
  }
  async createExport(call: Readonly<{ input: Readonly<{ request: { targetObjectType: Target; sourceId: string; sourceVersion: number; sourceSchemaVersion: number; selectedFields: readonly string[]; expectedAuthorizationRevision: number } }> }>) {
    const input = call.input;
    const request = input.request; const requiredPermissions = requiredExportPermissions(request.targetObjectType);
    await this.fence(requiredPermissions); const transaction = await this.tx(); const expectedSource = sourceFor(request.targetObjectType);
    if (request.expectedAuthorizationRevision !== this.durable.authorizationRevision || request.sourceId !== expectedSource || request.sourceVersion !== 1 || request.sourceSchemaVersion !== 1 || !validExportSelection(request.targetObjectType, request.selectedFields)) actionError("ACTION_FORBIDDEN", 403, "Sales export source is stale.");
    this.fields(request.targetObjectType, request.selectedFields);
    const sourceHash = exportSourceHashes[request.targetObjectType];
    const table = tableFor(request.targetObjectType); const scope = scopeSql(this.durable, "r"); const records: Row[] = []; let afterId = 0;
    while (true) {
      const query = table === "sales_accounts" ? sql`SELECT id,revision,name,owner_id,team_id,status FROM sales_accounts r WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND id>${afterId} AND ${scope} ORDER BY id LIMIT 100 FOR SHARE`
        : table === "sales_contacts" ? sql`SELECT id,revision,display_name,owner_id,team_id,account_id,status,email,phone FROM sales_contacts r WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND id>${afterId} AND ${scope} ORDER BY id LIMIT 100 FOR SHARE`
          : sql`SELECT id,revision,display_name,owner_id,team_id,status,archive_status,email,phone FROM sales_leads r WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND id>${afterId} AND ${scope} ORDER BY id LIMIT 100 FOR SHARE`;
      const batch = rows(await transaction.execute(query)); records.push(...batch);
      if (records.length > 10_000) actionError("IMPORT_LIMIT_EXCEEDED", 400, "Sales export row limit was exceeded.");
      if (batch.length < 100) break; afterId = safeId(batch[batch.length - 1]!.id);
    }
    const storage = Object.freeze({ "display-name": "display_name", "owner-id": "owner_id", "team-id": "team_id", "account-id": "account_id", status: "status", "archive-status": "archive_status", revision: "revision", email: "email", phone: "phone", name: "name" } as const);
    const snapshots = records.map((record, ordinal) => {
      const row: Row = {}; for (const field of request.selectedFields) row[field] = record[storage[field as keyof typeof storage]] ?? null;
      return { ordinal, recordId: Number(record.id), recordRevision: Number(record.revision), row, rowDigest: digest(row) };
    });
    const snapshotDigest = digest(snapshots.map(({ recordId, recordRevision, rowDigest }) => ({ recordId, recordRevision, authorizedRedactedRowDigest: rowDigest })));
    const receiptId = `export-${randomUUID()}`; const queryJson = {}; const queryDigest = digest(queryJson);
    await this.fence(requiredPermissions);
    if (request.sourceId !== expectedSource || request.sourceVersion !== 1 || request.sourceSchemaVersion !== 1 || sourceHash !== exportSourceHashes[request.targetObjectType]) actionError("ACTION_FORBIDDEN", 403, "Sales export source changed.");
    const inserted = rows(await transaction.execute(sql`INSERT INTO sales_export_jobs(application_id,environment,actor_id,target_object_type,source_id,source_version,source_schema_version,source_hash,query_canonical_json,query_digest,selected_fields,authorization_revision,lifecycle_revision,scope_revision,field_grants,permission_grants,snapshot_revision,snapshot_digest,state,revision,row_count,receipt_id,expires_at)
      VALUES(${this.durable.context.applicationId},${this.durable.context.environment},${this.durable.context.actorId},${request.targetObjectType},${request.sourceId},1,1,${sourceHash},${JSON.stringify(queryJson)}::jsonb,${queryDigest},${JSON.stringify(request.selectedFields)}::jsonb,${this.durable.authorizationRevision},${this.durable.lifecycleRevision},${this.durable.scopeRevision},${JSON.stringify(this.durable.fieldGrants ?? [])}::jsonb,${JSON.stringify(requiredPermissions)}::jsonb,1,${snapshotDigest},'queued',1,${snapshots.length},${receiptId},now()+interval '30 days') RETURNING id`))[0];
    const jobId = safeId(inserted?.id);
    for (const snapshot of snapshots) await transaction.execute(sql`INSERT INTO sales_export_snapshot_rows(export_job_id,ordinal,record_id,record_revision,row_json,row_digest) VALUES(${jobId},${snapshot.ordinal},${snapshot.recordId},${snapshot.recordRevision},${JSON.stringify(snapshot.row)}::jsonb,${snapshot.rowDigest})`);
    const evidence = { actionId: "sales.export.create", jobId, sourceId: request.sourceId, sourceVersion: 1, sourceSchemaVersion: 1, sourceHash, selectedFields: request.selectedFields, authorizationRevision: this.durable.authorizationRevision, lifecycleRevision: this.durable.lifecycleRevision, snapshotDigest, snapshotRevision: 1, rowCount: snapshots.length, state: "queued" };
    await this.jobAudit("export", "sales.export.create", { ...evidence, id: jobId, application_id: this.durable.context.applicationId, environment: this.durable.context.environment, actor_id: this.durable.context.actorId, target_object_type: request.targetObjectType, authorization_revision: this.durable.authorizationRevision, lifecycle_revision: this.durable.lifecycleRevision, scope_revision: this.durable.scopeRevision, revision: 1 }, "queued", "queued", false);
    return Object.freeze({ exportJobId: jobId, revision: 1, state: "queued" as const, snapshotDigest, snapshotRevision: 1, receiptId });
  }
  async cancelExport(call: Readonly<{ input: Readonly<{ exportJobId: number; expectedRevision: number }> }>) {
    const input = call.input;
    await this.fence(["sales.exports.execute"]); const transaction = await this.tx();
    const prior = rows(await transaction.execute(sql`SELECT state FROM sales_export_jobs WHERE id=${input.exportJobId} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND actor_id=${this.durable.context.actorId} AND state='queued' AND revision=${input.expectedRevision} FOR UPDATE`))[0];
    const result = prior === undefined ? undefined : rows(await transaction.execute(sql`UPDATE sales_export_jobs SET state='cancelled',revision=revision+1,updated_at=now() WHERE id=${input.exportJobId} AND state='queued' AND revision=${input.expectedRevision} AND authorization_revision=${this.durable.authorizationRevision} AND lifecycle_revision=${this.durable.lifecycleRevision} AND permission_grants @> '["sales.exports.execute"]'::jsonb RETURNING *`))[0];
    if (result === undefined) actionError("STALE_RECORD", 409, "Sales export job is stale.");
    const evidence = terminalJobEvidence(result, { actionId: "sales.export.cancel", sourceId: result.source_id, sourceVersion: result.source_version, sourceSchemaVersion: result.source_schema_version, sourceHash: result.source_hash, queryDigest: result.query_digest, selectedFields: result.selected_fields, snapshotDigest: result.snapshot_digest, snapshotRevision: result.snapshot_revision, rowCount: result.row_count, state: "cancelled", revision: result.revision });
    await terminalReceipt(transaction, "export", result, evidence);
    await this.jobAudit("export", "sales.export.cancel", result, "queued", "cancelled", true);
    return Object.freeze({ exportJobId: input.exportJobId, revision: Number(result.revision), state: "cancelled" as const });
  }
  async listImportJobs(call: Readonly<{ selectedFields: readonly string[] }>) { return await this.jobs("import", call.selectedFields); }
  async getImportJob(call: Readonly<{ input: Readonly<Record<string, unknown>>; selectedFields: readonly string[] }>) {
    const input = { importJobId: call.input["import-job-id"] as number | undefined, expectedRevision: call.input["expected-revision"] as number | undefined };
    if (input.importJobId === undefined && input.expectedRevision === undefined) return empty(call.selectedFields);
    if (input.importJobId === undefined || input.expectedRevision === undefined) sourceError("NOT_FOUND", 404, "Sales import job is unavailable.");
    const transaction = await this.tx(); const result = rows(await transaction.execute(sql`SELECT id,state,revision,expires_at,(SELECT diagnostic_code FROM sales_import_rows WHERE import_job_id=sales_import_jobs.id AND diagnostic_code IS NOT NULL ORDER BY one_based_data_row LIMIT 1) diagnostic_code FROM sales_import_jobs WHERE id=${input.importJobId} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND actor_id=${this.durable.context.actorId}`))[0];
    if (result === undefined) sourceError("NOT_FOUND", 404, "Sales import job is unavailable."); if (result.revision !== input.expectedRevision) sourceError("STALE_RECORD", 409, "Sales import job is stale.");
    return table(call.selectedFields, [Object.freeze({ id: result.id, state: result.state, "diagnostic-code": result.diagnostic_code ?? null, "artifact-expires-at": result.expires_at instanceof Date ? result.expires_at.toISOString() : result.expires_at, revision: result.revision })]);
  }
  async listExportJobs(call: Readonly<{ selectedFields: readonly string[] }>) { return await this.jobs("export", call.selectedFields); }
  async getExportJob(call: Readonly<{ input: Readonly<Record<string, unknown>>; selectedFields: readonly string[] }>) {
    const input = { exportJobId: call.input["export-job-id"] as number | undefined, expectedRevision: call.input["expected-revision"] as number | undefined };
    if (input.exportJobId === undefined && input.expectedRevision === undefined) return empty(call.selectedFields);
    if (input.exportJobId === undefined || input.expectedRevision === undefined) sourceError("NOT_FOUND", 404, "Sales export job is unavailable.");
    const transaction = await this.tx(); const result = rows(await transaction.execute(sql`SELECT id,state,artifact_id,expires_at,revision FROM sales_export_jobs WHERE id=${input.exportJobId} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND actor_id=${this.durable.context.actorId}`))[0];
    if (result === undefined) sourceError("NOT_FOUND", 404, "Sales export job is unavailable."); if (result.revision !== input.expectedRevision) sourceError("STALE_RECORD", 409, "Sales export job is stale.");
    return table(call.selectedFields, [Object.freeze({ id: result.id, state: result.state, "artifact-id": result.artifact_id ?? null, "artifact-expires-at": result.expires_at instanceof Date ? result.expires_at.toISOString() : result.expires_at, revision: result.revision })]);
  }
  async findDedupeCandidates(call: Readonly<{ input: Readonly<Record<string, unknown>>; query: Readonly<{ cursor?: Readonly<{ after?: string }> }>; selectedFields: readonly string[] }>) {
    const input = { targetObjectType: call.input["target-object-type"] as MergeTarget | undefined, id: call.input.id as number | undefined, expectedRevision: call.input["expected-revision"] as number | undefined, cursor: call.query.cursor?.after };
    if (input.targetObjectType === undefined && input.id === undefined && input.expectedRevision === undefined) return empty(call.selectedFields);
    if (input.targetObjectType === undefined || input.id === undefined || input.expectedRevision === undefined) sourceError("NOT_FOUND", 404, "Sales duplicate subject is unavailable.");
    const matchFields = input.targetObjectType === "sales.object.contact" ? ["sales.object.contact:email", "sales.object.contact:phone"].filter((field) => this.durable.fieldGrants?.includes(field as `${Target}:${string}`)) : [];
    await this.fence([readPermission(input.targetObjectType)]); if (input.targetObjectType === "sales.object.contact" && matchFields.length === 0) sourceError("NOT_FOUND", 404, "Sales duplicate subject is unavailable.");
    const transaction = await this.tx(); const tableName = tableFor(input.targetObjectType); const scope = scopeSql(this.durable, "r");
    const subjectQuery = tableName === "sales_accounts" ? sql`SELECT id,revision,name FROM sales_accounts r WHERE id=${input.id} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND status='active' AND ${scope}` : sql`SELECT id,revision,email,phone,account_id FROM sales_contacts r WHERE id=${input.id} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND status='active' AND ${scope}`;
    const subject = rows(await transaction.execute(subjectQuery))[0]; if (subject === undefined) sourceError("NOT_FOUND", 404, "Sales duplicate subject is unavailable."); if (subject.revision !== input.expectedRevision) sourceError("STALE_RECORD", 409, "Sales duplicate subject is stale.");
    const matches: Array<{ candidate: Row; kind: NonNullable<ReturnType<typeof salesDedupeMatch>> }> = []; let after = 0;
    while (matches.length <= 1000) {
      const candidatesQuery = tableName === "sales_accounts" ? sql`SELECT id,revision,name FROM sales_accounts r WHERE id<>${input.id} AND id>${after} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND status='active' AND ${scope} ORDER BY id LIMIT 100`
        : sql`SELECT id,revision,email,phone,account_id FROM sales_contacts r WHERE id<>${input.id} AND id>${after} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND status='active' AND account_id=${subject.account_id} AND ${scope} ORDER BY id LIMIT 100`;
      const batch = rows(await transaction.execute(candidatesQuery));
      for (const candidate of batch) { const kind = this.match(input.targetObjectType!, subject, candidate); if (kind !== null) matches.push({ candidate, kind }); if (matches.length > 1000) break; }
      if (batch.length < 100) break; after = Number(batch.at(-1)!.id);
    }
    if (matches.length > 1000) sourceError("DEDUPE_CANDIDATE_LIMIT", 400, "Sales duplicate candidate limit was exceeded.");
    const requestedAfter = cursorAfter(input.cursor); const offset = matches.findIndex(({ candidate }) => Number(candidate.id) > requestedAfter);
    if (offset < 0 && input.cursor !== undefined) sourceError("NOT_FOUND", 404, "Sales duplicate cursor is unavailable."); const page = matches.slice(Math.max(0, offset), Math.max(0, offset) + 100);
    return table(call.selectedFields, page.map(({ candidate, kind }) => Object.freeze({ "candidate-id": candidate.id, "candidate-revision": candidate.revision, "match-kind": kind })), page.length === 100 && Math.max(0, offset) + 100 < matches.length ? cursor(Number(page.at(-1)!.candidate.id)) : undefined);
  }
  async mergeRecords(call: Readonly<{ input: Readonly<{ targetObjectType: MergeTarget; winnerId: number; winnerExpectedRevision: number; loserId: number; loserExpectedRevision: number; expectedAuthorizationRevision: number }> }>) {
    const input = call.input;
    await this.fence(["sales.records.merge", readPermission(input.targetObjectType)]); if (input.expectedAuthorizationRevision !== this.durable.authorizationRevision || input.winnerId === input.loserId || input.targetObjectType === "sales.object.contact" && !this.durable.fieldGrants?.some((field) => field === "sales.object.contact:email" || field === "sales.object.contact:phone")) actionError("ACTION_FORBIDDEN", 403, "Sales merge authority is invalid.");
    const transaction = await this.tx(); const tableName = tableFor(input.targetObjectType); const scope = scopeSql(this.durable, "r");
    const query = tableName === "sales_accounts" ? sql`SELECT id,revision,status,name,owner_id,team_id,audit FROM sales_accounts r WHERE id IN (${input.winnerId},${input.loserId}) AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND ${scope} ORDER BY id FOR UPDATE`
      : sql`SELECT id,revision,status,email,phone,account_id,owner_id,team_id,audit FROM sales_contacts r WHERE id IN (${input.winnerId},${input.loserId}) AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND ${scope} ORDER BY id FOR UPDATE`;
    const locked = rows(await transaction.execute(query)); const winner = locked.find((entry) => Number(entry.id) === input.winnerId); const loser = locked.find((entry) => Number(entry.id) === input.loserId);
    if (winner === undefined || loser === undefined || winner.status !== "active" || loser.status !== "active") actionError("ACTION_FORBIDDEN", 403, "Sales merge records are unavailable.");
    if (winner.revision !== input.winnerExpectedRevision || loser.revision !== input.loserExpectedRevision) actionError("STALE_RECORD", 409, "Sales merge record is stale.");
    const matchKind = this.match(input.targetObjectType, winner, loser); if (matchKind === null || input.targetObjectType === "sales.object.contact" && winner.account_id !== loser.account_id) actionError("ACTION_FORBIDDEN", 403, "Sales records are not an authorized duplicate pair.");
    if (input.targetObjectType === "sales.object.contact") {
      const account = rows(await transaction.execute(sql`SELECT id FROM sales_accounts r WHERE id=${winner.account_id} AND application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND status='active' AND ${scope} FOR SHARE`))[0];
      if (account === undefined) actionError("ACTION_FORBIDDEN", 403, "Sales merge account is unavailable.");
    }
    const winnerPreDigest = digest(winner); const loserPreDigest = digest(loser); const committedAt = now(); const lineageId = `merge-${randomUUID()}`;
    const relationCounts: Array<{ relationId: string; count: number }> = [];
    const rewrite = async (relationId: string, statement: ReturnType<typeof sql>) => { const count = rows(await transaction.execute(statement)).length; relationCounts.push({ relationId, count }); };
    if (input.targetObjectType === "sales.object.account") {
      await rewrite("sales_contacts.account_id", sql`UPDATE sales_contacts SET account_id=${input.winnerId} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND account_id=${input.loserId} RETURNING id`);
      await rewrite("sales_opportunities.account_id", sql`UPDATE sales_opportunities SET account_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND account_id=${String(input.loserId)} RETURNING id`);
      await rewrite("sales_leads.qualified_account_id", sql`UPDATE sales_leads SET qualified_account_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND qualified_account_id=${String(input.loserId)} RETURNING id`);
      for (const [name, relation] of [["sales_activities", "sales_activities.related_record_id where related_record_type=sales.account"], ["sales_notes", "sales_notes.related_record_id where related_record_type=sales.account"], ["sales_attachment_references", "sales_attachment_references.related_record_id where related_record_type=sales.account"], ["sales_tasks", "sales_tasks.related_record_id where related_record_type=sales.account"]] as const) {
        const statement = name === "sales_activities" ? sql`UPDATE sales_activities SET related_record_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND related_record_type='sales.account' AND related_record_id=${String(input.loserId)} RETURNING id`
          : name === "sales_notes" ? sql`UPDATE sales_notes SET related_record_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND related_record_type='sales.account' AND related_record_id=${String(input.loserId)} RETURNING id`
            : name === "sales_attachment_references" ? sql`UPDATE sales_attachment_references SET related_record_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND related_record_type='sales.account' AND related_record_id=${String(input.loserId)} RETURNING id`
              : sql`UPDATE sales_tasks SET related_record_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND related_record_type='sales.account' AND related_record_id=${String(input.loserId)} RETURNING id`;
        await rewrite(relation, statement);
      }
    } else {
      await rewrite("sales_opportunities.primary_contact_id", sql`UPDATE sales_opportunities SET primary_contact_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND primary_contact_id=${String(input.loserId)} RETURNING id`);
      await rewrite("sales_leads.qualified_contact_id", sql`UPDATE sales_leads SET qualified_contact_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND qualified_contact_id=${String(input.loserId)} RETURNING id`);
      for (const [name, relation] of [["sales_activities", "sales_activities.related_record_id where related_record_type=sales.contact"], ["sales_notes", "sales_notes.related_record_id where related_record_type=sales.contact"], ["sales_attachment_references", "sales_attachment_references.related_record_id where related_record_type=sales.contact"], ["sales_tasks", "sales_tasks.related_record_id where related_record_type=sales.contact"]] as const) {
        const statement = name === "sales_activities" ? sql`UPDATE sales_activities SET related_record_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND related_record_type='sales.contact' AND related_record_id=${String(input.loserId)} RETURNING id`
          : name === "sales_notes" ? sql`UPDATE sales_notes SET related_record_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND related_record_type='sales.contact' AND related_record_id=${String(input.loserId)} RETURNING id`
            : name === "sales_attachment_references" ? sql`UPDATE sales_attachment_references SET related_record_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND related_record_type='sales.contact' AND related_record_id=${String(input.loserId)} RETURNING id`
              : sql`UPDATE sales_tasks SET related_record_id=${String(input.winnerId)} WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND related_record_type='sales.contact' AND related_record_id=${String(input.loserId)} RETURNING id`;
        await rewrite(relation, statement);
      }
    }
    const winnerPostRevision = input.winnerExpectedRevision + 1; const loserPostRevision = input.loserExpectedRevision + 1;
    const lineageBase = { lineageId, applicationId: this.durable.context.applicationId, environment: this.durable.context.environment, targetObjectType: input.targetObjectType, winnerId: input.winnerId, winnerPreRevision: input.winnerExpectedRevision, winnerPostRevision, loserId: input.loserId, loserPreRevision: input.loserExpectedRevision, loserPostRevision, matchKind, normalizerVersion: "node24.19-unicode17-v1", actorId: this.durable.context.actorId, authorizationRevision: this.durable.authorizationRevision, winnerPreDigest, loserPreDigest, rewrittenRelationCounts: relationCounts, committedAt };
    const winnerTransition = createSalesMergeAuditTransition({ resourceId: String(input.winnerId), applicationId: this.durable.context.applicationId, environment: this.durable.context.environment, actorId: this.durable.context.actorId, idempotencyKey: `${lineageId}-survivor`, occurredAt: committedAt, preRevision: input.winnerExpectedRevision, role: "survivor", lineageId });
    const loserTransition = createSalesMergeAuditTransition({ resourceId: String(input.loserId), applicationId: this.durable.context.applicationId, environment: this.durable.context.environment, actorId: this.durable.context.actorId, idempotencyKey: `${lineageId}-merged`, occurredAt: committedAt, preRevision: input.loserExpectedRevision, role: "merged", lineageId });
    const winnerAudit = [...(winner.audit as unknown[]), winnerTransition];
    const loserAudit = [...(loser.audit as unknown[]), loserTransition];
    const winnerUpdated = rows(await transaction.execute(tableName === "sales_accounts" ? sql`UPDATE sales_accounts SET revision=${winnerPostRevision},updated_by=${this.durable.context.actorId},audit=${JSON.stringify(winnerAudit)}::jsonb,updated_at=now() WHERE id=${input.winnerId} AND revision=${input.winnerExpectedRevision} RETURNING *` : sql`UPDATE sales_contacts SET revision=${winnerPostRevision},updated_by=${this.durable.context.actorId},audit=${JSON.stringify(winnerAudit)}::jsonb,updated_at=now() WHERE id=${input.winnerId} AND revision=${input.winnerExpectedRevision} RETURNING *`))[0]!;
    const loserUpdated = rows(await transaction.execute(tableName === "sales_accounts" ? sql`UPDATE sales_accounts SET revision=${loserPostRevision},status='merged',merged_into_id=${String(input.winnerId)},merge_lineage=${JSON.stringify({ lineageId })}::jsonb,updated_by=${this.durable.context.actorId},audit=${JSON.stringify(loserAudit)}::jsonb,updated_at=now() WHERE id=${input.loserId} AND revision=${input.loserExpectedRevision} RETURNING *` : sql`UPDATE sales_contacts SET revision=${loserPostRevision},status='merged',merged_into_id=${String(input.winnerId)},merge_lineage=${JSON.stringify({ lineageId })}::jsonb,updated_by=${this.durable.context.actorId},audit=${JSON.stringify(loserAudit)}::jsonb,updated_at=now() WHERE id=${input.loserId} AND revision=${input.loserExpectedRevision} RETURNING *`))[0]!;
    const winnerPostDigest = digest(winnerUpdated); const loserPostDigest = digest(loserUpdated); const lineage = { ...lineageBase, winnerPostDigest, loserPostDigest }; const lineageDigest = digest(lineage);
    await transaction.execute(sql`INSERT INTO sales_merge_lineage(lineage_id,application_id,environment,target_object_type,winner_id,winner_pre_revision,winner_post_revision,loser_id,loser_pre_revision,loser_post_revision,match_kind,normalizer_version,actor_id,authorization_revision,winner_pre_digest,winner_post_digest,loser_pre_digest,loser_post_digest,rewritten_relation_counts,lineage_digest,committed_at)
      VALUES(${lineageId},${this.durable.context.applicationId},${this.durable.context.environment},${input.targetObjectType},${input.winnerId},${input.winnerExpectedRevision},${winnerPostRevision},${input.loserId},${input.loserExpectedRevision},${loserPostRevision},${matchKind},'node24.19-unicode17-v1',${this.durable.context.actorId},${this.durable.authorizationRevision},${winnerPreDigest},${winnerPostDigest},${loserPreDigest},${loserPostDigest},${JSON.stringify(relationCounts)}::jsonb,${lineageDigest},${committedAt})`);
    await this.audit("sales.merge.commit", "winner", String(input.winnerId), { ...lineage, lineageDigest, resource: "winner" }); await this.audit("sales.merge.commit", "loser", String(input.loserId), { ...lineage, lineageDigest, resource: "loser" });
    await this.objectOutbox(input.targetObjectType, String(input.winnerId), winnerPostRevision, winnerTransition.idempotencyKey, committedAt, lineageId);
    return Object.freeze({ lineageId, lineageDigest, winnerId: input.winnerId, winnerRevision: winnerPostRevision, loserId: input.loserId, loserRevision: loserPostRevision, matchKind, rewrittenRelationCounts: Object.freeze(relationCounts) });
  }
  private async jobs(kind: "import" | "export", selectedFields: readonly string[]) {
    const transaction = await this.tx(); const result = kind === "import" ? rows(await transaction.execute(sql`SELECT id,target_object_type,state,accepted_rows,rejected_rows,revision FROM sales_import_jobs WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND actor_id=${this.durable.context.actorId} ORDER BY id DESC LIMIT 100`)) : rows(await transaction.execute(sql`SELECT id,target_object_type,state,row_count,revision FROM sales_export_jobs WHERE application_id=${this.durable.context.applicationId} AND environment=${this.durable.context.environment} AND actor_id=${this.durable.context.actorId} ORDER BY id DESC LIMIT 100`));
    return table(selectedFields, result.map((entry) => Object.freeze({ id: entry.id, "target-object-type": entry.target_object_type, state: entry.state, "accepted-rows": entry.accepted_rows, "rejected-rows": entry.rejected_rows, "row-count": entry.row_count, revision: entry.revision })));
  }
  private async audit(actionId: string, resourceType: string, resourceId: string, evidence: unknown) { const transaction = await this.tx(); const auditId = `audit-${randomUUID()}`; await transaction.execute(sql`INSERT INTO sales_data_movement_audit(audit_id,application_id,environment,actor_id,action_id,resource_type,resource_id,evidence,digest) VALUES(${auditId},${this.durable.context.applicationId},${this.durable.context.environment},${this.durable.context.actorId},${actionId},${resourceType},${resourceId},${JSON.stringify(evidence)}::jsonb,${digest(evidence)})`); }
  private async jobAudit(kind: "import" | "export", actionId: "sales.import.commit" | "sales.import.cancel" | "sales.export.create" | "sales.export.cancel", job: Row, fromState: string, toState: string, publishEvent: boolean) {
    const transaction = await this.tx(); const jobId = safeId(job.id); const occurredAt = now(); const idempotencyKey = `${kind}-job-${jobId}-revision-${Number(job.revision)}`;
    if (!publishEvent) {
      await this.audit(actionId, `${kind}-job`, String(jobId), Object.freeze({ kind, jobId, state: String(job.state), revision: Number(job.revision), authorizationRevision: Number(job.authorization_revision), lifecycleRevision: Number(job.lifecycle_revision), scopeRevision: Number(job.scope_revision) }));
      return;
    }
    const audit = createSalesDataMovementJobAudit({ kind, jobId, actionId, applicationId: String(job.application_id), environment: String(job.environment), fromState, toState, occurredAt, actorId: String(job.actor_id), revision: Number(job.revision), idempotencyKey });
    await transaction.execute(sql`INSERT INTO sales_data_movement_audit(audit_id,application_id,environment,actor_id,action_id,resource_type,resource_id,evidence,digest) VALUES(${`audit-${randomUUID()}`},${job.application_id},${job.environment},${job.actor_id},${actionId},${`${kind}-job`},${String(jobId)},${JSON.stringify(audit)}::jsonb,${digest(audit)})`);
    const outbox = createSalesDataMovementJobOutbox({ ...audit, targetObjectType: job.target_object_type as Target, authorizationRevision: Number(job.authorization_revision), lifecycleRevision: Number(job.lifecycle_revision), scopeRevision: Number(job.scope_revision) }); await transaction.execute(sql`INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,idempotency_key,payload,retention_until) VALUES(${randomUUID()},${outbox.type},1,'durable-integration',${occurredAt},${job.application_id},'module.sales',${job.actor_id},'user',${idempotencyKey},${idempotencyKey},${JSON.stringify(outbox.payload)}::jsonb,${new Date(Date.now()+31_536_000_000).toISOString()}) ON CONFLICT DO NOTHING`);
  }
  private async objectOutbox(target: MergeTarget, resourceId: string, revision: number, idempotencyKey: string, occurredAt: string, lineageId: string) { const transaction = await this.tx(); await transaction.execute(sql`INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,idempotency_key,payload,retention_until) VALUES(${randomUUID()},${salesDataMovementObjectEvent(target)},1,'durable-integration',${occurredAt},${this.durable.context.applicationId},'module.sales',${this.durable.context.actorId},'user',${idempotencyKey},${idempotencyKey},${JSON.stringify({ environment: this.durable.context.environment, winnerId: Number(resourceId), revision, lineageId })}::jsonb,${new Date(Date.now()+31_536_000_000).toISOString()}) ON CONFLICT DO NOTHING`); }
}

function empty(fields: readonly string[]) { return table(fields, []); }
const cellKind = (field: string) => field === "artifact-id" ? "resource" : field === "target-object-type" || field === "diagnostic-code" || field === "match-kind" ? "enum" : field === "state" ? "status" : field === "artifact-expires-at" ? "datetime" : "integer";
function cell(field: string, value: unknown) {
  if (value === null || value === undefined) return null;
  const kind = cellKind(field);
  if (kind === "resource") return Object.freeze({ kind, resourceType: "sales.export-artifact", id: String(value), label: String(value), route: Object.freeze({ routeId: "sales.route.exports", params: Object.freeze({}) }) });
  if (kind === "datetime") { const instant = new Date(String(value)); if (Number.isNaN(instant.valueOf())) throw new Error("Data-movement datetime cell is invalid."); return Object.freeze({ kind, value: instant.toISOString() }); }
  if (kind !== "integer") return Object.freeze({ kind, value });
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^(?:0|[1-9][0-9]{0,15})$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Data-movement integer cell is invalid.");
  return Object.freeze({ kind, value: parsed });
}
function table(fields: readonly string[], values: readonly Readonly<Record<string, unknown>>[], nextCursor?: string) { return Object.freeze({ fields: [...fields], rows: values.map((value, index) => Object.freeze({ key: String(value.id ?? value["candidate-id"] ?? index + 1), values: Object.fromEntries(fields.map((field) => [field, cell(field, value[field])])) })), page: Object.freeze({ number: 1, pageSize: 100, hasNext: nextCursor !== undefined, ...(nextCursor === undefined ? {} : { nextCursor }) }) }); }

export async function readGeneratedSalesExportArtifact(database: Readonly<{ query<T extends Row = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }>, authority: Readonly<{ applicationId: string; environment: string; actorId: string; authorizationRevision: number; lifecycleRevision: number; scopeRevision: number; fieldGrants: readonly string[]; permissionGrants: readonly string[] }>, artifactId: string) {
  const artifact = (await database.query(`SELECT a.bytes,a.digest artifact_storage_digest,a.byte_length,a.content_type,a.expires_at,j.* FROM sales_export_artifacts a JOIN sales_export_jobs j ON j.id=a.export_job_id WHERE a.artifact_id=$1 AND j.application_id=$2 AND j.environment=$3 AND j.actor_id=$4 AND j.state='succeeded' FOR SHARE OF a,j`, [artifactId, authority.applicationId, authority.environment, authority.actorId])).rows[0];
  if (artifact === undefined) throw new Error("ARTIFACT_FORBIDDEN");
  if (!(artifact.expires_at instanceof Date) || artifact.expires_at.getTime() <= Date.now() || !(artifact.bytes instanceof Uint8Array)) throw new Error("ARTIFACT_EXPIRED");
  const target = artifact.target_object_type;
  if (target !== "sales.object.lead" && target !== "sales.object.account" && target !== "sales.object.contact" || artifact.source_id !== sourceFor(target) || artifact.source_version !== 1 || artifact.source_schema_version !== 1 || artifact.source_hash !== exportSourceHashes[target] || !validExportSelection(target, artifact.selected_fields) || !hasPermissions(artifact.permission_grants, requiredExportPermissions(target)) || !hasPermissions(authority.permissionGrants, requiredExportPermissions(target)) || artifact.authorization_revision !== authority.authorizationRevision || artifact.lifecycle_revision !== authority.lifecycleRevision || artifact.scope_revision !== authority.scopeRevision || artifact.selected_fields.some((field: string) => protectedFields.has(field) && (!(artifact.field_grants as unknown[]).includes(`${target}:${field}`) || !authority.fieldGrants.includes(`${target}:${field}`))) || sha256(artifact.bytes) !== artifact.artifact_digest || artifact.artifact_digest !== artifact.artifact_storage_digest || Number(artifact.byte_length) !== artifact.bytes.byteLength) throw new Error("ARTIFACT_FORBIDDEN");
  const table = tableFor(target);
  const snapshots = (await database.query(`SELECT x.ordinal,x.record_id,x.record_revision,x.row_digest FROM sales_export_snapshot_rows x JOIN ${table} r ON r.id=x.record_id AND r.revision=x.record_revision AND r.application_id=$2 AND r.environment=$3 JOIN sales_current_authority_scopes s ON s.application_id=r.application_id AND s.environment=r.environment AND s.principal_id=$4 AND s.state='active' AND s.revision=$7 JOIN k_nex_authorization_state a ON a.application_id=r.application_id AND a.authorization_revision=$5 AND a.lifecycle_revision=$6 WHERE x.export_job_id=$1 AND (s.record_scope='application-sales-scope' OR (s.record_scope='explicit-application-or-team-scope' AND s.application_wide) OR (s.record_scope='explicit-application-or-team-scope' AND r.team_id IN (SELECT jsonb_array_elements_text(s.authorized_team_ids))) OR (s.record_scope IN ('owned-or-assigned-team','managed-teams-and-own') AND (r.owner_id=$4 OR r.team_id IN (SELECT jsonb_array_elements_text(s.authorized_team_ids))))) ORDER BY x.ordinal FOR SHARE OF x,r,s,a`, [artifact.id, authority.applicationId, authority.environment, authority.actorId, authority.authorizationRevision, authority.lifecycleRevision, authority.scopeRevision])).rows;
  const snapshotDigest = digest(snapshots.map(({ record_id, record_revision, row_digest }) => ({ recordId: Number(record_id), recordRevision: Number(record_revision), authorizedRedactedRowDigest: row_digest })));
  if (snapshots.length !== Number(artifact.row_count) || snapshotDigest !== artifact.snapshot_digest) throw new Error("ARTIFACT_FORBIDDEN");
  return Object.freeze({ bytes: artifact.bytes, contentType: String(artifact.content_type) });
}

export function createSalesDataMovementEndpoints(authority: FixtureCurrentAuthority): readonly Endpoint[] {
  const upload: Endpoint = { method: "post", path: "/k-nex/sales/import-upload", handler: async (request) => {
    let body: { artifactId?: unknown; bytesBase64?: unknown; contentType?: unknown } = {}; try { body = await boundedUploadBody(request as unknown as Request); } catch (error) { const code = error instanceof RangeError ? "IMPORT_LIMIT_EXCEEDED" : "IMPORT_UPLOAD_BINDING_INVALID"; return Response.json({ code, status: 400 }, { status: 400 }); }
    if (typeof body.artifactId !== "string" || body.artifactId.length < 1 || body.artifactId.length > 128 || typeof body.bytesBase64 !== "string" || body.contentType !== "text/csv") return Response.json({ code: "IMPORT_UPLOAD_BINDING_INVALID", status: 400 }, { status: 400 });
    let bytes: Buffer; try { bytes = Buffer.from(body.bytesBase64, "base64"); if (bytes.toString("base64").replaceAll("=", "") !== body.bytesBase64.replaceAll("=", "")) throw new Error(); } catch { return Response.json({ code: "IMPORT_INVALID_ENCODING", status: 400 }, { status: 400 }); }
    if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) bytes = bytes.subarray(3);
    if (bytes.length < 1 || bytes.length > 16_777_216) return Response.json({ code: "IMPORT_LIMIT_EXCEEDED", status: 400 }, { status: 400 });
    try {
      const durable = await authority.resolveDurableSalesAuthority(request, "sales-import-upload"); const transaction = await activePayloadPostgresTransaction(request); const uploadDigest = sha256(bytes);
      // The upload itself is durable customer data. Resolve-time authority is only
      // advisory: admission must lock the current permission, scope, lifecycle,
      // and deployment facts in the same statement that creates the artifact.
      const admitted = rows(await transaction.execute(sql`
        WITH current_upload_admission AS MATERIALIZED (
          SELECT 1
          FROM k_nex_authorization_state authorization_state
          JOIN sales_current_authority_scopes scope
            ON scope.application_id=authorization_state.application_id
          JOIN k_nex_role_assignments assignment
            ON assignment.application_id=authorization_state.application_id
          JOIN k_nex_role_permission_grants permission_grant
            ON permission_grant.application_id=assignment.application_id AND permission_grant.role_id=assignment.role_id
          JOIN k_nex_extension_authorization_generations generation
            ON generation.application_id=permission_grant.application_id
              AND generation.delivery_class=permission_grant.owner_delivery_class
              AND generation.extension_id=permission_grant.owner_extension_id
              AND generation.authorization_generation=permission_grant.owner_generation
          WHERE authorization_state.application_id=${durable.context.applicationId}
            AND authorization_state.authorization_revision=${durable.authorizationRevision}
            AND authorization_state.lifecycle_revision=${durable.lifecycleRevision}
            AND scope.environment=${durable.context.environment}
            AND scope.principal_id=${durable.context.actorId}
            AND scope.state='active'
            AND scope.mutation_allowed=true
            AND scope.revision=${durable.scopeRevision}
            AND assignment.subject_kind='user'
            AND assignment.subject_id=${durable.context.actorId}
            AND assignment.state='active'
            AND permission_grant.permission_id='sales.imports.execute'
            AND permission_grant.owner_kind='extension'
            AND permission_grant.owner_delivery_class='platform-plugin'
            AND permission_grant.owner_extension_id='module.sales'
            AND generation.state='current'
            AND generation.authorization_generation=${durable.moduleSalesAuthorizationGeneration}
            AND generation.runtime_generation_ids=${JSON.stringify(durable.moduleSalesRuntimeGenerationIds)}::jsonb
            AND generation.authorization_revision=authorization_state.authorization_revision
            AND generation.lifecycle_revision=authorization_state.lifecycle_revision
            AND NOT EXISTS (
              SELECT 1
              FROM k_nex_permission_catalog_snapshots catalog_snapshot
              WHERE catalog_snapshot.application_id=authorization_state.application_id
                AND catalog_snapshot.owner_kind='extension'
                AND catalog_snapshot.owner_delivery_class=generation.delivery_class
                AND catalog_snapshot.owner_extension_id=generation.extension_id
                AND catalog_snapshot.owner_generation=generation.authorization_generation
                AND catalog_snapshot.state IN ('inactive-extension-disabled','inactive-extension-not-ready')
            )
          LIMIT 1
          FOR SHARE OF authorization_state,scope,assignment,permission_grant,generation
        )
        INSERT INTO sales_import_uploads(artifact_id,application_id,environment,actor_id,bytes,digest,byte_length,expires_at)
        SELECT ${body.artifactId},${durable.context.applicationId},${durable.context.environment},${durable.context.actorId},${bytes},${uploadDigest},${bytes.length},now()+interval '30 days'
        FROM current_upload_admission
        RETURNING artifact_id
      `));
      if (admitted.length !== 1) return Response.json({ code: "ACTION_FORBIDDEN", status: 403 }, { status: 403 });
      return Response.json({ uploadArtifactId: body.artifactId, sha256: uploadDigest, byteLength: bytes.length, contentType: "text/csv" }, { status: 201 });
    } catch (error) {
      const authorityUnavailable = error instanceof TypeError && (error.message === "Durable Sales authority is unavailable." || error.message === "Static Sales process identity is unavailable." || error.message === "Static Sales authorization generation is unavailable.");
      const status = error instanceof ActionGatewayError ? error.status : authorityUnavailable ? 403 : 400;
      return Response.json({ code: error instanceof ActionGatewayError ? error.code : authorityUnavailable ? "ACTION_FORBIDDEN" : "IMPORT_UPLOAD_BINDING_INVALID", status }, { status });
    }
  } };
  const download: Endpoint = { method: "get", path: "/k-nex/sales/export-artifact", handler: async (request) => {
    const artifactId = new URL(request.url ?? "http://localhost/").searchParams.get("artifactId"); if (artifactId === null) return Response.json({ code: "NOT_FOUND", status: 404 }, { status: 404 });
    try {
      const durable = await authority.resolveDurableSalesAuthority(request, "sales-export-download"); const transaction = await activePayloadPostgresTransaction(request);
      const artifact = rows(await transaction.execute(sql`SELECT a.bytes,a.digest artifact_storage_digest,a.byte_length,a.content_type,a.expires_at,j.id export_job_id,j.actor_id,j.authorization_revision,j.lifecycle_revision,j.scope_revision,j.target_object_type,j.source_id,j.source_version,j.source_schema_version,j.source_hash,j.selected_fields,j.permission_grants,j.snapshot_digest,j.artifact_digest,j.row_count FROM sales_export_artifacts a JOIN sales_export_jobs j ON j.id=a.export_job_id WHERE a.artifact_id=${artifactId} AND j.application_id=${durable.context.applicationId} AND j.environment=${durable.context.environment} AND j.actor_id=${durable.context.actorId} AND j.state='succeeded' FOR SHARE OF a,j`))[0];
      if (artifact === undefined) return Response.json({ code: "ARTIFACT_FORBIDDEN", status: 403 }, { status: 403 });
      if (!(artifact.expires_at instanceof Date) || artifact.expires_at.getTime() <= Date.now() || !(artifact.bytes instanceof Uint8Array)) return Response.json({ code: "ARTIFACT_EXPIRED", status: 410 }, { status: 410 });
      const target = artifact.target_object_type;
      if (target !== "sales.object.lead" && target !== "sales.object.account" && target !== "sales.object.contact" || artifact.source_id !== sourceFor(target) || artifact.source_version !== 1 || artifact.source_schema_version !== 1 || artifact.source_hash !== exportSourceHashes[target] || !validExportSelection(target, artifact.selected_fields) || !hasPermissions(artifact.permission_grants, requiredExportPermissions(target)) || artifact.authorization_revision !== durable.authorizationRevision || artifact.lifecycle_revision !== durable.lifecycleRevision || artifact.scope_revision !== durable.scopeRevision || sha256(artifact.bytes) !== artifact.artifact_digest || artifact.artifact_digest !== artifact.artifact_storage_digest || Number(artifact.byte_length) !== artifact.bytes.byteLength || !await authority.revalidateDurableSalesAuthority(request, durable)) return Response.json({ code: "ARTIFACT_FORBIDDEN", status: 403 }, { status: 403 });
      const descriptor = target === "sales.object.account" ? salesAccountsDescriptor : target === "sales.object.contact" ? salesContactsDescriptor : salesLeadsDescriptor;
      if (!await authority.adapter.allows(durable.context, authority.source(descriptor, "api"))) return Response.json({ code: "ARTIFACT_FORBIDDEN", status: 403 }, { status: 403 });
      for (const field of artifact.selected_fields as readonly string[]) if (protectedFields.has(field) && !await authority.adapter.allows(durable.context, authority.field(descriptor, field, "api"))) return Response.json({ code: "ARTIFACT_FORBIDDEN", status: 403 }, { status: 403 });
      const scope = scopeSql(durable, "r");
      const currentRows = rows(await transaction.execute(target === "sales.object.account"
        ? sql`SELECT x.ordinal FROM sales_export_snapshot_rows x JOIN sales_accounts r ON r.id=x.record_id AND r.revision=x.record_revision WHERE x.export_job_id=${artifact.export_job_id} AND r.application_id=${durable.context.applicationId} AND r.environment=${durable.context.environment} AND ${scope}`
        : target === "sales.object.contact"
          ? sql`SELECT x.ordinal FROM sales_export_snapshot_rows x JOIN sales_contacts r ON r.id=x.record_id AND r.revision=x.record_revision WHERE x.export_job_id=${artifact.export_job_id} AND r.application_id=${durable.context.applicationId} AND r.environment=${durable.context.environment} AND ${scope}`
          : sql`SELECT x.ordinal FROM sales_export_snapshot_rows x JOIN sales_leads r ON r.id=x.record_id AND r.revision=x.record_revision WHERE x.export_job_id=${artifact.export_job_id} AND r.application_id=${durable.context.applicationId} AND r.environment=${durable.context.environment} AND ${scope}`));
      const snapshots = rows(await transaction.execute(sql`SELECT ordinal,record_id,record_revision,row_digest FROM sales_export_snapshot_rows WHERE export_job_id=${artifact.export_job_id} ORDER BY ordinal FOR SHARE`));
      const snapshotDigest = digest(snapshots.map(({ record_id, record_revision, row_digest }) => ({ recordId: Number(record_id), recordRevision: Number(record_revision), authorizedRedactedRowDigest: row_digest })));
      if (currentRows.length !== Number(artifact.row_count) || snapshots.length !== Number(artifact.row_count) || snapshotDigest !== artifact.snapshot_digest) return Response.json({ code: "ARTIFACT_FORBIDDEN", status: 403 }, { status: 403 });
      return new Response(new Blob([Buffer.from(artifact.bytes)]), { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${artifactId}.csv"`, "cache-control": "no-store" } });
    } catch { return Response.json({ code: "ARTIFACT_FORBIDDEN", status: 403 }, { status: 403 }); }
  } };
  return Object.freeze([upload, download]);
}

export interface SalesDataMovementDatabase {
  connect(): Promise<{ query<T extends Row = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[]; rowCount?: number | null }>; release(): void }>;
}

async function currentWorkerAuthority(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, job: Row, mutation: boolean) {
  const current = (await client.query(`SELECT a.authorization_revision,a.lifecycle_revision,s.revision scope_revision,s.state,s.mutation_allowed
    FROM k_nex_authorization_state a JOIN sales_current_authority_scopes s ON s.application_id=a.application_id
    WHERE a.application_id=$1 AND s.environment=$2 AND s.principal_id=$3 FOR SHARE OF a,s`, [job.application_id, job.environment, job.actor_id])).rows[0];
  return current !== undefined && Number(current.authorization_revision) === Number(job.authorization_revision) && Number(current.lifecycle_revision) === Number(job.lifecycle_revision) && Number(current.scope_revision) === Number(job.scope_revision) && current.state === "active" && (!mutation || current.mutation_allowed === true);
}

/** Claims and executes at most one import chunk or export job. Repeated calls drain durable work. */
export async function processSalesDataMovement(database: SalesDataMovementDatabase, fence: SalesDataMovementWorkerFence, options: Readonly<{ leaseSeconds?: number; afterRowCommit?: (row: number) => void | Promise<void> }> = {}): Promise<"import" | "export" | "idle"> {
  if (!validWorkerFence(fence)) throw new TypeError("Worker fence is invalid."); const client = await database.connect(); const leaseSeconds = options.leaseSeconds ?? 30;
  try {
    await client.query("begin");
    await purgeExpiredDataMovement(client);
    const claim = await client.query(`SELECT c.import_job_id,c.chunk_index,c.row_start,c.row_end_exclusive,c.lease_revision,c.attempt,j.*
      FROM sales_import_chunks c JOIN sales_import_jobs j ON j.id=c.import_job_id
      JOIN runtime_worker_generation_fences f ON f.application_id=j.application_id AND f.environment=j.environment
      WHERE (c.state='queued' OR (c.state='claimed' AND c.lease_expires_at<=now())) AND j.state IN ('queued','running') AND j.expires_at>now()
        AND f.active_execution_generation=$1 AND f.fencing_token=$2 AND f.lease_owner=$3 AND f.promotion_revision=$4 AND f.lease_expires_at>now()
      ORDER BY c.import_job_id,c.chunk_index FOR UPDATE OF c,j SKIP LOCKED FOR SHARE OF f`, [fence.activeExecutionGeneration, fence.fencingToken, fence.leaseOwner, fence.promotionRevision]);
    if (claim.rows[0] !== undefined) {
      const selected = claim.rows[0]; const attempt = Number(selected.attempt) + 1;
      if (!await currentWorkerAuthority(client, selected, true) || !hasPermissions(selected.permission_grants, requiredImportPermissions(selected.target_object_type as Target))) { await beginTerminalFailure(client, "import", selected); await failImport(client, Number(selected.import_job_id), "ACTION_FORBIDDEN"); await client.query("commit"); return "import"; }
      if (attempt > 3) { await beginTerminalFailure(client, "import", selected); await failImport(client, Number(selected.import_job_id), "IMPORT_WORKER_RETRY_EXHAUSTED"); await client.query("commit"); return "import"; }
      const selectedMapping = Array.isArray(selected.mapping_canonical_json) ? selected.mapping_canonical_json as SalesImportMapping[] : [];
      if (validImportMapping(selected.target_object_type as Target, selectedMapping)) {
        const pending = await client.query("SELECT canonical_mapped_json FROM sales_import_rows WHERE import_job_id=$1 AND one_based_data_row>$2 AND one_based_data_row<=$3 AND outcome='pending' ORDER BY one_based_data_row FOR UPDATE", [selected.import_job_id, selected.row_start, selected.row_end_exclusive]);
        if (pending.rows.some(({ canonical_mapped_json }) => importValueCode(selected.target_object_type as Target, selectedMapping, canonical_mapped_json) === "IMPORT_VALUE_INVALID")) throw new Error("Sales import durable row schema is invalid.");
      }
      const claimed = await client.query(`UPDATE sales_import_chunks SET state='claimed',attempt=$3,worker_generation_id=$4,worker_fencing_token=$5,worker_promotion_revision=$6,worker_lease_owner=$7,lease_revision=lease_revision+1,lease_expires_at=now()+($8::text||' seconds')::interval WHERE import_job_id=$1 AND chunk_index=$2 AND lease_revision=$9 AND (state='queued' OR (state='claimed' AND lease_expires_at<=now())) RETURNING lease_revision`, [selected.import_job_id, selected.chunk_index, attempt, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner, leaseSeconds, selected.lease_revision]);
      if (claimed.rows.length !== 1) { await client.query("rollback"); return "idle"; }
      const running = (await client.query(`UPDATE sales_import_jobs SET state='running',revision=CASE WHEN state='queued' THEN revision+1 ELSE revision END,updated_at=now() WHERE id=$1 RETURNING *`, [selected.import_job_id])).rows[0]!;
      if (selected.state === "queued") await workerJobTransition(client, "import", "sales.import.commit", running, "queued", "running"); await client.query("commit");
      await executeImportChunk(client, Number(selected.import_job_id), Number(selected.chunk_index), fence, options.afterRowCommit); return "import";
    }
    const exportClaim = await client.query(`SELECT j.* FROM sales_export_jobs j
      JOIN runtime_worker_generation_fences f ON f.application_id=j.application_id AND f.environment=j.environment
      WHERE j.expires_at>now() AND (j.state='queued' OR (j.state='running' AND j.lease_expires_at<=now()))
        AND f.active_execution_generation=$1 AND f.fencing_token=$2 AND f.lease_owner=$3 AND f.promotion_revision=$4 AND f.lease_expires_at>now()
      ORDER BY j.id FOR UPDATE OF j SKIP LOCKED FOR SHARE OF f LIMIT 1`, [fence.activeExecutionGeneration, fence.fencingToken, fence.leaseOwner, fence.promotionRevision]);
    const selected = exportClaim.rows[0]; if (selected === undefined) { await client.query("commit"); return "idle"; }
    const attempt = Number(selected.attempt) + 1; if (!await currentWorkerAuthority(client, selected, false) || !hasPermissions(selected.permission_grants, requiredExportPermissions(selected.target_object_type as Target))) { await failExport(client, await beginTerminalFailure(client, "export", selected, fence), "ACTION_FORBIDDEN"); await client.query("commit"); return "export"; }
    if (attempt > 3) { await failExport(client, await beginTerminalFailure(client, "export", selected, fence)); await client.query("commit"); return "export"; }
    const claimed = await client.query(`UPDATE sales_export_jobs SET state='running',revision=CASE WHEN state='queued' THEN revision+1 ELSE revision END,attempt=$2,worker_generation_id=$3,worker_fencing_token=$4,worker_promotion_revision=$5,worker_lease_owner=$6,lease_revision=lease_revision+1,lease_expires_at=now()+($7::text||' seconds')::interval,updated_at=now() WHERE id=$1 AND lease_revision=$8 AND (state='queued' OR (state='running' AND lease_expires_at<=now())) RETURNING lease_revision`, [selected.id, attempt, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner, leaseSeconds, selected.lease_revision]);
    if (claimed.rows.length !== 1) { await client.query("rollback"); return "idle"; }
    const running = (await client.query("SELECT * FROM sales_export_jobs WHERE id=$1 FOR UPDATE", [selected.id])).rows[0]!; if (selected.state === "queued") await workerJobTransition(client, "export", "sales.export.create", running, "queued", "running"); await client.query("commit");
    await executeExport(client, selected, fence); return "export";
  } catch (error) { try { await client.query("rollback"); } catch {} throw error; } finally { client.release(); }
}

async function purgeExpiredDataMovement(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>) {
  await client.query("UPDATE sales_import_uploads SET bytes=NULL WHERE expires_at<=now() AND bytes IS NOT NULL");
  await client.query("UPDATE sales_import_jobs SET mapping_canonical_json=NULL,upload_artifact_id=NULL WHERE expires_at<=now() AND (mapping_canonical_json IS NOT NULL OR upload_artifact_id IS NOT NULL)");
  await client.query("UPDATE sales_import_rows r SET canonical_mapped_json=NULL FROM sales_import_jobs j WHERE r.import_job_id=j.id AND j.expires_at<=now() AND r.canonical_mapped_json IS NOT NULL");
  await client.query("UPDATE sales_import_diagnostics d SET column_name=NULL,public_message=NULL,artifact_offset=NULL FROM sales_import_jobs j WHERE d.job_id=j.id AND j.expires_at<=now() AND (d.column_name IS NOT NULL OR d.public_message IS NOT NULL OR d.artifact_offset IS NOT NULL)");
  await client.query("UPDATE sales_import_diagnostic_artifacts SET bytes=NULL WHERE expires_at<=now() AND bytes IS NOT NULL");
  await client.query("UPDATE sales_export_jobs SET query_canonical_json=NULL WHERE expires_at<=now() AND query_canonical_json IS NOT NULL");
  await client.query("UPDATE sales_export_snapshot_rows r SET row_json=NULL FROM sales_export_jobs j WHERE r.export_job_id=j.id AND j.expires_at<=now() AND r.row_json IS NOT NULL");
  await client.query("UPDATE sales_export_artifacts SET bytes=NULL WHERE expires_at<=now() AND bytes IS NOT NULL");
}

type SqlExecutor = Readonly<{ query(text: string, values?: readonly unknown[]): Promise<{ rows: readonly Row[] }> }>;
async function terminalReceipt(executor: Readonly<{ execute(statement: ReturnType<typeof sql>): Promise<unknown> }>, kind: "import" | "export", job: Row, evidence: Row) {
  const receiptId = String(job.receipt_id); const receiptDigest = digest(evidence); const table = kind === "import" ? sql`sales_import_receipts` : sql`sales_export_receipts`;
  await executor.execute(sql`INSERT INTO ${table}(receipt_id,job_id,evidence,digest) VALUES(${receiptId},${job.id},${JSON.stringify(evidence)}::jsonb,${receiptDigest}) ON CONFLICT(job_id) DO NOTHING`);
  const current = rows(await executor.execute(sql`SELECT receipt_id,digest FROM ${table} WHERE job_id=${job.id}`))[0];
  if (current?.receipt_id !== receiptId || current.digest !== receiptDigest) throw new Error("Sales terminal receipt conflict.");
}
async function workerTerminalReceipt(client: SqlExecutor, kind: "import" | "export", job: Row, evidence: Row) {
  const receiptId = String(job.receipt_id); const receiptDigest = digest(evidence); const table = kind === "import" ? "sales_import_receipts" : "sales_export_receipts";
  await client.query(`INSERT INTO ${table}(receipt_id,job_id,evidence,digest) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(job_id) DO NOTHING`, [receiptId, job.id, JSON.stringify(evidence), receiptDigest]);
  const current = (await client.query(`SELECT receipt_id,digest FROM ${table} WHERE job_id=$1`, [job.id])).rows[0];
  if (current?.receipt_id !== receiptId || current.digest !== receiptDigest) throw new Error("Sales terminal receipt conflict.");
}
async function workerJobTransition(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, kind: "import" | "export", actionId: "sales.import.commit" | "sales.export.create", job: Row, fromState: string, toState: string) {
  const jobId = safeId(job.id); const occurredAt = now(); const idempotencyKey = `${kind}-job-${jobId}-revision-${Number(job.revision)}`;
  const audit = createSalesDataMovementJobAudit({ kind, jobId, actionId, applicationId: String(job.application_id), environment: String(job.environment), fromState, toState, occurredAt, actorId: String(job.actor_id), revision: Number(job.revision), idempotencyKey });
  const outbox = createSalesDataMovementJobOutbox({ ...audit, targetObjectType: job.target_object_type as Target, authorizationRevision: Number(job.authorization_revision), lifecycleRevision: Number(job.lifecycle_revision), scopeRevision: Number(job.scope_revision) });
  await client.query("INSERT INTO sales_data_movement_audit(audit_id,application_id,environment,actor_id,action_id,resource_type,resource_id,evidence,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)", [`audit-${randomUUID()}`, job.application_id, job.environment, job.actor_id, actionId, `${kind}-job`, String(jobId), JSON.stringify(audit), digest(audit)]);
  await client.query("INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,idempotency_key,payload,retention_until) VALUES($1,$2,1,'durable-integration',$3,$4,'module.sales',$5,'user',$6,$6,$7::jsonb,$8) ON CONFLICT DO NOTHING", [randomUUID(), outbox.type, occurredAt, job.application_id, job.actor_id, idempotencyKey, JSON.stringify(outbox.payload), new Date(Date.now()+31_536_000_000).toISOString()]);
}
async function beginTerminalFailure(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, kind: "import" | "export", job: Row, fence?: SalesDataMovementWorkerFence): Promise<Row> {
  if (job.state !== "queued") return job;
  if (kind === "export" && fence === undefined) throw new Error("Sales export terminal failure fence is unavailable.");
  const running = kind === "import"
    ? (await client.query("UPDATE sales_import_jobs SET state='running',revision=revision+1,updated_at=now() WHERE id=$1 AND state='queued' RETURNING *", [job.id])).rows[0]
    : (await client.query("UPDATE sales_export_jobs SET state='running',revision=revision+1,attempt=LEAST(attempt+1,3),worker_generation_id=$2,worker_fencing_token=$3,worker_promotion_revision=$4,worker_lease_owner=$5,lease_revision=lease_revision+1,lease_expires_at=now()+interval '30 seconds',updated_at=now() WHERE id=$1 AND state='queued' RETURNING *", [job.id, fence!.activeExecutionGeneration, fence!.fencingToken, fence!.promotionRevision, fence!.leaseOwner])).rows[0];
  if (running === undefined) throw new Error("Sales terminal failure claim conflict.");
  await workerJobTransition(client, kind, kind === "import" ? "sales.import.commit" : "sales.export.create", running, "queued", "running");
  return running;
}
async function workerTerminalEvidence(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, job: Row, actionId: "sales.import.commit" | "sales.export.create", resourceType: "import-job" | "export-job", fromState: string, evidence: Row) {
  await workerTerminalReceipt(client, resourceType === "import-job" ? "import" : "export", job, evidence);
  await workerJobTransition(client, resourceType === "import-job" ? "import" : "export", actionId, job, fromState, String(evidence.state));
}
async function importTerminalEvidence(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, job: Row, terminal: Row, failureCode: string | null, artifact?: Readonly<{ artifactId: string; artifactDigest: string }>) {
  const chunkResultDigests = (await client.query("SELECT result_digest FROM sales_import_chunks WHERE import_job_id=$1 ORDER BY chunk_index FOR SHARE", [job.id])).rows.map(({ result_digest }) => result_digest ?? null);
  const diagnostics = (await client.query("SELECT one_based_data_row,code FROM sales_import_diagnostics WHERE job_id=$1 ORDER BY one_based_data_row FOR SHARE", [job.id])).rows;
  return terminalJobEvidence(job, { actionId: "sales.import.commit", actionVersion: 1, uploadDigest: job.upload_digest, mappingDigest: job.mapping_digest, schemaRevision: Number(job.schema_revision), rowCount: Number(job.row_count), acceptedRows: Number(terminal.accepted_rows), rejectedRows: Number(terminal.rejected_rows), chunkResultDigests, diagnosticDigest: diagnostics.length === 0 ? null : digest(diagnostics), diagnosticArtifactId: artifact?.artifactId ?? null, diagnosticArtifactDigest: artifact?.artifactDigest ?? job.diagnostic_digest ?? null, failureCode, state: terminal.state, revision: Number(terminal.revision) });
}
async function publishImportDiagnostics(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, jobId: number) {
  const diagnostics = (await client.query("SELECT one_based_data_row,code FROM sales_import_diagnostics WHERE job_id=$1 ORDER BY one_based_data_row", [jobId])).rows;
  if (diagnostics.length === 0) return undefined;
  const bytes = Buffer.from(buildSalesExportCsv(["one-based-data-row", "code"], diagnostics.map((entry) => ({ "one-based-data-row": entry.one_based_data_row, code: entry.code }))));
  const artifactId = `import-diagnostics-${randomUUID()}`; const artifactDigest = sha256(bytes);
  await client.query("INSERT INTO sales_import_diagnostic_artifacts(artifact_id,import_job_id,bytes,digest,byte_length,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 days')", [artifactId, jobId, bytes, artifactDigest, bytes.length]);
  await client.query("UPDATE sales_import_jobs SET diagnostic_artifact_id=$2,diagnostic_digest=$3 WHERE id=$1", [jobId, artifactId, artifactDigest]);
  return Object.freeze({ artifactId, artifactDigest });
}
async function failImport(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, jobId: number, code: string) {
  const job = (await client.query("SELECT * FROM sales_import_jobs WHERE id=$1 AND state IN ('queued','running') FOR UPDATE", [jobId])).rows[0]; if (job === undefined) return;
  await client.query("UPDATE sales_import_rows SET outcome='rejected',diagnostic_code=$2,canonical_mapped_json=NULL WHERE import_job_id=$1 AND outcome='pending'", [jobId, code]);
  await client.query("INSERT INTO sales_import_diagnostics(job_id,one_based_data_row,code,public_message) SELECT import_job_id,one_based_data_row,$2,'Imported row was rejected.' FROM sales_import_rows WHERE import_job_id=$1 AND diagnostic_code=$2 ON CONFLICT(job_id,one_based_data_row) DO NOTHING", [jobId, code]);
  await client.query("UPDATE sales_import_chunks SET state='failed',worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL WHERE import_job_id=$1 AND state IN ('queued','claimed')", [jobId]);
  const terminal = (await client.query(`UPDATE sales_import_jobs SET accepted_rows=(SELECT count(*) FROM sales_import_rows WHERE import_job_id=$1 AND outcome='accepted'),rejected_rows=(SELECT count(*) FROM sales_import_rows WHERE import_job_id=$1 AND outcome='rejected'),state=CASE WHEN EXISTS(SELECT 1 FROM sales_import_rows WHERE import_job_id=$1 AND outcome='accepted') THEN 'partially-failed' ELSE 'failed' END,revision=revision+1,updated_at=now() WHERE id=$1 AND state IN ('queued','running') RETURNING *`, [jobId])).rows[0];
  if (terminal !== undefined) { const artifact = await publishImportDiagnostics(client, jobId); await workerTerminalEvidence(client, terminal, "sales.import.commit", "import-job", String(job.state), await importTerminalEvidence(client, terminal, terminal, code, artifact)); }
}
async function failExport(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, job: Row, reason = "retry-exhausted") {
  const terminal = (await client.query("UPDATE sales_export_jobs SET state='failed',revision=revision+1,worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND state IN ('queued','running') AND ($2<>'retry-exhausted' OR attempt=3) RETURNING *", [job.id, reason])).rows[0];
  if (terminal !== undefined) await workerTerminalEvidence(client, terminal, "sales.export.create", "export-job", String(job.state), terminalJobEvidence(terminal, { actionId: "sales.export.create", sourceId: terminal.source_id, sourceVersion: terminal.source_version, sourceSchemaVersion: terminal.source_schema_version, sourceHash: terminal.source_hash, queryDigest: terminal.query_digest, selectedFields: terminal.selected_fields, snapshotDigest: terminal.snapshot_digest, snapshotRevision: terminal.snapshot_revision, rowCount: terminal.row_count, reason, state: terminal.state, revision: terminal.revision }));
}
async function executeImportChunk(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, jobId: number, chunkIndex: number, worker: SalesDataMovementWorkerFence, afterRowCommit?: (row: number) => void | Promise<void>) {
  const chunk = (await client.query("SELECT c.*,j.application_id,j.environment,j.actor_id,j.target_object_type,j.authorization_revision,j.lifecycle_revision,j.scope_revision,j.upload_artifact_id,j.upload_digest,j.mapping_canonical_json,j.mapping_digest,j.field_grants,j.permission_grants FROM sales_import_chunks c JOIN sales_import_jobs j ON j.id=c.import_job_id WHERE c.import_job_id=$1 AND c.chunk_index=$2", [jobId, chunkIndex])).rows[0]!;
  const mapping = Array.isArray(chunk.mapping_canonical_json) ? chunk.mapping_canonical_json as Row[] : [];
  if (!validImportMapping(chunk.target_object_type as Target, mapping) || digest(mapping) !== chunk.mapping_digest || !hasPermissions(chunk.permission_grants, requiredImportPermissions(chunk.target_object_type as Target)) || mapping.some((entry) => protectedFields.has(String(entry.fieldId)) && !(chunk.field_grants as unknown[]).includes(`${chunk.target_object_type}:${entry.fieldId}`))) {
    await client.query("begin"); await failImport(client, jobId, "ACTION_FORBIDDEN"); await client.query("commit"); return;
  }
  const inputRows = (await client.query("SELECT * FROM sales_import_rows WHERE import_job_id=$1 AND one_based_data_row>$2 AND one_based_data_row<=$3 ORDER BY one_based_data_row", [jobId, Number(chunk.row_start), Number(chunk.row_end_exclusive)])).rows;
  if (inputRows.some((entry) => entry.outcome === "pending" && importValueCode(chunk.target_object_type as Target, mapping as unknown as SalesImportMapping[], entry.canonical_mapped_json) === "IMPORT_VALUE_INVALID")) throw new Error("Sales import durable row schema is invalid.");
  for (const row of inputRows) {
    await client.query("begin");
    try {
      const currentRows = await client.query(`SELECT r.* FROM sales_import_rows r WHERE r.import_job_id=$1 AND r.one_based_data_row>$2 AND r.one_based_data_row<=$3 ORDER BY r.one_based_data_row FOR UPDATE`, [jobId, Number(chunk.row_start), Number(chunk.row_end_exclusive)]);
      const fence = await client.query(`SELECT s.record_scope,s.application_wide,s.authorized_team_ids,u.bytes,u.digest upload_storage_digest,j.target_object_type,j.mapping_canonical_json,j.mapping_digest,j.field_grants,j.permission_grants FROM sales_import_chunks c JOIN sales_import_jobs j ON j.id=c.import_job_id
        JOIN runtime_worker_generation_fences f ON f.application_id=j.application_id AND f.environment=j.environment JOIN k_nex_authorization_state a ON a.application_id=j.application_id
        JOIN sales_current_authority_scopes s ON s.application_id=j.application_id AND s.environment=j.environment AND s.principal_id=j.actor_id
        JOIN sales_import_uploads u ON u.artifact_id=j.upload_artifact_id AND u.application_id=j.application_id AND u.environment=j.environment AND u.actor_id=j.actor_id
        WHERE c.import_job_id=$1 AND c.chunk_index=$2 AND c.state='claimed' AND c.worker_generation_id=$3 AND c.worker_fencing_token=$4 AND c.worker_promotion_revision=$5 AND c.worker_lease_owner=$6 AND c.lease_revision=$7 AND c.lease_expires_at>now()
          AND f.active_execution_generation=$3 AND f.fencing_token=$4 AND f.promotion_revision=$5 AND f.lease_owner=$6 AND f.lease_expires_at>now()
          AND a.authorization_revision=j.authorization_revision AND a.lifecycle_revision=j.lifecycle_revision AND s.revision=j.scope_revision AND s.state='active' AND s.mutation_allowed=true
        FOR UPDATE OF c,j FOR SHARE OF f,a,s,u`, [jobId, chunkIndex, worker.activeExecutionGeneration, worker.fencingToken, worker.promotionRevision, worker.leaseOwner, chunk.lease_revision]);
      const live = fence.rows[0]; const liveMapping = Array.isArray(live?.mapping_canonical_json) ? live.mapping_canonical_json as SalesImportMapping[] : [];
      const integrity = live !== undefined && validImportMapping(chunk.target_object_type as Target, liveMapping) && digest(liveMapping) === live.mapping_digest && live.mapping_digest === chunk.mapping_digest &&
        hasPermissions(live.permission_grants, requiredImportPermissions(chunk.target_object_type as Target)) && !liveMapping.some((entry) => protectedFields.has(entry.fieldId) && !(live.field_grants as unknown[]).includes(`${chunk.target_object_type}:${entry.fieldId}`)) &&
        digest(currentRows.rows.map(({ one_based_data_row, row_digest, mapped_digest }) => ({ one_based_data_row, row_digest, mapped_digest }))) === chunk.input_digest &&
        currentRows.rows.every((entry) => entry.canonical_mapped_json === null ? entry.outcome !== "pending" : digest(entry.canonical_mapped_json) === entry.mapped_digest);
      if (fence.rows.length !== 1 || !integrity || !(fence.rows[0]!.bytes instanceof Uint8Array) || sha256(fence.rows[0]!.bytes as Uint8Array) !== chunk.upload_digest || fence.rows[0]!.upload_storage_digest !== chunk.upload_digest) {
        const currentGeneration = await client.query("SELECT 1 FROM runtime_worker_generation_fences WHERE application_id=$1 AND environment=$2 AND active_execution_generation=$3 AND fencing_token=$4 AND promotion_revision=$5 AND lease_owner=$6 AND lease_expires_at>now()", [chunk.application_id, chunk.environment, worker.activeExecutionGeneration, worker.fencingToken, worker.promotionRevision, worker.leaseOwner]);
        await client.query("rollback");
        if (currentGeneration.rows.length !== 1) return;
        await client.query("begin"); await failImport(client, jobId, "ACTION_FORBIDDEN"); await client.query("commit"); return;
      }
      const current = currentRows.rows.find((entry) => Number(entry.one_based_data_row) === Number(row.one_based_data_row))!;
      if (current.outcome !== "pending") { await client.query("commit"); continue; }
      const value = current.canonical_mapped_json as Row; let recordId: number | undefined; let code: string | undefined = importValueCode(chunk.target_object_type as Target, liveMapping, value);
      if (code === undefined) {
        await client.query("SAVEPOINT import_row_effect");
        try {
          if (chunk.target_object_type === "sales.object.contact") {
            const account = (await client.query(`SELECT r.id,r.owner_id,r.team_id FROM sales_accounts r JOIN sales_current_authority_scopes s ON s.application_id=r.application_id AND s.environment=r.environment AND s.principal_id=$4 AND s.state='active' AND s.revision=$5 WHERE r.id=$1 AND r.application_id=$2 AND r.environment=$3 AND r.status='active' AND (s.record_scope='application-sales-scope' OR (s.record_scope='explicit-application-or-team-scope' AND s.application_wide) OR (s.record_scope='explicit-application-or-team-scope' AND r.team_id IN (SELECT jsonb_array_elements_text(s.authorized_team_ids))) OR (s.record_scope IN ('owned-or-assigned-team','managed-teams-and-own') AND (r.owner_id=$4 OR r.team_id IN (SELECT jsonb_array_elements_text(s.authorized_team_ids)))) FOR SHARE OF r,s`, [value.accountId, chunk.application_id, chunk.environment, chunk.actor_id, chunk.scope_revision])).rows[0];
            if (account === undefined || typeof account.team_id !== "string") code = "IMPORT_CONTACT_ACCOUNT_FORBIDDEN";
            else { const inserted = await client.query("INSERT INTO sales_contacts(application_id,environment,owner_id,team_id,created_by,updated_by,audit,account_id,display_name,email,phone) VALUES($1,$2,$3,$4,$5,$5,'[]'::jsonb,$6,$7,$8,$9) RETURNING id", [chunk.application_id, chunk.environment, account.owner_id, account.team_id, chunk.actor_id, value.accountId, value.displayName, value.email ?? null, value.phone ?? null]); recordId = Number(inserted.rows[0]!.id); }
          } else if (chunk.target_object_type === "sales.object.account") {
            const inserted = await client.query("INSERT INTO sales_accounts(application_id,environment,owner_id,team_id,created_by,updated_by,audit,name) VALUES($1,$2,$3,$4,$3,$3,'[]'::jsonb,$5) RETURNING id", [chunk.application_id, chunk.environment, chunk.actor_id, `team:${chunk.actor_id}`, value.name]); recordId = Number(inserted.rows[0]!.id);
          } else {
            const inserted = await client.query("INSERT INTO sales_leads(application_id,environment,owner_id,team_id,created_by,updated_by,audit,display_name,source,email,phone) VALUES($1,$2,$3,$4,$3,$3,'[]'::jsonb,$5,$6,$7,$8) RETURNING id", [chunk.application_id, chunk.environment, chunk.actor_id, `team:${chunk.actor_id}`, value.displayName, value.source, value.email ?? null, value.phone ?? null]); recordId = Number(inserted.rows[0]!.id);
          }
          await client.query("RELEASE SAVEPOINT import_row_effect");
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT import_row_effect");
          if ((error as { readonly code?: string }).code !== "23505") throw error;
          code = "IMPORT_ROW_CONFLICT";
        }
      }
      if (code === undefined && recordId !== undefined) {
        const teamId = chunk.target_object_type === "sales.object.contact" ? String((await client.query("SELECT team_id FROM sales_contacts WHERE id=$1", [recordId])).rows[0]!.team_id) : `team:${chunk.actor_id}`;
        const genesis = createSalesImportGenesisAudit({ targetObjectType: chunk.target_object_type as Target, resourceId: String(recordId), applicationId: String(chunk.application_id), environment: String(chunk.environment), ownerId: chunk.target_object_type === "sales.object.contact" ? String((await client.query("SELECT owner_id FROM sales_contacts WHERE id=$1", [recordId])).rows[0]!.owner_id) : String(chunk.actor_id), teamId, actorId: String(chunk.actor_id), idempotencyKey: `import-${jobId}-row-${current.one_based_data_row}`, occurredAt: now(), importJobId: jobId, oneBasedDataRow: Number(current.one_based_data_row), rowDigest: String(current.row_digest) });
        await client.query(`UPDATE ${tableFor(chunk.target_object_type as Target)} SET audit=$2::jsonb WHERE id=$1`, [recordId, JSON.stringify([genesis])]);
        await client.query("INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,idempotency_key,payload,retention_until) VALUES($1,$2,1,'durable-integration',$3,$4,'module.sales',$5,'user',$6,$7,$8::jsonb,$9) ON CONFLICT DO NOTHING", [randomUUID(), salesDataMovementObjectEvent(chunk.target_object_type as Target), genesis.occurredAt, chunk.application_id, chunk.actor_id, genesis.idempotencyKey, genesis.idempotencyKey, JSON.stringify({ environment: chunk.environment, resourceId: String(recordId), revision: 1, importJobId: jobId, oneBasedDataRow: Number(current.one_based_data_row) }), new Date(Date.now() + 31_536_000_000).toISOString()]);
      }
      if (code === undefined) await client.query("UPDATE sales_import_rows SET outcome='accepted',target_record_id=$3,canonical_mapped_json=NULL WHERE import_job_id=$1 AND one_based_data_row=$2 AND outcome='pending'", [jobId, current.one_based_data_row, recordId]);
      else { await client.query("UPDATE sales_import_rows SET outcome='rejected',diagnostic_code=$3,canonical_mapped_json=NULL WHERE import_job_id=$1 AND one_based_data_row=$2 AND outcome='pending'", [jobId, current.one_based_data_row, code]); await client.query("INSERT INTO sales_import_diagnostics(job_id,one_based_data_row,code,public_message) VALUES($1,$2,$3,'Imported row was rejected.')", [jobId, current.one_based_data_row, code]); }
      await client.query("commit"); await afterRowCommit?.(Number(current.one_based_data_row));
    } catch (error) { await client.query("rollback"); throw error; }
  }
  await client.query("begin");
  try {
    const completionFence = await client.query(`SELECT 1 FROM sales_import_chunks c JOIN sales_import_jobs j ON j.id=c.import_job_id JOIN runtime_worker_generation_fences f ON f.application_id=j.application_id AND f.environment=j.environment JOIN k_nex_authorization_state a ON a.application_id=j.application_id JOIN sales_current_authority_scopes s ON s.application_id=j.application_id AND s.environment=j.environment AND s.principal_id=j.actor_id WHERE c.import_job_id=$1 AND c.chunk_index=$2 AND c.state='claimed' AND c.worker_generation_id=$3 AND c.worker_fencing_token=$4 AND c.worker_promotion_revision=$5 AND c.worker_lease_owner=$6 AND c.lease_revision=$7 AND c.lease_expires_at>now() AND f.active_execution_generation=$3 AND f.fencing_token=$4 AND f.promotion_revision=$5 AND f.lease_owner=$6 AND f.lease_expires_at>now() AND a.authorization_revision=j.authorization_revision AND a.lifecycle_revision=j.lifecycle_revision AND s.revision=j.scope_revision AND s.state='active' AND s.mutation_allowed=true FOR UPDATE OF c,j FOR SHARE OF f,a,s`, [jobId, chunkIndex, worker.activeExecutionGeneration, worker.fencingToken, worker.promotionRevision, worker.leaseOwner, chunk.lease_revision]);
    if (completionFence.rows.length !== 1) {
      const currentGeneration = await client.query("SELECT 1 FROM runtime_worker_generation_fences WHERE application_id=$1 AND environment=$2 AND active_execution_generation=$3 AND fencing_token=$4 AND promotion_revision=$5 AND lease_owner=$6 AND lease_expires_at>now()", [chunk.application_id, chunk.environment, worker.activeExecutionGeneration, worker.fencingToken, worker.promotionRevision, worker.leaseOwner]);
      await client.query("rollback");
      if (currentGeneration.rows.length !== 1) return;
      await client.query("begin"); await failImport(client, jobId, "ACTION_FORBIDDEN"); await client.query("commit"); return;
    }
    const resultDigest = digest((await client.query("SELECT one_based_data_row,row_digest,outcome,target_record_id,diagnostic_code FROM sales_import_rows WHERE import_job_id=$1 AND one_based_data_row>$2 AND one_based_data_row<=$3 ORDER BY one_based_data_row", [jobId, Number(chunk.row_start), Number(chunk.row_end_exclusive)])).rows);
    const completed = await client.query("UPDATE sales_import_chunks SET state='completed',completed_at=now(),result_digest=$8,worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL WHERE import_job_id=$1 AND chunk_index=$2 AND state='claimed' AND worker_generation_id=$3 AND worker_fencing_token=$4 AND worker_promotion_revision=$5 AND worker_lease_owner=$6 AND lease_revision=$7 AND lease_expires_at>now() RETURNING import_job_id", [jobId, chunkIndex, worker.activeExecutionGeneration, worker.fencingToken, worker.promotionRevision, worker.leaseOwner, chunk.lease_revision, resultDigest]); if (completed.rows.length !== 1) { await client.query("rollback"); return; }
    const remaining = Number((await client.query("SELECT count(*) count FROM sales_import_chunks WHERE import_job_id=$1 AND state<>'completed'", [jobId])).rows[0]!.count);
    if (remaining === 0) {
      const terminal = (await client.query(`UPDATE sales_import_jobs SET accepted_rows=(SELECT count(*) FROM sales_import_rows WHERE import_job_id=$1 AND outcome='accepted'),rejected_rows=(SELECT count(*) FROM sales_import_rows WHERE import_job_id=$1 AND outcome='rejected'),state=CASE WHEN EXISTS(SELECT 1 FROM sales_import_rows WHERE import_job_id=$1 AND outcome='rejected') THEN 'partially-failed' ELSE 'succeeded' END,revision=revision+1,updated_at=now() WHERE id=$1 AND state='running' RETURNING *`, [jobId])).rows[0];
      if (terminal !== undefined) { const artifact = Number(terminal.rejected_rows) > 0 ? await publishImportDiagnostics(client, jobId) : undefined; await workerTerminalEvidence(client, terminal, "sales.import.commit", "import-job", "running", await importTerminalEvidence(client, terminal, terminal, null, artifact)); }
    }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
}
async function assertWorkerExportFence(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, job: Row, worker: SalesDataMovementWorkerFence): Promise<readonly Row[]> {
  const target = job.target_object_type;
  if (target !== "sales.object.lead" && target !== "sales.object.account" && target !== "sales.object.contact" || job.source_id !== sourceFor(target) || job.source_version !== 1 || job.source_schema_version !== 1 || job.source_hash !== exportSourceHashes[target] || digest(job.query_canonical_json) !== job.query_digest || !validExportSelection(target, job.selected_fields) || !hasPermissions(job.permission_grants, requiredExportPermissions(target)) || job.selected_fields.some((field: string) => protectedFields.has(field) && !(job.field_grants as unknown[]).includes(`${target}:${field}`))) throw new Error("Sales export descriptor fence failed.");
  const table = tableFor(target);
  const result = await client.query(`SELECT x.* FROM sales_export_snapshot_rows x JOIN ${table} r ON r.id=x.record_id AND r.revision=x.record_revision AND r.application_id=$2 AND r.environment=$3 JOIN sales_current_authority_scopes s ON s.application_id=r.application_id AND s.environment=r.environment AND s.principal_id=$4 AND s.state='active' AND s.revision=$7 JOIN k_nex_authorization_state a ON a.application_id=r.application_id AND a.authorization_revision=$5 AND a.lifecycle_revision=$6 JOIN runtime_worker_generation_fences f ON f.application_id=r.application_id AND f.environment=r.environment AND f.active_execution_generation=$8 AND f.fencing_token=$9 AND f.lease_owner=$10 AND f.promotion_revision=$11 AND f.lease_expires_at>now() WHERE x.export_job_id=$1 AND (s.record_scope='application-sales-scope' OR (s.record_scope='explicit-application-or-team-scope' AND s.application_wide) OR (s.record_scope='explicit-application-or-team-scope' AND r.team_id IN (SELECT jsonb_array_elements_text(s.authorized_team_ids))) OR (s.record_scope IN ('owned-or-assigned-team','managed-teams-and-own') AND (r.owner_id=$4 OR r.team_id IN (SELECT jsonb_array_elements_text(s.authorized_team_ids))))) ORDER BY x.ordinal FOR UPDATE OF x FOR SHARE OF r,s,a,f`, [job.id, job.application_id, job.environment, job.actor_id, job.authorization_revision, job.lifecycle_revision, job.scope_revision, worker.activeExecutionGeneration, worker.fencingToken, worker.leaseOwner, worker.promotionRevision]);
  if (result.rows.length !== Number(job.row_count) || result.rows.some((entry) => entry.row_json === null || digest(entry.row_json) !== entry.row_digest)) throw new Error("Sales export row or authority fence failed.");
  const snapshotDigest = digest(result.rows.map(({ record_id, record_revision, row_digest }) => ({ recordId: Number(record_id), recordRevision: Number(record_revision), authorizedRedactedRowDigest: row_digest })));
  if (snapshotDigest !== job.snapshot_digest) throw new Error("Sales export snapshot digest failed.");
  return result.rows;
}
async function executeExport(client: Awaited<ReturnType<SalesDataMovementDatabase["connect"]>>, job: Row, worker: SalesDataMovementWorkerFence) {
  await client.query("begin");
  try {
    const locked = (await client.query("SELECT * FROM sales_export_jobs WHERE id=$1 AND state='running' AND worker_generation_id=$2 AND worker_fencing_token=$3 AND worker_promotion_revision=$4 AND worker_lease_owner=$5 AND lease_expires_at>now() FOR UPDATE", [job.id, worker.activeExecutionGeneration, worker.fencingToken, worker.promotionRevision, worker.leaseOwner])).rows[0]; if (locked === undefined) { await client.query("rollback"); return; }
    let snapshots: readonly Row[];
    try { snapshots = await assertWorkerExportFence(client, locked, worker); }
    catch {
      const failed = (await client.query("UPDATE sales_export_jobs SET state='failed',revision=revision+1,worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND state='running' AND worker_generation_id=$2 AND worker_fencing_token=$3 AND worker_promotion_revision=$4 AND worker_lease_owner=$5 AND lease_revision=$6 RETURNING *", [job.id, worker.activeExecutionGeneration, worker.fencingToken, worker.promotionRevision, worker.leaseOwner, locked.lease_revision])).rows[0];
      if (failed !== undefined) await workerTerminalEvidence(client, failed, "sales.export.create", "export-job", "running", terminalJobEvidence(failed, { actionId: "sales.export.create", sourceId: failed.source_id, sourceVersion: failed.source_version, sourceSchemaVersion: failed.source_schema_version, sourceHash: failed.source_hash, queryDigest: failed.query_digest, selectedFields: failed.selected_fields, snapshotDigest: failed.snapshot_digest, snapshotRevision: failed.snapshot_revision, rowCount: failed.row_count, reason: "authority-or-descriptor-fence", state: "failed", revision: failed.revision }));
      await client.query("commit"); return;
    }
    const fields = locked.selected_fields as string[]; const bytes = Buffer.from(buildSalesExportCsv(fields, snapshots.map((snapshot) => snapshot.row_json as Row)));
    if (bytes.length > 16_777_216) throw new Error("Sales export byte limit exceeded."); const artifactDigest = sha256(bytes); const artifactId = `artifact-${randomUUID()}`;
    await client.query("INSERT INTO sales_export_artifacts(artifact_id,export_job_id,bytes,digest,byte_length,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 days')", [artifactId, job.id, bytes, artifactDigest, bytes.length]);
    const completed = await client.query("UPDATE sales_export_jobs SET state='succeeded',revision=revision+1,artifact_id=$6,artifact_digest=$7,worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND state='running' AND worker_generation_id=$2 AND worker_fencing_token=$3 AND worker_promotion_revision=$4 AND worker_lease_owner=$5 AND lease_revision=$8 AND lease_expires_at>now() RETURNING *", [job.id, worker.activeExecutionGeneration, worker.fencingToken, worker.promotionRevision, worker.leaseOwner, artifactId, artifactDigest, locked.lease_revision]);
    if (completed.rows.length !== 1) throw new Error("Sales export completion fence failed.");
    await workerTerminalEvidence(client, completed.rows[0]!, "sales.export.create", "export-job", "running", terminalJobEvidence(completed.rows[0]!, { actionId: "sales.export.create", sourceId: completed.rows[0]!.source_id, sourceVersion: completed.rows[0]!.source_version, sourceSchemaVersion: completed.rows[0]!.source_schema_version, sourceHash: completed.rows[0]!.source_hash, queryDigest: completed.rows[0]!.query_digest, selectedFields: completed.rows[0]!.selected_fields, snapshotDigest: completed.rows[0]!.snapshot_digest, snapshotRevision: completed.rows[0]!.snapshot_revision, state: "succeeded", revision: completed.rows[0]!.revision, artifactDigest, rowCount: completed.rows[0]!.row_count }));
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
}
