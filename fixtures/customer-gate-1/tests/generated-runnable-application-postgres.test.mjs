import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer as createHttpsServer, request as requestHttps } from "node:https";
import { createServer as createNetServer } from "node:net";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { applyCreateKnexApplication, planCreateKnexApplication } from "@k-nex/composition";
import { PackageReleaseManifestSchema, canonicalJson } from "@k-nex/contracts";
import { salesOpportunitiesDescriptor, salesOpportunityListBlockDescriptor, salesOpportunityStageUpdateDescriptor, salesTaskUpdateDescriptor, salesTasksDescriptor } from "@k-nex/module-sales-current/contracts";
import { salesPuckBlockBridges } from "@k-nex/module-sales-current/puck";
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

function opportunityNodeIdFromProjection(projection) {
  const opportunityNode = projection.document.regions.main.find((node) => node.bindings?.source?.source.id === salesOpportunitiesDescriptor.id);
  assert.ok(opportunityNode, "The projection must retain its bound Sales opportunity source.");
  return opportunityNode.id;
}

function assertOpportunityBinding(projection, { state, problemCode, problemStatus }, message) {
  const binding = projection.sourceResults[opportunityNodeIdFromProjection(projection)];
  assert.ok(binding, `${message} The bound Sales opportunity result is missing.`);
  assert.equal(binding.state, state, `${message} The bound Sales opportunity state must match.`);
  if (problemCode !== undefined) {
    assert.equal(binding.problem?.code, problemCode, `${message} The bound Sales revenue metric problem code must match.`);
    assert.equal(binding.problem?.status, problemStatus, `${message} The bound Sales revenue metric problem status must match.`);
  }
}

async function unusedPort() {
  const server = createNetServer();
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.notEqual(typeof address, "string");
  const port = address.port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function startResponseLossRelay({ port, operatorPort, certificates }) {
  const requests = new Map();
  const responses = new Map();
  const dropped = new Set();
  let responseLossEnabled = false;
  const server = createHttpsServer({
    minVersion: "TLSv1.3",
    requestCert: true,
    rejectUnauthorized: true,
    cert: readFileSync(certificates.serverCert),
    key: readFileSync(certificates.serverKey),
    ca: readFileSync(certificates.caCert)
  }, (incoming, outgoing) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    incoming.once("end", () => {
      const body = Buffer.concat(chunks);
      let kind;
      try { kind = JSON.parse(body.toString("utf8")).kind; }
      catch { kind = "invalid"; }
      const attempts = requests.get(kind) ?? [];
      attempts.push(body);
      requests.set(kind, attempts);
      const upstream = requestHttps({
        protocol: "https:", hostname: "127.0.0.1", port: operatorPort, path: incoming.url,
        method: incoming.method, rejectUnauthorized: true, agent: false,
        cert: readFileSync(certificates.clientCert), key: readFileSync(certificates.clientKey), ca: readFileSync(certificates.caCert),
        headers: { "content-type": incoming.headers["content-type"], "content-length": String(body.byteLength), accept: "application/json", connection: "close" }
      }, (upstreamResponse) => {
        const responseChunks = [];
        upstreamResponse.on("data", (chunk) => responseChunks.push(Buffer.from(chunk)));
        upstreamResponse.once("end", () => {
          const responseBody = Buffer.concat(responseChunks);
          const results = responses.get(kind) ?? [];
          results.push(responseBody);
          responses.set(kind, results);
          if (responseLossEnabled && (kind === "extension-plan" || kind === "extension-execute") && !dropped.has(kind) && upstreamResponse.statusCode === 200) {
            dropped.add(kind);
            outgoing.socket?.destroy();
            return;
          }
          outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          outgoing.end(responseBody);
        });
      });
      upstream.once("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      upstream.end(body);
    });
  });
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return Object.freeze({
    port: address.port,
    requests: (kind) => requests.get(kind) ?? [],
    responses: (kind) => responses.get(kind) ?? [],
    dropped: (kind) => dropped.has(kind),
    enableResponseLoss: () => {
      requests.clear();
      responses.clear();
      dropped.clear();
      responseLossEnabled = true;
    },
    close: async () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  });
}

async function submitOperatorCommand(port, certificates, command) {
  const body = Buffer.from(canonicalJson(command));
  return new Promise((resolveSubmit, reject) => {
    const request = requestHttps({
      protocol: "https:", hostname: "127.0.0.1", port, path: "/v1/commands", method: "POST",
      rejectUnauthorized: true, agent: false,
      cert: readFileSync(certificates.clientCert), key: readFileSync(certificates.clientKey), ca: readFileSync(certificates.caCert),
      headers: { "content-type": "application/json", "content-length": String(body.byteLength), accept: "application/json", connection: "close" }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("end", () => resolveSubmit({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

function executeCommand(planCommand, operationId, current) {
  const issuedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    kind: "extension-execute",
    audience: planCommand.audience,
    actor: planCommand.actor,
    expected: {
      authorizationRevision: planCommand.actor.authorizationRevision,
      lifecycleRevision: planCommand.actor.lifecycleRevision,
      inventoryRevision: current.inventoryRevision,
      extensionRevision: current.extensionRevision
    },
    operationId,
    idempotencyKey: `execute:${operationId}`,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + 300_000).toISOString()
  };
}

async function currentExtensionExecutionRevision(pool, applicationId, environment, extensionId) {
  const result = await pool.query(
    `select i.revision as inventory_revision, e.revision as extension_revision
     from runtime_extension_inventory_revisions i
     join runtime_extensions e on e.application_id=i.application_id and e.environment=i.environment
     where i.application_id=$1 and i.environment=$2 and e.delivery_class='platform-plugin' and e.extension_id=$3`,
    [applicationId, environment, extensionId]
  );
  assert.equal(result.rowCount, 1, "Execution revision must have one current PostgreSQL inventory entry.");
  return { inventoryRevision: result.rows[0].inventory_revision, extensionRevision: result.rows[0].extension_revision };
}

function run(command, arguments_, options) {
  return execFileSync(command, arguments_, { ...options, encoding: "utf8", timeout: 120_000 });
}

function issueOperatorCertificates(directory, uriSan) {
  const caKey = join(directory, "operator-ca.key");
  const caCert = join(directory, "operator-ca.crt");
  const serverKey = join(directory, "operator-server.key");
  const serverCert = join(directory, "operator-server.crt");
  const serverRequest = join(directory, "operator-server.csr");
  const clientKey = join(directory, "operator-client.key");
  const clientCert = join(directory, "operator-client.crt");
  const clientRequest = join(directory, "operator-client.csr");
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=K-Nex Phase 12 Fixture CA", "-keyout", caKey, "-out", caCert], { stdio: "pipe" });
  run("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", serverKey, "-out", serverRequest], { stdio: "pipe" });
  run("openssl", ["x509", "-req", "-days", "1", "-in", serverRequest, "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-copy_extensions", "copy", "-out", serverCert], { stdio: "pipe" });
  run("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=K-Nex Phase 12 Generated App", "-addext", `subjectAltName=URI:${uriSan}`, "-keyout", clientKey, "-out", clientRequest], { stdio: "pipe" });
  run("openssl", ["x509", "-req", "-days", "1", "-in", clientRequest, "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-copy_extensions", "copy", "-out", clientCert], { stdio: "pipe" });
  return Object.freeze({ caCert, serverKey, serverCert, clientKey, clientCert });
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
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`${typeof failure === "function" ? failure() : failure}: process exited ${child.exitCode}.`);
    const result = await check().catch(() => undefined);
    if (result !== undefined && result !== false) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(typeof failure === "function" ? failure() : failure);
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
  await until(async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).ok, () => `Generated application did not start.\n${applicationProcess.output()}`, applicationProcess.child);
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

async function browserSession(browser, origin, email, password) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${origin}/`);
    return context;
  } finally { await page.close(); }
}

async function postSystemForm(origin, sessionCookie, path, fields) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: sessionCookie, origin },
    body: new URLSearchParams(fields)
  });
  assert.equal(response.status, 303, `${path}: ${await response.clone().text()}`);
  return response;
}

async function planExtensionInBrowser(context, origin, actionLabel, diagnostics, afterPlan) {
  const administrationPage = await context.newPage();
  try {
    await administrationPage.goto(`${origin}/system/extensions/module.sales`);
    const planButton = administrationPage.getByRole("button", { name: `Plan ${actionLabel}` });
    const planSubmission = await planButton.evaluate((button) => {
      const form = button.closest("form");
      const intent = form?.querySelector("input[name='intent']");
      if (!(form instanceof HTMLFormElement) || !(intent instanceof HTMLInputElement)) throw new Error("Signed extension plan intent is unavailable.");
      return { action: form.action, intent: intent.value };
    });
    const [planResponse] = await Promise.all([
      administrationPage.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/system/extensions/module.sales/plan"),
      planButton.click()
    ]);
    if (planResponse.status() !== 303) {
      const body = await planResponse.text().catch(() => "unavailable");
      assert.fail(`Extension plan failed at ${administrationPage.url()}: status=${planResponse.status()} location=${planResponse.headers().location ?? "none"} body=${body}\n${diagnostics()}`);
    }
    await administrationPage.waitForURL(/\/system\/extensions\/module\.sales\?operation=operation-[0-9a-f]{32}$/u);
    const operationId = new URL(administrationPage.url()).searchParams.get("operation");
    assert.match(operationId, /^operation-[0-9a-f]{32}$/u);
    const [planReplayResponse] = await Promise.all([
      administrationPage.waitForResponse((response) => response.request().method() === "POST" && response.url() === planSubmission.action),
      administrationPage.evaluate(({ action, intent }) => {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = action;
        const field = document.createElement("input");
        field.name = "intent";
        field.value = intent;
        form.append(field);
        document.body.append(form);
        form.submit();
      }, planSubmission)
    ]);
    assert.equal(planReplayResponse.status(), 303, "The exact browser-issued signed plan intent must replay successfully.");
    assert.equal(new URL(planReplayResponse.headers().location, origin).searchParams.get("operation"), operationId, "Signed plan-intent replay must return the same operation ID.");
    await administrationPage.waitForURL(new RegExp(`/system/extensions/module\\.sales\\?operation=${operationId}$`, "u"));
    await afterPlan?.(operationId);
    return { administrationPage, operationId };
  } catch (error) {
    await administrationPage.close();
    throw error;
  }
}

async function planAndExecuteExtensionInBrowser(context, origin, password, actionLabel, operation, diagnostics, afterPlan) {
  const { administrationPage, operationId } = await planExtensionInBrowser(context, origin, actionLabel, diagnostics, afterPlan);
  try {
    await administrationPage.getByLabel("Password").fill(password);
    await administrationPage.getByRole("button", { name: `Execute ${operation}` }).click();
    await administrationPage.waitForURL(new RegExp(`/system/extensions/module\\.sales\\?operation=${operationId}$`, "u"));
    return operationId;
  } finally { await administrationPage.close(); }
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

test("P12.9 generated app completes the durable authorized workspace journey", { timeout: 600_000 }, async () => {
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
  const representativeEmail = `representative-${randomUUID()}@example.test`;
  const representativePassword = randomBytes(24).toString("base64url");
  let applicationProcess;
  let operatorProcess;
  let responseLossRelay;
  let workerProcess;
  let pool;
  let notificationClient;
  let browser;
  try {
    const releaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"), "utf8"));
    const acceptedMirror = resolve(repositoryRoot, "fixtures/customer-gate-1/packages");
    const currentMirror = join(root, "current-head-packages");
    mkdirSync(currentMirror);
    for (const filename of readdirSync(acceptedMirror)) copyFileSync(join(acceptedMirror, filename), join(currentMirror, filename));
    run("pnpm", ["build"], { cwd: resolve(repositoryRoot, "modules/sales"), stdio: "pipe" });
    run("pnpm", ["pack", "--pack-destination", currentMirror], { cwd: resolve(repositoryRoot, "modules/sales"), stdio: "pipe" });
    const currentSalesArchive = readFileSync(join(currentMirror, "k-nex-module-sales-1.0.0.tgz"));
    const currentSales = releaseManifest.packages.find(({ package: packageName }) => packageName === "@k-nex/module-sales");
    assert.ok(currentSales);
    currentSales.integrity = `sha512-${createHash("sha512").update(currentSalesArchive).digest("base64")}`;
    const lockTemplateApplication = join(root, "lock-template");
    const provisionalSource = verifiedPackageSource(releaseManifest, currentMirror);
    applyCreateKnexApplication(planCreateKnexApplication({ applicationId, applicationName: "P12 Auth Proof", theme: "minimal", database: "external", packageSource: provisionalSource }), lockTemplateApplication);
    run("pnpm", ["install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts"], { cwd: lockTemplateApplication, stdio: "pipe" });
    const currentLock = readFileSync(join(lockTemplateApplication, "pnpm-lock.yaml"));
    const currentLockDigest = `sha256:${createHash("sha256").update(currentLock).digest("hex")}`;
    writeFileSync(join(currentMirror, `factory-lock-sales-reference-minimal-${currentLockDigest.slice(7)}.yaml`), currentLock);
    releaseManifest.factoryLockTemplates.minimal.digest = currentLockDigest;
    const packageSource = verifiedPackageSource(releaseManifest, currentMirror);
    const plan = planCreateKnexApplication({ applicationId, applicationName: "P12 Auth Proof", theme: "minimal", database: "external", packageSource });
    assert.equal(Object.values(plan.files).some((source) => source.includes(ownerEmail) || source.includes(ownerPassword) || source.includes(limitedPassword)), false);
    applyCreateKnexApplication(plan, application);
    for (const command of plan.installCommands) run(command[0], command.slice(1), { cwd: application, stdio: "pipe" });

    const port = await unusedPort();
    const operatorPort = await unusedPort();
    const operatorUriSan = `spiffe://k-nex.test/applications/${applicationId}/environments/${environmentName}/administration`;
    const operatorIdentity = "fixture.phase-12-administration-operator";
    const operatorCertificates = issueOperatorCertificates(root, operatorUriSan);
    responseLossRelay = await startResponseLossRelay({ port: 0, operatorPort, certificates: operatorCertificates });
    const applicationEnvironment = {
      ...process.env,
      DATABASE_URL: container.getConnectionUri(),
      K_NEX_ENVIRONMENT: environmentName,
      K_NEX_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      PAYLOAD_SECRET: randomBytes(32).toString("hex"),
      K_NEX_ADMINISTRATION_OPERATOR_HOST: "127.0.0.1",
      K_NEX_ADMINISTRATION_OPERATOR_PORT: String(responseLossRelay.port),
      K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT: operatorCertificates.clientCert,
      K_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY: operatorCertificates.clientKey,
      K_NEX_ADMINISTRATION_OPERATOR_CA_CERT: operatorCertificates.caCert,
      K_NEX_ADMINISTRATION_OPERATOR_URI_SAN: operatorUriSan,
      K_NEX_ADMINISTRATION_OPERATOR_IDENTITY: operatorIdentity
    };
    const ownerEnvironment = { ...applicationEnvironment, K_NEX_OWNER_EMAIL: ownerEmail, K_NEX_OWNER_PASSWORD: ownerPassword };
    const staleOwnerEnvironment = { ...applicationEnvironment, K_NEX_OWNER_EMAIL: staleOwnerEmail, K_NEX_OWNER_PASSWORD: staleOwnerPassword };
    run("pnpm", ["knex:migrate"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    run("pnpm", ["build"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    const missingOperatorEnvironment = { ...applicationEnvironment };
    delete missingOperatorEnvironment.K_NEX_ADMINISTRATION_OPERATOR_HOST;
    assert.match(failedRun("pnpm", ["knex:doctor"], { cwd: application, env: missingOperatorEnvironment, stdio: "pipe" }), /Administration operator configuration is missing/u);
    assert.match(failedRun("pnpm", ["knex:doctor"], { cwd: application, env: { ...applicationEnvironment, K_NEX_ADMINISTRATION_OPERATOR_PORT: "0" }, stdio: "pipe" }), /Administration operator configuration is invalid/u);
    console.log("P12_ADMINISTRATION_OPERATOR_READINESS_CONFIGURATION_DENIED=PASS");
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const { kNexSalesRegistry } = await import(pathToFileURL(join(application, "dist/k-nex-registry.js")).href);
    const { AuthorizationLifecycleProjector, createStaticPlatformPluginAuthorizationDescriptorResolver } = await import(pathToFileURL(realpathSync(join(application, "node_modules/@k-nex/payload-adapter/dist/index.js"))).href);
    const lifecycleSourceCommit = "a".repeat(40);
    const lifecycleProjector = new AuthorizationLifecycleProjector(createStaticPlatformPluginAuthorizationDescriptorResolver({
      applicationId, registrations: [{ sourceCommit: lifecycleSourceCommit, registration: kNexSalesRegistry.scopedRegistration }]
    }));
    const trustedEmptyHotApplicationDescriptorResolver = async () => Object.freeze([]);
    const unrelatedHotApplicationLifecycleProjector = new AuthorizationLifecycleProjector(trustedEmptyHotApplicationDescriptorResolver);
    const projectSalesLifecycle = async (operation, lifecycleState, runtimeGenerationId = kNexSalesRegistry.staticRelease.runtimeGenerationId, updateCompatibility, priorGenerationEvidence) => {
      const state = await durableStore.readState(applicationId, environmentName);
      assert.ok(state);
      const revision = state.lifecycleRevision + 1;
      const transition = {
        schemaVersion: 1, applicationId, environment: environmentName,
        eventId: `p12-generated-sales-${revision}`, eventType: "extension.lifecycle-transition",
        operationId: `p12-generated-sales-operation-${revision}`, operation, operationPhase: "completed", lifecycleState,
        expectedRevision: state.lifecycleRevision, revision, inventoryRevision: revision,
        actor: { kind: "trusted-automation", identity: "fixture.generated-sales-lifecycle" },
        receiptId: `p12-generated-sales-receipt-${revision}`, auditId: `p12-generated-sales-audit-${revision}`,
        idempotencyKey: `p12-generated-sales:${revision}`, correlationId: `p12-generated-sales-${revision}`,
        occurredAt: "2026-09-04T00:00:00.000Z", deliveryClass: "platform-plugin", id: "module.sales",
        evidence: { sourceCommit: lifecycleSourceCommit, compositionChangePlanDigest: `sha256:${"c".repeat(64)}`, generationId: runtimeGenerationId }
      };
      const session = await pool.connect();
      try {
        await session.query("begin");
        const projected = await lifecycleProjector.project({
          session,
          transition,
          runtimeGenerationIds: [runtimeGenerationId],
          ...(updateCompatibility === undefined ? {} : { updateCompatibility }),
          ...(priorGenerationEvidence === undefined ? {} : { priorGenerationEvidence })
        });
        await session.query("commit");
        return projected.state;
      } catch (error) {
        await session.query("rollback");
        throw error;
      } finally { session.release(); }
    };

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

    const operatorEnvironment = {
      ...applicationEnvironment,
      P12_OPERATOR_APPLICATION_PATH: application,
      P12_OPERATOR_APPLICATION_ID: applicationId,
      P12_OPERATOR_ENVIRONMENT: environmentName,
      P12_OPERATOR_CLIENT_URI_SAN: operatorUriSan,
      P12_OPERATOR_IDENTITY: operatorIdentity,
      P12_OPERATOR_SOURCE_COMMIT: "a".repeat(40),
      P12_OPERATOR_HOST_INVENTORY_DIGEST: `sha256:${createHash("sha256").update(canonicalJson({ applicationId, environment: environmentName, platformPlugins: [{ id: "module.sales", package: kNexSalesRegistry.staticRelease.package, runtimeGenerationId: kNexSalesRegistry.staticRelease.runtimeGenerationId }] })).digest("hex")}`,
      P12_OPERATOR_PORT: String(operatorPort),
      P12_OPERATOR_REGISTRY_PATH: join(application, "dist/k-nex-registry.js"),
      P12_OPERATOR_SERVER_CERT: operatorCertificates.serverCert,
      P12_OPERATOR_SERVER_KEY: operatorCertificates.serverKey,
      P12_OPERATOR_CA_CERT: operatorCertificates.caCert
    };
    const startOperator = (extra = {}) => start(process.execPath, [resolve(import.meta.dirname, "phase-12-administration-operator.mjs")], {
      cwd: repositoryRoot, env: { ...operatorEnvironment, ...extra }
    });
    operatorProcess = startOperator();
    await until(async () => operatorProcess.output().includes(`P12_ADMINISTRATION_OPERATOR_READY=${operatorPort}`), () => `Administration operator did not start.\n${operatorProcess.output()}`, operatorProcess.child);
    const readinessOutput = run("pnpm", ["knex:doctor"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
    assert.match(readinessOutput, /K_NEX_APPLICATION_READY/u);
    applicationProcess = await startApplication(application, applicationEnvironment);
    const readiness = await fetch(`${applicationProcess.origin}/api/readiness`);
    assert.equal(readiness.status, 200);
    assert.deepEqual(await readiness.json(), { schemaVersion: 1, status: "ready", applicationId, authorizationRevision: 3, lifecycleRevision: 1 });
    assert.deepEqual((await pool.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId])).rows, [{ authorization_revision: 3, lifecycle_revision: 1 }], "Owner baseline, Sales authority, and initial Sales scope each advance authorization once.");
    assert.deepEqual((await pool.query("select authorization_revision,lifecycle_revision,audit_json->>'operation' as operation from k_nex_authorization_audit where application_id=$1 and environment=$2 and audit_json->>'operation'='initial-sales-scope'", [applicationId, environmentName])).rows, [{ authorization_revision: 3, lifecycle_revision: 1, operation: "initial-sales-scope" }], "The initial Sales scope produces immutable canonical authorization evidence.");
    assert.match((await pool.query("select event_id::text as event_id from k_nex_authorization_outbox where application_id=$1 and environment=$2 and authorization_revision=3 and lifecycle_revision=1", [applicationId, environmentName])).rows[0]?.event_id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u, "The initial Sales scope produces one UUID invalidation event.");

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
    assert.equal((await fetch(`${applicationProcess.origin}/system/operations`, { headers: { cookie: owner.cookie.header } })).status, 200);
    const extensionAdministration = await fetch(`${applicationProcess.origin}/system/extensions/module.sales`, { headers: { cookie: owner.cookie.header } });
    assert.equal(extensionAdministration.status, 200);
    const extensionAdministrationHtml = await extensionAdministration.text();
    for (const secret of [operatorUriSan, operatorIdentity, `127.0.0.1:${operatorPort}`, operatorCertificates.clientCert, operatorCertificates.clientKey, operatorCertificates.caCert, "BEGIN PRIVATE KEY"]) {
      assert.equal(extensionAdministrationHtml.includes(secret), false, "Generated System administration HTML must not expose operator configuration or credentials.");
    }
    console.log("P12_SYSTEM_EXTENSION_AND_OPERATIONS_ADMINISTRATION_POSTGRES_HTTP=PASS");
    await postSystemForm(applicationProcess.origin, owner.cookie.header, "/api/system/settings/system.general", { password: ownerPassword, values: JSON.stringify({ siteName: "Phase 12 Customer" }) });
    const settingsDetail = await fetch(`${applicationProcess.origin}/system/settings/system.general`, { headers: { cookie: owner.cookie.header } });
    assert.equal(settingsDetail.status, 200);
    assert.match(await settingsDetail.text(), /Phase 12 Customer/u);
    const initialTheme = (await pool.query("select active_profile from runtime_theme_profile_publications where application_id=$1 and environment=$2", [applicationId, environmentName])).rows[0]?.active_profile;
    assert.ok(initialTheme);
    const themeDraft = {
      ...initialTheme,
      revision: {
        id: `theme.revision.r${randomUUID()}`,
        number: initialTheme.revision.number + 1,
        state: "draft",
        createdAt: new Date().toISOString(),
        previousRevisionId: initialTheme.revision.id
      }
    };
    await postSystemForm(applicationProcess.origin, owner.cookie.header, `/api/system/themes/profiles/${encodeURIComponent(initialTheme.id)}/stage`, { profile: JSON.stringify(themeDraft) });
    await postSystemForm(applicationProcess.origin, owner.cookie.header, `/api/system/themes/profiles/${encodeURIComponent(initialTheme.id)}/publish`, { password: ownerPassword });
    const publishedThemeDetail = await fetch(`${applicationProcess.origin}/system/themes/profiles/${encodeURIComponent(initialTheme.id)}`, { headers: { cookie: owner.cookie.header } });
    assert.equal(publishedThemeDetail.status, 200);
    assert.equal((await pool.query("select active_revision_id from runtime_theme_profile_publications where application_id=$1 and environment=$2 and profile_id=$3", [applicationId, environmentName, initialTheme.id])).rows[0]?.active_revision_id, themeDraft.revision.id);
    console.log("P12_SYSTEM_SETTINGS_AND_THEME_PROFILE_REAUTH_POSTGRES_HTTP=PASS");
    const inventory = await fetch(`${applicationProcess.origin}/api/k-nex/inventory`, { headers: { cookie: owner.cookie.header } });
    assert.equal(inventory.status, 200);
    const inventoryBody = await inventory.json();
    assert.deepEqual(inventoryBody.plugins, ["module.sales"]);
    const ownerSalesOverview = await fetch(`${applicationProcess.origin}/sales`, { headers: { cookie: owner.cookie.header } });
    const ownerSalesOverviewHtml = await ownerSalesOverview.text();
    assert.equal(ownerSalesOverview.status, 200, `The generated static Sales overview route must be available to the authorized owner.\nbody=${ownerSalesOverviewHtml}\nprocess=${applicationProcess.output()}`);
    const ownerSalesTasks = await fetch(`${applicationProcess.origin}/sales/tasks`, { headers: { cookie: owner.cookie.header } });
    assert.equal(ownerSalesTasks.status, 200, `The generated static Sales tasks route must be available to the authorized owner.\nbody=${await ownerSalesTasks.text()}\nprocess=${applicationProcess.output()}`);
    assert.equal((await fetch(`${applicationProcess.origin}/system/workspace-pages`, { headers: { cookie: owner.cookie.header } })).status, 200);
    for (const systemPath of ["/system/access/roles", "/system/access/permissions", "/system/access/assignments", "/system/access/audit", "/system/extensions", "/system/themes", "/system/settings", "/system/operations"]) {
      assert.equal((await fetch(`${applicationProcess.origin}${systemPath}`, { headers: { cookie: owner.cookie.header } })).status, 200, `Owner must open fixed System route ${systemPath}.`);
    }

    const folderKey = `workspace-folder-${randomUUID()}`;
    const folderId = `customer.folder.f${createHash("sha256").update(folderKey).digest("hex").slice(0, 23)}`;
    const createFolderRequest = (label) => fetch(`${applicationProcess.origin}/api/k-nex/workspace-folders`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: owner.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({ idempotencyKey: folderKey, label, parentNavigationId: "sales.navigation.root", order: "20" })
    });
    const createFolder = await createFolderRequest("Reports");
    assert.equal(createFolder.status, 303, `${await createFolder.clone().text()}\n${applicationProcess.output()}`);
    const folderDurabilityCounts = async () => Promise.all([
      pool.query("select count(*)::int as count from k_nex_workspace_navigation_folders where application_id=$1 and environment=$2 and folder_id=$3", [applicationId, environmentName, folderId]),
      pool.query("select count(*)::int as count from k_nex_workspace_navigation_outbox where application_id=$1 and environment=$2 and folder_id=$3", [applicationId, environmentName, folderId])
    ]);
    const [createdFolderRows, createdFolderEvents] = await folderDurabilityCounts();
    assert.equal(createdFolderRows.rows[0].count, 1);
    assert.equal(createdFolderEvents.rows[0].count, 1);
    const replayFolder = await createFolderRequest("Reports");
    assert.equal(replayFolder.status, 303, "An identical folder create must replay successfully.");
    const [replayedFolderRows, replayedFolderEvents] = await folderDurabilityCounts();
    assert.equal(replayedFolderRows.rows[0].count, 1, "A folder replay must not create another folder.");
    assert.equal(replayedFolderEvents.rows[0].count, 1, "A folder replay must not enqueue another navigation invalidation.");
    const changedFolderReplay = await createFolderRequest("Changed reports");
    assert.equal(changedFolderReplay.status, 400, "A changed folder payload under one idempotency key must be denied.");
    const [deniedFolderRows, deniedFolderEvents] = await folderDurabilityCounts();
    assert.equal(deniedFolderRows.rows[0].count, 1, "A denied folder replay must not create another folder.");
    assert.equal(deniedFolderEvents.rows[0].count, 1, "A denied folder replay must not enqueue another navigation invalidation.");
    const invalidFolderMove = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-folders/${encodeURIComponent(folderId)}`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: owner.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({ expectedRevision: "1", label: "Reports", parentNavigationId: "system.navigation.root", order: "20" })
    });
    assert.equal(invalidFolderMove.status, 400, "A customer folder must not move below fixed System navigation.");
    const competingFolderMoves = await Promise.all([30, 40].map((order) => fetch(`${applicationProcess.origin}/api/k-nex/workspace-folders/${encodeURIComponent(folderId)}`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: owner.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({ expectedRevision: "1", label: "Reports", parentNavigationId: "sales.navigation.root", order: String(order) })
    })));
    assert.deepEqual(competingFolderMoves.map(({ status }) => status).sort(), [303, 409], "Competing folder moves must have one CAS winner.");
    const folderRow = (await pool.query("select revision, node_json from k_nex_workspace_navigation_folders where application_id=$1 and environment=$2 and folder_id=$3", [applicationId, environmentName, folderId])).rows[0];
    assert.equal(folderRow.revision, 2);
    assert.equal(folderRow.node_json.parentId, "sales.navigation.root");
    assert.ok([30, 40].includes(folderRow.node_json.order));
    console.log("P12_ATK_04_FOLDER_GRAPH_AND_CAS_POSTGRES_HTTP_DENIED=PASS");

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
    const createRepresentative = await fetch(`${applicationProcess.origin}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie.header },
      body: JSON.stringify({ email: representativeEmail, password: representativePassword })
    });
    assert.equal(createRepresentative.status, 201);
    const representativeUserId = String((await createRepresentative.json()).doc.id);
    const ownerUserId = String(owner.body.user.id);
    assert.deepEqual((await pool.query("select record_scope,application_wide,mutation_allowed,authorized_team_ids,revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3", [applicationId, environmentName, ownerUserId])).rows, [{ record_scope: "application-sales-scope", application_wide: true, mutation_allowed: true, authorized_team_ids: [], revision: 1 }]);
    await pool.query(`insert into sales_current_authority_scopes
      (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids)
      values ($1,$2,$3,'managed-teams-and-own',false,true,$5::jsonb),
             ($1,$2,$4,'explicit-application-or-team-scope',false,false,$5::jsonb),
             ($1,$2,$6,'owned-or-assigned-team',false,true,$7::jsonb)`,
    [applicationId, environmentName, managerUserId, limitedUserId, JSON.stringify([`team:${limitedUserId}`]), representativeUserId, JSON.stringify(["team:representative"])]);

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
    const draftNavigation = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: owner.cookie.header } });
    assert.equal(draftNavigation.status, 200);
    assert.equal((await draftNavigation.text()).includes(`href="/workspace/pages/${encodeURIComponent(pageId)}"`), false, "A draft page with current ACL must not be serialized as a navigation link.");

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
      validate: (requestedApplicationId, subject) => requestedApplicationId === applicationId && subject.kind === "user" && [ownerUserId, limitedUserId, managerUserId, representativeUserId].includes(subject.id) ? "accepted" : "rejected"
    });
    await postSystemForm(applicationProcess.origin, owner.cookie.header, "/api/system/access/roles", { id: "customer.workspace-viewer", label: "Workspace viewer" });
    await postSystemForm(applicationProcess.origin, owner.cookie.header, "/api/system/access/roles/customer.workspace-viewer/permissions", { permissionId: "system.workspace-pages.read" });
    await postSystemForm(applicationProcess.origin, owner.cookie.header, "/api/system/access/roles/customer.workspace-viewer/permissions", { permissionId: "system.roles.read" });
    await postSystemForm(applicationProcess.origin, owner.cookie.header, "/api/system/access/assignments", { roleId: "customer.workspace-viewer", userId: limitedUserId });
    const workspaceViewerAssignmentId = `access.assignment.${createHash("sha256").update(canonicalJson([applicationId, "customer.workspace-viewer", limitedUserId])).digest("hex")}`;
    assert.equal((await fetch(`${applicationProcess.origin}/system/access/roles/customer.workspace-viewer`, { headers: { cookie: owner.cookie.header } })).status, 200);
    assert.equal((await fetch(`${applicationProcess.origin}/system/access/assignments`, { headers: { cookie: owner.cookie.header } })).status, 200);
    console.log("P12_SYSTEM_ACCESS_ROLE_GRANT_ASSIGNMENT_POSTGRES_HTTP=PASS");
    const state = await store.readState(applicationId, environmentName);
    assert.ok(state);
    const granted = await store.transaction(expected(state), async (transaction) => {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.sales-manager", applicationId, label: "Sales manager", revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.sales-manager.workspace", applicationId, roleId: "customer.sales-manager", permissionId: "system.workspace-pages.read", owner: { kind: "platform", namespace: "system" }, revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.sales-manager.workspace-edit", applicationId, roleId: "customer.sales-manager", permissionId: "system.workspace-pages.edit", owner: { kind: "platform", namespace: "system" }, revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.sales-manager.workspace-publish", applicationId, roleId: "customer.sales-manager", permissionId: "system.workspace-pages.publish", owner: { kind: "platform", namespace: "system" }, revision: 0 } });
      for (const permissionId of [
        "sales.tasks.read", "sales.opportunities.read", "sales.opportunities.write", "sales.opportunities.amount.read", "sales.opportunities.stage.update"
      ]) await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: `customer.sales-manager.${permissionId}`, applicationId, roleId: "customer.sales-manager", permissionId, owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: 0 } });
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.sales-manager.assignment", applicationId, roleId: "customer.sales-manager", principal: { kind: "user", id: managerUserId }, state: "active", revision: 0 } });
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.sales-representative", applicationId, label: "Sales representative", revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.sales-representative.workspace", applicationId, roleId: "customer.sales-representative", permissionId: "system.workspace-pages.read", owner: { kind: "platform", namespace: "system" }, revision: 0 } });
      for (const permissionId of ["sales.opportunities.read", "sales.opportunities.write", "sales.opportunities.stage.update"]) {
        await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: `customer.sales-representative.${permissionId}`, applicationId, roleId: "customer.sales-representative", permissionId, owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: 0 } });
      }
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.sales-representative.assignment", applicationId, roleId: "customer.sales-representative", principal: { kind: "user", id: representativeUserId }, state: "active", revision: 0 } });
    });

    const limited = await login(applicationProcess.origin, limitedEmail, limitedPassword);
    const limitedWorkspace = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: limited.cookie.header } });
    assert.equal(limitedWorkspace.status, 200);
    const limitedHtml = await limitedWorkspace.text();
    assert.equal(limitedHtml.includes("sales.route.overview"), false);
    assert.equal(limitedHtml.includes("/sales"), false);
    const limitedRoles = await fetch(`${applicationProcess.origin}/system/access/roles`, { headers: { cookie: limited.cookie.header } });
    assert.equal(limitedRoles.status, 200);
    const limitedRolesHtml = await limitedRoles.text();
    assert.equal(limitedRolesHtml.includes('href="/system/access/roles"'), true, "The permitted System subnavigation link must render.");
    for (const href of ["/system/access/permissions", "/system/access/assignments", "/system/access/audit", "/system/extensions", "/system/themes", "/system/settings", "/system/operations"]) {
      assert.equal(limitedRolesHtml.includes(`href="${href}"`), false, `Unauthorized System subnavigation must omit ${href}.`);
    }
    assert.equal((await fetch(`${applicationProcess.origin}/system/extensions`, { headers: { cookie: limited.cookie.header }, redirect: "manual" })).status, 404, "Direct System route admission must match hidden subnavigation.");
    console.log("P12_SYSTEM_SUBNAVIGATION_CURRENT_AUTHORITY_POSTGRES_HTTP=PASS");
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
    assert.equal(templateDeniedHtml.includes('href="/sales/tasks"'), true, `Other currently authorized Sales template navigation must remain visible.\n${applicationProcess.output()}`);
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
      const assignment = (await transaction.listAssignments(applicationId)).find(({ id }) => id === workspaceViewerAssignmentId);
      assert.ok(assignment);
      await transaction.write({ kind: "assignment", assignment: { ...assignment, state: "revoked", revision: assignment.revision + 1 } });
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
    await until(async () => workerProcess.output().includes("K_NEX_WORKER_READY"), () => `Generated worker did not start.\n${workerProcess.output()}`, workerProcess.child);
    await until(async () => {
      const result = await pool.query("select count(*)::int as count from k_nex_authorization_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName]);
      return result.rows[0].count === 0;
    }, "Authorization outbox did not converge.", workerProcess.child);
    await until(async () => notificationTypes.has("authorization") && notificationTypes.has("workspace-navigation") && notificationTypes.has("workspace-page"), "Generated worker did not publish all invalidation classes.", workerProcess.child).catch(async (error) => {
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
          structuralCompatibilityHash: salesOpportunitiesDescriptor.structuralCompatibilityHash, selectedFields: ["name", "stage-id", "revision", "amount"]
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
    access.append("assignment", `user|${representativeUserId}|view`);
    const replaceAccess = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/access`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin }, body: access
    });
    assert.equal(replaceAccess.status, 303, await replaceAccess.clone().text());

    const audit = JSON.stringify([{ kind: "p13-2-generated-app-seed" }]);
    // Sales mutations accept only the immutable P13.2 migration origin until
    // opportunity creation is introduced in P13.3.  Keep fixture records on
    // that persisted contract rather than teaching the action validator about
    // a test-only audit shape.
    const opportunityQualificationAudit = JSON.stringify([{ kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "lead" }]);
    const opportunityDiscoveryAudit = JSON.stringify([{ kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "qualified" }]);
    const taskAudit = JSON.stringify([{ kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}` }]);
    const account = await pool.query(`insert into sales_accounts
      (application_id, environment, owner_id, created_by, updated_by, audit, name)
      values ($1,$2,$3,$3,$3,$4::jsonb,'Generated app account') returning id`, [applicationId, environmentName, ownerUserId, audit]);
    const pipeline = await pool.query(`insert into sales_pipelines
      (application_id, environment, created_by, updated_by, audit, name, ordered_stage_ids, is_active)
      values ($1,$2,$3,$3,$4::jsonb,'Generated app pipeline',$5::jsonb,true) returning id`,
    [applicationId, environmentName, ownerUserId, audit, JSON.stringify(["qualification", "discovery", "proposal", "negotiation", "won", "lost"])]);
    const stageSeeds = [
      ["qualification", 0, 1000, ["discovery", "lost"]], ["discovery", 1, 3000, ["proposal", "lost"]],
      ["proposal", 2, 6000, ["negotiation", "lost"]], ["negotiation", 3, 8000, ["won", "lost"]],
      ["won", 4, 10000, []], ["lost", 5, 0, []]
    ];
    for (const [stageId, position, probability, transitions] of stageSeeds) await pool.query(`insert into sales_pipeline_stages
      (application_id, environment, created_by, updated_by, audit, pipeline_id, stage_id, name, semantic, position, probability_basis_points, allowed_transitions)
      values ($1,$2,$3,$3,$4::jsonb,$5,$6,$7,$6,$8,$9,$10::jsonb)`,
    [applicationId, environmentName, ownerUserId, audit, pipeline.rows[0].id, stageId, stageId, position, probability, JSON.stringify(transitions)]);
    const opportunityValues = [applicationId, environmentName, ownerUserId, opportunityQualificationAudit, account.rows[0].id, pipeline.rows[0].id];
    const alpha = await pool.query(`insert into sales_opportunities
      (application_id, environment, owner_id, team_id, created_by, updated_by, audit, account_id, pipeline_id, name, stage_id, amount, currency, archive_status)
      values ($1,$2,$3,$7,$3,$3,$4::jsonb,$5,$6,'Alpha renewal','qualification','12000','USD','active') returning id`, [...opportunityValues, `team:${limitedUserId}`]);
    const beta = await pool.query(`insert into sales_opportunities
      (application_id, environment, owner_id, created_by, updated_by, audit, account_id, pipeline_id, name, stage_id, amount, currency, archive_status)
      values ($1,$2,$3,$3,$3,$4::jsonb,$5,$6,'Beta expansion','discovery','8000','USD','active') returning id`, [applicationId, environmentName, ownerUserId, opportunityDiscoveryAudit, account.rows[0].id, pipeline.rows[0].id]);
    const task = await pool.query(`insert into sales_tasks
      (application_id, environment, owner_id, created_by, updated_by, audit, title, status, archive_status)
      values ($1,$2,$3,$3,$3,$4::jsonb,'Prepare Alpha proposal','open','active') returning id`, [applicationId, environmentName, ownerUserId, taskAudit]);

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
      ["sales.navigation.overview", "Overview", "/sales", "table", "Follow-up tasks"],
      ["sales.navigation.tasks", "Tasks", "/sales/tasks", "table", "Sales tasks"],
      ["sales.navigation.opportunities", "Opportunities", "/sales/opportunities", "region", "Opportunities"],
      ["sales.navigation.settings", "Settings", "/sales/settings", "region", "Sales settings"]
    ]) {
      const link = salesNavigation.locator(`[data-navigation-node="${navigationId}"]`).getByRole("link", { name: label });
      await link.waitFor();
      assert.equal(await link.getAttribute("href"), href, `${navigationId} must originate from the module.sales static registration.`);
      await page.goto(`${applicationProcess.origin}${href}`);
      try { await page.getByRole(templateRole, { name: templateLabel }).waitFor(); }
      catch (error) { throw new Error(`${error}\nurl=${page.url()}\nbody=${await page.locator("body").innerText()}\nprocess=${applicationProcess.output()}`); }
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
    for (const label of ["Heading", "Sales opportunity Kanban", "Sales task table"]) {
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
    assert.deepEqual(savedNodes.map(({ type }) => type), ["content.heading", "sales.opportunity-kanban", "sales.task-table"]);
    assert.equal(savedNodes.slice(1).every(({ bindings }) => bindings?.source !== undefined || bindings?.action !== undefined), true, "Inserted Sales blocks must retain trusted runtime bindings.");

    const publication = page.getByRole("region", { name: "Page publication controls" });
    const shellBeforePublication = await page.locator('[data-k-nex-component="workspace-shell"]').elementHandle();
    assert.ok(shellBeforePublication, "The open editor must retain its workspace shell while navigation converges.");
    await publication.getByRole("button", { name: "Publish page" }).click();
    await publication.getByText("Page published.", { exact: true }).waitFor({ timeout: 10_000 });
    const alreadyOpenPublishedNavigationLink = page.locator(`[data-navigation-node="${pageId}"]`).getByRole("link", { name: "Sales command center" });
    await alreadyOpenPublishedNavigationLink.waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('[data-k-nex-component="workspace-shell"]').evaluate((element, before) => element === before, shellBeforePublication), true, "Publishing must refresh an already-open sidebar without remounting its workspace shell.");
    await shellBeforePublication.dispose();
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
    await page.getByRole("heading", { name: "Heading" }).waitFor();
    const alphaMove = page.locator(`[data-opportunity-id="${String(alpha.rows[0].id)}"]`).getByRole("button", { name: "Move to discovery" });
    assert.equal(await alphaMove.count(), 1, `Published Kanban action is missing.\n${await page.locator("body").innerText()}\n${JSON.stringify(savedNodes[0])}\n${applicationProcess.output()}`);
    const alphaActionResponse = page.waitForResponse((response) => response.url().includes(`/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/actions/${encodeURIComponent(salesOpportunityStageUpdateDescriptor.id)}`));
    await alphaMove.click();
    const alphaAction = await alphaActionResponse;
    assert.equal(alphaAction.status(), 200, `Published Kanban action failed.\nbody=${await alphaAction.text()}\n${applicationProcess.output()}`);
    const alphaStatus = page.getByRole("region", { name: "Sales opportunity Kanban" }).getByRole("status");
    await alphaStatus.filter({ hasText: /moved/u }).waitFor({ timeout: 10_000 });
    assert.equal(await alphaStatus.textContent(), "Alpha renewal moved to discovery.", applicationProcess.output());
    const betaMove = page.locator(`[data-opportunity-id="${String(beta.rows[0].id)}"]`).getByRole("button", { name: "Move to proposal" });
    await betaMove.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Beta expansion moved to proposal.", { exact: true }).waitFor();
    const moved = await pool.query("select name, stage_id from sales_opportunities order by id");
    assert.deepEqual(moved.rows, [{ name: "Alpha renewal", stage_id: "discovery" }, { name: "Beta expansion", stage_id: "proposal" }]);
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
        await lock.query("lock table sales_opportunities in access exclusive mode");
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
            and query ilike '%sales_opportunities%'
        `);
        blockedSalesQueries = blocked.rows[0]?.count ?? 0;
        if (blockedSalesQueries >= 4) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      assert.equal(blockedSalesQueries >= 4, true, "Four high-cost opportunity requests must hold the shared source concurrency budget before exhaustion is tested.");
      const exhausted = await fetch(workspacePageSessionUrl, { headers: budgetHeaders });
      assert.equal(exhausted.status, 200, `The fifth direct view session must report binding-level concurrency while the Sales query lock is held.\n${await exhausted.clone().text()}\n${applicationProcess.output()}`);
      const exhaustedSession = await exhausted.json();
      const concurrencyLimitedBindings = Object.values(exhaustedSession.projection.sourceResults).filter((binding) => binding.state === "rate-limited" && binding.problem?.code === "QUERY_CONCURRENCY_EXCEEDED" && binding.problem?.status === 429);
      assert.equal(concurrencyLimitedBindings.length, 1, "Exactly one bound high-cost metric must report the shared four-query concurrency ceiling.");
      assertOpportunityBinding(exhaustedSession.projection, { state: "rate-limited", problemCode: "QUERY_CONCURRENCY_EXCEEDED", problemStatus: 429 }, "The fifth direct view session must map the Sales opportunity source to the shared concurrency limit.");
      await concurrent.release();
    } finally {
      await concurrent.release();
    }
    await Promise.all(concurrent.requests);

    const salesRow = async (kind, id) => {
      const result = await pool.query(kind === "opportunity"
        ? "select id::text as id, name, stage_id as stage, revision from sales_opportunities where id=$1"
        : "select id::text as id, title, status, revision from sales_tasks where id=$1", [id]);
      assert.equal(result.rowCount, 1, `Sales ${kind} target must exist.`);
      return result.rows[0];
    };
    const postPageAction = (targetPageId, actionId, actionCookie, input, idempotencyKey = `workspace-direct-action-${randomUUID()}`) => fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(targetPageId)}/actions/${encodeURIComponent(actionId)}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: actionCookie, origin: applicationProcess.origin },
      body: JSON.stringify({ input, idempotencyKey })
    });
    const opportunityInput = (row, stage) => ({ id: row.id, expectedStage: row.stage, expectedRevision: row.revision, stage });

    const scopedOpportunity = async (name, ownerId, teamId = null) => pool.query(`insert into sales_opportunities
      (application_id, environment, owner_id, team_id, created_by, updated_by, audit, account_id, pipeline_id, name, stage_id, amount, currency, archive_status)
      values ($1,$2,$3,$4,$3,$3,$5::jsonb,$6,$7,$8,'qualification','1000','USD','active') returning id`,
    [applicationId, environmentName, ownerId, teamId, opportunityQualificationAudit, account.rows[0].id, pipeline.rows[0].id, name]);
    const representativeOwn = await scopedOpportunity("Representative owned", representativeUserId);
    const representativeTeam = await scopedOpportunity("Representative assigned team", ownerUserId, "team:representative");
    const crossTeam = await scopedOpportunity("Representative cross team denied", ownerUserId, "team:other");
    const viewerOwned = await scopedOpportunity("Viewer owned but denied", limitedUserId);
    const viewerTeam = await scopedOpportunity("Viewer assigned team allowed", ownerUserId, `team:${limitedUserId}`);
    const viewerCrossTeam = await scopedOpportunity("Viewer cross team denied", ownerUserId, "team:other");
    const foreignSalesApplicationId = `${applicationId}-foreign`;
    const foreignAccount = await pool.query(`insert into sales_accounts
      (application_id, environment, owner_id, created_by, updated_by, audit, name)
      values ($1,$2,$3,$3,$3,$4::jsonb,'Foreign account') returning id`, [foreignSalesApplicationId, environmentName, ownerUserId, audit]);
    const foreignPipeline = await pool.query(`insert into sales_pipelines
      (application_id, environment, created_by, updated_by, audit, name, ordered_stage_ids, is_active)
      values ($1,$2,$3,$3,$4::jsonb,'Foreign pipeline',$5::jsonb,true) returning id`,
    [foreignSalesApplicationId, environmentName, ownerUserId, audit, JSON.stringify(["qualification", "discovery"])]);
    for (const [stageId, position, transitions] of [["qualification", 0, ["discovery"]], ["discovery", 1, []]]) await pool.query(`insert into sales_pipeline_stages
      (application_id, environment, created_by, updated_by, audit, pipeline_id, stage_id, name, semantic, position, probability_basis_points, allowed_transitions)
      values ($1,$2,$3,$3,$4::jsonb,$5,$6,$6,$6,$7,0,$8::jsonb)`,
    [foreignSalesApplicationId, environmentName, ownerUserId, audit, foreignPipeline.rows[0].id, stageId, position, JSON.stringify(transitions)]);
    const crossApplication = await pool.query(`insert into sales_opportunities
      (application_id, environment, owner_id, team_id, created_by, updated_by, audit, account_id, pipeline_id, name, stage_id, amount, currency, archive_status)
      values ($1,$2,$3,'team:representative',$3,$3,$4::jsonb,$5,$6,'Representative cross application denied','qualification','1000','USD','active') returning id`,
    [foreignSalesApplicationId, environmentName, representativeUserId, opportunityQualificationAudit, foreignAccount.rows[0].id, foreignPipeline.rows[0].id]);

    const representative = await login(applicationProcess.origin, representativeEmail, representativePassword);
    const representativeSource = await fetch(`${applicationProcess.origin}/sales/opportunities`, { headers: { cookie: representative.cookie.header } });
    assert.equal(representativeSource.status, 200, applicationProcess.output());
    const representativeSourceHtml = await representativeSource.text();
    assert.equal(representativeSourceHtml.includes("Representative owned"), true);
    assert.equal(representativeSourceHtml.includes("Representative assigned team"), true);
    assert.equal(representativeSourceHtml.includes("Representative cross team denied"), false);
    assert.equal(representativeSourceHtml.includes("Representative cross application denied"), false);
    for (const target of [representativeOwn, representativeTeam]) {
      const before = await salesRow("opportunity", String(target.rows[0].id));
      const response = await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, representative.cookie.header, opportunityInput(before, "discovery"));
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await salesRow("opportunity", before.id)).stage, "discovery");
    }
    const replayTarget = await salesRow("opportunity", String(representativeOwn.rows[0].id));
    const replayKey = `R${"a".repeat(159)}`;
    const replayInput = opportunityInput(replayTarget, "proposal");
    const replayBefore = await pool.query(`select jsonb_array_length(audit)::integer as audit_count from sales_opportunities where id=$1`, [replayTarget.id]);
    const replayOutboxBefore = await pool.query(`select count(*)::integer as count from k_nex_outbox where payload->>'resourceId'=$1 and payload->>'actionId'='sales.opportunity.stage.update'`, [replayTarget.id]);
    const replayResponses = await Promise.all([
      postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, representative.cookie.header, replayInput, replayKey),
      postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, representative.cookie.header, replayInput, replayKey)
    ]);
    assert.deepEqual(replayResponses.map(({ status }) => status), [200, 200], "Concurrent duplicate actions must both return the stored success.");
    const replayBodies = await Promise.all(replayResponses.map(async (response) => {
      const { correlationId: _correlationId, ...body } = await response.json();
      return body;
    }));
    assert.deepEqual(replayBodies[1], replayBodies[0], "Exact replay must return the immutable first action result.");
    assert.equal((await salesRow("opportunity", replayTarget.id)).stage, "proposal");
    assert.deepEqual((await pool.query(`select count(*)::integer as rows, min(result_json->>'state') as state from sales_action_idempotency
      where application_id=$1 and environment=$2 and effective_actor_id=$3 and action_id='sales.opportunity.stage.update' and idempotency_key=$4`, [applicationId, environmentName, representativeUserId, replayKey])).rows,
    [{ rows: 1, state: "succeeded" }], "A 160-character key must reserve one durable actor/action result.");
    assert.equal((await pool.query(`select jsonb_array_length(audit)::integer as audit_count from sales_opportunities where id=$1`, [replayTarget.id])).rows[0].audit_count, replayBefore.rows[0].audit_count + 1, "Concurrent replay must append one audit transition.");
    assert.equal((await pool.query(`select count(*)::integer as count from k_nex_outbox where payload->>'resourceId'=$1 and payload->>'actionId'='sales.opportunity.stage.update'`, [replayTarget.id])).rows[0].count, replayOutboxBefore.rows[0].count + 1, "Concurrent replay must enqueue one durable event.");
    const replayConflict = await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, representative.cookie.header, { ...replayInput, expectedRevision: replayInput.expectedRevision + 1 }, replayKey);
    assert.equal(replayConflict.status, 409, "Changed action bytes must conflict with the durable idempotency key.");
    assert.equal((await salesRow("opportunity", replayTarget.id)).stage, "proposal", "Changed replay must leave the accepted transition intact.");
    console.log("P13_SALES_ACTION_DURABLE_REPLAY_CONCURRENT_LONG_KEY_POSTGRES_HTTP=PASS");
    for (const target of [crossTeam, crossApplication]) {
      const before = await salesRow("opportunity", String(target.rows[0].id));
      const response = await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, representative.cookie.header, opportunityInput(before, "discovery"));
      assert.equal(response.status, 403);
      assert.deepEqual(await salesRow("opportunity", before.id), before);
    }
    console.log("P13_SALES_REPRESENTATIVE_OWN_TEAM_AND_CROSS_SCOPE_POSTGRES_HTTP=PASS");

    const managerSource = await fetch(`${applicationProcess.origin}/sales/opportunities`, { headers: { cookie: manager.cookie.header } });
    assert.equal(managerSource.status, 200);
    const managerSourceHtml = await managerSource.text();
    assert.equal(managerSourceHtml.includes("Alpha renewal"), true);
    assert.equal(managerSourceHtml.includes("Representative cross team denied"), false);
    const managerTarget = await salesRow("opportunity", String(alpha.rows[0].id));
    assert.equal((await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, manager.cookie.header, opportunityInput(managerTarget, "proposal"))).status, 200);
    assert.equal((await salesRow("opportunity", managerTarget.id)).stage, "proposal");
    console.log("P13_SALES_MANAGER_MANAGED_TEAM_POSTGRES_HTTP=PASS");

    const administratorSource = await fetch(`${applicationProcess.origin}/sales/opportunities`, { headers: { cookie: restartedOwner.cookie.header } });
    assert.equal(administratorSource.status, 200);
    assert.equal((await administratorSource.text()).includes("Representative cross team denied"), true);
    const administratorTarget = await salesRow("opportunity", String(crossTeam.rows[0].id));
    assert.equal((await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, restartedOwner.cookie.header, opportunityInput(administratorTarget, "discovery"))).status, 200);
    assert.equal((await salesRow("opportunity", administratorTarget.id)).stage, "discovery");
    console.log("P13_SALES_ADMINISTRATOR_APPLICATION_SCOPE_POSTGRES_HTTP=PASS");

    const limitedAuthority = await store.readState(applicationId, environmentName);
    assert.ok(limitedAuthority);
    await store.transaction(expected(limitedAuthority), async (transaction) => {
      const assignment = (await transaction.listAssignments(applicationId)).find(({ id }) => id === workspaceViewerAssignmentId);
      assert.ok(assignment);
      await transaction.write({ kind: "assignment", assignment: { ...assignment, state: "active", revision: assignment.revision + 1 } });
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
      for (const permissionId of ["sales.opportunities.read"]) {
        await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: `customer.sales-field-limited.${permissionId}`, applicationId, roleId: "customer.sales-field-limited", permissionId, owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: 0 } });
      }
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.sales-field-limited.assignment", applicationId, roleId: "customer.sales-field-limited", principal: { kind: "user", id: limitedUserId }, state: "active", revision: 0 } });
    });
    const fieldDeniedSource = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: limited.cookie.header } });
    assert.equal(fieldDeniedSource.status, 200);
    const fieldDeniedSourceHtml = await fieldDeniedSource.text();
    assert.equal(fieldDeniedSourceHtml.includes("Alpha renewal"), true, "Field-limited authority must retain permitted opportunity fields.");
    assert.equal(fieldDeniedSourceHtml.includes("Viewer assigned team allowed"), true, "Explicit viewer team scope must expose listed-team records.");
    assert.equal(fieldDeniedSourceHtml.includes("Viewer owned but denied"), false, "Explicit viewer scope must not imply ownership access.");
    assert.equal(fieldDeniedSourceHtml.includes("Viewer cross team denied"), false, "Explicit viewer scope must deny unlisted teams.");
    assert.equal(fieldDeniedSourceHtml.includes("Representative cross team denied"), false, "Explicit viewer team scope cannot expose another team.");
    assert.equal(fieldDeniedSourceHtml.includes("Representative cross application denied"), false, "Explicit viewer scope cannot cross the application boundary.");
    assert.equal(fieldDeniedSourceHtml.includes("12000"), false, "Field-limited authority cannot expose opportunity amount.");
    const fieldDeniedSession = await fetch(workspacePageSessionUrl, { headers: { cookie: limited.cookie.header } });
    assert.equal(fieldDeniedSession.status, 200);
    const fieldDeniedProjection = (await fieldDeniedSession.json()).projection;
    assertOpportunityBinding(fieldDeniedProjection, { state: "success" }, "Optional sensitive fields must redact without denying permitted opportunity fields.");
    assert.equal(JSON.stringify(fieldDeniedProjection.sourceResults).includes('"amount"'), false, "The field-limited source result cannot retain the denied amount field.");
    assert.equal(fieldDeniedSourceHtml.includes("Prepare Alpha proposal"), false, "Field-limited opportunity authority cannot expose task rows.");
    console.log("P12_ATK_07_PAGE_ACL_ONLY_SALES_FIELD_HTTP_POSTGRES_REDACTED=PASS");

    await pool.query(`update sales_current_authority_scopes set application_wide=true, revision=revision+1
      where application_id=$1 and environment=$2 and principal_id=$3 and record_scope='explicit-application-or-team-scope' and mutation_allowed=false`, [applicationId, environmentName, limitedUserId]);
    const appWideViewerSource = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: limited.cookie.header } });
    assert.equal(appWideViewerSource.status, 200);
    const appWideViewerHtml = await appWideViewerSource.text();
    assert.equal(appWideViewerHtml.includes("Viewer owned but denied"), true, "App-wide explicit viewer scope must include owned records.");
    assert.equal(appWideViewerHtml.includes("Viewer cross team denied"), true, "App-wide explicit viewer scope must include otherwise unlisted teams.");
    console.log("P13_SALES_VIEWER_EXPLICIT_TEAM_AND_APPLICATION_SCOPE_POSTGRES_HTTP=PASS");

    const pageAclOnlyBefore = await salesRow("opportunity", String(alpha.rows[0].id));
    const pageAclOnly = await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, limited.cookie.header, opportunityInput(pageAclOnlyBefore, "negotiation"));
    assert.equal(pageAclOnly.status, 403);
    const { correlationId: pageAclOnlyCorrelationId, ...pageAclOnlyBody } = await pageAclOnly.json();
    assert.deepEqual(pageAclOnlyBody, { code: "ACTION_FORBIDDEN", status: 403, detail: "Sales action scope is unavailable." });
    assert.match(pageAclOnlyCorrelationId, /^workspace-sales-action-[0-9a-f-]+$/u);
    assert.deepEqual(await salesRow("opportunity", String(alpha.rows[0].id)), pageAclOnlyBefore, "Page ACL cannot grant Sales action authority or mutate its target.");
    console.log("P12_ATK_07_PAGE_ACL_ONLY_SALES_ACTION_HTTP_POSTGRES_DENIED=PASS");

    const rawAuthorityBefore = await pool.query("select count(*)::integer as count from users");
    const rawAuthorityTargetBefore = await salesRow("opportunity", String(alpha.rows[0].id));
    const rawAuthority = await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, restartedOwner.cookie.header, {
      ...opportunityInput(rawAuthorityTargetBefore, "proposal"),
      collection: "users",
      operation: "create",
      rawRequest: { payload: { overrideAccess: true } },
      payload: { collection: "users", data: { email: "forged@example.test" }, overrideAccess: true }
    });
    assert.equal(rawAuthority.status, 400);
    const { correlationId: rawAuthorityCorrelationId, ...rawAuthorityBody } = await rawAuthority.json();
    assert.deepEqual(rawAuthorityBody, { code: "ACTION_INPUT_INVALID", status: 400, detail: "Action input is invalid." });
    assert.match(rawAuthorityCorrelationId, /^workspace-sales-action-[0-9a-f-]+$/u);
    assert.deepEqual(await salesRow("opportunity", String(alpha.rows[0].id)), rawAuthorityTargetBefore, "Untrusted collection, operation, and raw Payload authority cannot mutate the Sales target.");
    assert.deepEqual(await pool.query("select count(*)::integer as count from users").then(({ rows }) => rows), rawAuthorityBefore.rows, "Untrusted collection, operation, and raw Payload authority cannot reach another collection.");
    console.log("P13_ATK_02_SALES_RAW_PERSISTENCE_AUTHORITY_HTTP_POSTGRES_DENIED=PASS");

    const unboundBefore = await salesRow("task", String(task.rows[0].id));
    const unbound = await postPageAction(pageId, salesTaskUpdateDescriptor.id, restartedOwner.cookie.header, { id: unboundBefore.id, expectedRevision: unboundBefore.revision, status: "completed" });
    assert.equal(unbound.status, 404);
    assert.deepEqual(await unbound.json(), { code: "NOT_FOUND" });
    assert.deepEqual(await salesRow("task", String(task.rows[0].id)), unboundBefore, "An action absent from the published document cannot mutate a Sales row.");
    console.log("P12_ATK_13_UNBOUND_ACTION_HTTP_POSTGRES_DENIED=PASS");

    const createUnboundPage = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({ title: "Sales action-free page", description: "Published without Sales action bindings", parentNavigationId: folderId, order: "101", themeRevision: "", idempotencyKey: `workspace-create-unbound-${randomUUID()}` })
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
    const crossPageBefore = await salesRow("opportunity", String(alpha.rows[0].id));
    const crossPage = await postPageAction(unboundPageId, salesOpportunityStageUpdateDescriptor.id, restartedOwner.cookie.header, opportunityInput(crossPageBefore, "proposal"));
    assert.equal(crossPage.status, 404);
    assert.deepEqual(await crossPage.json(), { code: "NOT_FOUND" });
    assert.deepEqual(await salesRow("opportunity", String(alpha.rows[0].id)), crossPageBefore, "A bound action cannot be replayed through another published page.");
    console.log("P12_ATK_13_CROSS_PAGE_ACTION_HTTP_POSTGRES_DENIED=PASS");

    const managerContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const scopeRow = async () => (await pool.query("select record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3", [applicationId, environmentName, representativeUserId])).rows[0];
    const scopeState = async () => (await pool.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId])).rows[0];
    const changeScope = (body) => fetch(`${applicationProcess.origin}/api/k-nex/sales/authority-scopes`, {
      method: "POST", headers: { "content-type": "application/json", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin }, body: JSON.stringify(body)
    });
    const createScopeCandidate = await fetch(`${applicationProcess.origin}/api/users`, {
      method: "POST", headers: { "content-type": "application/json", cookie: restartedOwner.cookie.header },
      body: JSON.stringify({ email: `scope-candidate-${randomUUID()}@example.test`, password: "ScopeCandidate-123!" })
    });
    assert.equal(createScopeCandidate.status, 201, await createScopeCandidate.clone().text());
    const scopeCandidateId = String((await createScopeCandidate.json()).doc.id);
    const scopeStore = new PostgresAuthorizationStore(pool, {
      validate: (requestedApplicationId, subject) => requestedApplicationId === applicationId && subject.kind === "user" && subject.id === scopeCandidateId ? "accepted" : "rejected"
    });
    const candidateGrantAuthority = await scopeStore.readState(applicationId, environmentName);
    assert.ok(candidateGrantAuthority);
    await scopeStore.transaction(expected(candidateGrantAuthority), async (transaction) => {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.sales-scope-candidate", applicationId, label: "Sales scope candidate", revision: 0 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.sales-scope-candidate.read", applicationId, roleId: "customer.sales-scope-candidate", permissionId: "sales.tasks.read", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: 0 } });
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "customer.sales-scope-candidate.assignment", applicationId, roleId: "customer.sales-scope-candidate", principal: { kind: "user", id: scopeCandidateId }, state: "active", revision: 0 } });
    });
    const candidateAuthority = await scopeState();
    const createCandidateScope = { operation: "upsert", principalId: scopeCandidateId, expectedAuthorizationRevision: candidateAuthority.authorization_revision, expectedLifecycleRevision: candidateAuthority.lifecycle_revision, expectedScopeRevision: null, recordScope: "explicit-application-or-team-scope", applicationWide: true, mutationAllowed: false, authorizedTeamIds: [], idempotencyKey: "scope-create-assigned-candidate-1" };
    const createdScope = await changeScope(createCandidateScope);
    assert.equal(createdScope.status, 200, await createdScope.clone().text());
    assert.deepEqual((await pool.query("select record_scope,application_wide,mutation_allowed,state,revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3", [applicationId, environmentName, scopeCandidateId])).rows, [{ record_scope: "explicit-application-or-team-scope", application_wide: true, mutation_allowed: false, state: "active", revision: 1 }], "A newly assigned current Sales principal can receive exactly one new scope.");
    const candidateRevocationAuthority = await scopeStore.readState(applicationId, environmentName);
    assert.ok(candidateRevocationAuthority);
    await scopeStore.transaction(expected(candidateRevocationAuthority), async (transaction) => transaction.removeGrant(applicationId, "customer.sales-scope-candidate.read"));
    assert.deepEqual((await pool.query("select state,revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3", [applicationId, environmentName, scopeCandidateId])).rows, [{ state: "active", revision: 1 }], "Current-grant loss leaves an active scope dormant instead of silently revoking or deleting it.");
    const candidateRestoreAuthority = await scopeStore.readState(applicationId, environmentName);
    assert.ok(candidateRestoreAuthority);
    await scopeStore.transaction(expected(candidateRestoreAuthority), async (transaction) => transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.sales-scope-candidate.read", applicationId, roleId: "customer.sales-scope-candidate", permissionId: "sales.tasks.read", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: 0 } }));
    assert.deepEqual((await pool.query("select state,revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3", [applicationId, environmentName, scopeCandidateId])).rows, [{ state: "active", revision: 1 }], "Restoring the current grant re-enables the retained active scope without an implicit scope mutation.");
    await pool.query(`insert into sales_current_authority_scopes
      (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision)
      values ($1,'foreign', $3,'managed-teams-and-own',false,true,'[]'::jsonb,'active',17),
             ($2,$4,$3,'managed-teams-and-own',false,true,'[]'::jsonb,'active',19)`, [applicationId, `${applicationId}-foreign`, representativeUserId, environmentName]);
    const representativeScope = await scopeRow();
    const initialScopeAuthority = await scopeState();
    const promoteRepresentative = {
      operation: "upsert", principalId: representativeUserId, expectedAuthorizationRevision: initialScopeAuthority.authorization_revision,
      expectedLifecycleRevision: initialScopeAuthority.lifecycle_revision, expectedScopeRevision: representativeScope.revision,
      recordScope: "managed-teams-and-own", applicationWide: false, mutationAllowed: true, authorizedTeamIds: ["team:representative"], idempotencyKey: "scope-promote-representative-1"
    };
    const promoted = await changeScope(promoteRepresentative);
    assert.equal(promoted.status, 200, await promoted.clone().text());
    const promotedBody = await promoted.json();
    assert.deepEqual(promotedBody, { authorizationRevision: initialScopeAuthority.authorization_revision + 1, lifecycleRevision: initialScopeAuthority.lifecycle_revision, scopeRevision: representativeScope.revision + 1, state: "active" });
    const promotedReplay = await changeScope(promoteRepresentative);
    assert.equal(promotedReplay.status, 200);
    assert.deepEqual(await promotedReplay.json(), promotedBody, "Scope replay must preserve the one committed result.");
    const staleScope = await changeScope({ ...promoteRepresentative, idempotencyKey: "scope-promote-representative-stale", authorizedTeamIds: ["team:other"] });
    assert.equal(staleScope.status, 409, "A stale global/scope CAS must not alter scope authority.");
    assert.deepEqual(await scopeRow(), { record_scope: "managed-teams-and-own", application_wide: false, mutation_allowed: true, authorized_team_ids: ["team:representative"], state: "active", revision: representativeScope.revision + 1 });
    const forgedScopeBoundary = await changeScope({ ...promoteRepresentative, idempotencyKey: "scope-forged-application-1", applicationId: `${applicationId}-foreign`, environment: "foreign" });
    assert.equal(forgedScopeBoundary.status, 400, "Scope endpoint owns application/environment and rejects forged boundary fields.");
    const authorityAfterPromotion = await scopeState();
    const revoked = await changeScope({ operation: "revoke", principalId: representativeUserId, expectedAuthorizationRevision: authorityAfterPromotion.authorization_revision, expectedLifecycleRevision: authorityAfterPromotion.lifecycle_revision, expectedScopeRevision: representativeScope.revision + 1, idempotencyKey: "scope-revoke-representative-1" });
    assert.equal(revoked.status, 200, await revoked.clone().text());
    const revokedBody = await revoked.json();
    assert.equal(revokedBody.state, "revoked");
    assert.equal((await scopeRow()).state, "revoked", "Revoke is a durable tombstone, not a deletion.");
    const revokedReplay = await changeScope({ operation: "revoke", principalId: representativeUserId, expectedAuthorizationRevision: authorityAfterPromotion.authorization_revision, expectedLifecycleRevision: authorityAfterPromotion.lifecycle_revision, expectedScopeRevision: representativeScope.revision + 1, idempotencyKey: "scope-revoke-representative-1" });
    assert.deepEqual(await revokedReplay.json(), revokedBody, "Revoked tombstone replay rechecks and returns the original result.");
    const authorityAfterRevoke = await scopeState();
    const reactivated = await changeScope({ operation: "upsert", principalId: representativeUserId, expectedAuthorizationRevision: authorityAfterRevoke.authorization_revision, expectedLifecycleRevision: authorityAfterRevoke.lifecycle_revision, expectedScopeRevision: revokedBody.scopeRevision, recordScope: "application-sales-scope", applicationWide: true, mutationAllowed: true, authorizedTeamIds: [], idempotencyKey: "scope-reactivate-representative-1" });
    assert.equal(reactivated.status, 200, await reactivated.clone().text());
    const authorityAfterReactivation = await scopeState();
    const demoted = await changeScope({ operation: "upsert", principalId: representativeUserId, expectedAuthorizationRevision: authorityAfterReactivation.authorization_revision, expectedLifecycleRevision: authorityAfterReactivation.lifecycle_revision, expectedScopeRevision: (await reactivated.json()).scopeRevision, recordScope: "explicit-application-or-team-scope", applicationWide: false, mutationAllowed: false, authorizedTeamIds: ["team:representative"], idempotencyKey: "scope-demote-representative-1" });
    assert.equal(demoted.status, 200, await demoted.clone().text());
    const demotedBody = await demoted.json();
    assert.deepEqual(await scopeRow(), { record_scope: "explicit-application-or-team-scope", application_wide: false, mutation_allowed: false, authorized_team_ids: ["team:representative"], state: "active", revision: demotedBody.scopeRevision }, "Demotion preserves an active read scope while removing action authority.");
    const authorityAfterDemotion = await scopeState();
    const restored = await changeScope({ operation: "upsert", principalId: representativeUserId, expectedAuthorizationRevision: authorityAfterDemotion.authorization_revision, expectedLifecycleRevision: authorityAfterDemotion.lifecycle_revision, expectedScopeRevision: demotedBody.scopeRevision, recordScope: "managed-teams-and-own", applicationWide: false, mutationAllowed: true, authorizedTeamIds: ["team:representative"], idempotencyKey: "scope-restore-representative-replay-1" });
    assert.equal(restored.status, 200, await restored.clone().text());
    const restoredBody = await restored.json();
    assert.deepEqual(await scopeRow(), { record_scope: "managed-teams-and-own", application_wide: false, mutation_allowed: true, authorized_team_ids: ["team:representative"], state: "active", revision: restoredBody.scopeRevision }, "Replay principal mutation authority is restored through the same durable scope-admin endpoint.");
    assert.deepEqual((await pool.query("select application_id,environment,state,revision from sales_current_authority_scopes where principal_id=$1 and (environment='foreign' or application_id=$2) order by application_id,environment", [representativeUserId, `${applicationId}-foreign`])).rows, [
      { application_id: applicationId, environment: "foreign", state: "active", revision: 17 },
      { application_id: `${applicationId}-foreign`, environment: environmentName, state: "active", revision: 19 }
    ], "Scope mutation cannot cross its generated application/environment boundary.");
    assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_audit where application_id=$1 and environment=$2 and audit_json->>'operation'='sales-scope-administration'", [applicationId, environmentName])).rows[0].count, 6, "Scope transitions, including replay-principal restoration, have immutable canonical authorization audit evidence.");
    assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_audit audit join k_nex_authorization_outbox outbox on outbox.application_id=audit.application_id and outbox.environment=audit.environment and outbox.authorization_revision=audit.authorization_revision and outbox.lifecycle_revision=audit.lifecycle_revision where audit.application_id=$1 and audit.environment=$2 and audit.audit_json->>'operation'='sales-scope-administration'", [applicationId, environmentName])).rows[0].count, 6, "Every durable scope transition has one matching authorization invalidation event.");
    console.log("P13_SALES_SCOPE_ADMIN_CREATE_UPDATE_REVOKE_REACTIVATE_CAS_REPLAY_POSTGRES_HTTP=PASS");
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
      for (const permissionId of ["sales.opportunities.read", "sales.tasks.read", "sales.opportunities.stage.update"]) {
        await transaction.removeGrant(applicationId, `customer.sales-manager.${permissionId}`);
      }
    });
    const revokedSalesPage = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header } });
    const revokedSalesHtml = await revokedSalesPage.text();
    assert.equal(revokedSalesPage.status, 200, "Revoking Sales authority must not revoke the granted page ACL.");
    const managerRuntime = managerPage.locator("section[data-k-nex-theme-profile]");
    try { await managerRuntime.filter({ hasText: "Unavailable: PERMISSION_DENIED" }).waitFor({ timeout: 10_000 }); }
    catch (error) { throw new Error(`${error}\nserver=${revokedSalesHtml}\nbrowser=${await managerPage.locator("body").innerText()}\nprocess=${applicationProcess.output()}`); }
    assert.equal(await managerPage.getByText("Alpha renewal", { exact: true }).count(), 0, "An already-open page cannot retain revoked Sales source data.");
    assert.equal(await managerPage.locator(`[data-opportunity-id="${String(alpha.rows[0].id)}"]`).getByRole("button", { name: "Move to discovery" }).count(), 0, "An already-open page cannot retain revoked Sales actions.");
    await managerEditorPage.getByRole("alert").getByText("Editor authority changed", { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await managerEditorPage.getByRole("region", { name: "Canvas block keyboard controls" }).count(), 0, "An already-open editor must fail closed after its Sales authority changes.");
    console.log("P12_ATK_20_OPEN_PAGE_AND_EDITOR_SALES_AUTHORITY_REVOCATION_POSTGRES_HTTP_CHROMIUM_DENIED=PASS");
    const revokedManagerSalesAuthority = await store.readState(applicationId, environmentName);
    assert.ok(revokedManagerSalesAuthority);
    await store.transaction(expected(revokedManagerSalesAuthority), async (transaction) => {
      for (const permissionId of ["sales.opportunities.read", "sales.opportunities.amount.read", "sales.tasks.read", "sales.opportunities.stage.update", "sales.reports.read", "sales.settings.read", "sales.tasks.write"]) {
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
    await until(async () => workerProcess.output().includes("K_NEX_WORKER_READY"), () => `Generated worker did not restart.\n${workerProcess.output()}`, workerProcess.child);
    await until(async () => (await pool.query("select count(*)::int as count from k_nex_workspace_page_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName])).rows[0].count === 0, "Workspace page outbox did not converge after worker restart.", workerProcess.child);
    await stop(workerProcess.child, "lost-notification boundary");
    workerProcess = undefined;
    await page.goto(`${applicationProcess.origin}/`);
    const reportsFolder = page.locator(`[data-navigation-node="${folderId}"]`);
    await reportsFolder.locator('[data-navigation-label="true"]').filter({ hasText: /^Reports$/u }).waitFor();
    const shellBeforeFolderUpdate = await page.locator('[data-k-nex-component="workspace-shell"]').elementHandle();
    assert.ok(shellBeforeFolderUpdate, "The open shell must remain available while current navigation polling recovers a missed notification.");
    const lostFolderUpdate = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-folders/${encodeURIComponent(folderId)}`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({ expectedRevision: "2", label: "Reports current", parentNavigationId: "sales.navigation.root", order: String(folderRow.node_json.order) })
    });
    assert.equal(lostFolderUpdate.status, 303, "Folder mutation must commit while its worker is stopped.");
    await reportsFolder.locator('[data-navigation-label="true"]').filter({ hasText: /^Reports current$/u }).waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('[data-k-nex-component="workspace-shell"]').evaluate((element, before) => element === before, shellBeforeFolderUpdate), true, "Navigation polling must converge without remounting the open shell.");
    await shellBeforeFolderUpdate.dispose();
    assert.equal((await pool.query("select count(*)::int as count from k_nex_workspace_navigation_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName])).rows[0].count, 1, "The stopped worker must leave the folder invalidation durable.");
    const currentPageSession = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/session`, { headers: { cookie: restartedOwner.cookie.header } });
    assert.equal(currentPageSession.status, 200);
    const currentPageState = await currentPageSession.json();
    const revokeAccess = new URLSearchParams({ expectedPageRevision: String(currentPageState.projection.watermark.pageRevision), expectedAccessRevision: String(currentPageState.projection.watermark.accessRevision), idempotencyKey: `workspace-revoke-${randomUUID()}` });
    revokeAccess.append("assignment", `user|${ownerUserId}|edit`);
    revokeAccess.append("assignment", `user|${representativeUserId}|view`);
    const revoke = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/access`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: restartedOwner.cookie.header, origin: applicationProcess.origin }, body: revokeAccess
    });
    assert.equal(revoke.status, 303);
    await managerPage.getByRole("alert").getByText("Page access revoked", { exact: true }).waitFor({ timeout: 10_000 });
    await managerEditorPage.getByRole("alert").getByText("Editor access revoked", { exact: true }).waitFor({ timeout: 10_000 });
    await managerPublishedNavigationLink.waitFor({ state: "detached", timeout: 10_000 });
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header } })).status, 404);
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: representative.cookie.header } })).status, 200, "The same-actor durable action replay principal retains its explicit page view authority.");
    const revokedNavigation = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header } });
    assert.equal((await revokedNavigation.text()).includes("Sales command center"), false, "Revoked page must leave current sidebar authority.");
    const revokedActionBefore = await salesRow("opportunity", String(alpha.rows[0].id));
    const revokedAction = await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, manager.cookie.header, opportunityInput(revokedActionBefore, "proposal"));
    assert.equal(revokedAction.status, 404);
    assert.deepEqual(await revokedAction.json(), { code: "NOT_FOUND" });
    assert.deepEqual(await salesRow("opportunity", String(alpha.rows[0].id)), revokedActionBefore, "Revoked page access cannot execute a formerly bound Sales action.");
    console.log("P12_ATK_13_REVOKED_PAGE_ACTION_HTTP_POSTGRES_DENIED=PASS");
    const staleWorkingCopy = (await pool.query("select working_copy_revision from k_nex_workspace_pages where application_id=$1 and environment=$2 and page_id=$3", [applicationId, environmentName, pageId])).rows[0].working_copy_revision;
    const stalePublication = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/publish`, {
      method: "POST", headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ workingCopyRevision: staleWorkingCopy, idempotencyKey: `workspace-stale-publish-${randomUUID()}` })
    });
    assert.equal(stalePublication.status, 404, "Revoked editor publication authority cannot commit.");
    workerProcess = start("node", ["dist/k-nex-worker.js"], { cwd: application, env: applicationEnvironment });
    await until(async () => workerProcess.output().includes("K_NEX_WORKER_READY"), () => `Generated worker did not recover the lost page invalidation.\n${workerProcess.output()}`, workerProcess.child);
    await until(async () => (await pool.query("select count(*)::int as count from k_nex_workspace_page_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName])).rows[0].count === 0, "Lost workspace invalidation did not converge from the durable outbox.", workerProcess.child);
    await until(async () => (await pool.query("select count(*)::int as count from k_nex_workspace_navigation_outbox where application_id=$1 and environment=$2 and status<>'delivered'", [applicationId, environmentName])).rows[0].count === 0, "Lost workspace navigation invalidation did not converge from the durable outbox.", workerProcess.child);
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
    const durableSales = await pool.query("select name, stage_id from sales_opportunities where application_id=$1 and environment=$2 order by id", [applicationId, environmentName]);
    assert.deepEqual(durableSales.rows, [
      { name: "Alpha renewal", stage_id: "proposal" },
      { name: "Beta expansion", stage_id: "proposal" },
      { name: "Representative owned", stage_id: "proposal" },
      { name: "Representative assigned team", stage_id: "discovery" },
      { name: "Representative cross team denied", stage_id: "discovery" },
      { name: "Viewer owned but denied", stage_id: "qualification" },
      { name: "Viewer assigned team allowed", stage_id: "qualification" },
      { name: "Viewer cross team denied", stage_id: "qualification" }
    ]);
    const restartedRepresentative = await login(applicationProcess.origin, representativeEmail, representativePassword);
    const replayAfterRestart = await postPageAction(pageId, salesOpportunityStageUpdateDescriptor.id, restartedRepresentative.cookie.header, replayInput, replayKey);
    assert.equal(replayAfterRestart.status, 200, "A restarted generated host must replay the durable Sales result.");
    const { correlationId: _restartReplayCorrelationId, ...restartReplayBody } = await replayAfterRestart.json();
    assert.deepEqual(restartReplayBody, replayBodies[0], "Restart replay must return the original immutable result.");
    assert.equal((await pool.query(`select count(*)::integer as count from k_nex_outbox where payload->>'resourceId'=$1 and payload->>'actionId'='sales.opportunity.stage.update'`, [replayTarget.id])).rows[0].count, replayOutboxBefore.rows[0].count + 1, "Restart replay must not enqueue another durable event.");
    console.log("P13_SALES_ACTION_DURABLE_RESTART_REPLAY_POSTGRES_HTTP=PASS");

    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header } })).status, 404, "A non-owner with current workspace permission still needs exact page ACL.");
    const durableStore = new PostgresAuthorizationStore(pool, {
      validate: (requestedApplicationId, subject) => requestedApplicationId === applicationId && subject.kind === "user" && [ownerUserId, limitedUserId, managerUserId, representativeUserId].includes(subject.id) ? "accepted" : "rejected"
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
    const fetchViewSession = (targetPageId) => fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(targetPageId)}/session`, {
      headers: { cookie: manager.cookie.header }, signal: AbortSignal.timeout(15_000)
    });
    const managerControlSession = await fetchViewSession(pageId);
    assert.equal(managerControlSession.status, 200, `The restarted application must admit the current owner's small control session before rate exhaustion.\n${await managerControlSession.clone().text()}\n${applicationProcess.output()}`);
    const managerControlProjection = (await managerControlSession.json()).projection;
    assert.equal(managerControlProjection.sourceResults !== undefined, true, "The small control session must load its bound sources.");
    assertOpportunityBinding(managerControlProjection, { state: "success" }, "The initial clean control session must succeed for the Sales opportunity source.");
    const createPlatformPage = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: new URLSearchParams({ title: "Platform-only workspace", description: "No Sales executable dependency", parentNavigationId: "sales.navigation.root", order: "101", themeRevision: "", idempotencyKey: `workspace-platform-only-${randomUUID()}` })
    });
    assert.equal(createPlatformPage.status, 303, await createPlatformPage.clone().text());
    const platformPageId = decodeURIComponent(new URL(createPlatformPage.headers.get("location"), applicationProcess.origin).pathname.split("/").at(-1));
    const platformPageEditor = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(platformPageId)}/session?mode=edit`, { headers: { cookie: manager.cookie.header } });
    assert.equal(platformPageEditor.status, 200, await platformPageEditor.clone().text());
    const platformPageWorkingCopy = (await platformPageEditor.json()).projection.workingCopy;
    assert.deepEqual(platformPageWorkingCopy.document.regions.main, [], "The platform-only proof page must have no executable Sales dependency.");
    const publishPlatformPage = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(platformPageId)}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ workingCopyRevision: platformPageWorkingCopy.revision, idempotencyKey: `workspace-platform-only-publish-${randomUUID()}` })
    });
    assert.equal(publishPlatformPage.status, 200, await publishPlatformPage.clone().text());
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(platformPageId)}`, { headers: { cookie: manager.cookie.header } })).status, 200, "The published platform-only page must render before a Sales lifecycle transition.");
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
    const rateBridge = salesPuckBlockBridges.find(({ definition }) => definition.id === salesOpportunityListBlockDescriptor.id);
    assert.ok(rateBridge, "The current Sales opportunity-list authoring bridge must be available.");
    assert.equal(ratePageProjection.projection.permissions.includes("sales.opportunities.read"), true, JSON.stringify(ratePageProjection.projection.authority));
    assert.equal(ratePageProjection.projection.permissions.includes("sales.opportunities.amount.read"), true, JSON.stringify(ratePageProjection.projection.authority));
    assert.equal(ratePageProjection.projection.authority.blocks.some(({ id, version }) => id === rateBridge.definition.id && version === rateBridge.definition.version), true, JSON.stringify(ratePageProjection.projection.authority));
    assert.equal(ratePageProjection.projection.authority.sources.some(({ id, version }) => id === salesOpportunitiesDescriptor.id && version === salesOpportunitiesDescriptor.version), true, JSON.stringify(ratePageProjection.projection.authority));
    const rateMetricNodes = Array.from({ length: 32 }, (_, index) => ({
      id: `rate-opportunities-${index}`, type: rateBridge.definition.id, version: rateBridge.definition.version,
      props: structuredClone(rateBridge.defaultProps), bindings: structuredClone(rateBridge.defaultBindings)
    }));
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
      const nodes = projection.document.regions.main.filter((node) => node.bindings?.source?.source.id === salesOpportunitiesDescriptor.id);
      assert.ok(nodes.length > 0, `${message} The Sales opportunity rate nodes are missing.`);
      return nodes.map((node) => {
        const binding = projection.sourceResults[node.id];
        assert.ok(binding, `${message} The bound Sales opportunity result is missing.`);
        if (binding.state === "rate-limited") {
          assert.equal(binding.problem?.code, "QUERY_RATE_EXCEEDED", `${message} A serial rate page may only hit the exact rate limit.`);
          assert.equal(binding.problem?.status, 429, `${message} The rate limit must preserve HTTP 429.`);
          return "rate";
        }
        assert.equal(binding.state, "success", `${message} A rate node must either succeed or report the exact rate limit.`);
        return "success";
      });
    };
    const rateFloodSession = await fetchViewSession(ratePageId);
    assert.equal(rateFloodSession.status, 200, `One serial 32-node rate page must preserve binding-level source states.\n${await rateFloodSession.clone().text()}\n${applicationProcess.output()}`);
    assert.equal(inspectRateSession((await rateFloodSession.json()).projection, "One serial 32-node page must consume the same actor/source rate bucket.").includes("rate"), true, "One serial 32-node page must exhaust the shared medium-cost rate bucket.");
    const rateProbeEditor = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(ratePageId)}/session?mode=edit`, { headers: { cookie: manager.cookie.header } });
    assert.equal(rateProbeEditor.status, 200, await rateProbeEditor.clone().text());
    const rateProbeWorkingCopy = (await rateProbeEditor.json()).projection.workingCopy;
    const rateProbeAutosave = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(ratePageId)}/autosave`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({
        expectedRevision: rateProbeWorkingCopy.revision,
        editorSessionId: `workspace-rate-probe-${randomUUID()}`,
        idempotencyKey: `workspace-rate-probe-${randomUUID()}`,
        document: { ...rateProbeWorkingCopy.document, version: rateProbeWorkingCopy.revision + 1, regions: { ...rateProbeWorkingCopy.document.regions, main: [rateMetricNodes[0]] } }
      })
    });
    assert.equal(rateProbeAutosave.status, 200, await rateProbeAutosave.clone().text());
    const savedRateProbe = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(ratePageId)}/session?mode=edit`, { headers: { cookie: manager.cookie.header } });
    assert.equal(savedRateProbe.status, 200, await savedRateProbe.clone().text());
    const publishRateProbe = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(ratePageId)}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ workingCopyRevision: (await savedRateProbe.json()).projection.workingCopy.revision, idempotencyKey: `workspace-rate-probe-${randomUUID()}` })
    });
    assert.equal(publishRateProbe.status, 200, await publishRateProbe.clone().text());
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_100));
    const refilledControlSession = await fetchViewSession(ratePageId);
    assert.equal(refilledControlSession.status, 200, `The same one-node session must recover after source rate tokens refill.\n${await refilledControlSession.clone().text()}\n${applicationProcess.output()}`);
    const refilledControlProjection = await refilledControlSession.json();
    assert.deepEqual(inspectRateSession(refilledControlProjection.projection, "The same one-node Sales opportunity source must succeed after rate tokens refill."), ["success"]);
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
    const operatorDiagnostics = () => `application=${applicationProcess.output()}\noperator=${operatorProcess.output()}`;
    const dualOperatorState = await durableStore.readState(applicationId, environmentName);
    assert.ok(dualOperatorState);
    let restoredFormerOwnerAssignment;
    await durableStore.transaction(expected(dualOperatorState), async (transaction) => {
      const formerOwner = (await transaction.listAssignments(applicationId, { kind: "user", id: ownerUserId })).find((assignment) => assignment.roleId === "system.role.owner" && assignment.state === "revoked");
      assert.ok(formerOwner);
      restoredFormerOwnerAssignment = { ...formerOwner, state: "active", revision: formerOwner.revision + 1 };
      await transaction.write({ kind: "assignment", assignment: restoredFormerOwnerAssignment });
    });
    const managerPlan = await planExtensionInBrowser(retiredRouteContext, applicationProcess.origin, "disable", operatorDiagnostics);
    const managerPlanCommand = JSON.parse(responseLossRelay.requests("extension-plan").at(-1).toString("utf8"));
    try {
      const ownerActor = { ...managerPlanCommand.actor, principal: { kind: "user", id: ownerUserId }, effectiveActor: { kind: "user", id: ownerUserId } };
      assert.notEqual(managerPlanCommand.actor.effectiveActor.id, ownerActor.effectiveActor.id, "Fixture must use two current extension actors.");
      const executionRevision = await currentExtensionExecutionRevision(pool, applicationId, environmentName, "module.sales");
      const ownerExecute = executeCommand({ ...managerPlanCommand, actor: ownerActor }, managerPlan.operationId, executionRevision);
      const authorityBeforePoison = await durableStore.readState(applicationId, environmentName);
      const poisoned = await submitOperatorCommand(operatorPort, operatorCertificates, ownerExecute);
      assert.notEqual(poisoned.status, 200, "A second current actor cannot execute another actor's planned operation.");
      assert.deepEqual(await durableStore.readState(applicationId, environmentName), authorityBeforePoison, "Denied cross-actor execute must not alter current authorization state.");
      assert.equal((await pool.query("select execution_request_digest from runtime_extension_operations where operation_id=$1", [managerPlan.operationId])).rows[0]?.execution_request_digest, null, "Denied cross-actor execute must not bind a durable request digest.");
      const executed = await submitOperatorCommand(operatorPort, operatorCertificates, executeCommand(managerPlanCommand, managerPlan.operationId, executionRevision));
      assert.equal(executed.status, 200, `The planned actor must execute after cross-actor denial. ${executed.body.toString("utf8")}`);
      assert.deepEqual((await pool.query(
        `select
           (select count(*)::int from runtime_extension_transition_receipts where operation_id=$1 and event_json->>'operationPhase'='completed') receipts,
           (select count(*)::int from runtime_extension_audit where operation_id=$1 and event_json->>'operationPhase'='completed') audits,
           (select count(*)::int from runtime_extension_outbox where event_json->>'operationId'=$1 and event_json->>'operationPhase'='completed') outbox`,
        [managerPlan.operationId]
      )).rows, [{ receipts: 1, audits: 1, outbox: 1 }], "Cross-actor denial must leave exactly one planned-actor terminal transition.");
    } finally {
      await managerPlan.administrationPage.close();
    }
    const restoreFormerOwnerState = await durableStore.readState(applicationId, environmentName);
    assert.ok(restoreFormerOwnerState);
    await durableStore.transaction(expected(restoreFormerOwnerState), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: { ...restoredFormerOwnerAssignment, state: "revoked", revision: restoredFormerOwnerAssignment.revision + 1 } });
    });
    console.log("P12_ADMINISTRATION_OPERATOR_CROSS_ACTOR_EXECUTE_POSTGRES_MTLS_HTTP_DENIED=PASS");
    await planAndExecuteExtensionInBrowser(retiredRouteContext, applicationProcess.origin, managerPassword, "re-enable", "install", operatorDiagnostics);
    responseLossRelay.enableResponseLoss();
    const disabledSalesOperationId = await planAndExecuteExtensionInBrowser(retiredRouteContext, applicationProcess.origin, managerPassword, "disable", "disable", operatorDiagnostics, async (operationId) => {
      const attempts = responseLossRelay.requests("extension-plan");
      const results = responseLossRelay.responses("extension-plan");
      assert.equal(responseLossRelay.dropped("extension-plan"), true, "extension-plan must lose its first response after the operator returns 200.");
      assert.equal(attempts.length, 2, "extension-plan must make exactly one transport retry before signed-intent replay.");
      assert.equal(attempts[1].equals(attempts[0]), true, "extension-plan retry must preserve the exact command bytes.");
      assert.equal(results.length, 2, "extension-plan retry must receive the durable operator result.");
      assert.equal(results[1].equals(results[0]), true, "extension-plan retry must return the same durable response that was lost.");
      assert.equal((await pool.query("select count(*)::int as count from runtime_extension_operations where operation_id=$1 and plan_json is not null", [operationId])).rows[0].count, 1, "Signed plan-intent replay must retain one operation.");
      const originalCommand = JSON.parse(attempts[0].toString("utf8"));
      const changedCommand = { ...originalCommand, version: "1.0.1" };
      assert.equal(changedCommand.idempotencyKey, originalCommand.idempotencyKey);
      const operationsBefore = (await pool.query("select count(*)::int as count from runtime_extension_operations where application_id=$1 and environment=$2", [applicationId, environmentName])).rows[0].count;
      const denial = await submitOperatorCommand(responseLossRelay.port, operatorCertificates, changedCommand);
      assert.notEqual(denial.status, 200, "A changed operator plan payload under the same idempotency key must be denied over real mTLS.");
      assert.equal((await pool.query("select count(*)::int as count from runtime_extension_operations where application_id=$1 and environment=$2", [applicationId, environmentName])).rows[0].count, operationsBefore, "Changed operator plan replay must not create an operation.");
    });
    const executeAttempts = responseLossRelay.requests("extension-execute");
    const executeResults = responseLossRelay.responses("extension-execute");
    assert.equal(responseLossRelay.dropped("extension-execute"), true, "extension-execute must lose its first response after the operator returns 200.");
    assert.equal(executeAttempts.length, 2, "extension-execute must make exactly one transport retry.");
    assert.equal(executeAttempts[1].equals(executeAttempts[0]), true, "extension-execute retry must preserve the exact command bytes.");
    assert.equal(executeResults.length, 2, "extension-execute retry must receive the durable operator result.");
    assert.equal(executeResults[1].equals(executeResults[0]), true, "extension-execute retry must return the same durable response that was lost.");
    assert.deepEqual((await pool.query(
      `select
         (select count(*)::int from runtime_extension_operations where operation_id=$1 and plan_json is not null) operations,
         (select count(*)::int from runtime_extension_transition_receipts where operation_id=$1 and event_json->>'operationPhase'='completed') receipts,
         (select count(*)::int from runtime_extension_audit where operation_id=$1 and event_json->>'operationPhase'='completed') audits,
         (select count(*)::int from runtime_extension_outbox where event_json->>'operationId'=$1 and event_json->>'operationPhase'='completed') outbox`,
      [disabledSalesOperationId]
    )).rows, [{ operations: 1, receipts: 1, audits: 1, outbox: 1 }], "Lost plan/execute responses must replay one durable operation and one lifecycle transition.");
    console.log("P12_ADMINISTRATION_OPERATOR_RESPONSE_LOSS_POSTGRES_MTLS_HTTP=PASS");
    const disabledSalesState = await durableStore.readState(applicationId, environmentName);
    assert.ok(disabledSalesState);
    assert.equal((await fetch(`${applicationProcess.origin}/api/readiness`)).status, 200, "A supported disable keeps the exact compiled generation ready while removing Sales availability.");
    await retiredRoutePage.getByRole("alert").getByText("Sales route unavailable", { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await retiredRoutePage.getByRole("form", { name: "Create task" }).count(), 0, "An open registered Sales route must clear its action after a supported disable.");
    const retiredSalesNavigation = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(retiredSalesNavigation.status, 200);
    const retiredSalesHtml = await retiredSalesNavigation.text();
    assert.match(retiredSalesHtml, /K-Nex workspace/u, "Disabling Sales must not deny the host workspace.");
    const retiredSystem = await fetch(`${applicationProcess.origin}/system/workspace-pages`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(retiredSystem.status, 200, "Disabling Sales must not redirect fixed System routes.");
    const retiredDependentPage = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(retiredDependentPage.status, 404, "A custom page depending on disabled Sales must fail closed.");
    const retiredPlatformPage = await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(platformPageId)}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(retiredPlatformPage.status, 200, "A platform-only page must remain renderable while Sales is disabled.");
    assert.equal(retiredSalesHtml.includes(`/workspace/pages/${encodeURIComponent(platformPageId)}`), true, "A platform-only page remains navigable when its Sales placement parent has no executable route.");
    const platformOnlyAction = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(platformPageId)}/actions/${encodeURIComponent("sales.task.create")}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ input: { title: "must not execute" }, idempotencyKey: `workspace-platform-only-action-${randomUUID()}` })
    });
    assert.equal(platformOnlyAction.status, 404, "A platform-only page must not expose a Sales action while Sales is disabled.");
    for (const href of ["/sales", "/sales/tasks", "/sales/opportunities", "/sales/settings"]) {
      assert.equal(retiredSalesHtml.includes(`href=\"${href}\"`), false, `Disabling current Sales generation must remove ${href} navigation.`);
      assert.equal((await fetch(`${applicationProcess.origin}${href}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 404, `Disabling current Sales generation must deny ${href}.`);
    }
    const retiredActionTitle = "Denied after Sales retirement";
    const retiredActionBefore = (await pool.query("select count(*)::int as count from sales_tasks where title=$1", [retiredActionTitle])).rows[0].count;
    const retiredAction = await fetch(`${applicationProcess.origin}/api/k-nex/sales/actions/${encodeURIComponent("sales.task.create")}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ input: { title: retiredActionTitle }, idempotencyKey: `retired-sales-action-${randomUUID()}` })
    });
    assert.equal(retiredAction.status, 400, "A disabled current Sales generation must deny registered route actions.");
    assert.deepEqual(await retiredAction.json(), { code: "INVALID_INPUT" });
    assert.equal((await pool.query("select count(*)::int as count from sales_tasks where title=$1", [retiredActionTitle])).rows[0].count, retiredActionBefore, "Denied registered route action must write nothing.");
    console.log("P12_DISABLED_SALES_GENERATION_NAVIGATION_ROUTE_AND_ACTION_POSTGRES_DENIED=PASS");
    const restoredSalesOperationId = await planAndExecuteExtensionInBrowser(retiredRouteContext, applicationProcess.origin, managerPassword, "re-enable", "install", operatorDiagnostics);
    const restoredSalesState = await durableStore.readState(applicationId, environmentName);
    assert.ok(restoredSalesState);
    assert.equal((await fetch(`${applicationProcess.origin}/api/readiness`)).status, 200, "Readiness must accept later valid Sales lifecycle recovery.");
    const restoredHost = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(restoredHost.status, 200, "Host workspace must remain available after Sales recovery.");
    const restoredSystem = await fetch(`${applicationProcess.origin}/system/workspace-pages`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(restoredSystem.status, 200, "Fixed system route must remain available after Sales lifecycle changes.");
    const restoredSales = await fetch(`${applicationProcess.origin}/sales/tasks`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(restoredSales.status, 200, "A valid later current Sales generation must restore its registered route.");
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 200, "An exact compatible Sales re-enable must restore its published dependent page.");
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
    assert.equal((await fetch(`${applicationProcess.origin}/system/operations/${encodeURIComponent(disabledSalesOperationId)}`, { headers: { cookie: manager.cookie.header } })).status, 200);
    assert.equal((await fetch(`${applicationProcess.origin}/system/operations/${encodeURIComponent(restoredSalesOperationId)}`, { headers: { cookie: manager.cookie.header } })).status, 200);
    assert.match(operatorProcess.output(), new RegExp(`P12_ADMINISTRATION_OPERATOR_READY=${operatorPort}`, "u"));
    await retiredRoutePage.getByRole("form", { name: "Create task" }).waitFor({ timeout: 10_000 });
    await retiredRouteContext.close();
    console.log("P12_LATER_SALES_GENERATION_RECOVERS_NAVIGATION_ROUTE_AND_ACTION_POSTGRES_HTTP=PASS");
    const crashContext = await browserSession(browser, applicationProcess.origin, managerEmail, managerPassword);
    const crashPlan = await planExtensionInBrowser(crashContext, applicationProcess.origin, "disable", operatorDiagnostics);
    const crashPlanCommand = JSON.parse(responseLossRelay.requests("extension-plan").at(-1).toString("utf8"));
    await crashPlan.administrationPage.close();
    await crashContext.close();
    const crashCommand = executeCommand(crashPlanCommand, crashPlan.operationId, await currentExtensionExecutionRevision(pool, applicationId, environmentName, "module.sales"));
    const crashFile = join(root, "operator-pre-mutation-crash");
    await stop(operatorProcess.child, "administration operator before injected crash");
    operatorProcess = startOperator({ P12_OPERATOR_CRASH_BEFORE_MUTATION_FILE: crashFile });
    await until(async () => operatorProcess.output().includes(`P12_ADMINISTRATION_OPERATOR_READY=${operatorPort}`), () => `Crash-injected operator did not start.\n${operatorProcess.output()}`, operatorProcess.child);
    await assert.rejects(submitOperatorCommand(operatorPort, operatorCertificates, crashCommand));
    await until(async () => operatorProcess.child.exitCode === 86, () => `Crash-injected operator did not exit.\n${operatorProcess.output()}`);
    assert.equal(existsSync(crashFile), true, "Crash injection must occur before lifecycle mutation.");
    assert.equal((await pool.query("select execution_request_digest from runtime_extension_operations where operation_id=$1", [crashPlan.operationId])).rows[0]?.execution_request_digest, null, "Pre-mutation crash must leave no execution request binding.");
    assert.deepEqual((await pool.query(
      `select
         (select count(*)::int from runtime_extension_transition_receipts where operation_id=$1 and event_json->>'operationPhase'='completed') receipts,
         (select count(*)::int from runtime_extension_audit where operation_id=$1 and event_json->>'operationPhase'='completed') audits,
         (select count(*)::int from runtime_extension_outbox where event_json->>'operationId'=$1 and event_json->>'operationPhase'='completed') outbox`,
      [crashPlan.operationId]
    )).rows, [{ receipts: 0, audits: 0, outbox: 0 }], "Pre-mutation crash must not create a terminal transition.");
    const committedCrashFile = join(root, "operator-post-commit-crash");
    operatorProcess = startOperator({ P12_OPERATOR_CRASH_AFTER_COMMIT_FILE: committedCrashFile });
    await until(async () => operatorProcess.output().includes(`P12_ADMINISTRATION_OPERATOR_READY=${operatorPort}`), () => `Post-commit crash operator did not start.\n${operatorProcess.output()}`, operatorProcess.child);
    const recoveredCrashCommand = executeCommand(crashPlanCommand, crashPlan.operationId, await currentExtensionExecutionRevision(pool, applicationId, environmentName, "module.sales"));
    await assert.rejects(submitOperatorCommand(operatorPort, operatorCertificates, recoveredCrashCommand));
    await until(async () => operatorProcess.child.exitCode === 87, () => `Post-commit crash operator did not exit.\n${operatorProcess.output()}`);
    assert.equal(existsSync(committedCrashFile), true, "Post-commit crash injection must run before the response is sent.");
    assert.match((await pool.query("select execution_request_digest from runtime_extension_operations where operation_id=$1", [crashPlan.operationId])).rows[0]?.execution_request_digest ?? "", /^sha256:[0-9a-f]{64}$/u, "Terminal lifecycle transaction must include the execute-command digest.");
    operatorProcess = startOperator();
    await until(async () => operatorProcess.output().includes(`P12_ADMINISTRATION_OPERATOR_READY=${operatorPort}`), () => `Restarted operator did not start.\n${operatorProcess.output()}`, operatorProcess.child);
    const recoveredCrash = await submitOperatorCommand(operatorPort, operatorCertificates, recoveredCrashCommand);
    assert.equal(recoveredCrash.status, 200, `Exact post-commit retry must return the durable result. ${recoveredCrash.body.toString("utf8")}`);
    const changedRecoveredCrash = await submitOperatorCommand(operatorPort, operatorCertificates, { ...recoveredCrashCommand, issuedAt: new Date(Date.parse(recoveredCrashCommand.issuedAt) + 1_000).toISOString() });
    assert.notEqual(changedRecoveredCrash.status, 200, "Changed post-commit command bytes must not replay the durable result.");
    assert.deepEqual((await pool.query(
      `select
         (select count(*)::int from runtime_extension_operations where operation_id=$1 and phase='completed') operations,
         (select count(*)::int from runtime_extension_transition_receipts where operation_id=$1 and event_json->>'operationPhase'='completed') receipts,
         (select count(*)::int from runtime_extension_audit where operation_id=$1 and event_json->>'operationPhase'='completed') audits,
         (select count(*)::int from runtime_extension_outbox where event_json->>'operationId'=$1 and event_json->>'operationPhase'='completed') outbox`,
      [crashPlan.operationId]
    )).rows, [{ operations: 1, receipts: 1, audits: 1, outbox: 1 }], "Restarted pre-mutation execution must commit exactly one terminal transition.");
    console.log("P12_ADMINISTRATION_OPERATOR_PRE_MUTATION_CRASH_RESTART_POSTGRES_MTLS_HTTP=PASS");
    console.log("P12_ADMINISTRATION_OPERATOR_POST_COMMIT_CRASH_EXACT_REPLAY_POSTGRES_MTLS_HTTP=PASS");
    const recoveredCrashContext = await browserSession(browser, applicationProcess.origin, managerEmail, managerPassword);
    const recoveredCrashOperationId = await planAndExecuteExtensionInBrowser(recoveredCrashContext, applicationProcess.origin, managerPassword, "re-enable", "install", operatorDiagnostics);
    await recoveredCrashContext.close();
    assert.equal((await fetch(`${applicationProcess.origin}/system/operations/${encodeURIComponent(recoveredCrashOperationId)}`, { headers: { cookie: manager.cookie.header } })).status, 200);
    const recoveredCrashState = await durableStore.readState(applicationId, environmentName);
    assert.ok(recoveredCrashState);
    const salesGenerationBeforeUnrelatedLifecycle = (await pool.query(
      "select authorization_generation, runtime_generation_ids from k_nex_extension_authorization_generations where application_id=$1 and delivery_class='platform-plugin' and extension_id='module.sales' and state='current'",
      [applicationId]
    )).rows;
    assert.equal(salesGenerationBeforeUnrelatedLifecycle.length, 1, "The recovered Sales authorization generation must be current before an unrelated lifecycle advance.");
    const unrelatedLifecycleBefore = await durableStore.readState(applicationId, environmentName);
    assert.ok(unrelatedLifecycleBefore);
    assert.equal(unrelatedLifecycleBefore.lifecycleRevision, recoveredCrashState.lifecycleRevision, "The unrelated lifecycle transition must begin immediately after crash recovery.");
    const unrelatedLifecycleRevision = unrelatedLifecycleBefore.lifecycleRevision + 1;
    const unrelatedGenerationId = `p12-unrelated-hot-application-${unrelatedLifecycleRevision}`;
    const unrelatedLifecycleSession = await pool.connect();
    let unrelatedLifecycleState;
    try {
      await unrelatedLifecycleSession.query("begin");
      unrelatedLifecycleState = (await unrelatedHotApplicationLifecycleProjector.project({
        session: unrelatedLifecycleSession,
        transition: {
          schemaVersion: 1, applicationId, environment: environmentName,
          eventId: `p12-unrelated-hot-application-${unrelatedLifecycleRevision}`, eventType: "extension.lifecycle-transition",
          operationId: `p12-unrelated-hot-application-operation-${unrelatedLifecycleRevision}`, operation: "install", operationPhase: "completed", lifecycleState: "active",
          expectedRevision: unrelatedLifecycleBefore.lifecycleRevision, revision: unrelatedLifecycleRevision, inventoryRevision: unrelatedLifecycleRevision,
          actor: { kind: "trusted-automation", identity: "fixture.generated-unrelated-hot-application-lifecycle" },
          receiptId: `p12-unrelated-hot-application-receipt-${unrelatedLifecycleRevision}`, auditId: `p12-unrelated-hot-application-audit-${unrelatedLifecycleRevision}`,
          idempotencyKey: `p12:unrelated-hot-application:${unrelatedLifecycleRevision}`, correlationId: `p12-unrelated-hot-application-${unrelatedLifecycleRevision}`,
          occurredAt: "2026-09-04T00:00:00.000Z", deliveryClass: "hot-application", id: "app.lifecycle-proof",
          evidence: { sourceCommit: "d".repeat(40), artifactDigest: `sha256:${"e".repeat(64)}`, generationId: unrelatedGenerationId }
        },
        runtimeGenerationIds: [unrelatedGenerationId]
      })).state;
      await unrelatedLifecycleSession.query("commit");
    } catch (error) {
      await unrelatedLifecycleSession.query("rollback");
      throw error;
    } finally { unrelatedLifecycleSession.release(); }
    assert.equal(unrelatedLifecycleState.lifecycleRevision, unrelatedLifecycleRevision, "An unrelated committed Hot Application lifecycle transition must advance the global lifecycle revision.");
    const unrelatedLifecycleHost = await fetch(`${applicationProcess.origin}/`, { headers: { cookie: manager.cookie.header }, redirect: "manual" });
    assert.equal(unrelatedLifecycleHost.status, 200, "An authenticated manual root request must remain available after an unrelated lifecycle transition.");
    const unrelatedLifecycleHostHtml = await unrelatedLifecycleHost.text();
    assert.equal(unrelatedLifecycleHostHtml.includes('href="/sales/tasks"'), true, "An unrelated lifecycle transition must preserve Sales navigation.");
    assert.equal((await fetch(`${applicationProcess.origin}/sales/tasks`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 200, "An unrelated lifecycle transition must preserve the Sales tasks route.");
    const unrelatedLifecycleActionTitle = "Unrelated lifecycle preserved Sales action";
    const unrelatedLifecycleAction = await fetch(`${applicationProcess.origin}/api/k-nex/sales/actions/${encodeURIComponent("sales.task.create")}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager.cookie.header, origin: applicationProcess.origin },
      body: JSON.stringify({ input: { title: unrelatedLifecycleActionTitle }, idempotencyKey: `unrelated-lifecycle-sales-action-${randomUUID()}` }),
      redirect: "manual"
    });
    assert.equal(unrelatedLifecycleAction.status, 200, "An unrelated lifecycle transition must preserve the Sales action.");
    assert.equal((await pool.query("select count(*)::int as count from sales_tasks where title=$1", [unrelatedLifecycleActionTitle])).rows[0].count, 1);
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 200, "An unrelated lifecycle transition must preserve the Sales-dependent page.");
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(platformPageId)}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 200, "An unrelated lifecycle transition must preserve the platform-only page.");
    assert.deepEqual(
      (await pool.query("select authorization_generation, runtime_generation_ids from k_nex_extension_authorization_generations where application_id=$1 and delivery_class='platform-plugin' and extension_id='module.sales' and state='current'", [applicationId])).rows,
      salesGenerationBeforeUnrelatedLifecycle,
      "An unrelated lifecycle transition must not change the current Sales generation identity."
    );
    console.log("P12_UNRELATED_HOT_APPLICATION_LIFECYCLE_ADVANCE_PRESERVES_SALES_POSTGRES_HTTP=PASS");
    const staleReplacementState = await projectSalesLifecycle(
      "update",
      "active",
      "sales-stale-replacement-2",
      "compatible",
      { authority: "static-build", sourceCommit: lifecycleSourceCommit, generationId: kNexSalesRegistry.staticRelease.runtimeGenerationId }
    );
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 404, "A stale Sales replacement must not revive the compiled dependent page.");
    assert.equal((await fetch(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(platformPageId)}`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 200, "A stale Sales replacement must not invalidate a platform-only page.");
    assert.equal((await fetch(`${applicationProcess.origin}/sales/tasks`, { headers: { cookie: manager.cookie.header }, redirect: "manual" })).status, 404, "A stale Sales replacement must not revive compiled static routes.");
    assert.equal(staleReplacementState.lifecycleRevision, unrelatedLifecycleState.lifecycleRevision + 1);
    console.log("P12_WORKSPACE_PAGE_EXECUTABLE_DEPENDENCY_LIFECYCLE_POSTGRES_HTTP=PASS");
    console.log("P12_9_GENERATED_APP_POSTGRES_HTTP_CHROMIUM_EVIDENCE=PASS");
  } finally {
    await responseLossRelay?.close().catch(() => {});
    await stop(operatorProcess?.child, "administration operator").catch(() => {});
    await stop(workerProcess?.child).catch(() => {});
    await stop(applicationProcess?.child).catch(() => {});
    notificationClient?.release();
    await pool?.end().catch(() => {});
    await browser?.close().catch(() => {});
    await container.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
