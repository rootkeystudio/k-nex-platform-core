import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";

const generated = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });

type Statement = Readonly<{ strings: readonly string[]; values: readonly unknown[] }>;
type UpdateCall = Readonly<{ collection: string; id: string; data: Record<string, unknown>; overrideAccess: boolean }>;
type StoredUser = { id: string; email: string; password: string; sessions: number };
type StoredGrant = { digest: string; expiresAt: string; consumed: boolean };

/**
 * The boundaries the credential journey has to survive, named in the order the
 * one transaction crosses them.
 */
type CredentialBoundary = "grant-consumed" | "credential-written" | "sessions-revoked" | "audit-written" | "before-commit" | "after-commit";

type Control = {
  users: Map<string, StoredUser>;
  grants: Map<string, StoredGrant>;
  session: string | undefined;
  updates: UpdateCall[];
  audits: Statement[];
  logins: Array<{ email: string; password: string }>;
  hookRefusals: string[];
  transactions: Array<{ id: string; outcome: "open" | "committed" | "rolled-back" }>;
  crossed: CredentialBoundary[];
  fault: ((boundary: CredentialBoundary) => void) | undefined;
};

type AuthorityModule = {
  changeCurrentUserCredentials(payload: unknown, context: unknown, input: unknown): Promise<{ userId: string; auditId: string; changed: readonly string[] }>;
  recoverProtectedOwnerCredential(payload: unknown, receipt: unknown, operatorIdentity: string, grant: unknown, input: unknown): Promise<{ userId: string; auditId: string }>;
  kNexRequestContext(headers: Headers, boundary: string): { headers: Headers; correlationId: string };
  admittedCredentialChange(userId: string, fields: readonly string[]): boolean;
};

type UsersModule = { usersCollection: { hooks: { beforeChange: Array<(args: Record<string, unknown>) => unknown> } } };

let directory: string;
let authority: AuthorityModule;
let users: UsersModule;

function control(): Control {
  return (globalThis as typeof globalThis & { __kNexGeneratedCredentials: Control }).__kNexGeneratedCredentials;
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
      async beginTransaction() {
        const id = "credential-transaction-" + String(control().transactions.length + 1);
        const effects: Array<() => void> = [];
        staged.set(id, effects);
        control().transactions.push({ id, outcome: "open" });
        sessions[id] = {
          db: {
            async execute(statement: Statement) {
              const text = statementText(statement);
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
    async login({ data }: { data: { email: string; password: string } }) {
      control().logins.push(data);
      const match = [...control().users.values()].find((user) => user.email === data.email && user.password === data.password);
      if (match === undefined) throw new Error("invalid credentials");
      return { user: { id: match.id, email: match.email, collection: "users" } };
    },
    async find({ where }: { where: { email: { equals: string } } }) {
      return { docs: [...control().users.values()].filter((user) => user.email === where.email.equals).map(({ id }) => ({ id })) };
    },
    async findByID({ id }: { id: string }) {
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
  // One entry point, so the collection hook and the assertions observe the same
  // authority module instance rather than two loaders' copies of it.
  writeFileSync(join(directory, "probe.mjs"), 'export { admittedCredentialChange, changeCurrentUserCredentials, kNexRequestContext, recoverProtectedOwnerCredential } from "./authority.mjs";\nexport { usersCollection } from "./users.mjs";\n');
  const probe = await import(pathToFileURL(join(directory, "probe.mjs")).href) as AuthorityModule & UsersModule;
  authority = probe;
  users = probe;
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
    session: "1", updates: [], audits: [], logins: [], hookRefusals: [], transactions: [], crossed: [], fault: undefined
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

it("changes a credential after the current password, revokes every session, and audits the change", async () => {
  const result = await authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", email: "renamed@alpha.example.test", password: "brand-new-password-1" });
  expect(result.userId).toBe("1");
  expect([...result.changed]).toEqual(["email", "password"]);
  expect(control().logins).toEqual([{ email: "owner@alpha.example.test", password: "owner-password-1234" }]);
  expect(control().updates).toHaveLength(1);
  expect(control().updates[0]).toMatchObject({ collection: "users", id: "1", overrideAccess: true });
  expect(control().updates[0]!.data).toEqual({ email: "renamed@alpha.example.test", password: "brand-new-password-1", sessions: [] });
  expect(control().hookRefusals).toEqual([]);
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

  const recovered = await authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", grant(), { email: "recovered@alpha.example.test", password: "recovered-password-1" });
  expect(recovered.userId).toBe("1");
  // Recovery never asks for, and never checks, the lost password.
  expect(control().logins).toEqual([]);
  expect(control().updates[0]!.data).toEqual({ email: "recovered@alpha.example.test", password: "recovered-password-1", sessions: [] });
  // The grant is spent on the transaction that moved the credential, not before it.
  expect(control().crossed).toEqual(["grant-consumed", "credential-written", "sessions-revoked", "audit-written", "before-commit", "after-commit"]);
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
for (const boundary of ["credential-written", "sessions-revoked", "audit-written", "before-commit"] as const) {
  it(`rolls back the whole credential journey when it fails at ${boundary}`, async () => {
    const before = ownerState();
    failAt(boundary);
    await expect(authority.changeCurrentUserCredentials(payloadDouble(), context(), { currentPassword: "owner-password-1234", email: "renamed@alpha.example.test", password: "brand-new-password-1" }))
      .rejects.toThrow("injected " + boundary + " failure");
    expect(ownerState()).toEqual(before);
    expect(control().transactions.map(({ outcome }) => outcome)).toEqual(["rolled-back"]);
  });
}

for (const boundary of ["grant-consumed", "credential-written", "sessions-revoked", "audit-written", "before-commit"] as const) {
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
  expect(control().crossed).toEqual(["credential-written", "sessions-revoked", "audit-written", "before-commit", "after-commit"]);
  expect(control().transactions).toEqual([{ id: "credential-transaction-1", outcome: "committed" }]);
  expect((control().updates[0] as { req?: { transactionID?: unknown } }).req?.transactionID).toBe("credential-transaction-1");
  // Self-service never touches a recovery grant.
  expect(ownerState().grantConsumed).toBe(false);
  expect(auditValue()).toMatchObject({ auditId: result.auditId });
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
