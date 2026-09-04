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
import { salesOpportunitiesDescriptor, salesOpportunityStageUpdateDescriptor, salesTaskUpdateDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor } from "@k-nex/module-sales/contracts";
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

function revenueMetricNodeIdFromProjection(projection) {
  const revenueMetricNode = projection.document.regions.main.find((node) => node.bindings?.source?.source.id === salesTotalPotentialRevenueDescriptor.id);
  assert.ok(revenueMetricNode, "The projection must retain its bound Sales revenue metric.");
  return revenueMetricNode.id;
}

function assertRevenueMetricBinding(projection, { state, problemCode, problemStatus }, message) {
  const binding = projection.sourceResults[revenueMetricNodeIdFromProjection(projection)];
  assert.ok(binding, `${message} The bound Sales revenue metric result is missing.`);
  assert.equal(binding.state, state, `${message} The bound Sales revenue metric state must match.`);
  if (problemCode !== undefined) {
    assert.equal(binding.problem?.code, problemCode, `${message} The bound Sales revenue metric problem code must match.`);
    assert.equal(binding.problem?.status, problemStatus, `${message} The bound Sales revenue metric problem status must match.`);
  }
}

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

function crashedRun(command, arguments_, options) {
  try {
    run(command, arguments_, options);
  } catch (error) {
    assert.equal(error.status, 86, "Bootstrap crash injection must stop immediately after its committed boundary.");
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
  const applicationProcess = start(process.execPath, [realpathSync(join(application, "node_modules", "next", "dist", "bin", "next")), "start"], { cwd: application, env: { ...applicationEnvironment, PORT: String(port) } });
  await until(async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).ok, `Generated application did not start.\n${applicationProcess.output()}`, applicationProcess.child);
  return { ...applicationProcess, origin: `http://127.0.0.1:${port}` };
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

    const resetBootstrapState = async () => {
      await pool.query("drop schema public cascade; create schema public;");
      run("pnpm", ["knex:migrate"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    };
    for (const boundary of ["protected-owner", "sales-authority", "token-consumption"]) {
      await resetBootstrapState();
      const crashTokenFile = join(root, `crash-${boundary}.token`);
      const staleCrashTokenFile = join(root, `crash-stale-${boundary}.token`);
      run("pnpm", ["knex:issue-bootstrap-token", "--output", staleCrashTokenFile], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
      run("pnpm", ["knex:issue-bootstrap-token", "--output", crashTokenFile], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
      crashedRun("pnpm", ["knex:bootstrap-owner", "--token-file", crashTokenFile], {
        cwd: application,
        env: { ...ownerEnvironment, NODE_ENV: "test", K_NEX_BOOTSTRAP_CRASH_AFTER_COMMIT: boundary },
        stdio: "pipe"
      });
      assert.equal(existsSync(crashTokenFile), boundary !== "token-consumption", `${boundary} crash must leave exactly the recoverable token-file state.`);
      assert.equal((await pool.query("select count(*)::int as count from users")).rows[0].count, 1, `${boundary} crash must commit exactly the intended owner.`);
      const differentToken = failedRun("pnpm", ["knex:bootstrap-owner", "--token-file", staleCrashTokenFile], { cwd: application, env: staleOwnerEnvironment, stdio: "pipe" });
      assert.match(differentToken, /Bootstrap token is unavailable, expired, or consumed/u);
      if (boundary !== "token-consumption") {
        const differentActor = failedRun("pnpm", ["knex:bootstrap-owner", "--token-file", crashTokenFile], { cwd: application, env: staleOwnerEnvironment, stdio: "pipe" });
        assert.match(differentActor, /Bootstrap receipt does not match the issued owner/u);
        assert.equal((await pool.query("select count(*)::int as count from users")).rows[0].count, 1, "A mismatched resume actor cannot create a user.");
      }
      if (boundary === "protected-owner") {
        const priorReceipt = (await pool.query("select protected_baseline_digest from k_nex_authorization_bootstrap_receipts where application_id=$1", [applicationId])).rows[0];
        assert.ok(priorReceipt);
        await pool.query("update k_nex_authorization_bootstrap_receipts set protected_baseline_digest=$2 where application_id=$1", [applicationId, `sha256:${"0".repeat(64)}`]);
        const differentReceipt = failedRun("pnpm", ["knex:bootstrap-owner", "--token-file", crashTokenFile], { cwd: application, env: ownerEnvironment, stdio: "pipe" });
        assert.match(differentReceipt, /Bootstrap receipt does not match the issued owner/u);
        await pool.query("update k_nex_authorization_bootstrap_receipts set protected_baseline_digest=$2 where application_id=$1", [applicationId, priorReceipt.protected_baseline_digest]);
      }
      if (boundary === "token-consumption") {
        assert.equal((await pool.query("select count(*)::int as count from k_nex_owner_bootstrap_tokens where application_id=$1 and environment=$2 and consumed_at is null", [applicationId, environmentName])).rows[0].count, 0, "Token-consumption crash must leave no active bootstrap token.");
      } else {
        const resumed = run("pnpm", ["knex:bootstrap-owner", "--token-file", crashTokenFile], { cwd: application, env: ownerEnvironment, stdio: "pipe" });
        assert.match(resumed, /K_NEX_OWNER_BOOTSTRAP_PASS bootstrap\.receipt\./u);
        assert.equal(existsSync(crashTokenFile), false, `${boundary} recovery must consume and remove the exact issued token.`);
      }
      const recovered = run("pnpm", ["knex:doctor"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
      assert.match(recovered, /K_NEX_APPLICATION_READY/u);
      console.log(`P12_BOOTSTRAP_CRASH_${boundary.toUpperCase().replaceAll("-", "_")}_RECOVERY=PASS`);
    }
    await resetBootstrapState();

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
    const ownerSalesOverview = await fetch(`${applicationProcess.origin}/sales`, { headers: { cookie: owner.cookie.header } });
    const ownerSalesOverviewHtml = await ownerSalesOverview.text();
    assert.equal(ownerSalesOverview.status, 200, `The generated static Sales overview route must be available to the authorized owner.\nbody=${ownerSalesOverviewHtml}\nprocess=${applicationProcess.output()}`);
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

    const pageSession = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session?mode=edit`, { headers: { cookie: owner.cookie.header } });
    assert.equal(pageSession.status, 200, `${await pageSession.clone().text()}\n${applicationProcess.output()}`);
    const pageState = await pageSession.json();
    const assignTheme = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/metadata`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: owner.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({
        expectedRevision: String(pageState.projection.watermark.pageRevision), title: "Sales command center", description: "Bounded Sales workspace",
        parentNavigationId: "sales.navigation.root", order: "100", themeRevision: `${inventoryBody.theme.profileId}|${inventoryBody.theme.activeRevisionId}`,
        idempotencyKey: `workspace-theme-${randomUUID()}`
      })
    });
    assert.equal(assignTheme.status, 303, `${await assignTheme.clone().text()}\n${applicationProcess.output()}`);

    const store = new PostgresAuthorizationStore(pool, {
      validate: (requestedApplicationId, subject) => requestedApplicationId === applicationId && subject.kind === "user" && [ownerUserId, limitedUserId, managerUserId].includes(subject.id) ? "accepted" : "rejected"
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
    const templateDeniedNavigation = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header } });
    assert.equal(templateDeniedNavigation.status, 200);
    const templateDeniedHtml = await templateDeniedNavigation.text();
    assert.equal(templateDeniedHtml.includes('href="/sales/settings"'), false, "A missing Sales template permission must hide its route navigation.");
    assert.equal(templateDeniedHtml.includes('href="/sales/tasks"'), true, "Other currently authorized Sales template navigation must remain visible.");
    assert.equal((await fetch(`${applicationProcess.origin}/sales/settings`, { headers: { cookie: manager.cookie.header } })).status, 404, "A missing Sales template permission must deny the direct static route.");
    const deniedRouteActionTitle = "Denied without Sales task write";
    const deniedRouteActionBefore = (await pool.query("select count(*)::int as count from sales_tasks where title=$1", [deniedRouteActionTitle])).rows[0].count;
    const deniedRouteAction = await fetch(`${applicationProcess.origin}/api/k-nex/sales/actions/${encodeURIComponent("sales.task.create")}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ input: { title: deniedRouteActionTitle }, idempotencyKey: `denied-sales-route-action-${randomUUID()}` })
    });
    assert.equal(deniedRouteAction.status, 403, "A current Sales route action must require its exact action permission.");
    assert.equal((await pool.query("select count(*)::int as count from sales_tasks where title=$1", [deniedRouteActionTitle])).rows[0].count, deniedRouteActionBefore, "Denied route action authority must write nothing.");
    console.log("P12_SALES_TEMPLATE_PERMISSION_NAVIGATION_AND_DIRECT_ROUTE_DENIED=PASS");

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
    await until(async () => notificationTypes.has("authorization") && notificationTypes.has("workspace-page"), "Generated worker did not publish both invalidation classes.", workerProcess.child).catch(async (error) => {
      const outbox = await pool.query("select operation_kind, status, attempt_count, last_error_code from k_nex_workspace_page_outbox where application_id=$1 and environment=$2 order by created_at", [applicationId, environmentName]);
      throw new Error(`${error}\nnotifications=${JSON.stringify([...notificationTypes])}\noutbox=${JSON.stringify(outbox.rows)}\nworker=${workerProcess.output()}`);
    });
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

    const themedPageSession = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session?mode=edit`, { headers: { cookie: restartedOwner.cookie.header } });
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
    const access = new URLSearchParams({ expectedPageRevision: String(themedPageState.projection.watermark.pageRevision), expectedAccessRevision: String(themedPageState.projection.watermark.accessRevision), idempotencyKey: `workspace-access-${randomUUID()}` });
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

    const salesNavigation = page.getByRole("navigation", { name: "Workspace navigation" });
    for (const [navigationId, label, href, templateRole, templateLabel] of [
      ["sales.navigation.overview", "Overview", "/sales", "status", "Total potential revenue"],
      ["sales.navigation.tasks", "Tasks", "/sales/tasks", "table", "Sales tasks"],
      ["sales.navigation.opportunities", "Opportunities", "/sales/opportunities", "region", "Opportunities"],
      ["sales.navigation.settings", "Settings", "/sales/settings", "region", "Sales settings"]
    ]) {
      const link = salesNavigation.locator(`[data-navigation-node="${navigationId}"]`).getByRole("link", { name: label });
      await link.waitFor();
      assert.equal(await link.getAttribute("href"), href, `${navigationId} must originate from the module.sales static registration.`);
      await page.goto(`${applicationProcess.origin}${href}`);
      await page.getByRole(templateRole, { name: templateLabel }).waitFor();
    }
    await page.goto(`${applicationProcess.origin}/sales/tasks`);
    await page.getByRole("textbox", { name: "Title" }).fill("Registered route action task");
    await page.getByRole("button", { name: "Create task" }).click();
    await page.getByText("Registered route action task", { exact: true }).waitFor();
    assert.equal((await pool.query("select count(*)::int as count from sales_tasks where title=$1", ["Registered route action task"])).rows[0].count, 1, "A registered Sales route action must commit with current action authority.");
    assert.equal((await fetch(`${applicationProcess.origin}/sales/unregistered`, { headers: { cookie: restartedOwner.cookie.header } })).status, 404, "Only the four static Sales routes may resolve.");
    console.log("P12_REGISTERED_SALES_ROUTES_AND_ACTION_POSTGRES_HTTP_CHROMIUM=PASS");

    let lostEditorPoll = false;
    let falseEditorDenial = false;
    const editorPollTraffic = [];
    const editorPollPattern = `**/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session?mode=edit*`;
    page.on("response", (response) => { if (response.url().includes(`/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session?mode=edit`)) editorPollTraffic.push(`response:${response.status()}`); });
    page.on("requestfailed", (request) => { if (request.url().includes(`/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session?mode=edit`)) editorPollTraffic.push(`failed:${request.failure()?.errorText ?? "unknown"}`); });
    await page.route(editorPollPattern, async (route) => {
      if (!lostEditorPoll) {
        lostEditorPoll = true;
        return route.abort("failed");
      }
      if (!falseEditorDenial) {
        falseEditorDenial = true;
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "NOT_FOUND" }) });
      }
      return route.continue();
    });
    let lostAutosaveResponse = false;
    const autosaveTraffic = [];
    page.on("response", (response) => { if (response.url().endsWith(`/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/autosave`)) autosaveTraffic.push(`response:${response.status()}`); });
    page.on("requestfailed", (request) => { if (request.url().endsWith(`/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/autosave`)) autosaveTraffic.push(`failed:${request.failure()?.errorText ?? "unknown"}`); });
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
    try { await page.getByText("All changes saved.", { exact: true }).waitFor({ timeout: 15_000 }); }
    catch (error) { throw new Error(`${error}\neditorPoll=${JSON.stringify(editorPollTraffic)}\nautosave=${JSON.stringify(autosaveTraffic)}\nui=${await page.locator("body").innerText()}\nprocess=${applicationProcess.output()}`); }
    assert.equal(lostEditorPoll, true);
    assert.equal(falseEditorDenial, true);
    await page.unroute(editorPollPattern);
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
    assert.equal(await page.locator('[data-k-nex-component="workspace-shell"]').getAttribute("data-k-nex-theme-profile"), inventoryBody.theme.activeRevisionId);

    const workspacePageUrl = `${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`;
    const workspacePageSessionUrl = `${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session`;
    const budgetHeaders = { cookie: restartedOwner.cookie.header };
    assert.equal((await fetch(workspacePageUrl, { headers: budgetHeaders })).status, 200, "The authorized owner must have a working source request before budget exhaustion.");
    const holdSalesMetricRequests = async (count) => {
      const lock = await pool.connect();
      let released = false;
      try {
        await lock.query("begin");
        await lock.query("lock table sales_tasks in access exclusive mode");
      } catch (error) {
        lock.release();
        throw error;
      }
      const requests = Array.from({ length: count }, () => fetch(workspacePageUrl, { headers: budgetHeaders }).then(async (response) => {
        await response.text();
        return response.status;
      }));
      return {
        requests,
        async release() {
          if (released) return;
          released = true;
          await lock.query("rollback");
          lock.release();
        }
      };
    };
    const concurrent = await holdSalesMetricRequests(4);
    try {
      const deadline = Date.now() + 15_000;
      let blockedSalesQueries = 0;
      while (Date.now() < deadline) {
        const blocked = await pool.query(`
          select count(*)::integer as count
          from pg_stat_activity
          where datname=current_database()
            and pid<>pg_backend_pid()
            and state='active'
            and wait_event_type='Lock'
            and query ilike '%sales_tasks%'
        `);
        blockedSalesQueries = blocked.rows[0]?.count ?? 0;
        if (blockedSalesQueries >= 4) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      assert.equal(blockedSalesQueries >= 4, true, "Four high-cost metric requests must reach the held Sales query lock before concurrency exhaustion is tested.");
      const exhaustedRequest = fetch(workspacePageSessionUrl, { headers: budgetHeaders });
      const fifthDeadline = Date.now() + 15_000;
      let fifthBlockedSalesQueries = blockedSalesQueries;
      while (Date.now() < fifthDeadline) {
        const blocked = await pool.query(`
          select count(*)::integer as count
          from pg_stat_activity
          where datname=current_database()
            and pid<>pg_backend_pid()
            and state='active'
            and wait_event_type='Lock'
            and query ilike '%sales_tasks%'
        `);
        fifthBlockedSalesQueries = blocked.rows[0]?.count ?? 0;
        if (fifthBlockedSalesQueries >= 5) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      assert.equal(fifthBlockedSalesQueries >= 5, true, "The fifth direct view session must record its high-cost concurrency result before its next bound source waits on the held Sales lock.");
      await concurrent.release();
      const exhausted = await exhaustedRequest;
      assert.equal(exhausted.status, 200, `The fifth direct view session must preserve its binding-level concurrency state when the Sales query lock releases.\n${await exhausted.clone().text()}\n${applicationProcess.output()}`);
      const exhaustedSession = await exhausted.json();
      const concurrencyLimitedBindings = Object.values(exhaustedSession.projection.sourceResults).filter((binding) => binding.state === "rate-limited" && binding.problem?.code === "QUERY_CONCURRENCY_EXCEEDED" && binding.problem?.status === 429);
      assert.equal(concurrencyLimitedBindings.length, 1, "Exactly one bound high-cost metric must report the shared four-query concurrency ceiling.");
      assertRevenueMetricBinding(exhaustedSession.projection, { state: "rate-limited", problemCode: "QUERY_CONCURRENCY_EXCEEDED", problemStatus: 429 }, "The fifth direct view session must map the named Sales revenue metric to the shared concurrency limit.");
    } finally {
      await concurrent.release();
    }
    await Promise.all(concurrent.requests);

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
    const pageAclOnlySource = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: limited.cookie.header } });
    assert.equal(pageAclOnlySource.status, 200, "Exact page view access must not grant Sales source or record authority.");
    const pageAclOnlySourceHtml = await pageAclOnlySource.text();
    assert.match(pageAclOnlySourceHtml, /Unavailable: PERMISSION_DENIED/u);
    assert.equal(pageAclOnlySourceHtml.includes("Alpha renewal"), false, "Page ACL cannot expose Sales records through a registered source.");
    console.log("P12_ATK_07_PAGE_ACL_ONLY_SALES_SOURCE_AND_RECORD_HTTP_POSTGRES_DENIED=PASS");

    const fieldAuthority = await store.readState(applicationId, environmentName);
    assert.ok(fieldAuthority);
    await store.transaction(expected(fieldAuthority), async (transaction) => {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.sales-field-limited", applicationId, label: "Sales field limited", revision: 0 } });
      for (const permissionId of ["sales.tasks.read", "sales.tasks.title.read"]) {
        await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: `customer.sales-field-limited.${permissionId}`, applicationId, roleId: "customer.sales-field-limited", permissionId, owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: 0 } });
      }
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.sales-field-limited.assignment", applicationId, roleId: "customer.sales-field-limited", principal: { kind: "user", id: limitedUserId }, state: "active", revision: 0 } });
    });
    const fieldDeniedSource = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: limited.cookie.header } });
    assert.equal(fieldDeniedSource.status, 200);
    const fieldDeniedSourceHtml = await fieldDeniedSource.text();
    assert.match(fieldDeniedSourceHtml, /Unavailable: SOURCE_FIELD_PERMISSION_DENIED/u);
    assert.equal(fieldDeniedSourceHtml.includes("Prepare Alpha proposal"), false, "A source field denial cannot expose task rows.");
    console.log("P12_ATK_07_PAGE_ACL_ONLY_SALES_FIELD_HTTP_POSTGRES_DENIED=PASS");

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
    const managerPublishedNavigationLink = managerPage.locator('[data-navigation-node="sales.navigation.root"]').getByRole("link", { name: "Sales command center" });
    await managerPublishedNavigationLink.waitFor();
    const managerEditorPage = await managerContext.newPage();
    const managerEditorResponse = await managerEditorPage.goto(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}/edit`);
    assert.equal(managerEditorResponse?.status(), 200, "An assigned editor must enter the current editor route.");
    await managerEditorPage.getByRole("region", { name: "Canvas block keyboard controls" }).waitFor();

    const managerSalesAuthority = await store.readState(applicationId, environmentName);
    assert.ok(managerSalesAuthority);
    await store.transaction(expected(managerSalesAuthority), async (transaction) => {
      for (const permissionId of ["sales.opportunities.read", "sales.tasks.title.read", "sales.opportunities.write"]) {
        await transaction.removeGrant(applicationId, `customer.sales-manager.${permissionId}`);
      }
    });
    const revokedSalesPage = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header } });
    const revokedSalesHtml = await revokedSalesPage.text();
    assert.equal(revokedSalesPage.status, 200, "Revoking Sales authority must not revoke the granted page ACL.");
    const managerRuntime = managerPage.locator("section[data-k-nex-theme-profile]");
    try { await managerRuntime.filter({ hasText: "Unavailable: PERMISSION_DENIED" }).waitFor({ timeout: 10_000 }); }
    catch (error) { throw new Error(`${error}\nserver=${revokedSalesHtml}\nbrowser=${await managerPage.locator("body").innerText()}\nprocess=${applicationProcess.output()}`); }
    await managerRuntime.filter({ hasText: "Unavailable: SOURCE_FIELD_PERMISSION_DENIED" }).waitFor({ timeout: 10_000 });
    assert.equal(await managerPage.getByText("Alpha renewal", { exact: true }).count(), 0, "An already-open page cannot retain revoked Sales source data.");
    assert.equal(await managerPage.locator(`[data-opportunity-id="${String(alpha.rows[0].id)}"]`).getByRole("button", { name: "Move to qualified" }).count(), 0, "An already-open page cannot retain revoked Sales actions.");
    await managerEditorPage.getByRole("alert").getByText("Editor authority changed", { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await managerEditorPage.getByRole("region", { name: "Canvas block keyboard controls" }).count(), 0, "An already-open editor must fail closed after its Sales authority changes.");
    console.log("P12_ATK_20_OPEN_PAGE_AND_EDITOR_SALES_AUTHORITY_REVOCATION_POSTGRES_HTTP_CHROMIUM_DENIED=PASS");
    const revokedManagerSalesAuthority = await store.readState(applicationId, environmentName);
    assert.ok(revokedManagerSalesAuthority);
    await store.transaction(expected(revokedManagerSalesAuthority), async (transaction) => {
      for (const permissionId of ["sales.opportunities.read", "sales.tasks.title.read", "sales.opportunities.write", "sales.settings.read", "sales.tasks.write"]) {
        await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: `customer.sales-manager.${permissionId}`, applicationId, roleId: "customer.sales-manager", permissionId, owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: 0 } });
      }
    });
    const managerSalesRoutePage = await managerContext.newPage();
    await managerSalesRoutePage.goto(`${applicationProcess.origin}/sales/tasks`);
    await managerSalesRoutePage.getByRole("form", { name: "Create task" }).waitFor();
    const revokedRouteAuthority = await store.readState(applicationId, environmentName);
    assert.ok(revokedRouteAuthority);
    await store.transaction(expected(revokedRouteAuthority), async (transaction) => {
      for (const permissionId of ["sales.tasks.read", "sales.tasks.write"]) await transaction.removeGrant(applicationId, `customer.sales-manager.${permissionId}`);
    });
    await managerSalesRoutePage.getByRole("alert").getByText("Sales route unavailable", { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await managerSalesRoutePage.getByRole("form", { name: "Create task" }).count(), 0, "An open registered Sales route must clear its action after permission revocation.");
    const revokedRouteActionTitle = "Denied from open registered Sales route";
    const revokedRouteAction = await fetch(`${applicationProcess.origin}/api/k-nex/sales/actions/${encodeURIComponent("sales.task.create")}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ input: { title: revokedRouteActionTitle }, idempotencyKey: `revoked-open-sales-route-${randomUUID()}` })
    });
    assert.equal(revokedRouteAction.status, 403);
    assert.equal((await pool.query("select count(*)::int as count from sales_tasks where title=$1", [revokedRouteActionTitle])).rows[0].count, 0, "A revoked open Sales route action must write nothing.");
    const restoredRouteAuthority = await store.readState(applicationId, environmentName);
    assert.ok(restoredRouteAuthority);
    await store.transaction(expected(restoredRouteAuthority), async (transaction) => {
      for (const permissionId of ["sales.tasks.read", "sales.tasks.write"]) await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: `customer.sales-manager.${permissionId}`, applicationId, roleId: "customer.sales-manager", permissionId, owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: 0 } });
    });
    await managerSalesRoutePage.close();
    console.log("P12_OPEN_REGISTERED_SALES_ROUTE_PERMISSION_REVOCATION_POSTGRES_HTTP_CHROMIUM_DENIED=PASS");
    await managerEditorPage.reload();
    await managerEditorPage.getByRole("region", { name: "Canvas block keyboard controls" }).waitFor();

    workerProcess = start("node", ["dist/k-nex-worker.js"], { cwd: application, env: applicationEnvironment });
    await until(async () => workerProcess.output().includes("K_NEX_WORKER_READY"), `Generated worker did not restart.\n${workerProcess.output()}`, workerProcess.child);
    await until(async () => (await pool.query("select count(*)::int as count from k_nex_workspace_page_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName])).rows[0].count === 0, "Workspace page outbox did not converge after worker restart.", workerProcess.child);
    await stop(workerProcess.child, "lost-notification boundary");
    workerProcess = undefined;
    const currentPageSession = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session`, { headers: { cookie: restartedOwner.cookie.header } });
    assert.equal(currentPageSession.status, 200);
    const currentPageState = await currentPageSession.json();
    const revokeAccess = new URLSearchParams({ expectedPageRevision: String(currentPageState.projection.watermark.pageRevision), expectedAccessRevision: String(currentPageState.projection.watermark.accessRevision), idempotencyKey: `workspace-revoke-${randomUUID()}` });
    revokeAccess.append("assignment", `user|${ownerUserId}|edit`);
    const revoke = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/access`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin }, body: revokeAccess
    });
    assert.equal(revoke.status, 303);
    await managerPage.getByRole("alert").getByText("Page access revoked", { exact: true }).waitFor({ timeout: 10_000 });
    await managerEditorPage.getByRole("alert").getByText("Editor access revoked", { exact: true }).waitFor({ timeout: 10_000 });
    await managerPublishedNavigationLink.waitFor({ state: "detached", timeout: 10_000 });
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
    assert.equal(await managerPublishedNavigationLink.count(), 0, "Recovered invalidation must keep the already-open sidebar converged.");
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

    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header } })).status, 404, "A non-owner with current workspace permission still needs exact page ACL.");
    const durableStore = new PostgresAuthorizationStore(pool, {
      validate: (requestedApplicationId, subject) => requestedApplicationId === applicationId && subject.kind === "user" && [ownerUserId, limitedUserId, managerUserId].includes(subject.id) ? "accepted" : "rejected"
    });
    const ownerHandoffState = await durableStore.readState(applicationId, environmentName);
    assert.ok(ownerHandoffState);
    await durableStore.transaction(expected(ownerHandoffState), async (transaction) => {
      const formerOwner = (await transaction.listAssignments(applicationId, { kind: "user", id: ownerUserId })).find((assignment) => assignment.roleId === "system.role.owner" && assignment.state === "active");
      assert.ok(formerOwner);
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "owner-handoff-manager", applicationId, roleId: "system.role.owner", principal: { kind: "user", id: managerUserId }, state: "active", revision: 0 } });
      await transaction.write({ kind: "assignment", assignment: { ...formerOwner, state: "revoked", revision: formerOwner.revision + 1 } });
    });
    assert.equal((await fetch(`${applicationProcess.origin}/api/readiness`)).status, 200, "Readiness must accept a valid current owner after bootstrap-owner handoff.");
    assert.equal(salesTotalPotentialRevenueDescriptor.limits.costClass, "high");
    assert.equal(salesTotalPotentialRevenueDescriptor.limits.burst, 30);
    const fetchViewSession = (targetPageId) => fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(targetPageId)}/session`, {
      headers: { cookie: manager.cookie.header }, signal: AbortSignal.timeout(15_000)
    });
    const managerControlSession = await fetchViewSession(pageId);
    assert.equal(managerControlSession.status, 200, `The restarted application must admit the current owner's small control session before rate exhaustion.\n${await managerControlSession.clone().text()}\n${applicationProcess.output()}`);
    const managerControlProjection = (await managerControlSession.json()).projection;
    assert.equal(managerControlProjection.sourceResults !== undefined, true, "The small control session must load its bound sources.");
    assertRevenueMetricBinding(managerControlProjection, { state: "success" }, "The initial clean control session must succeed for the named Sales revenue metric.");
    const createRatePage = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({ title: "Sales rate budget", description: "Temporary high-cost rate proof", parentNavigationId: "sales.navigation.root", order: "102", themeRevision: "", idempotencyKey: `workspace-rate-budget-${randomUUID()}` })
    });
    assert.equal(createRatePage.status, 303, await createRatePage.clone().text());
    const ratePageId = decodeURIComponent(new URL(createRatePage.headers.get("location"), applicationProcess.origin).pathname.split("/").at(-1));
    const ratePageSession = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(ratePageId)}/session?mode=edit`, { headers: { cookie: manager.cookie.header } });
    assert.equal(ratePageSession.status, 200, await ratePageSession.clone().text());
    const ratePageProjection = await ratePageSession.json();
    const rateMetricNodes = [{
      id: "rate-metric", type: "sales.revenue-metric", version: 1, props: { title: "Rate metric" },
      bindings: { source: { source: { id: salesTotalPotentialRevenueDescriptor.id, version: salesTotalPotentialRevenueDescriptor.version }, input: {}, structuralCompatibilityHash: salesTotalPotentialRevenueDescriptor.structuralCompatibilityHash } }
    }];
    const rateAutosave = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(ratePageId)}/autosave`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({
        expectedRevision: ratePageProjection.projection.workingCopy.revision,
        editorSessionId: `workspace-rate-budget-${randomUUID()}`,
        idempotencyKey: `workspace-rate-budget-${randomUUID()}`,
        document: {
          ...ratePageProjection.projection.workingCopy.document,
          version: ratePageProjection.projection.workingCopy.revision + 1,
          regions: { ...ratePageProjection.projection.workingCopy.document.regions, main: rateMetricNodes }
        }
      })
    });
    assert.equal(rateAutosave.status, 200, await rateAutosave.clone().text());
    const savedRatePageSession = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(ratePageId)}/session?mode=edit`, { headers: { cookie: manager.cookie.header } });
    assert.equal(savedRatePageSession.status, 200, await savedRatePageSession.clone().text());
    const savedRatePageProjection = await savedRatePageSession.json();
    const publishRatePage = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(ratePageId)}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ workingCopyRevision: savedRatePageProjection.projection.workingCopy.revision, idempotencyKey: `workspace-rate-budget-${randomUUID()}` })
    });
    assert.equal(publishRatePage.status, 200, await publishRatePage.clone().text());
    const inspectRateSession = (projection, message) => {
      const binding = projection.sourceResults[revenueMetricNodeIdFromProjection(projection)];
      assert.ok(binding, `${message} The one-node Sales revenue metric result is missing.`);
      assert.equal(binding.problem?.code === "QUERY_CONCURRENCY_EXCEEDED", false, `${message} The one-node rate proof must never report a concurrency failure.`);
      if (binding.state === "rate-limited") {
        assertRevenueMetricBinding(projection, { state: "rate-limited", problemCode: "QUERY_RATE_EXCEEDED", problemStatus: 429 }, message);
        return true;
      }
      assertRevenueMetricBinding(projection, { state: "success" }, message);
      return false;
    };
    let exhaustedControlProjection;
    const rateDeadline = Date.now() + 30_000;
    for (let wave = 0; wave < 16 && exhaustedControlProjection === undefined && Date.now() < rateDeadline; wave += 1) {
      const requests = Array.from({ length: 4 }, () => fetchViewSession(ratePageId).then(async (response) => {
        assert.equal(response.status, 200, `A one-node rate-budget session must preserve its binding-level source state.\n${await response.clone().text()}\n${applicationProcess.output()}`);
        return (await response.json()).projection;
      }));
      const pending = new Set();
      for (const request of requests) {
        let completion;
        completion = request.then((projection) => ({ completion, projection }));
        pending.add(completion);
      }
      try {
        while (pending.size > 0 && exhaustedControlProjection === undefined) {
          const settled = await Promise.race(pending);
          pending.delete(settled.completion);
          if (!inspectRateSession(settled.projection, "Each four-request rate-budget wave must return only a success or exact rate-limit binding.")) continue;
          const control = await fetchViewSession(ratePageId);
          assert.equal(control.status, 200, `The same one-node session must preserve its binding-level shared rate-limit state immediately.\n${await control.clone().text()}\n${applicationProcess.output()}`);
          exhaustedControlProjection = (await control.json()).projection;
          assert.equal(inspectRateSession(exhaustedControlProjection, "The immediate same-actor one-node control session must observe the shared rate limit."), true);
        }
      } finally {
        const completed = await Promise.allSettled(requests);
        for (const result of completed) {
          assert.equal(result.status, "fulfilled", `Every one-node rate-budget request must complete.\n${result.status === "rejected" ? String(result.reason) : ""}`);
          if (result.status === "fulfilled") inspectRateSession(result.value, "Every completed rate-budget request must return only a success or exact rate-limit binding.");
        }
      }
    }
    assert.ok(exhaustedControlProjection, "Bounded four-request waves must exhaust the shared high-cost rate bucket before the rate-proof deadline.");
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_100));
    const refilledControlSession = await fetchViewSession(ratePageId);
    assert.equal(refilledControlSession.status, 200, `The same one-node session must recover after one high-cost source rate token refills.\n${await refilledControlSession.clone().text()}\n${applicationProcess.output()}`);
    const refilledControlProjection = await refilledControlSession.json();
    assert.equal(inspectRateSession(refilledControlProjection.projection, "The same one-node Sales revenue metric must succeed after its high-cost source token refills."), false);
    console.log("P12_QUERY_BUDGET_PROCESS_LIFETIME_HTTP_RATE_AND_CONCURRENCY=PASS");
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: durableOwner.cookie.header } })).status, 404, "A former owner with page ACL but no current platform permission must be denied.");
    const formerOwnerAccessState = await durableStore.readState(applicationId, environmentName);
    assert.ok(formerOwnerAccessState);
    await durableStore.transaction(expected(formerOwnerAccessState), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.workspace-viewer.former-owner", applicationId, roleId: "customer.workspace-viewer", principal: { kind: "user", id: ownerUserId }, state: "active", revision: 0 } });
    });
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: durableOwner.cookie.header } })).status, 200, "A former owner needs both current platform permission and exact page ACL.");
    console.log("P12_CURRENT_OWNER_OVERRIDE_AND_FORMER_OWNER_ACL_POSTGRES=PASS");
    browser = await chromium.launch({ headless: true });
    const retiredRouteContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const retiredRoutePage = await retiredRouteContext.newPage();
    await retiredRoutePage.goto(`${applicationProcess.origin}/login`);
    await retiredRoutePage.getByLabel("Email").fill(managerEmail);
    await retiredRoutePage.getByLabel("Password").fill(managerPassword);
    await retiredRoutePage.getByRole("button", { name: "Sign in" }).click();
    await retiredRoutePage.waitForURL(`${applicationProcess.origin}/`);
    await retiredRoutePage.goto(`${applicationProcess.origin}/sales/tasks`);
    await retiredRoutePage.getByRole("form", { name: "Create task" }).waitFor();
    const managerSalesNavigationBeforeRetirement = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header } });
    assert.equal(managerSalesNavigationBeforeRetirement.status, 200);
    const managerSalesHtmlBeforeRetirement = await managerSalesNavigationBeforeRetirement.text();
    for (const href of ["/sales", "/sales/tasks", "/sales/opportunities", "/sales/settings"]) {
      assert.equal(managerSalesHtmlBeforeRetirement.includes(`href=\"${href}\"`), true, `Current Sales authority must expose ${href} before retirement.`);
      assert.equal((await fetch(`${applicationProcess.origin}${href}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 200, `Current Sales authority must open ${href} before retirement.`);
    }
    const preRetirementActionTitle = "Current Sales route action task";
    const preRetirementAction = await fetch(`${applicationProcess.origin}/api/k-nex/sales/actions/${encodeURIComponent("sales.task.create")}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ input: { title: preRetirementActionTitle }, idempotencyKey: `current-sales-action-${randomUUID()}` })
    });
    assert.equal(preRetirementAction.status, 200, "The same actor must execute the registered Sales action before retirement.");
    assert.equal((await pool.query("select count(*)::int as count from sales_tasks where title=$1", [preRetirementActionTitle])).rows[0].count, 1);
    const retiringSalesState = await durableStore.readState(applicationId, environmentName);
    assert.ok(retiringSalesState);
    const retiredSalesState = (await durableStore.transaction(expected(retiringSalesState), async (transaction) => {
      const generation = (await transaction.listExtensionGenerations(applicationId)).find((candidate) =>
        candidate.owner.deliveryClass === "platform-plugin" && candidate.owner.extensionId === "module.sales" && candidate.owner.generation === 1
      );
      assert.ok(generation);
      await transaction.write({ kind: "extension-generation", generation: {
        ...generation,
        state: "retired",
        authorizationRevision: retiringSalesState.authorizationRevision,
        lifecycleRevision: retiringSalesState.lifecycleRevision + 1
      } });
    })).state;
    assert.deepEqual(retiredSalesState, { ...retiringSalesState, lifecycleRevision: retiringSalesState.lifecycleRevision + 1 }, "Retirement must use one expected-revision current-authority transition.");
    assert.equal((await fetch(`${applicationProcess.origin}/api/readiness`)).status, 200, "Readiness must retain the historical Sales generation after retirement.");
    await retiredRoutePage.getByRole("alert").getByText("Sales route unavailable", { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await retiredRoutePage.getByRole("form", { name: "Create task" }).count(), 0, "An open registered Sales route must clear its action after generation retirement.");
    await retiredRouteContext.close();
    const retiredSalesNavigation = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(retiredSalesNavigation.status, 200);
    const retiredSalesHtml = await retiredSalesNavigation.text();
    assert.match(retiredSalesHtml, /K-Nex workspace/u, "Retiring Sales must not deny the host workspace.");
    const retiredSystem = await fetch(`${applicationProcess.origin}/system/workspace-pages`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(retiredSystem.status, 200, "Retiring Sales must not redirect fixed System routes.");
    const retiredDependentPage = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(retiredDependentPage.status, 404, "A custom page depending on retired Sales must fail closed.");
    for (const href of ["/sales", "/sales/tasks", "/sales/opportunities", "/sales/settings"]) {
      assert.equal(retiredSalesHtml.includes(`href=\"${href}\"`), false, `Retiring current Sales generation must remove ${href} navigation.`);
      assert.equal((await fetch(`${applicationProcess.origin}${href}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 404, `Retiring current Sales generation must deny ${href}.`);
    }
    const retiredActionTitle = "Denied after Sales retirement";
    const retiredActionBefore = (await pool.query("select count(*)::int as count from sales_tasks where title=$1", [retiredActionTitle])).rows[0].count;
    const retiredAction = await fetch(`${applicationProcess.origin}/api/k-nex/sales/actions/${encodeURIComponent("sales.task.create")}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ input: { title: retiredActionTitle }, idempotencyKey: `retired-sales-action-${randomUUID()}` })
    });
    assert.equal(retiredAction.status, 400, "A retired current Sales generation must deny registered route actions.");
    assert.deepEqual(await retiredAction.json(), { code: "INVALID_INPUT" });
    assert.equal((await pool.query("select count(*)::int as count from sales_tasks where title=$1", [retiredActionTitle])).rows[0].count, retiredActionBefore, "Denied registered route action must write nothing.");
    console.log("P12_RETIRED_SALES_GENERATION_NAVIGATION_ROUTE_AND_ACTION_POSTGRES_DENIED=PASS");
    const restoringSalesState = await durableStore.readState(applicationId, environmentName);
    assert.ok(restoringSalesState);
    const restoredSalesState = (await durableStore.transaction(expected(restoringSalesState), async (transaction) => {
      const generation = (await transaction.listExtensionGenerations(applicationId)).find((candidate) =>
        candidate.owner.deliveryClass === "platform-plugin" && candidate.owner.extensionId === "module.sales" && candidate.owner.generation === 1
      );
      assert.ok(generation);
      await transaction.write({ kind: "extension-generation", generation: {
        ...generation,
        state: "current",
        authorizationRevision: restoringSalesState.authorizationRevision,
        lifecycleRevision: restoringSalesState.lifecycleRevision + 1
      } });
    })).state;
    assert.deepEqual(restoredSalesState, { ...restoringSalesState, lifecycleRevision: restoringSalesState.lifecycleRevision + 1 }, "Sales recovery must use one expected-revision current-authority transition.");
    assert.equal((await fetch(`${applicationProcess.origin}/api/readiness`)).status, 200, "Readiness must accept later valid Sales lifecycle recovery.");
    const restoredHost = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(restoredHost.status, 200, "Host workspace must remain available after Sales recovery.");
    const restoredSystem = await fetch(`${applicationProcess.origin}/system/workspace-pages`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(restoredSystem.status, 200, "Fixed system route must remain available after Sales lifecycle changes.");
    const restoredSales = await fetch(`${applicationProcess.origin}/sales/tasks`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(restoredSales.status, 200, "A valid later current Sales generation must restore its registered route.");
    const restoredNavigation = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal((await restoredNavigation.text()).includes('href="/sales/tasks"'), true, "A valid later current Sales generation must restore navigation.");
    const restoredActionTitle = "Recovered after Sales lifecycle transition";
    const restoredAction = await fetch(`${applicationProcess.origin}/api/k-nex/sales/actions/${encodeURIComponent("sales.task.create")}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ input: { title: restoredActionTitle }, idempotencyKey: `restored-sales-action-${randomUUID()}` }),
      redirect: "manual"
    });
    assert.equal(restoredAction.status, 200, "A valid later current Sales generation must restore registered actions.");
    assert.equal((await pool.query("select count(*)::int as count from sales_tasks where title=$1", [restoredActionTitle])).rows[0].count, 1);
    console.log("P12_LATER_SALES_GENERATION_RECOVERS_NAVIGATION_ROUTE_AND_ACTION_POSTGRES_HTTP=PASS");
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
