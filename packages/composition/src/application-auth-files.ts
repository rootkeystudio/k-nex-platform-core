export interface ApplicationAuthFilesOptions {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly theme: "minimal" | "neobrutalism";
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
  createTrustedAuthorizationSession
} from "@k-nex/runtime";
import type { Payload } from "payload";

import { kNexIdentity } from "./k-nex-identity.js";

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
  const catalogProvider = createAuthorizationCatalogProvider(({ applicationId, lifecycleRevision }) => {
    if (applicationId !== kNexIdentity.applicationId) return undefined;
    return {
      applicationId,
      lifecycleRevision,
      catalog: createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision, extensions: [], executables: [] })
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
  const client = await (payload.db.pool as { connect(): Promise<any> }).connect();
  let wrote = false;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([kNexIdentity.applicationId, kNexIdentity.environment, "owner-bootstrap-token"])]);
    const receipt = await client.query("select 1 from k_nex_authorization_bootstrap_receipts where application_id=$1", [kNexIdentity.applicationId]);
    if (receipt.rowCount !== 0) throw new Error("First owner already exists.");
    await client.query("delete from k_nex_owner_bootstrap_tokens where application_id=$1 and environment=$2 and consumed_at is null and expires_at<=now()", [kNexIdentity.applicationId, kNexIdentity.environment]);
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

export async function assertIssuedBootstrapToken(payload: Payload, token: ReturnType<typeof readBootstrapToken>): Promise<void> {
  const result = await (payload.db.pool as { query(text: string, values: unknown[]): Promise<{ rowCount: number }> }).query(
    "select 1 from k_nex_owner_bootstrap_tokens where application_id=$1 and environment=$2 and token_digest=$3 and expires_at=$4 and consumed_at is null and expires_at>now()",
    [kNexIdentity.applicationId, kNexIdentity.environment, token.digest, token.expiresAt]
  );
  if (result.rowCount !== 1) throw new Error("Bootstrap token is unavailable, expired, or consumed.");
}

export async function consumeBootstrapToken(payload: Payload, token: ReturnType<typeof readBootstrapToken>): Promise<void> {
  const result = await (payload.db.pool as { query(text: string, values: unknown[]): Promise<{ rowCount: number }> }).query(
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
import { assertIssuedBootstrapToken, consumeBootstrapToken, readBootstrapToken } from "./k-nex-bootstrap-token.js";
import { kNexAuthority } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";

const email = process.env.K_NEX_OWNER_EMAIL;
const password = process.env.K_NEX_OWNER_PASSWORD;
if (!email || !/^\\S+@\\S+\\.\\S+$/u.test(email) || !password || password.length < 12 || password.length > 128) throw new Error("K_NEX_OWNER_EMAIL and a 12-128 character K_NEX_OWNER_PASSWORD are required.");

const token = readBootstrapToken(process.argv.slice(2));
const payload = await bootKnexApplication("owner-bootstrap");
try {
  const runtime = kNexAuthority(payload);
  if (await runtime.store.readProtectedRoleBaselineReceipt(kNexIdentity.applicationId)) throw new Error("First owner already exists.");
  await assertIssuedBootstrapToken(payload, token);
  const existing = await payload.find({ collection: "users", overrideAccess: true, limit: 2, where: { email: { equals: email } } });
  if (existing.totalDocs > 1) throw new Error("Owner email identity is ambiguous.");
  const user = existing.docs[0] ?? await payload.create({ collection: "users", overrideAccess: true, data: { email, password } });
  if (existing.docs[0]) await payload.login({ collection: "users", data: { email, password } });
  const outcome = await bootstrapFirstOwner({
    store: runtime.store,
    expected: { applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, authorizationRevision: 0, lifecycleRevision: 0 },
    firstOwner: { kind: "user", id: String(user.id) }
  });
  await consumeBootstrapToken(payload, token);
  console.log(\`K_NEX_OWNER_BOOTSTRAP_PASS \${outcome.value.id}\`);
} finally { await payload.destroy(); }
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
  return <main className="workspace-home" data-k-nex-theme-profile={kNexThemePresentation.profileRevisionId}><style>{kNexThemePresentation.cssText}</style><p className="eyebrow">K-Nex workspace</p><h1>${applicationName.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</h1><p>Authenticated workspace ready.</p><LogoutButton /></main>;
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
    "src/app/(workspace)/page.tsx": workspacePageSource(options.applicationName),
    "src/app/api/k-nex/inventory/route.ts": inventoryRouteSource(),
    "src/app/api/readiness/route.ts": readinessRouteSource(),
    "src/app/components/login-form.tsx": loginFormSource(),
    "src/app/components/logout-button.tsx": logoutButtonSource(),
    "src/k-nex-authority.ts": authoritySource(),
    "src/k-nex-bootstrap-owner.ts": bootstrapOwnerSource(),
    "src/k-nex-bootstrap-token.ts": bootstrapTokenSource(),
    "src/k-nex-identity.ts": identitySource(options.applicationId),
    "src/k-nex-issue-bootstrap-token.ts": issueTokenSource(),
    "src/k-nex-readiness.ts": readinessCommandSource(),
    "src/k-nex-worker.ts": workerSource(),
    "src/k-nex-users.ts": usersSource()
  };
}
