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
  query(text: string, values: unknown[]): Promise<{ rowCount: number }>;
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
  return `import { bootstrapFirstOwner } from "@k-nex/runtime";

import { bootKnexApplication } from "./boot.js";
import { acquireBootstrapLock, assertIssuedBootstrapToken, consumeBootstrapToken, readBootstrapToken, releaseBootstrapLock } from "./k-nex-bootstrap-token.js";
import { kNexAuthority } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";

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
  if (priorReceipt !== undefined) throw new Error("First owner already exists.");
  const existing = await payload.find({ collection: "users", overrideAccess: true, limit: 2, where: { email: { equals: email } } });
  if (existing.totalDocs > 1) throw new Error("Owner email identity is ambiguous.");
  const user = existing.docs[0] ?? await payload.create({ collection: "users", overrideAccess: true, data: { email, password } });
  if (existing.docs[0]) await payload.login({ collection: "users", data: { email, password } });
  const outcome = (await bootstrapFirstOwner({
      store: runtime.store,
      expected: { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, authorizationRevision: 0, lifecycleRevision: 0 },
      firstOwner: { kind: "user", id: String(user.id) }
    })).value;
  await ensureInitialSalesOwner(payload, String(user.id));
  await consumeBootstrapToken(bootstrapLock, token);
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
  return `import { resolveWorkspaceNavigation } from "@k-nex/ui-runtime";
import type { Payload } from "payload";

import { authorizeNavigationPermission, kNexAuthority, kNexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { kNexWorkspacePages, kNexWorkspacePageScope } from "./k-nex-workspace-pages.js";

export async function resolveCurrentWorkspaceNavigation(payload: Payload, headers: Headers) {
  const authentication = await payload.auth({ headers, canSetHeaders: false });
  if (!authentication.user) return undefined;
  const state = await kNexAuthority(payload).store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  if (state === undefined) return undefined;
  const context = kNexRequestContext(headers, "workspace-navigation");
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
    plugins: [kNexSalesRegistry.navigationSection],
    customerFolders: folderItems.map(({ node }) => node),
    pages,
    preferences: { sidebar: "expanded", favoritePageIds: [], recentPageIds: [] },
    authorize: (permissionId) => authorizeNavigationPermission(payload, context, permissionId),
    pageAccess: async (pageId) => visiblePageIds.has(pageId)
  });
  return Object.freeze({ navigation, preferenceKey: kNexIdentity.applicationId + ":user:" + String(authentication.user.id) + ":workspace-sidebar" });
}
`;
}

function shellClientSource(): string {
  return `"use client";

import { WorkspaceShell } from "@k-nex/ui-components";
import type { ResolvedWorkspaceNavigation } from "@k-nex/ui-runtime";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function KnexWorkspaceShell(props: Readonly<{ applicationLabel: string; environment: string; navigation: ResolvedWorkspaceNavigation; preferenceKey: string; children: ReactNode }>) {
  return <WorkspaceShell {...props} currentHref={usePathname()} />;
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
  return <KnexWorkspaceShell applicationLabel=${jsxStringExpression(applicationName)} environment={kNexIdentity.environment} navigation={resolved.navigation} preferenceKey={resolved.preferenceKey}>{children}</KnexWorkspaceShell>;
}
`;
}

function registeredRoutePageSource(routeClass: "sales" | "system"): string {
  const prefix = `/${routeClass}`;
  return `import { resolveAuthorizedWorkspacePath } from "@k-nex/ui-runtime";
import { headers as getHeaders } from "next/headers";
import { notFound } from "next/navigation";

import { bootKnexApplication } from "../../../../boot.js";
import { resolveCurrentWorkspaceNavigation } from "../../../../k-nex-workspace-navigation.js";

export const dynamic = "force-dynamic";

export default async function Registered${routeClass === "sales" ? "Sales" : "System"}Page({ params }: Readonly<{ params: Promise<{ path?: string[] }> }>) {
  const payload = await bootKnexApplication("workspace-web");
  const resolved = await resolveCurrentWorkspaceNavigation(payload, await getHeaders());
  if (resolved === undefined) return notFound();
  const segments = (await params).path ?? [];
  const pathname = ${JSON.stringify(prefix)} + (segments.length === 0 ? "" : "/" + segments.map(encodeURIComponent).join("/"));
  const route = resolveAuthorizedWorkspacePath(resolved.navigation, pathname);
  if (route === undefined || route.target.class !== ${JSON.stringify(routeClass === "sales" ? "platform-plugin" : "system")}) return notFound();
  const label = resolved.navigation.tree.nodes.find((node) => node.target !== undefined && JSON.stringify(node.target) === JSON.stringify(route.target))?.label ?? ${JSON.stringify(routeClass === "sales" ? "Sales" : "System")};
  return <section><p className="eyebrow">${routeClass === "sales" ? "Sales" : "K-Nex administration"}</p><h1>{label}</h1><p>Registered workspace route.</p></section>;
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
import { kNexAuthority } from "../../../k-nex-authority.js";
import { kNexIdentity } from "../../../k-nex-identity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await bootKnexApplication("readiness");
    const authority = kNexAuthority(payload);
    const state = await authority.store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
    const receipt = await authority.store.readProtectedRoleBaselineReceipt(kNexIdentity.applicationId);
    if (state === undefined || receipt === undefined || state.authorizationRevision < 1) throw new Error("Owner bootstrap is incomplete.");
    return Response.json({ schemaVersion: 1, status: "ready", applicationId: kNexIdentity.applicationId, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ schemaVersion: 1, status: "not-ready" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
`;
}

function readinessCommandSource(): string {
  return `import { bootKnexApplication } from "./boot.js";
import { kNexAuthority } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";

const payload = await bootKnexApplication("readiness-command");
try {
  const authority = kNexAuthority(payload);
  const state = await authority.store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  const receipt = await authority.store.readProtectedRoleBaselineReceipt(kNexIdentity.applicationId);
  if (state === undefined || receipt === undefined || state.authorizationRevision < 1) throw new Error("K-Nex owner bootstrap is incomplete.");
  console.log("K_NEX_APPLICATION_READY");
} finally { await payload.destroy(); }
process.exit(0);
`;
}

function workerSource(): string {
  return `import { AuthorizationOutboxWorker, PostgresAuthorizationOutboxDispatcher } from "@k-nex/payload-adapter";

import { bootKnexApplication } from "./boot.js";
import { kNexIdentity } from "./k-nex-identity.js";

const payload = await bootKnexApplication("authorization-worker");
const dispatcher = new PostgresAuthorizationOutboxDispatcher(payload.db.pool as never, { applicationId: kNexIdentity.applicationId });
const worker = new AuthorizationOutboxWorker(dispatcher, {
  publish: async (invalidation) => {
    if (invalidation.applicationId !== kNexIdentity.applicationId || invalidation.environment !== kNexIdentity.environment) throw new Error("Authorization invalidation identity mismatch.");
  }
}, { onError: () => console.error("K_NEX_AUTHORIZATION_OUTBOX_ERROR") });
worker.start();
console.log("K_NEX_WORKER_READY");
await new Promise<void>((resolve) => {
  const stop = () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); resolve(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
});
worker.stop();
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
    "src/app/(workspace)/sales/[[...path]]/page.tsx": registeredRoutePageSource("sales"),
    "src/app/(workspace)/system/[[...path]]/page.tsx": registeredRoutePageSource("system"),
    "src/app/api/k-nex/inventory/route.ts": inventoryRouteSource(),
    "src/app/api/readiness/route.ts": readinessRouteSource(),
    "src/app/components/login-form.tsx": loginFormSource(),
    "src/app/components/logout-button.tsx": logoutButtonSource(),
    "src/app/components/k-nex-workspace-shell.tsx": shellClientSource(),
    "src/k-nex-authority.ts": authoritySource(),
    "src/k-nex-bootstrap-owner.ts": bootstrapOwnerSource(),
    "src/k-nex-bootstrap-token.ts": bootstrapTokenSource(),
    "src/k-nex-identity.ts": identitySource(options.applicationId),
    "src/k-nex-issue-bootstrap-token.ts": issueTokenSource(),
    "src/k-nex-readiness.ts": readinessCommandSource(),
    "src/k-nex-worker.ts": workerSource(),
    "src/k-nex-users.ts": usersSource(),
    "src/k-nex-workspace-navigation.ts": workspaceNavigationSource()
  };
}
