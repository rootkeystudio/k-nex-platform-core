import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

const applicationId = "p13-crm-browser";
const environmentName = "test";

async function login(origin, email, password) {
  const response = await fetch(`${origin}/api/users/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json().catch(() => undefined);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  return { status: response.status, cookie, userId: body?.user?.id === undefined ? undefined : String(body.user.id) };
}

async function currentUser(origin, cookie) {
  const response = await fetch(`${origin}/api/users/me`, { headers: { cookie } });
  const body = await response.json().catch(() => undefined);
  return body?.user?.id === undefined ? undefined : String(body.user.id);
}

async function eventually(check, failure, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value !== undefined) return value; }
    catch (error) { last = error; }
    await new Promise((settle) => setTimeout(settle, 100));
  }
  throw last ?? new Error(failure);
}

/**
 * Drives one ingress request over a raw socket so the body can be withheld,
 * trickled, or oversized in ways fetch cannot express, and records how the
 * server ended it. A reset counts: the requirement is that the worker stops
 * being held, not that every refusal is delivered as JSON.
 */
function rawIngress(origin, path, { headers = {}, body, deadlineMs = 60_000 }) {
  const url = new URL(path, origin);
  assert.equal(url.protocol, "http:");
  const startedAt = Date.now();
  return new Promise((settle) => {
    let done = false;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearTimeout(expiry);
      try { pending.destroy(); } catch { /* the socket may already be gone */ }
      settle({ ...outcome, elapsedMs: Date.now() - startedAt });
    };
    const pending = httpRequest(url, { method: "POST", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        finish({ kind: "response", status: response.statusCode, body: parsed });
      });
      response.on("error", () => finish({ kind: "response-error", status: response.statusCode }));
    });
    const expiry = setTimeout(() => finish({ kind: "expired" }), deadlineMs);
    pending.on("error", () => finish({ kind: "closed" }));
    // A normal response settles first; this only catches a reset with no reply.
    pending.on("close", () => setImmediate(() => finish({ kind: "closed" })));
    body(pending, () => done);
  });
}

function operatorProbe(application, environment, args, extraEnvironment = {}) {
  return spawnSync("pnpm", args, { cwd: application, env: { ...environment, ...extraEnvironment }, encoding: "utf8" });
}

function inProcessProbe(application, environment, script, extraEnvironment = {}) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: application, env: { ...environment, ...extraEnvironment }, encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const line = result.stdout.split("\n").find((candidate) => candidate.startsWith("PROBE_"));
  assert.ok(line !== undefined, `${result.stdout}\n${result.stderr}`);
  return line.startsWith("PROBE_OK ") ? { ok: true, value: JSON.parse(line.slice("PROBE_OK ".length)) } : { ok: false, code: line.slice("PROBE_ERR ".length) };
}

const credentialChangeScript = `
import { bootKnexApplication } from "./dist/boot.js";
import { changeCurrentUserCredentials, kNexRequestContext, shutdownKnexApplication } from "./dist/k-nex-authority.js";
const payload = await bootKnexApplication("credential-change");
try {
  const headers = new Headers(process.env.PROBE_COOKIE === undefined ? {} : { cookie: process.env.PROBE_COOKIE });
  const result = await changeCurrentUserCredentials(payload, kNexRequestContext(headers, "credential-change"), JSON.parse(process.env.PROBE_INPUT));
  console.log("PROBE_OK " + JSON.stringify(result));
} catch (error) { console.log("PROBE_ERR " + (error?.code ?? error?.message ?? String(error))); }
finally { await shutdownKnexApplication(payload); }
process.exit(0);
`;

/**
 * Kills the process at one named boundary of the credential journey, so the
 * database is the only thing left to decide what happened. No generated code is
 * instrumented: everything here wraps the Payload surface the journey uses, and
 * "credential-written" reaches the transaction Payload is carrying to move the
 * credential column on it before the session rows are ever cleared.
 */
const credentialBoundaryInstrumentation = `
import { sql } from "@payloadcms/db-postgres";
const boundary = process.env.PROBE_BOUNDARY;
const die = (at) => { if (boundary === at) { console.log("PROBE_DIED " + at); process.exit(86); } };
function instrument(payload) {
  const update = payload.update.bind(payload);
  const commit = payload.db.commitTransaction.bind(payload.db);
  // Reauthentication logs in, and a login commits a transaction of its own. The
  // credential write is the journey's only payload.update, so it is what arms
  // the commit boundaries.
  let writing = false;
  payload.update = async (args) => {
    writing = true;
    die("before-write");
    if (boundary === "credential-written") {
      const session = payload.db.sessions[String(await args.req.transactionID)];
      if (session === undefined) throw new Error("the credential write is not carrying a transaction");
      await session.db.execute(sql\`update users set email='boundary-orphan@p13.example.test' where id=\${args.id}\`);
      die("credential-written");
    }
    const result = await update(args);
    die("after-write");
    return result;
  };
  payload.db.commitTransaction = async (id) => {
    if (writing) die("after-audit");
    const value = await commit(id);
    if (writing) die("after-commit");
    return value;
  };
}
`;

const credentialBoundaryScript = `${credentialBoundaryInstrumentation}
import { bootKnexApplication } from "./dist/boot.js";
import { changeCurrentUserCredentials, kNexRequestContext, shutdownKnexApplication } from "./dist/k-nex-authority.js";
const payload = await bootKnexApplication("credential-change");
instrument(payload);
try {
  const headers = new Headers({ cookie: process.env.PROBE_COOKIE });
  const result = await changeCurrentUserCredentials(payload, kNexRequestContext(headers, "credential-change"), JSON.parse(process.env.PROBE_INPUT));
  console.log("PROBE_OK " + JSON.stringify(result));
} catch (error) { console.log("PROBE_ERR " + (error?.code ?? error?.message ?? String(error))); }
finally { await shutdownKnexApplication(payload); }
process.exit(0);
`;

const recoveryBoundaryScript = `${credentialBoundaryInstrumentation}
import { bootKnexApplication } from "./dist/boot.js";
import { acquireBootstrapLock, assertIssuedBootstrapToken, readCredentialRecoveryToken, releaseBootstrapLock } from "./dist/k-nex-bootstrap-token.js";
import { kNexAuthority, recoverProtectedOwnerCredential, shutdownKnexApplication } from "./dist/k-nex-authority.js";
import { kNexIdentity } from "./dist/k-nex-identity.js";
const payload = await bootKnexApplication("owner-credential-recovery");
instrument(payload);
let lock;
try {
  const token = readCredentialRecoveryToken(["--token-file", process.env.PROBE_TOKEN_FILE]);
  lock = await acquireBootstrapLock(payload);
  await assertIssuedBootstrapToken(lock, token);
  const receipt = await kNexAuthority(payload).store.readProtectedRoleBaselineReceipt(kNexIdentity.applicationId);
  const recovered = await recoverProtectedOwnerCredential(payload, receipt, process.env.PROBE_OPERATOR, token, { email: process.env.PROBE_EMAIL, password: process.env.PROBE_PASSWORD });
  console.log("PROBE_OK " + JSON.stringify(recovered));
} catch (error) { console.log("PROBE_ERR " + (error?.code ?? error?.message ?? String(error))); }
finally {
  try { if (lock !== undefined) await releaseBootstrapLock(lock); }
  finally { await shutdownKnexApplication(payload); }
}
process.exit(0);
`;

/** The journey is expected to die here, so a clean exit is the failure. */
function boundaryProbe(application, environment, script, boundary, extraEnvironment) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: application, env: { ...environment, ...extraEnvironment, PROBE_BOUNDARY: boundary }, encoding: "utf8"
  });
  assert.equal(result.status, 86, `A ${boundary} probe must die at its boundary.\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(`PROBE_DIED ${boundary}`, "u"), `${result.stdout}\n${result.stderr}`);
}

test("P13.B generated ingress readers are bounded, the realtime bridge recovers, and owner credentials are recoverable", { timeout: 1_200_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ application, origin, personas, pool, environment, applicationOutput }) => {
    const owner = await login(origin, personas.owner.email, personas.owner.password);
    assert.equal(owner.status, 200);
    assert.ok(owner.cookie);
    const uploadHeaders = { cookie: owner.cookie, origin, "content-type": "application/json" };

    // -------- bounded ingress --------
    const oversizedNoLength = await rawIngress(origin, "/api/k-nex/sales/import-upload", {
      headers: uploadHeaders,
      body: (pending) => {
        pending.write('{"artifactId":"p13b-oversized-stream","bytesBase64":"');
        for (let index = 0; index < 23; index += 1) pending.write("A".repeat(1_000_000));
        pending.end('","contentType":"text/csv"}');
      }
    });
    assert.deepEqual({ kind: oversizedNoLength.kind, status: oversizedNoLength.status, body: oversizedNoLength.body },
      { kind: "response", status: 400, body: { code: "IMPORT_LIMIT_EXCEEDED" } },
      `An oversized chunked upload with no content-length must be refused: ${JSON.stringify(oversizedNoLength)}`);
    assert.equal((await pool.query("select count(*)::int count from sales_import_uploads where artifact_id='p13b-oversized-stream'")).rows[0].count, 0);

    const declaredOversize = await rawIngress(origin, "/api/k-nex/sales/import-upload", {
      headers: { ...uploadHeaders, "content-length": "22369921" },
      body: (pending) => { pending.write("{"); }
    });
    assert.deepEqual({ kind: declaredOversize.kind, status: declaredOversize.status, body: declaredOversize.body },
      { kind: "response", status: 400, body: { code: "IMPORT_LIMIT_EXCEEDED" } });
    assert.ok(declaredOversize.elapsedMs < 5_000, `A declared oversize length must be refused without reading: ${declaredOversize.elapsedMs}ms`);

    const neverEnding = await rawIngress(origin, "/api/k-nex/sales/import-upload", {
      headers: uploadHeaders,
      body: (pending) => { pending.write('{"artifactId":"p13b-never-ending"'); },
      deadlineMs: 20_000
    });
    assert.notEqual(neverEnding.kind, "expired", "A body that never ends must not hold the generated upload route open.");
    assert.ok(neverEnding.elapsedMs < 15_000, `A body that never ends must be released quickly: ${neverEnding.elapsedMs}ms`);

    const trickled = await rawIngress(origin, "/api/k-nex/sales/import-upload", {
      headers: uploadHeaders,
      body: (pending, cancelled) => {
        pending.write('{"artifactId":"p13b-trickle"');
        const timer = setInterval(() => {
          if (cancelled() || pending.destroyed) { clearInterval(timer); return; }
          try { pending.write(" "); } catch { clearInterval(timer); }
        }, 100);
      },
      deadlineMs: 90_000
    });
    assert.notEqual(trickled.kind, "expired", "A one-byte-per-interval upload must not hold the generated route past its deadline.");
    assert.ok(trickled.elapsedMs < 45_000, `A trickled upload must end on the total deadline: ${trickled.elapsedMs}ms`);

    const webhookNeverEnding = await rawIngress(origin, "/api/k-nex/sales/providers/email-reference/webhook", {
      headers: { "content-type": "application/json", "x-k-nex-signature": "sha256=" + "0".repeat(64), "x-k-nex-timestamp": new Date().toISOString() },
      body: (pending) => { pending.write("{"); },
      deadlineMs: 20_000
    });
    assert.notEqual(webhookNeverEnding.kind, "expired", "An unauthenticated webhook body that never ends must not hold a worker.");
    assert.ok(webhookNeverEnding.elapsedMs < 15_000, `An unauthenticated webhook body must be released quickly: ${webhookNeverEnding.elapsedMs}ms`);

    const healthStartedAt = Date.now();
    assert.equal((await fetch(`${origin}/api/health`)).ok, true, `Generated host must stay healthy after bounded ingress refusals.\n${applicationOutput()}`);
    assert.ok(Date.now() - healthStartedAt < 5_000, "Generated host must still answer promptly after bounded ingress refusals.");

    // -------- realtime invalidation bridge --------
    const readiness = async () => {
      const response = await fetch(`${origin}/api/readiness`);
      return { status: response.status, body: await response.json() };
    };
    const beforeKill = await readiness();
    assert.equal(beforeKill.status, 200, JSON.stringify(beforeKill.body));
    assert.equal(beforeKill.body.realtime?.state, "connected", `Readiness must report the realtime bridge: ${JSON.stringify(beforeKill.body)}`);
    const listeningBefore = beforeKill.body.realtime.connection;
    const watermarkBefore = beforeKill.body.realtime.watermark;
    assert.ok(Number.isSafeInteger(listeningBefore) && listeningBefore >= 1);
    assert.ok(Number.isSafeInteger(watermarkBefore) && watermarkBefore >= 0);

    const killed = await pool.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and query like 'LISTEN k_nex_runtime_invalidation%'");
    assert.ok(killed.rows.length >= 1, "The generated host must hold a LISTEN backend to terminate.");
    const afterKill = await eventually(async () => {
      const current = await readiness();
      return current.status === 200 && current.body.realtime?.state === "connected" && current.body.realtime.connection > listeningBefore ? current : undefined;
    }, "The generated realtime bridge did not reconnect and resubscribe after its backend was terminated.", 60_000);
    assert.ok(afterKill.body.realtime.watermark >= watermarkBefore, "The realtime watermark must never regress across a reconnect.");
    const relisten = await pool.query("select count(*)::int count from pg_stat_activity where datname=current_database() and query like 'LISTEN k_nex_runtime_invalidation%'");
    assert.ok(relisten.rows[0].count >= 1, "The generated realtime bridge must hold a LISTEN after reconnecting.");

    await pool.query(
      `insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,correlation_id,payload,status,processed_at,retention_until)
       values('p13b-realtime-resync','sales.event.account-changed',1,'durable-integration',now(),$1,'module.sales','p13b-realtime-resync','{}'::jsonb,'delivered',now(),now()+interval '30 days')`,
      [applicationId]
    );
    const resynchronised = await eventually(async () => {
      const current = await readiness();
      return current.status === 200 && current.body.realtime.watermark > afterKill.body.realtime.watermark ? current : undefined;
    }, "The generated realtime bridge did not resynchronise its watermark from the authoritative outbox position.", 60_000);
    assert.equal(resynchronised.body.realtime.state, "connected");

    // -------- credential journey --------
    const restCredentialUpdate = await fetch(`${origin}/api/users/${owner.userId}`, {
      method: "PATCH", headers: { cookie: owner.cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ password: "rest-rewritten-password-1" })
    });
    assert.notEqual(restCredentialUpdate.status, 200, "An ordinary record update must not rewrite a sign-in credential.");
    assert.equal((await login(origin, personas.owner.email, personas.owner.password)).status, 200, "A refused record update must leave the credential intact.");

    const wrongCurrent = inProcessProbe(application, environment, credentialChangeScript, {
      PROBE_COOKIE: owner.cookie,
      PROBE_INPUT: JSON.stringify({ currentPassword: "not-the-current-password", password: "self-service-password-1" })
    });
    assert.deepEqual(wrongCurrent, { ok: false, code: "CREDENTIAL_REAUTHENTICATION_REQUIRED" });
    assert.equal((await login(origin, personas.owner.email, personas.owner.password)).status, 200);

    const selfService = inProcessProbe(application, environment, credentialChangeScript, {
      PROBE_COOKIE: owner.cookie,
      PROBE_INPUT: JSON.stringify({ currentPassword: personas.owner.password, password: "self-service-password-1" })
    });
    assert.equal(selfService.ok, true, JSON.stringify(selfService));
    assert.deepEqual(selfService.value.changed, ["password"]);
    assert.equal(await currentUser(origin, owner.cookie), undefined, "A credential change must revoke every live session.");
    assert.notEqual((await login(origin, personas.owner.email, personas.owner.password)).status, 200, "The replaced password must stop working.");
    const rotated = await login(origin, personas.owner.email, "self-service-password-1");
    assert.equal(rotated.status, 200);
    const credentialAudits = async () => (await pool.query("select count(*)::int count from k_nex_authorization_audit where audit_json->>'operation'='credential-change' and audit_json->>'target'=$1", [owner.userId])).rows[0].count;
    assert.equal(await credentialAudits(), 1);

    // -------- credential boundary failures --------
    // A credential that moved without its audit, or an audit without the
    // credential, is the whole finding. Kill the journey at each boundary in
    // turn and require that nothing survives until the commit does.
    for (const boundary of ["before-write", "credential-written", "after-write", "after-audit"]) {
      boundaryProbe(application, environment, credentialBoundaryScript, boundary, {
        PROBE_COOKIE: rotated.cookie,
        PROBE_INPUT: JSON.stringify({ currentPassword: "self-service-password-1", email: `boundary-${boundary}@p13.example.test`, password: "boundary-refused-password-1" })
      });
      assert.equal((await login(origin, personas.owner.email, "self-service-password-1")).status, 200, `A ${boundary} failure must leave the previous credential working.`);
      assert.notEqual((await login(origin, personas.owner.email, "boundary-refused-password-1")).status, 200, `A ${boundary} failure must not leave the new password working.`);
      assert.notEqual((await login(origin, `boundary-${boundary}@p13.example.test`, "self-service-password-1")).status, 200, `A ${boundary} failure must not leave the new email working.`);
      assert.notEqual((await login(origin, "boundary-orphan@p13.example.test", "self-service-password-1")).status, 200, `A ${boundary} failure must not leave an orphaned credential column behind.`);
      assert.equal(await currentUser(origin, rotated.cookie), owner.userId, `A ${boundary} failure must leave live sessions alone.`);
      assert.equal(await credentialAudits(), 1, `A ${boundary} failure must not write an audit.`);
    }

    // The far side of the same boundary: the commit landed, so the credential
    // moved and carries exactly one audit even though nobody was told.
    boundaryProbe(application, environment, credentialBoundaryScript, "after-commit", {
      PROBE_COOKIE: rotated.cookie,
      PROBE_INPUT: JSON.stringify({ currentPassword: "self-service-password-1", password: "boundary-committed-password-1" })
    });
    assert.notEqual((await login(origin, personas.owner.email, "self-service-password-1")).status, 200, "A committed credential change must replace the old password even when the caller never hears back.");
    assert.equal(await currentUser(origin, rotated.cookie), undefined, "A committed credential change must revoke every live session.");
    const committed = await login(origin, personas.owner.email, "boundary-committed-password-1");
    assert.equal(committed.status, 200);
    assert.equal(await credentialAudits(), 2, "A committed credential change must leave exactly one further audit.");

    // The owner password is now unknown to the operator; only recovery gets it back.
    const directory = mkdtempSync(join(tmpdir(), "p13b-recovery-"));
    try {
      const tokenFile = resolve(directory, "recovery.token");
      const bootstrapReissue = operatorProbe(application, environment, ["knex:issue-bootstrap-token", "--output", resolve(directory, "bootstrap.token")]);
      assert.notEqual(bootstrapReissue.status, 0, "A first-owner bootstrap token must stay unavailable once an owner exists.");

      const issued = operatorProbe(application, environment, ["knex:issue-bootstrap-token", "--recovery", "--output", tokenFile]);
      assert.equal(issued.status, 0, `${issued.stdout}\n${issued.stderr}`);
      assert.match(issued.stdout, /K_NEX_CREDENTIAL_RECOVERY_TOKEN_ISSUED/u);

      const withoutOperator = operatorProbe(application, { ...environment, K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT: "" },
        ["knex:bootstrap-owner", "--recover-credential", "--token-file", tokenFile],
        { K_NEX_OWNER_EMAIL: personas.owner.email, K_NEX_OWNER_PASSWORD: "operatorless-password-1" });
      assert.notEqual(withoutOperator.status, 0, "Recovery must require this deployment's administration operator configuration.");
      assert.notEqual((await login(origin, personas.owner.email, "operatorless-password-1")).status, 200);

      const unspentGrants = async () => (await pool.query("select count(*)::int count from k_nex_owner_bootstrap_tokens where consumed_at is null")).rows[0].count;
      const recoveryAudits = async () => (await pool.query("select count(*)::int count from k_nex_authorization_audit where audit_json->>'operation'='owner-credential-recovery' and audit_json->>'target'=$1", [owner.userId])).rows[0].count;
      assert.equal(await unspentGrants(), 1);

      // The grant is spent on the credential transaction, so a recovery killed
      // anywhere inside that boundary costs the operator nothing: the very same
      // grant file is still spendable, and it is the one the real run below uses.
      for (const boundary of ["before-write", "credential-written", "after-write", "after-audit"]) {
        boundaryProbe(application, environment, recoveryBoundaryScript, boundary, {
          PROBE_TOKEN_FILE: tokenFile,
          PROBE_OPERATOR: environment.K_NEX_ADMINISTRATION_OPERATOR_IDENTITY,
          PROBE_EMAIL: personas.owner.email,
          PROBE_PASSWORD: "boundary-recovered-password-1"
        });
        assert.equal(await unspentGrants(), 1, `A ${boundary} failure must leave the one-shot recovery grant unspent.`);
        assert.equal(await recoveryAudits(), 0, `A ${boundary} failure must not write a recovery audit.`);
        assert.notEqual((await login(origin, personas.owner.email, "boundary-recovered-password-1")).status, 200, `A ${boundary} failure must not move the owner credential.`);
        assert.equal((await login(origin, personas.owner.email, "boundary-committed-password-1")).status, 200, `A ${boundary} failure must leave the owner credential where it was.`);
      }

      // Kept so the spent grant can be presented again; consumption unlinks it.
      const grant = readFileSync(tokenFile, "utf8");
      const recovered = operatorProbe(application, environment,
        ["knex:bootstrap-owner", "--recover-credential", "--token-file", tokenFile],
        { K_NEX_OWNER_EMAIL: personas.owner.email, K_NEX_OWNER_PASSWORD: "operator-recovered-password-1" });
      assert.equal(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
      assert.match(recovered.stdout, new RegExp(`K_NEX_OWNER_CREDENTIAL_RECOVERED ${owner.userId} owner-credential-recovery-[0-9a-f]{32}`, "u"));

      assert.equal(await currentUser(origin, committed.cookie), undefined, "Recovery must revoke every live session.");
      assert.notEqual((await login(origin, personas.owner.email, "boundary-committed-password-1")).status, 200);
      assert.equal((await login(origin, personas.owner.email, "operator-recovered-password-1")).status, 200);
      assert.equal(await unspentGrants(), 0, "The successful recovery must spend the grant the failed attempts left alone.");

      const audit = (await pool.query("select audit_json from k_nex_authorization_audit where audit_json->>'operation'='owner-credential-recovery' and audit_json->>'target'=$1", [owner.userId])).rows;
      assert.equal(audit.length, 1, "Operator recovery must leave exactly one audit record.");
      assert.deepEqual(
        { principal: audit[0].audit_json.principal, outcome: audit[0].audit_json.outcome, reauthentication: audit[0].audit_json.reauthentication, environment: audit[0].audit_json.environment },
        { principal: { kind: "service", id: environment.K_NEX_ADMINISTRATION_OPERATOR_IDENTITY }, outcome: "allow", reauthentication: "satisfied", environment: environmentName }
      );

      writeFileSync(tokenFile, grant, { encoding: "utf8", mode: 0o600 });
      const replayed = operatorProbe(application, environment,
        ["knex:bootstrap-owner", "--recover-credential", "--token-file", tokenFile],
        { K_NEX_OWNER_EMAIL: personas.owner.email, K_NEX_OWNER_PASSWORD: "replayed-recovery-password-1" });
      assert.notEqual(replayed.status, 0, "A consumed recovery grant must not be replayable.");
      assert.notEqual((await login(origin, personas.owner.email, "replayed-recovery-password-1")).status, 200);
      assert.equal((await pool.query("select count(*)::int count from k_nex_owner_bootstrap_tokens where consumed_at is null")).rows[0].count, 0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
