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

function createRuntime(payload: Payload) {
  const store = new PostgresAuthorizationStore(payload.db.pool as RuntimeExtensionPool, {
    validate: (applicationId, subject) => applicationId === kNexIdentity.applicationId && subject.kind === "user" ? "accepted" : "rejected"
  });
  const salesContribution = createPlatformPluginRegistrationAuthorizationContribution({ registration: kNexSalesRegistry.scopedRegistration, generation: kNexSalesRegistry.authorizationGeneration });
  const salesExecutables = kNexSalesRegistry.policyBindings.map((binding) => {
    const executor = kNexSalesRegistry.policyExecutors[binding.policyReference as keyof typeof kNexSalesRegistry.policyExecutors];
    if (executor === undefined || binding.publisher.kind !== "extension" || binding.publisher.deliveryClass !== "platform-plugin") throw new Error("Sales policy executable is unavailable.");
    return createPlatformPluginPolicyExecutable({ kind: "platform-plugin", publisher: binding.publisher, bindingId: binding.id, policyReference: binding.policyReference, executor });
  });
  const catalogProvider = createAuthorizationCatalogProvider(({ applicationId, lifecycleRevision }) => {
    if (applicationId !== kNexIdentity.applicationId) return undefined;
    if (lifecycleRevision !== 0 && lifecycleRevision !== 1) return undefined;
    return {
      applicationId,
      lifecycleRevision,
      catalog: createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision, extensions: lifecycleRevision === 0 ? [] : [salesContribution], executables: lifecycleRevision === 0 ? [] : salesExecutables })
    };
  });
  const resolver = new EffectiveAuthorityResolver({ store, catalogProvider });
  const adapter = new CurrentAuthorityAdapter<KnexRequestContext>({
    current: async (context) => session((await payload.auth({ headers: context.headers, canSetHeaders: false })).user, context.correlationId)
  }, resolver);
  return Object.freeze({ adapter, resolver, store });
}

export function kNexAuthority(payload: Payload) {
  let runtime = runtimes.get(payload);
  if (runtime === undefined) { runtime = createRuntime(payload); runtimes.set(payload, runtime); }
  return runtime;
}

export function kNexRequestContext(headers: Headers, boundary: string): KnexRequestContext {
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(boundary)) throw new TypeError("Authority boundary is invalid.");
  return Object.freeze({ headers, correlationId: \`\${boundary}-\${randomUUID()}\` });
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
  return `import type { BootstrapReceipt } from "@k-nex/contracts";
import { bootstrapFirstOwner, currentProtectedPlatformRoleBaselineRelease, protectedRoleBootstrapId } from "@k-nex/runtime";

import { bootKnexApplication } from "./boot.js";
import { acquireBootstrapLock, assertIssuedBootstrapToken, consumeBootstrapToken, readBootstrapToken, releaseBootstrapLock } from "./k-nex-bootstrap-token.js";
import { kNexAuthority } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";

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
    return;
  }
  if (state.lifecycleRevision !== 1) throw new Error("Sales authorization lifecycle is incompatible.");
  const result = await (payload.db.pool as { query(text: string, values: unknown[]): Promise<{ rows: Array<{ assignment_count: number; generation_count: number; grant_count: number }> }> }).query(
    "select (select count(*)::int from k_nex_role_assignments where application_id=$1 and assignment_id='customer.initial-sales-administrator.owner' and subject_kind='user' and subject_id=$2 and state='active') assignment_count, (select count(*)::int from k_nex_extension_authorization_generations where application_id=$1 and delivery_class='platform-plugin' and extension_id='module.sales' and authorization_generation=1 and state='current') generation_count, (select count(*)::int from k_nex_role_permission_grants where application_id=$1 and role_id='customer.initial-sales-administrator') grant_count",
    [kNexIdentity.applicationId, userId]
  );
  const proof = result.rows[0];
  if (proof?.assignment_count !== 1 || proof.generation_count !== 1 || proof.grant_count !== kNexSalesRegistry.permissionDescriptors.length) throw new Error("Initial Sales authority is incomplete.");
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
  await consumeBootstrapToken(bootstrapLock, token);
  crashAfterCommit("token-consumption");
  console.log(\`K_NEX_OWNER_BOOTSTRAP_PASS \${outcome.id}\`);
} finally {
  try { if (bootstrapLock !== undefined) await releaseBootstrapLock(bootstrapLock); }
  finally { await payload.destroy(); }
}
process.exit(0);
`;
}

function issueTokenSource(): string {
  return `import { bootKnexApplication } from "./boot.js";
import { issueBootstrapToken } from "./k-nex-bootstrap-token.js";

const payload = await bootKnexApplication("bootstrap-token-issuer");
try {
  await issueBootstrapToken(payload, process.argv.slice(2));
  console.log("K_NEX_BOOTSTRAP_TOKEN_ISSUED");
} finally { await payload.destroy(); }
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
import { kNexThemePresentation } from "../../k-nex-registry.js";
import { LogoutButton } from "../components/logout-button.js";

export const dynamic = "force-dynamic";

export default async function WorkspaceHome() {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const authentication = await payload.auth({ headers, canSetHeaders: false });
  if (!authentication.user) redirect("/login");
  if (!await authorizeRequest(payload, kNexRequestContext(headers, "workspace-home"), "system.workspace-pages.read", "system.workspace-pages")) redirect("/forbidden");
  return <section className="workspace-home" data-k-nex-theme-profile={kNexThemePresentation.profileRevisionId}><style>{kNexThemePresentation.cssText}</style><p className="eyebrow">K-Nex workspace</p><h1>${jsxStringExpression(applicationName)}</h1><p>Authenticated workspace ready.</p><LogoutButton /></section>;
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

import { canonicalJson, type PluginNavigationDescriptor } from "@k-nex/contracts";
import { resolveWorkspaceNavigation } from "@k-nex/ui-runtime";
import type { Payload } from "payload";

import { authorizeNavigationPermission, kNexAuthority, kNexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { kNexWorkspacePages, kNexWorkspacePageScope } from "./k-nex-workspace-pages.js";

type RegisteredRoute = Readonly<{ id: string; ownerPluginId: string; permission: string; viewId: string }>;
type RegisteredTemplate = Readonly<{ id: string; ownerPluginId: string; route: Readonly<{ routeId: string }>; permission: string }>;
type RegisteredNavigation = PluginNavigationDescriptor;

async function currentSalesNavigation(payload: Payload, context: ReturnType<typeof kNexRequestContext>, salesGenerationCurrent: boolean): Promise<readonly RegisteredNavigation[]> {
  if (!salesGenerationCurrent) return [];
  const routes = kNexSalesRegistry.scopedRegistration.contributions.routes.map(({ value }) => value as RegisteredRoute);
  const templates = kNexSalesRegistry.scopedRegistration.contributions.pageTemplates.map(({ value }) => value as RegisteredTemplate);
  return (await Promise.all(kNexSalesRegistry.scopedRegistration.contributions.navigation.map(async ({ value }) => {
    const descriptor = value as RegisteredNavigation;
    const route = routes.find((candidate) => candidate.id === descriptor.route.routeId);
    const template = templates.find((candidate) => candidate.id === route?.viewId);
    if (route?.ownerPluginId !== "module.sales" || template?.ownerPluginId !== "module.sales" || template.route.routeId !== route.id) return undefined;
    const [routeAllowed, templateAllowed] = await Promise.all([
      authorizeNavigationPermission(payload, context, route.permission),
      authorizeNavigationPermission(payload, context, template.permission)
    ]);
    return routeAllowed && templateAllowed ? descriptor : undefined;
  }))).filter((descriptor): descriptor is RegisteredNavigation => descriptor !== undefined);
}

export async function resolveCurrentWorkspaceNavigation(payload: Payload, headers: Headers) {
  const authentication = await payload.auth({ headers, canSetHeaders: false });
  if (!authentication.user) return undefined;
  const state = await kNexAuthority(payload).store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  if (state === undefined) return undefined;
  const context = kNexRequestContext(headers, "workspace-navigation");
  const salesGenerationCurrent = state.lifecycleRevision === kNexSalesRegistry.authorizationGeneration.lifecycleRevision &&
    state.authorizationRevision >= kNexSalesRegistry.authorizationGeneration.authorizationRevision;
  const salesNavigation = await currentSalesNavigation(payload, context, salesGenerationCurrent);
  const workspace = kNexWorkspacePages(payload);
  const canReadPages = await authorizeNavigationPermission(payload, context, "system.workspace-pages.read");
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
    implementedSystemRouteIds: ["system.route.workspace", "system.route.workspace-pages"],
    // The section is durable customer-placement structure. Only current static
    // registration contributions may contribute executable plugin links.
    plugins: [{ ...kNexSalesRegistry.navigationSection,
      routes: salesGenerationCurrent ? kNexSalesRegistry.scopedRegistration.contributions.routes.map(({ value }) => value) : [],
      navigation: salesNavigation }],
    customerFolders: folderItems.map(({ node }) => node),
    pages,
    preferences: { sidebar: "expanded", favoritePageIds: [], recentPageIds: [] },
    authorize: (permissionId) => authorizeNavigationPermission(payload, context, permissionId),
    pageAccess: async (pageId) => visiblePageIds.has(pageId)
  });
  const watermark = "sha256:" + createHash("sha256").update(canonicalJson({
    authorizationRevision: state.authorizationRevision,
    lifecycleRevision: state.lifecycleRevision,
    pages: pageItems.map(({ page, impact }) => [page.identity.pageId, page.accessRevision, impact.state, impact.code ?? null]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    folders: folderItems.map(({ node, revision }) => [node.id, revision]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  })).digest("hex");
  return Object.freeze({ navigation, watermark, preferenceKey: kNexIdentity.applicationId + ":user:" + String(authentication.user.id) + ":workspace-sidebar" });
}
`;
}

function salesRouteRuntimeSource(): string {
  return `import "server-only";

import type { DataSourceBindingResult, UiDocument } from "@k-nex/contracts";
import type { Payload } from "payload";

import { authorizeNavigationPermission, kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { executeWorkspaceSalesAction, loadWorkspaceSalesSources, workspaceSalesPermissions } from "./k-nex-sales-workspace.js";

type RegisteredRoute = Readonly<{ id: string; ownerPluginId: string; permission: string; viewId: string }>;
type RegisteredTemplate = Readonly<{ id: string; ownerPluginId: string; route: Readonly<{ routeId: string }>; permission: string; document: UiDocument }>;
type RegisteredAction = Readonly<{ id: string; version: number }>;

function currentSalesGeneration(payload: Payload) {
  return kNexAuthority(payload).store.readState(kNexIdentity.applicationId, kNexIdentity.environment).then((state) => {
    if (state === undefined || state.lifecycleRevision !== kNexSalesRegistry.authorizationGeneration.lifecycleRevision ||
      state.authorizationRevision < kNexSalesRegistry.authorizationGeneration.authorizationRevision) throw new TypeError("Sales route generation is unavailable.");
    return state;
  });
}

function routeTemplate(routeId: string): Readonly<{ route: RegisteredRoute; template: RegisteredTemplate }> {
  const route = kNexSalesRegistry.scopedRegistration.contributions.routes.find((entry) => entry.id === routeId)?.value as RegisteredRoute | undefined;
  const template = kNexSalesRegistry.scopedRegistration.contributions.pageTemplates.find((entry) => entry.id === route?.viewId)?.value as RegisteredTemplate | undefined;
  if (route?.ownerPluginId !== "module.sales" || template?.ownerPluginId !== "module.sales" || template.route.routeId !== route.id) {
    throw new TypeError("Sales route registration is unavailable.");
  }
  return Object.freeze({ route, template });
}

function registeredAction(actionId: string): RegisteredAction {
  const action = kNexSalesRegistry.scopedRegistration.contributions.actions.find((entry) => entry.id === actionId)?.value as { readonly descriptor?: RegisteredAction } | undefined;
  const bound = kNexSalesRegistry.scopedRegistration.contributions.pageTemplates.some((entry) => {
    const template = entry.value as { readonly requirements?: { readonly actions?: readonly RegisteredAction[] } };
    return template.requirements?.actions?.some(({ id, version }) => id === action?.descriptor?.id && version === action.descriptor.version) === true;
  });
  if (action?.descriptor === undefined || !bound) throw new TypeError("Sales route action is unavailable.");
  return action.descriptor;
}

export async function loadRegisteredSalesRoute(payload: Payload, context: KnexRequestContext, routeId: string) {
  await currentSalesGeneration(payload);
  const { route, template } = routeTemplate(routeId);
  if (!await authorizeNavigationPermission(payload, context, route.permission) || !await authorizeNavigationPermission(payload, context, template.permission)) {
    throw new TypeError("Sales route is denied.");
  }
  const [permissions, sourceResults] = await Promise.all([
    workspaceSalesPermissions(payload, context), loadWorkspaceSalesSources(payload, context, template.document, new AbortController().signal)
  ]);
  return Object.freeze({ document: template.document, permissions, sourceResults });
}

export async function executeRegisteredSalesRouteAction(payload: Payload, context: KnexRequestContext, actionId: string, input: unknown, idempotencyKey: string, signal: AbortSignal) {
  await currentSalesGeneration(payload);
  return executeWorkspaceSalesAction(payload, context, registeredAction(actionId), input, idempotencyKey, signal);
}
`;
}

function salesRouteRuntimeClientSource(): string {
  return `"use client";

import type { DataSourceBindingResult, UiDocument } from "@k-nex/contracts";
import { salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor } from "@k-nex/module-sales/contracts";
import { salesUiBlockDefinitions } from "@k-nex/module-sales/ui";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeResult } from "@k-nex/ui-runtime";
import { useMemo } from "react";

const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: salesUiBlockDefinitions, sources: [salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor] }));
type Projection = Readonly<{ document: UiDocument; permissions: readonly string[]; sourceResults: Readonly<Record<string, DataSourceBindingResult<unknown>>> }>;

export function RegisteredSalesRouteRuntime({ initialProjection }: Readonly<{ initialProjection: Projection }>) {
  const result = useMemo(() => runtime.render({
    document: initialProjection.document, surface: "workspace", actor: { authenticated: true, permissions: new Set(initialProjection.permissions) }, sourceResults: initialProjection.sourceResults,
    dispatchAction: async (request) => {
      const response = await fetch("/api/k-nex/sales/actions/" + encodeURIComponent(request.action.id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: request.input, idempotencyKey: "sales-route-action-" + crypto.randomUUID() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.code ?? "Sales action failed.");
      window.location.reload();
      return body.data;
    }
  }), [initialProjection]);
  return <section>{presentUiRuntimeReact(presentUiRuntimeResult(result))}</section>;
}
`;
}

function salesRoutePageSource(routeId: string): string {
  return `import { headers as getHeaders } from "next/headers";
import { notFound } from "next/navigation";

import { bootKnexApplication } from "../../../boot.js";
import { kNexRequestContext } from "../../../k-nex-authority.js";
import { loadRegisteredSalesRoute } from "../../../k-nex-sales-routes.js";
import { RegisteredSalesRouteRuntime } from "../../components/k-nex-sales-route-runtime.js";

export const dynamic = "force-dynamic";

export default async function SalesRoute() {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const context = kNexRequestContext(headers, "sales-route-${routeId}");
  try { return <RegisteredSalesRouteRuntime initialProjection={await loadRegisteredSalesRoute(payload, context, ${JSON.stringify(routeId)})} />; } catch { return notFound(); }
}
`;
}

function salesActionRouteSource(): string {
  return `import { executeRegisteredSalesRouteAction } from "../../../../../k-nex-sales-routes.js";
import { openWorkspaceJson, workspaceMutationError } from "../../../../../k-nex-workspace-page-http.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ actionId: string }> }>) {
  try {
    const { payload, context, body } = await openWorkspaceJson(request, "sales-route-action");
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join("\\0") !== "idempotencyKey\\0input") throw new TypeError("Sales route action body is invalid.");
    const value = body as Record<string, unknown>;
    if (typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(value.idempotencyKey)) throw new TypeError("Sales route idempotency key is invalid.");
    const result = await executeRegisteredSalesRouteAction(payload, context, (await params).actionId, value.input, value.idempotencyKey, request.signal);
    return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) { return workspaceMutationError(error); }
}
`;
}

function navigationRevisionRouteSource(): string {
  return `import { bootKnexApplication } from "../../../../../boot.js";
import { resolveCurrentWorkspaceNavigation } from "../../../../../k-nex-workspace-navigation.js";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const resolved = await resolveCurrentWorkspaceNavigation(await bootKnexApplication("workspace-web"), new Headers(request.headers));
  if (resolved === undefined) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401, headers: { "cache-control": "no-store" } });
  return Response.json({ watermark: resolved.watermark, navigation: resolved.navigation }, { headers: { "cache-control": "no-store" } });
}
`;
}

function shellClientSource(): string {
  return `"use client";

import { WorkspaceShell } from "@k-nex/ui-components";
import type { ResolvedWorkspaceNavigation } from "@k-nex/ui-runtime";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export function KnexWorkspaceShell(props: Readonly<{ applicationLabel: string; environment: string; navigation: ResolvedWorkspaceNavigation; navigationWatermark: string; preferenceKey: string; children: ReactNode }>) {
  const [navigation, setNavigation] = useState(props.navigation);
  const [watermark, setWatermark] = useState(props.navigationWatermark);
  useEffect(() => { setNavigation(props.navigation); setWatermark(props.navigationWatermark); }, [props.navigation, props.navigationWatermark]);
  useEffect(() => {
    let active = true;
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      const response = await fetch("/api/k-nex/navigation/revision", { cache: "no-store" }).catch(() => undefined);
      if (!active) return;
      if (response?.status === 401) { window.location.assign("/login"); return; }
      const body = response?.ok ? await response.json().catch(() => undefined) as { watermark?: unknown; navigation?: unknown } | undefined : undefined;
      if (typeof body?.watermark === "string" && body.watermark !== watermark && typeof body.navigation === "object" && body.navigation !== null) {
        setNavigation(body.navigation as ResolvedWorkspaceNavigation);
        setWatermark(body.watermark);
      }
      pending = false;
    }, 1_000);
    return () => { active = false; clearInterval(timer); };
  }, [watermark]);
  const { navigationWatermark: _, navigation: __, ...shell } = props;
  return <WorkspaceShell {...shell} navigation={navigation} currentHref={usePathname()} />;
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
  return <KnexWorkspaceShell applicationLabel=${jsxStringExpression(applicationName)} environment={kNexIdentity.environment} navigation={resolved.navigation} navigationWatermark={resolved.watermark} preferenceKey={resolved.preferenceKey}>{children}</KnexWorkspaceShell>;
}
`;
}

function inventoryRouteSource(): string {
  return `import { headers as getHeaders } from "next/headers";

import { authorizeRequest, kNexAuthority, kNexRequestContext } from "../../../../k-nex-authority.js";
import { bootKnexApplication } from "../../../../boot.js";
import { kNexIdentity } from "../../../../k-nex-identity.js";
import { kNexSalesRegistry, kNexThemePresentation } from "../../../../k-nex-registry.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  if (!await authorizeRequest(payload, kNexRequestContext(headers, "runtime-inventory"), "system.extensions.read", "system.extensions")) return Response.json({ code: "FORBIDDEN" }, { status: 403 });
  const state = await kNexAuthority(payload).store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  return Response.json({ schemaVersion: 1, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, authorizationRevision: state?.authorizationRevision, lifecycleRevision: state?.lifecycleRevision, plugins: [kNexSalesRegistry.registration.pluginId], theme: { id: kNexThemePresentation.themeId, version: kNexThemePresentation.themeVersion, profileRevisionId: kNexThemePresentation.profileRevisionId }, collections: Object.keys(payload.collections).sort() }, { headers: { "cache-control": "no-store" } });
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
import type { RuntimeExtensionPool } from "@k-nex/payload-adapter";
import { assertExactProtectedRoleBaselineState, assertMigrationReadiness, currentProtectedPlatformRoleBaselineRelease, protectedRoleBootstrapId } from "@k-nex/runtime";
import { ${themeResolver} as resolveSelectedThemeProfile } from "@k-nex/theme-${theme}";
import type { Payload } from "payload";

import { kNexAuthority } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry, kNexThemePresentation } from "./k-nex-registry.js";
import { migrations } from "./migrations/index.js";

export const kNexApplicationReadyMarker = "K_NEX_APPLICATION_READY";

const expectedMigrationNames = Object.freeze([
  "20260827_000001_sales_baseline",
  "20260827_000002_knex_bootstrap",
  "20260903_000003_knex_authorization",
  "20260903_000004_knex_workspace_pages",
  "20260903_000005_knex_event_outbox"
]);
const expectedRouteSources = Object.freeze([
  "src/app/(auth)/forbidden/page.tsx",
  "src/app/(auth)/login/page.tsx",
  "src/app/(payload)/api/[...slug]/route.ts",
  "src/app/(payload)/api/graphql-playground/route.ts",
  "src/app/(payload)/api/graphql/route.ts",
  "src/app/(workspace)/page.tsx",
  "src/app/(workspace)/sales/opportunities/page.tsx",
  "src/app/(workspace)/sales/page.tsx",
  "src/app/(workspace)/sales/settings/page.tsx",
  "src/app/(workspace)/sales/tasks/page.tsx",
  "src/app/(workspace)/system/workspace-pages/[pageId]/page.tsx",
  "src/app/(workspace)/system/workspace-pages/page.tsx",
  "src/app/(workspace)/workspace/pages/[pageId]/edit/page.tsx",
  "src/app/(workspace)/workspace/pages/[pageId]/page.tsx",
  "src/app/api/health/route.ts",
  "src/app/api/k-nex/inventory/route.ts",
  "src/app/api/k-nex/navigation/revision/route.ts",
  "src/app/api/k-nex/sales/actions/[actionId]/route.ts",
  "src/app/api/k-nex/workspace-folders/[folderId]/route.ts",
  "src/app/api/k-nex/workspace-folders/route.ts",
  "src/app/api/k-nex/workspace-pages/[pageId]/[operation]/route.ts",
  "src/app/api/k-nex/workspace-pages/[pageId]/actions/[actionId]/route.ts",
  "src/app/api/k-nex/workspace-pages/[pageId]/session/route.ts",
  "src/app/api/k-nex/workspace-pages/route.ts",
  "src/app/api/readiness/route.ts"
].sort());
const expectedPackageDependencies = Object.freeze([
  "@k-nex/builder-puck", "@k-nex/composition", "@k-nex/contracts", "@k-nex/module-sales",
  "@k-nex/payload-adapter", "@k-nex/runtime", "@k-nex/theme-${theme}", "@k-nex/ui-builder-blocks",
  "@k-nex/ui-components", "@k-nex/ui-data", "@k-nex/ui-design-system-contracts", "@k-nex/ui-forms",
  "@k-nex/ui-pages", "@k-nex/ui-runtime"
].sort());

type ApplicationPlan = Readonly<{
  composition: Readonly<{ plugins: readonly string[]; builder: string; theme: string; databaseAdapter: string }>;
  packageSource: Readonly<{ kind: string; release: string; manifestDigest: string }>;
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
function sha256(value: string | Buffer): string { return "sha256:" + createHash("sha256").update(value).digest("hex"); }
function archiveName(packageName: string, version: string): string { return packageName.slice(1).replace("/", "-") + "-" + version + ".tgz"; }

function parseApplicationPlan(value: unknown): ApplicationPlan {
  const plan = exactRecord(value, ["planVersion", "preset", "composition", "packageSource", "migration", "readiness", "lifecyclePlans"], "Application plan");
  const composition = exactRecord(plan.composition, ["plugins", "builder", "theme", "databaseAdapter"], "Application composition");
  const packageSource = exactRecord(plan.packageSource, ["kind", "release", "manifestDigest"], "Application package source");
  const migration = exactRecord(plan.migration, ["owner", "action", "expectedPredecessorRevision"], "Application migration plan");
  if (plan.planVersion !== 1 || plan.preset !== "sales-reference" || packageSource.kind !== "packed-mirror" ||
    typeof packageSource.release !== "string" || typeof packageSource.manifestDigest !== "string" ||
    !Array.isArray(composition.plugins) || composition.plugins.some((value) => typeof value !== "string") ||
    typeof composition.builder !== "string" || typeof composition.theme !== "string" || composition.databaseAdapter !== "postgres" ||
    migration.owner !== "customer" || migration.action !== "review-and-apply" || migration.expectedPredecessorRevision !== 0 ||
    !same(plan.readiness, ["exact-package-inventory", "migration-revision", "sales-registration"]) ||
    !same(plan.lifecyclePlans, ["add", "disable", "enable", "upgrade"])) fail("Application plan is incompatible.");
  return { composition: composition as ApplicationPlan["composition"], packageSource: packageSource as ApplicationPlan["packageSource"], migration: migration as ApplicationPlan["migration"] };
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
  const builderRelease = release.packages.find((entry) => entry.package === "@k-nex/builder-puck" && entry.role === "builder");
  const themeRelease = release.packages.find((entry) => entry.package === "@k-nex/theme-${theme}" && entry.role === "theme");
  const salesPlugin = application.plugins[0];
  const builder = application.builder;
  const selectedTheme = exactRecord(application.themes, ["active", "package", "version"], "Selected theme");
  if (application.plugins.length !== 1 || salesRelease === undefined || salesPlugin?.id !== "module.sales" || salesPlugin.package !== salesRelease.package || salesPlugin.version !== salesRelease.version || !salesPlugin.enabled) fail("Sales application manifest mismatch.");
  if (builderRelease === undefined || builder?.plugin !== "builder.puck" || builder.package !== builderRelease.package || builder.version !== builderRelease.version || !same(builder.profiles, { workspace: { enabled: true, drafts: true, surfaces: ["workspace"] } })) fail("Puck builder manifest mismatch.");
  if (themeRelease === undefined || selectedTheme.active !== "${theme}" || selectedTheme.package !== themeRelease.package || selectedTheme.version !== themeRelease.version) fail("Theme manifest mismatch.");
  if (!same(plan.composition.plugins, ["module.sales@" + salesRelease.version]) || plan.composition.builder !== "builder.puck@" + builderRelease.version || plan.composition.theme !== "${theme}@" + themeRelease.version) fail("Application composition mismatch.");

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
  const salesInventory = kNexSalesRegistry.scopedRegistration.inventory;
  const expectedContributions = Object.fromEntries(Object.entries(salesManifest.contributions ?? {}).flatMap(([kind, values]) => {
    const ids = Object.keys(values as object).sort();
    return ids.length === 0 ? [] : [[kind, ids]];
  }));
  if (salesManifest.id !== salesPlugin.id || salesManifest.package !== salesPlugin.package || salesManifest.version !== salesPlugin.version ||
    kNexSalesRegistry.registration.pluginId !== salesManifest.id || salesInventory.length !== 1 || salesInventory[0]?.id !== salesManifest.id ||
    !same(salesInventory[0].contributions, expectedContributions) ||
    Object.values(kNexSalesRegistry.scopedRegistration.contributions as Readonly<Record<string, readonly { pluginId: string }[]>>).flat().some((entry) => entry.pluginId !== salesManifest.id) ||
    Object.values(kNexSalesRegistry.scopedRegistration.bindings as Readonly<Record<string, readonly { pluginId: string }[]>>).flat().some((entry) => entry.pluginId !== salesManifest.id)) fail("Sales static registration identity mismatch.");
  if (!same(kNexSalesRegistry.collections.map(({ slug }) => slug).sort(), ["sales-opportunities", "sales-tasks"]) ||
    kNexSalesRegistry.readiness.currentRevision !== 2 || !same(kNexSalesRegistry.readiness.predecessorRevisions, [1])) fail("Sales registry readiness mismatch.");
  if (typeof createAuthorizedPuckBuilderProfile !== "function" || typeof resolveSelectedThemeProfile !== "function" ||
    kNexThemePresentation.themeId !== "theme.${theme}" || kNexThemePresentation.themeVersion !== themeRelease.version ||
    kNexThemePresentation.profileRevisionId !== "workspace.theme.initial") fail("Imported builder or theme registry mismatch.");
  if (!same(migrations.map(({ name }) => name), expectedMigrationNames) || migrations.some(({ up, down }) => typeof up !== "function" || typeof down !== "function")) fail("Generated migration inventory mismatch.");
  return { release };
}

async function assertSalesSchema(pool: RuntimeExtensionPool): Promise<void> {
  const columns = await pool.query<{ table_name: string; column_name: string; udt_name: string; is_nullable: string }>(
    "select table_name,column_name,udt_name,is_nullable from information_schema.columns where table_schema='public' and table_name=any($1::text[]) order by table_name,ordinal_position",
    [["sales_opportunities", "sales_tasks"]]
  );
  const actualColumns = columns.rows.map((row) => [row.table_name, row.column_name, row.udt_name, row.is_nullable].join(":"));
  const expectedColumns = [
    "sales_opportunities:id:int4:NO", "sales_opportunities:name:varchar:NO", "sales_opportunities:stage:enum_sales_opportunities_stage:NO", "sales_opportunities:value:varchar:YES", "sales_opportunities:updated_at:timestamptz:NO", "sales_opportunities:created_at:timestamptz:NO",
    "sales_tasks:id:int4:NO", "sales_tasks:title:varchar:NO", "sales_tasks:status:enum_sales_tasks_status:NO", "sales_tasks:potential_revenue:varchar:YES", "sales_tasks:private_note:varchar:YES", "sales_tasks:updated_at:timestamptz:NO", "sales_tasks:created_at:timestamptz:NO"
  ];
  if (!same(actualColumns, expectedColumns)) fail("Sales table schema mismatch.");
  const enums = await pool.query<{ typname: string; enumlabel: string }>(
    "select t.typname,e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname=any($1::text[]) order by t.typname,e.enumsortorder",
    [["enum_sales_opportunities_stage", "enum_sales_tasks_status"]]
  );
  if (!same(enums.rows.map((row) => row.typname + ":" + row.enumlabel), ["enum_sales_opportunities_stage:lead", "enum_sales_opportunities_stage:qualified", "enum_sales_opportunities_stage:won", "enum_sales_opportunities_stage:lost", "enum_sales_tasks_status:open", "enum_sales_tasks_status:done"])) fail("Sales enum schema mismatch.");
}

export async function reconcileKnexReadiness(payload: Payload) {
  const root = resolve(process.cwd());
  const { release } = reconcileSource(root);
  const pool = payload.db.pool as RuntimeExtensionPool;
  await assertMigrationReadiness({ pool, applicationId: kNexIdentity.applicationId, artifactRevision: 1, releaseRevision: "platform-" + release.release.version + "-bootstrap" });
  await assertSalesSchema(pool);
  const authority = kNexAuthority(payload);
  const state = await authority.store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  if (state === undefined || state.lifecycleRevision !== kNexSalesRegistry.authorizationGeneration.lifecycleRevision || state.authorizationRevision < kNexSalesRegistry.authorizationGeneration.authorizationRevision) fail("Authorization lifecycle state mismatch.");
  const expected = { applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
  await authority.store.readTransaction(expected, async (transaction) => {
    await assertExactProtectedRoleBaselineState(transaction, expected, currentProtectedPlatformRoleBaselineRelease);
    const receipt = await transaction.readBootstrapReceipt(expected.applicationId);
    if (receipt === undefined || receipt.applicationId !== expected.applicationId || receipt.ownerRoleId !== "system.role.owner" || receipt.state !== "committed" || receipt.authorizationRevision !== 1 ||
      receipt.protectedBaselineVersion !== currentProtectedPlatformRoleBaselineRelease.version || receipt.protectedBaselineDigest !== currentProtectedPlatformRoleBaselineRelease.digest ||
      receipt.ownerAssignmentId !== protectedRoleBootstrapId(expected.applicationId, "owner-assignment", receipt.ownerPrincipal.id) || receipt.id !== protectedRoleBootstrapId(expected.applicationId, "receipt", receipt.ownerAssignmentId)) fail("Protected role baseline receipt mismatch.");
    const assignments = await transaction.listAssignments(expected.applicationId);
    const receiptOwners = assignments.filter((assignment) => assignment.id === receipt.ownerAssignmentId && assignment.roleId === receipt.ownerRoleId && assignment.principal.kind === "user" && assignment.principal.id === receipt.ownerPrincipal.id && assignment.state === "active" && assignment.revision === 1);
    if (receiptOwners.length !== 1) fail("Bootstrap owner assignment mismatch.");
    const salesRole = await transaction.readRole(expected.applicationId, "customer.initial-sales-administrator");
    if (!same(salesRole, { schemaVersion: 1, id: "customer.initial-sales-administrator", applicationId: expected.applicationId, label: "Sales administrator", revision: 0 })) fail("Initial Sales administrator role mismatch.");
    const expectedSalesGrants = kNexSalesRegistry.permissionDescriptors.map(({ id }) => ({ schemaVersion: 1, id: "customer.initial-sales-administrator." + id, applicationId: expected.applicationId, roleId: "customer.initial-sales-administrator", permissionId: id, owner: kNexSalesRegistry.authorizationGeneration.owner, revision: 0 })).sort((left, right) => left.id.localeCompare(right.id));
    const salesGrants = [...await transaction.listGrants(expected.applicationId, "customer.initial-sales-administrator")].sort((left, right) => left.id.localeCompare(right.id));
    if (!same(salesGrants, expectedSalesGrants)) fail("Initial Sales permission grants mismatch.");
    const salesGenerations = (await transaction.listExtensionGenerations(expected.applicationId)).filter((generation) => generation.owner.deliveryClass === "platform-plugin" && generation.owner.extensionId === "module.sales");
    if (!same(salesGenerations, [kNexSalesRegistry.authorizationGeneration])) fail("Sales authorization generation mismatch.");
    const salesAssignment = assignments.filter((assignment) => assignment.id === "customer.initial-sales-administrator.owner");
    if (!same(salesAssignment, [{ schemaVersion: 1, id: "customer.initial-sales-administrator.owner", applicationId: expected.applicationId, roleId: "customer.initial-sales-administrator", principal: receipt.ownerPrincipal, state: "active", revision: 0 }])) fail("Initial Sales owner assignment mismatch.");
  });
  return Object.freeze({ applicationId: kNexIdentity.applicationId, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision });
}
`;
}

function doctorSource(): string {
  return `import { bootKnexApplication } from "./boot.js";
import { kNexApplicationReadyMarker, reconcileKnexReadiness } from "./k-nex-readiness.js";

const payload = await bootKnexApplication("doctor");
try {
  await reconcileKnexReadiness(payload);
  console.log(kNexApplicationReadyMarker);
  console.log("K_NEX_DOCTOR_PASS");
} finally { await payload.destroy(); }
process.exit(0);
`;
}

function workerSource(): string {
  return `import { canonicalJson } from "@k-nex/contracts";
import { AuthorizationOutboxWorker, PostgresAuthorizationOutboxDispatcher, PostgresWorkspacePageOutboxDispatcher, WorkspacePageOutboxWorker, type RuntimeExtensionPool } from "@k-nex/payload-adapter";

import { bootKnexApplication } from "./boot.js";
import { kNexIdentity } from "./k-nex-identity.js";

const payload = await bootKnexApplication("authorization-worker");
const channel = "k_nex_runtime_invalidation";
const pool = payload.db.pool as RuntimeExtensionPool;
async function notify(type: "authorization" | "workspace-page", invalidation: unknown, signal: AbortSignal) {
  if (signal.aborted) throw new Error("Runtime invalidation publication was aborted.");
  await pool.query("select pg_notify($1,$2)", [channel, canonicalJson({ type, invalidation })]);
  if (signal.aborted) throw new Error("Runtime invalidation publication was aborted.");
}
const authorizationWorker = new AuthorizationOutboxWorker(
  new PostgresAuthorizationOutboxDispatcher(pool, { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment }),
  { publish: (invalidation, signal) => {
    if (invalidation.applicationId !== kNexIdentity.applicationId || invalidation.environment !== kNexIdentity.environment) throw new Error("Authorization invalidation identity mismatch.");
    return notify("authorization", invalidation, signal);
  } },
  { onError: () => console.error("K_NEX_AUTHORIZATION_OUTBOX_ERROR") }
);
const workspacePageWorker = new WorkspacePageOutboxWorker(
  new PostgresWorkspacePageOutboxDispatcher(pool, { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment }),
  { publish: (invalidation, signal) => {
    if (invalidation.applicationId !== kNexIdentity.applicationId || invalidation.environment !== kNexIdentity.environment) throw new Error("Workspace page invalidation identity mismatch.");
    return notify("workspace-page", invalidation, signal);
  } },
  { onError: () => console.error("K_NEX_WORKSPACE_PAGE_OUTBOX_ERROR") }
);
authorizationWorker.start();
workspacePageWorker.start();
console.log("K_NEX_WORKER_READY");
await new Promise<void>((resolve) => {
  const stop = () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); resolve(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
});
authorizationWorker.stop();
workspacePageWorker.stop();
await payload.destroy();
process.exit(0);
`;
}

export function applicationAuthFiles(options: ApplicationAuthFilesOptions): Readonly<Record<string, string>> {
  return {
    "src/app/(auth)/forbidden/page.tsx": `import { LogoutButton } from "../../components/logout-button.js";\n\nexport default function ForbiddenPage() { return <main className="workspace-home"><h1>Access denied</h1><LogoutButton /></main>; }\n`,
    "src/app/(auth)/login/page.tsx": loginPageSource(),
    "src/app/(workspace)/layout.tsx": workspaceLayoutSource(options.applicationName),
    "src/app/(workspace)/page.tsx": workspacePageSource(options.applicationName),
    "src/app/(workspace)/sales/page.tsx": salesRoutePageSource("sales.route.overview"),
    "src/app/(workspace)/sales/tasks/page.tsx": salesRoutePageSource("sales.route.tasks"),
    "src/app/(workspace)/sales/opportunities/page.tsx": salesRoutePageSource("sales.route.opportunities"),
    "src/app/(workspace)/sales/settings/page.tsx": salesRoutePageSource("sales.route.settings"),
    "src/app/api/k-nex/inventory/route.ts": inventoryRouteSource(),
    "src/app/api/k-nex/navigation/revision/route.ts": navigationRevisionRouteSource(),
    "src/app/api/k-nex/sales/actions/[actionId]/route.ts": salesActionRouteSource(),
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
    "src/k-nex-issue-bootstrap-token.ts": issueTokenSource(),
    "src/k-nex-readiness.ts": readinessSource(options.theme),
    "src/k-nex-sales-routes.ts": salesRouteRuntimeSource(),
    "src/k-nex-worker.ts": workerSource(),
    "src/k-nex-users.ts": usersSource(),
    "src/k-nex-workspace-navigation.ts": workspaceNavigationSource()
  };
}
