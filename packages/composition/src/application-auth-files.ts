export interface ApplicationAuthFilesOptions {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly theme: "minimal" | "neobrutalism";
}

function jsxStringExpression(value: string): string {
  return `{${JSON.stringify(value)}}`;
}

function identitySource(applicationId: string): string {
  return `function required(name: "K_NEX_ENVIRONMENT" | "K_NEX_PUBLIC_ORIGIN" | "PAYLOAD_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(\`Required environment variable \${name} is missing.\`);
  return value;
}

const environment = required("K_NEX_ENVIRONMENT");
if (!/^[a-z][a-z0-9-]{1,63}$/u.test(environment)) throw new Error("K_NEX_ENVIRONMENT is invalid.");
const publicOrigin = new URL(required("K_NEX_PUBLIC_ORIGIN"));
if (!['http:', 'https:'].includes(publicOrigin.protocol) || publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash || publicOrigin.username || publicOrigin.password) {
  throw new Error("K_NEX_PUBLIC_ORIGIN must be an origin without credentials or a path.");
}
if (environment === "production" && publicOrigin.protocol !== "https:") throw new Error("Production requires an HTTPS public origin.");

export const kNexIdentity = Object.freeze({ applicationId: ${JSON.stringify(applicationId)}, environment, publicOrigin });
export const payloadSecret = required("PAYLOAD_SECRET");
`;
}

function usersSource(): string {
  return `import type { CollectionConfig } from "payload";

import { authorizePayloadUser } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";

export const usersCollection: CollectionConfig = {
  slug: "users",
  auth: {
    cookies: { sameSite: "Lax", secure: kNexIdentity.publicOrigin.protocol === "https:" },
    maxLoginAttempts: 5,
    removeTokenFromResponses: true,
    tokenExpiration: 7_200,
    useSessions: true
  },
  access: {
    create: ({ req }) => authorizePayloadUser(req.payload, req.user, "system.role-assignments.manage", "system.role-assignments"),
    delete: () => false,
    read: ({ req }) => req.user ? { id: { equals: req.user.id } } : false,
    update: ({ id, req }) => req.user?.collection === "users" && String(req.user.id) === String(id)
  },
  admin: { useAsTitle: "email" },
  fields: []
};
`;
}

function authoritySource(): string {
  return `import { randomUUID } from "node:crypto";

import { canonicalJson } from "@k-nex/contracts";
import { PostgresAuthorizationStore, type RuntimeExtensionPool } from "@k-nex/payload-adapter";
import {
  CurrentAuthorityAdapter,
  EffectiveAuthorityResolver,
  createAuthorizationCatalogProvider,
  createCurrentAuthorityTarget,
  createEffectiveAuthorizationRequest,
  createEffectiveAuthorizationCatalog,
  createPlatformPluginPolicyExecutable,
  createPlatformPluginRegistrationAuthorizationContribution,
  createTrustedAuthorizationSession,
  platformPermissionDescriptors
} from "@k-nex/runtime";
import type { Payload } from "payload";

import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";

export interface KnexRequestContext { readonly headers: Headers; readonly correlationId: string; }

const runtimes = new WeakMap<Payload, ReturnType<typeof createRuntime>>();
type CachedPayloadAuthentication = Promise<Awaited<ReturnType<Payload["auth"]>>>;
const requestAuthentications = new WeakMap<Payload, WeakMap<KnexRequestContext, CachedPayloadAuthentication>>();
const shutdowns = new WeakMap<Payload, Promise<void>>();
export type KnexShutdownProgress = Readonly<
  { stage: "authority-drain" | "payload-destroy" | "complete" } |
  { stage: "pool-end"; pool: Readonly<{ totalCount: number; idleCount: number; waitingCount: number }> }
>;

export function currentPayloadAuthentication(payload: Payload, context: KnexRequestContext) {
  let authentications = requestAuthentications.get(payload);
  if (authentications === undefined) {
    authentications = new WeakMap();
    requestAuthentications.set(payload, authentications);
  }
  let authentication = authentications.get(context);
  if (authentication === undefined) {
    authentication = payload.auth({ headers: context.headers, canSetHeaders: false });
    authentications.set(context, authentication);
  }
  return authentication;
}

function principal(user: unknown) {
  if (typeof user !== "object" || user === null || !("id" in user) || !("collection" in user) || user.collection !== "users" || user.id === null || user.id === undefined) return undefined;
  return { kind: "user" as const, id: String(user.id) };
}

function session(user: unknown, correlationId: string) {
  const actor = principal(user);
  return actor === undefined ? undefined : createTrustedAuthorizationSession({
    schemaVersion: 1,
    applicationId: kNexIdentity.applicationId,
    environment: kNexIdentity.environment,
    correlationId,
    principal: actor,
    effectiveActor: actor
  });
}

async function currentSalesAuthority(store: PostgresAuthorizationStore) {
  const state = await store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  if (state === undefined) return undefined;
  const expected = { applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
  const snapshot = await store.readTransaction(expected, async (transaction) => {
    const current = (await transaction.listExtensionGenerations(expected.applicationId)).filter((generation) =>
      generation.state === "current" && generation.applicationId === expected.applicationId &&
      canonicalJson(generation.owner) === canonicalJson(kNexSalesRegistry.authorizationGeneration.owner) &&
      generation.owner.generation === kNexSalesRegistry.staticRelease.authorizationGeneration &&
      canonicalJson(generation.runtimeGenerationIds) === canonicalJson([kNexSalesRegistry.staticRelease.runtimeGenerationId]) &&
      generation.authorizationRevision >= kNexSalesRegistry.authorizationGeneration.authorizationRevision && generation.authorizationRevision <= expected.authorizationRevision &&
      generation.lifecycleRevision >= kNexSalesRegistry.authorizationGeneration.lifecycleRevision && generation.lifecycleRevision <= expected.lifecycleRevision
    );
    if (current.length !== 1) return undefined;
    const generation = current[0]!;
    const unavailable = (await transaction.listCatalogSnapshots(expected.applicationId)).some((entry) =>
      entry.owner?.kind === "extension" && entry.owner.deliveryClass === "platform-plugin" && entry.owner.extensionId === "module.sales" &&
      entry.owner.generation === generation.owner.generation && (entry.state === "inactive-extension-disabled" || entry.state === "inactive-extension-not-ready")
    );
    return Object.freeze({ generation, lifecycleOverride: Object.freeze({ enabled: !unavailable, ready: !unavailable }) });
  });
  return Object.freeze({
    state: snapshot.state,
    ...(snapshot.value === undefined ? {} : { generation: snapshot.value.generation, lifecycleOverride: snapshot.value.lifecycleOverride })
  });
}

function createRuntime(payload: Payload) {
  const store = new PostgresAuthorizationStore(payload.db.pool as RuntimeExtensionPool, {
    validate: (applicationId, subject) => applicationId === kNexIdentity.applicationId && subject.kind === "user" ? "accepted" : "rejected"
  });
  const salesExecutables = kNexSalesRegistry.policyBindings.map((binding) => {
    const executor = kNexSalesRegistry.policyExecutors[binding.policyReference as keyof typeof kNexSalesRegistry.policyExecutors];
    if (executor === undefined || binding.publisher.kind !== "extension" || binding.publisher.deliveryClass !== "platform-plugin") throw new Error("Sales policy executable is unavailable.");
    return createPlatformPluginPolicyExecutable({ kind: "platform-plugin", publisher: binding.publisher, bindingId: binding.id, policyReference: binding.policyReference, executor });
  });
  const catalogProvider = createAuthorizationCatalogProvider(async ({ applicationId, lifecycleRevision }) => {
    if (applicationId !== kNexIdentity.applicationId) return undefined;
    const current = await currentSalesAuthority(store).catch(() => undefined);
    if (current === undefined || current.state.lifecycleRevision !== lifecycleRevision) return undefined;
    const salesContribution = current.generation === undefined || current.lifecycleOverride === undefined ? undefined : createPlatformPluginRegistrationAuthorizationContribution({ registration: kNexSalesRegistry.scopedRegistration, generation: current.generation, lifecycleOverride: current.lifecycleOverride });
    return {
      applicationId,
      lifecycleRevision,
      catalog: createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision, extensions: salesContribution === undefined ? [] : [salesContribution], executables: salesContribution === undefined ? [] : salesExecutables })
    };
  });
  const resolver = new EffectiveAuthorityResolver({ store, catalogProvider });
  const adapter = new CurrentAuthorityAdapter<KnexRequestContext>({
    current: async (context) => session((await currentPayloadAuthentication(payload, context)).user, context.correlationId)
  }, resolver);
  return Object.freeze({ adapter, catalogProvider, resolver, store });
}

export function kNexAuthority(payload: Payload) {
  let runtime = runtimes.get(payload);
  if (shutdowns.has(payload)) throw new Error("K-Nex authority runtime is closed.");
  if (runtime === undefined) { runtime = createRuntime(payload); runtimes.set(payload, runtime); }
  return runtime;
}

/** Peeks only: shutdown must never create a fresh authority runtime. */
export async function drainKnexAuthority(payload: Payload): Promise<void> {
  const runtime = runtimes.get(payload);
  if (runtime !== undefined) await runtime.adapter.drain();
  requestAuthentications.delete(payload);
}

/** Leaves a drained runtime tombstone so late callers cannot reopen admission. */
export async function shutdownKnexApplication(payload: Payload, progress?: (value: KnexShutdownProgress) => void): Promise<void> {
  const existing = shutdowns.get(payload);
  if (existing !== undefined) return existing;
  const pool = payload.db.pool as unknown as { end?: () => Promise<void>; totalCount?: number; idleCount?: number; waitingCount?: number };
  const boundedPoolCount = (value: unknown): number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000 ? Number(value) : 0;
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const shutdown = new Promise<void>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  shutdowns.set(payload, shutdown);
  void (async () => {
    if (typeof pool.end !== "function") { reject(new TypeError("K-Nex Payload Postgres pool cannot close.")); return; }
    progress?.(Object.freeze({ stage: "authority-drain" }));
    try { await drainKnexAuthority(payload); }
    catch (error) { reject(error); return; }
    let destroyError: unknown;
    progress?.(Object.freeze({ stage: "payload-destroy" }));
    try { await payload.destroy(); } catch (error) { destroyError = error; }
    let endError: unknown;
    progress?.(Object.freeze({ stage: "pool-end", pool: Object.freeze({ totalCount: boundedPoolCount(pool.totalCount), idleCount: boundedPoolCount(pool.idleCount), waitingCount: boundedPoolCount(pool.waitingCount) }) }));
    try { await pool.end(); } catch (error) { endError = error; }
    if (destroyError !== undefined && endError !== undefined) { reject(new AggregateError([destroyError, endError], "K-Nex shutdown failed.")); return; }
    if (destroyError !== undefined) { reject(destroyError); return; }
    if (endError !== undefined) { reject(endError); return; }
    progress?.(Object.freeze({ stage: "complete" }));
    resolve();
  })();
  return shutdown;
}

export async function currentSalesGeneration(payload: Payload) {
  const current = await currentSalesAuthority(kNexAuthority(payload).store);
  if (current?.generation === undefined || current.lifecycleOverride === undefined || !current.lifecycleOverride.enabled || !current.lifecycleOverride.ready) throw new TypeError("Sales authorization generation is unavailable.");
  return current;
}

export function kNexRequestContext(headers: Headers, boundary: string): KnexRequestContext {
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(boundary)) throw new TypeError("Authority boundary is invalid.");
  return Object.freeze({ headers, correlationId: \`\${boundary}-\${randomUUID()}\` });
}

export async function reauthenticateCurrentUser(payload: Payload, context: KnexRequestContext, password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length < 1 || password.length > 1024) return false;
  try {
    const current = (await payload.auth({ headers: context.headers, canSetHeaders: false })).user;
    if (typeof current !== "object" || current === null || !("id" in current) || !("email" in current) || !("collection" in current) || current.collection !== "users" || typeof current.email !== "string") return false;
    const login = await payload.login({ collection: "users", data: { email: current.email, password }, overrideAccess: false });
    return login.user !== null && login.user !== undefined && String(login.user.id) === String(current.id);
  } catch { return false; }
}

export async function authorizePayloadUser(payload: Payload, user: unknown, permissionId: string, resource: string): Promise<boolean> {
  const trusted = session(user, \`payload-access-\${randomUUID()}\`);
  if (trusted === undefined) return false;
  const request = createEffectiveAuthorizationRequest({ schemaVersion: 1, decisionId: \`payload-access-\${randomUUID()}\`, permissionId, scope: { kind: "application", resource }, facts: { boundary: "payload-users" } });
  return (await kNexAuthority(payload).resolver.authorize(trusted, request).catch(() => undefined))?.outcome === "allow";
}

export async function authorizeRequest(payload: Payload, context: KnexRequestContext, permissionId: string, resource: string): Promise<boolean> {
  const target = createCurrentAuthorityTarget({ permissionId, scope: { kind: "application", resource }, facts: { boundary: "workspace-http" } });
  return kNexAuthority(payload).adapter.allows(context, target);
}

export async function authorizeNavigationPermission(payload: Payload, context: KnexRequestContext, permissionId: string): Promise<boolean> {
  const descriptor = [...platformPermissionDescriptors, ...kNexSalesRegistry.permissionDescriptors].find(({ id }) => id === permissionId);
  if (descriptor === undefined || descriptor.scope !== "application") return false;
  return authorizeRequest(payload, context, descriptor.id, descriptor.resource);
}

const systemAdministrationNavigation = Object.freeze([
  { id: "settings", label: "Settings", href: "/system/settings", permissionId: "system.settings.read" },
  { id: "themes", label: "Themes", href: "/system/themes", permissionId: "system.themes.read" },
  { id: "roles", label: "Roles", href: "/system/access/roles", permissionId: "system.roles.read" },
  { id: "permissions", label: "Permissions", href: "/system/access/permissions", permissionId: "system.permissions.read" },
  { id: "assignments", label: "Assignments", href: "/system/access/assignments", permissionId: "system.role-assignments.read" },
  { id: "audit", label: "Authorization audit", href: "/system/access/audit", permissionId: "system.authorization.audit.read" },
  { id: "extensions", label: "Extensions", href: "/system/extensions", permissionId: "system.extensions.read" },
  { id: "operations", label: "Operations", href: "/system/operations", permissionId: "system.operations.read" }
]);

export async function currentSystemAdministrationNavigation(payload: Payload, context: KnexRequestContext) {
  return Object.freeze((await Promise.all(systemAdministrationNavigation.map(async ({ permissionId, ...item }) =>
    await authorizeNavigationPermission(payload, context, permissionId) ? item : undefined
  ))).flatMap((item) => item === undefined ? [] : [item]));
}
`;
}

function bootstrapTokenSource(): string {
  return `import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson } from "@k-nex/contracts";
import type { Payload } from "payload";

import { kNexIdentity, payloadSecret } from "./k-nex-identity.js";

const lifetimeMs = 15 * 60 * 1_000;

type BootstrapTokenClient = {
  query(text: string, values?: unknown[]): Promise<{ rowCount: number }>;
  release(): void;
};

function digest(token: string): string { return \`sha256:\${createHash("sha256").update(token).digest("hex")}\`; }
function signature(payload: string): Buffer { return createHmac("sha256", payloadSecret).update(payload).digest(); }

function tokenClaims(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "knt1") throw new Error("Bootstrap token is invalid.");
  const expected = signature(parts[1]!);
  const actual = Buffer.from(parts[2]!, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Bootstrap token is invalid.");
  const value = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  if (Object.keys(value).sort().join("\\0") !== "applicationId\\0environment\\0expiresAt\\0issuedAt\\0nonce\\0schemaVersion" || value.schemaVersion !== 1 ||
    value.applicationId !== kNexIdentity.applicationId || value.environment !== kNexIdentity.environment || typeof value.nonce !== "string" || !/^[0-9a-f]{48}$/u.test(value.nonce) ||
    typeof value.issuedAt !== "string" || typeof value.expiresAt !== "string") throw new Error("Bootstrap token identity is invalid.");
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const now = Date.now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= now || issuedAt > now + 30_000 || expiresAt - issuedAt !== lifetimeMs) throw new Error("Bootstrap token is expired or invalid.");
  return { digest: digest(token), expiresAt: value.expiresAt };
}

function fileArgument(argv: readonly string[], flag: "--output" | "--token-file"): string {
  const index = argv.indexOf(flag);
  if (index < 0 || index !== argv.length - 2 || !argv[index + 1]) throw new Error(\`Use \${flag} <private-token-file>.\`);
  return resolve(argv[index + 1]!);
}

export async function issueBootstrapToken(payload: Payload, argv: readonly string[]): Promise<void> {
  const output = fileArgument(argv, "--output");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.valueOf() + lifetimeMs);
  const claims = { schemaVersion: 1, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), nonce: randomBytes(24).toString("hex") };
  const encoded = Buffer.from(canonicalJson(claims)).toString("base64url");
  const token = \`knt1.\${encoded}.\${signature(encoded).toString("base64url")}\`;
  const client = await (payload.db.pool as { connect(): Promise<BootstrapTokenClient> }).connect();
  let wrote = false;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([kNexIdentity.applicationId, kNexIdentity.environment, "owner-bootstrap-token"])]);
    const receipt = await client.query("select 1 from k_nex_authorization_bootstrap_receipts where application_id=$1", [kNexIdentity.applicationId]);
    if (receipt.rowCount !== 0) throw new Error("First owner already exists.");
    await client.query("update k_nex_owner_bootstrap_tokens set consumed_at=now() where application_id=$1 and environment=$2 and consumed_at is null", [kNexIdentity.applicationId, kNexIdentity.environment]);
    await client.query("insert into k_nex_owner_bootstrap_tokens (application_id, environment, token_digest, expires_at) values ($1,$2,$3,$4)", [kNexIdentity.applicationId, kNexIdentity.environment, digest(token), expiresAt.toISOString()]);
    writeFileSync(output, \`\${token}\\n\`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    wrote = true;
    await client.query("commit");
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    if (wrote) try { unlinkSync(output); } catch {}
    throw error;
  } finally { client.release(); }
}

export function readBootstrapToken(argv: readonly string[]) {
  const path = fileArgument(argv, "--token-file");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Bootstrap token file must be private, regular, and not a symlink.");
  const token = readFileSync(path, "utf8").trim();
  if (token.length < 80 || token.length > 2_048) throw new Error("Bootstrap token is invalid.");
  return Object.freeze({ path, token, ...tokenClaims(token) });
}

export async function acquireBootstrapLock(payload: Payload) {
  const client = await (payload.db.pool as { connect(): Promise<BootstrapTokenClient> }).connect();
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [canonicalJson([kNexIdentity.applicationId, kNexIdentity.environment, "owner-bootstrap-token"])]);
  } catch (error) {
    client.release();
    throw error;
  }
  return client;
}

export async function releaseBootstrapLock(client: BootstrapTokenClient): Promise<void> {
  try { await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [canonicalJson([kNexIdentity.applicationId, kNexIdentity.environment, "owner-bootstrap-token"])]); }
  finally { client.release(); }
}

export async function assertIssuedBootstrapToken(client: BootstrapTokenClient, token: ReturnType<typeof readBootstrapToken>): Promise<void> {
  const result = await client.query(
    "select 1 from k_nex_owner_bootstrap_tokens where application_id=$1 and environment=$2 and token_digest=$3 and expires_at=$4 and consumed_at is null and expires_at>now()",
    [kNexIdentity.applicationId, kNexIdentity.environment, token.digest, token.expiresAt]
  );
  if (result.rowCount !== 1) throw new Error("Bootstrap token is unavailable, expired, or consumed.");
}

export async function consumeBootstrapToken(client: BootstrapTokenClient, token: ReturnType<typeof readBootstrapToken>): Promise<void> {
  const result = await client.query(
    "update k_nex_owner_bootstrap_tokens set consumed_at=now() where application_id=$1 and environment=$2 and token_digest=$3 and expires_at=$4 and consumed_at is null and expires_at>now()",
    [kNexIdentity.applicationId, kNexIdentity.environment, token.digest, token.expiresAt]
  );
  if (result.rowCount !== 1) throw new Error("Bootstrap token could not be consumed.");
  unlinkSync(token.path);
}
`;
}

function bootstrapOwnerSource(): string {
  return `import { createHash } from "node:crypto";

import { AuthorizationDecisionAuditSchema, canonicalJson, type BootstrapReceipt } from "@k-nex/contracts";
import { bootstrapFirstOwner, currentProtectedPlatformRoleBaselineRelease, protectedRoleBootstrapId } from "@k-nex/runtime";

import { bootKnexApplication } from "./boot.js";
import { acquireBootstrapLock, assertIssuedBootstrapToken, consumeBootstrapToken, readBootstrapToken, releaseBootstrapLock } from "./k-nex-bootstrap-token.js";
import { kNexAuthority, shutdownKnexApplication } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { bootstrapApplicationTheme } from "./k-nex-theme-runtime.js";

/** Authorization outbox primary keys are UUIDs; bootstrap IDs remain readable varchar audit IDs. */
function authorizationOutboxEventId(kind: string, userId: string): string {
  const digest = createHash("sha256").update(canonicalJson([kNexIdentity.applicationId, kNexIdentity.environment, kind, userId])).digest("hex");
  return digest.slice(0,8) + "-" + digest.slice(8,12) + "-" + digest.slice(12,16) + "-" + digest.slice(16,20) + "-" + digest.slice(20,32);
}

function assertResumableOwnerReceipt(receipt: BootstrapReceipt | undefined, userId: string): asserts receipt is BootstrapReceipt {
  const assignmentId = protectedRoleBootstrapId(kNexIdentity.applicationId, "owner-assignment", userId);
  if (receipt === undefined || receipt.applicationId !== kNexIdentity.applicationId || receipt.id !== protectedRoleBootstrapId(kNexIdentity.applicationId, "receipt", assignmentId) || receipt.ownerRoleId !== "system.role.owner" || receipt.ownerAssignmentId !== assignmentId || receipt.ownerPrincipal.kind !== "user" || receipt.ownerPrincipal.id !== userId || receipt.protectedBaselineVersion !== currentProtectedPlatformRoleBaselineRelease.version || receipt.protectedBaselineDigest !== currentProtectedPlatformRoleBaselineRelease.digest || receipt.authorizationRevision !== 1 || receipt.state !== "committed") {
    throw new Error("Bootstrap receipt does not match the issued owner.");
  }
}

function crashAfterCommit(boundary: "protected-owner" | "sales-authority" | "token-consumption"): void {
  if (process.env.NODE_ENV === "test" && process.env.K_NEX_BOOTSTRAP_CRASH_AFTER_COMMIT === boundary) process.exit(86);
}

async function ensureInitialSalesOwner(payload: Awaited<ReturnType<typeof bootKnexApplication>>, userId: string) {
  const store = kNexAuthority(payload).store;
  const state = await store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  if (state === undefined) throw new Error("Authorization state is unavailable.");
  if (state.lifecycleRevision === 0) {
    await store.transaction({ applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision }, async (transaction) => {
      await transaction.write({ kind: "extension-generation", generation: kNexSalesRegistry.authorizationGeneration });
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.initial-sales-administrator", applicationId: kNexIdentity.applicationId, label: "Sales administrator", revision: 0 } });
      for (const descriptor of kNexSalesRegistry.permissionDescriptors) await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.initial-sales-administrator." + descriptor.id, applicationId: kNexIdentity.applicationId, roleId: "customer.initial-sales-administrator", permissionId: descriptor.id, owner: kNexSalesRegistry.authorizationGeneration.owner, revision: 0 } });
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.initial-sales-administrator.owner", applicationId: kNexIdentity.applicationId, roleId: "customer.initial-sales-administrator", principal: { kind: "user", id: userId }, state: "active", revision: 0 } });
    });
  } else {
    const result = await (payload.db.pool as { query(text: string, values: unknown[]): Promise<{ rows: Array<{ assignment_count: number; generation_count: number; grant_count: number }> }> }).query(
      "select (select count(*)::int from k_nex_role_assignments where application_id=$1 and assignment_id='customer.initial-sales-administrator.owner' and subject_kind='user' and subject_id=$2 and state='active') assignment_count, (select count(*)::int from k_nex_extension_authorization_generations where application_id=$1 and delivery_class='platform-plugin' and extension_id='module.sales' and authorization_generation=1 and state in ('current','retired') and lifecycle_revision<=$3) generation_count, (select count(*)::int from k_nex_role_permission_grants where application_id=$1 and role_id='customer.initial-sales-administrator') grant_count",
      [kNexIdentity.applicationId, userId, state.lifecycleRevision]
    );
    const proof = result.rows[0];
    if (proof?.assignment_count !== 1 || proof.generation_count !== 1 || proof.grant_count !== kNexSalesRegistry.permissionDescriptors.length) throw new Error("Initial Sales authority is incomplete.");
  }
  const pool = payload.db.pool as { connect(): Promise<{ query(text: string, values?: unknown[]): Promise<{ rows: Array<{ authorization_revision?: number; lifecycle_revision?: number; record_scope?: string; application_wide?: boolean; mutation_allowed?: boolean; authorized_team_ids?: unknown; revision?: number }>; rowCount: number | null }>; release(): void }> };
  const client = await pool.connect();
  let scope: { record_scope?: string; application_wide?: boolean; mutation_allowed?: boolean; authorized_team_ids?: unknown; revision?: number } | undefined;
  try {
    await client.query("begin");
    const scopeState = (await client.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1 for update", [kNexIdentity.applicationId])).rows[0];
    const priorAuthorizationRevision = scopeState?.authorization_revision;
    const lifecycleRevision = scopeState?.lifecycle_revision;
    if (!Number.isSafeInteger(priorAuthorizationRevision) || !Number.isSafeInteger(lifecycleRevision)) throw new Error("Authorization state is unavailable.");
    const expectedAuthorizationRevision = Number(priorAuthorizationRevision);
    const expectedLifecycleRevision = Number(lifecycleRevision);
    const inserted = await client.query(
      "insert into sales_current_authority_scopes (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,$2,$3,'application-sales-scope',true,true,'[]'::jsonb,'active',1) on conflict (application_id,environment,principal_id) do nothing returning revision",
      [kNexIdentity.applicationId, kNexIdentity.environment, userId]
    );
    if (inserted.rowCount === 1) {
      const authorizationRevision = expectedAuthorizationRevision + 1;
      const updated = await client.query("update k_nex_authorization_state set authorization_revision=$2,updated_at=now() where application_id=$1 and authorization_revision=$3 and lifecycle_revision=$4", [kNexIdentity.applicationId, authorizationRevision, expectedAuthorizationRevision, expectedLifecycleRevision]);
      if (updated.rowCount !== 1) throw new Error("Initial Sales scope authority changed before commit.");
      const event = { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, scope: "application", authorizationRevision, lifecycleRevision: expectedLifecycleRevision };
      const auditId = protectedRoleBootstrapId(kNexIdentity.applicationId, "initial-sales-scope-audit", userId);
      const audit = AuthorizationDecisionAuditSchema.parse({ schemaVersion: 1, auditId,
        decisionId: protectedRoleBootstrapId(kNexIdentity.applicationId, "initial-sales-scope-decision", userId),
        correlationId: protectedRoleBootstrapId(kNexIdentity.applicationId, "initial-sales-scope-correlation", userId),
        applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, permissionId: "sales.settings.write",
        owner: kNexSalesRegistry.authorizationGeneration.owner, principal: { kind: "user", id: userId }, effectiveActor: { kind: "user", id: userId },
        scope: { kind: "application", resource: "sales.authority-scopes" }, operation: "initial-sales-scope", target: userId,
        authorizationRevision, lifecycleRevision: expectedLifecycleRevision, outcome: "allow", reason: "granted", approval: "not-required", reauthentication: "not-required" });
      await client.query("insert into k_nex_authorization_audit (audit_id,application_id,environment,permission_id,outcome,reason,authorization_revision,lifecycle_revision,audit_json) values ($1,$2,$3,'sales.settings.write','allow','granted',$4,$5,$6::jsonb)", [auditId, kNexIdentity.applicationId, kNexIdentity.environment, authorizationRevision, expectedLifecycleRevision, JSON.stringify(audit)]);
      await client.query("insert into k_nex_authorization_outbox (event_id,application_id,environment,authorization_revision,lifecycle_revision,event_json) values ($1,$2,$3,$4,$5,$6::jsonb)", [authorizationOutboxEventId("initial-sales-scope-event", userId), kNexIdentity.applicationId, kNexIdentity.environment, authorizationRevision, expectedLifecycleRevision, JSON.stringify(event)]);
    } else if (inserted.rowCount !== 0) throw new Error("Initial Sales scope authority is ambiguous.");
    scope = (await client.query(
      "select record_scope,application_wide,mutation_allowed,authorized_team_ids,revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 for update",
      [kNexIdentity.applicationId, kNexIdentity.environment, userId]
    )).rows[0];
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  if (scope?.record_scope !== "application-sales-scope" || scope.application_wide !== true || scope.mutation_allowed !== true || JSON.stringify(scope.authorized_team_ids) !== "[]" || scope.revision !== 1) throw new Error("Initial Sales scope authority is incomplete.");
}

const email = process.env.K_NEX_OWNER_EMAIL;
const password = process.env.K_NEX_OWNER_PASSWORD;
if (!email || !/^\\S+@\\S+\\.\\S+$/u.test(email) || !password || password.length < 12 || password.length > 128) throw new Error("K_NEX_OWNER_EMAIL and a 12-128 character K_NEX_OWNER_PASSWORD are required.");

const token = readBootstrapToken(process.argv.slice(2));
const payload = await bootKnexApplication("owner-bootstrap");
let bootstrapLock: Awaited<ReturnType<typeof acquireBootstrapLock>> | undefined;
try {
  const runtime = kNexAuthority(payload);
  bootstrapLock = await acquireBootstrapLock(payload);
  await assertIssuedBootstrapToken(bootstrapLock, token);
  const priorReceipt = await runtime.store.readProtectedRoleBaselineReceipt(kNexIdentity.applicationId);
  const existing = await payload.find({ collection: "users", overrideAccess: true, limit: 2, where: { email: { equals: email } } });
  if (existing.totalDocs > 1) throw new Error("Owner email identity is ambiguous.");
  if (priorReceipt !== undefined && existing.docs[0] === undefined) throw new Error("Bootstrap receipt does not match the issued owner.");
  const user = existing.docs[0] ?? await payload.create({ collection: "users", overrideAccess: true, data: { email, password } });
  if (existing.docs[0]) await payload.login({ collection: "users", data: { email, password } });
  const outcome = priorReceipt === undefined
    ? (await bootstrapFirstOwner({
        store: runtime.store,
        expected: { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, authorizationRevision: 0, lifecycleRevision: 0 },
        firstOwner: { kind: "user", id: String(user.id) }
      })).value
    : (assertResumableOwnerReceipt(priorReceipt, String(user.id)), priorReceipt);
  crashAfterCommit("protected-owner");
  await ensureInitialSalesOwner(payload, String(user.id));
  crashAfterCommit("sales-authority");
  await bootstrapApplicationTheme(payload);
  await consumeBootstrapToken(bootstrapLock, token);
  crashAfterCommit("token-consumption");
  console.log(\`K_NEX_OWNER_BOOTSTRAP_PASS \${outcome.id}\`);
} finally {
  try { if (bootstrapLock !== undefined) await releaseBootstrapLock(bootstrapLock); }
  finally { await shutdownKnexApplication(payload); }
}
process.exit(0);
`;
}

function issueTokenSource(): string {
  return `import { bootKnexApplication } from "./boot.js";
import { issueBootstrapToken } from "./k-nex-bootstrap-token.js";
import { shutdownKnexApplication } from "./k-nex-authority.js";

const payload = await bootKnexApplication("bootstrap-token-issuer");
try {
  await issueBootstrapToken(payload, process.argv.slice(2));
  console.log("K_NEX_BOOTSTRAP_TOKEN_ISSUED");
} finally { await shutdownKnexApplication(payload); }
process.exit(0);
`;
}

function issueAttachmentUploadReceiptSource(): string {
  return `import { bootKnexApplication } from "./boot.js";
import { shutdownKnexApplication } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";

type ReceiptInput = Readonly<{ storageRef: string; uploaderActorId: string; filename: string; mediaType: string; byteSize: number; revision: number }>;

function fail(message: string): never { throw new Error("Attachment upload receipt: " + message); }
function readArguments(args: readonly string[]): ReceiptInput {
  const values = new Map<string, string>();
  const names = new Set(["--storage-ref", "--uploader-actor-id", "--filename", "--media-type", "--byte-size", "--revision"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]; const value = args[index + 1];
    if (typeof name !== "string" || !names.has(name) || typeof value !== "string" || values.has(name)) fail("arguments are invalid");
    values.set(name, value);
  }
  if (values.size < 5 || !["--storage-ref", "--uploader-actor-id", "--filename", "--media-type", "--byte-size"].every((name) => values.has(name))) fail("required arguments are missing");
  const storageRef = values.get("--storage-ref")!; const uploaderActorId = values.get("--uploader-actor-id")!;
  const filename = values.get("--filename")!; const mediaType = values.get("--media-type")!;
  const byteSize = Number(values.get("--byte-size")); const revision = values.has("--revision") ? Number(values.get("--revision")) : 1;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u.test(storageRef) || !/^[A-Za-z0-9:_./-]{1,160}$/u.test(uploaderActorId) ||
    filename.length === 0 || filename.length > 256 || /[\\u0000-\\u001f\\u007f]/u.test(filename) || mediaType.length === 0 || mediaType.length > 128 || /[\\u0000-\\u001f\\u007f]/u.test(mediaType) ||
    !Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > 1_073_741_824 || !Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000_000) fail("receipt facts are invalid");
  return Object.freeze({ storageRef, uploaderActorId, filename, mediaType, byteSize, revision });
}

const input = readArguments(process.argv.slice(2));
const payload = await bootKnexApplication("attachment-upload-receipt-issuer");
const pool = payload.db.pool as unknown as { connect(): Promise<{ query(text: string, values?: readonly unknown[]): Promise<{ rows: readonly Record<string, unknown>[]; rowCount: number | null }>; release(): void }> };
const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([kNexIdentity.applicationId, kNexIdentity.environment, "attachment-upload", input.storageRef])]);
  const inserted = await client.query(
    "insert into k_nex_sales_attachment_upload_admissions (application_id,environment,storage_ref,uploader_actor_id,filename,media_type,byte_size,state,revision) values ($1,$2,$3,$4,$5,$6,$7,'ready',$8) on conflict do nothing returning storage_ref",
    [kNexIdentity.applicationId, kNexIdentity.environment, input.storageRef, input.uploaderActorId, input.filename, input.mediaType, input.byteSize, input.revision]
  );
  if (inserted.rowCount === 0) {
    const existing = (await client.query("select uploader_actor_id,filename,media_type,byte_size,state,revision from k_nex_sales_attachment_upload_admissions where application_id=$1 and environment=$2 and storage_ref=$3 for update", [kNexIdentity.applicationId, kNexIdentity.environment, input.storageRef])).rows[0];
    if (existing === undefined || existing.uploader_actor_id !== input.uploaderActorId || existing.filename !== input.filename || existing.media_type !== input.mediaType || existing.byte_size !== input.byteSize || existing.state !== "ready" || existing.revision !== input.revision) fail("storage reference is already bound to different receipt facts");
  }
  await client.query("commit");
  console.log("K_NEX_ATTACHMENT_UPLOAD_RECEIPT_ISSUED");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await shutdownKnexApplication(payload);
}
process.exit(0);
`;
}

function loginFormSource(): string {
  return `"use client";

import { useState, type FormEvent } from "react";

export function LoginForm() {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/users/login", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    if (!response.ok) { setError("Sign-in failed."); return; }
    window.location.assign("/");
  }
  return <form onSubmit={submit}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /><button type="submit">Sign in</button><p aria-live="polite">{error}</p></form>;
}
`;
}

function logoutButtonSource(): string {
  return `"use client";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/users/logout", { method: "POST", credentials: "include" });
    window.location.assign("/login");
  }
  return <button type="button" onClick={logout}>Sign out</button>;
}
`;
}

function workspacePageSource(applicationName: string): string {
  return `import { headers as getHeaders } from "next/headers";
import { redirect } from "next/navigation";

import { authorizeRequest, kNexRequestContext } from "../../k-nex-authority.js";
import { bootKnexApplication } from "../../boot.js";
import { LogoutButton } from "../components/logout-button.js";

export const dynamic = "force-dynamic";

export default async function WorkspaceHome() {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const authentication = await payload.auth({ headers, canSetHeaders: false });
  if (!authentication.user) redirect("/login");
  if (!await authorizeRequest(payload, kNexRequestContext(headers, "workspace-home"), "system.workspace-pages.read", "system.workspace-pages")) redirect("/forbidden");
  return <section className="workspace-home"><p className="eyebrow">K-Nex workspace</p><h1>${jsxStringExpression(applicationName)}</h1><p>Authenticated workspace ready.</p><LogoutButton /></section>;
}
`;
}

function themeRuntimeSource(theme: ApplicationAuthFilesOptions["theme"]): string {
  const resolver = theme === "minimal" ? "resolveMinimalThemeProfile" : "resolveNeobrutalismThemeProfile";
  return `import { createHash } from "node:crypto";

import { ThemeProfilePublicationEventSchema, ThemeProfileSchema, WorkspaceThemeProfileRefSchema, canonicalJson, type ThemeProfile } from "@k-nex/contracts";
import type { RuntimeExtensionPool } from "@k-nex/payload-adapter";
import { ${resolver} as resolveInstalledThemeProfile } from "@k-nex/theme-${theme}";
import type { ThemePresentationSnapshot } from "@k-nex/ui-design-system-contracts";
import type { Payload } from "payload";

import { kNexIdentity } from "./k-nex-identity.js";
import { kNexInitialThemeProfile } from "./k-nex-registry.js";

type ThemeRow = Readonly<{ revision: number; active_revision_id: string | null; active_profile: unknown | null; previous_revision_id: string | null; previous_profile: unknown | null; state_digest: string | null }>;
export type KnexThemeObservation = Readonly<{ profileId: string; activeRevisionId: string; publicationRevision: number; stateDigest: string }>;
export type KnexResolvedTheme = Readonly<{ presentation: Pick<ThemePresentationSnapshot, "profileRevisionId" | "mode" | "cssText">; observation: KnexThemeObservation }>;

function digest(value: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export async function bootstrapApplicationTheme(payload: Payload): Promise<void> {
  const profile = ThemeProfileSchema.parse(kNexInitialThemeProfile);
  if (profile.revision.state !== "published") throw new TypeError("Initial Theme Profile must be published.");
  const stateDigest = digest({ revision: 1, activeRevisionId: profile.revision.id, previousRevisionId: null, activeProfile: profile, previousProfile: null });
  const owner = { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, profileId: profile.id };
  const eventDigest = digest({ ...owner, operation: "publish", revision: 1, activeRevisionId: profile.revision.id });
  const event = ThemeProfilePublicationEventSchema.parse({
    schemaVersion: 1, eventId: "theme-profile-event-" + eventDigest.slice(7, 39), eventType: "theme-profile.publication", operation: "publish", ...owner,
    revisionBefore: 0, revisionAfter: 1, activeRevisionId: profile.revision.id, occurredAt: profile.revision.publishedAt, stateDigest
  });
  await (payload.db.pool as RuntimeExtensionPool).query(
    \`with inserted as (
       insert into runtime_theme_profile_publications (application_id, environment, profile_id, revision, active_revision_id, active_profile, state_digest)
       values ($1,$2,$3,1,$4,$5::jsonb,$6) on conflict (application_id, environment, profile_id) do nothing returning application_id
     ) insert into runtime_theme_profile_outbox (event_id, application_id, environment, profile_id, revision, event_json)
       select $7,$1,$2,$3,1,$8::jsonb from inserted\`,
    [owner.applicationId, owner.environment, owner.profileId, profile.revision.id, JSON.stringify(profile), stateDigest, event.eventId, JSON.stringify(event)]
  );
}

function resolved(row: ThemeRow | undefined, profileId: string, revisionId?: string): KnexResolvedTheme {
  if (row === undefined || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.active_revision_id === null || row.active_profile === null || row.state_digest === null || !/^sha256:[0-9a-f]{64}$/u.test(row.state_digest)) {
    throw new TypeError("Published admin Theme Profile is unavailable.");
  }
  if (digest({ revision: row.revision, activeRevisionId: row.active_revision_id, previousRevisionId: row.previous_revision_id, activeProfile: row.active_profile, previousProfile: row.previous_profile }) !== row.state_digest) {
    throw new TypeError("Published admin Theme Profile state digest is invalid.");
  }
  const profile: ThemeProfile = ThemeProfileSchema.parse(row.active_profile);
  if (profile.id !== profileId || profile.revision.state !== "published" || profile.revision.id !== row.active_revision_id || (revisionId !== undefined && revisionId !== row.active_revision_id) ||
    profile.surface !== "admin" || profile.themeId !== "theme.${theme}" || profile.themeVersion !== "1.0.0" || profile.skin !== undefined) {
    throw new TypeError("Published admin Theme Profile is incompatible with installed theme authority.");
  }
  const presentation = resolveInstalledThemeProfile(profile);
  return Object.freeze({
    presentation: Object.freeze({ profileRevisionId: presentation.profileRevisionId, mode: presentation.mode, cssText: presentation.cssText }),
    observation: Object.freeze({ profileId, activeRevisionId: row.active_revision_id, publicationRevision: row.revision, stateDigest: row.state_digest })
  });
}

async function read(payload: Payload, profileId: string): Promise<ThemeRow | undefined> {
  const result = await (payload.db.pool as RuntimeExtensionPool).query<ThemeRow>(
    \`select revision, active_revision_id, active_profile, previous_revision_id, previous_profile, state_digest from runtime_theme_profile_publications
     where application_id=$1 and environment=$2 and profile_id=$3\`,
    [kNexIdentity.applicationId, kNexIdentity.environment, profileId]
  );
  return result.rows[0];
}

export async function resolveApplicationTheme(payload: Payload): Promise<KnexResolvedTheme> {
  return resolved(await read(payload, kNexInitialThemeProfile.id), kNexInitialThemeProfile.id);
}

export async function resolvePageThemeOverride(payload: Payload, value: unknown): Promise<KnexResolvedTheme> {
  const reference = WorkspaceThemeProfileRefSchema.parse(value);
  return resolved(await read(payload, reference.profileId), reference.profileId, reference.revisionId);
}

export async function listPageThemeOverrides(payload: Payload) {
  const result = await (payload.db.pool as RuntimeExtensionPool).query<ThemeRow & { profile_id: string }>(
    \`select profile_id, revision, active_revision_id, active_profile, previous_revision_id, previous_profile, state_digest from runtime_theme_profile_publications
     where application_id=$1 and environment=$2 and active_revision_id is not null order by profile_id limit 101\`,
    [kNexIdentity.applicationId, kNexIdentity.environment]
  );
  if (result.rows.length > 100) throw new TypeError("Workspace Theme Profile selection ceiling exceeded.");
  return Object.freeze(result.rows.flatMap((row) => {
    try {
      const theme = resolved(row, row.profile_id);
      return [Object.freeze({ value: row.profile_id + "|" + theme.observation.activeRevisionId, label: row.profile_id + " (" + theme.observation.activeRevisionId + ")" })];
    } catch { return []; }
  }));
}
`;
}

function loginPageSource(): string {
  return `import { headers as getHeaders } from "next/headers";
import { redirect } from "next/navigation";

import { bootKnexApplication } from "../../../boot.js";
import { LoginForm } from "../../components/login-form.js";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const payload = await bootKnexApplication("workspace-web");
  if ((await payload.auth({ headers: await getHeaders(), canSetHeaders: false })).user) redirect("/");
  return <main className="workspace-home"><h1>Sign in</h1><LoginForm /></main>;
}
`;
}

function workspaceNavigationSource(): string {
  return `import { createHash } from "node:crypto";

import { canonicalJson, type PluginNavigationDescriptor, type PluginRouteDescriptor } from "@k-nex/contracts";
import { PostgresWorkspaceSidebarPreferenceStore, type RuntimeExtensionPool, type WorkspaceSidebarPreference } from "@k-nex/payload-adapter";
import { resolveWorkspaceNavigation } from "@k-nex/ui-runtime";
import type { Payload } from "payload";

import { authorizeNavigationPermission, currentSalesGeneration, kNexAuthority, kNexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { workspaceSalesPermissions } from "./k-nex-sales-workspace.js";
import { resolveApplicationTheme } from "./k-nex-theme-runtime.js";
import { kNexWorkspacePages, kNexWorkspacePageScope } from "./k-nex-workspace-pages.js";

type RegisteredRoute = PluginRouteDescriptor;
type RegisteredTemplate = Readonly<{ id: string; ownerPluginId: string; route: Readonly<{ routeId: string }>; permission: string }>;
type RegisteredNavigation = PluginNavigationDescriptor;

function currentUserId(user: unknown): string | undefined {
  if (typeof user !== "object" || user === null || !("id" in user) || !("collection" in user) || user.collection !== "users" || user.id === null || user.id === undefined) return undefined;
  const id = String(user.id);
  return /^[^\\u0000-\\u001f\\u007f]{1,160}$/u.test(id) ? id : undefined;
}

function sidebarPreferences(payload: Payload) {
  return new PostgresWorkspaceSidebarPreferenceStore(payload.db.pool as RuntimeExtensionPool);
}

async function currentSalesNavigation(payload: Payload, context: ReturnType<typeof kNexRequestContext>, salesGenerationCurrent: boolean, permissions: ReadonlySet<string>): Promise<readonly RegisteredNavigation[]> {
  if (!salesGenerationCurrent) return [];
  const routes = kNexSalesRegistry.scopedRegistration.contributions.routes.map(({ value }) => value as RegisteredRoute);
  const templates = kNexSalesRegistry.scopedRegistration.contributions.pageTemplates.map(({ value }) => value as RegisteredTemplate);
  return (await Promise.all(kNexSalesRegistry.scopedRegistration.contributions.navigation.map(async ({ value }) => {
    const descriptor = value as RegisteredNavigation;
    const route = routes.find((candidate) => candidate.id === descriptor.route.routeId);
    const template = templates.find((candidate) => candidate.id === route?.viewId);
    if (route?.ownerPluginId !== "module.sales" || template?.ownerPluginId !== "module.sales" || template.route.routeId !== route.id) return undefined;
    return permissions.has(route.permission) && permissions.has(template.permission) ? descriptor : undefined;
  }))).filter((descriptor): descriptor is RegisteredNavigation => descriptor !== undefined);
}

export async function resolveCurrentWorkspaceNavigation(payload: Payload, headers: Headers) {
  const authentication = await payload.auth({ headers, canSetHeaders: false });
  const userId = currentUserId(authentication.user);
  if (userId === undefined) return undefined;
  const salesAuthority = await currentSalesGeneration(payload).catch(() => undefined);
  const state = salesAuthority?.state ?? await kNexAuthority(payload).store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  if (state === undefined) return undefined;
  const applicationTheme = await resolveApplicationTheme(payload);
  const context = kNexRequestContext(headers, "workspace-navigation");
  const salesGenerationCurrent = salesAuthority !== undefined;
  const salesPermissions = new Set(salesGenerationCurrent ? await workspaceSalesPermissions(payload, context) : []);
  const salesNavigation = await currentSalesNavigation(payload, context, salesGenerationCurrent, salesPermissions);
  const workspace = kNexWorkspacePages(payload);
  const canReadPages = await authorizeNavigationPermission(payload, context, "system.workspace-pages.read");
  const sidebar = await sidebarPreferences(payload).read({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, userId });
  const [pageItems, folderItems] = canReadPages ? await Promise.all([
    workspace.service.list(context, kNexWorkspacePageScope), workspace.folders.list(kNexWorkspacePageScope)
  ]) : [[], []];
  const pages = pageItems.map(({ page, impact }) => impact.code === "plugin-removed" || impact.code === "plugin-disabled" || impact.code === "plugin-quarantined"
    ? { ...page, navigation: { state: "unplaced" as const, reason: impact.code === "plugin-removed" ? "parent-missing" as const : "parent-inactive" as const } }
    : page);
  const visiblePageIds = new Set(pageItems.filter(({ impact }) => impact.state === "ready").map(({ page }) => page.identity.pageId));
  const navigation = await resolveWorkspaceNavigation({
    applicationId: kNexIdentity.applicationId,
    environment: kNexIdentity.environment,
    revision: state.authorizationRevision,
    implementedSystemRouteIds: ["system.route.workspace", "system.route.roles", "system.route.permissions", "system.route.assignments", "system.route.extensions", "system.route.workspace-pages", "system.route.themes", "system.route.settings", "system.route.operations"],
    // The section is durable customer-placement structure. Only current static
    // registration contributions may contribute executable plugin links.
    plugins: [{ ...kNexSalesRegistry.navigationSection,
      routes: salesGenerationCurrent ? kNexSalesRegistry.scopedRegistration.contributions.routes.map(({ value }) => value as RegisteredRoute) : [],
      navigation: salesNavigation }],
    customerFolders: folderItems.map(({ node }) => node),
    pages,
    preferences: { sidebar, favoritePageIds: [], recentPageIds: [] },
    authorize: (permissionId) => permissionId.startsWith("sales.") ? Promise.resolve(salesPermissions.has(permissionId)) : authorizeNavigationPermission(payload, context, permissionId),
    pageAccess: async (pageId) => visiblePageIds.has(pageId)
  });
  const watermark = "sha256:" + createHash("sha256").update(canonicalJson({
    navigation,
    authorizationRevision: state.authorizationRevision,
    lifecycleRevision: state.lifecycleRevision,
    theme: applicationTheme.observation
  })).digest("hex");
  return Object.freeze({ navigation, watermark, themePresentation: applicationTheme.presentation });
}

export async function updateCurrentWorkspaceSidebarPreference(payload: Payload, context: ReturnType<typeof kNexRequestContext>, value: unknown): Promise<WorkspaceSidebarPreference> {
  const userId = currentUserId((await payload.auth({ headers: context.headers, canSetHeaders: false })).user);
  if (userId === undefined) throw new TypeError("Workspace sidebar preference is unauthenticated.");
  return sidebarPreferences(payload).upsert({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, userId }, value);
}
`;
}

function salesRouteRuntimeSource(): string {
  return `import "server-only";

import { createHash } from "node:crypto";

import { canonicalJson, type DataSourceBindingResult, type UiDocument } from "@k-nex/contracts";
import { salesTimelineDescriptor } from "@k-nex/module-sales/contracts";
import { projectSalesStateHistory, type SalesStateHistoryEntry } from "@k-nex/module-sales/server";
import type { Payload } from "payload";

import { currentSalesGeneration as currentSalesAuthorityGeneration, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { executeWorkspaceSalesAction, loadWorkspaceSalesSources, prepareWorkspaceSalesDocument, projectWorkspaceSalesDocument, resolveCanonicalSavedViewBinding, workspaceSalesPermissions } from "./k-nex-sales-workspace.js";

type RegisteredRoute = Readonly<{ id: string; ownerPluginId: string; permission: string; viewId: string; parameters: Readonly<Record<string, Readonly<{ type: "string" }>>> }>;
type RegisteredTemplate = Readonly<{ id: string; ownerPluginId: string; route: Readonly<{ routeId: string }>; permission: string; document: UiDocument }>;
type RegisteredAction = Readonly<{ id: string; version: number }>;
type SalesRouteParams = Readonly<{ id: string }>;
type SalesRoutePagination = Readonly<{ listPage?: number; timelinePage?: number }>;
export type SalesRouteSelection = Readonly<{
  mode?: "table" | "kanban";
  savedView?: Readonly<{ "saved-view-id": number; "expected-revision": number }>;
  "import-job-id"?: number;
  "export-job-id"?: number;
  "target-object-type"?: "sales.object.account" | "sales.object.contact";
  id?: number;
  "expected-revision"?: number;
}>;

function positiveRouteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function salesRouteSelection(routeId: string, value: unknown): SalesRouteSelection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Sales route selection is invalid.");
  const selection = value as Record<string, unknown>;
  const keys = Object.keys(selection).sort().join("\\0");
  if (routeId === "sales.route.opportunities") {
    if (keys === "") return Object.freeze({ mode: "table" });
    if (keys === "mode" && (selection.mode === "table" || selection.mode === "kanban")) return Object.freeze({ mode: selection.mode });
    if (keys === "expected-revision\\0mode\\0saved-view-id" && selection.mode === "kanban" && positiveRouteInteger(selection["saved-view-id"]) && positiveRouteInteger(selection["expected-revision"])) {
      return Object.freeze({ mode: "kanban", savedView: Object.freeze({ "saved-view-id": selection["saved-view-id"], "expected-revision": selection["expected-revision"] }) });
    }
    throw new TypeError("Sales route selection is invalid.");
  }
  if (routeId === "sales.route.calendar" || routeId === "sales.route.saved-views") {
    if (keys === "") return Object.freeze({});
    if (keys === "expected-revision\\0saved-view-id" && positiveRouteInteger(selection["saved-view-id"]) && positiveRouteInteger(selection["expected-revision"])) {
      return Object.freeze({ savedView: Object.freeze({ "saved-view-id": selection["saved-view-id"], "expected-revision": selection["expected-revision"] }) });
    }
    throw new TypeError("Sales route selection is invalid.");
  }
  if (routeId === "sales.route.imports") {
    if (keys === "") return Object.freeze({});
    if (keys === "expected-revision\\0import-job-id" && positiveRouteInteger(selection["import-job-id"]) && positiveRouteInteger(selection["expected-revision"])) return Object.freeze({ "import-job-id": selection["import-job-id"], "expected-revision": selection["expected-revision"] });
    if (keys === "expected-revision\\0id\\0target-object-type" && (selection["target-object-type"] === "sales.object.account" || selection["target-object-type"] === "sales.object.contact") && positiveRouteInteger(selection.id) && positiveRouteInteger(selection["expected-revision"])) return Object.freeze({ "target-object-type": selection["target-object-type"], id: selection.id, "expected-revision": selection["expected-revision"] });
    throw new TypeError("Sales route selection is invalid.");
  }
  if (routeId === "sales.route.exports") {
    if (keys === "") return Object.freeze({});
    if (keys === "expected-revision\\0export-job-id" && positiveRouteInteger(selection["export-job-id"]) && positiveRouteInteger(selection["expected-revision"])) return Object.freeze({ "export-job-id": selection["export-job-id"], "expected-revision": selection["expected-revision"] });
    throw new TypeError("Sales route selection is invalid.");
  }
  if (keys !== "") throw new TypeError("Sales route selection is invalid.");
  return Object.freeze({});
}

export function salesRouteSelectionFromSearchParams(routeId: string, value: Readonly<Record<string, string | readonly string[] | undefined>>): Readonly<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string") throw new TypeError("Sales route selection is invalid.");
    if (key === "mode") input.mode = raw;
    else if (key === "saved-view-id" || key === "expected-revision" || key === "importJobId" || key === "exportJobId" || key === "recordId") {
      if (!/^[1-9][0-9]{0,15}$/u.test(raw) || !Number.isSafeInteger(Number(raw))) throw new TypeError("Sales route selection is invalid.");
      input[key === "importJobId" ? "import-job-id" : key === "exportJobId" ? "export-job-id" : key === "recordId" ? "id" : key] = Number(raw);
    } else if (key === "targetObjectType") {
      input["target-object-type"] = raw;
    } else throw new TypeError("Sales route selection is invalid.");
  }
  const parsed = salesRouteSelection(routeId, input);
  if (routeId === "sales.route.opportunities") return Object.freeze({ ...(parsed.mode === "kanban" ? { mode: "kanban" } : {}), ...(parsed.savedView ?? {}) });
  if (routeId === "sales.route.calendar" || routeId === "sales.route.saved-views") return Object.freeze(parsed.savedView ?? {});
  return Object.freeze(parsed);
}

/** Request-local data-movement selection only rewrites its registered source binding. */
function withDataMovementSelection(document: UiDocument, selection: SalesRouteSelection): UiDocument {
  const input = "import-job-id" in selection
    ? { "import-job-id": selection["import-job-id"]!, "expected-revision": selection["expected-revision"]! }
    : "export-job-id" in selection
      ? { "export-job-id": selection["export-job-id"]!, "expected-revision": selection["expected-revision"]! }
      : "target-object-type" in selection
        ? { "target-object-type": selection["target-object-type"]!, id: selection.id!, "expected-revision": selection["expected-revision"]! }
        : undefined;
  if (input === undefined) return document;
  const selectedSource = "import-job-id" in selection ? "sales.import-job.detail" : "export-job-id" in selection ? "sales.export-job.detail" : "sales.dedupe.candidates";
  const rewrite = (node: UiDocument["regions"][string][number]): UiDocument["regions"][string][number] => {
    const children = node.children?.map(rewrite);
    return node.bindings?.source?.source.id === selectedSource
      ? { ...node, bindings: { ...node.bindings, source: { ...node.bindings.source, input: input as never } }, ...(children === undefined ? {} : { children }) }
      : { ...node, ...(children === undefined ? {} : { children }) };
  };
  return { ...document, regions: Object.fromEntries(Object.entries(document.regions).map(([region, nodes]) => [region, nodes.map(rewrite)])) };
}

function routePage(value: number | undefined, maximum: number): number {
  const page = value ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > maximum) throw new TypeError("Sales route page is invalid.");
  return page;
}

function routeParams(route: RegisteredRoute, value?: SalesRouteParams): Readonly<Record<string, string>> {
  const expected = Object.keys(route.parameters).sort();
  if (expected.length === 0) {
    if (value !== undefined) throw new TypeError("Sales route parameters are invalid.");
    return Object.freeze({});
  }
  if (expected.join("\\0") !== "id" || value === undefined || Object.keys(value).sort().join("\\0") !== "id" || typeof value.id !== "string" || !/^(?:[1-9][0-9]{0,8}|1[0-9]{9}|20[0-9]{8}|21[0-3][0-9]{7}|214[0-6][0-9]{6}|2147[0-3][0-9]{5}|21474[0-7][0-9]{4}|214748[0-2][0-9]{3}|2147483[0-5][0-9]{2}|21474836[0-3][0-9]|214748364[0-7])$/u.test(value.id)) {
    throw new TypeError("Sales route parameters are invalid.");
  }
  return Object.freeze({ id: value.id });
}

function routeTemplate(routeId: string): Readonly<{ route: RegisteredRoute; template: RegisteredTemplate }> {
  const route = kNexSalesRegistry.scopedRegistration.contributions.routes.find((entry) => entry.id === routeId)?.value as RegisteredRoute | undefined;
  const template = kNexSalesRegistry.scopedRegistration.contributions.pageTemplates.find((entry) => entry.id === route?.viewId)?.value as RegisteredTemplate | undefined;
  if (route?.ownerPluginId !== "module.sales" || template?.ownerPluginId !== "module.sales" || template.route.routeId !== route.id) {
    throw new TypeError("Sales route registration is unavailable.");
  }
  return Object.freeze({ route, template });
}

type RegisteredRouteActionDescriptor = Readonly<{ id: string; version: number; permission: string }>;
function registeredRouteActionDescriptor(value: unknown): RegisteredRouteActionDescriptor | undefined {
  const candidate = value !== null && typeof value === "object" && !Array.isArray(value) && "descriptor" in value ? (value as { readonly descriptor?: unknown }).descriptor : value;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) || typeof (candidate as { readonly id?: unknown }).id !== "string" || !Number.isSafeInteger((candidate as { readonly version?: unknown }).version) || Number((candidate as { readonly version: number }).version) < 1 || typeof (candidate as { readonly permission?: unknown }).permission !== "string") return undefined;
  return candidate as RegisteredRouteActionDescriptor;
}

function registeredAction(routeId: string, nodeId: string, actionId: string, selection: SalesRouteSelection): RegisteredAction {
  const descriptor = registeredRouteActionDescriptor(kNexSalesRegistry.scopedRegistration.contributions.actions.find((entry) => entry.id === actionId)?.value);
  const { template } = routeTemplate(routeId); const document = withDataMovementSelection(prepareWorkspaceSalesDocument(template.document, selection.savedView, selection.mode ?? "table"), selection); let bound = false;
  const visit = (node: UiDocument["regions"][string][number]): void => { const binding = node.bindings?.action; if (descriptor !== undefined && node.id === nodeId && binding !== undefined && binding.id === descriptor.id && binding.version === descriptor.version) bound = true; node.children?.forEach(visit); };
  Object.values(document.regions).forEach((region) => region.forEach(visit));
  if (descriptor === undefined || !bound) throw new TypeError("Sales route action is unavailable.");
  return Object.freeze({ id: descriptor.id, version: descriptor.version });
}

function fixedDetailTimelineType(routeId: string): "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity" | undefined {
  return routeId === "sales.route.account-detail" ? "sales.account" : routeId === "sales.route.contact-detail" ? "sales.contact"
    : routeId === "sales.route.lead-detail" ? "sales.lead" : routeId === "sales.route.opportunity-detail" ? "sales.opportunity" : undefined;
}

function fixedDetailState(routeId: string): Readonly<{ collection: "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-opportunities"; field: "status" | "stageId" }> | undefined {
  return routeId === "sales.route.account-detail" ? { collection: "sales-accounts", field: "status" }
    : routeId === "sales.route.contact-detail" ? { collection: "sales-contacts", field: "status" }
      : routeId === "sales.route.lead-detail" ? { collection: "sales-leads", field: "status" }
        : routeId === "sales.route.opportunity-detail" ? { collection: "sales-opportunities", field: "stageId" } : undefined;
}

function sourceResultRecord(result: DataSourceBindingResult<unknown> | undefined, id: string): Readonly<{ key: string; values: Readonly<Record<string, unknown>> }> | undefined {
  if (result === undefined || !["success", "stale", "refetching"].includes(result.state) || !("data" in result) || result.data === null || typeof result.data !== "object" || Array.isArray(result.data)) return undefined;
  const rows = (result.data as { readonly rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0] === null || typeof rows[0] !== "object" || Array.isArray(rows[0])) return undefined;
  const row = rows[0] as { readonly key?: unknown; readonly values?: unknown };
  return row.key === id && row.values !== null && typeof row.values === "object" && !Array.isArray(row.values) ? row as Readonly<{ key: string; values: Readonly<Record<string, unknown>> }> : undefined;
}

function sourceResultRecordRevision(result: DataSourceBindingResult<unknown> | undefined, id: string): number | undefined {
  const row = sourceResultRecord(result, id);
  if (row === undefined) return undefined;
  const revision = (row.values as { readonly revision?: unknown }).revision;
  return revision !== null && typeof revision === "object" && !Array.isArray(revision) && (revision as { readonly kind?: unknown }).kind === "integer" && Number.isSafeInteger((revision as { readonly value?: unknown }).value) ? (revision as { readonly value: number }).value : undefined;
}

async function fixedDetailStateHistory(payload: Payload, routeId: string, id: string | undefined, document: UiDocument, sourceResults: Readonly<Record<string, DataSourceBindingResult<unknown>>>): Promise<readonly SalesStateHistoryEntry[]> {
  const state = fixedDetailState(routeId); const primaryNode = document.regions.main?.[0];
  if (state === undefined || id === undefined || primaryNode === undefined) return Object.freeze([]);
  const expectedRevision = sourceResultRecordRevision(sourceResults[primaryNode.id], id);
  if (expectedRevision === undefined) return Object.freeze([]);
  const dualAxis = state.collection === "sales-leads" || state.collection === "sales-opportunities";
  const select = Object.freeze({ id: true, applicationId: true, environment: true, revision: true, audit: true, ownerId: true, teamId: true, [state.field]: true, ...(dualAxis ? { archiveStatus: true } : {}) });
  const found = await payload.find({ collection: state.collection, depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, sort: ["id"], select, where: { and: [{ id: { equals: id } }, { applicationId: { equals: kNexIdentity.applicationId } }, { environment: { equals: kNexIdentity.environment } }, { revision: { equals: expectedRevision } }] } });
  if (found.docs.length !== 1) throw new TypeError("Sales detail history is unavailable.");
  const record = found.docs[0] as unknown as Record<string, unknown>; const currentState = record[state.field];
  if (String(record.id) !== id || record.applicationId !== kNexIdentity.applicationId || record.environment !== kNexIdentity.environment || record.revision !== expectedRevision || typeof record.ownerId !== "string" || record.ownerId.length === 0 || record.teamId !== undefined && record.teamId !== null && typeof record.teamId !== "string" || typeof currentState !== "string" || dualAxis && typeof record.archiveStatus !== "string") throw new TypeError("Sales detail history is invalid.");
  return projectSalesStateHistory({ audit: record.audit, collection: state.collection, id, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, revision: record.revision as number, ownerId: record.ownerId, teamId: record.teamId as string | null | undefined, currentState, currentStateField: state.field, ...(dualAxis ? { archiveStatus: record.archiveStatus as string } : {}) });
}

function authorizedFixedDetailDocument(document: UiDocument, routeId: string, permissions: readonly string[]): UiDocument {
  const fields = routeId === "sales.route.contact-detail" && permissions.includes("sales.contacts.channels.read") ? ["email", "phone"]
    : routeId === "sales.route.lead-detail" && permissions.includes("sales.leads.channels.read") ? ["email", "phone"]
      : routeId === "sales.route.opportunity-detail" && permissions.includes("sales.opportunities.amount.read") ? ["amount"] : [];
  const actionDescriptor = (value: unknown): RegisteredRouteActionDescriptor | undefined => {
    const candidate = value !== null && typeof value === "object" && !Array.isArray(value) && "descriptor" in value ? (value as { readonly descriptor?: unknown }).descriptor : value;
    return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) && typeof (candidate as { readonly id?: unknown }).id === "string" && Number.isSafeInteger((candidate as { readonly version?: unknown }).version) && Number((candidate as { readonly version: number }).version) > 0 && typeof (candidate as { readonly permission?: unknown }).permission === "string" ? candidate as RegisteredRouteActionDescriptor : undefined;
  };
  return { ...document, regions: Object.fromEntries(Object.entries(document.regions).map(([region, nodes]) => [region, nodes.flatMap((node, index) => {
    const action = node.bindings?.action;
    const descriptor = action === undefined ? undefined : actionDescriptor(kNexSalesRegistry.scopedRegistration.contributions.actions.find((entry) => entry.id === action.id)?.value);
    const actionAllowed = action === undefined || descriptor?.id === action.id && descriptor.version === action.version && typeof descriptor.permission === "string" && permissions.includes(descriptor.permission);
    if (!actionAllowed && node.bindings?.source === undefined) return [];
    const bindings = node.bindings === undefined ? undefined : { ...node.bindings, ...(!actionAllowed ? { action: undefined } : {}), ...(node.bindings.source === undefined || fields.length === 0 ? {} : { source: { ...node.bindings.source, selectedFields: [...new Set([...(node.bindings.source.selectedFields ?? []), ...fields])] } }) };
    return [{ ...node, ...(bindings === undefined ? {} : { bindings }) }];
  })])) };
}

/** Fixed daily routes may compose an internal timeline projection; page-builder documents never gain a timeline block. */
function fixedDetailTimelineDocument(document: UiDocument, type: NonNullable<ReturnType<typeof fixedDetailTimelineType>>, permissions: readonly string[]): UiDocument {
  const first = document.regions.main?.[0];
  if (first === undefined) throw new TypeError("Sales detail document is unavailable.");
  return { ...document, regions: { ...document.regions, main: [...document.regions.main, {
    id: "sales-fixed-timeline", type: first.type, version: first.version, props: first.props,
    bindings: { source: { source: { id: salesTimelineDescriptor.id, version: salesTimelineDescriptor.version }, input: { "related-record-type": type, "related-record-id": "$route.id" }, structuralCompatibilityHash: salesTimelineDescriptor.structuralCompatibilityHash, selectedFields: ["kind", "subject", "status", "occurred-at", "revision", ...(permissions.includes("sales.notes.body.read") ? ["body"] : [])] } }
  }] } };
}

export async function loadRegisteredSalesRoute(payload: Payload, context: KnexRequestContext, routeId: string, value?: SalesRouteParams, pagination: SalesRoutePagination = Object.freeze({}), selectionValue: unknown = Object.freeze({})) {
  const initialState = (await currentSalesAuthorityGeneration(payload)).state;
  const { route, template } = routeTemplate(routeId);
  const parameters = routeParams(route, value);
  const permissions = await workspaceSalesPermissions(payload, context);
  if (!permissions.includes(route.permission) || !permissions.includes(template.permission)) {
    throw new TypeError("Sales route is denied.");
  }
  const requestedSelection = salesRouteSelection(route.id, selectionValue);
  const canonicalBinding = route.id === "sales.route.saved-views" && requestedSelection.savedView === undefined ? await resolveCanonicalSavedViewBinding(payload, context) : undefined;
  const selection: SalesRouteSelection = canonicalBinding !== undefined && "saved-view-id" in canonicalBinding
    ? Object.freeze({ savedView: canonicalBinding as Readonly<{ "saved-view-id": number; "expected-revision": number }> }) : requestedSelection;
  const timelineType = fixedDetailTimelineType(route.id);
  const listPage = routePage(pagination.listPage, 1_000_000);
  const timelinePage = routePage(pagination.timelinePage, 4);
  if (timelineType === undefined && pagination.timelinePage !== undefined || timelineType !== undefined && pagination.listPage !== undefined) throw new TypeError("Sales route pagination is invalid.");
  const primary = await projectWorkspaceSalesDocument(payload, context, withDataMovementSelection(authorizedFixedDetailDocument(template.document, route.id, permissions), selection), permissions, new AbortController().signal, parameters, timelineType === undefined ? listPage : 1, selection.savedView, selection.mode ?? "table");
  const { document, sourceResults } = primary;
  const timeline = timelineType === undefined ? null : (await loadWorkspaceSalesSources(payload, context, fixedDetailTimelineDocument(document, timelineType, permissions), permissions, new AbortController().signal, parameters, timelinePage))["sales-fixed-timeline"] ?? null;
  const stateHistory = await fixedDetailStateHistory(payload, route.id, parameters.id, document, sourceResults);
  const [finalState, finalPermissions] = await Promise.all([
    currentSalesAuthorityGeneration(payload).then((current) => current.state), workspaceSalesPermissions(payload, context)
  ]);
  if (finalState.authorizationRevision !== initialState.authorizationRevision || finalState.lifecycleRevision !== initialState.lifecycleRevision ||
    !finalPermissions.includes(route.permission) || !finalPermissions.includes(template.permission) || canonicalJson(finalPermissions) !== canonicalJson(permissions)) {
    throw new TypeError("Sales route authority changed.");
  }
  const finalSourceResults = timelineType === undefined ? sourceResults : await loadWorkspaceSalesSources(payload, context, document, finalPermissions, new AbortController().signal, parameters, 1);
  if (timelineType !== undefined) {
    const primaryNode = document.regions.main?.[0];
    const initialRecord = primaryNode === undefined || parameters.id === undefined ? undefined : sourceResultRecord(sourceResults[primaryNode.id], parameters.id);
    const finalRecord = primaryNode === undefined || parameters.id === undefined ? undefined : sourceResultRecord(finalSourceResults[primaryNode.id], parameters.id);
    if (initialRecord === undefined || finalRecord === undefined || canonicalJson(finalRecord) !== canonicalJson(initialRecord)) throw new TypeError("Sales detail record changed or is no longer authorized.");
  }
  const [postReloadState, postReloadPermissions] = await Promise.all([
    currentSalesAuthorityGeneration(payload).then((current) => current.state), workspaceSalesPermissions(payload, context)
  ]);
  if (postReloadState.authorizationRevision !== finalState.authorizationRevision || postReloadState.lifecycleRevision !== finalState.lifecycleRevision || canonicalJson(postReloadPermissions) !== canonicalJson(finalPermissions)) throw new TypeError("Sales route authority changed during final record authorization.");
  const watermark = "sha256:" + createHash("sha256").update(canonicalJson({
    authorizationRevision: postReloadState.authorizationRevision, lifecycleRevision: postReloadState.lifecycleRevision,
    permissions: postReloadPermissions, routeId: route.id, routeParams: parameters, sourceResults: finalSourceResults, stateHistory, timeline
  })).digest("hex");
  return Object.freeze({ document, permissions: postReloadPermissions, selection: Object.freeze({ ...(selection.mode === "kanban" ? { mode: "kanban" } : {}), ...(selection.savedView ?? {}), ...("import-job-id" in selection ? { "import-job-id": selection["import-job-id"], "expected-revision": selection["expected-revision"] } : {}), ...("export-job-id" in selection ? { "export-job-id": selection["export-job-id"], "expected-revision": selection["expected-revision"] } : {}), ...("target-object-type" in selection ? { "target-object-type": selection["target-object-type"], id: selection.id, "expected-revision": selection["expected-revision"] } : {}) }), sourceResults: finalSourceResults, stateHistory, timeline, watermark });
}

export async function executeRegisteredSalesRouteAction(payload: Payload, context: KnexRequestContext, routeId: string, nodeId: string, actionId: string, input: unknown, selectionValue: unknown, idempotencyKey: string, signal: AbortSignal) {
  await currentSalesAuthorityGeneration(payload);
  const selection = salesRouteSelection(routeId, selectionValue);
  if ((actionId === "sales.saved-view.update" || actionId === "sales.saved-view.archive") && (selection.savedView === undefined || input === null || typeof input !== "object" || Array.isArray(input) || (input as Record<string, unknown>).id !== String(selection.savedView["saved-view-id"]) || (input as Record<string, unknown>).expectedRevision !== selection.savedView["expected-revision"])) throw new TypeError("Sales Saved View action selection changed.");
  return executeWorkspaceSalesAction(payload, context, registeredAction(routeId, nodeId, actionId, selection), input, idempotencyKey, signal);
}
`;
}

function salesRouteRuntimeClientSource(): string {
  return `"use client";

import { canonicalJson, DataSourceBindingResultSchema, type DataSourceBindingResult, type UiDocument } from "@k-nex/contracts";
import {
  isSalesRecordId,
  salesAccountDetailDescriptor,
  salesAccountsDescriptor,
  salesContactDetailDescriptor,
  salesContactsDescriptor,
  salesLeadDetailDescriptor,
  salesLeadsDescriptor,
  salesNotificationsDescriptor,
  salesDedupeCandidatesDescriptor,
  salesExportJobDetailDescriptor,
  salesExportJobListDescriptor,
  salesImportJobDetailDescriptor,
  salesImportJobListDescriptor,
  salesOpportunitiesDescriptor,
  salesOpportunityDetailDescriptor,
  salesPipelineSnapshotDescriptor,
  salesProviderConfigurationsDescriptor,
  salesActivityByOwnerTeamDescriptor,
  salesLeadConversionDescriptor,
  salesPipelineValueByStageDescriptor,
  salesSalesCycleDurationDescriptor,
  salesTaskAgingDescriptor,
  salesWeightedForecastDescriptor,
  salesWonLostConversionDescriptor,
  salesSavedViewCalendarDescriptor,
  salesSavedViewDetailDescriptor,
  salesSavedViewKanbanDescriptor,
  salesSavedViewListDescriptor,
  salesSavedViewTableDescriptor,
  salesRemindersDescriptor,
  salesTasksDescriptor,
  salesTimelineDescriptor
} from "@k-nex/module-sales/contracts";
import { SalesFixedDetailRouteProvider, SalesStateHistory, SalesTimeline, type SalesStateHistoryEntry } from "@k-nex/module-sales/pages";
import { salesUiBlockDefinitions } from "@k-nex/module-sales/ui";
import type { DataTableRequestState } from "@k-nex/ui-data/data-table-controller";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import { createUiDocumentRuntime, createUiRuntimeRegistry, prepareUiRuntimeDocument, presentUiRuntimeResult, type UiRuntimeActionDispatchRequest } from "@k-nex/ui-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: salesUiBlockDefinitions, sources: [salesAccountsDescriptor, salesAccountDetailDescriptor, salesContactsDescriptor, salesContactDetailDescriptor, salesLeadsDescriptor, salesLeadDetailDescriptor, salesOpportunitiesDescriptor, salesOpportunityDetailDescriptor, salesTasksDescriptor, salesTimelineDescriptor, salesPipelineSnapshotDescriptor, salesProviderConfigurationsDescriptor, salesSavedViewListDescriptor, salesSavedViewDetailDescriptor, salesSavedViewTableDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewCalendarDescriptor, salesImportJobListDescriptor, salesImportJobDetailDescriptor, salesExportJobListDescriptor, salesExportJobDetailDescriptor, salesDedupeCandidatesDescriptor, salesNotificationsDescriptor, salesRemindersDescriptor, salesPipelineValueByStageDescriptor, salesWeightedForecastDescriptor, salesWonLostConversionDescriptor, salesLeadConversionDescriptor, salesActivityByOwnerTeamDescriptor, salesTaskAgingDescriptor, salesSalesCycleDurationDescriptor] }));
type Projection = Readonly<{ document: UiDocument; permissions: readonly string[]; selection: Readonly<Record<string, unknown>>; sourceResults: Readonly<Record<string, DataSourceBindingResult<unknown>>>; stateHistory: readonly SalesStateHistoryEntry[]; timeline: DataSourceBindingResult<unknown> | null; watermark: string }>;
const routeTopics: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "sales.route.accounts": ["sales.realtime.accounts"], "sales.route.account-detail": ["sales.realtime.accounts", "sales.realtime.timeline"],
  "sales.route.contacts": ["sales.realtime.contacts"], "sales.route.contact-detail": ["sales.realtime.contacts", "sales.realtime.timeline"],
  "sales.route.leads": ["sales.realtime.leads"], "sales.route.lead-detail": ["sales.realtime.leads", "sales.realtime.timeline"],
  "sales.route.opportunities": ["sales.realtime.opportunities"], "sales.route.opportunity-detail": ["sales.realtime.opportunities", "sales.realtime.timeline"],
  "sales.route.tasks": ["sales.realtime.tasks"],
  "sales.route.notifications": ["sales.realtime.notifications", "sales.realtime.reminders"],
  "sales.route.settings": ["sales.realtime.provider-configurations"],
  "sales.route.imports": ["sales.realtime.accounts", "sales.realtime.contacts", "sales.realtime.leads", "sales.realtime.import-jobs"],
  "sales.route.exports": ["sales.realtime.accounts", "sales.realtime.contacts", "sales.realtime.leads", "sales.realtime.export-jobs"]
  ,"sales.route.reports": []
});
const routeTitles: Readonly<Record<string, string>> = Object.freeze({
  "sales.route.overview": "Sales overview", "sales.route.tasks": "Sales tasks", "sales.route.opportunities": "Opportunities", "sales.route.settings": "Sales settings",
  "sales.route.accounts": "Accounts", "sales.route.account-detail": "Account detail", "sales.route.contacts": "Contacts", "sales.route.contact-detail": "Contact detail",
  "sales.route.leads": "Leads", "sales.route.lead-detail": "Lead detail", "sales.route.opportunity-detail": "Opportunity detail"
  ,"sales.route.calendar": "Sales calendar", "sales.route.notifications": "Notifications", "sales.route.pipeline-settings": "Pipeline settings", "sales.route.saved-views": "Saved views", "sales.route.imports": "Imports", "sales.route.exports": "Exports", "sales.route.reports": "Reports"
});
export function createSalesRouteRefreshScheduler(run: (signal: AbortSignal) => Promise<void>) {
  let pending = false;
  let queued = false;
  let disposed = false;
  let pendingAbort: AbortController | undefined;
  const refresh = (urgent = false): void => {
    if (disposed) return;
    if (pending) { queued = true; if (urgent) pendingAbort?.abort(); return; }
    pending = true;
    const abort = new AbortController(); pendingAbort = abort;
    void run(abort.signal).catch(() => undefined).finally(() => {
      pending = false;
      if (pendingAbort === abort) pendingAbort = undefined;
      if (queued && !disposed) { queued = false; refresh(); }
    });
  };
  return Object.freeze({ refresh, dispose: () => { disposed = true; queued = false; pendingAbort?.abort(); } });
}
function opaqueRealtimeEvent(value: unknown, allowed: ReadonlySet<string>): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return Object.keys(event).sort().join("\\0") === "correlationId\\0event\\0messageClass\\0topicId" && typeof event.correlationId === "string" && typeof event.topicId === "string" && allowed.has(event.topicId) && event.messageClass === "reconstructible-invalidation" && event.event !== null && typeof event.event === "object" && !Array.isArray(event.event) && Object.keys(event.event as Record<string, unknown>).sort().join("\\0") === "correlation\\0dedupe\\0event\\0source\\0topic";
}

function stateHistory(value: unknown): readonly SalesStateHistoryEntry[] | undefined {
  if (!Array.isArray(value) || value.length > 25) return undefined;
  const entries: SalesStateHistoryEntry[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).sort().join("\\0") !== "actionId\\0fromState\\0occurredAt\\0revision\\0stateField\\0toState" || typeof record.actionId !== "string" || !/^sales\\.[a-z]+(?:[.-][a-z]+)*$/u.test(record.actionId) || record.actionId.length > 128 ||
      !["status", "stageId", "archiveStatus"].includes(String(record.stateField)) || typeof record.fromState !== "string" || record.fromState.length === 0 || record.fromState.length > 64 || typeof record.toState !== "string" || record.toState.length === 0 || record.toState.length > 64 ||
      !Number.isSafeInteger(record.revision) || (record.revision as number) < 1 || (record.revision as number) > 1_000_000_000 || typeof record.occurredAt !== "string" || !Number.isFinite(Date.parse(record.occurredAt)) || new Date(record.occurredAt).toISOString() !== record.occurredAt) return undefined;
    entries.push(Object.freeze(record as unknown as SalesStateHistoryEntry));
  }
  if (entries.some((entry, index) => index > 0 && entry.revision >= entries[index - 1]!.revision)) return undefined;
  return Object.freeze(entries);
}

function projectionSelection(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const selection = value as Record<string, unknown>; const keys = Object.keys(selection).sort().join("\\0");
  if (keys === "") return Object.freeze({});
  const pair = Number.isSafeInteger(selection["saved-view-id"]) && (selection["saved-view-id"] as number) > 0 && Number.isSafeInteger(selection["expected-revision"]) && (selection["expected-revision"] as number) > 0;
  if (keys === "expected-revision\\0saved-view-id" && pair || keys === "expected-revision\\0mode\\0saved-view-id" && pair && selection.mode === "kanban" || keys === "mode" && selection.mode === "kanban") return Object.freeze({ ...selection });
  const revision = Number.isSafeInteger(selection["expected-revision"]) && (selection["expected-revision"] as number) > 0;
  if (keys === "expected-revision\\0import-job-id" && revision && Number.isSafeInteger(selection["import-job-id"]) && (selection["import-job-id"] as number) > 0 ||
    keys === "expected-revision\\0export-job-id" && revision && Number.isSafeInteger(selection["export-job-id"]) && (selection["export-job-id"] as number) > 0 ||
    keys === "expected-revision\\0id\\0target-object-type" && revision && Number.isSafeInteger(selection.id) && (selection.id as number) > 0 && (selection["target-object-type"] === "sales.object.account" || selection["target-object-type"] === "sales.object.contact")) return Object.freeze({ ...selection });
  return undefined;
}

function projection(value: unknown): Projection | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join("\\0") !== "document\\0permissions\\0selection\\0sourceResults\\0stateHistory\\0timeline\\0watermark" || typeof candidate.document !== "object" || candidate.document === null || Array.isArray(candidate.document) ||
    !Array.isArray(candidate.permissions) || candidate.permissions.some((permission) => typeof permission !== "string") || typeof candidate.sourceResults !== "object" || candidate.sourceResults === null || Array.isArray(candidate.sourceResults) ||
    candidate.selection === null || typeof candidate.selection !== "object" || Array.isArray(candidate.selection) || candidate.timeline !== null && (typeof candidate.timeline !== "object" || Array.isArray(candidate.timeline)) || typeof candidate.watermark !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(candidate.watermark)) return undefined;
  try {
    const history = stateHistory(candidate.stateHistory); const selection = projectionSelection(candidate.selection); if (history === undefined || selection === undefined) return undefined;
    return Object.freeze({ document: prepareUiRuntimeDocument(candidate.document), permissions: Object.freeze([...candidate.permissions]), selection, sourceResults: Object.freeze(Object.fromEntries(Object.entries(candidate.sourceResults).map(([id, result]) => [id, DataSourceBindingResultSchema.parse(result)]))), stateHistory: history, timeline: candidate.timeline === null ? null : DataSourceBindingResultSchema.parse(candidate.timeline), watermark: candidate.watermark });
  } catch { return undefined; }
}

function savedViewMutationPair(value: unknown, status: "active" | "archived"): Readonly<{ "saved-view-id": number; "expected-revision": number }> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = value as Record<string, unknown>;
  if (!isSalesRecordId(result.id) || !Number.isSafeInteger(result.revision) || (result.revision as number) < 1 || result.status !== status) return undefined;
  return Object.freeze({ "saved-view-id": Number(result.id), "expected-revision": result.revision as number });
}

export function salesLocationSelection(routeId: string, search: string): Readonly<Record<string, unknown>> | undefined {
  const raw: Record<string, unknown> = {};
  const query = new URLSearchParams(search);
  for (const key of query.keys()) {
    if (query.getAll(key).length !== 1 || !["mode", "saved-view-id", "expected-revision", "importJobId", "exportJobId", "targetObjectType", "recordId"].includes(key)) return undefined;
    const value = query.get(key)!;
    if (key === "mode") raw.mode = value;
    else if (key === "targetObjectType") raw["target-object-type"] = value;
    else if (!/^[1-9][0-9]{0,15}$/u.test(value) || !Number.isSafeInteger(Number(value))) return undefined;
    else raw[key === "importJobId" ? "import-job-id" : key === "exportJobId" ? "export-job-id" : key === "recordId" ? "id" : key] = Number(value);
  }
  const keys = Object.keys(raw).sort().join("\\0");
  if (routeId === "sales.route.opportunities") {
    if (keys === "" || keys === "mode" && raw.mode === "table") return Object.freeze({});
    if (keys === "mode" && raw.mode === "kanban") return Object.freeze({ mode: "kanban" });
    if (keys === "expected-revision\\0mode\\0saved-view-id" && raw.mode === "kanban") return Object.freeze(raw);
    return undefined;
  }
  if (routeId === "sales.route.calendar" || routeId === "sales.route.saved-views") return keys === "" || keys === "expected-revision\\0saved-view-id" ? Object.freeze(raw) : undefined;
  if (routeId === "sales.route.imports") return keys === "" || keys === "expected-revision\\0import-job-id" || keys === "expected-revision\\0id\\0target-object-type" && (raw["target-object-type"] === "sales.object.account" || raw["target-object-type"] === "sales.object.contact") ? Object.freeze(raw) : undefined;
  if (routeId === "sales.route.exports") return keys === "" || keys === "expected-revision\\0export-job-id" ? Object.freeze(raw) : undefined;
  return keys === "" ? Object.freeze({}) : undefined;
}

export function savedViewMutationSelection(selection: Readonly<Record<string, unknown>>, actionId: string, result: unknown): Readonly<Record<string, unknown>> | undefined {
  if (actionId === "sales.saved-view.create" || actionId === "sales.saved-view.update") {
    const pair = savedViewMutationPair(result, "active");
    return pair === undefined ? undefined : Object.freeze({ ...(selection.mode === "kanban" ? { mode: "kanban" } : {}), ...pair });
  }
  if (actionId === "sales.saved-view.archive") return savedViewMutationPair(result, "archived") === undefined ? undefined : Object.freeze(selection.mode === "kanban" ? { mode: "kanban" } : {});
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    const data = result as Record<string, unknown>;
    const revision = data.revision;
    if (actionId.startsWith("sales.import.") && Number.isSafeInteger(data.importJobId) && (data.importJobId as number) > 0 && Number.isSafeInteger(revision) && (revision as number) > 0) return Object.freeze({ "import-job-id": data.importJobId as number, "expected-revision": revision as number });
    if (actionId.startsWith("sales.export.") && Number.isSafeInteger(data.exportJobId) && (data.exportJobId as number) > 0 && Number.isSafeInteger(revision) && (revision as number) > 0) return Object.freeze({ "export-job-id": data.exportJobId as number, "expected-revision": revision as number });
  }
  return selection;
}

export function salesSelectionHref(pathname: string, selection: Readonly<Record<string, unknown>>): string {
  const query = new URLSearchParams(); for (const [key, value] of Object.entries(selection)) query.set(key === "import-job-id" ? "importJobId" : key === "export-job-id" ? "exportJobId" : key === "target-object-type" ? "targetObjectType" : key === "id" && "target-object-type" in selection ? "recordId" : key, String(value));
  return pathname + (query.size === 0 ? "" : "?" + query.toString());
}

export function RegisteredSalesRouteRuntime({ initialProjection, initialSelection, routeId, routeParams }: Readonly<{ initialProjection: Projection; initialSelection: Readonly<Record<string, unknown>>; routeId: string; routeParams?: Readonly<{ id: string }> }>) {
  const [current, setCurrent] = useState<Projection | undefined>(initialProjection);
  const [selection, setSelection] = useState(initialProjection.selection);
  const [listPage, setListPage] = useState(1);
  const [timelinePage, setTimelinePage] = useState(1);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const replaceSelection = useCallback((next: Readonly<Record<string, unknown>>) => {
    window.history.replaceState(null, "", salesSelectionHref(window.location.pathname, next));
    setListPage(1); setPageRefreshing(true); setSelection(next);
  }, []);
  const dispatchAction = useCallback(async (request: UiRuntimeActionDispatchRequest) => {
    const response = await fetch("/api/k-nex/sales/actions/" + encodeURIComponent(request.action.id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ routeId, nodeId: request.nodeId, input: request.input, selection, idempotencyKey: "sales-route-action-" + crypto.randomUUID() }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.code ?? "Sales action failed.");
    const nextSelection = savedViewMutationSelection(selection, request.action.id, body.data);
    if (nextSelection === undefined) throw new Error("Sales Saved View action result is invalid.");
    if (nextSelection !== selection) replaceSelection(nextSelection);
    return body.data;
  }, [replaceSelection, routeId, selection]);
  useEffect(() => { setCurrent(initialProjection); setSelection(initialProjection.selection); if (canonicalJson(initialProjection.selection) !== canonicalJson(initialSelection)) window.history.replaceState(null, "", salesSelectionHref(window.location.pathname, initialProjection.selection)); setListPage(1); setTimelinePage(1); }, [initialProjection, initialSelection, routeId, routeParams?.id]);
  useEffect(() => {
    const expectedRevision = selection["expected-revision"];
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1) return;
    if (routeId === "sales.route.imports" && Number.isSafeInteger(selection["import-job-id"]) && (selection["import-job-id"] as number) > 0) window.dispatchEvent(new CustomEvent("k-nex:sales-import-select", { detail: { importJobId: selection["import-job-id"], expectedRevision, requestLocal: true } }));
    else if (routeId === "sales.route.imports" && (selection["target-object-type"] === "sales.object.account" || selection["target-object-type"] === "sales.object.contact") && Number.isSafeInteger(selection.id) && (selection.id as number) > 0) window.dispatchEvent(new CustomEvent("k-nex:sales-dedupe-select", { detail: { targetObjectType: selection["target-object-type"], recordId: selection.id, expectedRevision, requestLocal: true } }));
    else if (routeId === "sales.route.exports" && Number.isSafeInteger(selection["export-job-id"]) && (selection["export-job-id"] as number) > 0) window.dispatchEvent(new CustomEvent("k-nex:sales-export-select", { detail: { exportJobId: selection["export-job-id"], expectedRevision, requestLocal: true } }));
  }, [routeId, selection]);
  useEffect(() => {
    if (routeId !== "sales.route.saved-views") return;
    const select = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === null || typeof detail !== "object" || Array.isArray(detail) || Object.keys(detail).sort().join("\\0") !== "expectedRevision\\0savedViewId") return;
      const { savedViewId, expectedRevision } = detail as Record<string, unknown>;
      if (!Number.isSafeInteger(savedViewId) || (savedViewId as number) < 1 || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1) return;
      replaceSelection({ "saved-view-id": savedViewId as number, "expected-revision": expectedRevision as number });
    };
    window.addEventListener("k-nex:saved-view-select", select); return () => window.removeEventListener("k-nex:saved-view-select", select);
  }, [replaceSelection, routeId]);
  useEffect(() => {
    const select = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return;
      const value = detail as Record<string, unknown>; const keys = Object.keys(value).sort().join("\\0");
      if (routeId === "sales.route.imports" && keys === "expectedRevision\\0importJobId" && Number.isSafeInteger(value.importJobId) && (value.importJobId as number) > 0 && Number.isSafeInteger(value.expectedRevision) && (value.expectedRevision as number) > 0) replaceSelection({ "import-job-id": value.importJobId as number, "expected-revision": value.expectedRevision as number });
      else if (routeId === "sales.route.imports" && keys === "expectedRevision\\0recordId\\0targetObjectType" && (value.targetObjectType === "sales.object.account" || value.targetObjectType === "sales.object.contact") && Number.isSafeInteger(value.recordId) && (value.recordId as number) > 0 && Number.isSafeInteger(value.expectedRevision) && (value.expectedRevision as number) > 0) replaceSelection({ "target-object-type": value.targetObjectType, id: value.recordId as number, "expected-revision": value.expectedRevision as number });
      else if (routeId === "sales.route.exports" && keys === "expectedRevision\\0exportJobId" && Number.isSafeInteger(value.exportJobId) && (value.exportJobId as number) > 0 && Number.isSafeInteger(value.expectedRevision) && (value.expectedRevision as number) > 0) replaceSelection({ "export-job-id": value.exportJobId as number, "expected-revision": value.expectedRevision as number });
    };
    window.addEventListener("k-nex:sales-import-select", select); window.addEventListener("k-nex:sales-dedupe-select", select); window.addEventListener("k-nex:sales-export-select", select);
    return () => { window.removeEventListener("k-nex:sales-import-select", select); window.removeEventListener("k-nex:sales-dedupe-select", select); window.removeEventListener("k-nex:sales-export-select", select); };
  }, [replaceSelection, routeId]);
  useEffect(() => {
    if (routeId !== "sales.route.exports") return;
    const download = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === null || typeof detail !== "object" || Array.isArray(detail) || Object.keys(detail).join("\\0") !== "artifactId" || typeof (detail as Record<string, unknown>).artifactId !== "string") return;
      const artifactId = (detail as Record<string, string>).artifactId;
      if (artifactId.length < 1 || artifactId.length > 128 || artifactId.includes("\\0")) return;
      window.location.assign("/api/k-nex/sales/export-artifact?artifactId=" + encodeURIComponent(artifactId));
    };
    window.addEventListener("k-nex:sales-export-download", download); return () => window.removeEventListener("k-nex:sales-export-download", download);
  }, [routeId]);
  useEffect(() => {
    const changePage = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === null || typeof detail !== "object" || Array.isArray(detail) || Object.keys(detail).sort().join("\\0") !== "nodeId\\0page") return;
      const { nodeId, page } = detail as Record<string, unknown>;
      if (typeof nodeId !== "string" || nodeId.length < 1 || nodeId.length > 128 || nodeId !== nodeId.normalize("NFC") || nodeId.includes("\\0") || !Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > 1_000_000) return;
      let admitted = false; const visit = (node: UiDocument["regions"][string][number]): void => { if (node.id === nodeId && ["sales.saved-view.table", "sales.saved-view.kanban", "sales.saved-view.calendar"].includes(node.bindings?.source?.source.id ?? "")) admitted = true; node.children?.forEach(visit); };
      if (current !== undefined) Object.values(current.document.regions).forEach((region) => region.forEach(visit));
      if (admitted) { setPageRefreshing(true); setListPage(page as number); }
    };
    window.addEventListener("k-nex:sales-page-change", changePage); return () => window.removeEventListener("k-nex:sales-page-change", changePage);
  }, [current]);
  useEffect(() => {
    const restore = () => { const next = salesLocationSelection(routeId, window.location.search); if (next !== undefined) { setListPage(1); setPageRefreshing(true); setSelection(next); } };
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, [routeId]);
  useEffect(() => {
    let active = true;
    const scheduler = createSalesRouteRefreshScheduler(async (signal) => {
      const query = new URLSearchParams();
      if (routeParams === undefined) query.set("page", String(listPage)); else { query.set("id", routeParams.id); query.set("timelinePage", String(timelinePage)); }
      for (const [key, value] of Object.entries(selection)) query.set(key === "import-job-id" ? "importJobId" : key === "export-job-id" ? "exportJobId" : key === "target-object-type" ? "targetObjectType" : key === "id" && "target-object-type" in selection ? "recordId" : key, String(value));
      const response = await fetch("/api/k-nex/sales/routes/" + encodeURIComponent(routeId) + "?" + query, { cache: "no-store", signal }).catch(() => undefined);
      const next = response?.ok ? projection(await response.json().catch(() => undefined)) : undefined;
      if (active && !signal.aborted) { setCurrent(next); if (next !== undefined && canonicalJson(next.selection) !== canonicalJson(selection)) { window.history.replaceState(null, "", salesSelectionHref(window.location.pathname, next.selection)); setSelection(next.selection); } setPageRefreshing(false); }
    });
    const topics = new Set(routeTopics[routeId] ?? []);
    const socket = topics.size === 0 ? undefined : io({ transports: ["websocket"], withCredentials: true, reconnection: true });
    const subscribe = () => { for (const topicId of topics) void socket?.emitWithAck("k-nex:subscribe", { topicId, params: {} }).catch(() => undefined); scheduler.refresh(); };
    socket?.on("connect", subscribe);
    socket?.on("k-nex:event", (event: unknown, acknowledge: unknown) => {
      if (typeof acknowledge === "function") (acknowledge as () => void)();
      if (opaqueRealtimeEvent(event, topics)) scheduler.refresh(true);
    });
    scheduler.refresh();
    // Socket reconnect is an authoritative resync edge.  Polling is only a
    // bounded loss fallback, deliberately slower than an admitted invalidation.
    const timer = setInterval(() => { scheduler.refresh(); }, 5_000);
    return () => { active = false; scheduler.dispose(); clearInterval(timer); for (const topicId of topics) void socket?.emitWithAck("k-nex:unsubscribe", { topicId, params: {} }).catch(() => undefined); socket?.disconnect(); };
  }, [routeId, routeParams?.id, listPage, timelinePage, selection]);
  const result = useMemo(() => current === undefined ? undefined : runtime.render({
    document: current.document, surface: "workspace", actor: { authenticated: true, permissions: new Set(current.permissions) }, sourceResults: current.sourceResults,
    dispatchAction
  }), [current, dispatchAction]);
  const pagination = useMemo(() => ({ listPage, timelinePage, onListPageChange: (page: number) => { if (Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000) { setPageRefreshing(true); setListPage(page); } }, onTimelinePageChange: (page: number) => { if (Number.isSafeInteger(page) && page >= 1 && page <= 4) { setPageRefreshing(true); setTimelinePage(page); } } }), [listPage, timelinePage]);
  const title = routeTitles[routeId];
  if (result === undefined || title === undefined) return <section role="alert" data-k-nex-sales-route="unavailable">Sales route unavailable</section>;
  const timeline = current?.timeline as unknown as DataTableRequestState | null | undefined;
  const timelineElement = timeline === null || timeline === undefined || current === undefined ? undefined : <SalesTimeline requestState={timeline} permissions={current.permissions} dispatchAction={dispatchAction} />;
  const historyElement = current === undefined ? undefined : <SalesStateHistory entries={current.stateHistory} />;
  const mode = selection.mode === "kanban" ? "kanban" : "table";
  const switchMode = routeId === "sales.route.opportunities" ? <nav aria-label="Opportunity view"><button type="button" aria-pressed={mode === "table"} onClick={() => replaceSelection({})}>Table</button><button type="button" aria-pressed={mode === "kanban"} onClick={() => replaceSelection({ mode: "kanban" })}>Kanban</button></nav> : null;
  return <SalesFixedDetailRouteProvider timeline={timelineElement} history={historyElement} pagination={pagination} hostOwnsRouteChrome><h1>{title}</h1>{switchMode}{pageRefreshing ? <p role="status" aria-live="polite">Refreshing page…</p> : null}{presentUiRuntimeReact(presentUiRuntimeResult(result))}</SalesFixedDetailRouteProvider>;
}
`;
}

function salesRoutePageSource(routeId: string, pathname: string, parameterized = false): string {
  const nestedSegments = pathname.split("/").length - 1;
  const source = "../".repeat(3 + nestedSegments);
  const components = "../".repeat(2 + nestedSegments);
  return `import { headers as getHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { bootKnexApplication } from "${source}boot.js";
import { kNexRequestContext } from "${source}k-nex-authority.js";
import { loadRegisteredSalesRoute, salesRouteSelectionFromSearchParams } from "${source}k-nex-sales-routes.js";
import { resolveMergedSalesDetailRedirect } from "${source}k-nex-sales-workspace.js";
import { RegisteredSalesRouteRuntime } from "${components}components/k-nex-sales-route-runtime.js";

export const dynamic = "force-dynamic";

export default async function SalesRoute({${parameterized ? " params," : ""} searchParams }: Readonly<{${parameterized ? " params: Promise<{ id: string }>;" : ""} searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const context = kNexRequestContext(headers, "sales-route");
  ${parameterized ? `const routeParams = Object.freeze({ id: (await params).id });\n  const mergedRedirect = await resolveMergedSalesDetailRedirect(payload, context, ${JSON.stringify(routeId)}, routeParams.id);\n  if (mergedRedirect !== undefined) redirect(mergedRedirect);\n  ` : ""}try {
    const selection = salesRouteSelectionFromSearchParams(${JSON.stringify(routeId)}, await searchParams);
    return <RegisteredSalesRouteRuntime routeId={${JSON.stringify(routeId)}}${parameterized ? " routeParams={routeParams}" : ""} initialSelection={selection} initialProjection={await loadRegisteredSalesRoute(payload, context, ${JSON.stringify(routeId)}, ${parameterized ? "routeParams" : "undefined"}, Object.freeze({}), selection)} />;
  } catch { return notFound(); }
}
`;
}

function salesRouteProjectionRouteSource(): string {
  return `import { headers as getHeaders } from "next/headers";

import { bootKnexApplication } from "../../../../../../boot.js";
import { kNexRequestContext } from "../../../../../../k-nex-authority.js";
import { loadRegisteredSalesRoute, salesRouteSelectionFromSearchParams } from "../../../../../../k-nex-sales-routes.js";

export const dynamic = "force-dynamic";

function pageNumber(value: string | null, maximum: number): number {
  if (value === null || !/^[1-9][0-9]{0,6}$/u.test(value) || Number(value) > maximum) throw new TypeError("Sales route page is invalid.");
  return Number(value);
}

function serverObserved(response: Response, started: number): Response {
  response.headers.set("server-timing", "knex;dur=" + Math.max(0, performance.now() - started).toFixed(3));
  return response;
}

export async function GET(request: Request, { params }: Readonly<{ params: Promise<{ routeId: string }> }>) {
  const started = performance.now();
  try {
    const payload = await bootKnexApplication("workspace-web");
    const headers = await getHeaders();
    const routeId = (await params).routeId;
    const query = new URL(request.url).searchParams;
    for (const key of new Set(query.keys())) if (query.getAll(key).length !== 1) throw new TypeError("Sales route parameters are invalid.");
    const id = query.get("id"); const page = query.get("page"); const timelinePage = query.get("timelinePage");
    if (id !== null && page !== null || id === null && timelinePage !== null) throw new TypeError("Sales route parameters are invalid.");
    const routeParams = id === null ? undefined : Object.freeze({ id });
    const pagination = page !== null ? Object.freeze({ listPage: pageNumber(page, 1_000_000) }) : timelinePage !== null ? Object.freeze({ timelinePage: pageNumber(timelinePage, 4) }) : Object.freeze({});
    const selectionRecord = Object.fromEntries([...query.entries()].filter(([key]) => !["id", "page", "timelinePage"].includes(key)));
    const selection = salesRouteSelectionFromSearchParams(routeId, selectionRecord);
    const response = Response.json(await loadRegisteredSalesRoute(payload, kNexRequestContext(headers, "sales-route-projection"), routeId, routeParams, pagination, selection), { headers: { "cache-control": "no-store" } });
    return serverObserved(response, started);
  } catch { return Response.json({ code: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } }); }
}
`;
}

function salesActionRouteSource(): string {
  return `import { executeRegisteredSalesRouteAction } from "../../../../../../k-nex-sales-routes.js";
import { openWorkspaceJson, workspaceMutationError } from "../../../../../../k-nex-workspace-page-http.js";

export const dynamic = "force-dynamic";

function serverObserved(response: Response, started: number): Response {
  response.headers.set("server-timing", "knex;dur=" + Math.max(0, performance.now() - started).toFixed(3));
  return response;
}

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ actionId: string }> }>) {
  const started = performance.now();
  try {
    const { payload, context, body } = await openWorkspaceJson(request, "sales-route-action");
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join("\\0") !== "idempotencyKey\\0input\\0nodeId\\0routeId\\0selection") throw new TypeError("Sales route action body is invalid.");
    const value = body as Record<string, unknown>;
    if (typeof value.routeId !== "string" || typeof value.nodeId !== "string" || typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(value.idempotencyKey)) throw new TypeError("Sales route idempotency key is invalid.");
    const result = await executeRegisteredSalesRouteAction(payload, context, value.routeId, value.nodeId, (await params).actionId, value.input, value.selection, value.idempotencyKey, request.signal);
    const response = Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
    return result.status >= 200 && result.status < 300 ? serverObserved(response, started) : response;
  } catch (error) { return workspaceMutationError(error); }
}
`;
}

function salesProviderWebhookRouteSource(providerId: "email.reference.v1" | "calendar.reference.v1"): string {
  return `import { createGeneratedEnvironmentProviderSecretResolver, acceptGeneratedSalesProviderWebhook } from "../../../../../../../k-nex-sales-communications.js";
import { bootKnexApplication } from "../../../../../../../boot.js";
import { kNexIdentity } from "../../../../../../../k-nex-identity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const providerId = ${JSON.stringify(providerId)};
async function bodyOf(request: Request) { const length = request.headers.get("content-length"); if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length)>65536) || request.body===null) throw new Error("WEBHOOK_INVALID"); const reader=request.body.getReader(); const chunks: Uint8Array[]=[]; let total=0; try { while (true) { const next=await reader.read(); if (next.done) break; total+=next.value.byteLength; if (total>65536) throw new Error("WEBHOOK_INVALID"); chunks.push(next.value); } } finally { reader.releaseLock(); } const body=new Uint8Array(total); let offset=0; for (const chunk of chunks) { body.set(chunk,offset); offset+=chunk.byteLength; } return body; }
export async function POST(request: Request) { try { const payload=await bootKnexApplication("provider-webhook"); const result=await acceptGeneratedSalesProviderWebhook({ pool: payload.db.pool as never, resolver: createGeneratedEnvironmentProviderSecretResolver(), providerId, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, signature: request.headers.get("x-k-nex-signature"), timestamp: request.headers.get("x-k-nex-timestamp"), body: await bodyOf(request) }); return Response.json(result,{status:202,headers:{"cache-control":"no-store"}}); } catch (error) { const status=error instanceof Error && "status" in error && typeof error.status==="number" ? error.status : 400; return Response.json({code:"WEBHOOK_INVALID",status},{status,headers:{"cache-control":"no-store"}}); } }
`;
}

function salesImportUploadRouteSource(): string {
  return `import { createHash } from "node:crypto";

import type { RuntimeExtensionPool } from "@k-nex/payload-adapter";

import { currentPayloadAuthentication, currentSalesGeneration, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { bootKnexApplication } from "../../../../../boot.js";
import { kNexIdentity } from "../../../../../k-nex-identity.js";
import { workspaceSalesPermissions } from "../../../../../k-nex-sales-workspace.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const importByteLimit = 16_777_216;
// 16 MiB of CSV plus an optional three-byte BOM, base64 expansion, and closed JSON envelope.
const importUploadRequestByteLimit = 22_369_920;

async function boundedUploadBody(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^[0-9]+$/u.test(declaredLength) || Number(declaredLength) > importUploadRequestByteLimit)) throw new RangeError("upload body is too large");
  if (request.body === null) throw new TypeError("upload body is missing");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      total += next.value.byteLength;
      // Drain an oversize chunked body without retaining it: cancelling a request stream
      // makes some HTTP runtimes reset the connection before the frozen 400 response.
      if (total > importUploadRequestByteLimit) continue;
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  if (total > importUploadRequestByteLimit) throw new RangeError("upload body is too large");
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function decodeUpload(bytes: Uint8Array): Record<string, unknown> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const body = JSON.parse(text) as unknown;
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new TypeError("upload body is invalid");
  return body as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== kNexIdentity.publicOrigin.origin || !(request.headers.get("content-type") ?? "").startsWith("application/json")) throw new TypeError();
    const body = decodeUpload(await boundedUploadBody(request));
    if (Object.keys(body).sort().join("\\0") !== "artifactId\\0bytesBase64\\0contentType" || typeof body.artifactId !== "string" || body.artifactId.length < 1 || body.artifactId.length > 128 || body.contentType !== "text/csv" || typeof body.bytesBase64 !== "string") throw new TypeError();
    if (body.bytesBase64.length > 22_369_628) throw new RangeError("upload bytes are too large");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body.bytesBase64)) throw new TypeError();
    const uploaded = Buffer.from(body.bytesBase64, "base64");
    const bytes = uploaded[0] === 0xef && uploaded[1] === 0xbb && uploaded[2] === 0xbf ? uploaded.subarray(3) : uploaded;
    if (bytes.length < 1 || bytes.length > importByteLimit) return Response.json({ code: "IMPORT_LIMIT_EXCEEDED" }, { status: 400, headers: { "cache-control": "no-store" } });
    const payload = await bootKnexApplication("sales-import-upload");
    const context = kNexRequestContext(new Headers(request.headers), "sales-import-upload");
    const authentication = await currentPayloadAuthentication(payload, context);
    const actorId = authentication.user === null || typeof authentication.user !== "object" || !("id" in authentication.user) ? undefined : String(authentication.user.id);
    if (actorId === undefined || !(await workspaceSalesPermissions(payload, context)).includes("sales.imports.execute")) return Response.json({ code: "ACTION_FORBIDDEN" }, { status: 403, headers: { "cache-control": "no-store" } });
    const digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const generation = await currentSalesGeneration(payload);
    const activeGeneration = generation.generation;
    if (activeGeneration === undefined) throw new TypeError("Sales authorization generation is unavailable.");
    const pool = payload.db.pool as RuntimeExtensionPool;
    const scope = await pool.query<{ revision: number }>("select revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 and state='active' and mutation_allowed=true", [kNexIdentity.applicationId, kNexIdentity.environment, actorId]);
    const scopeRevision = scope.rows[0]?.revision;
    if (scope.rows.length !== 1 || !Number.isSafeInteger(scopeRevision) || scopeRevision < 1) return Response.json({ code: "ACTION_FORBIDDEN" }, { status: 403, headers: { "cache-control": "no-store" } });
    // The admission is a single authority CAS: every mutable authority edge is
    // reread and locked with the revisions captured above before bytes persist.
    const inserted = await pool.query<{ artifact_id: string }>("WITH current_authority AS ( SELECT a.application_id FROM k_nex_authorization_state a JOIN sales_current_authority_scopes s ON s.application_id=a.application_id AND s.environment=$3 AND s.principal_id=$4 AND s.state='active' AND s.mutation_allowed=true AND s.revision=$10 JOIN k_nex_extension_authorization_generations x ON x.application_id=a.application_id AND x.delivery_class='platform-plugin' AND x.extension_id='module.sales' AND x.state='current' AND x.authorization_generation=$11 AND x.runtime_generation_ids=$12::jsonb AND x.authorization_revision=$13 AND x.lifecycle_revision=$14 JOIN k_nex_role_assignments r ON r.application_id=a.application_id AND r.subject_kind='user' AND r.subject_id=$4 AND r.state='active' JOIN k_nex_role_permission_grants g ON g.application_id=r.application_id AND g.role_id=r.role_id AND g.permission_id='sales.imports.execute' AND g.owner_kind='extension' AND g.owner_delivery_class=x.delivery_class AND g.owner_extension_id=x.extension_id AND g.owner_generation=x.authorization_generation WHERE a.application_id=$2 AND a.authorization_revision=$8 AND a.lifecycle_revision=$9 AND NOT EXISTS (SELECT 1 FROM k_nex_permission_catalog_snapshots c WHERE c.application_id=a.application_id AND c.owner_kind='extension' AND c.owner_delivery_class=x.delivery_class AND c.owner_extension_id=x.extension_id AND c.owner_generation=x.authorization_generation AND c.state IN ('inactive-extension-disabled','inactive-extension-not-ready')) ORDER BY r.assignment_id,g.grant_id LIMIT 1 FOR SHARE OF a,s,r,g,x ) INSERT INTO sales_import_uploads(artifact_id,application_id,environment,actor_id,bytes,digest,byte_length,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,now()+interval '30 days' FROM current_authority RETURNING artifact_id", [body.artifactId, kNexIdentity.applicationId, kNexIdentity.environment, actorId, bytes, digest, bytes.length, generation.state.authorizationRevision, generation.state.lifecycleRevision, scopeRevision, activeGeneration.owner.generation, JSON.stringify(activeGeneration.runtimeGenerationIds), activeGeneration.authorizationRevision, activeGeneration.lifecycleRevision]);
    if (inserted.rows.length !== 1) return Response.json({ code: "ACTION_FORBIDDEN" }, { status: 403, headers: { "cache-control": "no-store" } });
    return Response.json({ uploadArtifactId: body.artifactId, sha256: digest, byteLength: bytes.length, contentType: "text/csv" }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return Response.json({ code: error instanceof RangeError ? "IMPORT_LIMIT_EXCEEDED" : "IMPORT_UPLOAD_BINDING_INVALID" }, { status: 400, headers: { "cache-control": "no-store" } }); }
}
`;
}

function salesExportArtifactRouteSource(): string {
  return `import type { RuntimeExtensionPool } from "@k-nex/payload-adapter";

import { currentPayloadAuthentication, currentSalesGeneration, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { bootKnexApplication } from "../../../../../boot.js";
import { kNexIdentity } from "../../../../../k-nex-identity.js";
import { readGeneratedSalesExportArtifact } from "../../../../../k-nex-sales-data-movement.js";
import { workspaceSalesPermissions } from "../../../../../k-nex-sales-workspace.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const artifactId = new URL(request.url).searchParams.get("artifactId");
    if (artifactId === null || artifactId.length < 1 || artifactId.length > 128) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    const payload = await bootKnexApplication("sales-export-download");
    const context = kNexRequestContext(new Headers(request.headers), "sales-export-download");
    const authentication = await currentPayloadAuthentication(payload, context);
    const actorId = authentication.user === null || typeof authentication.user !== "object" || !("id" in authentication.user) ? undefined : String(authentication.user.id);
    if (actorId === undefined) return Response.json({ code: "ARTIFACT_FORBIDDEN" }, { status: 403 });
    const generation = await currentSalesGeneration(payload);
    const pool = payload.db.pool as RuntimeExtensionPool;
    const [permissions, scope] = await Promise.all([
      workspaceSalesPermissions(payload, context),
      pool.query<{ revision: number }>("select revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 and state='active'", [kNexIdentity.applicationId, kNexIdentity.environment, actorId])
    ]);
    const scopeRevision = scope.rows[0]?.revision;
    if (scope.rows.length !== 1 || typeof scopeRevision !== "number" || !Number.isSafeInteger(scopeRevision) || scopeRevision < 1) return Response.json({ code: "ARTIFACT_FORBIDDEN" }, { status: 403 });
    const fieldGrants = Object.freeze([
      ...(permissions.includes("sales.contacts.channels.read") ? ["sales.object.contact:email", "sales.object.contact:phone"] as const : []),
      ...(permissions.includes("sales.leads.channels.read") ? ["sales.object.lead:email", "sales.object.lead:phone"] as const : [])
    ]);
    const artifact = await readGeneratedSalesExportArtifact(pool, { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, actorId, authorizationRevision: generation.state.authorizationRevision, lifecycleRevision: generation.state.lifecycleRevision, scopeRevision, fieldGrants, permissionGrants: permissions }, artifactId);
    return new Response(Buffer.from(artifact.bytes), { headers: { "cache-control": "no-store", "content-disposition": "attachment; filename=\\\"" + artifactId + ".csv\\\"", "content-type": artifact.contentType + "; charset=utf-8" } });
  } catch (error) { return Response.json({ code: error instanceof Error && error.message === "ARTIFACT_EXPIRED" ? "ARTIFACT_EXPIRED" : "ARTIFACT_FORBIDDEN" }, { status: error instanceof Error && error.message === "ARTIFACT_EXPIRED" ? 410 : 403, headers: { "cache-control": "no-store" } }); }
}
`;
}

function salesReportArtifactRouteSource(): string {
  return `import type { RuntimeExtensionPool } from "@k-nex/payload-adapter";

import { currentPayloadAuthentication, currentSalesGeneration, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { bootKnexApplication } from "../../../../../boot.js";
import { kNexIdentity } from "../../../../../k-nex-identity.js";
import { readGeneratedSalesReportArtifact } from "../../../../../k-nex-sales-reports.js";
import { workspaceSalesReportAdmission } from "../../../../../k-nex-sales-workspace.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const artifactId = new URL(request.url).searchParams.get("artifactId");
    if (artifactId === null || artifactId.length < 1 || artifactId.length > 160) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    const payload = await bootKnexApplication("sales-report-download");
    const context = kNexRequestContext(new Headers(request.headers), "sales-report-download");
    const authentication = await currentPayloadAuthentication(payload, context);
    const actorId = authentication.user === null || typeof authentication.user !== "object" || !("id" in authentication.user) ? undefined : String(authentication.user.id);
    if (actorId === undefined) return Response.json({ code: "REPORT_ARTIFACT_FORBIDDEN" }, { status: 403 });
    const generation = await currentSalesGeneration(payload);
    const pool = payload.db.pool as RuntimeExtensionPool;
    const admission = await workspaceSalesReportAdmission(payload, context);
    if (admission.context.actorId !== actorId || admission.authorizationRevision !== generation.state.authorizationRevision || admission.lifecycleRevision !== generation.state.lifecycleRevision || !admission.permissionGrants.includes("sales.reports.read")) return Response.json({ code: "REPORT_ARTIFACT_FORBIDDEN" }, { status: 403 });
    const artifact = await readGeneratedSalesReportArtifact(pool, admission, artifactId);
    return new Response(Buffer.from(artifact.bytes), { headers: { "cache-control": "no-store", "content-disposition": "attachment; filename=\\\"" + artifactId + ".csv\\\"", "content-type": artifact.contentType + "; charset=utf-8" } });
  } catch (error) { return Response.json({ code: error instanceof Error && error.message === "REPORT_ARTIFACT_EXPIRED" ? "REPORT_ARTIFACT_EXPIRED" : "REPORT_ARTIFACT_FORBIDDEN" }, { status: error instanceof Error && error.message === "REPORT_ARTIFACT_EXPIRED" ? 410 : 403, headers: { "cache-control": "no-store" } }); }
}
`;
}

function salesScopeAdministrationSource(): string {
  return `import { createHash } from "node:crypto";

import { AuthorizationDecisionAuditSchema, canonicalJson } from "@k-nex/contracts";
import { authorizeRequest, currentPayloadAuthentication, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import type { Payload } from "payload";

type Scope = "application-sales-scope" | "explicit-application-or-team-scope" | "owned-or-assigned-team" | "managed-teams-and-own";
type ScopeState = "active" | "revoked";
type Change = Readonly<{ expectedAuthorizationRevision: number; expectedLifecycleRevision: number; expectedScopeRevision: number | null; principalId: string; operation: "upsert" | "revoke"; idempotencyKey: string; recordScope?: Scope; applicationWide?: boolean; mutationAllowed?: boolean; authorizedTeamIds?: readonly string[] }>;
const scopeValues = new Set<Scope>(["application-sales-scope","explicit-application-or-team-scope","owned-or-assigned-team","managed-teams-and-own"]);
const identity = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u;
const idempotencyKey = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;

function fail(message: string): never { throw new TypeError(message); }
function denied(message: string): never { throw Object.assign(new Error(message), { code: "ACCESS_DENIED" }); }
function conflict(message: string): never { throw Object.assign(new Error(message), { code: "REVISION_CONFLICT" }); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).sort().join("\\0") !== [...keys].sort().join("\\0")) fail("Sales scope change is invalid."); return value as Record<string, unknown>; }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000) fail("Sales scope revision is invalid."); return value as number; }
function digest(value: unknown): string { return "sha256:" + createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function eventId(value: string): string { const compact = value.slice(7); return compact.slice(0,8) + "-" + compact.slice(8,12) + "-" + compact.slice(12,16) + "-" + compact.slice(16,20) + "-" + compact.slice(20,32); }
function validScope(change: Change): boolean {
  if (change.operation !== "upsert") return true;
  if (!scopeValues.has(change.recordScope!) || typeof change.applicationWide !== "boolean" || typeof change.mutationAllowed !== "boolean" || !Array.isArray(change.authorizedTeamIds) || change.authorizedTeamIds.length > 32 || change.authorizedTeamIds.some((id) => typeof id !== "string" || !identity.test(id)) || JSON.stringify(change.authorizedTeamIds) !== JSON.stringify([...new Set(change.authorizedTeamIds)].sort())) return false;
  if (change.recordScope === "application-sales-scope") return change.applicationWide && change.mutationAllowed && change.authorizedTeamIds.length === 0;
  if (change.recordScope === "explicit-application-or-team-scope") return !change.mutationAllowed && (!change.applicationWide || change.authorizedTeamIds.length === 0);
  return !change.applicationWide && change.mutationAllowed;
}

export async function changeSalesAuthorityScope(payload: Payload, context: KnexRequestContext, input: unknown) {
  const user = (await currentPayloadAuthentication(payload, context)).user;
  if (typeof user !== "object" || user === null || !("id" in user) || user.id === null || user.id === undefined) denied("Sales scope administration is forbidden.");
  if (typeof input !== "object" || input === null || Array.isArray(input)) fail("Sales scope change is invalid.");
  const operation = (input as Record<string, unknown>).operation;
  if (operation !== "upsert" && operation !== "revoke") fail("Sales scope change is invalid.");
  const value = exact(input, operation === "upsert" ? ["authorizedTeamIds","applicationWide","expectedAuthorizationRevision","expectedLifecycleRevision","expectedScopeRevision","idempotencyKey","mutationAllowed","operation","principalId","recordScope"] : ["expectedAuthorizationRevision","expectedLifecycleRevision","expectedScopeRevision","idempotencyKey","operation","principalId"]);
  if (typeof value.principalId !== "string" || !identity.test(value.principalId) || typeof value.idempotencyKey !== "string" || !idempotencyKey.test(value.idempotencyKey)) fail("Sales scope change is invalid.");
  const expectedScopeRevision = value.expectedScopeRevision === null ? null : integer(value.expectedScopeRevision);
  const change: Change = { expectedAuthorizationRevision: integer(value.expectedAuthorizationRevision), expectedLifecycleRevision: integer(value.expectedLifecycleRevision), expectedScopeRevision, principalId: value.principalId, operation, idempotencyKey: value.idempotencyKey,
    ...(operation === "upsert" ? { recordScope: value.recordScope as Scope, applicationWide: value.applicationWide as boolean, mutationAllowed: value.mutationAllowed as boolean, authorizedTeamIds: value.authorizedTeamIds as readonly string[] } : {}) };
  if (!validScope(change)) fail("Sales scope facts are invalid.");
  const requestDigest = digest(change);
  const actorId = String(user.id);
  const pool = payload.db.pool as unknown as { connect(): Promise<{ query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>; release(): void }> }; const client = await pool.connect();
  try { await client.query("begin");
    const state = (await client.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1 for update", [kNexIdentity.applicationId])).rows[0];
    if (state === undefined || !Number.isSafeInteger(state.authorization_revision) || !Number.isSafeInteger(state.lifecycle_revision)) fail("Sales scope authority is unavailable.");
    // Evaluate full current policy only after this transaction fences authorization/lifecycle changes.
    if (!await authorizeRequest(payload, context, "sales.settings.write", "sales.settings")) denied("Sales scope administration is forbidden.");
    const admin = (await client.query("select record_scope,application_wide,mutation_allowed,state from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 for update", [kNexIdentity.applicationId,kNexIdentity.environment,actorId])).rows[0];
    if (admin?.record_scope !== "application-sales-scope" || admin.application_wide !== true || admin.mutation_allowed !== true || admin.state !== "active") denied("Sales scope administration is forbidden.");
    const callerGrant = await client.query("select 1 from k_nex_role_assignments a join k_nex_role_permission_grants g on g.application_id=a.application_id and g.role_id=a.role_id join k_nex_extension_authorization_generations x on x.application_id=g.application_id and x.delivery_class=g.owner_delivery_class and x.extension_id=g.owner_extension_id and x.authorization_generation=g.owner_generation where a.application_id=$1 and a.subject_kind='user' and a.subject_id=$2 and a.state='active' and g.permission_id='sales.settings.write' and g.owner_delivery_class='platform-plugin' and g.owner_extension_id='module.sales' and x.delivery_class='platform-plugin' and x.extension_id='module.sales' and x.state='current' limit 1", [kNexIdentity.applicationId,actorId]);
    if (callerGrant.rowCount !== 1) denied("Sales scope administration is forbidden.");
    const existing = (await client.query("select request_digest,response_json,target_state from sales_scope_administration_operations where application_id=$1 and environment=$2 and actor_id=$3 and principal_id=$4 and operation=$5 and idempotency_key=$6 for update", [kNexIdentity.applicationId,kNexIdentity.environment,actorId,change.principalId,change.operation,change.idempotencyKey])).rows[0];
    const current = (await client.query("select revision,state from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 for update", [kNexIdentity.applicationId,kNexIdentity.environment,change.principalId])).rows[0];
    const targetGrant = await client.query("select 1 from k_nex_role_assignments a join k_nex_role_permission_grants g on g.application_id=a.application_id and g.role_id=a.role_id join k_nex_extension_authorization_generations x on x.application_id=g.application_id and x.delivery_class=g.owner_delivery_class and x.extension_id=g.owner_extension_id and x.authorization_generation=g.owner_generation where a.application_id=$1 and a.subject_kind='user' and a.subject_id=$2 and a.state='active' and g.permission_id like 'sales.%' and g.owner_delivery_class='platform-plugin' and g.owner_extension_id='module.sales' and x.delivery_class='platform-plugin' and x.extension_id='module.sales' and x.state='current' limit 1", [kNexIdentity.applicationId,change.principalId]);
    if (existing !== undefined) {
      if (existing.request_digest !== requestDigest || existing.response_json === null || typeof existing.response_json !== "object" || Array.isArray(existing.response_json)) conflict("Sales scope idempotency key was reused for different input.");
      if (change.operation === "upsert" && targetGrant.rowCount !== 1 || change.operation === "revoke" && (current?.state !== "revoked" || existing.target_state !== "revoked")) denied("Sales scope replay authority is unavailable.");
      await client.query("commit"); return existing.response_json;
    }
    if (state.authorization_revision !== change.expectedAuthorizationRevision || state.lifecycle_revision !== change.expectedLifecycleRevision || (current?.revision ?? null) !== change.expectedScopeRevision) conflict("Sales scope revision conflict.");
    if (operation === "upsert" && targetGrant.rowCount !== 1) fail("Sales scope target has no current authority.");
    const next = Number(state.authorization_revision) + 1;
    const targetState: ScopeState = operation === "revoke" ? "revoked" : "active";
    const scope = operation === "revoke"
      ? await client.query("update sales_current_authority_scopes set state='revoked',revision=revision+1,updated_at=now() where application_id=$1 and environment=$2 and principal_id=$3 and revision=$4 returning revision", [kNexIdentity.applicationId,kNexIdentity.environment,change.principalId,current?.revision])
      : await client.query("insert into sales_current_authority_scopes (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,$2,$3,$4,$5,$6,$7::jsonb,'active',1) on conflict (application_id,environment,principal_id) do update set record_scope=excluded.record_scope,application_wide=excluded.application_wide,mutation_allowed=excluded.mutation_allowed,authorized_team_ids=excluded.authorized_team_ids,state='active',revision=sales_current_authority_scopes.revision+1,updated_at=now() where sales_current_authority_scopes.revision=$8 returning revision", [kNexIdentity.applicationId,kNexIdentity.environment,change.principalId,change.recordScope,change.applicationWide,change.mutationAllowed,JSON.stringify(change.authorizedTeamIds),current?.revision]);
    const scopeRevision = scope.rows[0]?.revision;
    if (scope.rowCount !== 1 || !Number.isSafeInteger(scopeRevision)) conflict("Sales scope revision conflict.");
    const changed = await client.query("update k_nex_authorization_state set authorization_revision=$2,updated_at=now() where application_id=$1 and authorization_revision=$3 and lifecycle_revision=$4", [kNexIdentity.applicationId,next,state.authorization_revision,state.lifecycle_revision]);
    if (changed.rowCount !== 1) conflict("Sales scope revision conflict.");
    const event = { applicationId:kNexIdentity.applicationId, environment:kNexIdentity.environment, scope:"application", authorizationRevision:next, lifecycleRevision:state.lifecycle_revision };
    const operationDigest = digest([kNexIdentity.applicationId,kNexIdentity.environment,actorId,change.principalId,change.operation,requestDigest,next]);
    const response = { authorizationRevision:next, lifecycleRevision:state.lifecycle_revision, scopeRevision, state:targetState };
    const auditId = "p13-2-sales-scope-" + operationDigest.slice(7);
    const audit = AuthorizationDecisionAuditSchema.parse({ schemaVersion:1, auditId,
      decisionId:"p13-2-sales-scope-decision-" + operationDigest.slice(7), correlationId:"p13-2-sales-scope-correlation-" + operationDigest.slice(7),
      applicationId:event.applicationId, environment:event.environment, permissionId:"sales.settings.write", owner:kNexSalesRegistry.authorizationGeneration.owner,
      principal:{ kind:"user", id:actorId }, effectiveActor:{ kind:"user", id:actorId }, scope:{ kind:"application", resource:"sales.authority-scopes" },
      operation:"sales-scope-administration", target:change.principalId, authorizationRevision:event.authorizationRevision, lifecycleRevision:event.lifecycleRevision,
      outcome:"allow", reason:"granted", approval:"not-required", reauthentication:"not-required" });
    await client.query("insert into k_nex_authorization_audit (audit_id,application_id,environment,permission_id,outcome,reason,authorization_revision,lifecycle_revision,audit_json) values ($1,$2,$3,'sales.settings.write','allow','granted',$4,$5,$6::jsonb)", [auditId,event.applicationId,event.environment,event.authorizationRevision,event.lifecycleRevision,JSON.stringify(audit)]);
    await client.query("insert into k_nex_authorization_outbox (event_id,application_id,environment,authorization_revision,lifecycle_revision,event_json) values ($1,$2,$3,$4,$5,$6::jsonb)", [eventId(operationDigest),event.applicationId,event.environment,event.authorizationRevision,event.lifecycleRevision,JSON.stringify(event)]);
    await client.query("insert into sales_scope_administration_operations (application_id,environment,actor_id,principal_id,operation,idempotency_key,request_digest,response_json,target_state,authorization_revision,lifecycle_revision,scope_revision) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)", [event.applicationId,event.environment,actorId,change.principalId,change.operation,change.idempotencyKey,requestDigest,JSON.stringify(response),targetState,next,state.lifecycle_revision,scopeRevision]);
    await client.query("commit"); return response;
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
}
`;
}

function salesScopeAdministrationRouteSource(): string { return `import { changeSalesAuthorityScope } from "../../../../../k-nex-sales-scope-administration.js";\nimport { openWorkspaceJson, workspaceMutationError } from "../../../../../k-nex-workspace-page-http.js";\nexport const dynamic = "force-dynamic";\nexport async function POST(request: Request) { try { const { payload, context, body } = await openWorkspaceJson(request, "sales-scope-administration"); return Response.json(await changeSalesAuthorityScope(payload, context, body), { headers: { "cache-control": "no-store" } }); } catch (error) { return workspaceMutationError(error); } }\n`; }

function navigationRevisionRouteSource(): string {
  return `import { bootKnexApplication } from "../../../../../boot.js";
import { resolveCurrentWorkspaceNavigation } from "../../../../../k-nex-workspace-navigation.js";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const resolved = await resolveCurrentWorkspaceNavigation(await bootKnexApplication("workspace-web"), new Headers(request.headers));
  if (resolved === undefined) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401, headers: { "cache-control": "no-store" } });
  return Response.json({ watermark: resolved.watermark, navigation: resolved.navigation, themePresentation: resolved.themePresentation }, { headers: { "cache-control": "no-store" } });
}
`;
}

function navigationSidebarPreferenceRouteSource(): string {
  return `import { updateCurrentWorkspaceSidebarPreference } from "../../../../../k-nex-workspace-navigation.js";
import { openWorkspaceJson, workspaceMutationError } from "../../../../../k-nex-workspace-page-http.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { payload, context, body } = await openWorkspaceJson(request, "workspace-sidebar-preference");
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join("\\0") !== "sidebar") throw new TypeError("Workspace sidebar preference body is invalid.");
    return Response.json({ sidebar: await updateCurrentWorkspaceSidebarPreference(payload, context, (body as Record<string, unknown>).sidebar) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return workspaceMutationError(error); }
}
`;
}

function shellClientSource(): string {
  return `"use client";

import { WorkspaceShell } from "@k-nex/ui-components";
import type { ResolvedWorkspaceNavigation } from "@k-nex/ui-runtime";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type ThemePresentation = Readonly<{ profileRevisionId: string; mode: "light" | "dark" | "system"; cssText: string }>;

function parseThemePresentation(value: unknown): ThemePresentation | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join("\\0") !== "cssText\\0mode\\0profileRevisionId" || typeof candidate.profileRevisionId !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u.test(candidate.profileRevisionId) ||
    !["light", "dark", "system"].includes(String(candidate.mode)) || typeof candidate.cssText !== "string" || new TextEncoder().encode(candidate.cssText).byteLength > 1_048_576) return undefined;
  return candidate as ThemePresentation;
}

export function KnexWorkspaceShell(props: Readonly<{ applicationLabel: string; environment: string; navigation: ResolvedWorkspaceNavigation; navigationWatermark: string; themePresentation: ThemePresentation; children: ReactNode }>) {
  const [navigation, setNavigation] = useState(props.navigation);
  const [themePresentation, setThemePresentation] = useState(props.themePresentation);
  const [watermark, setWatermark] = useState(props.navigationWatermark);
  useEffect(() => { setNavigation(props.navigation); setThemePresentation(props.themePresentation); setWatermark(props.navigationWatermark); }, [props.navigation, props.navigationWatermark, props.themePresentation]);
  useEffect(() => {
    let active = true;
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      const response = await fetch("/api/k-nex/navigation/revision", { cache: "no-store" }).catch(() => undefined);
      if (!active) return;
      if (response?.status === 401) { window.location.assign("/login"); return; }
      const body = response?.ok ? await response.json().catch(() => undefined) as { watermark?: unknown; navigation?: unknown; themePresentation?: unknown } | undefined : undefined;
      const nextTheme = parseThemePresentation(body?.themePresentation);
      if (typeof body?.watermark === "string" && /^sha256:[0-9a-f]{64}$/u.test(body.watermark) && body.watermark !== watermark && typeof body.navigation === "object" && body.navigation !== null && nextTheme !== undefined) {
        setNavigation(body.navigation as ResolvedWorkspaceNavigation);
        setThemePresentation(nextTheme);
        setWatermark(body.watermark);
      }
      pending = false;
    }, 1_000);
    return () => { active = false; clearInterval(timer); };
  }, [watermark]);
  const { navigationWatermark: _, navigation: __, themePresentation: ___, ...shell } = props;
  const saveSidebarPreference = async (sidebar: "expanded" | "collapsed") => {
    const response = await fetch("/api/k-nex/navigation/sidebar", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sidebar }) });
    const body = await response.json().catch(() => undefined) as { sidebar?: unknown } | undefined;
    if (!response.ok || body?.sidebar !== sidebar) throw new Error("Workspace sidebar preference was not saved.");
  };
  return <WorkspaceShell {...shell} navigation={navigation} themePresentation={themePresentation} currentHref={usePathname()} saveSidebarPreference={saveSidebarPreference} />;
}
`;
}

function workspaceLayoutSource(applicationName: string): string {
  return `import { headers as getHeaders } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { bootKnexApplication } from "../../boot.js";
import { kNexIdentity } from "../../k-nex-identity.js";
import { resolveCurrentWorkspaceNavigation } from "../../k-nex-workspace-navigation.js";
import { KnexWorkspaceShell } from "../components/k-nex-workspace-shell.js";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const payload = await bootKnexApplication("workspace-web");
  const resolved = await resolveCurrentWorkspaceNavigation(payload, await getHeaders());
  if (resolved === undefined) redirect("/login");
  return <KnexWorkspaceShell applicationLabel=${jsxStringExpression(applicationName)} environment={kNexIdentity.environment} navigation={resolved.navigation} navigationWatermark={resolved.watermark} themePresentation={resolved.themePresentation}>{children}</KnexWorkspaceShell>;
}
`;
}

function inventoryRouteSource(): string {
  return `import { headers as getHeaders } from "next/headers";

import { authorizeRequest, kNexAuthority, kNexRequestContext } from "../../../../k-nex-authority.js";
import { bootKnexApplication } from "../../../../boot.js";
import { kNexIdentity } from "../../../../k-nex-identity.js";
import { kNexSalesRegistry } from "../../../../k-nex-registry.js";
import { resolveApplicationTheme } from "../../../../k-nex-theme-runtime.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  if (!await authorizeRequest(payload, kNexRequestContext(headers, "runtime-inventory"), "system.extensions.read", "system.extensions")) return Response.json({ code: "FORBIDDEN" }, { status: 403 });
  const state = await kNexAuthority(payload).store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  const theme = await resolveApplicationTheme(payload);
  return Response.json({ schemaVersion: 1, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, authorizationRevision: state?.authorizationRevision, lifecycleRevision: state?.lifecycleRevision, plugins: [kNexSalesRegistry.registration.pluginId], theme: theme.observation, collections: Object.keys(payload.collections).sort() }, { headers: { "cache-control": "no-store" } });
}
`;
}

function readinessRouteSource(): string {
  return `import { bootKnexApplication } from "../../../boot.js";
import { reconcileKnexReadiness } from "../../../k-nex-readiness.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await bootKnexApplication("readiness");
    const readiness = await reconcileKnexReadiness(payload);
    return Response.json({ schemaVersion: 1, status: "ready", applicationId: readiness.applicationId, authorizationRevision: readiness.authorizationRevision, lifecycleRevision: readiness.lifecycleRevision }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ schemaVersion: 1, status: "not-ready" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
`;
}

function readinessSource(theme: ApplicationAuthFilesOptions["theme"]): string {
  const themeResolver = theme === "minimal" ? "resolveMinimalThemeProfile" : "resolveNeobrutalismThemeProfile";
  return `import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { createAuthorizedPuckBuilderProfile } from "@k-nex/builder-puck";
import { ApplicationManifestSchema, PackageReleaseManifestSchema, PluginManifestSchema, canonicalJson } from "@k-nex/contracts";
import manifestJson from "@k-nex/module-sales/manifest" with { type: "json" };
import realtimeManifestJson from "@k-nex/provider-realtime-socketio/manifest" with { type: "json" };
import { NodeHttpsAdministrationOperatorClient, type RuntimeExtensionPool } from "@k-nex/payload-adapter";
import { assertExactProtectedRoleBaselineState, assertMigrationReadiness, canonicalIana, currentProtectedPlatformRoleBaselineRelease, protectedRoleBootstrapId } from "@k-nex/runtime";
import { ${themeResolver} as resolveSelectedThemeProfile } from "@k-nex/theme-${theme}";
import type { Payload } from "payload";

import { kNexAuthority } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry, kNexThemePresentation } from "./k-nex-registry.js";
import { bootstrapApplicationTheme, resolveApplicationTheme } from "./k-nex-theme-runtime.js";
import { migrations } from "./migrations/index.js";

export const kNexApplicationReadyMarker = "K_NEX_APPLICATION_READY";

const expectedMigrationNames = Object.freeze([
  "20260827_000001_sales_baseline",
  "20260827_000002_knex_bootstrap",
  "20260829_000007_runtime_extensions",
  "20260901_000019_authorization",
  "20260901_000022_static_lifecycle_admission",
  "20260902_000023_system_administration",
  "20260903_000026_workspace_pages",
  "20260903_000027_event_outbox",
  "20260904_000028_workspace_sidebar_preferences",
  "20260905_000027_crm_core",
  "20260906_000029_attachment_upload_admissions",
  "20260907_000030_pipeline_saved_views",
  "20260907_000031_data_movement",
  "20260908_000032_communications",
  "20260908_000033_crm_workflows",
  "20260908_000034_reports"
]);
const expectedRouteSources = Object.freeze([
  "src/app/(auth)/forbidden/page.tsx",
  "src/app/(auth)/login/page.tsx",
  "src/app/(payload)/api/[...slug]/route.ts",
  "src/app/(payload)/api/graphql-playground/route.ts",
  "src/app/(payload)/api/graphql/route.ts",
  "src/app/(workspace)/page.tsx",
  "src/app/(workspace)/sales/accounts/[id]/page.tsx",
  "src/app/(workspace)/sales/accounts/page.tsx",
  "src/app/(workspace)/sales/calendar/page.tsx",
  "src/app/(workspace)/sales/exports/page.tsx",
  "src/app/(workspace)/sales/reports/page.tsx",
  "src/app/(workspace)/sales/contacts/[id]/page.tsx",
  "src/app/(workspace)/sales/contacts/page.tsx",
  "src/app/(workspace)/sales/leads/[id]/page.tsx",
  "src/app/(workspace)/sales/leads/page.tsx",
  "src/app/(workspace)/sales/imports/page.tsx",
  "src/app/(workspace)/sales/notifications/page.tsx",
  "src/app/(workspace)/sales/opportunities/[id]/page.tsx",
  "src/app/(workspace)/sales/opportunities/page.tsx",
  "src/app/(workspace)/sales/page.tsx",
  "src/app/(workspace)/sales/settings/page.tsx",
  "src/app/(workspace)/sales/settings/pipeline/page.tsx",
  "src/app/(workspace)/sales/tasks/page.tsx",
  "src/app/(workspace)/sales/views/page.tsx",
  "src/app/(workspace)/system/access/assignments/page.tsx",
  "src/app/(workspace)/system/access/audit/page.tsx",
  "src/app/(workspace)/system/access/permissions/page.tsx",
  "src/app/(workspace)/system/access/roles/[roleId]/page.tsx",
  "src/app/(workspace)/system/access/roles/page.tsx",
  "src/app/(workspace)/system/extensions/[extensionId]/page.tsx",
  "src/app/(workspace)/system/extensions/page.tsx",
  "src/app/(workspace)/system/operations/[operationId]/page.tsx",
  "src/app/(workspace)/system/operations/page.tsx",
  "src/app/(workspace)/system/settings/[settingsId]/page.tsx",
  "src/app/(workspace)/system/settings/page.tsx",
  "src/app/(workspace)/system/themes/page.tsx",
  "src/app/(workspace)/system/themes/profiles/[profileId]/page.tsx",
  "src/app/(workspace)/system/workspace-pages/[pageId]/page.tsx",
  "src/app/(workspace)/system/workspace-pages/page.tsx",
  "src/app/(workspace)/workspace/pages/[pageId]/edit/page.tsx",
  "src/app/(workspace)/workspace/pages/[pageId]/page.tsx",
  "src/app/api/health/route.ts",
  "src/app/api/k-nex/inventory/route.ts",
  "src/app/api/k-nex/navigation/revision/route.ts",
  "src/app/api/k-nex/navigation/sidebar/route.ts",
  "src/app/api/k-nex/sales/actions/[actionId]/route.ts",
  "src/app/api/k-nex/sales/authority-scopes/route.ts",
  "src/app/api/k-nex/sales/export-artifact/route.ts",
  "src/app/api/k-nex/sales/report-artifact/route.ts",
  "src/app/api/k-nex/sales/import-upload/route.ts",
  "src/app/api/k-nex/sales/providers/calendar-reference/webhook/route.ts",
  "src/app/api/k-nex/sales/providers/email-reference/webhook/route.ts",
  "src/app/api/k-nex/sales/routes/[routeId]/route.ts",
  "src/app/api/k-nex/workspace-folders/[folderId]/route.ts",
  "src/app/api/k-nex/workspace-folders/route.ts",
  "src/app/api/k-nex/workspace-pages/[pageId]/[operation]/route.ts",
  "src/app/api/k-nex/workspace-pages/[pageId]/actions/[actionId]/route.ts",
  "src/app/api/k-nex/workspace-pages/[pageId]/session/route.ts",
  "src/app/api/k-nex/workspace-pages/route.ts",
  "src/app/api/readiness/route.ts",
  "src/app/api/system/access/assignments/[assignmentId]/revoke/route.ts",
  "src/app/api/system/access/assignments/route.ts",
  "src/app/api/system/access/grants/[grantId]/remove/route.ts",
  "src/app/api/system/access/roles/[roleId]/permissions/route.ts",
  "src/app/api/system/access/roles/route.ts",
  "src/app/api/system/extensions/[extensionId]/operations/[operationId]/execute/route.ts",
  "src/app/api/system/extensions/[extensionId]/plan/route.ts",
  "src/app/api/system/settings/[settingsId]/route.ts",
  "src/app/api/system/themes/profiles/[profileId]/preview/route.ts",
  "src/app/api/system/themes/profiles/[profileId]/publish/route.ts",
  "src/app/api/system/themes/profiles/[profileId]/rollback/route.ts",
  "src/app/api/system/themes/profiles/[profileId]/stage/route.ts"
].sort());
const expectedPackageDependencies = Object.freeze([
  "@k-nex/builder-puck", "@k-nex/composition", "@k-nex/contracts", "@k-nex/module-sales", "@k-nex/provider-realtime-socketio",
  "@k-nex/payload-adapter", "@k-nex/runtime", "@k-nex/theme-${theme}", "@k-nex/ui-builder-blocks",
  "@k-nex/ui-components", "@k-nex/ui-data", "@k-nex/ui-design-system-contracts", "@k-nex/ui-forms",
  "@k-nex/ui-pages", "@k-nex/ui-runtime"
].sort());

type ApplicationPlan = Readonly<{
  composition: Readonly<{ plugins: readonly string[]; builder: string; theme: string; databaseAdapter: string }>;
  packageSource: Readonly<{ kind: string; release: string; manifestDigest: string }>;
  payloadPostgresPatch: Readonly<{ package: string; upstream: string; fixes: readonly string[]; digest: string }>;
  reporting: Readonly<{ primaryCurrency: string | null; provenance: "factory-configured" | "unconfigured" }>;
  migration: Readonly<{ owner: string; action: string; expectedPredecessorRevision: number }>;
}>;

function fail(message: string): never { throw new Error("K-Nex readiness failed: " + message); }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !same(Object.keys(value).sort(), [...keys].sort())) fail(label + " is invalid.");
  return value as Record<string, unknown>;
}
function regular(path: string, label: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(label + " must be a regular file.");
}
function jsonFile(path: string, label: string): Readonly<{ source: string; value: unknown }> {
  regular(path, label);
  const source = readFileSync(path, "utf8");
  return Object.freeze({ source, value: JSON.parse(source) as unknown });
}
function requiredAdministrationOperatorConfiguration(name: string): string {
  const value = process.env[name];
  if (!value) fail("Administration operator configuration is missing.");
  return value;
}
function administrationOperatorCredential(name: string): Buffer {
  try { return readFileSync(requiredAdministrationOperatorConfiguration(name)); }
  catch { return fail("Administration operator credential is unreadable."); }
}
function assertAdministrationOperatorConfiguration(): void {
  const port = Number(requiredAdministrationOperatorConfiguration("K_NEX_ADMINISTRATION_OPERATOR_PORT"));
  const hostname = requiredAdministrationOperatorConfiguration("K_NEX_ADMINISTRATION_OPERATOR_HOST");
  const certificate = administrationOperatorCredential("K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT");
  const privateKey = administrationOperatorCredential("K_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY");
  const certificateAuthority = administrationOperatorCredential("K_NEX_ADMINISTRATION_OPERATOR_CA_CERT");
  const uriSan = requiredAdministrationOperatorConfiguration("K_NEX_ADMINISTRATION_OPERATOR_URI_SAN");
  const operatorIdentity = requiredAdministrationOperatorConfiguration("K_NEX_ADMINISTRATION_OPERATOR_IDENTITY");
  try {
    new NodeHttpsAdministrationOperatorClient({
      hostname, port, certificate, privateKey, certificateAuthority,
      expectedMtlsIdentity: { schemaVersion: 1, uriSan, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, allowedCommandFamilies: ["extension-lifecycle"] },
      operatorIdentity, timeoutMs: 30_000, maxRequestBytes: 65_536, maxResponseBytes: 65_536
    });
  } catch { fail("Administration operator configuration is invalid."); }
}
function sha256(value: string | Buffer): string { return "sha256:" + createHash("sha256").update(value).digest("hex"); }
function archiveName(packageName: string, version: string): string { return packageName.slice(1).replace("/", "-") + "-" + version + ".tgz"; }

function parseApplicationPlan(value: unknown): ApplicationPlan {
  const plan = exactRecord(value, ["planVersion", "preset", "composition", "packageSource", "payloadPostgresPatch", "reporting", "migration", "readiness", "lifecyclePlans"], "Application plan");
  const composition = exactRecord(plan.composition, ["plugins", "builder", "theme", "databaseAdapter"], "Application composition");
  const packageSource = exactRecord(plan.packageSource, ["kind", "release", "manifestDigest"], "Application package source");
  const payloadPostgresPatch = exactRecord(plan.payloadPostgresPatch, ["package", "upstream", "fixes", "digest"], "Payload Postgres patch");
  const reporting = exactRecord(plan.reporting, ["primaryCurrency", "provenance"], "Application reporting authority");
  const migration = exactRecord(plan.migration, ["owner", "action", "expectedPredecessorRevision"], "Application migration plan");
  if (plan.planVersion !== 1 || plan.preset !== "sales-reference" || packageSource.kind !== "packed-mirror" ||
    typeof packageSource.release !== "string" || typeof packageSource.manifestDigest !== "string" ||
    !Array.isArray(composition.plugins) || composition.plugins.some((value) => typeof value !== "string") ||
    (reporting.primaryCurrency !== null && (typeof reporting.primaryCurrency !== "string" || !/^[A-Z]{3}$/u.test(reporting.primaryCurrency))) ||
    (reporting.provenance !== "factory-configured" && reporting.provenance !== "unconfigured") ||
    (reporting.provenance === "factory-configured" ? reporting.primaryCurrency === null : reporting.primaryCurrency !== null) ||
    !same(payloadPostgresPatch, { package: "@payloadcms/db-postgres@3.88.0", upstream: "payloadcms/payload#17831@134c89b7955d0dcde9137643ab86873ff542dbd4", fixes: ["#15674", "#16256"], digest: "sha256:0889c7c61e08478410dfcb1112415677fa9f50267901ee15c99e3deb1c9edf2f" }) ||
    typeof composition.builder !== "string" || typeof composition.theme !== "string" || composition.databaseAdapter !== "postgres" ||
    migration.owner !== "customer" || migration.action !== "review-and-apply" || migration.expectedPredecessorRevision !== 0 ||
    !same(plan.readiness, ["exact-package-inventory", "migration-revision", "sales-registration"]) ||
    !same(plan.lifecyclePlans, ["add", "disable", "enable", "upgrade"])) fail("Application plan is incompatible.");
  return { composition: composition as ApplicationPlan["composition"], packageSource: packageSource as ApplicationPlan["packageSource"], payloadPostgresPatch: payloadPostgresPatch as ApplicationPlan["payloadPostgresPatch"], reporting: reporting as ApplicationPlan["reporting"], migration: migration as ApplicationPlan["migration"] };
}

function routeSources(root: string): readonly string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) fail("Generated route tree contains a symlink.");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && (entry.name === "page.tsx" || entry.name === "route.ts")) found.push(relative(root, path));
    }
  };
  visit(join(root, "src/app"));
  return found.sort();
}

function reconcileSource(root: string) {
  const applicationFile = jsonFile(join(root, "k-nex.app.json"), "Application manifest");
  const planFile = jsonFile(join(root, ".k-nex/application-plan.json"), "Application plan");
  const releaseFile = jsonFile(join(root, ".k-nex/package-release-manifest.json"), "Package release manifest");
  const application = ApplicationManifestSchema.parse(applicationFile.value);
  const release = PackageReleaseManifestSchema.parse(releaseFile.value);
  const plan = parseApplicationPlan(planFile.value);
  if (releaseFile.source !== canonicalJson(release) || sha256(releaseFile.source) !== plan.packageSource.manifestDigest) fail("Package release manifest digest mismatch.");
  if (plan.packageSource.release !== release.release.version) fail("Package release revision mismatch.");
  if (application.application.id !== kNexIdentity.applicationId || application.application.type !== "customer-platform") fail("Application identity mismatch.");

  const salesRelease = release.packages.find((entry) => entry.package === "@k-nex/module-sales" && entry.role === "plugin");
  const realtimeRelease = release.packages.find((entry) => entry.package === "@k-nex/provider-realtime-socketio" && entry.role === "provider");
  const builderRelease = release.packages.find((entry) => entry.package === "@k-nex/builder-puck" && entry.role === "builder");
  const themeRelease = release.packages.find((entry) => entry.package === "@k-nex/theme-${theme}" && entry.role === "theme");
  const salesPlugin = application.plugins.find((plugin) => plugin.id === "module.sales");
  const realtimePlugin = application.plugins.find((plugin) => plugin.id === "provider.realtime.socketio");
  const builder = application.builder;
  const selectedTheme = exactRecord(application.themes, ["active", "package", "version"], "Selected theme");
  if (application.plugins.length !== 2 || new Set(application.plugins.map((plugin) => plugin.id)).size !== 2 || salesRelease === undefined || realtimeRelease === undefined || salesPlugin?.id !== "module.sales" || salesPlugin.package !== salesRelease.package || salesPlugin.version !== salesRelease.version || !salesPlugin.enabled || realtimePlugin?.id !== "provider.realtime.socketio" || realtimePlugin.package !== realtimeRelease.package || realtimePlugin.version !== realtimeRelease.version || !realtimePlugin.enabled || !same(application.providers, { "realtime.gateway": { plugin: realtimePlugin.id, package: realtimePlugin.package, version: realtimePlugin.version } })) fail("Sales application manifest mismatch.");
  if (builderRelease === undefined || builder?.plugin !== "builder.puck" || builder.package !== builderRelease.package || builder.version !== builderRelease.version || !same(builder.profiles, { workspace: { enabled: true, drafts: true, surfaces: ["workspace"] } })) fail("Puck builder manifest mismatch.");
  if (themeRelease === undefined || selectedTheme.active !== "${theme}" || selectedTheme.package !== themeRelease.package || selectedTheme.version !== themeRelease.version) fail("Theme manifest mismatch.");
  if (!same(plan.composition.plugins, ["module.sales@" + salesRelease.version, "provider.realtime.socketio@" + realtimeRelease.version].sort()) || plan.composition.builder !== "builder.puck@" + builderRelease.version || plan.composition.theme !== "${theme}@" + themeRelease.version) fail("Application composition mismatch.");

  const packageFile = jsonFile(join(root, "package.json"), "Package manifest");
  const packageJson = exactRecord(packageFile.value, ["name", "version", "private", "type", "packageManager", "engines", "scripts", "dependencies", "devDependencies"], "Package manifest");
  const dependencies = exactRecord(packageJson.dependencies, Object.keys(packageJson.dependencies as object), "Package dependencies");
  const fileDependencies = Object.entries(dependencies).filter(([, value]) => typeof value === "string" && value.startsWith("file:"));
  const actualPackageDependencies = fileDependencies.map(([name]) => name).sort();
  if (!same(actualPackageDependencies, expectedPackageDependencies)) fail("Package file dependency inventory mismatch.");
  for (const packageName of expectedPackageDependencies) {
    const entry = release.packages.find((candidate) => candidate.package === packageName);
    if (entry === undefined || dependencies[packageName] !== "file:.k-nex/packages/" + archiveName(entry.package, entry.version)) fail("Package dependency closure mismatch for " + packageName + ".");
  }
  const packageDirectory = join(root, ".k-nex/packages");
  const actualArchives = readdirSync(packageDirectory, { withFileTypes: true });
  if (actualArchives.some((entry) => !entry.isFile() || entry.isSymbolicLink())) fail("Package archive directory contains an unsupported entry.");
  const expectedArchives = release.packages.map((entry) => archiveName(entry.package, entry.version)).sort();
  if (!same(actualArchives.map((entry) => entry.name).sort(), expectedArchives)) fail("Package archive inventory mismatch.");
  for (const entry of release.packages) {
    const archive = readFileSync(join(packageDirectory, archiveName(entry.package, entry.version)));
    if ("sha512-" + createHash("sha512").update(archive).digest("base64") !== entry.integrity) fail("Package archive integrity mismatch for " + entry.package + ".");
  }
  const lockPath = join(root, "pnpm-lock.yaml");
  regular(lockPath, "Package lock");
  if (sha256(readFileSync(lockPath)) !== release.factoryLockTemplates["${theme}"].digest) fail("Package lock digest mismatch.");
  if (!same(routeSources(root), expectedRouteSources)) fail("Generated route source inventory mismatch.");

  const salesManifest = PluginManifestSchema.parse(manifestJson);
  const realtimeManifest = PluginManifestSchema.parse(realtimeManifestJson);
  const salesInventory = kNexSalesRegistry.scopedRegistration.inventory;
  const expectedContributions = Object.fromEntries(Object.entries(salesManifest.contributions ?? {}).flatMap(([kind, values]) => {
    const ids = Object.keys(values as object).sort();
    return ids.length === 0 ? [] : [[kind, ids]];
  }));
  const realtimeInventory = salesInventory.find((entry) => entry.id === realtimeManifest.id);
  if (salesManifest.id !== salesPlugin.id || salesManifest.package !== salesPlugin.package || salesManifest.version !== salesPlugin.version || realtimeManifest.id !== realtimePlugin.id || realtimeManifest.package !== realtimePlugin.package || realtimeManifest.version !== realtimePlugin.version ||
    kNexSalesRegistry.staticRelease.package.name !== salesRelease.package || kNexSalesRegistry.staticRelease.package.version !== salesRelease.version ||
    kNexSalesRegistry.staticRelease.package.integrity !== salesRelease.integrity || kNexSalesRegistry.staticRelease.release !== release.release.version ||
    kNexSalesRegistry.staticRelease.authorizationGeneration !== kNexSalesRegistry.authorizationGeneration.owner.generation ||
    !same(kNexSalesRegistry.authorizationGeneration.runtimeGenerationIds, [kNexSalesRegistry.staticRelease.runtimeGenerationId]) ||
    kNexSalesRegistry.registration.pluginId !== salesManifest.id || salesInventory.length !== 2 || salesInventory.filter((entry) => entry.id === salesManifest.id).length !== 1 || realtimeInventory === undefined ||
    !same(salesInventory.find((entry) => entry.id === salesManifest.id)?.contributions, expectedContributions) || !same(realtimeInventory.contributions, {}) ||
    Object.values(kNexSalesRegistry.scopedRegistration.contributions as Readonly<Record<string, readonly { pluginId: string }[]>>).flat().some((entry) => entry.pluginId !== salesManifest.id && entry.pluginId !== realtimeManifest.id) ||
    Object.values(kNexSalesRegistry.scopedRegistration.bindings as Readonly<Record<string, readonly { pluginId: string }[]>>).flat().some((entry) => entry.pluginId !== salesManifest.id && entry.pluginId !== realtimeManifest.id)) fail("Sales static registration identity mismatch.");
  if (!same(kNexSalesRegistry.collectionSlugs, ["sales-accounts", "sales-contacts", "sales-leads", "sales-pipelines", "sales-pipeline-stages", "sales-activities", "sales-opportunities", "sales-tasks", "sales-notes", "sales-attachment-references", "sales-saved-views", "sales-import-jobs", "sales-import-rows", "sales-import-chunks", "sales-export-jobs", "sales-merge-lineage"]) ||
    !same(kNexSalesRegistry.collections.map(({ slug }) => slug), kNexSalesRegistry.collectionSlugs) ||
    kNexSalesRegistry.readiness.currentRevision !== 3 || !same(kNexSalesRegistry.readiness.predecessorRevisions, [1, 2])) fail("Sales registry readiness mismatch.");
  if (typeof createAuthorizedPuckBuilderProfile !== "function" || typeof resolveSelectedThemeProfile !== "function" ||
    kNexThemePresentation.themeId !== "theme.${theme}" || kNexThemePresentation.themeVersion !== themeRelease.version ||
    kNexThemePresentation.profileRevisionId !== "workspace.theme.initial") fail("Imported builder or theme registry mismatch.");
  if (!same(migrations.map(({ name }) => name), expectedMigrationNames) || migrations.some(({ up, down }) => typeof up !== "function" || typeof down !== "function")) fail("Generated migration inventory mismatch.");
  return { release };
}

async function assertSalesSchema(pool: RuntimeExtensionPool): Promise<void> {
  const required = {
    sales_accounts: ["name", "status", "merged_into_id", "merge_lineage"],
    sales_contacts: ["account_id", "display_name", "given_name", "email", "phone", "status", "merged_into_id", "merge_lineage"],
    sales_leads: ["display_name", "source", "email", "phone", "status", "archive_status", "decided_at", "qualified_at", "disqualified_at", "qualified_account_id", "qualified_contact_id", "qualified_opportunity_id"],
    sales_pipelines: ["name", "ordered_stage_ids", "is_active", "status"],
    sales_pipeline_stages: ["pipeline_id", "stage_id", "name", "semantic", "position", "probability_basis_points", "allowed_transition_stage_ids", "required_field_ids", "status"],
    sales_activities: ["type", "subject", "actor_id", "scheduled_at", "occurred_at", "related_record_id", "related_record_type", "supersedes_activity_id", "provider_metadata", "status"],
    sales_opportunities: ["name", "account_id", "primary_contact_id", "pipeline_id", "stage_id", "amount", "currency", "expected_close_date", "closed_at", "loss_reason", "archive_status"],
    sales_tasks: ["title", "due_date", "related_record_id", "related_record_type", "status", "archive_status"],
    sales_notes: ["body", "author_id", "occurred_at", "related_record_id", "related_record_type", "replaces_note_id", "status"],
    sales_attachment_references: ["storage_reference", "filename", "media_type", "byte_size", "uploader_id", "related_record_id", "related_record_type", "status"],
    sales_saved_views: ["name", "visibility", "visibility_team_id", "view_kind", "target_object_id", "definition", "status"],
    sales_import_jobs: ["id", "application_id", "environment", "actor_id", "target_object_type", "upload_artifact_id", "upload_digest", "mapping_canonical_json", "mapping_digest", "schema_revision", "authorization_revision", "lifecycle_revision", "scope_revision", "field_grants", "permission_grants", "state", "revision", "row_count", "accepted_rows", "rejected_rows", "diagnostic_artifact_id", "diagnostic_digest", "receipt_id", "created_at", "updated_at", "expires_at"],
    sales_import_rows: ["id", "import_job_id", "one_based_data_row", "row_digest", "canonical_mapped_json", "mapped_digest", "outcome", "target_record_id", "diagnostic_code", "created_at", "updated_at"],
    sales_import_chunks: ["id", "import_job_id", "chunk_index", "row_start", "row_end_exclusive", "input_digest", "state", "attempt", "worker_generation_id", "worker_fencing_token", "worker_promotion_revision", "worker_lease_owner", "lease_revision", "lease_expires_at", "completed_at", "result_digest", "created_at", "updated_at"],
    sales_export_jobs: ["id", "application_id", "environment", "actor_id", "target_object_type", "source_id", "source_version", "source_schema_version", "source_hash", "query_canonical_json", "query_digest", "selected_fields", "authorization_revision", "lifecycle_revision", "scope_revision", "field_grants", "permission_grants", "snapshot_revision", "snapshot_digest", "state", "revision", "row_count", "worker_generation_id", "worker_fencing_token", "worker_promotion_revision", "worker_lease_owner", "lease_revision", "lease_expires_at", "attempt", "artifact_id", "artifact_digest", "receipt_id", "created_at", "updated_at", "expires_at"],
    sales_report_schedules: ["schedule_id", "application_id", "environment", "creator_id", "recipient_id", "report_id", "window_mode", "weekday", "local_time", "authorization_revision", "lifecycle_revision", "scope_revision", "revision", "state", "next_run_at", "audit", "created_at", "updated_at"],
    sales_report_runs: ["run_id", "application_id", "environment", "creator_id", "recipient_id", "report_id", "window_mode", "scheduled_for", "requested_at", "authorization_revision", "lifecycle_revision", "scope_revision", "report_revision", "report_digest", "idempotency_key", "state", "revision", "attempt", "next_attempt_at", "worker_generation_id", "worker_fencing_token", "worker_promotion_revision", "worker_lease_owner", "lease_revision", "lease_expires_at", "artifact_id", "artifact_digest", "failure_code", "audit", "created_at", "updated_at", "terminal_at"],
    sales_report_artifacts: ["artifact_id", "run_id", "bytes", "digest", "byte_length", "content_type", "created_at", "expires_at"],
    sales_report_delivery_receipts: ["receipt_id", "run_id", "application_id", "environment", "recipient_id", "artifact_digest", "delivered_at", "evidence", "digest"],
    sales_report_run_audit: ["audit_id", "run_id", "application_id", "environment", "revision", "from_state", "to_state", "action_id", "evidence", "digest", "occurred_at"],
    sales_report_schedule_audit: ["audit_id", "schedule_id", "application_id", "environment", "revision", "evidence", "digest", "occurred_at"],
    sales_merge_lineage: ["id", "lineage_id", "application_id", "environment", "target_object_type", "winner_id", "winner_pre_revision", "winner_post_revision", "loser_id", "loser_pre_revision", "loser_post_revision", "match_kind", "normalizer_version", "actor_id", "authorization_revision", "winner_pre_digest", "winner_post_digest", "loser_pre_digest", "loser_post_digest", "rewritten_relation_counts", "lineage_digest", "committed_at", "created_at", "updated_at"]
  } as const;
  const tables = Object.keys(required);
  const columns = await pool.query<{ table_name: string; column_name: string }>(
    "select table_name,column_name from information_schema.columns where table_schema='public' and table_name=any($1::text[]) order by table_name,ordinal_position",
    [tables]
  );
  const actual = new Map<string, Set<string>>();
  for (const row of columns.rows) actual.set(row.table_name, (actual.get(row.table_name) ?? new Set()).add(row.column_name));
  const common = ["id", "application_id", "environment", "owner_id", "team_id", "created_by", "updated_by", "revision", "audit", "created_at", "updated_at"];
  const hostOwned = new Set(["sales_import_jobs", "sales_import_rows", "sales_import_chunks", "sales_export_jobs", "sales_merge_lineage", "sales_report_schedules", "sales_report_runs", "sales_report_artifacts", "sales_report_delivery_receipts", "sales_report_run_audit", "sales_report_schedule_audit"]);
  if (tables.some((table) => {
    const fields = actual.get(table);
    return fields === undefined || [...(hostOwned.has(table) ? [] : common), ...required[table as keyof typeof required]].some((field) => !fields.has(field));
  })) fail("Sales table schema mismatch.");
  const legacy = actual.get("sales_opportunities");
  const legacyTasks = actual.get("sales_tasks");
  const legacyStages = actual.get("sales_pipeline_stages");
  if (legacy?.has("stage") || legacy?.has("value") || legacyTasks?.has("potential_revenue") || legacyTasks?.has("private_note") || legacyStages?.has("allowed_transitions")) fail("Sales legacy schema was not retired.");
}

async function assertReportingTimezone(pool: RuntimeExtensionPool): Promise<void> {
  const state = await pool.query<{ settings_revision: number }>("select settings_revision from k_nex_system_settings_state where application_id=$1 and environment=$2", [kNexIdentity.applicationId, kNexIdentity.environment]);
  const documents = await pool.query<{ descriptor_schema_version: number; owner_scope_key: string; owner_kind: string; owner_namespace: string | null; owner_delivery_class: string | null; owner_extension_id: string | null; owner_generation: number | null; document_revision: number; settings_revision: number; values_json: unknown }>("select descriptor_schema_version,owner_scope_key,owner_kind,owner_namespace,owner_delivery_class,owner_extension_id,owner_generation,document_revision,settings_revision,values_json from k_nex_system_settings_documents where application_id=$1 and environment=$2 and descriptor_id='system.general'", [kNexIdentity.applicationId, kNexIdentity.environment]);
  const row = documents.rows[0]; const values = row?.values_json;
  if (state.rows.length !== 1 || !Number.isSafeInteger(state.rows[0]?.settings_revision) || state.rows[0]!.settings_revision < 1 || documents.rows.length !== 1 || row?.descriptor_schema_version !== 3 || row.owner_scope_key !== "platform:system" || row.owner_kind !== "platform" || row.owner_namespace !== "system" || row.owner_delivery_class !== null || row.owner_extension_id !== null || row.owner_generation !== null || !Number.isSafeInteger(row.document_revision) || row.document_revision < 1 || !Number.isSafeInteger(row.settings_revision) || row.settings_revision < 1 || row.settings_revision > state.rows[0]!.settings_revision || values === null || typeof values !== "object" || Array.isArray(values) || !canonicalIana((values as Record<string, unknown>).reportingTimezone) || typeof (values as Record<string, unknown>).reportingCurrency !== "string" || !/^[A-Z]{3}$/u.test((values as Record<string, unknown>).reportingCurrency as string)) fail("Application reporting settings v3 readiness mismatch.");
}

export async function reconcileKnexReadiness(payload: Payload) {
  assertAdministrationOperatorConfiguration();
  const root = resolve(process.cwd());
  const { release } = reconcileSource(root);
  const pool = payload.db.pool as RuntimeExtensionPool;
  await assertMigrationReadiness({ pool, applicationId: kNexIdentity.applicationId, artifactRevision: 1, releaseRevision: "platform-" + release.release.version + "-bootstrap" });
  await assertSalesSchema(pool);
  await assertReportingTimezone(pool);
  await bootstrapApplicationTheme(payload);
  await resolveApplicationTheme(payload);
  const authority = kNexAuthority(payload);
  const state = await authority.store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  if (state === undefined || state.authorizationRevision < 2 || state.lifecycleRevision < 1) fail("Authorization lifecycle state mismatch.");
  const expected = { applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
  await authority.store.readTransaction(expected, async (transaction) => {
    await assertExactProtectedRoleBaselineState(transaction, expected, currentProtectedPlatformRoleBaselineRelease);
    const receipt = await transaction.readBootstrapReceipt(expected.applicationId);
    if (receipt === undefined || receipt.applicationId !== expected.applicationId || receipt.ownerRoleId !== "system.role.owner" || receipt.state !== "committed" || receipt.authorizationRevision < 1 || receipt.authorizationRevision > expected.authorizationRevision ||
      receipt.protectedBaselineVersion !== currentProtectedPlatformRoleBaselineRelease.version || receipt.protectedBaselineDigest !== currentProtectedPlatformRoleBaselineRelease.digest ||
      receipt.ownerAssignmentId !== protectedRoleBootstrapId(expected.applicationId, "owner-assignment", receipt.ownerPrincipal.id) || receipt.id !== protectedRoleBootstrapId(expected.applicationId, "receipt", receipt.ownerAssignmentId)) fail("Protected role baseline receipt mismatch.");
    const assignments = await transaction.listAssignments(expected.applicationId);
    const receiptOwners = assignments.filter((assignment) => assignment.id === receipt.ownerAssignmentId);
    if (receiptOwners.length !== 1 || receiptOwners.some((assignment) => assignment.roleId !== receipt.ownerRoleId || assignment.principal.kind !== "user" || assignment.principal.id !== receipt.ownerPrincipal.id || assignment.state !== "active" && assignment.state !== "revoked" || assignment.revision < 1)) fail("Bootstrap owner assignment mismatch.");
    const salesGenerations = (await transaction.listExtensionGenerations(expected.applicationId)).filter((generation) =>
      generation.state === "current" && generation.applicationId === expected.applicationId &&
      same(generation.owner, kNexSalesRegistry.authorizationGeneration.owner) &&
      generation.owner.generation === kNexSalesRegistry.staticRelease.authorizationGeneration &&
      same(generation.runtimeGenerationIds, [kNexSalesRegistry.staticRelease.runtimeGenerationId])
    );
    if (salesGenerations.length !== 1 || salesGenerations.some((generation) =>
      generation.applicationId !== expected.applicationId || !same(generation.owner, kNexSalesRegistry.authorizationGeneration.owner) || !same(generation.runtimeGenerationIds, [kNexSalesRegistry.staticRelease.runtimeGenerationId]) ||
      generation.state !== "current" ||
      generation.authorizationRevision < kNexSalesRegistry.authorizationGeneration.authorizationRevision || generation.authorizationRevision > expected.authorizationRevision ||
      generation.lifecycleRevision < kNexSalesRegistry.authorizationGeneration.lifecycleRevision || generation.lifecycleRevision > expected.lifecycleRevision
    )) fail("Sales authorization generation mismatch.");
  });
  return Object.freeze({ applicationId: kNexIdentity.applicationId, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision });
}
`;
}

function doctorSource(): string {
  return `import { bootKnexApplication } from "./boot.js";
import { shutdownKnexApplication } from "./k-nex-authority.js";
import { kNexApplicationReadyMarker, reconcileKnexReadiness } from "./k-nex-readiness.js";

const payload = await bootKnexApplication("doctor");
try {
  await reconcileKnexReadiness(payload);
  console.log(kNexApplicationReadyMarker);
  console.log("K_NEX_DOCTOR_PASS");
} finally { await shutdownKnexApplication(payload); }
process.exit(0);
`;
}

function realtimeSource(): string {
  return `import { randomUUID } from "node:crypto";

import { createSocketIoMemoryGateway } from "@k-nex/provider-realtime-socketio";
import { createCurrentAuthorityTarget, createRealtimeTopicRegistry, defineRealtimeTopic } from "@k-nex/runtime";
import { salesRealtimeTopicDescriptors } from "@k-nex/module-sales/contracts";
import type { Server } from "node:http";
import type { Payload } from "payload";

import { currentPayloadAuthentication, currentSalesGeneration, kNexAuthority, kNexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";

const channel = "k_nex_runtime_invalidation";
type NotificationClient = { query(text: string): Promise<unknown>; on(event: "notification", listener: (message: Readonly<{ channel: string; payload?: string }>) => void): void; on(event: "error" | "end", listener: () => void): void; release(destroy?: boolean): void; };
type OpaqueInvalidation = Readonly<{ topic: string; source: string; event: string; correlation: string; dedupe: string }>;

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\\0") !== [...keys].sort().join("\\0")) throw new TypeError("Realtime invalidation is invalid.");
  return value as Record<string, unknown>;
}
function opaque(value: unknown, topic: string, source: string, event: string): OpaqueInvalidation {
  const raw = exactObject(value, ["correlation", "dedupe", "event", "source", "topic"]);
  if (raw.topic !== topic || raw.source !== source || raw.event !== event || typeof raw.correlation !== "string" || typeof raw.dedupe !== "string" || !/^[a-z][a-z0-9.-]{2,127}$/u.test(raw.dedupe) || raw.correlation.length < 1 || raw.correlation.length > 128) throw new TypeError("Realtime invalidation is invalid.");
  return Object.freeze({ topic, source, event, correlation: raw.correlation, dedupe: raw.dedupe });
}
function emptyParams(value: unknown): Readonly<Record<string, never>> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) throw new TypeError("Realtime topic parameters are invalid.");
  return Object.freeze({});
}
type RealtimeSalesScope = Readonly<{ recordScope: "owned-or-assigned-team" | "managed-teams-and-own" | "application-sales-scope" | "explicit-application-or-team-scope"; applicationWide: boolean; mutationAllowed: boolean; authorizedTeamIds: readonly string[]; revision: number }>;
function realtimeSalesScope(value: unknown): RealtimeSalesScope | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!["owned-or-assigned-team", "managed-teams-and-own", "application-sales-scope", "explicit-application-or-team-scope"].includes(String(row.record_scope)) || typeof row.application_wide !== "boolean" || typeof row.mutation_allowed !== "boolean" || !Array.isArray(row.authorized_team_ids) || row.authorized_team_ids.length > 32 || row.authorized_team_ids.some((team) => typeof team !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u.test(team)) || JSON.stringify(row.authorized_team_ids) !== JSON.stringify([...new Set(row.authorized_team_ids)].sort()) || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1) return undefined;
  const recordScope = row.record_scope as RealtimeSalesScope["recordScope"];
  const validMode = recordScope === "application-sales-scope" ? row.application_wide === true && row.mutation_allowed === true
    : recordScope === "explicit-application-or-team-scope" ? row.mutation_allowed === false
      : row.application_wide === false && row.mutation_allowed === true;
  return validMode ? Object.freeze({ recordScope, applicationWide: row.application_wide, mutationAllowed: row.mutation_allowed, authorizedTeamIds: Object.freeze([...row.authorized_team_ids] as string[]), revision: row.revision as number }) : undefined;
}
async function realtimeAllowed(payload: Payload, headers: Headers, actorId: string, permission: Readonly<{ id: string; resource: string; scope: "application" | "record" | "field" }>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  const initialGeneration = await currentSalesGeneration(payload);
  const readScope = () => (payload.db.pool as unknown as { query(text: string, values: readonly unknown[]): Promise<{ rows: unknown[] }> }).query("select record_scope,application_wide,mutation_allowed,authorized_team_ids,revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 and state='active'", [kNexIdentity.applicationId, kNexIdentity.environment, actorId]);
  const rows = await readScope();
  const scope = rows.rows.length === 1 ? realtimeSalesScope(rows.rows[0]) : undefined;
  if (scope === undefined || signal.aborted) return false;
  const recordId = "collection";
  const targetScope = permission.scope === "application" ? { kind: "application", resource: permission.resource }
    : permission.scope === "record" ? { kind: "record", resource: permission.resource, recordId }
      : { kind: "field", resource: permission.resource, recordId, fieldId: permission.resource };
  const allowed = !signal.aborted && await kNexAuthority(payload).adapter.allows(kNexRequestContext(headers, "realtime-sales"), createCurrentAuthorityTarget({ permissionId: permission.id, scope: targetScope, facts: {
    applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, boundary: "realtime-sales", recordId, recordEnvironment: kNexIdentity.environment, ownerId: actorId,
    applicationWide: scope.applicationWide, mutationAllowed: scope.mutationAllowed, authorizedTeamIds: scope.authorizedTeamIds, recordScope: scope.recordScope, salesScopeRevision: scope.revision, collectionScope: true,
    ...(permission.scope === "field" ? { fieldId: permission.resource, fieldAllowed: true } : {})
  } }), signal);
  if (!allowed || signal.aborted) return false;
  const [finalGeneration, finalRows] = await Promise.all([currentSalesGeneration(payload), readScope()]);
  const finalScope = finalRows.rows.length === 1 ? realtimeSalesScope(finalRows.rows[0]) : undefined;
  return !signal.aborted && finalScope !== undefined && finalScope.recordScope === scope.recordScope && finalScope.applicationWide === scope.applicationWide && finalScope.mutationAllowed === scope.mutationAllowed && finalScope.revision === scope.revision && JSON.stringify(finalScope.authorizedTeamIds) === JSON.stringify(scope.authorizedTeamIds) && finalGeneration.state.authorizationRevision === initialGeneration.state.authorizationRevision && finalGeneration.state.lifecycleRevision === initialGeneration.state.lifecycleRevision;
}

export async function startKnexRealtime(payload: Payload, httpServer: Server) {
  const credentialHeaders = new Map<string, Headers>();
  const actorHeaders = new WeakMap<object, Headers>();
  const pendingAuthorizations = new Set<Promise<unknown>>();
  const trackAuthorization = <T>(operation: Promise<T>): Promise<T> => {
    pendingAuthorizations.add(operation);
    void operation.then(() => pendingAuthorizations.delete(operation), () => pendingAuthorizations.delete(operation));
    return operation;
  };
  const permission = new Map(kNexSalesRegistry.permissionDescriptors.map((descriptor) => [descriptor.id, descriptor]));
  const topics = createRealtimeTopicRegistry(salesRealtimeTopicDescriptors.map((descriptor) => {
    const expected = permission.get(descriptor.permission);
    if (expected === undefined) throw new TypeError("Realtime topic permission is unavailable.");
    return defineRealtimeTopic({
      id: descriptor.id,
      parseParams: emptyParams,
      parseEvent(value: unknown) { return opaque(value, descriptor.id, descriptor.sourceId, descriptor.eventId); },
      async authorize({ actor, signal }) {
        const headers = actorHeaders.get(actor);
        return headers === undefined ? false : trackAuthorization(realtimeAllowed(payload, headers, actor.id, expected, signal)).catch(() => false);
      }
    });
  }));
  const gateway = createSocketIoMemoryGateway({
    httpServer,
    topics,
    security: {
      acknowledgementTimeoutMs: 5_000, authenticationTimeoutMs: 5_000, allowedOrigins: [kNexIdentity.publicOrigin.origin], allowedTransports: ["websocket"],
      maxBufferedMessagesPerConnection: 32, maxConnections: 1_000, maxPendingPublications: 1_000, maxRequestBytes: 8_192,
      maxSubscriptionRequestsPerMinute: 120, maxSubscriptionsPerConnection: 8, revalidationIntervalMs: 30_000, revalidationTimeoutMs: 5_000
    },
    async authenticate(_credentials, deadline, headers) {
      if (deadline.signal.aborted || typeof headers.cookie !== "string" || headers.cookie.length < 1 || headers.cookie.length > 8_192) return null;
      const requestHeaders = new Headers(); requestHeaders.set("cookie", headers.cookie); if (typeof headers.origin === "string") requestHeaders.set("origin", headers.origin);
      const context = kNexRequestContext(requestHeaders, "realtime-auth");
      const user = (await trackAuthorization(Promise.resolve().then(() => currentPayloadAuthentication(payload, context))).catch(() => undefined))?.user;
      if (user === null || typeof user !== "object" || !("id" in user) || !("collection" in user) || user.collection !== "users" || user.id === null || user.id === undefined || deadline.signal.aborted) return null;
      const id = randomUUID(); const actor = Object.freeze({ id: String(user.id), type: "user" }); credentialHeaders.set(id, requestHeaders); actorHeaders.set(actor, requestHeaders);
      return Object.freeze({ actor, id, dispose: () => { credentialHeaders.delete(id); if (actorHeaders.get(actor) === requestHeaders) actorHeaders.delete(actor); } });
    },
    async isSessionActive(session, deadline) {
      const headers = credentialHeaders.get(session.id);
      if (headers === undefined || deadline.signal.aborted) return false;
      const user = (await trackAuthorization(Promise.resolve().then(() => currentPayloadAuthentication(payload, kNexRequestContext(headers, "realtime-revalidate")))).catch(() => undefined))?.user;
      return !deadline.signal.aborted && user !== null && typeof user === "object" && "id" in user && "collection" in user && user.collection === "users" && String(user.id) === session.actor.id;
    }
  });
  const pool = payload.db.pool as unknown as { connect(): Promise<NotificationClient> };
  let listener: NotificationClient | undefined;
  try { listener = await pool.connect();
  const activeListener = listener;
  let closed = false;
  const publications = new Set<Promise<void>>();
  const publish = (event: OpaqueInvalidation): void => {
    const operation = gateway.publish({ channel: { topicId: event.topic, params: {} }, correlationId: event.correlation, message: event, messageClass: "reconstructible-invalidation" })
      .then(() => undefined, () => undefined).finally(() => publications.delete(operation));
    publications.add(operation);
  };
  activeListener.on("notification", (notification) => {
    if (closed || notification.channel !== channel || notification.payload === undefined) return;
    try {
      const envelope = exactObject(JSON.parse(notification.payload), ["applicationId", "environment", "invalidation", "type"]);
      if (envelope.applicationId !== kNexIdentity.applicationId || envelope.environment !== kNexIdentity.environment || envelope.type !== "realtime") return;
      publish(opaque(envelope.invalidation, String((envelope.invalidation as Record<string, unknown> | null)?.topic), String((envelope.invalidation as Record<string, unknown> | null)?.source), String((envelope.invalidation as Record<string, unknown> | null)?.event)));
    } catch { /* Untrusted notifications never alter realtime state. */ }
  });
  activeListener.on("error", () => { /* Polling remains the authoritative fallback after a bridge fault. */ });
  activeListener.on("end", () => { /* Pool shutdown owns final listener disposal. */ });
  await activeListener.query("LISTEN k_nex_runtime_invalidation");
  return Object.freeze({
    gateway,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await gateway.close();
      await Promise.allSettled([...pendingAuthorizations]);
      await activeListener.query("UNLISTEN k_nex_runtime_invalidation").catch(() => undefined);
      activeListener.release(true);
      await Promise.allSettled([...publications]);
      credentialHeaders.clear();
    }
  });
  } catch (error) {
    listener?.release(true);
    await gateway.close().catch(() => undefined);
    throw error;
  }
}
`;
}

function workerSource(): string {
  return `import { canonicalJson } from "@k-nex/contracts";
import { salesEventDescriptors } from "@k-nex/module-sales/contracts";
import { createSalesRealtimeRelay } from "@k-nex/module-sales/server";
import { AuthorizationOutboxWorker, PostgresAuthorizationOutboxDispatcher, PostgresWorkspaceNavigationOutboxDispatcher, PostgresWorkspacePageOutboxDispatcher, WorkspaceNavigationOutboxWorker, WorkspacePageOutboxWorker, processNextPayloadOutboxEvent, type RuntimeExtensionPool } from "@k-nex/payload-adapter";

import { bootKnexApplication } from "./boot.js";
import { shutdownKnexApplication } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { processSalesDataMovement } from "./k-nex-sales-data-movement.js";
import { createGeneratedBoundedReferenceProviderTransport, createGeneratedEnvironmentProviderSecretResolver, processGeneratedSalesCommunications, processGeneratedSalesReminders } from "./k-nex-sales-communications.js";
import { processGeneratedSalesWorkflows } from "./k-nex-sales-workflows.js";
import { processGeneratedSalesReports } from "./k-nex-sales-reports.js";

const payload = await bootKnexApplication("authorization-worker");
const channel = "k_nex_runtime_invalidation";
const pool = payload.db.pool as RuntimeExtensionPool;
type SalesWorkerFence = Readonly<{ applicationId: string; environment: string; activeExecutionGeneration: string; fencingToken: number; leaseOwner: string; promotionRevision: number }>;
const executionGeneration = process.env.K_NEX_GENERATION;
if (typeof executionGeneration !== "string" || !/^[a-z][a-z0-9-]{2,127}$/u.test(executionGeneration)) throw new Error("K_NEX_GENERATION must be the deployment execution generation.");
async function currentSalesWorkerFence(): Promise<SalesWorkerFence | undefined> {
  const result = await pool.query<{ active_execution_generation: unknown; fencing_token: unknown; lease_owner: unknown; promotion_revision: unknown }>(
    "select active_execution_generation,fencing_token,lease_owner,promotion_revision from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and lease_expires_at>now()",
    [kNexIdentity.applicationId, kNexIdentity.environment, executionGeneration]
  );
  const row = result.rows[0];
  const generation = row?.active_execution_generation;
  const token = row?.fencing_token;
  const owner = row?.lease_owner;
  const promotion = row?.promotion_revision;
  const tokenNumber = typeof token === "number" ? token : typeof token === "string" && /^[1-9][0-9]{0,15}$/u.test(token) ? Number(token) : Number.NaN;
  const promotionNumber = typeof promotion === "number" ? promotion : typeof promotion === "string" && /^(?:0|[1-9][0-9]{0,9})$/u.test(promotion) ? Number(promotion) : Number.NaN;
  if (result.rows.length !== 1 || typeof generation !== "string" || generation !== executionGeneration ||
    !Number.isSafeInteger(tokenNumber) || tokenNumber < 1 || typeof owner !== "string" || owner.length < 1 ||
    !Number.isSafeInteger(promotionNumber) || promotionNumber < 0) return undefined;
  return Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, activeExecutionGeneration: generation, fencingToken: tokenNumber, leaseOwner: owner, promotionRevision: promotionNumber });
}
const admittedFailures: unknown[] = [];
function workerFailure(marker: string) {
  return (error: unknown) => { admittedFailures.push(error); console.error(marker); };
}
async function notify(type: "authorization" | "workspace-navigation" | "workspace-page" | "realtime", invalidation: unknown, signal: AbortSignal) {
  if (signal.aborted) throw new Error("Runtime invalidation publication was aborted.");
  await pool.query("select pg_notify($1,$2)", [channel, canonicalJson({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, type, invalidation })]);
  if (signal.aborted) throw new Error("Runtime invalidation publication was aborted.");
}
const authorizationWorker = new AuthorizationOutboxWorker(
  new PostgresAuthorizationOutboxDispatcher(pool, { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment }),
  { publish: (invalidation, signal) => {
    if (invalidation.applicationId !== kNexIdentity.applicationId || invalidation.environment !== kNexIdentity.environment) throw new Error("Authorization invalidation identity mismatch.");
    return notify("authorization", invalidation, signal);
  } },
  { onError: workerFailure("K_NEX_AUTHORIZATION_OUTBOX_ERROR") }
);
const workspacePageWorker = new WorkspacePageOutboxWorker(
  new PostgresWorkspacePageOutboxDispatcher(pool, { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment }),
  { publish: (invalidation, signal) => {
    if (invalidation.applicationId !== kNexIdentity.applicationId || invalidation.environment !== kNexIdentity.environment) throw new Error("Workspace page invalidation identity mismatch.");
    return notify("workspace-page", invalidation, signal);
  } },
  { onError: workerFailure("K_NEX_WORKSPACE_PAGE_OUTBOX_ERROR") }
);
const workspaceNavigationWorker = new WorkspaceNavigationOutboxWorker(
  new PostgresWorkspaceNavigationOutboxDispatcher(pool, { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment }),
  { publish: (invalidation, signal) => {
    if (invalidation.applicationId !== kNexIdentity.applicationId || invalidation.environment !== kNexIdentity.environment) throw new Error("Workspace navigation invalidation identity mismatch.");
    return notify("workspace-navigation", invalidation, signal);
  } },
  { onError: workerFailure("K_NEX_WORKSPACE_NAVIGATION_OUTBOX_ERROR") }
);
let realtimeDispatching = false;
let realtimeStopping = false;
let dataMovementDispatching = false;
let dataMovementStopping = false;
let communicationsDispatching = false;
let communicationsStopping = false;
let workflowsDispatching = false;
let workflowsStopping = false;
let reportsDispatching = false;
let reportsStopping = false;
const providerSecrets = createGeneratedEnvironmentProviderSecretResolver();
const providerTransport = createGeneratedBoundedReferenceProviderTransport(process.env.K_NEX_REFERENCE_PROVIDER_ENDPOINT);
const realtimeAbort = new AbortController();
const salesRealtimeOutboxConsumer = Object.freeze({
  applicationId: kNexIdentity.applicationId,
  environment: kNexIdentity.environment,
  pluginId: "module.sales",
  eventTypes: Object.freeze(salesEventDescriptors.map(({ id }) => id))
});
const realtimeRelay = createSalesRealtimeRelay({ publish: async (input) => {
  const message = input.message;
  if (message === null || typeof message !== "object" || Array.isArray(message)) throw new TypeError("Sales realtime invalidation is invalid.");
  await notify("realtime", message, realtimeAbort.signal);
  return { accepted: true };
} });
const dispatchRealtime = async () => {
  if (realtimeDispatching || realtimeStopping) return;
  realtimeDispatching = true;
  try { await processNextPayloadOutboxEvent({ payload, consumer: salesRealtimeOutboxConsumer, subscriber: realtimeRelay }); }
  catch (error) { if (!realtimeStopping) workerFailure("K_NEX_REALTIME_OUTBOX_ERROR")(error); }
  finally { realtimeDispatching = false; }
};
const realtimeTimer = setInterval(() => { void dispatchRealtime(); }, 100);
const dispatchDataMovement = async () => {
  if (dataMovementDispatching || dataMovementStopping) return;
  dataMovementDispatching = true;
  try {
    const salesWorkerFence = await currentSalesWorkerFence();
    while (!dataMovementStopping && salesWorkerFence !== undefined && await processSalesDataMovement(pool, salesWorkerFence) !== "idle") { /* drain bounded durable work */ }
  } catch (error) { if (!dataMovementStopping) workerFailure("K_NEX_DATA_MOVEMENT_ERROR")(error); }
  finally { dataMovementDispatching = false; }
};
const dataMovementTimer = setInterval(() => { void dispatchDataMovement(); }, 100);
const dispatchCommunications = async () => {
  if (communicationsDispatching || communicationsStopping) return;
  communicationsDispatching = true;
  try {
    const salesWorkerFence = await currentSalesWorkerFence();
    // Due reminders run before bounded external provider work; provider lane is <=4×10s.
    if (salesWorkerFence !== undefined) { await processGeneratedSalesReminders(pool, salesWorkerFence); await processGeneratedSalesCommunications(pool, salesWorkerFence, providerSecrets, providerTransport); }
  } catch (error) { if (!communicationsStopping) workerFailure("K_NEX_COMMUNICATIONS_ERROR")(error); }
  finally { communicationsDispatching = false; }
};
const communicationsTimer = setInterval(() => { void dispatchCommunications(); }, 100);
const dispatchWorkflows = async () => {
  if (workflowsDispatching || workflowsStopping) return;
  workflowsDispatching = true;
  try { const salesWorkerFence = await currentSalesWorkerFence(); if (salesWorkerFence !== undefined) await processGeneratedSalesWorkflows(pool, salesWorkerFence); }
  catch (error) { if (!workflowsStopping) workerFailure("K_NEX_WORKFLOW_EXECUTION_ERROR")(error); }
  finally { workflowsDispatching = false; }
};
const workflowsTimer = setInterval(() => { void dispatchWorkflows(); }, 100);
const dispatchReports = async () => {
  if (reportsDispatching || reportsStopping) return;
  reportsDispatching = true;
  try { const salesWorkerFence = await currentSalesWorkerFence(); if (salesWorkerFence !== undefined) await processGeneratedSalesReports(pool, salesWorkerFence); }
  catch (error) { if (!reportsStopping) workerFailure("K_NEX_REPORT_DELIVERY_ERROR")(error); }
  finally { reportsDispatching = false; }
};
const reportsTimer = setInterval(() => { void dispatchReports(); }, 100);
authorizationWorker.start();
workspacePageWorker.start();
workspaceNavigationWorker.start();
void dispatchRealtime();
void dispatchDataMovement();
void dispatchCommunications();
void dispatchWorkflows();
void dispatchReports();
await new Promise<void>((resolve) => {
  let seen = false;
  const stop = () => {
    if (seen) { process.exitCode = 1; process.exit(1); return; }
    seen = true;
    process.off("SIGINT", stop); process.off("SIGTERM", stop); resolve();
  };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  // Readiness means signal admission is installed, not merely that workers started.
  console.log("K_NEX_WORKER_READY");
});
const shutdownDeadline = setTimeout(() => { process.exitCode = 1; console.error("K_NEX_WORKER_SHUTDOWN_EXPIRED"); process.exit(1); }, 30_000);
authorizationWorker.stop();
workspacePageWorker.stop();
workspaceNavigationWorker.stop();
realtimeStopping = true;
dataMovementStopping = true;
    communicationsStopping = true;
    workflowsStopping = true;
    reportsStopping = true;
realtimeAbort.abort();
clearInterval(realtimeTimer);
clearInterval(dataMovementTimer);
    clearInterval(communicationsTimer);
    clearInterval(workflowsTimer);
    clearInterval(reportsTimer);
while (realtimeDispatching) await new Promise((resolve) => setTimeout(resolve, 10));
while (dataMovementDispatching) await new Promise((resolve) => setTimeout(resolve, 10));
while (communicationsDispatching) await new Promise((resolve) => setTimeout(resolve, 10));
while (workflowsDispatching) await new Promise((resolve) => setTimeout(resolve, 10));
while (reportsDispatching) await new Promise((resolve) => setTimeout(resolve, 10));
const workerDrains = await Promise.allSettled([authorizationWorker.idle(), workspacePageWorker.idle(), workspaceNavigationWorker.idle()]);
const workerDrainFailures = workerDrains.filter((result): result is PromiseRejectedResult => result.status === "rejected");
let shutdownFailure: unknown;
try { await shutdownKnexApplication(payload); } catch (error) { shutdownFailure = error; }
function failShutdown(error: unknown): never { clearTimeout(shutdownDeadline); process.exitCode = 1; console.error(error); process.exit(1); }
if (workerDrainFailures.length > 0 && shutdownFailure !== undefined) failShutdown(new AggregateError([...workerDrainFailures.map((result) => result.reason), shutdownFailure], "K-Nex worker shutdown failed."));
if (workerDrainFailures.length > 0) failShutdown(new AggregateError(workerDrainFailures.map((result) => result.reason), "K-Nex worker dispatch did not quiesce."));
if (shutdownFailure !== undefined) failShutdown(shutdownFailure);
if (admittedFailures.length > 0) failShutdown(new AggregateError(admittedFailures, "K-Nex worker admitted dispatch failed."));
clearTimeout(shutdownDeadline);
process.exit(0);
`;
}

export function applicationAuthFiles(options: ApplicationAuthFilesOptions): Readonly<Record<string, string>> {
  return {
    "src/app/(auth)/forbidden/page.tsx": `import { LogoutButton } from "../../components/logout-button.js";\n\nexport default function ForbiddenPage() { return <main className="workspace-home"><h1>Access denied</h1><LogoutButton /></main>; }\n`,
    "src/app/(auth)/login/page.tsx": loginPageSource(),
    "src/app/(workspace)/layout.tsx": workspaceLayoutSource(options.applicationName),
    "src/app/(workspace)/page.tsx": workspacePageSource(options.applicationName),
    "src/app/(workspace)/sales/page.tsx": salesRoutePageSource("sales.route.overview", "sales"),
    "src/app/(workspace)/sales/tasks/page.tsx": salesRoutePageSource("sales.route.tasks", "sales/tasks"),
    "src/app/(workspace)/sales/notifications/page.tsx": salesRoutePageSource("sales.route.notifications", "sales/notifications"),
    "src/app/(workspace)/sales/accounts/page.tsx": salesRoutePageSource("sales.route.accounts", "sales/accounts"),
    "src/app/(workspace)/sales/accounts/[id]/page.tsx": salesRoutePageSource("sales.route.account-detail", "sales/accounts/[id]", true),
    "src/app/(workspace)/sales/contacts/page.tsx": salesRoutePageSource("sales.route.contacts", "sales/contacts"),
    "src/app/(workspace)/sales/contacts/[id]/page.tsx": salesRoutePageSource("sales.route.contact-detail", "sales/contacts/[id]", true),
    "src/app/(workspace)/sales/leads/page.tsx": salesRoutePageSource("sales.route.leads", "sales/leads"),
    "src/app/(workspace)/sales/leads/[id]/page.tsx": salesRoutePageSource("sales.route.lead-detail", "sales/leads/[id]", true),
    "src/app/(workspace)/sales/opportunities/page.tsx": salesRoutePageSource("sales.route.opportunities", "sales/opportunities"),
    "src/app/(workspace)/sales/opportunities/[id]/page.tsx": salesRoutePageSource("sales.route.opportunity-detail", "sales/opportunities/[id]", true),
    "src/app/(workspace)/sales/settings/page.tsx": salesRoutePageSource("sales.route.settings", "sales/settings"),
    "src/app/(workspace)/sales/settings/pipeline/page.tsx": salesRoutePageSource("sales.route.pipeline-settings", "sales/settings/pipeline"),
    "src/app/(workspace)/sales/views/page.tsx": salesRoutePageSource("sales.route.saved-views", "sales/views"),
    "src/app/(workspace)/sales/calendar/page.tsx": salesRoutePageSource("sales.route.calendar", "sales/calendar"),
    "src/app/(workspace)/sales/imports/page.tsx": salesRoutePageSource("sales.route.imports", "sales/imports"),
    "src/app/(workspace)/sales/exports/page.tsx": salesRoutePageSource("sales.route.exports", "sales/exports"),
    "src/app/(workspace)/sales/reports/page.tsx": salesRoutePageSource("sales.route.reports", "sales/reports"),
    "src/app/api/k-nex/inventory/route.ts": inventoryRouteSource(),
    "src/app/api/k-nex/navigation/revision/route.ts": navigationRevisionRouteSource(),
    "src/app/api/k-nex/navigation/sidebar/route.ts": navigationSidebarPreferenceRouteSource(),
    "src/app/api/k-nex/sales/actions/[actionId]/route.ts": salesActionRouteSource(),
    "src/app/api/k-nex/sales/providers/email-reference/webhook/route.ts": salesProviderWebhookRouteSource("email.reference.v1"),
    "src/app/api/k-nex/sales/providers/calendar-reference/webhook/route.ts": salesProviderWebhookRouteSource("calendar.reference.v1"),
    "src/app/api/k-nex/sales/authority-scopes/route.ts": salesScopeAdministrationRouteSource(),
    "src/app/api/k-nex/sales/export-artifact/route.ts": salesExportArtifactRouteSource(),
    "src/app/api/k-nex/sales/report-artifact/route.ts": salesReportArtifactRouteSource(),
    "src/app/api/k-nex/sales/import-upload/route.ts": salesImportUploadRouteSource(),
    "src/app/api/k-nex/sales/routes/[routeId]/route.ts": salesRouteProjectionRouteSource(),
    "src/app/api/readiness/route.ts": readinessRouteSource(),
    "src/app/components/login-form.tsx": loginFormSource(),
    "src/app/components/logout-button.tsx": logoutButtonSource(),
    "src/app/components/k-nex-workspace-shell.tsx": shellClientSource(),
    "src/app/components/k-nex-sales-route-runtime.tsx": salesRouteRuntimeClientSource(),
    "src/k-nex-authority.ts": authoritySource(),
    "src/k-nex-bootstrap-owner.ts": bootstrapOwnerSource(),
    "src/k-nex-bootstrap-token.ts": bootstrapTokenSource(),
    "src/k-nex-doctor.ts": doctorSource(),
    "src/k-nex-identity.ts": identitySource(options.applicationId),
    "src/k-nex-issue-attachment-upload-receipt.ts": issueAttachmentUploadReceiptSource(),
    "src/k-nex-issue-bootstrap-token.ts": issueTokenSource(),
    "src/k-nex-readiness.ts": readinessSource(options.theme),
    "src/k-nex-realtime.ts": realtimeSource(),
    "src/k-nex-theme-runtime.ts": themeRuntimeSource(options.theme),
    "src/k-nex-sales-routes.ts": salesRouteRuntimeSource(),
    "src/k-nex-sales-scope-administration.ts": salesScopeAdministrationSource(),
    "src/k-nex-worker.ts": workerSource(),
    "src/k-nex-users.ts": usersSource(),
    "src/k-nex-workspace-navigation.ts": workspaceNavigationSource()
  };
}
