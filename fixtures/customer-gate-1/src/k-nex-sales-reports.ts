import { createHash, randomUUID } from "node:crypto";

import { canonicalJson } from "@k-nex/contracts";
import { activePayloadPostgresTransaction } from "@k-nex/payload-adapter";
import { ActionGatewayError, DataSourceGatewayError } from "@k-nex/runtime";
import type { RuntimeExtensionPool } from "@k-nex/payload-adapter";
import type { PayloadRequest } from "payload";
import { sql } from "@payloadcms/db-postgres";

type Row = Record<string, unknown>;
export type GeneratedSalesReportId =
  | "sales.report.pipeline-value-by-stage" | "sales.report.weighted-forecast"
  | "sales.report.won-lost-conversion" | "sales.report.lead-conversion"
  | "sales.report.activity-by-owner-team" | "sales.report.task-aging"
  | "sales.report.sales-cycle-duration";
export type GeneratedSalesReportWindow = "as-of" | "current-reporting-week" | "previous-complete-reporting-week" | "current-reporting-month" | "previous-complete-reporting-month";
export type GeneratedSalesReportAuthority = Readonly<{
  context: Readonly<{ applicationId: string; environment: string; actorId: string }>;
  authorizationRevision: number;
  lifecycleRevision: number;
  scopeRevision: number;
  recordScope: "owned-or-assigned-team" | "managed-teams-and-own" | "application-sales-scope" | "explicit-application-or-team-scope";
  applicationWide: boolean;
  authorizedTeamIds: readonly string[];
  permissionGrants?: readonly string[];
  /** Current static module generation and exact report/source field grants. */
  runtimeGenerationId?: string;
  reportPermissionGrants?: readonly string[];
  objectPermissionGrants?: readonly string[];
  fieldPermissionGrants?: readonly string[];
}>;
export type GeneratedSalesReportWorkerFence = Readonly<{
  applicationId: string; environment: string; activeExecutionGeneration: string;
  fencingToken: number; leaseOwner: string; promotionRevision: number;
}>;
export type GeneratedSalesReportActionCall = Readonly<{
  applicationId: string; environment: string; actorId: string;
  authority: Readonly<{ authorizationRevision: number; lifecycleRevision: number; salesScopeRevision: number }>;
  idempotencyKey: string; input: Readonly<Record<string, unknown>>; signal: AbortSignal;
}>;
export type GeneratedSalesReportReadCall = Readonly<{
  applicationId: string; environment: string; actorId: string; reportId: GeneratedSalesReportId;
  windowMode: GeneratedSalesReportWindow; query: unknown; selectedFields: readonly string[]; recordScope: unknown;
}>;
export type GeneratedSalesReportResult = Readonly<{
  data: unknown;
  /** Internal gateway envelope. The Sales module validates this as metadata
   * and then publishes it as the public reportExecution field. */
  metadata: Readonly<{
    applicationId: string; environment: string;
    source: Readonly<{ id: string; version: number }>;
    sourceSchema: Readonly<{ id: string; version: number }>;
    authorizationRevision: number; lifecycleRevision: number; salesScopeRevision: number;
    settingsRevision: number; reportingTimezone: string; reportingCurrency: string; currencyScale: number;
    asOf: string; windowMode: GeneratedSalesReportWindow;
    grouping: "none" | "stage" | "owner-team" | "aging-bucket"; authorizedRecordCount: number;
    executionDigest: string;
  }>;
}>;
export type GeneratedSalesReportingGateway = Readonly<{
  read(input: GeneratedSalesReportReadCall): Promise<unknown>;
  run(input: GeneratedSalesReportActionCall): Promise<unknown>;
  schedule(input: GeneratedSalesReportActionCall): Promise<unknown>;
}>;

const reportIds = new Set<GeneratedSalesReportId>([
  "sales.report.pipeline-value-by-stage", "sales.report.weighted-forecast", "sales.report.won-lost-conversion",
  "sales.report.lead-conversion", "sales.report.activity-by-owner-team", "sales.report.task-aging", "sales.report.sales-cycle-duration"
]);
const windowed = new Set<GeneratedSalesReportId>(["sales.report.won-lost-conversion", "sales.report.lead-conversion", "sales.report.activity-by-owner-team", "sales.report.sales-cycle-duration"]);
const tableFields: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "sales.report.pipeline-value-by-stage": ["stage-id", "stage-name", "value"],
  "sales.report.activity-by-owner-team": ["actor-id", "team-id", "count"],
  "sales.report.task-aging": ["bucket", "count"]
});
const sha256 = (value: string | Uint8Array) => "sha256:" + createHash("sha256").update(value).digest("hex");
const digest = (value: unknown) => sha256(canonicalJson(value));
const now = () => new Date().toISOString();
function currencyScale(value: unknown): number {
  if (typeof value !== "string" || !/^[A-Z]{3}$/u.test(value) || typeof Intl.supportedValuesOf !== "function" || !Intl.supportedValuesOf("currency").includes(value)) throw new Error("REPORT_CURRENCY_INVALID");
  try {
    const scale = new Intl.NumberFormat("en-US", { style: "currency", currency: value }).resolvedOptions().maximumFractionDigits;
    if (typeof scale !== "number" || !Number.isSafeInteger(scale) || scale < 0 || scale > 18) throw new Error("REPORT_CURRENCY_SCALE_INVALID");
    return scale;
  } catch { throw new Error("REPORT_CURRENCY_INVALID"); }
}
function rows(value: unknown): readonly Row[] {
  if (value === null || typeof value !== "object" || !Array.isArray((value as { rows?: unknown }).rows)) throw new Error("Report SQL result is invalid.");
  return (value as { rows: Row[] }).rows;
}
function record(value: unknown): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Report row is invalid.");
  return value as Row;
}
function actionError(code: string, status: number, message: string): never { throw new ActionGatewayError(code, status, message); }
function sourceError(code: string, status: number, message: string): never { throw new DataSourceGatewayError(code, status, message); }
function validId(value: unknown): value is GeneratedSalesReportId { return typeof value === "string" && reportIds.has(value as GeneratedSalesReportId); }
function validWindow(reportId: GeneratedSalesReportId, value: unknown): value is GeneratedSalesReportWindow {
  return reportId === "sales.report.pipeline-value-by-stage" || reportId === "sales.report.weighted-forecast" || reportId === "sales.report.task-aging"
    ? value === "as-of" : typeof value === "string" && windowed.has(reportId) && ["current-reporting-week", "previous-complete-reporting-week", "current-reporting-month", "previous-complete-reporting-month"].includes(value);
}
function validAuthority(value: GeneratedSalesReportAuthority): boolean {
  return value.context.applicationId.length > 0 && value.context.environment.length > 0 && value.context.actorId.length > 0 &&
    Number.isSafeInteger(value.authorizationRevision) && value.authorizationRevision >= 1 && Number.isSafeInteger(value.lifecycleRevision) && value.lifecycleRevision >= 0 &&
    Number.isSafeInteger(value.scopeRevision) && value.scopeRevision >= 1 && Array.isArray(value.authorizedTeamIds) && value.authorizedTeamIds.length <= 32 &&
    value.authorizedTeamIds.every((teamId) => typeof teamId === "string" && /^[^\u0000-\u001f\u007f]{1,160}$/u.test(teamId)) &&
    JSON.stringify([...new Set(value.authorizedTeamIds)].sort()) === JSON.stringify(value.authorizedTeamIds) &&
    typeof value.runtimeGenerationId === "string" && value.runtimeGenerationId.length > 0 && value.runtimeGenerationId.length <= 160 &&
    Array.isArray(value.permissionGrants) && Array.isArray(value.objectPermissionGrants) && Array.isArray(value.fieldPermissionGrants);
}
function requiredReportPermissions(authority: GeneratedSalesReportAuthority, reportId: GeneratedSalesReportId): readonly string[] {
  const objectPermission = reportId === "sales.report.lead-conversion" ? "sales.leads.read" : reportId === "sales.report.activity-by-owner-team" ? "sales.activities.read" : reportId === "sales.report.task-aging" ? "sales.tasks.read" : "sales.opportunities.read";
  return Object.freeze(["sales.reports.read", objectPermission, ...(reportId === "sales.report.pipeline-value-by-stage" || reportId === "sales.report.weighted-forecast" ? ["sales.pipelines.read", "sales.opportunities.amount.read"] : reportId === "sales.report.sales-cycle-duration" || reportId === "sales.report.won-lost-conversion" ? ["sales.pipelines.read"] : [])]);
}
function hasReportPermissions(authority: GeneratedSalesReportAuthority, reportId: GeneratedSalesReportId): boolean {
  const granted = authority.reportPermissionGrants ?? authority.permissionGrants ?? [];
  const objectGranted = authority.objectPermissionGrants ?? [];
  const fieldGranted = authority.fieldPermissionGrants ?? [];
  return requiredReportPermissions(authority, reportId).every((permission) => permission === "sales.reports.read" ? granted.includes(permission) : permission === "sales.opportunities.amount.read" ? fieldGranted.includes(permission) : objectGranted.includes(permission));
}
function reportGrouping(reportId: GeneratedSalesReportId): "none" | "stage" | "owner-team" | "aging-bucket" {
  return reportId === "sales.report.pipeline-value-by-stage" ? "stage" : reportId === "sales.report.activity-by-owner-team" ? "owner-team" : reportId === "sales.report.task-aging" ? "aging-bucket" : "none";
}
function reportResult(input: GeneratedSalesReportReadCall, authority: GeneratedSalesReportAuthority, configured: Readonly<{ currency: string; timezone: string; revision: number; scale: number }>, data: unknown, authorizedRecordCount: number, asOf: number): GeneratedSalesReportResult {
  if (!Number.isSafeInteger(authorizedRecordCount) || authorizedRecordCount < 0) throw new Error("REPORT_RECORD_COUNT_INVALID");
  const runtimeGenerationId = authority.runtimeGenerationId;
  if (typeof runtimeGenerationId !== "string" || runtimeGenerationId.length === 0) throw new Error("REPORT_AUTHORITY_STALE");
  const metadata = Object.freeze({ applicationId: input.applicationId, environment: input.environment, source: Object.freeze({ id: input.reportId, version: 1 }), sourceSchema: Object.freeze({ id: input.reportId + ".output", version: 1 }), authorizationRevision: authority.authorizationRevision, lifecycleRevision: authority.lifecycleRevision, salesScopeRevision: authority.scopeRevision, settingsRevision: configured.revision, reportingTimezone: configured.timezone, reportingCurrency: configured.currency, currencyScale: configured.scale, asOf: new Date(asOf).toISOString(), windowMode: input.windowMode, grouping: reportGrouping(input.reportId), authorizedRecordCount });
  return Object.freeze({ data, metadata: Object.freeze({ ...metadata, executionDigest: digest(metadata) }) });
}
function scopeSql(authority: GeneratedSalesReportAuthority, alias: string) {
  if (authority.recordScope === "application-sales-scope" || authority.recordScope === "explicit-application-or-team-scope" && authority.applicationWide) return sql`true`;
  const teamScope = authority.authorizedTeamIds.length === 0 ? sql`false` : sql`${sql.raw(alias + ".team_id")} in ${authority.authorizedTeamIds}`;
  if (authority.recordScope === "explicit-application-or-team-scope") return teamScope;
  return authority.authorizedTeamIds.length === 0 ? sql`${sql.raw(alias + ".owner_id = ")}${authority.context.actorId}` : sql`(${sql.raw(alias + ".owner_id = ")}${authority.context.actorId} OR ${teamScope})`;
}
async function assertSingleReportingCurrency(db: { execute(query: unknown): Promise<unknown> }, input: GeneratedSalesReportReadCall, authority: GeneratedSalesReportAuthority, configured: Readonly<{ currency: string; timezone: string; revision: number; scale: number }>): Promise<void> {
  const scope = scopeSql(authority, "r");
  const result = rows(await db.execute(sql`SELECT count(DISTINCT r.currency)::integer AS currencies, max(r.currency) AS currency FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.archive_status='active' AND r.amount IS NOT NULL AND r.currency IS NOT NULL AND s.semantic NOT IN ('won','lost') AND (${scope})`));
  const row = record(result[0]);
  if (Number(row.currencies) > 1 || Number(row.currencies) === 1 && row.currency !== configured.currency) sourceError("REPORT_CURRENCY_MIXED", 409, "Report contains multiple or non-configured currencies.");
}
async function assertSingleWorkerCurrency(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, run: Row, authority: Row, configuredCurrency: string): Promise<void> {
  const scope = workerScope(authority, "r");
  const result = await client.query<Row>("SELECT count(DISTINCT r.currency)::integer AS currencies,max(r.currency) AS currency FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=$1 AND r.environment=$2 AND r.archive_status='active' AND r.amount IS NOT NULL AND r.currency IS NOT NULL AND s.semantic NOT IN ('won','lost') AND (" + scope.sql + ")", [run.application_id, run.environment, run.recipient_id, scope.teamIds]);
  const row = record(result.rows[0]);
  if (Number(row.currencies) > 1 || Number(row.currencies) === 1 && row.currency !== configuredCurrency) throw new Error("REPORT_CURRENCY_MIXED");
}
async function lockAuthority(db: { execute(query: unknown): Promise<unknown> }, authority: GeneratedSalesReportAuthority): Promise<void> {
  const auth = rows(await db.execute(sql`SELECT authorization_revision,lifecycle_revision FROM k_nex_authorization_state WHERE application_id=${authority.context.applicationId} FOR SHARE`));
  const scope = rows(await db.execute(sql`SELECT revision,state FROM sales_current_authority_scopes WHERE application_id=${authority.context.applicationId} AND environment=${authority.context.environment} AND principal_id=${authority.context.actorId} AND state='active' FOR SHARE`));
  const generation = rows(await db.execute(sql`SELECT runtime_generation_ids FROM k_nex_extension_authorization_generations WHERE application_id=${authority.context.applicationId} AND delivery_class='platform-plugin' AND extension_id='module.sales' AND state='current' FOR SHARE`));
  const a = record(auth[0]); const s = record(scope[0]);
  const runtimeIds = generation.length === 1 && Array.isArray(generation[0]?.runtime_generation_ids) ? generation[0]!.runtime_generation_ids : [];
  if (auth.length !== 1 || scope.length !== 1 || generation.length !== 1 || a.authorization_revision !== authority.authorizationRevision || a.lifecycle_revision !== authority.lifecycleRevision || s.revision !== authority.scopeRevision || s.state !== "active" || typeof authority.runtimeGenerationId !== "string" || runtimeIds.length !== 1 || runtimeIds[0] !== authority.runtimeGenerationId) actionError("REPORT_AUTHORITY_STALE", 409, "Sales report authority changed.");
}
async function settings(db: { execute(query: unknown): Promise<unknown> }, applicationId: string, environment: string): Promise<Readonly<{ currency: string; timezone: string; revision: number; scale: number }>> {
  const result = rows(await db.execute(sql`SELECT d.descriptor_schema_version,d.document_revision,d.settings_revision,d.values_json,s.settings_revision AS state_revision FROM k_nex_system_settings_documents d JOIN k_nex_system_settings_state s ON s.application_id=d.application_id AND s.environment=d.environment WHERE d.application_id=${applicationId} AND d.environment=${environment} AND d.descriptor_id='system.general' AND d.owner_scope_key='platform:system' FOR SHARE`));
  const row = record(result[0]); const value = record(row.values_json);
  if (result.length !== 1 || row.descriptor_schema_version !== 3 || !Number.isSafeInteger(row.document_revision) || Number(row.document_revision) < 1 || !Number.isSafeInteger(row.settings_revision) || row.settings_revision !== row.state_revision || typeof value.reportingCurrency !== "string" || typeof value.reportingTimezone !== "string") actionError("REPORT_AUTHORITY_STALE", 503, "Reporting settings v3 are not ready.");
  let scale: number;
  try { scale = currencyScale(value.reportingCurrency); } catch { actionError("REPORT_AUTHORITY_STALE", 503, "Reporting currency is invalid."); }
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.reportingTimezone }).format(); } catch { actionError("REPORT_AUTHORITY_STALE", 503, "Reporting timezone is invalid."); }
  return Object.freeze({ currency: value.reportingCurrency, timezone: value.reportingTimezone, revision: Number(row.settings_revision), scale });
}
function metric(value: unknown, unit: string, currency?: string, scale?: number) {
  if (unit === "money") {
    if (typeof currency !== "string" || !Number.isSafeInteger(scale)) throw new Error("REPORT_CURRENCY_INVALID");
    return Object.freeze({ value: Object.freeze({ kind: "money", value: value === null || value === undefined ? "0" : String(value), currency, scale, rounding: "half-up" as const }) });
  }
  if (unit === "percent") return Object.freeze({ value: Object.freeze({ kind: "percentage", value: value === null || value === undefined ? null : String(value) }) });
  return Object.freeze({ value: Object.freeze({ kind: "duration", value: value === null || value === undefined ? null : String(value), unit }) });
}
function project(fields: readonly string[], value: Row): Row { return Object.fromEntries(fields.map((field) => [field, value[field] ?? null])); }
type ReportPage = Readonly<{ number: number; size: number; offset: number }>;
function reportPage(input: GeneratedSalesReportReadCall): ReportPage {
  const max = input.reportId === "sales.report.pipeline-value-by-stage" ? 6 : input.reportId === "sales.report.activity-by-owner-team" ? 100 : 5;
  const query = input.query !== null && typeof input.query === "object" && !Array.isArray(input.query) ? input.query as Row : {};
  const page = query.page;
  if (page === null || typeof page !== "object" || Array.isArray(page)) sourceError("INVALID_QUERY_INPUT", 400, "Report pagination is required.");
  const value = page as Row;
  const number = value.number; const size = value.size;
  if (!Number.isSafeInteger(number) || Number(number) < 1 || Number(number) > 1_000_000 || !Number.isSafeInteger(size) || Number(size) < 1 || Number(size) > max) sourceError("INVALID_QUERY_INPUT", 400, "Report pagination is invalid.");
  const offset = (Number(number) - 1) * Number(size);
  if (!Number.isSafeInteger(offset) || offset > 1_000_000_000) sourceError("INVALID_QUERY_INPUT", 400, "Report pagination is invalid.");
  return Object.freeze({ number: Number(number), size: Number(size), offset });
}
function pageSql(page: ReportPage): ReturnType<typeof sql.raw> { return sql.raw("LIMIT " + String(page.size + 1) + " OFFSET " + String(page.offset)); }
function table(fields: readonly string[], values: readonly Row[], page: ReportPage = Object.freeze({ number: 1, size: Math.max(1, values.length), offset: 0 }), hasNext = false) { return Object.freeze({ fields: Object.freeze([...fields]), rows: Object.freeze(values.map((value, index) => Object.freeze({ key: "row-" + String(page.offset + index + 1), values: Object.freeze(project(fields, value)) }))), page: Object.freeze({ number: page.number, pageSize: page.size, hasNext }) }); }
function windowPredicate(column: string, windowMode: GeneratedSalesReportWindow, timezone: string) {
  if (windowMode === "as-of") return sql`true`;
  const unit = windowMode.includes("month") ? "month" : "week";
  const offset = windowMode.startsWith("previous") ? -1 : 0;
  const interval = sql.raw("interval '1 " + unit + "'");
  return sql`${sql.raw(column)} >= (date_trunc(${unit}, now() AT TIME ZONE ${timezone}) + (${offset} * ${interval})) AT TIME ZONE ${timezone} AND ${sql.raw(column)} < (date_trunc(${unit}, now() AT TIME ZONE ${timezone}) + ((${offset} + 1) * ${interval})) AT TIME ZONE ${timezone}`;
}
async function runReportData(db: { execute(query: unknown): Promise<unknown> }, input: GeneratedSalesReportReadCall, authority: GeneratedSalesReportAuthority, configured: Readonly<{ currency: string; timezone: string; revision: number; scale: number }>): Promise<unknown> {
  const scope = scopeSql(authority, "r");
  const selected = input.selectedFields;
  if (Object.hasOwn(tableFields, input.reportId)) {
    const allowed = tableFields[input.reportId]!;
    if (selected.length === 0 || selected.some((field) => !allowed.includes(field)) || new Set(selected).size !== selected.length) sourceError("SOURCE_FORBIDDEN", 403, "Report fields are forbidden.");
  } else if (selected.length !== 0) sourceError("SOURCE_FORBIDDEN", 403, "Metric reports do not expose fields.");
  const page = Object.hasOwn(tableFields, input.reportId) ? reportPage(input) : undefined;
  if (input.reportId === "sales.report.pipeline-value-by-stage") {
    await assertSingleReportingCurrency(db, input, authority, configured);
    const result = rows(await db.execute(sql`SELECT r.stage_id::text AS "stage-id",s.name AS "stage-name",round(coalesce(sum(r.amount::numeric),0),${configured.scale})::text AS value FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.archive_status='active' AND s.semantic NOT IN ('won','lost') AND r.currency=${configured.currency} AND (${scope}) GROUP BY r.stage_id,s.name,s.position ORDER BY s.position,r.stage_id ${pageSql(page!)}`));
    return table(selected, result.slice(0, page!.size).map((row) => ({ "stage-id": Object.freeze({ kind: "enum", value: String(row["stage-id"]) }), "stage-name": Object.freeze({ kind: "text", value: String(row["stage-name"]) }), value: Object.freeze({ kind: "money", value: String(row.value ?? "0"), currency: configured.currency, scale: configured.scale }) })), page!, result.length > page!.size);
  }
  if (input.reportId === "sales.report.weighted-forecast") {
    await assertSingleReportingCurrency(db, input, authority, configured);
    const result = rows(await db.execute(sql`SELECT round(coalesce(sum(r.amount::numeric * s.probability_basis_points / 10000),0),${configured.scale})::text AS value FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.archive_status='active' AND r.currency=${configured.currency} AND s.semantic NOT IN ('won','lost') AND (${scope})`));
    return metric(record(result[0]).value, "money", configured.currency, configured.scale);
  }
  if (input.reportId === "sales.report.won-lost-conversion") {
    const result = rows(await db.execute(sql`SELECT round(100.0*sum(CASE WHEN s.semantic='won' THEN 1 ELSE 0 END)/nullif(count(*),0),2)::text AS value FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND s.semantic IN ('won','lost') AND (${scope}) AND r.closed_at IS NOT NULL AND (${windowPredicate("r.closed_at", input.windowMode, configured.timezone)})`));
    return metric(record(result[0]).value, "percent");
  }
  if (input.reportId === "sales.report.lead-conversion") {
    const result = rows(await db.execute(sql`SELECT round(100.0*sum(CASE WHEN status='qualified' THEN 1 ELSE 0 END)/nullif(count(*),0),2)::text AS value FROM sales_leads r WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.status IN ('qualified','disqualified') AND (${scope}) AND r.decided_at IS NOT NULL AND (${windowPredicate("r.decided_at", input.windowMode, configured.timezone)})`));
    return metric(record(result[0]).value, "percent");
  }
  if (input.reportId === "sales.report.activity-by-owner-team") {
    const result = rows(await db.execute(sql`SELECT r.actor_id::text AS "actor-id",r.team_id::text AS "team-id",count(*)::integer AS count FROM sales_activities r WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.occurred_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales_activities successor WHERE successor.application_id=r.application_id AND successor.environment=r.environment AND successor.supersedes_activity_id=r.id) AND (${scope}) AND (${windowPredicate("r.occurred_at", input.windowMode, configured.timezone)}) GROUP BY r.actor_id,r.team_id ORDER BY r.actor_id,r.team_id ${pageSql(page!)}`));
    return table(selected, result.slice(0, page!.size).map((row) => ({ "actor-id": Object.freeze({ kind: "text", value: String(row["actor-id"]) }), "team-id": row["team-id"] === null || row["team-id"] === undefined ? null : Object.freeze({ kind: "text", value: String(row["team-id"]) }), count: Object.freeze({ kind: "integer", value: Number(row.count) }) })), page!, result.length > page!.size);
  }
  if (input.reportId === "sales.report.task-aging") {
    const reportDate = sql`(now() AT TIME ZONE ${configured.timezone})::date`;
    const result = rows(await db.execute(sql`WITH today(value) AS (VALUES (${reportDate})), buckets(bucket) AS (VALUES ('not-due'),('due-today'),('1-7'),('8-30'),('31-plus')) SELECT bucket,count FROM buckets CROSS JOIN today LEFT JOIN LATERAL (SELECT count(*)::integer AS count FROM sales_tasks r WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.status='open' AND (${scope}) AND ((bucket='not-due' AND (r.due_date IS NULL OR r.due_date::date>today.value)) OR (bucket='due-today' AND r.due_date::date=today.value) OR (bucket='1-7' AND r.due_date::date BETWEEN today.value-7 AND today.value-1) OR (bucket='8-30' AND r.due_date::date BETWEEN today.value-30 AND today.value-8) OR (bucket='31-plus' AND r.due_date::date<=today.value-31))) c ON true ORDER BY CASE bucket WHEN 'not-due' THEN 1 WHEN 'due-today' THEN 2 WHEN '1-7' THEN 3 WHEN '8-30' THEN 4 ELSE 5 END ${pageSql(page!)}`));
    return table(selected, result.slice(0, page!.size).map((row) => ({ bucket: Object.freeze({ kind: "enum", value: String(row.bucket) }), count: Object.freeze({ kind: "integer", value: Number(row.count) }) })), page!, result.length > page!.size);
  }
  const result = rows(await db.execute(sql`WITH durations AS (SELECT floor(greatest(extract(epoch FROM (r.closed_at AT TIME ZONE 'UTC' - r.created_at AT TIME ZONE 'UTC')),0)/86400.0)::numeric AS whole_days FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND s.semantic IN ('won','lost') AND r.closed_at IS NOT NULL AND (${scope}) AND (${windowPredicate("r.closed_at", input.windowMode, configured.timezone)})), ordered AS (SELECT whole_days,row_number() OVER (ORDER BY whole_days) AS position,count(*) OVER () AS cardinality,lead(whole_days) OVER (ORDER BY whole_days) AS next_whole_days FROM durations) SELECT coalesce(nullif(trim(trailing '.' from trim(trailing '0' from (CASE WHEN cardinality % 2 = 1 THEN whole_days ELSE (whole_days + next_whole_days)/2 END)::text)),''),'0') AS value FROM ordered WHERE position=CASE WHEN cardinality % 2 = 1 THEN (cardinality+1)/2 ELSE cardinality/2 END LIMIT 1`));
  return metric(result[0] === undefined ? null : record(result[0]).value, "days");
}

async function authorizedReportRecordCount(db: { execute(query: unknown): Promise<unknown> }, input: GeneratedSalesReportReadCall, authority: GeneratedSalesReportAuthority, configured: Readonly<{ currency: string; timezone: string; revision: number; scale: number }>): Promise<number> {
  const scope = scopeSql(authority, "r");
  let result: readonly Row[];
  if (input.reportId === "sales.report.pipeline-value-by-stage" || input.reportId === "sales.report.weighted-forecast") {
    result = rows(await db.execute(sql`SELECT count(*)::integer AS count FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.archive_status='active' AND r.currency=${configured.currency} AND s.semantic NOT IN ('won','lost') AND (${scope})`));
  } else if (input.reportId === "sales.report.won-lost-conversion" || input.reportId === "sales.report.sales-cycle-duration") {
    result = rows(await db.execute(sql`SELECT count(*)::integer AS count FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND s.semantic IN ('won','lost') AND r.closed_at IS NOT NULL AND (${scope}) AND (${windowPredicate("r.closed_at", input.windowMode, configured.timezone)})`));
  } else if (input.reportId === "sales.report.lead-conversion") {
    result = rows(await db.execute(sql`SELECT count(*)::integer AS count FROM sales_leads r WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.status IN ('qualified','disqualified') AND r.decided_at IS NOT NULL AND (${scope}) AND (${windowPredicate("r.decided_at", input.windowMode, configured.timezone)})`));
  } else if (input.reportId === "sales.report.activity-by-owner-team") {
    result = rows(await db.execute(sql`SELECT count(*)::integer AS count FROM sales_activities r WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.occurred_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales_activities successor WHERE successor.application_id=r.application_id AND successor.environment=r.environment AND successor.supersedes_activity_id=r.id) AND (${scope}) AND (${windowPredicate("r.occurred_at", input.windowMode, configured.timezone)})`));
  } else {
    result = rows(await db.execute(sql`SELECT count(*)::integer AS count FROM sales_tasks r WHERE r.application_id=${input.applicationId} AND r.environment=${input.environment} AND r.status='open' AND (${scope})`));
  }
  const count = Number(record(result[0]).count);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("REPORT_RECORD_COUNT_INVALID");
  return count;
}
async function runReport(db: { execute(query: unknown): Promise<unknown> }, input: GeneratedSalesReportReadCall, authority: GeneratedSalesReportAuthority): Promise<GeneratedSalesReportResult> {
  await persistedInteractiveSourceWatermark(db, input);
  const configured = await settings(db, input.applicationId, input.environment);
  const clock = rows(await db.execute(sql`SELECT extract(epoch FROM transaction_timestamp()) * 1000 AS epoch_ms`));
  const asOf = Number(record(clock[0]).epoch_ms);
  if (!Number.isFinite(asOf)) throw new Error("REPORT_SNAPSHOT_INVALID");
  const data = await runReportData(db, input, authority, configured);
  const authorizedRecordCount = await authorizedReportRecordCount(db, input, authority, configured);
  return reportResult(input, authority, configured, data, authorizedRecordCount, asOf);
}

async function appendRunEvidence(db: { execute(query: unknown): Promise<unknown> }, run: Row, fromState: string, toState: string, actionId: string, failureCode: string | null = null): Promise<void> {
  const revision = Number(run.revision);
  const occurredAt = now();
  const executionMetadata = run.execution_metadata !== undefined && run.execution_metadata !== null && typeof run.execution_metadata === "object" ? run.execution_metadata : undefined;
  const evidence = Object.freeze({ applicationId: run.application_id, environment: run.environment, runId: run.run_id, reportId: run.report_id, fromState, toState, revision, actionId, actorId: run.creator_id, idempotencyKey: run.idempotency_key, ...(executionMetadata === undefined ? {} : { executionMetadata, executionDigest: run.execution_metadata_digest }), ...(failureCode === null ? {} : { failureCode }), occurredAt });
  const evidenceDigest = digest(evidence);
  const eventId = "sales-report-run-" + run.run_id + "-" + String(revision);
  const inserted = rows(await db.execute(sql`WITH changed AS (UPDATE sales_report_runs SET audit=coalesce(audit,'[]'::jsonb)||${JSON.stringify(evidence)}::jsonb,updated_at=${occurredAt}::timestamptz WHERE run_id=${run.run_id} AND revision=${revision} RETURNING run_id), audit AS (INSERT INTO sales_report_run_audit(audit_id,run_id,application_id,environment,revision,from_state,to_state,action_id,evidence,digest,occurred_at) SELECT ${eventId + "-audit"},${run.run_id},${run.application_id},${run.environment},${revision},${fromState},${toState},${actionId},${JSON.stringify(evidence)}::jsonb,${evidenceDigest},${occurredAt}::timestamptz FROM changed RETURNING audit_id), outbox AS (INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) SELECT ${eventId},'sales.event.report-run-changed',1,'durable-integration',${occurredAt}::timestamptz,${run.application_id},'module.sales',${run.creator_id},'system',${run.run_id},${run.run_id},${eventId},${JSON.stringify({ runId: run.run_id, reportId: run.report_id, state: toState, revision, ...(executionMetadata === undefined ? {} : { executionMetadata, executionDigest: run.execution_metadata_digest }) })}::jsonb,'pending',${occurredAt}::timestamptz+interval '30 days' FROM audit ON CONFLICT(event_id) DO NOTHING RETURNING event_id) SELECT event_id FROM outbox`));
  if (inserted.length !== 1) throw new Error("Report transition event collision.");
}
async function appendScheduleEvidence(db: { execute(query: unknown): Promise<unknown> }, schedule: Row, fromState: string, toState: string, revision: number, actorId: string, idempotencyKey: string): Promise<void> {
  const occurredAt = now();
  const evidence = Object.freeze({ applicationId: schedule.application_id, environment: schedule.environment, scheduleId: schedule.schedule_id, reportId: schedule.report_id, recipientId: schedule.recipient_id, fromState, toState, revision, actionId: "sales.report.schedule", actorId, idempotencyKey, occurredAt });
  const evidenceDigest = digest(evidence);
  const eventId = "sales-report-schedule-" + schedule.schedule_id + "-" + String(revision);
  const inserted = rows(await db.execute(sql`WITH changed AS (UPDATE sales_report_schedules SET audit=coalesce(audit,'[]'::jsonb)||${JSON.stringify(evidence)}::jsonb WHERE schedule_id=${schedule.schedule_id} AND revision=${revision} RETURNING schedule_id), audit AS (INSERT INTO sales_report_schedule_audit(audit_id,schedule_id,application_id,environment,revision,evidence,digest,occurred_at) SELECT ${eventId + "-audit"},${schedule.schedule_id},${schedule.application_id},${schedule.environment},${revision},${JSON.stringify(evidence)}::jsonb,${evidenceDigest},${occurredAt}::timestamptz FROM changed RETURNING audit_id), outbox AS (INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) SELECT ${eventId},'sales.event.report-run-changed',1,'durable-integration',${occurredAt}::timestamptz,${schedule.application_id},'module.sales',${actorId},'user',${schedule.schedule_id},${schedule.schedule_id},${eventId},${JSON.stringify({ scheduleId: schedule.schedule_id, reportId: schedule.report_id, state: toState, revision })}::jsonb,'pending',${occurredAt}::timestamptz+interval '30 days' FROM audit ON CONFLICT(event_id) DO NOTHING RETURNING event_id) SELECT event_id FROM outbox`));
  if (inserted.length !== 1) throw new Error("Report schedule transition event collision.");
}
async function nextWeeklyRun(db: { execute(query: unknown): Promise<unknown> }, weekday: number, localTime: string, timezone: string): Promise<Date> {
  const result = rows(await db.execute(sql`WITH candidate AS (SELECT (date_trunc('day', now() AT TIME ZONE ${timezone}) + (((${weekday} - extract(isodow FROM now() AT TIME ZONE ${timezone})::integer + 7) % 7) * interval '1 day') + ${localTime}::time) AT TIME ZONE ${timezone} AS next_run_at) SELECT CASE WHEN next_run_at <= now() THEN next_run_at + interval '7 days' ELSE next_run_at END AS next_run_at FROM candidate`));
  const value = result[0]?.next_run_at; const date = value instanceof Date ? value : new Date(String(value));
  if (result.length !== 1 || Number.isNaN(date.getTime())) throw new Error("Report schedule next-run calculation failed.");
  return date;
}
async function nextWeeklyRunAfter(db: { execute(query: unknown): Promise<unknown> }, anchor: unknown, timezone: string): Promise<Date> {
  const result = rows(await db.execute(sql`SELECT ((${anchor}::timestamptz AT TIME ZONE ${timezone} + interval '7 days') AT TIME ZONE ${timezone}) AS next_run_at`));
  const value = result[0]?.next_run_at; const date = value instanceof Date ? value : new Date(String(value));
  if (result.length !== 1 || Number.isNaN(date.getTime())) throw new Error("Report schedule next-run calculation failed.");
  return date;
}
async function assertActionAuthority(db: { execute(query: unknown): Promise<unknown> }, call: GeneratedSalesReportActionCall, authority: GeneratedSalesReportAuthority, action: "run" | "schedule"): Promise<void> {
  const reportGrants = authority.reportPermissionGrants ?? authority.permissionGrants ?? [];
  const originGrant = action === "run" ? "sales.exports.execute" : "sales.reports.schedule";
  if (!validAuthority(authority) || call.applicationId !== authority.context.applicationId || call.environment !== authority.context.environment || call.actorId !== authority.context.actorId || !reportGrants.includes(originGrant) || !reportGrants.includes("sales.reports.read") || !validId(call.input.reportId) || !hasReportPermissions(authority, call.input.reportId)) actionError("ACTION_FORBIDDEN", 403, "Sales report authority is unavailable.");
  if (call.authority.authorizationRevision !== authority.authorizationRevision || call.authority.lifecycleRevision !== authority.lifecycleRevision || call.authority.salesScopeRevision !== authority.scopeRevision) actionError("REPORT_AUTHORITY_STALE", 409, "Sales report authority changed.");
  await lockAuthority(db, authority);
  await settings(db, call.applicationId, call.environment);
}

export class GeneratedSalesReportingStore {
  constructor(private readonly request: PayloadRequest, private readonly authority: GeneratedSalesReportAuthority) {}
  async read(input: GeneratedSalesReportReadCall): Promise<unknown> {
    if (!validAuthority(this.authority) || input.applicationId !== this.authority.context.applicationId || input.environment !== this.authority.context.environment || input.actorId !== this.authority.context.actorId || !validId(input.reportId) || !validWindow(input.reportId, input.windowMode) || !hasReportPermissions(this.authority, input.reportId)) sourceError("SOURCE_FORBIDDEN", 403, "Sales report authority is unavailable.");
    const db = await activePayloadPostgresTransaction(this.request);
    await db.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    await lockAuthority(db, this.authority);
    return await runReport(db, input, this.authority);
  }
  async run(call: GeneratedSalesReportActionCall): Promise<unknown> {
    const input = call.input;
    if (!validId(input.reportId) || !validWindow(input.reportId, input.windowMode ?? "as-of") || typeof call.idempotencyKey !== "string" || call.idempotencyKey.length < 8) actionError("ACTION_FORBIDDEN", 400, "Sales report run input is invalid.");
    const db = await activePayloadPostgresTransaction(this.request);
    await assertActionAuthority(db, call, this.authority, "run");
    const reportId = input.reportId; const windowMode = input.windowMode ?? "as-of"; const runId = "report-run-" + randomUUID(); const reportDigest = digest({ applicationId: call.applicationId, environment: call.environment, reportId, windowMode, recipientId: call.actorId, scheduledFor: null, actionId: "sales.report.run", idempotencyKey: call.idempotencyKey }); const requestedAt = now();
    const prior = rows(await db.execute(sql`SELECT * FROM sales_report_runs WHERE application_id=${call.applicationId} AND environment=${call.environment} AND idempotency_key=${call.idempotencyKey} FOR UPDATE`))[0];
    if (prior !== undefined) {
      const priorRow = record(prior);
      if (priorRow.report_digest !== reportDigest || priorRow.report_id !== reportId || priorRow.window_mode !== windowMode || priorRow.creator_id !== call.actorId) actionError("IDEMPOTENCY_CONFLICT", 409, "Report run idempotency key is already bound.");
      return Object.freeze({ reportRunId: String(priorRow.run_id), state: "queued", revision: Number(priorRow.revision) });
    }
    const inserted = rows(await db.execute(sql`INSERT INTO sales_report_runs(run_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,scheduled_for,requested_at,authorization_revision,lifecycle_revision,scope_revision,report_revision,report_digest,idempotency_key,state,revision,attempt,next_attempt_at,audit,created_at,updated_at) VALUES(${runId},${call.applicationId},${call.environment},${call.actorId},${call.actorId},${reportId},${windowMode},NULL,${requestedAt}::timestamptz,${this.authority.authorizationRevision},${this.authority.lifecycleRevision},${this.authority.scopeRevision},1,${reportDigest},${call.idempotencyKey},'queued',1,0,now(),'[]'::jsonb,now(),now()) RETURNING *`));
    if (inserted.length !== 1) actionError("IDEMPOTENCY_CONFLICT", 409, "Report run idempotency key is already bound.");
    const reportGrants = (this.authority.reportPermissionGrants ?? this.authority.permissionGrants ?? []).filter((permission) => permission === "sales.exports.execute" || permission === "sales.reports.read");
    const objectGrants = (this.authority.objectPermissionGrants ?? []).filter((permission) => requiredReportPermissionsForOrigin(reportId, false).includes(permission));
    const fieldGrants = (this.authority.fieldPermissionGrants ?? []).filter((permission) => requiredReportPermissionsForOrigin(reportId, false).includes(permission));
    await db.execute(sql`UPDATE sales_report_runs SET runtime_generation_id=${this.authority.runtimeGenerationId},report_permission_grants=${JSON.stringify(reportGrants)}::jsonb,object_permission_grants=${JSON.stringify(objectGrants)}::jsonb,field_permission_grants=${JSON.stringify(fieldGrants)}::jsonb WHERE run_id=${runId}`);
    await appendRunEvidence(db, inserted[0]!, "absent", "queued", "sales.report.run");
    return Object.freeze({ reportRunId: runId, state: "queued", revision: 1 });
  }
  async schedule(call: GeneratedSalesReportActionCall): Promise<unknown> {
    const input = call.input; const operation = input.operation; const reportId = input.reportId;
    const requestedWindowMode = input.windowMode ?? "as-of";
    if ((operation !== "upsert" && operation !== "cancel") || !validId(reportId) || operation === "upsert" && !validWindow(reportId, requestedWindowMode) || input.recipientId !== call.actorId || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < (operation === "cancel" ? 1 : 0) || operation === "upsert" && (!Number.isSafeInteger(input.weekday) || Number(input.weekday) < 1 || Number(input.weekday) > 7 || typeof input.localTime !== "string" || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u.test(input.localTime)) || !authoritySchedule(this.authority)) actionError("ACTION_FORBIDDEN", 403, "Report schedule input is invalid.");
    const db = await activePayloadPostgresTransaction(this.request); await assertActionAuthority(db, call, this.authority, "schedule");
    const configured = operation === "upsert" ? await settings(db, call.applicationId, call.environment) : undefined;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${call.applicationId + "|" + call.environment + "|" + call.actorId},0))`);
    const scheduleId = "report-schedule-" + createHash("sha256").update(canonicalJson({ applicationId: call.applicationId, environment: call.environment, creatorId: call.actorId, recipientId: call.actorId, reportId })).digest("hex");
    const current = rows(await db.execute(sql`SELECT * FROM sales_report_schedules WHERE schedule_id=${scheduleId} FOR UPDATE`))[0]; const expected = Number(input.expectedRevision); if ((current === undefined ? 0 : Number(record(current).revision)) !== expected) actionError("STALE_RECORD", 409, "Report schedule revision is stale.");
    const windowMode = operation === "upsert" ? requestedWindowMode : String(record(current).window_mode); if (!validWindow(reportId, windowMode)) actionError("REPORT_AUTHORITY_STALE", 409, "Report schedule state changed.");
    if (operation === "upsert" && (current === undefined || record(current).state !== "active") && rows(await db.execute(sql`SELECT schedule_id FROM sales_report_schedules WHERE application_id=${call.applicationId} AND environment=${call.environment} AND creator_id=${call.actorId} AND state='active' FOR UPDATE`)).length >= 7) actionError("SCHEDULE_LIMIT", 409, "Report schedule limit is reached.");
    const nextRevision = expected + 1; const state = operation === "cancel" ? "cancelled" : "active";
    const nextRunAt = operation === "upsert" ? await nextWeeklyRun(db, Number(input.weekday), String(input.localTime), configured!.timezone) : undefined;
    if (current === undefined) await db.execute(sql`INSERT INTO sales_report_schedules(schedule_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,weekday,local_time,authorization_revision,lifecycle_revision,scope_revision,revision,state,next_run_at,audit) VALUES(${scheduleId},${call.applicationId},${call.environment},${call.actorId},${call.actorId},${reportId},${windowMode},${operation === "upsert" ? Number(input.weekday) : 1},${operation === "upsert" ? input.localTime : "09:00"},${this.authority.authorizationRevision},${this.authority.lifecycleRevision},${this.authority.scopeRevision},${nextRevision},${state},${nextRunAt === undefined ? sql`NULL` : nextRunAt},'[]'::jsonb)`);
    else await db.execute(sql`UPDATE sales_report_schedules SET revision=${nextRevision},state=${state},window_mode=${windowMode},weekday=${operation === "upsert" ? Number(input.weekday) : Number(record(current).weekday)},local_time=${operation === "upsert" ? input.localTime : String(record(current).local_time)},authorization_revision=${this.authority.authorizationRevision},lifecycle_revision=${this.authority.lifecycleRevision},scope_revision=${this.authority.scopeRevision},next_run_at=${nextRunAt === undefined ? sql`NULL` : nextRunAt},updated_at=now() WHERE schedule_id=${scheduleId} AND revision=${expected}`);
    const reportGrants = (this.authority.reportPermissionGrants ?? this.authority.permissionGrants ?? []).filter((permission) => permission === "sales.reports.read" || permission === "sales.reports.schedule");
    const objectGrants = (this.authority.objectPermissionGrants ?? []).filter((permission) => requiredReportPermissionsForOrigin(reportId, true).includes(permission));
    const fieldGrants = (this.authority.fieldPermissionGrants ?? []).filter((permission) => requiredReportPermissionsForOrigin(reportId, true).includes(permission));
    await db.execute(sql`UPDATE sales_report_schedules SET runtime_generation_id=${this.authority.runtimeGenerationId},report_permission_grants=${JSON.stringify(reportGrants)}::jsonb,object_permission_grants=${JSON.stringify(objectGrants)}::jsonb,field_permission_grants=${JSON.stringify(fieldGrants)}::jsonb WHERE schedule_id=${scheduleId}`);
    await appendScheduleEvidence(db, { application_id: call.applicationId, environment: call.environment, schedule_id: scheduleId, report_id: reportId, recipient_id: call.actorId }, current === undefined ? "absent" : String(record(current).state), state, nextRevision, call.actorId, call.idempotencyKey);
    return Object.freeze({ reportId, recipientId: call.actorId, state, revision: nextRevision });
  }
}
function authoritySchedule(authority: GeneratedSalesReportAuthority): boolean { return (authority.reportPermissionGrants ?? authority.permissionGrants)?.includes("sales.reports.schedule") === true; }
export function createGeneratedSalesReportingGateway(request: PayloadRequest, authority: GeneratedSalesReportAuthority) {
  const store = new GeneratedSalesReportingStore(request, authority);
  return Object.freeze({ read: (input: GeneratedSalesReportReadCall) => store.read(input), run: (input: GeneratedSalesReportActionCall) => store.run(input), schedule: (input: GeneratedSalesReportActionCall) => store.schedule(input) });
}

async function liveFence(db: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, fence: GeneratedSalesReportWorkerFence): Promise<boolean> {
  const result = await db.query("SELECT 1 FROM runtime_worker_generation_fences WHERE application_id=$1 AND environment=$2 AND active_execution_generation=$3 AND fencing_token=$4 AND promotion_revision=$5 AND lease_owner=$6 AND lease_expires_at>now() FOR UPDATE", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
  return result.rows.length === 1;
}
function workerWindow(column: string, mode: string, timezoneParameter: number): string {
  if (mode === "as-of") return "true";
  const unit = mode.includes("month") ? "month" : "week";
  const offset = mode.startsWith("previous") ? "-1" : "0";
  return column + " >= (date_trunc('" + unit + "', now() AT TIME ZONE $" + String(timezoneParameter) + ") + (" + offset + " * interval '1 " + unit + "')) AT TIME ZONE $" + String(timezoneParameter) + " AND " + column + " < (date_trunc('" + unit + "', now() AT TIME ZONE $" + String(timezoneParameter) + ") + ((" + offset + " + 1) * interval '1 " + unit + "')) AT TIME ZONE $" + String(timezoneParameter);
}
function workerScope(row: Row, alias: string): Readonly<{ sql: string; teamIds: readonly string[] }> {
  if (row.record_scope === "application-sales-scope" || row.record_scope === "explicit-application-or-team-scope" && row.application_wide === true) return Object.freeze({ sql: "true AND $3::text IS NOT NULL AND $4::text[] IS NOT NULL", teamIds: [] });
  const teamIds = Array.isArray(row.authorized_team_ids) ? row.authorized_team_ids.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 160) : [];
  if (row.record_scope === "explicit-application-or-team-scope") return Object.freeze({ sql: "$3::text IS NOT NULL AND " + alias + ".team_id=ANY($4::text[])", teamIds });
  return Object.freeze({ sql: "(" + alias + ".owner_id=$3 OR " + alias + ".team_id=ANY($4::text[]))", teamIds });
}
async function workerReportData(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, run: Row, authority: Row): Promise<unknown> {
  const scope = workerScope(authority, "r");
  const settingRows = await client.query<Row>("SELECT values_json FROM k_nex_system_settings_documents WHERE application_id=$1 AND environment=$2 AND descriptor_id='system.general' AND owner_scope_key='platform:system' AND descriptor_schema_version=3 FOR SHARE", [run.application_id, run.environment]);
  const setting = record(record(settingRows.rows[0]).values_json);
  if (typeof setting.reportingCurrency !== "string" || typeof setting.reportingTimezone !== "string") throw new Error("REPORT_AUTHORITY_STALE");
  let reportingScale: number; try { reportingScale = currencyScale(setting.reportingCurrency); } catch { throw new Error("REPORT_AUTHORITY_STALE"); }
  const scopedBase = [run.application_id, run.environment, run.recipient_id, scope.teamIds, setting.reportingCurrency];
  const moneyBase = [...scopedBase, reportingScale];
  const id = String(run.report_id); const mode = String(run.window_mode);
  if (id === "sales.report.pipeline-value-by-stage") { await assertSingleWorkerCurrency(client, run, authority, String(setting.reportingCurrency)); const result = await client.query<Row>("SELECT r.stage_id::text AS stage_id,s.name AS stage_name,round(coalesce(sum(r.amount::numeric),0),$6::integer)::text AS value FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=$2 AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=$1 AND r.environment=$2 AND r.archive_status='active' AND s.semantic NOT IN ('won','lost') AND r.currency=$5 AND (" + scope.sql + ") GROUP BY r.stage_id,s.name,s.position ORDER BY s.position,r.stage_id LIMIT 6", moneyBase); return table(["stage-id", "stage-name", "value"], result.rows.map((row) => ({ "stage-id": Object.freeze({ kind: "enum", value: String(row.stage_id) }), "stage-name": Object.freeze({ kind: "text", value: String(row.stage_name) }), value: Object.freeze({ kind: "money", value: String(row.value ?? "0"), currency: String(setting.reportingCurrency), scale: reportingScale }) })));
  }
  if (id === "sales.report.weighted-forecast") { await assertSingleWorkerCurrency(client, run, authority, String(setting.reportingCurrency)); const result = await client.query<Row>("SELECT round(coalesce(sum(r.amount::numeric * s.probability_basis_points / 10000),0),$6::integer)::text AS value FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=$2 AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=$1 AND r.environment=$2 AND r.archive_status='active' AND r.currency=$5 AND s.semantic NOT IN ('won','lost') AND (" + scope.sql + ")", moneyBase); return metric(result.rows[0]?.value, "money", String(setting.reportingCurrency), reportingScale); }
  if (id === "sales.report.won-lost-conversion") { const result = await client.query<Row>("SELECT round(100.0*sum(CASE WHEN s.semantic='won' THEN 1 ELSE 0 END)/nullif(count(*),0),2)::text AS value FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=$1 AND r.environment=$2 AND $5::text IS NOT NULL AND s.semantic IN ('won','lost') AND (" + scope.sql + ") AND r.closed_at IS NOT NULL AND (" + workerWindow("r.closed_at", mode, 6) + ")", [...scopedBase, setting.reportingTimezone]); return metric(result.rows[0]?.value, "percent"); }
  if (id === "sales.report.lead-conversion") { const result = await client.query<Row>("SELECT round(100.0*sum(CASE WHEN status='qualified' THEN 1 ELSE 0 END)/nullif(count(*),0),2)::text AS value FROM sales_leads r WHERE r.application_id=$1 AND r.environment=$2 AND $5::text IS NOT NULL AND r.status IN ('qualified','disqualified') AND (" + scope.sql + ") AND r.decided_at IS NOT NULL AND (" + workerWindow("r.decided_at", mode, 6) + ")", [...scopedBase, setting.reportingTimezone]); return metric(result.rows[0]?.value, "percent"); }
  if (id === "sales.report.activity-by-owner-team") { const result = await client.query<Row>("SELECT r.actor_id::text AS actor_id,r.team_id::text AS team_id,count(*)::integer AS count FROM sales_activities r WHERE r.application_id=$1 AND r.environment=$2 AND $5::text IS NOT NULL AND r.occurred_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales_activities successor WHERE successor.application_id=r.application_id AND successor.environment=r.environment AND successor.supersedes_activity_id=r.id) AND (" + scope.sql + ") AND (" + workerWindow("r.occurred_at", mode, 6) + ") GROUP BY r.actor_id,r.team_id ORDER BY r.actor_id,r.team_id LIMIT 100", [...scopedBase, setting.reportingTimezone]); return table(["actor-id", "team-id", "count"], result.rows.map((row) => ({ "actor-id": Object.freeze({ kind: "text", value: String(row.actor_id) }), "team-id": row.team_id === null || row.team_id === undefined ? null : Object.freeze({ kind: "text", value: String(row.team_id) }), count: Object.freeze({ kind: "integer", value: Number(row.count) }) })) as Row[]); }
  if (id === "sales.report.task-aging") { const result = await client.query<Row>("WITH today(value) AS (VALUES ((now() AT TIME ZONE $6)::date)), buckets(bucket) AS (VALUES ('not-due'),('due-today'),('1-7'),('8-30'),('31-plus')) SELECT bucket,count FROM buckets CROSS JOIN today LEFT JOIN LATERAL (SELECT count(*)::integer AS count FROM sales_tasks r WHERE r.application_id=$1 AND r.environment=$2 AND $5::text IS NOT NULL AND r.status='open' AND (" + scope.sql + ") AND ((bucket='not-due' AND (r.due_date IS NULL OR r.due_date::date>today.value)) OR (bucket='due-today' AND r.due_date::date=today.value) OR (bucket='1-7' AND r.due_date::date BETWEEN today.value-7 AND today.value-1) OR (bucket='8-30' AND r.due_date::date BETWEEN today.value-30 AND today.value-8) OR (bucket='31-plus' AND r.due_date::date<=today.value-31))) c ON true ORDER BY CASE bucket WHEN 'not-due' THEN 1 WHEN 'due-today' THEN 2 WHEN '1-7' THEN 3 WHEN '8-30' THEN 4 ELSE 5 END", [...scopedBase, setting.reportingTimezone]); return table(["bucket", "count"], result.rows.map((row) => ({ bucket: Object.freeze({ kind: "enum", value: String(row.bucket) }), count: Object.freeze({ kind: "integer", value: Number(row.count) }) })) as Row[]); }
  const result = await client.query<Row>("WITH durations AS (SELECT floor(greatest(extract(epoch FROM (r.closed_at AT TIME ZONE 'UTC' - r.created_at AT TIME ZONE 'UTC')),0)/86400.0)::numeric AS whole_days FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=$1 AND r.environment=$2 AND $5::text IS NOT NULL AND s.semantic IN ('won','lost') AND r.closed_at IS NOT NULL AND (" + scope.sql + ") AND (" + workerWindow("r.closed_at", mode, 6) + ")), ordered AS (SELECT whole_days,row_number() OVER (ORDER BY whole_days) AS position,count(*) OVER () AS cardinality,lead(whole_days) OVER (ORDER BY whole_days) AS next_whole_days FROM durations) SELECT coalesce(nullif(trim(trailing '.' from trim(trailing '0' from (CASE WHEN cardinality % 2 = 1 THEN whole_days ELSE (whole_days + next_whole_days)/2 END)::text)),''),'0') AS value FROM ordered WHERE position=CASE WHEN cardinality % 2 = 1 THEN (cardinality+1)/2 ELSE cardinality/2 END LIMIT 1", [...scopedBase, setting.reportingTimezone]); return metric(result.rows[0]?.value ?? null, "days");
}
async function workerReportRecordCount(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, run: Row, authority: Row, reportingCurrency: string, reportingTimezone: string): Promise<number> {
  const scope = workerScope(authority, "r");
  const base = [run.application_id, run.environment, run.recipient_id, scope.teamIds, reportingCurrency];
  const id = String(run.report_id); const mode = String(run.window_mode);
  let result: { rows: readonly Row[] };
  if (id === "sales.report.pipeline-value-by-stage" || id === "sales.report.weighted-forecast") result = await client.query<Row>("SELECT count(*)::integer AS count FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=$2 AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=$1 AND r.environment=$2 AND r.archive_status='active' AND r.currency=$5 AND s.semantic NOT IN ('won','lost') AND (" + scope.sql + ")", base);
  else if (id === "sales.report.won-lost-conversion" || id === "sales.report.sales-cycle-duration") result = await client.query<Row>("SELECT count(*)::integer AS count FROM sales_opportunities r JOIN sales_pipeline_stages s ON s.application_id=r.application_id AND s.environment=r.environment AND s.pipeline_id=r.pipeline_id AND s.stage_id=r.stage_id WHERE r.application_id=$1 AND r.environment=$2 AND $5::text IS NOT NULL AND s.semantic IN ('won','lost') AND r.closed_at IS NOT NULL AND (" + scope.sql + ") AND (" + workerWindow("r.closed_at", mode, 6) + ")", [...base, reportingTimezone]);
  else if (id === "sales.report.lead-conversion") result = await client.query<Row>("SELECT count(*)::integer AS count FROM sales_leads r WHERE r.application_id=$1 AND r.environment=$2 AND $5::text IS NOT NULL AND r.status IN ('qualified','disqualified') AND r.decided_at IS NOT NULL AND (" + scope.sql + ") AND (" + workerWindow("r.decided_at", mode, 6) + ")", [...base, reportingTimezone]);
  else if (id === "sales.report.activity-by-owner-team") result = await client.query<Row>("SELECT count(*)::integer AS count FROM sales_activities r WHERE r.application_id=$1 AND r.environment=$2 AND $5::text IS NOT NULL AND r.occurred_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales_activities successor WHERE successor.application_id=r.application_id AND successor.environment=r.environment AND successor.supersedes_activity_id=r.id) AND (" + scope.sql + ") AND (" + workerWindow("r.occurred_at", mode, 6) + ")", [...base, reportingTimezone]);
  else result = await client.query<Row>("SELECT count(*)::integer AS count FROM sales_tasks r WHERE r.application_id=$1 AND r.environment=$2 AND $5::text IS NOT NULL AND r.status='open' AND (" + scope.sql + ")", base);
  const count = Number(result.rows[0]?.count); if (!Number.isSafeInteger(count) || count < 0) throw new Error("REPORT_RECORD_COUNT_INVALID"); return count;
}
async function persistedReportSourceWatermark(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, run: Row): Promise<string> {
  const result = await client.query<Row>("SELECT revision FROM sales_report_source_watermarks WHERE application_id=$1 AND environment=$2 AND source_id=$3 FOR SHARE", [run.application_id, run.environment, run.report_id]);
  const revision = Number(result.rows[0]?.revision);
  if (result.rows.length !== 1 || !Number.isSafeInteger(revision) || revision < 1) throw new Error("REPORT_SOURCE_WATERMARK_INVALID");
  return digest({ applicationId: String(run.application_id), environment: String(run.environment), sourceId: String(run.report_id), revision });
}
async function persistedInteractiveSourceWatermark(db: { execute(query: unknown): Promise<unknown> }, input: GeneratedSalesReportReadCall): Promise<void> {
  const result = rows(await db.execute(sql`SELECT revision FROM sales_report_source_watermarks WHERE application_id=${input.applicationId} AND environment=${input.environment} AND source_id=${input.reportId} FOR SHARE`));
  const revision = Number(record(result[0]).revision);
  if (result.length !== 1 || !Number.isSafeInteger(revision) || revision < 1) sourceError("SOURCE_UNAVAILABLE", 503, "Report source watermark is unavailable.");
}
async function workerReport(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, run: Row, authority: Row): Promise<GeneratedSalesReportResult> {
  const settingRows = await client.query<Row>("SELECT d.descriptor_schema_version,d.document_revision,d.values_json,d.settings_revision,s.settings_revision AS state_revision FROM k_nex_system_settings_documents d JOIN k_nex_system_settings_state s ON s.application_id=d.application_id AND s.environment=d.environment WHERE d.application_id=$1 AND d.environment=$2 AND d.descriptor_id='system.general' AND d.owner_scope_key='platform:system' AND d.descriptor_schema_version=3 FOR SHARE", [run.application_id, run.environment]);
  const settingRow = settingRows.rows[0]; const setting = record(record(settingRow).values_json); const settingsRevision = Number(settingRow?.settings_revision);
  if (settingRows.rows.length !== 1 || settingRow?.descriptor_schema_version !== 3 || !Number.isSafeInteger(settingRow.document_revision) || Number(settingRow.document_revision) < 1 || typeof setting.reportingCurrency !== "string" || typeof setting.reportingTimezone !== "string" || !Number.isSafeInteger(settingsRevision) || settingsRevision < 1 || settingRow.settings_revision !== settingRow.state_revision || run.settings_revision !== null && run.settings_revision !== undefined && Number(run.settings_revision) !== settingsRevision || run.reporting_currency !== null && run.reporting_currency !== undefined && String(run.reporting_currency) !== String(setting.reportingCurrency) || run.reporting_timezone !== null && run.reporting_timezone !== undefined && String(run.reporting_timezone) !== String(setting.reportingTimezone)) throw new Error("REPORT_AUTHORITY_STALE");
  let reportingScale: number; try { reportingScale = currencyScale(setting.reportingCurrency); } catch { throw new Error("REPORT_AUTHORITY_STALE"); } const runtimeGenerationId = run.runtime_generation_id;
  if (typeof runtimeGenerationId !== "string" || runtimeGenerationId.length === 0) throw new Error("REPORT_AUTHORITY_STALE");
  const data = await workerReportData(client, run, authority); const authorizedRecordCount = await workerReportRecordCount(client, run, authority, setting.reportingCurrency, setting.reportingTimezone); const clock = (await client.query<Row>("SELECT extract(epoch FROM transaction_timestamp()) * 1000 AS epoch_ms")).rows[0]; const asOf = Number(record(clock).epoch_ms); if (!Number.isFinite(asOf)) throw new Error("REPORT_SNAPSHOT_INVALID"); const metadata = Object.freeze({ applicationId: String(run.application_id), environment: String(run.environment), source: Object.freeze({ id: String(run.report_id), version: Number(run.source_version ?? 1) }), sourceSchema: Object.freeze({ id: String(run.report_id) + ".output", version: Number(run.source_schema_version ?? 1) }), authorizationRevision: Number(run.authorization_revision), lifecycleRevision: Number(run.lifecycle_revision), salesScopeRevision: Number(run.scope_revision), settingsRevision, reportingTimezone: String(setting.reportingTimezone), reportingCurrency: String(setting.reportingCurrency), currencyScale: reportingScale, asOf: new Date(asOf).toISOString(), windowMode: run.window_mode as GeneratedSalesReportWindow, grouping: reportGrouping(run.report_id as GeneratedSalesReportId), authorizedRecordCount });
  return Object.freeze({ data, metadata: Object.freeze({ ...metadata, executionDigest: digest(metadata) }) });
}
function csvCell(value: unknown): string { const text = typeof value === "string" ? value : JSON.stringify(value); return '"' + String(text ?? "").replace(/"/gu, '""') + '"'; }
async function currentReportRecipient(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, recipientId: unknown, applicationId: unknown): Promise<{ rows: readonly Row[] }> {
  return await client.query<Row>("SELECT u.id FROM users u WHERE u.id::text=$1 AND EXISTS (SELECT 1 FROM k_nex_role_assignments ra JOIN k_nex_role_permission_grants rg ON rg.application_id=ra.application_id AND rg.role_id=ra.role_id AND rg.permission_id='sales.reports.read' JOIN k_nex_extension_authorization_generations x ON x.application_id=rg.application_id AND x.delivery_class=rg.owner_delivery_class AND x.extension_id=rg.owner_extension_id AND x.authorization_generation=rg.owner_generation AND x.state='current' WHERE ra.application_id=$2 AND ra.subject_kind='user' AND ra.subject_id=$1 AND ra.state='active' AND rg.owner_kind='extension' AND rg.owner_delivery_class='platform-plugin' AND rg.owner_extension_id='module.sales' AND NOT EXISTS (SELECT 1 FROM k_nex_permission_catalog_snapshots c WHERE c.application_id=rg.application_id AND c.owner_kind='extension' AND c.owner_delivery_class=rg.owner_delivery_class AND c.owner_extension_id=rg.owner_extension_id AND c.owner_generation=rg.owner_generation AND c.state IN ('inactive-extension-disabled','inactive-extension-not-ready')))", [recipientId, applicationId]);
}
async function currentReportPermission(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, recipientId: unknown, applicationId: unknown, permissionId: string): Promise<boolean> {
  const result = await client.query<Row>("SELECT 1 FROM users u WHERE u.id::text=$1 AND EXISTS (SELECT 1 FROM k_nex_role_assignments ra JOIN k_nex_role_permission_grants rg ON rg.application_id=ra.application_id AND rg.role_id=ra.role_id AND rg.permission_id=$3 JOIN k_nex_extension_authorization_generations x ON x.application_id=rg.application_id AND x.delivery_class=rg.owner_delivery_class AND x.extension_id=rg.owner_extension_id AND x.authorization_generation=rg.owner_generation AND x.state='current' WHERE ra.application_id=$2 AND ra.subject_kind='user' AND ra.subject_id=$1 AND ra.state='active' AND rg.owner_kind='extension' AND rg.owner_delivery_class='platform-plugin' AND rg.owner_extension_id='module.sales' AND NOT EXISTS (SELECT 1 FROM k_nex_permission_catalog_snapshots c WHERE c.application_id=rg.application_id AND c.owner_kind='extension' AND c.owner_delivery_class=rg.owner_delivery_class AND c.owner_extension_id=rg.owner_extension_id AND c.owner_generation=rg.owner_generation AND c.state IN ('inactive-extension-disabled','inactive-extension-not-ready')))", [recipientId, applicationId, permissionId]);
  return result.rows.length === 1;
}
async function currentRuntimeGeneration(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, applicationId: unknown): Promise<string | undefined> {
  const result = await client.query<Row>("SELECT runtime_generation_ids FROM k_nex_extension_authorization_generations WHERE application_id=$1 AND delivery_class='platform-plugin' AND extension_id='module.sales' AND state='current' FOR SHARE", [applicationId]);
  const ids = result.rows.length === 1 && Array.isArray(result.rows[0]?.runtime_generation_ids) ? result.rows[0]!.runtime_generation_ids : [];
  return ids.length === 1 && typeof ids[0] === "string" ? ids[0] : undefined;
}
function requiredReportPermissionsForOrigin(reportId: string, scheduled: boolean): readonly string[] {
  const objectPermission = reportId === "sales.report.lead-conversion" ? "sales.leads.read" : reportId === "sales.report.activity-by-owner-team" ? "sales.activities.read" : reportId === "sales.report.task-aging" ? "sales.tasks.read" : "sales.opportunities.read";
  return [scheduled ? "sales.reports.schedule" : "sales.exports.execute", "sales.reports.read", objectPermission, ...(reportId === "sales.report.pipeline-value-by-stage" || reportId === "sales.report.weighted-forecast" ? ["sales.pipelines.read", "sales.opportunities.amount.read"] : reportId === "sales.report.sales-cycle-duration" || reportId === "sales.report.won-lost-conversion" ? ["sales.pipelines.read"] : [])];
}
function reportGrant(permission: string): boolean { return permission === "sales.exports.execute" || permission === "sales.reports.read" || permission === "sales.reports.schedule"; }
function fieldGrant(permission: string): boolean { return permission === "sales.opportunities.amount.read"; }
type CurrentReportPermissionSnapshot = Readonly<{ all: boolean; report: readonly string[]; object: readonly string[]; field: readonly string[] }>;
async function currentReportPermissionSnapshot(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, recipientId: unknown, applicationId: unknown, reportId: string, includeSchedule: boolean): Promise<CurrentReportPermissionSnapshot> {
  const required = requiredReportPermissionsForOrigin(reportId, true);
  const checked = await Promise.all(required.map(async (permission) => Object.freeze({ permission, granted: await currentReportPermission(client, recipientId, applicationId, permission) })));
  return Object.freeze({ all: checked.every((entry) => entry.granted), report: Object.freeze(checked.filter((entry) => entry.granted && reportGrant(entry.permission)).map((entry) => entry.permission)), object: Object.freeze(checked.filter((entry) => entry.granted && !reportGrant(entry.permission) && !fieldGrant(entry.permission)).map((entry) => entry.permission)), field: Object.freeze(checked.filter((entry) => entry.granted && fieldGrant(entry.permission)).map((entry) => entry.permission)) });
}
function workerHasPersistedPermission(run: Row, permission: string): boolean {
  const values = reportGrant(permission) ? run.report_permission_grants : fieldGrant(permission) ? run.field_permission_grants : run.object_permission_grants;
  return Array.isArray(values) && values.includes(permission);
}
async function processRun(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, run: Row, fence: GeneratedSalesReportWorkerFence): Promise<void> {
  const lock = await client.query("SELECT * FROM sales_report_runs WHERE run_id=$1 AND state='running' AND worker_generation_id=$2 AND worker_fencing_token=$3 AND worker_promotion_revision=$4 AND worker_lease_owner=$5 AND lease_expires_at>now() FOR UPDATE", [run.run_id, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
  if (lock.rows.length !== 1 || !await liveFence(client, fence)) return;
  const current = lock.rows[0] as Row; const recipient = await currentReportRecipient(client, current.recipient_id, current.application_id);
  if (recipient.rows.length !== 1) {
    const failed = await client.query("UPDATE sales_report_runs SET state='dead-letter',failure_code='REPORT_RECIPIENT_FORBIDDEN',revision=revision+1,terminal_at=now(),worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE run_id=$1 AND state='running' AND revision=$2 RETURNING *", [current.run_id, current.revision]);
    if (failed.rows.length === 1) await appendWorkerEvidence(client, failed.rows[0] as Row, "running", "dead-letter", "REPORT_RECIPIENT_FORBIDDEN");
    return;
  }
  const authorityResult = await client.query<Row>("SELECT a.authorization_revision,a.lifecycle_revision,s.revision,s.record_scope,s.application_wide,s.authorized_team_ids FROM k_nex_authorization_state a JOIN sales_current_authority_scopes s ON s.application_id=a.application_id AND s.environment=$2 AND s.principal_id=$3 AND s.state='active' WHERE a.application_id=$1 AND a.authorization_revision=$4 AND a.lifecycle_revision=$5 AND s.revision=$6 FOR SHARE", [current.application_id, current.environment, current.recipient_id, current.authorization_revision, current.lifecycle_revision, current.scope_revision]);
  if (authorityResult.rows.length !== 1) { const failed = await client.query("UPDATE sales_report_runs SET state='dead-letter',failure_code='REPORT_AUTHORITY_STALE',revision=revision+1,terminal_at=now(),worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE run_id=$1 AND state='running' AND revision=$2 RETURNING *", [current.run_id, current.revision]); if (failed.rows.length === 1) await appendWorkerEvidence(client, failed.rows[0] as Row, "running", "dead-letter", "REPORT_AUTHORITY_STALE"); return; }
  const authority = Object.freeze({ ...(authorityResult.rows[0] as Row), authorized_team_ids: authorityResult.rows[0]!.authorized_team_ids, runtime_generation_id: current.runtime_generation_id, report_permission_grants: current.report_permission_grants, object_permission_grants: current.object_permission_grants, field_permission_grants: current.field_permission_grants });
  const requiredPermissions = requiredReportPermissionsForOrigin(String(current.report_id), current.scheduled_for !== null && current.scheduled_for !== undefined);
  const runtimeGeneration = await currentRuntimeGeneration(client, current.application_id);
  const recipientAllowed = validId(current.report_id) && requiredPermissions.every((permission) => workerHasPersistedPermission(current, permission)) && current.runtime_generation_id === runtimeGeneration && (await Promise.all(requiredPermissions.map((permission) => currentReportPermission(client, current.recipient_id, current.application_id, permission)))).every(Boolean);
  if (!recipientAllowed) {
    const failed = await client.query<Row>("UPDATE sales_report_runs SET state='dead-letter',failure_code='REPORT_RECIPIENT_FORBIDDEN',revision=revision+1,terminal_at=now(),worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE run_id=$1 AND state='running' AND revision=$2 RETURNING *", [current.run_id, current.revision]);
    if (failed.rows.length === 1) await appendWorkerEvidence(client, failed.rows[0] as Row, "running", "dead-letter", "REPORT_RECIPIENT_FORBIDDEN"); return;
  }
  const sourceWatermark = await persistedReportSourceWatermark(client, current);
  const value = await workerReport(client, current, authority);
  const executionMetadata = value.metadata;
  const executionMetadataJson = JSON.stringify(executionMetadata);
  const bytes = Buffer.from("reportId,windowMode,value\r\n" + csvCell(current.report_id) + "," + csvCell(current.window_mode) + "," + csvCell(value.data) + "\r\n", "utf8");
  if (bytes.length > 1_048_576) throw new Error("Report artifact exceeds one MiB.");
  const artifactId = "report-artifact-" + randomUUID(); const artifactDigest = sha256(bytes);
  await client.query("INSERT INTO sales_report_artifacts(artifact_id,run_id,bytes,digest,byte_length,content_type,created_at,expires_at,metadata,metadata_digest) VALUES($1,$2,$3,$4,$5,'text/csv',now(),now()+interval '30 days',$6::jsonb,$7)", [artifactId, current.run_id, bytes, artifactDigest, bytes.length, executionMetadataJson, executionMetadata.executionDigest]);
  const completed = await client.query("UPDATE sales_report_runs SET state='succeeded',artifact_id=$1,artifact_digest=$2,source_id=$3,source_version=$4,source_schema_version=$5,grouping=$6,reporting_timezone=$7,reporting_currency=$8,settings_revision=$9,as_of=$10::timestamptz,authorized_record_count=$11,source_watermark=$12,runtime_generation_id=$13,execution_metadata=$14::jsonb,execution_metadata_digest=$15,revision=revision+1,terminal_at=now(),worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE run_id=$16 AND state='running' AND revision=$17 RETURNING *", [artifactId, artifactDigest, executionMetadata.source.id, executionMetadata.source.version, executionMetadata.sourceSchema.version, executionMetadata.grouping, executionMetadata.reportingTimezone, executionMetadata.reportingCurrency, executionMetadata.settingsRevision, executionMetadata.asOf, executionMetadata.authorizedRecordCount, sourceWatermark, current.runtime_generation_id, executionMetadataJson, executionMetadata.executionDigest, current.run_id, current.revision]);
  if (completed.rows.length !== 1) throw new Error("Report completion fence failed.");
  const deliveryEvidence = Object.freeze({ recipientId: current.recipient_id, artifactDigest, executionMetadata, executionDigest: executionMetadata.executionDigest });
  await client.query("INSERT INTO sales_report_delivery_receipts(receipt_id,run_id,application_id,environment,recipient_id,artifact_digest,delivered_at,evidence,digest,metadata,metadata_digest) VALUES($1,$2,$3,$4,$5,$6,now(),$7::jsonb,$8,$9::jsonb,$10)", ["report-delivery-" + current.run_id, current.run_id, current.application_id, current.environment, current.recipient_id, artifactDigest, JSON.stringify(deliveryEvidence), digest(deliveryEvidence), executionMetadataJson, executionMetadata.executionDigest]);
  await appendWorkerEvidence(client, completed.rows[0] as Row, "running", "succeeded", null);
}
async function appendWorkerEvidence(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, run: Row, fromState: string, toState: string, failureCode: string | null, actionId = "sales.job.report-delivery"): Promise<void> {
  const revision = Number(run.revision); const executionMetadata = run.execution_metadata !== undefined && run.execution_metadata !== null && typeof run.execution_metadata === "object" ? run.execution_metadata : undefined; const evidence = Object.freeze({ applicationId: run.application_id, environment: run.environment, runId: run.run_id, reportId: run.report_id, fromState, toState, revision, actionId, actorId: run.recipient_id, idempotencyKey: run.idempotency_key, ...(executionMetadata === undefined ? {} : { executionMetadata, executionDigest: run.execution_metadata_digest }), ...(failureCode === null ? {} : { failureCode }), occurredAt: now() }); const eventId = "sales-report-run-" + run.run_id + "-" + String(revision);
  const audit = await client.query("WITH changed AS (UPDATE sales_report_runs SET audit=coalesce(audit,'[]'::jsonb)||$9::jsonb,updated_at=now() WHERE run_id=$2 AND revision=$5 RETURNING run_id), evidence AS (INSERT INTO sales_report_run_audit(audit_id,run_id,application_id,environment,revision,from_state,to_state,action_id,evidence,digest,occurred_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() FROM changed RETURNING audit_id) SELECT audit_id FROM evidence", [eventId + "-audit", run.run_id, run.application_id, run.environment, revision, fromState, toState, actionId, JSON.stringify(evidence), digest(evidence)]); if (audit.rows.length !== 1) throw new Error("Report audit collision.");
  const outbox = await client.query("INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) VALUES($1,'sales.event.report-run-changed',1,'durable-integration',now(),$2,'module.sales',$3,'system',$4,$4,$1,$5::jsonb,'pending',now()+interval '30 days') ON CONFLICT(event_id) DO NOTHING RETURNING event_id", [eventId, run.application_id, run.recipient_id, run.run_id, JSON.stringify({ runId: run.run_id, state: toState, revision })]); if (outbox.rows.length !== 1) throw new Error("Report transition event collision.");
}
async function requeueReportRun(pool: RuntimeExtensionPool, fence: GeneratedSalesReportWorkerFence, runId: string, failureCode: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!await liveFence(client, fence)) { await client.query("ROLLBACK"); return; }
    const locked = await client.query<Row>("SELECT * FROM sales_report_runs WHERE run_id=$1 AND application_id=$2 AND environment=$3 AND state='running' AND worker_generation_id=$4 AND worker_fencing_token=$5 AND worker_promotion_revision=$6 AND worker_lease_owner=$7 FOR UPDATE", [runId, fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
    const current = locked.rows[0];
    if (current !== undefined) {
      const attempts = Number(current.attempt); const authoritativeFailure = failureCode === "REPORT_AUTHORITY_STALE" || failureCode === "REPORT_CURRENCY_MIXED"; const terminal = attempts >= 3 || authoritativeFailure; const nextState = terminal ? "dead-letter" : "queued"; const nextCode = terminal && !authoritativeFailure ? "REPORT_RETRY_EXHAUSTED" : failureCode;
      const changed = await client.query<Row>("UPDATE sales_report_runs SET state=$1,failure_code=$2,next_attempt_at=CASE WHEN $3::boolean THEN next_attempt_at ELSE now()+CASE WHEN attempt=1 THEN interval '15 seconds' ELSE interval '30 seconds' END END,revision=revision+1,terminal_at=CASE WHEN $3::boolean THEN now() ELSE NULL END,worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE run_id=$4 AND revision=$5 AND state='running' RETURNING *", [nextState, nextCode, terminal, runId, current.revision]);
      if (changed.rows.length === 1) await appendWorkerEvidence(client, changed.rows[0] as Row, "running", nextState, nextCode);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}
async function appendWorkerScheduleEvidence(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, schedule: Row, fromState: string, toState: string, revision: number, idempotencyKey: string, failureCode: string | null = null): Promise<void> {
  const evidence = Object.freeze({ applicationId: schedule.application_id, environment: schedule.environment, scheduleId: schedule.schedule_id, reportId: schedule.report_id, recipientId: schedule.recipient_id, fromState, toState, revision, actionId: "sales.report.schedule", actorId: schedule.recipient_id, idempotencyKey, ...(failureCode === null ? {} : { failureCode }), occurredAt: now() }); const eventId = "sales-report-schedule-" + schedule.schedule_id + "-" + String(revision);
  const audit = await client.query("WITH changed AS (UPDATE sales_report_schedules SET audit=coalesce(audit,'[]'::jsonb)||$6::jsonb,updated_at=now() WHERE schedule_id=$2 AND revision=$5 RETURNING schedule_id), evidence AS (INSERT INTO sales_report_schedule_audit(audit_id,schedule_id,application_id,environment,revision,evidence,digest,occurred_at) SELECT $1,$2,$3,$4,$5,$6::jsonb,$7,now() FROM changed RETURNING audit_id) SELECT audit_id FROM evidence", [eventId + "-audit", schedule.schedule_id, schedule.application_id, schedule.environment, revision, JSON.stringify(evidence), digest(evidence)]);
  if (audit.rows.length !== 1) throw new Error("Report schedule audit collision.");
  const outbox = await client.query("INSERT INTO k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) VALUES($1,'sales.event.report-run-changed',1,'durable-integration',now(),$2,'module.sales',$3,'system',$4,$4,$1,$5::jsonb,'pending',now()+interval '30 days') ON CONFLICT(event_id) DO NOTHING RETURNING event_id", [eventId, schedule.application_id, schedule.recipient_id, schedule.schedule_id, JSON.stringify({ scheduleId: schedule.schedule_id, reportId: schedule.report_id, state: toState, revision })]);
  if (outbox.rows.length !== 1) throw new Error("Report schedule transition event collision.");
}
async function enqueueDueReportSchedules(client: { query<T extends object = Row>(text: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> }, fence: GeneratedSalesReportWorkerFence): Promise<void> {
  const due = await client.query<Row>("SELECT * FROM sales_report_schedules WHERE application_id=$1 AND environment=$2 AND state='active' AND next_run_at IS NOT NULL AND next_run_at<=now() ORDER BY next_run_at,schedule_id FOR UPDATE SKIP LOCKED LIMIT 16", [fence.applicationId, fence.environment]);
  for (const schedule of due.rows) {
    const scheduleId = String(schedule.schedule_id); const recipientId = String(schedule.recipient_id); const reportId = schedule.report_id; const windowMode = schedule.window_mode;
    const recipient = await currentReportRecipient(client, recipientId, fence.applicationId);
    const authority = await client.query<Row>("SELECT a.authorization_revision,a.lifecycle_revision,s.revision,s.record_scope,s.application_wide,s.authorized_team_ids FROM k_nex_authorization_state a JOIN sales_current_authority_scopes s ON s.application_id=a.application_id AND s.environment=$2 AND s.principal_id=$3 AND s.state='active' AND s.mutation_allowed=true WHERE a.application_id=$1 FOR SHARE", [fence.applicationId, fence.environment, recipientId]);
    const settingRows = await client.query<Row>("SELECT d.descriptor_schema_version,d.document_revision,d.settings_revision,d.values_json,s.settings_revision AS state_revision FROM k_nex_system_settings_documents d JOIN k_nex_system_settings_state s ON s.application_id=d.application_id AND s.environment=d.environment WHERE d.application_id=$1 AND d.environment=$2 AND d.descriptor_id='system.general' AND d.owner_scope_key='platform:system' AND d.descriptor_schema_version=3 FOR SHARE", [fence.applicationId, fence.environment]);
    const settingRow = settingRows.rows[0]; const setting = settingRows.rows.length === 1 && settingRow?.values_json !== null && typeof settingRow?.values_json === "object" && !Array.isArray(settingRow?.values_json) ? record(settingRow.values_json) : undefined;
    const settingReady = setting !== undefined && settingRow?.descriptor_schema_version === 3 && Number.isSafeInteger(settingRow.document_revision) && Number(settingRow.document_revision) >= 1 && Number.isSafeInteger(settingRow.settings_revision) && settingRow.settings_revision === settingRow.state_revision && typeof setting.reportingCurrency === "string" && typeof setting.reportingTimezone === "string";
    const permissionSnapshot = validId(reportId) ? await currentReportPermissionSnapshot(client, recipientId, fence.applicationId, String(reportId), true) : Object.freeze({ all: false, report: Object.freeze([]), object: Object.freeze([]), field: Object.freeze([]) });
    const currentGeneration = await currentRuntimeGeneration(client, fence.applicationId);
    const authorityRow = authority.rows[0];
    const authorityReady = authorityRow !== undefined && Number(authorityRow.authorization_revision) === Number(schedule.authorization_revision) && Number(authorityRow.lifecycle_revision) === Number(schedule.lifecycle_revision) && Number(authorityRow.revision) === Number(schedule.scope_revision);
    const scheduleSnapshotReady = validId(reportId) && currentGeneration === fence.activeExecutionGeneration;
    const validScheduleWindow = validId(reportId) && validWindow(reportId, windowMode);
    const timezone = setting?.reportingTimezone; const scheduledValue = schedule.next_run_at instanceof Date ? schedule.next_run_at : new Date(String(schedule.next_run_at));
    if (String(schedule.creator_id) !== recipientId || recipient.rows.length !== 1 || !authorityReady || !validScheduleWindow || !settingReady || timezone === undefined || typeof timezone !== "string" || Number.isNaN(scheduledValue.getTime()) || !permissionSnapshot.all || !scheduleSnapshotReady) {
      const cancelled = await client.query<Row>("UPDATE sales_report_schedules SET state='cancelled',next_run_at=NULL,revision=revision+1,updated_at=now() WHERE schedule_id=$1 AND state='active' AND revision=$2 RETURNING *", [scheduleId, schedule.revision]);
      if (cancelled.rows.length === 1) await appendWorkerScheduleEvidence(client, cancelled.rows[0]!, "active", "cancelled", Number(cancelled.rows[0]!.revision), "schedule-revoked-" + scheduleId, "REPORT_AUTHORITY_STALE");
      continue;
    }
    const nextRun = (await client.query<Row>("SELECT (($1::timestamptz AT TIME ZONE $2 + interval '7 days') AT TIME ZONE $2) AS next_run_at", [scheduledValue, timezone])).rows[0]?.next_run_at;
    const nextDate = nextRun instanceof Date ? nextRun : new Date(String(nextRun)); if (Number.isNaN(nextDate.getTime())) throw new Error("Report schedule next-run calculation failed.");
    const scheduledFor = scheduledValue.toISOString(); const identityDigest = sha256(canonicalJson({ applicationId: fence.applicationId, environment: fence.environment, scheduleId, scheduledFor, reportId, windowMode, recipientId })); const identity = identityDigest.slice("sha256:".length);
    const runId = "report-run-schedule-" + identity; const idempotencyKey = "report-schedule-" + identity; const reportDigest = digest({ applicationId: fence.applicationId, environment: fence.environment, reportId, windowMode, recipientId, scheduledFor, actionId: "sales.report.schedule", idempotencyKey });
    const inserted = await client.query<Row>("INSERT INTO sales_report_runs(run_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,scheduled_for,requested_at,authorization_revision,lifecycle_revision,scope_revision,settings_revision,reporting_timezone,reporting_currency,report_revision,report_digest,idempotency_key,state,revision,attempt,next_attempt_at,audit,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$12,$13,$14,$15,$16,$17,1,$10,$11,'queued',1,0,now(),'[]'::jsonb,now(),now()) ON CONFLICT(application_id,environment,idempotency_key) DO NOTHING RETURNING *", [runId, fence.applicationId, fence.environment, schedule.creator_id, recipientId, reportId, windowMode, scheduledValue, now(), reportDigest, idempotencyKey, authority.rows[0]!.authorization_revision, authority.rows[0]!.lifecycle_revision, authority.rows[0]!.revision, settingRow!.settings_revision, setting!.reportingTimezone, setting!.reportingCurrency]);
    if (inserted.rows.length === 1) await appendWorkerEvidence(client, inserted.rows[0]!, "absent", "queued", null, "sales.report.schedule");
    else {
      const prior = (await client.query<Row>("SELECT * FROM sales_report_runs WHERE application_id=$1 AND environment=$2 AND idempotency_key=$3 FOR UPDATE", [fence.applicationId, fence.environment, idempotencyKey])).rows[0];
      if (prior === undefined || prior.report_digest !== reportDigest || prior.report_id !== reportId || prior.window_mode !== windowMode || prior.recipient_id !== recipientId || String(prior.scheduled_for) !== String(scheduledValue)) throw new Error("Report schedule idempotency conflict.");
    }
    await client.query("UPDATE sales_report_runs SET runtime_generation_id=$1,report_permission_grants=$2::jsonb,object_permission_grants=$3::jsonb,field_permission_grants=$4::jsonb WHERE run_id=$5 AND application_id=$6 AND environment=$7", [currentGeneration, JSON.stringify(permissionSnapshot.report), JSON.stringify(permissionSnapshot.object), JSON.stringify(permissionSnapshot.field), runId, fence.applicationId, fence.environment]);
    const advanced = await client.query<Row>("UPDATE sales_report_schedules SET next_run_at=$1,revision=revision+1,runtime_generation_id=$4,report_permission_grants=$5::jsonb,object_permission_grants=$6::jsonb,field_permission_grants=$7::jsonb,updated_at=now() WHERE schedule_id=$2 AND state='active' AND revision=$3 RETURNING *", [nextDate, scheduleId, schedule.revision, currentGeneration, JSON.stringify(permissionSnapshot.report), JSON.stringify(permissionSnapshot.object), JSON.stringify(permissionSnapshot.field)]);
    if (advanced.rows.length !== 1) throw new Error("Report schedule CAS failed.");
    await appendWorkerScheduleEvidence(client, advanced.rows[0]!, "active", "active", Number(advanced.rows[0]!.revision), idempotencyKey);
  }
}
export async function processGeneratedSalesReports(pool: RuntimeExtensionPool, fence: GeneratedSalesReportWorkerFence): Promise<number> {
  if (fence.applicationId.length === 0 || !(await pool.query("SELECT 1 FROM runtime_worker_generation_fences WHERE application_id=$1 AND environment=$2 AND active_execution_generation=$3 AND fencing_token=$4 AND promotion_revision=$5 AND lease_owner=$6 AND lease_expires_at>now()", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner])).rows.length) return 0;
  const client = await pool.connect(); let count = 0;
  try {
    await client.query("BEGIN");
    if (!await liveFence(client, fence)) { await client.query("ROLLBACK"); return 0; }
    await enqueueDueReportSchedules(client, fence);
    const exhausted = await client.query<Row>("SELECT * FROM sales_report_runs WHERE application_id=$1 AND environment=$2 AND state='running' AND lease_expires_at<now() AND attempt>=3 ORDER BY requested_at,run_id FOR UPDATE SKIP LOCKED LIMIT 16", [fence.applicationId, fence.environment]);
    for (const run of exhausted.rows) {
      const changed = await client.query<Row>("UPDATE sales_report_runs SET state='dead-letter',failure_code='REPORT_RETRY_EXHAUSTED',revision=revision+1,terminal_at=now(),worker_generation_id=NULL,worker_fencing_token=NULL,worker_promotion_revision=NULL,worker_lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE run_id=$1 AND state='running' AND attempt>=3 AND revision=$2 RETURNING *", [run.run_id, run.revision]);
      if (changed.rows.length === 1) await appendWorkerEvidence(client, changed.rows[0] as Row, "running", "dead-letter", "REPORT_RETRY_EXHAUSTED");
    }
    const claimed = await client.query<Row>("WITH candidates AS (SELECT run_id,state AS previous_state FROM sales_report_runs WHERE application_id=$1 AND environment=$2 AND ((state='queued' AND next_attempt_at<=now()) OR (state='running' AND lease_expires_at<now())) AND attempt<3 ORDER BY requested_at,run_id FOR UPDATE SKIP LOCKED LIMIT 16) UPDATE sales_report_runs r SET state='running',attempt=r.attempt+1,revision=r.revision+1,worker_generation_id=$3,worker_fencing_token=$4,worker_promotion_revision=$5,worker_lease_owner=$6,lease_revision=r.lease_revision+1,lease_expires_at=now()+interval '60 seconds',updated_at=now() FROM candidates c WHERE r.run_id=c.run_id RETURNING r.*,c.previous_state", [fence.applicationId, fence.environment, fence.activeExecutionGeneration, fence.fencingToken, fence.promotionRevision, fence.leaseOwner]);
    for (const run of claimed.rows) await appendWorkerEvidence(client, run, String(run.previous_state ?? "queued"), "running", null);
    await client.query("COMMIT");
    for (const run of claimed.rows) {
      const isolated = await pool.connect();
      try { await isolated.query("BEGIN"); await isolated.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); if (await liveFence(isolated, fence)) { await processRun(isolated, run, fence); count++; await isolated.query("COMMIT"); } else await isolated.query("ROLLBACK"); }
      catch (error) { await isolated.query("ROLLBACK").catch(() => undefined); const failureCode = error instanceof Error && (error.message === "REPORT_AUTHORITY_STALE" || error.message === "REPORT_CURRENCY_MIXED") ? error.message : "REPORT_SOURCE_STALE"; await requeueReportRun(pool, fence, String(run.run_id), failureCode).catch((requeueError) => console.error("K_NEX_REPORT_REQUEUE_ERROR", requeueError)); console.error("K_NEX_REPORT_RUN_ERROR", error); }
      finally { isolated.release(); }
    }
    return count;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}
export async function readGeneratedSalesReportArtifact(pool: RuntimeExtensionPool, authority: GeneratedSalesReportAuthority, artifactId: string): Promise<Readonly<{ bytes: Uint8Array; digest: string; contentType: string }>> {
  if (!validAuthority(authority) || artifactId.length < 1 || artifactId.length > 160 || !(authority.reportPermissionGrants ?? authority.permissionGrants)?.includes("sales.reports.read")) throw new Error("REPORT_ARTIFACT_FORBIDDEN");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<Row>("SELECT a.authorization_revision,a.lifecycle_revision,s.revision FROM k_nex_authorization_state a JOIN sales_current_authority_scopes s ON s.application_id=a.application_id AND s.environment=$2 AND s.principal_id=$3 AND s.state='active' WHERE a.application_id=$1 AND a.authorization_revision=$4 AND a.lifecycle_revision=$5 AND s.revision=$6 FOR SHARE", [authority.context.applicationId, authority.context.environment, authority.context.actorId, authority.authorizationRevision, authority.lifecycleRevision, authority.scopeRevision]);
    if (current.rows.length !== 1 || typeof authority.runtimeGenerationId !== "string") throw new Error("REPORT_ARTIFACT_FORBIDDEN");
    const result = await client.query<Row>("SELECT a.bytes,a.digest,a.content_type,a.expires_at,a.metadata,a.metadata_digest,r.* FROM sales_report_artifacts a JOIN sales_report_runs r ON r.run_id=a.run_id WHERE a.artifact_id=$1 AND r.application_id=$2 AND r.environment=$3 AND r.recipient_id=$4 AND r.state='succeeded' AND a.expires_at>now() FOR SHARE", [artifactId, authority.context.applicationId, authority.context.environment, authority.context.actorId]);
    const row = result.rows[0];
    if (result.rows.length !== 1 || row?.bytes === null || !(row?.bytes instanceof Uint8Array) || !validId(row.report_id as string) || !hasReportPermissions(authority, row.report_id as GeneratedSalesReportId)) throw new Error("REPORT_ARTIFACT_FORBIDDEN");
    const runtimeGeneration = await currentRuntimeGeneration(client, authority.context.applicationId);
    const required = requiredReportPermissionsForOrigin(String(row.report_id), row.scheduled_for !== null && row.scheduled_for !== undefined);
    const permissionChecks = await Promise.all(required.map((permission) => currentReportPermission(client, authority.context.actorId, authority.context.applicationId, permission)));
    if (runtimeGeneration !== row.runtime_generation_id || row.authorization_revision !== authority.authorizationRevision || row.lifecycle_revision !== authority.lifecycleRevision || row.scope_revision !== authority.scopeRevision || row.settings_revision === null || !permissionChecks.every(Boolean)) throw new Error("REPORT_ARTIFACT_FORBIDDEN");
    const settingsRows = await client.query<Row>("SELECT d.settings_revision,d.values_json,s.settings_revision AS state_revision FROM k_nex_system_settings_documents d JOIN k_nex_system_settings_state s ON s.application_id=d.application_id AND s.environment=$2 WHERE d.application_id=$1 AND d.environment=$2 AND d.descriptor_id='system.general' AND d.owner_scope_key='platform:system' AND d.descriptor_schema_version=3 FOR SHARE", [authority.context.applicationId, authority.context.environment]);
    const setting = settingsRows.rows.length === 1 ? record(settingsRows.rows[0]!.values_json) : undefined;
    const executionMetadata = row.execution_metadata !== null && typeof row.execution_metadata === "object" ? record(row.execution_metadata) : undefined;
    const currentWatermark = await persistedReportSourceWatermark(client, row);
    if (setting === undefined || Number(row.settings_revision) !== Number(settingsRows.rows[0]!.settings_revision) || Number(settingsRows.rows[0]!.settings_revision) !== Number(settingsRows.rows[0]!.state_revision) || row.reporting_currency !== setting.reportingCurrency || row.reporting_timezone !== setting.reportingTimezone || executionMetadata === undefined || row.execution_metadata_digest !== executionMetadata.executionDigest || digest(Object.fromEntries(Object.entries(executionMetadata).filter(([key]) => key !== "executionDigest"))) !== executionMetadata.executionDigest || row.source_watermark !== currentWatermark) throw new Error("REPORT_ARTIFACT_FORBIDDEN");
    await client.query("COMMIT");
    return Object.freeze({ bytes: row.bytes, digest: String(row.digest), contentType: String(row.content_type) });
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}
