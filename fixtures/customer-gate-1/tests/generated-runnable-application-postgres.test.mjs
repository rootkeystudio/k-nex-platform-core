import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { applyCreateKnexApplication, planCreateKnexApplication } from "@k-nex/composition";
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

test("P12.4 generated app serves an authority-filtered accessible workspace shell", { timeout: 420_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("p12_generated").withStartupTimeout(120_000).start();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "p12-generated-auth-")));
  const application = join(root, "application");
  const foreignApplication = join(root, "foreign-application");
  const tokenFile = join(root, "owner.token");
  const replayTokenFile = join(root, "owner-replay.token");
  const ownerEmail = `owner-${randomUUID()}@example.test`;
  const ownerPassword = randomBytes(24).toString("base64url");
  const limitedEmail = `limited-${randomUUID()}@example.test`;
  const limitedPassword = randomBytes(24).toString("base64url");
  let applicationProcess;
  let workerProcess;
  let pool;
  let browser;
  try {
    const releaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"), "utf8"));
    const packageSource = { kind: "packed-mirror", directory: resolve(repositoryRoot, "fixtures/customer-gate-1/packages"), releaseManifest };
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
    run("pnpm", ["knex:migrate"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    run("pnpm", ["build"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });

    applicationProcess = await startApplication(application, applicationEnvironment);
    const beforeBootstrap = await fetch(`${applicationProcess.origin}/api/readiness`);
    assert.equal(beforeBootstrap.status, 503);
    const anonymous = await fetch(`${applicationProcess.origin}/`, { redirect: "manual" });
    assert.equal(anonymous.status, 307);
    assert.equal(anonymous.headers.get("location"), "/login");
    await stop(applicationProcess.child, "pre-bootstrap application");
    applicationProcess = undefined;

    const issueOutput = run("pnpm", ["knex:issue-bootstrap-token", "--output", tokenFile], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    assert.match(issueOutput, /K_NEX_BOOTSTRAP_TOKEN_ISSUED/u);
    assert.equal(statSync(tokenFile).mode & 0o077, 0);
    const token = readFileSync(tokenFile, "utf8").trim();
    assert.equal(issueOutput.includes(token), false);

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
    const replayOutput = failedRun("pnpm", ["knex:issue-bootstrap-token", "--output", replayTokenFile], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    assert.match(replayOutput, /First owner already exists/u);
    assert.equal(existsSync(replayTokenFile), false);

    const readinessOutput = run("pnpm", ["knex:readiness"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
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
    for (const secret of [ownerEmail, ownerPassword, limitedPassword]) assert.equal(ownerHtml.includes(secret), false);
    const inventory = await fetch(`${applicationProcess.origin}/api/k-nex/inventory`, { headers: { cookie: owner.cookie.header } });
    assert.equal(inventory.status, 200);
    assert.deepEqual((await inventory.json()).plugins, ["module.sales"]);
    assert.equal((await fetch(`${applicationProcess.origin}/sales`, { headers: { cookie: owner.cookie.header } })).status, 200);
    assert.equal((await fetch(`${applicationProcess.origin}/system/access/roles`, { headers: { cookie: owner.cookie.header } })).status, 200);

    const createLimited = await fetch(`${applicationProcess.origin}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie.header },
      body: JSON.stringify({ email: limitedEmail, password: limitedPassword })
    });
    assert.equal(createLimited.status, 201);
    const limitedUser = await createLimited.json();
    const limitedUserId = String(limitedUser.doc.id);

    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const store = new PostgresAuthorizationStore(pool, {
      validate: (requestedApplicationId, subject) => requestedApplicationId === applicationId && subject.kind === "user" && subject.id === limitedUserId ? "accepted" : "rejected"
    });
    const state = await store.readState(applicationId, environmentName);
    assert.ok(state);
    const granted = await store.transaction(expected(state), async (transaction) => {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.workspace-viewer", applicationId, label: "Workspace viewer", revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.workspace-viewer.read", applicationId, roleId: "customer.workspace-viewer", permissionId: "system.workspace-pages.read", owner: { kind: "platform", namespace: "system" }, revision: 0 } });
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.workspace-viewer.assignment", applicationId, roleId: "customer.workspace-viewer", principal: { kind: "user", id: limitedUserId }, state: "active", revision: 0 } });
    });
    const limited = await login(applicationProcess.origin, limitedEmail, limitedPassword);
    const limitedWorkspace = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: limited.cookie.header } });
    assert.equal(limitedWorkspace.status, 200);
    const limitedHtml = await limitedWorkspace.text();
    assert.equal(limitedHtml.includes("sales.route.overview"), false);
    assert.equal(limitedHtml.includes("/sales"), false);
    assert.equal((await fetch(`${applicationProcess.origin}/sales`, { headers: { cookie: limited.cookie.header } })).status, 404);
    assert.equal((await fetch(`${applicationProcess.origin}/api/k-nex/inventory`, { headers: { cookie: limited.cookie.header } })).status, 403);

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

    workerProcess = start("node", ["dist/k-nex-worker.js"], { cwd: application, env: applicationEnvironment });
    await until(async () => workerProcess.output().includes("K_NEX_WORKER_READY"), `Generated worker did not start.\n${workerProcess.output()}`, workerProcess.child);
    await until(async () => {
      const result = await pool.query("select count(*)::int as count from k_nex_authorization_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName]);
      return result.rows[0].count === 0;
    }, "Authorization outbox did not converge.", workerProcess.child);
    assert.equal(workerProcess.output().includes(ownerEmail) || workerProcess.output().includes(ownerPassword) || workerProcess.output().includes(limitedPassword), false);
    await stop(workerProcess.child, "authorization worker");
    workerProcess = undefined;

    await stop(applicationProcess.child, "application restart boundary");
    applicationProcess = await startApplication(application, applicationEnvironment);
    const restartedOwner = await login(applicationProcess.origin, ownerEmail, ownerPassword);
    assert.equal((await fetch(`${applicationProcess.origin}/`, { headers: { cookie: restartedOwner.cookie.header } })).status, 200);

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
    const collapse = page.getByRole("button", { name: "Collapse sidebar" });
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
    assert.equal(await openNavigation.evaluate((element) => document.activeElement === element), true);
    await context.close();
    browser = undefined;
  } finally {
    await stop(workerProcess?.child).catch(() => {});
    await stop(applicationProcess?.child).catch(() => {});
    await pool?.end().catch(() => {});
    await browser?.close().catch(() => {});
    await container.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
