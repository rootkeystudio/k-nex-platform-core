import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { applyCreateKnexApplication, planCreateKnexApplication } from "@k-nex/composition";
import { PackageReleaseManifestSchema, canonicalJson } from "@k-nex/contracts";
import { salesOpportunitiesDescriptor, salesOpportunityStageUpdateDescriptor, salesTaskUpdateDescriptor, salesTasksDescriptor } from "@k-nex/module-sales/contracts";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { chromium } from "playwright";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const applicationId = "p12-auth-proof";
const environmentName = "test";
const expected = (state) => ({
  applicationId: state.applicationId,
  environment: state.environment,
  authorizationRevision: state.authorizationRevision,
  lifecycleRevision: state.lifecycleRevision
});

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.notEqual(typeof address, "string");
  const port = address.port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function run(command, arguments_, options) {
  return execFileSync(command, arguments_, { ...options, encoding: "utf8", timeout: 120_000 });
}

function failedRun(command, arguments_, options) {
  try {
    run(command, arguments_, options);
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  assert.fail(`${command} unexpectedly succeeded.`);
}

async function until(check, failure, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`${failure}: process exited ${child.exitCode}.`);
    const result = await check().catch(() => undefined);
    if (result !== undefined && result !== false) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(failure);
}

function start(command, arguments_, options) {
  const child = spawn(command, arguments_, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  return { child, output: () => output };
}

async function stop(child, label = "child") {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveClose, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} process did not stop.`)), 10_000);
    child.once("close", () => { clearTimeout(timeout); resolveClose(); });
  });
}

async function startApplication(application, applicationEnvironment) {
  const port = Number(new URL(applicationEnvironment.K_NEX_PUBLIC_ORIGIN).port);
  const process = start("pnpm", ["start"], { cwd: application, env: { ...applicationEnvironment, PORT: String(port) } });
  await until(async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).ok, `Generated application did not start.\n${process.output()}`, process.child);
  return { ...process, origin: `http://127.0.0.1:${port}` };
}

function cookie(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "Login must set a session cookie.");
  return { header: value.split(";", 1)[0], value };
}

async function login(origin, email, password) {
  const response = await fetch(`${origin}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(Object.hasOwn(body, "token"), false, "Session login must not return a bearer token.");
  return { body, cookie: cookie(response) };
}

function verifiedPackageSource(manifestInput, directory) {
  const manifest = PackageReleaseManifestSchema.parse(manifestInput);
  const release = Object.freeze({});
  const authority = {
    async verify() { throw new Error("Fixture authority accepts only its issued release."); },
    read(token) {
      if (token !== release) throw new Error("Fixture release was not issued by this authority.");
      return { manifest, digest: `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`, attestation: Object.freeze({}) };
    }
  };
  return { kind: "packed-mirror", directory, authority, release };
}

test("P12.9 generated app completes the durable authorized workspace journey", { timeout: 420_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("p12_generated").withStartupTimeout(120_000).start();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "p12-generated-auth-")));
  const application = join(root, "application");
  const foreignApplication = join(root, "foreign-application");
  const tokenFile = join(root, "owner.token");
  const staleTokenFile = join(root, "stale-owner.token");
  const replayTokenFile = join(root, "owner-replay.token");
  const ownerEmail = `owner-${randomUUID()}@example.test`;
  const ownerPassword = randomBytes(24).toString("base64url");
  const staleOwnerEmail = `stale-owner-${randomUUID()}@example.test`;
  const staleOwnerPassword = randomBytes(24).toString("base64url");
  const limitedEmail = `limited-${randomUUID()}@example.test`;
  const limitedPassword = randomBytes(24).toString("base64url");
  const managerEmail = `manager-${randomUUID()}@example.test`;
  const managerPassword = randomBytes(24).toString("base64url");
  let applicationProcess;
  let workerProcess;
  let pool;
  let notificationClient;
  let browser;
  try {
    const releaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"), "utf8"));
    const packageSource = verifiedPackageSource(releaseManifest, resolve(repositoryRoot, "fixtures/customer-gate-1/packages"));
    const plan = planCreateKnexApplication({ applicationId, applicationName: "P12 Auth Proof", theme: "minimal", database: "external", packageSource });
    assert.equal(Object.values(plan.files).some((source) => source.includes(ownerEmail) || source.includes(ownerPassword) || source.includes(limitedPassword)), false);
    applyCreateKnexApplication(plan, application);
    for (const command of plan.installCommands) run(command[0], command.slice(1), { cwd: application, stdio: "pipe" });

    const port = await unusedPort();
    const applicationEnvironment = {
      ...process.env,
      DATABASE_URL: container.getConnectionUri(),
      K_NEX_ENVIRONMENT: environmentName,
      K_NEX_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      PAYLOAD_SECRET: randomBytes(32).toString("hex")
    };
    const ownerEnvironment = { ...applicationEnvironment, K_NEX_OWNER_EMAIL: ownerEmail, K_NEX_OWNER_PASSWORD: ownerPassword };
    const staleOwnerEnvironment = { ...applicationEnvironment, K_NEX_OWNER_EMAIL: staleOwnerEmail, K_NEX_OWNER_PASSWORD: staleOwnerPassword };
    run("pnpm", ["knex:migrate"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    run("pnpm", ["build"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });

    applicationProcess = await startApplication(application, applicationEnvironment);
    const beforeBootstrap = await fetch(`${applicationProcess.origin}/api/readiness`);
    assert.equal(beforeBootstrap.status, 503);
    const anonymous = await fetch(`${applicationProcess.origin}/`, { redirect: "manual" });
    assert.equal(anonymous.status, 307);
    assert.equal(anonymous.headers.get("location"), "/login");
    await stop(applicationProcess.child, "pre-bootstrap application");
    applicationProcess = undefined;

    const staleIssueOutput = run("pnpm", ["knex:issue-bootstrap-token", "--output", staleTokenFile], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    assert.match(staleIssueOutput, /K_NEX_BOOTSTRAP_TOKEN_ISSUED/u);
    const staleToken = readFileSync(staleTokenFile, "utf8").trim();
    const issueOutput = run("pnpm", ["knex:issue-bootstrap-token", "--output", tokenFile], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    assert.match(issueOutput, /K_NEX_BOOTSTRAP_TOKEN_ISSUED/u);
    assert.equal(statSync(tokenFile).mode & 0o077, 0);
    const token = readFileSync(tokenFile, "utf8").trim();
    assert.equal(`${staleIssueOutput}${issueOutput}`.includes(staleToken), false);
    assert.equal(`${staleIssueOutput}${issueOutput}`.includes(token), false);

    const wrongEnvironmentOutput = failedRun("pnpm", ["knex:bootstrap-owner", "--token-file", tokenFile], {
      cwd: application, env: { ...ownerEnvironment, K_NEX_ENVIRONMENT: "foreign" }, stdio: "pipe"
    });
    assert.match(wrongEnvironmentOutput, /Bootstrap token identity is invalid/u);
    assert.equal(existsSync(tokenFile), true, "An environment mismatch cannot consume the token.");

    const foreignPlan = planCreateKnexApplication({ applicationId: "p12-foreign-proof", applicationName: "P12 Foreign Proof", theme: "minimal", database: "external", packageSource });
    applyCreateKnexApplication(foreignPlan, foreignApplication);
    symlinkSync(join(application, "node_modules"), join(foreignApplication, "node_modules"), "dir");
    run(join(foreignApplication, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.scripts.json"], { cwd: foreignApplication, env: applicationEnvironment, stdio: "pipe" });
    const wrongApplicationOutput = failedRun("node", ["dist/k-nex-bootstrap-owner.js", "--token-file", tokenFile], {
      cwd: foreignApplication, env: ownerEnvironment, stdio: "pipe"
    });
    assert.match(wrongApplicationOutput, /Bootstrap token identity is invalid/u);
    assert.equal(existsSync(tokenFile), true, "An application mismatch cannot consume the token.");

    const bootstrapOutput = run("pnpm", ["knex:bootstrap-owner", "--token-file", tokenFile], { cwd: application, env: ownerEnvironment, stdio: "pipe" });
    assert.match(bootstrapOutput, /K_NEX_OWNER_BOOTSTRAP_PASS bootstrap\.receipt\./u);
    assert.equal(existsSync(tokenFile), false, "Successful bootstrap must remove its one-time token file.");
    for (const secret of [token, ownerEmail, ownerPassword]) assert.equal(`${issueOutput}${bootstrapOutput}`.includes(secret), false);
    const staleBootstrapOutput = failedRun("pnpm", ["knex:bootstrap-owner", "--token-file", staleTokenFile], { cwd: application, env: staleOwnerEnvironment, stdio: "pipe" });
    assert.match(staleBootstrapOutput, /Bootstrap token is unavailable, expired, or consumed/u);
    assert.equal((await pool.query("select count(*)::int as count from users")).rows[0].count, 1, "A stale bootstrap token cannot create another user.");
    assert.equal(existsSync(staleTokenFile), true, "A rejected stale token must not be removed.");
    const replayOutput = failedRun("pnpm", ["knex:issue-bootstrap-token", "--output", replayTokenFile], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    assert.match(replayOutput, /First owner already exists/u);
    assert.equal(existsSync(replayTokenFile), false);
    console.log("P12_ATK_19_BOOTSTRAP_SCOPE_AND_REPLAY_POSTGRES_DENIED=PASS");

    const readinessOutput = run("pnpm", ["knex:doctor"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    assert.match(readinessOutput, /K_NEX_APPLICATION_READY/u);
    applicationProcess = await startApplication(application, applicationEnvironment);
    const readiness = await fetch(`${applicationProcess.origin}/api/readiness`);
    assert.equal(readiness.status, 200);
    assert.deepEqual(await readiness.json(), { schemaVersion: 1, status: "ready", applicationId, authorizationRevision: 2, lifecycleRevision: 1 });

    const publicSignup = await fetch(`${applicationProcess.origin}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `public-${randomUUID()}@example.test`, password: randomBytes(24).toString("base64url") })
    });
    assert.equal(publicSignup.status, 403);

    const owner = await login(applicationProcess.origin, ownerEmail, ownerPassword);
    assert.match(owner.cookie.value, /HttpOnly=true/u);
    assert.match(owner.cookie.value, /SameSite=Lax/u);
    assert.equal(owner.cookie.value.includes("Secure"), false, "HTTP development origins must not issue Secure cookies.");
    const ownerWorkspace = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: owner.cookie.header } });
    assert.equal(ownerWorkspace.status, 200);
    const ownerHtml = await ownerWorkspace.text();
    assert.match(ownerHtml, /P12 Auth Proof/u);
    assert.match(ownerHtml, /Sales/u);
    assert.match(ownerHtml, /System/u);
    for (const secret of [ownerEmail, ownerPassword, limitedPassword, managerPassword]) assert.equal(ownerHtml.includes(secret), false);
    const inventory = await fetch(`${applicationProcess.origin}/api/k-nex/inventory`, { headers: { cookie: owner.cookie.header } });
    assert.equal(inventory.status, 200);
    const inventoryBody = await inventory.json();
    assert.deepEqual(inventoryBody.plugins, ["module.sales"]);
    assert.equal((await fetch(`${applicationProcess.origin}/sales`, { headers: { cookie: owner.cookie.header } })).status, 404, "Phase 12 must not invent a Sales product page before Phase 13.");
    assert.equal((await fetch(`${applicationProcess.origin}/system/workspace-pages`, { headers: { cookie: owner.cookie.header } })).status, 200);
    assert.equal((await fetch(`${applicationProcess.origin}/system/access/roles`, { headers: { cookie: owner.cookie.header } })).status, 404, "Generated navigation must not claim unimplemented System administration routes.");

    const createLimited = await fetch(`${applicationProcess.origin}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie.header },
      body: JSON.stringify({ email: limitedEmail, password: limitedPassword })
    });
    assert.equal(createLimited.status, 201);
    const limitedUser = await createLimited.json();
    const limitedUserId = String(limitedUser.doc.id);

    const createManager = await fetch(`${applicationProcess.origin}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie.header },
      body: JSON.stringify({ email: managerEmail, password: managerPassword })
    });
    assert.equal(createManager.status, 201);
    const managerUser = await createManager.json();
    const managerUserId = String(managerUser.doc.id);
    const ownerUserId = String(owner.body.user.id);

    const createPage = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: owner.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({
        title: "Sales command center", description: "Bounded Sales workspace", parentNavigationId: "sales.navigation.root", order: "100",
        themeRevision: "", idempotencyKey: `workspace-create-${randomUUID()}`
      })
    });
    assert.equal(createPage.status, 303, `${await createPage.clone().text()}\n${applicationProcess.output()}`);
    const pageLocation = new URL(createPage.headers.get("location"), applicationProcess.origin);
    const pageId = decodeURIComponent(pageLocation.pathname.split("/").at(-1));
    assert.match(pageId, /^workspace\.page\./u);

    const pageSession = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session`, { headers: { cookie: owner.cookie.header } });
    assert.equal(pageSession.status, 200, `${await pageSession.clone().text()}\n${applicationProcess.output()}`);
    const pageState = await pageSession.json();
    const assignTheme = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/metadata`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: owner.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({
        expectedRevision: String(pageState.pageRevision), title: "Sales command center", description: "Bounded Sales workspace",
        parentNavigationId: "sales.navigation.root", order: "100", themeRevision: inventoryBody.theme.profileRevisionId,
        idempotencyKey: `workspace-theme-${randomUUID()}`
      })
    });
    assert.equal(assignTheme.status, 303, `${await assignTheme.clone().text()}\n${applicationProcess.output()}`);

    const store = new PostgresAuthorizationStore(pool, {
      validate: (requestedApplicationId, subject) => requestedApplicationId === applicationId && subject.kind === "user" && [limitedUserId, managerUserId].includes(subject.id) ? "accepted" : "rejected"
    });
    const state = await store.readState(applicationId, environmentName);
    assert.ok(state);
    const granted = await store.transaction(expected(state), async (transaction) => {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.workspace-viewer", applicationId, label: "Workspace viewer", revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.workspace-viewer.read", applicationId, roleId: "customer.workspace-viewer", permissionId: "system.workspace-pages.read", owner: { kind: "platform", namespace: "system" }, revision: 0 } });
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.workspace-viewer.assignment", applicationId, roleId: "customer.workspace-viewer", principal: { kind: "user", id: limitedUserId }, state: "active", revision: 0 } });
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.sales-manager", applicationId, label: "Sales manager", revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.sales-manager.workspace", applicationId, roleId: "customer.sales-manager", permissionId: "system.workspace-pages.read", owner: { kind: "platform", namespace: "system" }, revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.sales-manager.workspace-edit", applicationId, roleId: "customer.sales-manager", permissionId: "system.workspace-pages.edit", owner: { kind: "platform", namespace: "system" }, revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.sales-manager.workspace-publish", applicationId, roleId: "customer.sales-manager", permissionId: "system.workspace-pages.publish", owner: { kind: "platform", namespace: "system" }, revision: 0 } });
      for (const permissionId of [
        "sales.navigation.read", "sales.tasks.read", "sales.tasks.title.read", "sales.tasks.status.read", "sales.tasks.revenue.read",
        "sales.opportunities.read", "sales.opportunities.name.read", "sales.opportunities.stage.read", "sales.opportunities.value.read", "sales.opportunities.write"
      ]) await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: `customer.sales-manager.${permissionId}`, applicationId, roleId: "customer.sales-manager", permissionId, owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: 0 } });
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.sales-manager.assignment", applicationId, roleId: "customer.sales-manager", principal: { kind: "user", id: managerUserId }, state: "active", revision: 0 } });
    });

    const limited = await login(applicationProcess.origin, limitedEmail, limitedPassword);
    const limitedWorkspace = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: limited.cookie.header } });
    assert.equal(limitedWorkspace.status, 200);
    const limitedHtml = await limitedWorkspace.text();
    assert.equal(limitedHtml.includes("sales.route.overview"), false);
    assert.equal(limitedHtml.includes("/sales"), false);
    assert.equal((await fetch(`${applicationProcess.origin}/sales`, { headers: { cookie: limited.cookie.header } })).status, 404);
    assert.equal((await fetch(`${applicationProcess.origin}/api/k-nex/inventory`, { headers: { cookie: limited.cookie.header } })).status, 403);
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: limited.cookie.header } })).status, 404);
    console.log("P12_ATK_05_UNAUTHORIZED_DIRECT_URL_AND_ENUMERATION_HTTP_DENIED=PASS");

    const manager = await login(applicationProcess.origin, managerEmail, managerPassword);
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header } })).status, 404, "Draft pages cannot be viewed through the normal route.");

    await store.transaction(expected(granted.state), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.workspace-viewer.assignment", applicationId, roleId: "customer.workspace-viewer", principal: { kind: "user", id: limitedUserId }, state: "revoked", revision: 1 } });
    });
    const revokedWorkspace = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: limited.cookie.header }, redirect: "manual" });
    assert.equal(revokedWorkspace.status, 307);
    assert.equal(revokedWorkspace.headers.get("location"), "/forbidden");

    const oldOwnerCookie = owner.cookie.header;
    assert.equal((await fetch(`${applicationProcess.origin}/api/users/logout`, { method: "POST", headers: { cookie: oldOwnerCookie } })).status, 200);
    const replayMe = await fetch(`${applicationProcess.origin}/api/users/me`, { headers: { cookie: oldOwnerCookie } });
    assert.equal(replayMe.status, 200);
    assert.equal((await replayMe.json()).user, null);
    const replayWorkspace = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: oldOwnerCookie }, redirect: "manual" });
    assert.equal(replayWorkspace.status, 307);
    assert.equal(replayWorkspace.headers.get("location"), "/login");

    notificationClient = await pool.connect();
    const notificationTypes = new Set();
    notificationClient.on("notification", ({ channel, payload }) => {
      if (channel === "k_nex_runtime_invalidation" && payload) notificationTypes.add(JSON.parse(payload).type);
    });
    await notificationClient.query("LISTEN k_nex_runtime_invalidation");
    workerProcess = start("node", ["dist/k-nex-worker.js"], { cwd: application, env: applicationEnvironment });
    await until(async () => workerProcess.output().includes("K_NEX_WORKER_READY"), `Generated worker did not start.\n${workerProcess.output()}`, workerProcess.child);
    await until(async () => {
      const result = await pool.query("select count(*)::int as count from k_nex_authorization_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName]);
      return result.rows[0].count === 0;
    }, "Authorization outbox did not converge.", workerProcess.child);
    await until(async () => notificationTypes.has("authorization") && notificationTypes.has("workspace-page"), "Generated worker did not publish both invalidation classes.", workerProcess.child);
    notificationClient.release();
    notificationClient = undefined;
    assert.equal(workerProcess.output().includes(ownerEmail) || workerProcess.output().includes(ownerPassword) || workerProcess.output().includes(limitedPassword) || workerProcess.output().includes(managerPassword), false);
    console.log("P12_ATK_18_GENERATED_HTML_AND_WORKER_SECRET_LEAKAGE_DENIED=PASS");
    await stop(workerProcess.child, "authorization worker");
    workerProcess = undefined;

    await stop(applicationProcess.child, "application restart boundary");
    applicationProcess = await startApplication(application, applicationEnvironment);
    const restartedOwner = await login(applicationProcess.origin, ownerEmail, ownerPassword);
    assert.equal((await fetch(`${applicationProcess.origin}/`, { headers: { cookie: restartedOwner.cookie.header } })).status, 200);

    const themedPageSession = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session`, { headers: { cookie: restartedOwner.cookie.header } });
    assert.equal(themedPageSession.status, 200);
    const themedPageState = await themedPageSession.json();
    const autosaveUrl = `${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/autosave`;
    const unsafeWrite = (body, headers = {}) => fetch(autosaveUrl, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin, ...headers },
      body
    });
    assert.equal((await unsafeWrite("{}", { origin: "https://attacker.example" })).status, 400, "Cross-origin autosave must fail closed.");
    assert.equal((await unsafeWrite("{")).status, 400, "Malformed JSON autosave must fail closed.");
    assert.equal((await unsafeWrite(JSON.stringify({ padding: "x".repeat(1_048_576) }))).status, 400, "Oversized autosave must fail closed.");
    const attackCopyResult = await pool.query("select working_copy_json from k_nex_workspace_working_copies where application_id=$1 and environment=$2 and page_id=$3", [applicationId, environmentName, pageId]);
    const attackCopy = attackCopyResult.rows[0].working_copy_json;
    const workspaceAuthoritySnapshot = async () => {
      const result = await pool.query(`select working_copy.working_copy_json, working_copy.working_copy_revision, page.working_copy_revision as page_working_copy_revision,
        pointer.pointer_json, (select count(*)::int from k_nex_workspace_published_revisions where application_id=$1 and environment=$2 and page_id=$3) as published_revision_count
        from k_nex_workspace_working_copies working_copy
        join k_nex_workspace_pages page on page.application_id=working_copy.application_id and page.environment=working_copy.environment and page.page_id=working_copy.page_id
        left join k_nex_workspace_publication_pointers pointer on pointer.application_id=working_copy.application_id and pointer.environment=working_copy.environment and pointer.page_id=working_copy.page_id
        where working_copy.application_id=$1 and working_copy.environment=$2 and working_copy.page_id=$3`, [applicationId, environmentName, pageId]);
      assert.equal(result.rowCount, 1, "The attack target must retain one working copy.");
      return result.rows[0];
    };
    const assertAutosaveDenied = async (marker, document) => {
      const before = await workspaceAuthoritySnapshot();
      const response = await unsafeWrite(JSON.stringify({
        expectedRevision: attackCopy.revision,
        editorSessionId: `workspace-attacker-${randomUUID()}`,
        idempotencyKey: `workspace-attacker-${randomUUID()}`,
        document
      }));
      assert.equal(response.status, 400, `${marker} must map a rejected canonical-policy write to INVALID_INPUT.`);
      assert.deepEqual(await response.json(), { code: "INVALID_INPUT" });
      assert.deepEqual(await workspaceAuthoritySnapshot(), before, `${marker} cannot persist a working copy or publication change.`);
      console.log(`${marker}=PASS`);
    };
    const kanban = {
      id: "attacker-kanban", type: "sales.opportunity-kanban", version: 1, props: { title: "Sales opportunity Kanban" },
      bindings: {
        source: {
          source: { id: salesOpportunitiesDescriptor.id, version: salesOpportunitiesDescriptor.version }, input: {},
          structuralCompatibilityHash: salesOpportunitiesDescriptor.structuralCompatibilityHash, selectedFields: ["name", "stage", "revision", "value"]
        },
        action: { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }
      }
    };
    const attackerDocument = (regions) => ({ ...attackCopy.document, version: attackCopy.revision + 1, regions });
    await assertAutosaveDenied("P12_ATK_11_UNSAFE_PROPS_HTTP_POSTGRES_DENIED", attackerDocument({ main: [{
      ...kanban, props: { title: "<img src=x onerror=alert(1)>", url: "javascript:alert(1)" }
    }] }));
    await assertAutosaveDenied("P12_ATK_01_PROTECTED_SHELL_HTTP_POSTGRES_DENIED", attackerDocument({ ...attackCopy.document.regions, "system-shell": [] }));
    await assertAutosaveDenied("P12_ATK_12_SOURCE_SUBSTITUTION_HTTP_POSTGRES_DENIED", attackerDocument({ main: [{
      ...kanban,
      bindings: {
        ...kanban.bindings,
        source: {
          ...kanban.bindings.source,
          source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version + 1 },
          structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash
        }
      }
    }] }));
    await assertAutosaveDenied("P12_ATK_13_ACTION_SUBSTITUTION_HTTP_POSTGRES_DENIED", attackerDocument({ main: [{
      ...kanban, bindings: { ...kanban.bindings, action: { id: salesTaskUpdateDescriptor.id, version: salesTaskUpdateDescriptor.version + 1 } }
    }] }));
    const publishUrl = `${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/publish`;
    const assertPublishDenied = async (marker, body, status, code) => {
      const before = await workspaceAuthoritySnapshot();
      const response = await fetch(publishUrl, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, status, `${marker} returned an unexpected denial status.`);
      assert.deepEqual(await response.json(), { code });
      assert.deepEqual(await workspaceAuthoritySnapshot(), before, `${marker} cannot publish an attacker document or revision.`);
      console.log(`${marker}=PASS`);
    };
    await assertPublishDenied("P12_ATK_12_PUBLISH_DOCUMENT_HTTP_POSTGRES_DENIED", {
      workingCopyRevision: attackCopy.revision, idempotencyKey: `workspace-attacker-publish-${randomUUID()}`,
      document: attackerDocument({ main: [{ ...kanban, props: { title: "<script>alert(1)</script>" } }] })
    }, 400, "INVALID_INPUT");
    await assertPublishDenied("P12_ATK_12_PUBLISH_REVISION_HTTP_POSTGRES_DENIED", {
      workingCopyRevision: attackCopy.revision + 1, idempotencyKey: `workspace-attacker-publish-${randomUUID()}`
    }, 409, "REVISION_CONFLICT");
    let deepNode = { id: "deep-0", type: "content.text", version: 1, props: { text: "deep" } };
    for (let depth = 1; depth <= 18; depth += 1) deepNode = { id: `deep-${depth}`, type: "layout.section", version: 1, props: {}, children: [deepNode] };
    assert.equal((await unsafeWrite(JSON.stringify({
      expectedRevision: attackCopy.revision,
      editorSessionId: `workspace-editor-${randomUUID()}`,
      idempotencyKey: `workspace-deep-${randomUUID()}`,
      document: { ...attackCopy.document, regions: { main: [deepNode] } }
    }))).status, 400, "Deep canonical documents must fail closed.");
    console.log("P12_ATK_10_CSRF_REPLAY_AND_MALFORMED_AUTOSAVE_HTTP_DENIED=PASS");
    const access = new URLSearchParams({ expectedPageRevision: String(themedPageState.pageRevision), expectedAccessRevision: String(themedPageState.accessRevision), idempotencyKey: `workspace-access-${randomUUID()}` });
    access.append("assignment", `user|${ownerUserId}|edit`);
    access.append("assignment", `user|${limitedUserId}|view`);
    access.append("assignment", "role|customer.sales-manager|view");
    access.append("assignment", `user|${managerUserId}|edit`);
    const replaceAccess = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/access`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin }, body: access
    });
    assert.equal(replaceAccess.status, 303, await replaceAccess.clone().text());

    const alpha = await pool.query("insert into sales_opportunities (name, stage, value) values ('Alpha renewal','lead','12000') returning id");
    const beta = await pool.query("insert into sales_opportunities (name, stage, value) values ('Beta expansion','lead','8000') returning id");
    const task = await pool.query("insert into sales_tasks (title, status, potential_revenue) values ('Prepare Alpha proposal','open','12000') returning id");

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${applicationProcess.origin}/login`);
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password").fill(ownerPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${applicationProcess.origin}/`);
    await page.getByRole("navigation", { name: "Workspace navigation" }).getByText("Sales", { exact: true }).waitFor();
    await page.getByRole("navigation", { name: "Workspace navigation" }).getByText("System", { exact: true }).waitFor();
    assert.equal(await page.locator('[data-k-nex-component="workspace-shell"]').evaluate((element) => getComputedStyle(element).transitionDuration), "0s");

    let lostAutosaveResponse = false;
    await page.route(`**/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/autosave`, async (route) => {
      if (lostAutosaveResponse) return route.continue();
      lostAutosaveResponse = true;
      const response = await route.fetch();
      assert.equal(response.status(), 200, `The autosave must commit before its response is lost.\n${await response.text()}\n${applicationProcess.output()}`);
      await route.abort("failed");
    });
    await page.goto(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}/edit`);
    const controls = page.getByRole("region", { name: "Canvas block keyboard controls" });
    const blockSelect = controls.getByRole("combobox", { name: "Block to add" });
    const addBlock = controls.getByRole("button", { name: "Add block to canvas" });
    for (const label of ["Sales opportunity Kanban", "Sales revenue metric", "Sales task table"]) {
      await blockSelect.selectOption({ label });
      await addBlock.click();
    }
    await page.getByText("All changes saved.", { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(lostAutosaveResponse, true);
    await page.unroute(`**/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/autosave`);
    const savedWorkingCopy = await pool.query("select working_copy_json from k_nex_workspace_working_copies where application_id=$1 and environment=$2 and page_id=$3", [applicationId, environmentName, pageId]);
    const savedNodes = savedWorkingCopy.rows[0].working_copy_json.document.regions.main;
    assert.deepEqual(savedNodes.map(({ type }) => type), ["sales.opportunity-kanban", "sales.revenue-metric", "sales.task-table"]);
    assert.equal(savedNodes.every(({ bindings }) => bindings?.source !== undefined || bindings?.action !== undefined), true, "Inserted Sales blocks must retain trusted runtime bindings.");

    const publication = page.getByRole("region", { name: "Page publication controls" });
    await publication.getByRole("button", { name: "Publish page" }).click();
    await publication.getByText("Page published.", { exact: true }).waitFor({ timeout: 10_000 });
    const firstPointerResult = await pool.query("select pointer_json from k_nex_workspace_publication_pointers where application_id=$1 and environment=$2 and page_id=$3", [applicationId, environmentName, pageId]);
    const firstPublishedRevisionId = firstPointerResult.rows[0].pointer_json.publishedRevisionId;
    assert.match(firstPublishedRevisionId, /^workspace\.publication\./u);

    const selectedBlock = controls.getByRole("combobox", { name: "Selected canvas block" });
    await selectedBlock.selectOption("2");
    await page.getByRole("textbox", { name: "Title" }).last().fill("Sales task table revised");
    await page.getByText("All changes saved.", { exact: true }).waitFor({ timeout: 10_000 });
    await publication.getByRole("button", { name: "Publish page" }).click();
    await publication.getByText("Page published.", { exact: true }).waitFor({ timeout: 10_000 });
    const secondPointerResult = await pool.query("select pointer_json from k_nex_workspace_publication_pointers where application_id=$1 and environment=$2 and page_id=$3", [applicationId, environmentName, pageId]);
    assert.equal(secondPointerResult.rows[0].pointer_json.previousPublishedRevisionId, firstPublishedRevisionId);

    await page.goto(`${applicationProcess.origin}/`);
    const publishedNavigationLink = page.locator('[data-navigation-node="sales.navigation.root"]').getByRole("link", { name: "Sales command center" });
    assert.equal(await publishedNavigationLink.getAttribute("href"), `/workspace/pages/${pageId}`);
    await page.goto(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`);
    const alphaMove = page.locator(`[data-opportunity-id="${String(alpha.rows[0].id)}"]`).getByRole("button", { name: "Move to qualified" });
    assert.equal(await alphaMove.count(), 1, `Published Kanban action is missing.\n${await page.locator("body").innerText()}\n${JSON.stringify(savedNodes[0])}\n${applicationProcess.output()}`);
    await alphaMove.click();
    const alphaStatus = page.getByRole("region", { name: "Sales opportunity Kanban" }).getByRole("status");
    await alphaStatus.filter({ hasText: /moved/u }).waitFor({ timeout: 10_000 });
    assert.equal(await alphaStatus.textContent(), "Alpha renewal moved to qualified.", applicationProcess.output());
    const betaMove = page.locator(`[data-opportunity-id="${String(beta.rows[0].id)}"]`).getByRole("button", { name: "Move to won" });
    await betaMove.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Beta expansion moved to won.", { exact: true }).waitFor();
    const moved = await pool.query("select name, stage from sales_opportunities order by id");
    assert.deepEqual(moved.rows, [{ name: "Alpha renewal", stage: "qualified" }, { name: "Beta expansion", stage: "won" }]);
    assert.equal(await page.locator("[data-k-nex-theme-profile]").getAttribute("data-k-nex-theme-profile"), inventoryBody.theme.profileRevisionId);

    const salesRow = async (kind, id) => {
      const result = await pool.query(kind === "opportunity"
        ? "select id::text as id, name, stage, updated_at as revision from sales_opportunities where id=$1"
        : "select id::text as id, title, status, updated_at as revision from sales_tasks where id=$1", [id]);
      assert.equal(result.rowCount, 1, `Sales ${kind} target must exist.`);
      return result.rows[0];
    };
    const postPageAction = (targetPageId, actionId, actionCookie, input) => fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(targetPageId)}/actions/${encodeURIComponent(actionId)}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: actionCookie, origin: applicationProcess.origin },
      body: JSON.stringify({ input, idempotencyKey: `workspace-direct-action-${randomUUID()}` })
    });
    const opportunityInput = (row, stage) => ({ id: row.id, expectedStage: row.stage, expectedRevision: new Date(row.revision).toISOString(), stage });

    const limitedAuthority = await store.readState(applicationId, environmentName);
    assert.ok(limitedAuthority);
    await store.transaction(expected(limitedAuthority), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.workspace-viewer.assignment", applicationId, roleId: "customer.workspace-viewer", principal: { kind: "user", id: limitedUserId }, state: "active", revision: 2 } });
    });
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: limited.cookie.header } })).status, 200, "Exact page view access must not grant Sales action authority.");
    const pageAclOnlyBefore = await salesRow("opportunity", String(alpha.rows[0].id));
    const pageAclOnly = await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, limited.cookie.header, opportunityInput(pageAclOnlyBefore, "won"));
    assert.equal(pageAclOnly.status, 403);
    const { correlationId: pageAclOnlyCorrelationId, ...pageAclOnlyBody } = await pageAclOnly.json();
    assert.deepEqual(pageAclOnlyBody, { code: "ACTION_FORBIDDEN", status: 403, detail: "Current authority does not permit this action." });
    assert.match(pageAclOnlyCorrelationId, /^workspace-sales-action-[0-9a-f-]+$/u);
    assert.deepEqual(await salesRow("opportunity", String(alpha.rows[0].id)), pageAclOnlyBefore, "Page ACL cannot grant Sales action authority or mutate its target.");
    console.log("P12_ATK_07_PAGE_ACL_ONLY_SALES_ACTION_HTTP_POSTGRES_DENIED=PASS");

    const unboundBefore = await salesRow("task", String(task.rows[0].id));
    const unbound = await postPageAction(pageId, salesTaskUpdateDescriptor.id, restartedOwner.cookie.header, { id: unboundBefore.id, status: "done" });
    assert.equal(unbound.status, 404);
    assert.deepEqual(await unbound.json(), { code: "NOT_FOUND" });
    assert.deepEqual(await salesRow("task", String(task.rows[0].id)), unboundBefore, "An action absent from the published document cannot mutate a Sales row.");
    console.log("P12_ATK_13_UNBOUND_ACTION_HTTP_POSTGRES_DENIED=PASS");

    const createUnboundPage = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({ title: "Sales action-free page", description: "Published without Sales action bindings", parentNavigationId: "sales.navigation.root", order: "101", themeRevision: "", idempotencyKey: `workspace-create-unbound-${randomUUID()}` })
    });
    assert.equal(createUnboundPage.status, 303, await createUnboundPage.clone().text());
    const unboundPageId = decodeURIComponent(new URL(createUnboundPage.headers.get("location"), applicationProcess.origin).pathname.split("/").at(-1));
    const unboundWorkingCopy = await pool.query("select working_copy_revision from k_nex_workspace_pages where application_id=$1 and environment=$2 and page_id=$3", [applicationId, environmentName, unboundPageId]);
    assert.equal(unboundWorkingCopy.rowCount, 1);
    const publishUnboundPage = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(unboundPageId)}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ workingCopyRevision: unboundWorkingCopy.rows[0].working_copy_revision, idempotencyKey: `workspace-publish-unbound-${randomUUID()}` })
    });
    assert.equal(publishUnboundPage.status, 200, await publishUnboundPage.clone().text());
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(unboundPageId)}`, { headers: { cookie: restartedOwner.cookie.header } })).status, 200);
    const crossPageBefore = await salesRow("opportunity", String(beta.rows[0].id));
    const crossPage = await postPageAction(unboundPageId, salesOpportunityStageUpdateDescriptor.id, restartedOwner.cookie.header, opportunityInput(crossPageBefore, "lost"));
    assert.equal(crossPage.status, 404);
    assert.deepEqual(await crossPage.json(), { code: "NOT_FOUND" });
    assert.deepEqual(await salesRow("opportunity", String(beta.rows[0].id)), crossPageBefore, "A bound action cannot be replayed through another published page.");
    console.log("P12_ATK_13_CROSS_PAGE_ACTION_HTTP_POSTGRES_DENIED=PASS");

    const managerContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const managerPage = await managerContext.newPage();
    await managerPage.goto(`${applicationProcess.origin}/login`);
    await managerPage.getByLabel("Email").fill(managerEmail);
    await managerPage.getByLabel("Password").fill(managerPassword);
    await managerPage.getByRole("button", { name: "Sign in" }).click();
    await managerPage.waitForURL(`${applicationProcess.origin}/`);
    await managerPage.goto(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`);
    await managerPage.getByRole("region", { name: "Sales opportunity Kanban" }).waitFor();
    const managerEditorPage = await managerContext.newPage();
    const managerEditorResponse = await managerEditorPage.goto(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}/edit`);
    assert.equal(managerEditorResponse?.status(), 200, "An assigned editor must enter the current editor route.");
    await managerEditorPage.getByRole("region", { name: "Canvas block keyboard controls" }).waitFor();

    workerProcess = start("node", ["dist/k-nex-worker.js"], { cwd: application, env: applicationEnvironment });
    await until(async () => workerProcess.output().includes("K_NEX_WORKER_READY"), `Generated worker did not restart.\n${workerProcess.output()}`, workerProcess.child);
    await until(async () => (await pool.query("select count(*)::int as count from k_nex_workspace_page_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName])).rows[0].count === 0, "Workspace page outbox did not converge after worker restart.", workerProcess.child);
    await stop(workerProcess.child, "lost-notification boundary");
    workerProcess = undefined;
    const currentPageSession = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session`, { headers: { cookie: restartedOwner.cookie.header } });
    assert.equal(currentPageSession.status, 200);
    const currentPageState = await currentPageSession.json();
    const revokeAccess = new URLSearchParams({ expectedPageRevision: String(currentPageState.pageRevision), expectedAccessRevision: String(currentPageState.accessRevision), idempotencyKey: `workspace-revoke-${randomUUID()}` });
    revokeAccess.append("assignment", `user|${ownerUserId}|edit`);
    const revoke = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/access`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin }, body: revokeAccess
    });
    assert.equal(revoke.status, 303);
    await managerPage.getByRole("alert").getByText("Page access revoked", { exact: true }).waitFor({ timeout: 10_000 });
    await managerEditorPage.getByRole("alert").getByText("Editor access revoked", { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header } })).status, 404);
    const revokedNavigation = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header } });
    assert.equal((await revokedNavigation.text()).includes("Sales command center"), false, "Revoked page must leave current sidebar authority.");
    const revokedActionBefore = await salesRow("opportunity", String(beta.rows[0].id));
    const revokedAction = await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, manager.cookie.header, opportunityInput(revokedActionBefore, "lost"));
    assert.equal(revokedAction.status, 404);
    assert.deepEqual(await revokedAction.json(), { code: "NOT_FOUND" });
    assert.deepEqual(await salesRow("opportunity", String(beta.rows[0].id)), revokedActionBefore, "Revoked page access cannot execute a formerly bound Sales action.");
    console.log("P12_ATK_13_REVOKED_PAGE_ACTION_HTTP_POSTGRES_DENIED=PASS");
    const staleWorkingCopy = (await pool.query("select working_copy_revision from k_nex_workspace_pages where application_id=$1 and environment=$2 and page_id=$3", [applicationId, environmentName, pageId])).rows[0].working_copy_revision;
    const stalePublication = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/publish`, {
      method: "POST", headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ workingCopyRevision: staleWorkingCopy, idempotencyKey: `workspace-stale-publish-${randomUUID()}` })
    });
    assert.equal(stalePublication.status, 404, "Revoked editor publication authority cannot commit.");
    workerProcess = start("node", ["dist/k-nex-worker.js"], { cwd: application, env: applicationEnvironment });
    await until(async () => workerProcess.output().includes("K_NEX_WORKER_READY"), `Generated worker did not recover the lost page invalidation.\n${workerProcess.output()}`, workerProcess.child);
    await until(async () => (await pool.query("select count(*)::int as count from k_nex_workspace_page_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName])).rows[0].count === 0, "Lost workspace invalidation did not converge from the durable outbox.", workerProcess.child);
    console.log("P12_ATK_20_REVOKED_STALE_PUBLISH_AND_LOST_INVALIDATION_DENIED=PASS");

    const rollback = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ revisionId: firstPublishedRevisionId, idempotencyKey: `workspace-rollback-${randomUUID()}` })
    });
    assert.equal(rollback.status, 200);
    const rollbackBody = await rollback.json();
    assert.equal(rollbackBody.receipt.publishedRevisionId, firstPublishedRevisionId);
    await managerContext.close();

    const collapse = page.getByRole("button", { name: "Collapse sidebar" });
    await page.goto(`${applicationProcess.origin}/`);
    await collapse.focus();
    await page.keyboard.press("Enter");
    await page.locator('[data-k-nex-component="workspace-shell"][data-sidebar="collapsed"]').waitFor();
    await page.reload();
    await page.locator('[data-k-nex-component="workspace-shell"][data-sidebar="collapsed"]').waitFor();
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    assert.equal(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), true);

    await page.setViewportSize({ width: 375, height: 720 });
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    const openNavigation = page.getByRole("button", { name: "Open navigation" });
    await openNavigation.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Mobile workspace navigation" });
    await drawer.waitFor();
    assert.equal(await drawer.evaluate((element) => element.contains(document.activeElement)), true);
    const bounds = await page.locator(".workspace-drawer").boundingBox();
    assert.ok(bounds && bounds.x + bounds.width >= 374, "RTL drawer must anchor to logical start.");
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open navigation");
    assert.equal(await openNavigation.evaluate((element) => document.activeElement === element), true);
    await context.close();
    await browser.close();
    browser = undefined;

    await stop(workerProcess.child, "workspace worker restart boundary");
    workerProcess = undefined;
    await stop(applicationProcess.child, "durability restart boundary");
    applicationProcess = undefined;
    await pool.end();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    applicationProcess = await startApplication(application, applicationEnvironment);
    const durableOwner = await login(applicationProcess.origin, ownerEmail, ownerPassword);
    const durablePage = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: durableOwner.cookie.header } });
    assert.equal(durablePage.status, 200);
    const durableHtml = await durablePage.text();
    assert.match(durableHtml, /Sales task table/u);
    assert.equal(durableHtml.includes("Sales task table revised"), false, "Restart must serve the rolled-back publication.");
    const durablePointer = await pool.query("select pointer_json from k_nex_workspace_publication_pointers where application_id=$1 and environment=$2 and page_id=$3", [applicationId, environmentName, pageId]);
    assert.equal(durablePointer.rows[0].pointer_json.publishedRevisionId, firstPublishedRevisionId);
    const durableSales = await pool.query("select name, stage from sales_opportunities order by id");
    assert.deepEqual(durableSales.rows, [{ name: "Alpha renewal", stage: "qualified" }, { name: "Beta expansion", stage: "won" }]);
    console.log("P12_9_GENERATED_APP_POSTGRES_HTTP_CHROMIUM_EVIDENCE=PASS");
  } finally {
    await stop(workerProcess?.child).catch(() => {});
    await stop(applicationProcess?.child).catch(() => {});
    notificationClient?.release();
    await pool?.end().catch(() => {});
    await browser?.close().catch(() => {});
    await container.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
