import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";

const generated = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });

type AuditRow = Readonly<{ text: string; values: readonly unknown[] }>;
type UpdateCall = Readonly<{ collection: string; id: string; data: Record<string, unknown>; overrideAccess: boolean }>;

type Control = {
  users: Map<string, { id: string; email: string; password: string }>;
  session: string | undefined;
  updates: UpdateCall[];
  audits: AuditRow[];
  logins: Array<{ email: string; password: string }>;
  hookRefusals: string[];
};

type AuthorityModule = {
  changeCurrentUserCredentials(payload: unknown, context: unknown, input: unknown): Promise<{ userId: string; auditId: string; changed: readonly string[] }>;
  recoverProtectedOwnerCredential(payload: unknown, receipt: unknown, operatorIdentity: string, input: unknown): Promise<{ userId: string; auditId: string }>;
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

function payloadDouble(): Record<string, unknown> {
  return {
    db: {
      pool: {
        async query(text: string, values: readonly unknown[]) { control().audits.push(Object.freeze({ text, values })); return { rows: [] }; }
      }
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
    async update(call: UpdateCall) {
      control().updates.push(call);
      const hook = users.usersCollection.hooks.beforeChange[0]!;
      const stored = control().users.get(String(call.id));
      // Payload merges the stored document into data before beforeChange runs.
      try { hook({ data: { ...(stored === undefined ? {} : { email: stored.email }), ...call.data }, operation: "update", originalDoc: stored === undefined ? undefined : { id: stored.id, email: stored.email } }); }
      catch (error) { control().hookRefusals.push((error as Error).message); throw error; }
      if (stored !== undefined) {
        if (typeof call.data.email === "string") stored.email = call.data.email;
        if (typeof call.data.password === "string") stored.password = call.data.password;
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
`);
  const authoritySource = generated["src/k-nex-authority.ts"]!
    .replace('import { AuthorizationDecisionAuditSchema, canonicalJson } from "@k-nex/contracts";', 'import { AuthorizationDecisionAuditSchema, canonicalJson } from "./stubs.mjs";')
    .replace(/import \{ PostgresAuthorizationStore,[^;]+from "@k-nex\/payload-adapter";/u, 'import { PostgresAuthorizationStore } from "./stubs.mjs";')
    .replace(/import \{\n(?:[^;]+)\n\} from "@k-nex\/runtime";/u, 'import { CurrentAuthorityAdapter, EffectiveAuthorityResolver, createAuthorizationCatalogProvider, createCurrentAuthorityTarget, createEffectiveAuthorizationRequest, createEffectiveAuthorizationCatalog, createPlatformPluginPolicyExecutable, createPlatformPluginRegistrationAuthorizationContribution, createTrustedAuthorizationSession, platformPermissionDescriptors } from "./stubs.mjs";')
    .replace('import { kNexIdentity } from "./k-nex-identity.js";', 'import { kNexIdentity } from "./stubs.mjs";')
    .replace('import { kNexSalesRegistry } from "./k-nex-registry.js";', 'import { kNexSalesRegistry } from "./stubs.mjs";');
  expect(authoritySource).not.toMatch(/@k-nex\//u);
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
      ["1", { id: "1", email: "owner@alpha.example.test", password: "owner-password-1234" }],
      ["2", { id: "2", email: "second@alpha.example.test", password: "second-password-1234" }]
    ]),
    session: "1", updates: [], audits: [], logins: [], hookRefusals: []
  };
});

function context(): { headers: Headers; correlationId: string } {
  return authority.kNexRequestContext(new Headers({ cookie: "payload-token=alpha" }), "credential-change");
}

function auditValue(index = 0): Record<string, unknown> {
  const row = control().audits[index]!;
  expect(row.text).toContain("insert into k_nex_authorization_audit");
  return JSON.parse(String(row.values[5])) as Record<string, unknown>;
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
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), { state: "pending", ownerPrincipal: { kind: "user", id: "1" } }, "fixture.p13-operator", { email: "recovered@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_RECOVERY_TARGET_INVALID" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), { state: "committed", ownerPrincipal: { kind: "service", id: "1" } }, "fixture.p13-operator", { email: "recovered@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_RECOVERY_TARGET_INVALID" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), { state: "committed", ownerPrincipal: { kind: "user", id: "404" } }, "fixture.p13-operator", { email: "recovered@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_RECOVERY_TARGET_INVALID" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", { email: "second@alpha.example.test", password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_EMAIL_TAKEN" });
  await expect(authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", { password: "recovered-password-1" }))
    .rejects.toMatchObject({ code: "CREDENTIAL_INPUT_INVALID" });
  expect(control().updates).toEqual([]);

  const recovered = await authority.recoverProtectedOwnerCredential(payloadDouble(), receipt, "fixture.p13-operator", { email: "recovered@alpha.example.test", password: "recovered-password-1" });
  expect(recovered.userId).toBe("1");
  // Recovery never asks for, and never checks, the lost password.
  expect(control().logins).toEqual([]);
  expect(control().updates[0]!.data).toEqual({ email: "recovered@alpha.example.test", password: "recovered-password-1", sessions: [] });
  expect(auditValue()).toMatchObject({
    auditId: recovered.auditId, operation: "owner-credential-recovery", target: "1",
    principal: { kind: "service", id: "fixture.p13-operator" }, effectiveActor: { kind: "service", id: "fixture.p13-operator" },
    outcome: "allow", reason: "granted", reauthentication: "satisfied"
  });
});

it("keeps the operator recovery grant out of reach of an ordinary session", () => {
  const owner = generated["src/k-nex-bootstrap-owner.ts"]!;
  expect(owner).toContain('const recovering = argv[0] === "--recover-credential";');
  expect(owner).toContain("assertAdministrationOperatorConfiguration();");
  expect(owner).toContain("readCredentialRecoveryToken(argv.slice(1))");
  expect(owner).toContain("await consumeBootstrapToken(recoveryLock, recoveryToken);");
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
