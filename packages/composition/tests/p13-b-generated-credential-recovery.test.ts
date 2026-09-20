import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { salesReferenceCompilerBoundary } from "../src/application-factory.js";
import { runnableApplicationFiles } from "../src/runnable-application-files.js";

const generated = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
const runnable = runnableApplicationFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", database: "external", theme: "minimal" });

type Statement = Readonly<{ strings: readonly string[]; values: readonly unknown[] }>;
type UpdateCall = Readonly<{ collection: string; id: string; data: Record<string, unknown>; overrideAccess: boolean }>;
type StoredUser = { id: string; email: string; password: string; sessions: number };
type StoredGrant = { digest: string; expiresAt: string; consumed: boolean };

/**
 * The boundaries the credential journey has to survive, named in the order the
 * one transaction crosses them.
 */
type CredentialBoundary = "credential-locked" | "possession-proved" | "grant-consumed" | "credential-written" | "sessions-revoked" | "audit-written" | "before-commit" | "after-commit";

type Control = {
  users: Map<string, StoredUser>;
  grants: Map<string, StoredGrant>;
  session: string | undefined;
  updates: UpdateCall[];
  audits: Statement[];
  locks: Statement[];
  sessionLocks: Array<{ text: string; values: readonly unknown[] }>;
  unlocks: Array<{ collection: string; email: string; overrideAccess: boolean; openTransactions: number }>;
  sessionLockReleases: boolean[];
  logins: Array<{ email: string; password: string; transactionID: unknown }>;
  hookRefusals: string[];
  transactions: Array<{ id: string; outcome: "open" | "committed" | "rolled-back" }>;
  crossed: CredentialBoundary[];
  fault: ((boundary: CredentialBoundary) => void) | undefined;
};

type AuthorityModule = {
  changeCurrentUserCredentials(payload: unknown, context: unknown, input: unknown): Promise<{ userId: string; auditId: string; changed: readonly string[] }>;
  recoverProtectedOwnerCredential(payload: unknown, receipt: unknown, operatorIdentity: string, grant: unknown, input: unknown): Promise<{ userId: string; auditId: string }>;
  reauthenticateCurrentUser(payload: unknown, context: unknown, password: string): Promise<boolean>;
  withCredentialAuthority<T>(payload: unknown, principal: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
  credentialAuthorityPrincipal(kind: "user" | "email" | "session", value: string): string;
  kNexRequestContext(headers: Headers, boundary: string): { headers: Headers; correlationId: string };
  admittedCredentialChange(userId: string, fields: readonly string[]): boolean;
};

type UsersModule = { usersCollection: { hooks: { beforeChange: Array<(args: Record<string, unknown>) => unknown> } } };

type DelegatedRestCall = Readonly<{ method: string; slug: readonly string[]; body: string | null; authorityHeld: boolean }>;
type RestControl = {
  delegated: DelegatedRestCall[];
  statements: Array<{ text: string; values: readonly unknown[] }>;
  lookups: Array<{ kind: "find" | "auth"; email?: unknown }>;
  boots: string[];
  connects: number;
  releases: boolean[];
  authorityHeld: boolean;
};

type RestModule = { POST(request: Request, context: { params: Promise<{ slug?: string[] }> }): Promise<Response> };

let directory: string;
let authority: AuthorityModule;
let users: UsersModule;
let rest: RestModule;

function control(): Control {
  return (globalThis as typeof globalThis & { __kNexGeneratedCredentials: Control }).__kNexGeneratedCredentials;
}

function restControl(): RestControl {
  return (globalThis as typeof globalThis & { __kNexGeneratedRest: RestControl }).__kNexGeneratedRest;
}

/** Delegates to the generated Payload REST route, with the slug Next would have parsed. */
function restPost(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, "https://alpha.example.test");
  const slug = url.pathname.replace(/^\/api\//u, "").split("/");
  return rest.POST(new Request(url, { method: "POST", ...init }), { params: Promise.resolve({ slug }) });
}

const grantDigest = "sha256:" + "a".repeat(64);
const grantExpiresAt = "2999-01-01T00:00:00.000Z";

function statementText(statement: Statement): string {
  return statement.strings.join(" ? ");
}

/**
 * A transaction that behaves like one: nothing a statement or a record write
 * stages is visible anywhere until the commit, and a rollback discards all of
 * it. Anything this double cannot attribute to a transaction never lands, which
 * is how a credential statement that escaped the boundary would be caught.
 */
function payloadDouble(): Record<string, unknown> {
  // The adapter keeps its open transactions in a plain record keyed by id, and
  // the session lookup reads it that way.
  const sessions: Record<string, { db: { execute(statement: Statement): Promise<{ rowCount: number }> } }> = {};
  const staged = new Map<string, Array<() => void>>();
  const cross = (boundary: CredentialBoundary): void => {
    control().crossed.push(boundary);
    control().fault?.(boundary);
  };
  const openTransaction = (id: unknown): Array<() => void> => {
    const effects = staged.get(String(id));
    if (effects === undefined) throw new Error("A credential write escaped its transaction.");
    return effects;
  };
  const settle = (id: unknown, outcome: "committed" | "rolled-back"): void => {
    const key = String(id);
    const effects = staged.get(key);
    if (effects === undefined) return;
    staged.delete(key);
    delete sessions[key];
    const record = control().transactions.find((entry) => entry.id === key);
    if (record !== undefined) record.outcome = outcome;
    if (outcome === "committed") for (const effect of effects) effect();
  };
  return {
    db: {
      sessions,
      // The session-level half of the authority, which everything that proves a
      // credential holds for the whole of its operation.
      pool: {
        options: { max: 10 },
        async connect() {
          return {
            async query(text: string, values?: readonly unknown[]) {
              control().sessionLocks.push(Object.freeze({ text, values: Object.freeze([...(values ?? [])]) }));
              return { rowCount: 1 };
            },
            release(destroy?: boolean) { control().sessionLockReleases.push(destroy === true); }
          };
        }
      },
      async beginTransaction() {
        const id = "credential-transaction-" + String(control().transactions.length + 1);
        const effects: Array<() => void> = [];
        staged.set(id, effects);
        control().transactions.push({ id, outcome: "open" });
        sessions[id] = {
          db: {
            async execute(statement: Statement) {
              const text = statementText(statement);
              if (text.includes("pg_advisory_xact_lock")) {
                control().locks.push(statement);
                cross("credential-locked");
                return { rowCount: 1 };
              }
              if (text.includes("update k_nex_owner_bootstrap_tokens")) {
                const grant = control().grants.get(String(statement.values[2]));
                if (grant === undefined || grant.consumed || grant.expiresAt !== statement.values[3]) return { rowCount: 0 };
                effects.push(() => { grant.consumed = true; });
                cross("grant-consumed");
                return { rowCount: 1 };
              }
              if (!text.includes("insert into k_nex_authorization_audit")) throw new Error("Unexpected credential statement: " + text);
              effects.push(() => control().audits.push(statement));
              cross("audit-written");
              return { rowCount: 1 };
            }
          }
        };
        return id;
      },
      async commitTransaction(id: unknown) { cross("before-commit"); settle(id, "committed"); cross("after-commit"); },
      async rollbackTransaction(id: unknown) { settle(id, "rolled-back"); }
    },
    async auth() {
      const id = control().session;
      const user = id === undefined ? undefined : control().users.get(id);
      return { user: user === undefined ? null : { id: user.id, email: user.email, collection: "users" } };
    },
    // Payload's login opens a durable session on the user it verified. Handed a
    // transaction it joins that unit of work; handed none it commits on its
    // own, which is exactly the side effect a refused change must not leave.
    async login({ data, req }: { data: { email: string; password: string }; req?: { transactionID?: unknown } }) {
      control().logins.push({ ...data, transactionID: req?.transactionID });
      const match = [...control().users.values()].find((user) => user.email === data.email && user.password === data.password);
      if (match === undefined) throw new Error("invalid credentials");
      const open = req?.transactionID === undefined ? undefined : staged.get(String(req.transactionID));
      if (open === undefined) match.sessions += 1; else open.push(() => { match.sessions += 1; });
      cross("possession-proved");
      return { user: { id: match.id, email: match.email, collection: "users" } };
    },
    // Payload's own reset of the failed-attempt count, which a rolled-back
    // proof would otherwise have discarded along with the session it opened.
    async unlock(call: { collection: string; data: { email?: string }; overrideAccess: boolean }) {
      control().unlocks.push({ collection: call.collection, email: String(call.data.email), overrideAccess: call.overrideAccess, openTransactions: staged.size });
      return true;
    },
    async find({ where, req }: { where: { email: { equals: string } }; req?: { transactionID?: unknown } }) {
      openTransaction(req?.transactionID);
      return { docs: [...control().users.values()].filter((user) => user.email === where.email.equals).map(({ id }) => ({ id })) };
    },
    async findByID({ id, req }: { id: string; req?: { transactionID?: unknown } }) {
      openTransaction(req?.transactionID);
      const user = control().users.get(String(id));
      return user === undefined ? null : { id: user.id, email: user.email };
    },
    async update(call: UpdateCall & { req?: { transactionID?: unknown } }) {
      control().updates.push(call);
      const effects = openTransaction(call.req?.transactionID);
      const hook = users.usersCollection.hooks.beforeChange[0]!;
      const stored = control().users.get(String(call.id));
      // Payload merges the stored document into data before beforeChange runs.
      try { hook({ data: { ...(stored === undefined ? {} : { email: stored.email }), ...call.data }, operation: "update", originalDoc: stored === undefined ? undefined : { id: stored.id, email: stored.email } }); }
      catch (error) { control().hookRefusals.push((error as Error).message); throw error; }
      // The credential columns and the session rows are two statements of the
      // same Payload write, which is where a partial credential change would
      // otherwise become visible.
      if (stored !== undefined) {
        effects.push(() => {
          if (typeof call.data.email === "string") stored.email = call.data.email;
          if (typeof call.data.password === "string") stored.password = call.data.password;
        });
        cross("credential-written");
        if (Array.isArray(call.data.sessions) && call.data.sessions.length === 0) effects.push(() => { stored.sessions = 0; });
        cross("sessions-revoked");
      }
      return { id: call.id };
    }
  };
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "k-nex-credential-recovery-"));
  const contracts = import.meta.resolve("@k-nex/contracts");
  writeFileSync(join(directory, "stubs.mjs"), `
const control = () => globalThis.__kNexGeneratedCredentials;
export { AuthorizationDecisionAuditSchema, canonicalJson } from ${JSON.stringify(contracts)};
export const kNexIdentity = Object.freeze({ applicationId: "customer-alpha", environment: "production", publicOrigin: new URL("https://alpha.example.test/") });
export class PostgresAuthorizationStore {
  async readState() { return { applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 2 }; }
}
export class CurrentAuthorityAdapter {}
export class EffectiveAuthorityResolver {}
export const createAuthorizationCatalogProvider = () => undefined;
export const createCurrentAuthorityTarget = () => undefined;
export const createEffectiveAuthorizationRequest = () => undefined;
export const createEffectiveAuthorizationCatalog = () => undefined;
export const createPlatformPluginPolicyExecutable = () => undefined;
export const createPlatformPluginRegistrationAuthorizationContribution = () => undefined;
export const createTrustedAuthorizationSession = () => undefined;
export const platformPermissionDescriptors = Object.freeze([]);
export const kNexSalesRegistry = Object.freeze({ policyBindings: [], policyExecutors: {} });
export const authorizePayloadUser = async () => { control(); return false; };
export const sql = (strings, ...values) => Object.freeze({ strings: Object.freeze([...strings]), values: Object.freeze(values) });
// The adapter's own session lookup, so a credential statement that escapes the
// transaction Payload is carrying is a failure here too.
export async function activePayloadPostgresTransaction(req) {
  const transactionId = await req.transactionID;
  if (transactionId === undefined || transactionId === null) throw new Error("An active Payload transaction is required.");
  const session = req.payload.db.sessions?.[String(transactionId)];
  if (session?.db === undefined || session.db === null) throw new Error("An active Postgres transaction session from Payload is required.");
  return session.db;
}
`);
  const authoritySource = generated["src/k-nex-authority.ts"]!
    .replace('import { AuthorizationDecisionAuditSchema, canonicalJson } from "@k-nex/contracts";', 'import { AuthorizationDecisionAuditSchema, canonicalJson } from "./stubs.mjs";')
    .replace(/import \{ PostgresAuthorizationStore,[^;]+from "@k-nex\/payload-adapter";/u, 'import { PostgresAuthorizationStore, activePayloadPostgresTransaction } from "./stubs.mjs";')
    .replace(/import \{\n(?:[^;]+)\n\} from "@k-nex\/runtime";/u, 'import { CurrentAuthorityAdapter, EffectiveAuthorityResolver, createAuthorizationCatalogProvider, createCurrentAuthorityTarget, createEffectiveAuthorizationRequest, createEffectiveAuthorizationCatalog, createPlatformPluginPolicyExecutable, createPlatformPluginRegistrationAuthorizationContribution, createTrustedAuthorizationSession, platformPermissionDescriptors } from "./stubs.mjs";')
    .replace('import { sql } from "@payloadcms/db-postgres";', 'import { sql } from "./stubs.mjs";')
    .replace('import { kNexIdentity } from "./k-nex-identity.js";', 'import { kNexIdentity } from "./stubs.mjs";')
    .replace('import { kNexSalesRegistry } from "./k-nex-registry.js";', 'import { kNexSalesRegistry } from "./stubs.mjs";');
  expect(authoritySource).not.toMatch(/@k-nex\/|@payloadcms\//u);
  writeFileSync(join(directory, "authority.mjs"), ts.transpileModule(authoritySource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText);
  const usersSource = generated["src/k-nex-users.ts"]!
    .replace('import { admittedCredentialChange, authorizePayloadUser } from "./k-nex-authority.js";', 'import { admittedCredentialChange } from "./authority.mjs";\nimport { authorizePayloadUser } from "./stubs.mjs";')
    .replace('import { kNexIdentity } from "./k-nex-identity.js";', 'import { kNexIdentity } from "./stubs.mjs";');
  writeFileSync(join(directory, "users.mjs"), ts.transpileModule(usersSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText);
  // Payload's own REST surface and the application boot the generated route
  // imports, recorded so the delegated call can be placed against the authority.
  writeFileSync(join(directory, "rest-stubs.mjs"), `
const control = () => globalThis.__kNexGeneratedRest;
export default Object.freeze({ kind: "sanitized-payload-config" });
const delegate = (method) => () => async (request, args) => {
  const params = await args.params;
  control().delegated.push(Object.freeze({
    method, slug: Object.freeze([...(params.slug ?? [])]),
    body: request.body === null ? null : await request.text(),
    authorityHeld: control().authorityHeld
  }));
  return Response.json({ delegated: method });
};
export const REST_GET = delegate("GET");
export const REST_POST = delegate("POST");
export const REST_DELETE = delegate("DELETE");
export const REST_PATCH = delegate("PATCH");
export const REST_PUT = delegate("PUT");
export const REST_OPTIONS = delegate("OPTIONS");
export async function bootKnexApplication(key) {
  control().boots.push(key);
  // The principal a sign-in or a refresh is deciding about is resolved out of
  // the same users the credential journeys are proved against, so the key one
  // takes can be compared with the key the other takes.
  const credentials = () => globalThis.__kNexGeneratedCredentials;
  return {
    db: {
      pool: {
        options: { max: 10 },
        async connect() {
          control().connects += 1;
          return {
            async query(text, values) {
              control().statements.push(Object.freeze({ text, values: Object.freeze([...(values ?? [])]) }));
              if (text.includes("pg_advisory_lock")) control().authorityHeld = true;
              if (text.includes("pg_advisory_unlock")) control().authorityHeld = false;
              return { rowCount: 1 };
            },
            release(destroy) { control().releases.push(destroy === true); }
          };
        }
      }
    },
    async find({ where }) {
      control().lookups.push(Object.freeze({ kind: "find", email: where?.email?.equals }));
      return { docs: [...credentials().users.values()].filter((user) => user.email === where?.email?.equals).map(({ id }) => ({ id })) };
    },
    async auth() {
      control().lookups.push(Object.freeze({ kind: "auth" }));
      const id = credentials().session;
      const user = id === undefined ? undefined : credentials().users.get(id);
      return { user: user === undefined ? null : { id: user.id, email: user.email, collection: "users" } };
    }
  };
}
`);
  const restSource = runnable["src/app/(payload)/api/[...slug]/route.ts"]!
    .replace('import config from "@payload-config";', 'import config from "./rest-stubs.mjs";')
    .replace(/import \{ REST_DELETE,[^;]+from "@payloadcms\/next\/routes";/u, 'import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from "./rest-stubs.mjs";')
    .replaceAll('"../../../../boot.js"', '"./rest-stubs.mjs"')
    .replaceAll('"../../../../k-nex-authority.js"', '"./authority.mjs"');
  expect(restSource).not.toMatch(/@payload-config|@payloadcms\//u);
  writeFileSync(join(directory, "rest.mjs"), ts.transpileModule(restSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText);
  // One entry point, so the collection hook, the generated REST route and the
  // assertions observe the same authority module instance rather than three
  // loaders' copies of it.
  writeFileSync(join(directory, "probe.mjs"), 'export { admittedCredentialChange, changeCurrentUserCredentials, credentialAuthorityPrincipal, kNexRequestContext, reauthenticateCurrentUser, recoverProtectedOwnerCredential, withCredentialAuthority } from "./authority.mjs";\nexport { usersCollection } from "./users.mjs";\nexport * as rest from "./rest.mjs";\n');
  const probe = await import(pathToFileURL(join(directory, "probe.mjs")).href) as AuthorityModule & UsersModule & { rest: RestModule };
  authority = probe;
  users = probe;
  rest = probe.rest;
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  (globalThis as typeof globalThis & { __kNexGeneratedCredentials: Control }).__kNexGeneratedCredentials = {
    users: new Map([
      ["1", { id: "1", email: "owner@alpha.example.test", password: "owner-password-1234", sessions: 3 }],
      ["2", { id: "2", email: "second@alpha.example.test", password: "second-password-1234", sessions: 1 }]
    ]),
    grants: new Map([[grantDigest, { digest: grantDigest, expiresAt: grantExpiresAt, consumed: false }]]),
    session: "1", updates: [], audits: [], locks: [], sessionLocks: [], sessionLockReleases: [], unlocks: [], logins: [], hookRefusals: [], transactions: [], crossed: [], fault: undefined
  };
  (globalThis as typeof globalThis & { __kNexGeneratedRest: RestControl }).__kNexGeneratedRest = {
    delegated: [], statements: [], lookups: [], boots: [], connects: 0, releases: [], authorityHeld: false
  };
});

function context(): { headers: Headers; correlationId: string } {
  return authority.kNexRequestContext(new Headers({ cookie: "payload-token=alpha" }), "credential-change");
}

function auditValue(index = 0): Record<string, unknown> {
  const row = control().audits[index]!;
  expect(statementText(row)).toContain("insert into k_nex_authorization_audit");
  return JSON.parse(String(row.values[5])) as Record<string, unknown>;
}

function grant(): { digest: string; expiresAt: string } {
  return { digest: grantDigest, expiresAt: grantExpiresAt };
}

/** Fails the journey exactly once, the first time it crosses the named boundary. */
function failAt(boundary: CredentialBoundary, message = "injected " + boundary + " failure"): void {
  let fired = false;
  control().fault = (crossed) => {
    if (crossed !== boundary || fired) return;
    fired = true;
    throw new Error(message);
  };
}

function ownerState(): Readonly<{ email: string; password: string; sessions: number; audits: number; grantConsumed: boolean }> {
  const owner = control().users.get("1")!;
  return Object.freeze({ email: owner.email, password: owner.password, sessions: owner.sessions, audits: control().audits.length, grantConsumed: control().grants.get(grantDigest)!.consumed });
}

it("refuses a sign-in credential rewritten through an ordinary record update", () => {
  const hook = users.usersCollection.hooks.beforeChange[0]!;
  const stored = { id: "1", email: "owner@alpha.example.test" };
  expect(authority.admittedCredentialChange("1", ["password"])).toBe(false);
  expect(() => hook({ data: { ...stored, password: "attacker-password-1" }, operation: "update", originalDoc: stored })).toThrow("Sign-in credentials cannot be changed through a record update.");
  expect(() => hook({ data: { ...stored, email: "attacker@alpha.example.test" }, operation: "update", originalDoc: stored })).toThrow("Sign-in credentials cannot be changed through a record update.");
  // Payload merges the stored document in, so the unchanged email that arrives
  // on every ordinary update is not a credential change.
  expect(hook({ data: { ...stored, sessions: [] }, operation: "update", originalDoc: stored })).toEqual({ ...stored, sessions: [] });
});

it("refuses a credential change without the current password, and never writes", async () => {
  await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { password: "brand-new-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_INPUT_INVALID" });
  await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "wrong-password", password: "brand-new-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_REAUTHENTICATION_REQUIRED" });
  expect(control().updates).toEqual([]);
  expect(control().audits).toEqual([]);
  expect(control().users.get("1")!.password).toBe("owner-password-1234");
});

it("refuses a credential change with no session, a reused password, and a taken email", async () => {
  control().session = undefined;
  await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", password: "brand-new-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_SESSION_REQUIRED" });
  control().session = "1";
  await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", password: "owner-password-1234" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_INPUT_INVALID" });
  await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", email: "second@alpha.example.test" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_EMAIL_TAKEN" });
  await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", password: "new", extra: 1 }))
    .rejects.toMatchObject({ code: "CREDENTIAL_INPUT_INVALID" });
  expect(control().updates).toEqual([]);
});

/**
 * The finding this closes: a change that moves only the email leaves the
 * password working, so a second caller holding the same password proved it
 * happily after the first had already revoked its session. Possession is not a
 * substitute for the session requirement once something has cut the caller off.
 */
it("refuses a self-service credential change whose session was revoked while it waited for the authority", async () => {
  const before = ownerState();
  // Revoked after this journey authenticated and after it proved the password,
  // which is where a competing email-only change that committed first leaves it.
  control().fault = (boundary) => { if (boundary === "possession-proved") control().session = undefined; };
  await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", email: "moved@alpha.example.test" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_SESSION_REQUIRED" });
  expect(control().crossed).toEqual(["credential-locked", "possession-proved"]);
  expect(control().transactions.map(({ outcome }) => outcome)).toEqual(["rolled-back"]);
  expect(control().updates).toEqual([]);
  expect(control().audits).toEqual([]);
  expect(ownerState()).toEqual(before);
});

it("admits an email-only credential change while the caller's session is still live", async () => {
  const result = await authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", email: "moved@alpha.example.test" });
  expect([...result.changed]).toEqual(["email"]);
  expect(control().updates[0]!.data).toEqual({ email: "moved@alpha.example.test", sessions: [] });
  expect(ownerState()).toMatchObject({ email: "moved@alpha.example.test", password: "owner-password-1234", sessions: 0 });
  expect(control().audits).toHaveLength(1);
});

it("changes a credential after the current password, revokes every session, and audits the change", async () => {
  const result = await authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", email: "renamed@alpha.example.test", password: "brand-new-password-1" });
  expect(result.userId).toBe("1");
  expect([...result.changed]).toEqual(["email", "password"]);
  expect(control().logins).toEqual([{ email: "owner@alpha.example.test", password: "owner-password-1234", transactionID: "credential-transaction-1" }]);
  expect(control().updates).toHaveLength(1);
  expect(control().updates[0]).toMatchObject({ collection: "users", id: "1", overrideAccess: true });
  expect(control().updates[0]!.data).toEqual({ email: "renamed@alpha.example.test", password: "brand-new-password-1", sessions: [] });
  expect(control().hookRefusals).toEqual([]);
  // The session the proof opened is cleared by the same write, so a change that
  // committed nets no new session either.
  expect(ownerState().sessions).toBe(0);
  expect(auditValue()).toMatchObject({
    auditId: result.auditId, operation: "credential-change", target: "1",
    principal: { kind: "user", id: "1" }, effectiveActor: { kind: "user", id: "1" },
    outcome: "allow", reason: "granted", reauthentication: "satisfied",
    authorizationRevision: 4, lifecycleRevision: 2
  });
  // The admission is spent with the call that opened it.
  expect(authority.admittedCredentialChange("1", ["password"])).toBe(false);
});

it("admits a credential write only for the principal and fields the journey named", async () => {
  const hook = users.usersCollection.hooks.beforeChange[0]!;
  const payload = payloadDouble();
  (payload as { update: unknown }).update = async (call: UpdateCall) => {
    control().updates.push(call);
    expect(authority.admittedCredentialChange("1", ["password"])).toBe(true);
    expect(authority.admittedCredentialChange("2", ["password"])).toBe(false);
    expect(authority.admittedCredentialChange("1", ["email"])).toBe(false);
    expect(authority.admittedCredentialChange("1", [])).toBe(false);
    expect(() => hook({ data: { email: "elsewhere@alpha.example.test" }, operation: "update", originalDoc: { id: "1", email: "owner@alpha.example.test" } })).toThrow("Sign-in credentials cannot be changed through a record update.");
    expect(() => hook({ data: { password: "another-password-12" }, operation: "update", originalDoc: { id: "2", email: "second@alpha.example.test" } })).toThrow("Sign-in credentials cannot be changed through a record update.");
    return { id: call.id };
  };
  await authority.changeCurrentUserCredentials(payload, context(), { currentPassword: "owner-password-1234", password: "brand-new-password-1" });
  expect(control().updates).toHaveLength(1);
});

it("recovers the owner credential only against a committed receipt, and audits the operator as the actor", async () => {
  const receipt = { state: "committed", ownerPrincipal: { kind: "user", id: "1" } };
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), { state: "pending", ownerPrincipal: { kind: "user", id: "1" } }, "fixture.p13-operator", grant(), { email: "recovered@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_RECOVERY_TARGET_INVALID" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), { state: "committed", ownerPrincipal: { kind: "service", id: "1" } }, "fixture.p13-operator", grant(), { email: "recovered@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_RECOVERY_TARGET_INVALID" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), { state: "committed", ownerPrincipal: { kind: "user", id: "404" } }, "fixture.p13-operator", grant(), { email: "recovered@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_RECOVERY_TARGET_INVALID" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", grant(), { email: "second@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_EMAIL_TAKEN" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", grant(), { password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_INPUT_INVALID" });
  // A grant this deployment never issued is refused before anything is spent.
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", { digest: "sha256:" + "b".repeat(64), expiresAt: grantExpiresAt }, { email: "recovered@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_RECOVERY_GRANT_UNAVAILABLE" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", { digest: "not-a-digest", expiresAt: grantExpiresAt }, { email: "recovered@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_RECOVERY_GRANT_UNAVAILABLE" });
  expect(control().updates).toEqual([]);
  expect(ownerState()).toMatchObject({ email: "owner@alpha.example.test", password: "owner-password-1234", audits: 0, grantConsumed: false });
  // A missing target, a taken email and an unissued grant are all decided
  // behind the lock and write nothing; the rest never reach the database.
  expect(control().crossed).toEqual(["credential-locked", "credential-locked", "credential-locked"]);
  expect(control().transactions.every(({ outcome }) => outcome === "rolled-back")).toBe(true);
  control().crossed.length = 0;

  const recovered = await authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", grant(), { email: "recovered@alpha.example.test", password: "recovered-password-1" });
  expect(recovered.userId).toBe("1");
  // Recovery never asks for, and never checks, the lost password.
  expect(control().logins).toEqual([]);
  expect(control().updates[0]!.data).toEqual({ email: "recovered@alpha.example.test", password: "recovered-password-1", sessions: [] });
  // The grant is spent on the transaction that moved the credential, not before
  // it, and it is spent behind the same lock a self-service change takes.
  expect(control().crossed).toEqual(["credential-locked", "grant-consumed", "credential-written", "sessions-revoked", "audit-written", "before-commit", "after-commit"]);
  expect(ownerState()).toEqual({ email: "recovered@alpha.example.test", password: "recovered-password-1", sessions: 0, audits: 1, grantConsumed: true });
  expect(auditValue()).toMatchObject({
    auditId: recovered.auditId, operation: "owner-credential-recovery", target: "1",
    principal: { kind: "service", id: "fixture.p13-operator" }, effectiveActor: { kind: "service", id: "fixture.p13-operator" },
    outcome: "allow", reason: "granted", reauthentication: "satisfied"
  });
});

it("refuses to replay a spent recovery grant, and leaves the credential where the first recovery put it", async () => {
  const receipt = { state: "committed", ownerPrincipal: { kind: "user", id: "1" } };
  await authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", grant(), { email: "recovered@alpha.example.test", password: "recovered-password-1" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", grant(), { email: "replayed@alpha.example.test", password: "replayed-password-12" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_RECOVERY_GRANT_UNAVAILABLE" });
  expect(ownerState()).toEqual({ email: "recovered@alpha.example.test", password: "recovered-password-1", sessions: 0, audits: 1, grantConsumed: true });
  expect(control().transactions.map(({ outcome }) => outcome)).toEqual(["committed", "rolled-back"]);
});

/**
 * The finding this closes: a credential that has moved with no audit, or a
 * recovery grant spent on a credential that never moved. Every boundary the one
 * transaction crosses is failed in turn, and the only two outcomes allowed are
 * "nothing happened" and "everything happened, exactly once".
 */
for (const boundary of ["credential-locked", "credential-written", "sessions-revoked", "audit-written", "before-commit"] as const) {
  it(`rolls back the whole credential journey when it fails at ${boundary}`, async () => {
    const before = ownerState();
    failAt(boundary);
    await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", email: "renamed@alpha.example.test", password: "brand-new-password-1" }))
      .rejects.toThrow("injected " + boundary + " failure");
    expect(ownerState()).toEqual(before);
    expect(control().transactions.map(({ outcome }) => outcome)).toEqual(["rolled-back"]);
  });
}

for (const boundary of ["credential-locked", "grant-consumed", "credential-written", "sessions-revoked", "audit-written", "before-commit"] as const) {
  it(`rolls back the whole owner recovery when it fails at ${boundary}`, async () => {
    const before = ownerState();
    failAt(boundary);
    await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), { state: "committed", ownerPrincipal: { kind: "user", id: "1" } }, "fixture.p13-operator", grant(), { email: "recovered@alpha.example.test", password: "recovered-password-1" }))
      .rejects.toThrow("injected " + boundary + " failure");
    // Every failure after the grant statement still leaves the grant unspent,
    // so the operator's one-shot token is not the price of a failed recovery.
    expect(ownerState()).toEqual(before);
    expect(ownerState().grantConsumed).toBe(false);
    expect(control().transactions.map(({ outcome }) => outcome)).toEqual(["rolled-back"]);
  });
}

it("leaves one changed credential and exactly one audit when the caller dies after the commit", async () => {
  failAt("after-commit");
  // The response never arrives; the database is the only thing that decides.
  await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", password: "brand-new-password-1" }))
    .rejects.toThrow("injected after-commit failure");
  expect(ownerState()).toMatchObject({ email: "owner@alpha.example.test", password: "brand-new-password-1", sessions: 0, audits: 1 });
  expect(control().transactions.map(({ outcome }) => outcome)).toEqual(["committed"]);
  expect(auditValue()).toMatchObject({ operation: "credential-change", target: "1" });
});

it("changes a credential and writes its audit on one transaction, never on the pool", async () => {
  const payload = payloadDouble();
  (payload as { db: Record<string, unknown> }).db.pool = { query() { throw new Error("A credential change must not write outside its transaction."); } };
  const result = await authority.changeCurrentUserCredentials(payload, context(), { currentPassword: "owner-password-1234", password: "brand-new-password-1" });
  expect(control().crossed).toEqual(["credential-locked", "possession-proved", "credential-written", "sessions-revoked", "audit-written", "before-commit", "after-commit"]);
  expect(control().transactions).toEqual([{ id: "credential-transaction-1", outcome: "committed" }]);
  expect((control().updates[0] as { req?: { transactionID?: unknown } }).req?.transactionID).toBe("credential-transaction-1");
  // Self-service never touches a recovery grant.
  expect(ownerState().grantConsumed).toBe(false);
  expect(auditValue()).toMatchObject({ auditId: result.auditId });
});

/**
 * The finding this closes: the password proof was a login of its own, so a
 * correct password whose change was then refused still left a committed session
 * behind, and the proof was captured before the transaction that spends it.
 */
it("proves the current password on the credential transaction and leaves no session behind when the change is refused", async () => {
  const before = ownerState();
  await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", email: "second@alpha.example.test" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_EMAIL_TAKEN" });
  expect(control().logins).toEqual([{ email: "owner@alpha.example.test", password: "owner-password-1234", transactionID: "credential-transaction-1" }]);
  // The proof ran behind the lock and on the transaction, so the session it
  // opened went back with everything else the refusal discarded.
  expect(control().crossed).toEqual(["credential-locked", "possession-proved"]);
  expect(control().transactions.map(({ outcome }) => outcome)).toEqual(["rolled-back"]);
  expect(control().updates).toEqual([]);
  expect(ownerState()).toEqual(before);
  expect(ownerState().sessions).toBe(3);
});

it("takes one credential authority per principal on every credential path before it reads, proves, or writes anything", async () => {
  await authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", password: "brand-new-password-1" });
  const selfService = control().locks.map(({ values }) => [...values]);
  expect(selfService).toHaveLength(1);
  expect(control().crossed[0]).toBe("credential-locked");

  control().locks.length = 0;
  control().crossed.length = 0;
  // Recovery rewrites the sign-in identity, so it takes the key on the user id
  // rather than on the address: the same key a self-service change for that
  // principal takes, which is what stops a proof captured before a recovery
  // from committing after it.
  await authority.recoverProtectedOwnerCredential(payloadDouble(), { state: "committed", ownerPrincipal: { kind: "user", id: "1" } }, "fixture.p13-operator", grant(), { email: "recovered@alpha.example.test", password: "recovered-password-1" });
  expect(control().crossed[0]).toBe("credential-locked");
  expect(control().locks.map(({ values }) => [...values])).toEqual(selfService);

  // Another principal is another key. One key for the whole application made
  // every sign-in in the product queue behind every other one, which is a
  // denial-of-service boundary an unauthenticated caller could reach.
  control().session = "2";
  control().locks.length = 0;
  await authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "second-password-1234", password: "second-new-password-1" });
  const second = control().locks.map(({ values }) => [...values]);
  expect(second).toHaveLength(1);
  expect(second[0]![0]).toBe(selfService[0]![0]);
  expect(second[0]![1]).not.toBe(selfService[0]![1]);
});

/**
 * The finding this closes: the generated application serves Payload's own
 * sign-in through this route, and Payload verifies a password before it opens
 * the transaction that writes the session. A lock around the credential writers
 * alone therefore left the whole of a sign-in outside the ordering, so one
 * authenticated against a replaced credential could still commit its session,
 * and the stale user fields it was built from, after the replacement.
 */
it("holds the credential authority across the whole delegated Payload sign-in", async () => {
  const body = JSON.stringify({ email: "owner@alpha.example.test", password: "owner-password-1234" });
  const response = await restPost("/api/users/login", { headers: { "content-type": "application/json" }, body });
  expect(response.status).toBe(200);
  expect(restControl().boots).toEqual(["credential-authority"]);
  expect(restControl().delegated).toEqual([{ method: "POST", slug: ["users", "login"], body, authorityHeld: true }]);
  // Acquired before the delegated call and released only after it answered, so
  // a credential change waits for the sign-in it would otherwise overtake. The
  // lock wait is bounded by a statement timeout the connection does not keep.
  expect(restControl().statements.map(({ text }) => text)).toEqual([
    "select set_config('statement_timeout',$1,false)",
    "select pg_advisory_lock($1,$2)",
    "select set_config('statement_timeout','0',false)",
    "select pg_advisory_unlock($1,$2)"
  ]);
  expect(restControl().authorityHeld).toBe(false);
  // The connection goes back to the pool: it is only destroyed when the unlock
  // could not be confirmed or the lock bound was never handed back.
  expect(restControl().releases).toEqual([false]);

  // The sign-in named its principal by the address in its body, so it is the
  // same key the credential transaction for that user takes. Two different keys
  // would serialize nothing.
  expect(restControl().lookups).toEqual([{ kind: "find", email: "owner@alpha.example.test" }]);
  const authorityValues = restControl().statements[1]!.values;
  await authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", password: "brand-new-password-1" });
  expect(control().locks.map(({ values }) => [...values])).toEqual([[...authorityValues]]);
});

/**
 * The finding this closes: one key for the whole application meant a complete,
 * unauthenticated sign-in request for any address queued every other sign-in,
 * every credential change and the operator recovery behind it.
 */
it("takes the credential authority on the account a sign-in names, and on a key of its own when the address is unknown", async () => {
  const signIn = async (email: string) => {
    restControl().statements.length = 0;
    const response = await restPost("/api/users/login", { headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "whatever-1234" }) });
    expect(response.status).toBe(200);
    const lock = restControl().statements.find(({ text }) => text.includes("pg_advisory_lock"));
    expect(lock).toBeDefined();
    return [...lock!.values] as [number, number];
  };
  const owner = await signIn("owner@alpha.example.test");
  const second = await signIn("second@alpha.example.test");
  // Payload lowercases and trims before it resolves a sign-in, so the key has
  // to be taken on the address the delegated call will actually look up.
  const shouted = await signIn("  OWNER@Alpha.Example.Test ");
  const unknown = await signIn("nobody@alpha.example.test");
  const alsoUnknown = await signIn("someone-else@alpha.example.test");

  expect(owner).toEqual(shouted);
  expect(owner[0]).toBe(second[0]);
  expect(new Set([owner[1], second[1], unknown[1], alsoUnknown[1]]).size).toBe(4);
  // An address nobody holds is queued and locked exactly like one somebody
  // does, so how a request is treated here never says which addresses exist.
  expect(restControl().delegated).toHaveLength(5);
  expect(restControl().delegated.every(({ authorityHeld }) => authorityHeld)).toBe(true);
});

it("serializes every Payload auth operation that mints a session, refuses the ones this product does not admit, and touches nothing else", async () => {
  for (const operation of ["login", "refresh-token"]) {
    await restPost(`/api/users/${operation}`, { headers: { "content-type": "application/json" }, body: "{}" });
  }
  expect(restControl().connects).toBe(2);
  expect(restControl().delegated.every(({ authorityHeld }) => authorityHeld)).toBe(true);
  // A sign-in with no address to resolve is still locked, on the key that
  // absence of an address gets; a refresh has no address at all, so its
  // principal comes from the session it presents.
  expect(restControl().lookups).toEqual([{ kind: "auth" }]);

  // A logout, an ordinary collection write and another collection's login-like
  // path are delegated untouched: serializing them would buy nothing and cost
  // every request for that account.
  for (const path of ["/api/users/logout", "/api/users", "/api/users/login/extra", "/api/sales-accounts/login"]) {
    await restPost(path, { headers: { "content-type": "application/json" }, body: "{}" });
  }
  expect(restControl().connects).toBe(2);
  expect(restControl().delegated.slice(2).every(({ authorityHeld }) => authorityHeld)).toBe(false);
  expect(restControl().delegated).toHaveLength(6);

  // Payload's own password reset writes the credential straight through the
  // database adapter, so the admission on the users collection never sees it,
  // and first-register creates an account with access overridden and logs it
  // straight in, outside the operator token, the receipt, the owner assignment
  // and the audit. Ordering a write that answers to nothing only makes it
  // punctual, so all three are refused instead.
  const refusals = new Map([
    ["first-register", "The first owner is created by the operator bootstrap command, not by registration."],
    ["forgot-password", "Credentials are issued by the operator recovery command, not by a password reset."],
    ["reset-password", "Credentials are issued by the operator recovery command, not by a password reset."]
  ]);
  for (const [operation, message] of refusals) {
    const refused = await restPost(`/api/users/${operation}`, { headers: { "content-type": "application/json" }, body: "{}" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ errors: [{ message }] });
  }
  expect(restControl().connects).toBe(2);
  expect(restControl().delegated).toHaveLength(6);
});

it("refuses a sign-in body past the credential bound before it can hold the authority", async () => {
  const response = await restPost("/api/users/login", {
    headers: { "content-type": "application/json", "content-length": "16385" },
    body: JSON.stringify({ email: "owner@alpha.example.test", password: "x".repeat(200) })
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ errors: [{ message: "Request body was refused." }] });
  // Nothing was delegated and nothing was locked, so a body that trickles can
  // never hold every sign-in and every credential change behind it.
  expect(restControl().delegated).toEqual([]);
  expect(restControl().connects).toBe(0);
  expect(restControl().statements).toEqual([]);
});

/**
 * The finding this closes: reauthentication proved the password with a login of
 * its own outside any transaction, so every settings and theme confirmation
 * left a live session behind that nobody held a token for.
 */
it("proves a reauthentication on a transaction that is always rolled back, and leaves the sessions byte-identical", async () => {
  const payload = payloadDouble();
  const before = ownerState();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    expect(await authority.reauthenticateCurrentUser(payload, context(), "owner-password-1234")).toBe(true);
    expect(await authority.reauthenticateCurrentUser(payload, context(), "not-the-password")).toBe(false);
  }
  expect(ownerState()).toEqual(before);
  expect(ownerState().sessions).toBe(3);
  // Every proof was taken on a transaction, and no transaction survived.
  expect(control().logins).toHaveLength(6);
  expect(control().logins.every(({ transactionID }) => transactionID !== undefined)).toBe(true);
  expect(control().transactions).toHaveLength(6);
  expect(control().transactions.every(({ outcome }) => outcome === "rolled-back")).toBe(true);
  expect(control().updates).toEqual([]);
  expect(control().audits).toEqual([]);
  // Payload counts a failed attempt on a connection of its own and clears the
  // count on the transaction, so a rolled-back proof keeps every failure and
  // discards every reset. Each proof restores what a sign-in would have, and
  // does it after the rollback rather than inside it.
  expect(control().unlocks).toEqual(Array.from({ length: 3 }, () => ({
    collection: "users", email: "owner@alpha.example.test", overrideAccess: true, openTransactions: 0
  })));
  // It is still an authentication, so it is still ordered against this
  // principal's credential changes for the whole of its run.
  expect(control().sessionLocks.filter(({ text }) => text.includes("pg_advisory_lock"))).toHaveLength(6);
  expect(control().sessionLockReleases).toEqual(Array.from({ length: 6 }, () => false));
});

function authorityPoolDouble(): Record<string, unknown> {
  return { db: { pool: { options: { max: 10 }, async connect() {
    return { async query() { return { rowCount: 1 }; }, release() { /* the gate is what this test is about */ } };
  } } } };
}

/**
 * The finding this closes: the in-process queue in front of the authority was an
 * unbounded promise chain with no deadline and no way out, so complete public
 * sign-in requests accumulated in memory, a client that had already
 * disconnected still ran, and one account's password check could hold every
 * other account's sign-in.
 */
it("bounds the queue on one principal's credential authority, refuses past it, and admits another principal straight away", async () => {
  const payload = authorityPoolDouble();
  const owner = authority.credentialAuthorityPrincipal("user", "1");
  const second = authority.credentialAuthorityPrincipal("user", "2");
  let release!: () => void;
  const holding = new Promise<void>((settle) => { release = settle; });
  let held = false;
  const holder = authority.withCredentialAuthority(payload, owner, async () => { held = true; await holding; return "held"; });
  while (!held) await new Promise((settle) => setTimeout(settle, 1));

  const queued = Array.from({ length: 7 }, (_unused, index) => authority.withCredentialAuthority(payload, owner, async () => index));
  // The eighth place in the queue belongs to a client that then goes away.
  const abandoning = new AbortController();
  let abandonedRan = false;
  const abandoned = authority.withCredentialAuthority(payload, owner, async () => { abandonedRan = true; }, abandoning.signal);
  await expect(authority.withCredentialAuthority(payload, owner, async () => "refused")).rejects.toMatchObject({ refusal: "busy" });

  // A caller that gives up leaves the queue where it stands rather than at the
  // head of it, so the place it vacates is immediately somebody else's and the
  // work it asked for is never done later on its behalf.
  abandoning.abort();
  await expect(abandoned).rejects.toMatchObject({ refusal: "aborted" });
  const readmitted = authority.withCredentialAuthority(payload, owner, async () => "readmitted");

  // Another account is not behind any of this, which is the whole finding: one
  // account's password check must not be every account's sign-in.
  expect(await authority.withCredentialAuthority(payload, second, async () => "unblocked")).toBe("unblocked");

  release();
  expect(await holder).toBe("held");
  expect(await Promise.all(queued)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(await readmitted).toBe("readmitted");
  expect(abandonedRan).toBe(false);
});

it("never admits a caller whose client has already gone", async () => {
  const payload = authorityPoolDouble();
  const owner = authority.credentialAuthorityPrincipal("user", "1");
  const gone = AbortSignal.abort();
  let ran = false;
  await expect(authority.withCredentialAuthority(payload, owner, async () => { ran = true; }, gone)).rejects.toMatchObject({ refusal: "aborted" });
  expect(ran).toBe(false);
  // The gate it did not enter is not a gate it left broken.
  expect(await authority.withCredentialAuthority(payload, owner, async () => "after")).toBe("after");
});

it("hands the delegated operation a signal that its caller's disconnect aborts", async () => {
  const payload = authorityPoolDouble();
  const owner = authority.credentialAuthorityPrincipal("user", "1");
  const disconnecting = new AbortController();
  let delegated!: AbortSignal;
  const running = authority.withCredentialAuthority(payload, owner, async (signal) => {
    delegated = signal;
    await new Promise<void>((settle) => signal.addEventListener("abort", () => settle(), { once: true }));
    return "stopped";
  }, disconnecting.signal);
  while (delegated === undefined) await new Promise((settle) => setTimeout(settle, 1));
  expect(delegated.aborted).toBe(false);
  disconnecting.abort();
  expect(delegated.aborted).toBe(true);
  expect(await running).toBe("stopped");
});

/**
 * The finding this closes: the generated application served a bare
 * GRAPHQL_POST, and Payload publishes login, refresh, forgot-password and
 * reset-password as mutations for every auth collection whose resolvers call
 * the same operations the REST endpoints do. That reached every credential
 * operation without passing the credential authority or the REST refusals, and
 * it cannot be policed by operation name: aliases, variables, fragments,
 * multiple operations and batching all defeat that. Nothing in this product
 * uses a GraphQL API, so the surface is not generated at all.
 */
it("serves no GraphQL, and declares the users collection out of the schema", () => {
  // The routes stay in the generated tree, because a released application that
  // simply loses a managed file has no upgrade path: the upgrade compiler
  // blocks a managed delete that carries no reference proof. They answer
  // nothing instead, which is the same boundary without that contract change.
  const emitted = { ...generated, ...runnable };
  const graphqlPaths = Object.keys(emitted).filter((path) => /graphql/iu.test(path)).sort();
  expect(graphqlPaths).toEqual(["src/app/(payload)/api/graphql-playground/route.ts", "src/app/(payload)/api/graphql/route.ts"]);
  expect(salesReferenceCompilerBoundary.platformPaths.filter((path) => /graphql/iu.test(path)).sort()).toEqual(graphqlPaths);
  for (const source of Object.values(emitted)) {
    expect(source).not.toContain("GRAPHQL_POST");
    expect(source).not.toContain("GRAPHQL_PLAYGROUND_GET");
  }
  // Every method the endpoint could be reached by answers the same refusal, so
  // there is no document to parse and nothing for an alias, a fragment or a
  // batch to hide behind.
  for (const path of graphqlPaths) {
    const source = emitted[path]!;
    expect(source).toContain("This application does not serve GraphQL.");
    expect(source).toContain("status: 404");
    expect(source).not.toContain("@payload-config");
  }
  expect(emitted["src/app/(payload)/api/graphql/route.ts"]).toContain("export const POST = refused;");
  // Belt and braces: a route that delegated again still finds no schema to publish.
  expect(generated["src/k-nex-users.ts"]).toContain("graphQL: false");
});

it("keeps the operator recovery grant out of reach of an ordinary session", () => {
  const owner = generated["src/k-nex-bootstrap-owner.ts"]!;
  expect(owner).toContain('const recovering = argv[0] === "--recover-credential";');
  expect(owner).toContain("assertAdministrationOperatorConfiguration();");
  expect(owner).toContain("readCredentialRecoveryToken(argv.slice(1))");
  // The grant is handed to the credential transaction, never spent ahead of it.
  expect(owner).toContain("recoverProtectedOwnerCredential(recoveryPayload, receipt, administrationOperatorIdentity(), recoveryToken, { email, password })");
  expect(owner).toContain("discardConsumedRecoveryToken(recoveryToken);");
  expect(owner.slice(owner.indexOf("if (recovering)"), owner.indexOf("const token = readBootstrapToken"))).not.toContain("consumeBootstrapToken");
  expect(owner).toContain("readProtectedRoleBaselineReceipt(kNexIdentity.applicationId)");
  const token = generated["src/k-nex-bootstrap-token.ts"]!;
  expect(token).toContain('parts[0] !== "knr1"');
  expect(token).toContain('value.purpose !== "credential-recovery"');
  expect(token).toContain("Credential recovery requires a bootstrapped owner.");
  expect(generated["src/k-nex-issue-bootstrap-token.ts"]).toContain('const recovery = argv[0] === "--recovery";');
  // No HTTP surface reaches recovery: it is only the operator command line.
  for (const [path, source] of Object.entries(generated)) {
    if (!path.startsWith("src/app/")) continue;
    expect(source).not.toContain("recoverProtectedOwnerCredential");
    expect(source).not.toContain("readCredentialRecoveryToken");
  }
});
