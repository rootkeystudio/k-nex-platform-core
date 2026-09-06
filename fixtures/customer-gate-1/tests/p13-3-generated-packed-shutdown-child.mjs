import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const customerDirectory = resolve(process.argv[2]);
const applicationId = process.argv[3];
const port = Number(process.argv[4]);
const requireFromCustomer = createRequire(resolve(customerDirectory, "package.json"));
const patch = readFileSync(resolve(dirname(requireFromCustomer.resolve("@payloadcms/db-postgres")), "connect.js"), "utf8");
if (!patch.includes("result.release();")) throw new Error("P13.3 packed application missed the required Payload Postgres patch.");
const { bootKnexApplication } = await import(pathToFileURL(resolve(customerDirectory, "dist/boot.js")));
const { shutdownKnexApplication } = await import(pathToFileURL(resolve(customerDirectory, "dist/k-nex-authority.js")));
const payload = await bootKnexApplication(applicationId);
try {
  const { startKnexRealtime } = await import(pathToFileURL(resolve(customerDirectory, "dist/k-nex-realtime.js")));
  const pool = payload.db.pool;
  const connect = pool.connect.bind(pool);
  let checkedOut = 0;
  pool.connect = async () => {
    const client = await connect();
    checkedOut += 1;
    return new Proxy(client, { get(target, key, receiver) {
      if (key === "query") return async (text, ...values) => {
        if (text === "LISTEN k_nex_runtime_invalidation") throw new Error("P13_3_INJECTED_LISTEN_FAILURE");
        return target.query(text, ...values);
      };
      if (key === "release") return (...values) => { checkedOut -= 1; return target.release(...values); };
      return Reflect.get(target, key, receiver);
    } });
  };
  const server = createServer();
  try {
    await assert.rejects(Promise.race([
      startKnexRealtime(payload, server),
      new Promise((_, reject) => setTimeout(() => reject(new Error("P13_3_LISTEN_FAILURE_TIMEOUT")), 5_000))
    ]), /P13_3_INJECTED_LISTEN_FAILURE/u);
    assert.equal(checkedOut, 0, "LISTEN failure retained a PostgreSQL checkout.");
  } finally {
    pool.connect = connect;
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  }
  process.stdout.write("P13_3_PACKED_LISTEN_FAILURE_PASS\n");
  process.stdout.write("P13_3_PACKED_SHUTDOWN_PASS\n");
} finally {
  await shutdownKnexApplication(payload);
}

if (Number.isSafeInteger(port) && port > 0) {
  const start = () => new Promise((resolveProcess, reject) => {
    const child = spawn("pnpm", ["start"], {
      cwd: customerDirectory,
      env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (value) => { output += value; });
    child.stderr.setEncoding("utf8").on("data", (value) => { output += value; });
    child.once("error", reject);
    let exit;
    child.once("close", (code, signal) => { exit = { code, signal }; });
    resolveProcess({ child, output: () => output, exited: () => exit });
  });
  const waitForHttp = async (instance) => {
    const until = Date.now() + 30_000;
    let last;
    while (Date.now() < until) {
      if (instance.exited() !== undefined) throw new Error(`Generated web host exited before HTTP: ${JSON.stringify(instance.exited())}\n${instance.output()}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/__k-nex-process-proof`);
        if (response.status >= 400 && response.status < 600) return;
      } catch (error) { last = error; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw last ?? new Error("Generated web host did not accept HTTP.");
  };
  const stop = async (instance, signal) => {
    const exited = new Promise((resolveExit) => instance.child.once("close", (code, exitSignal) => resolveExit({ code, signal: exitSignal })));
    instance.child.kill(signal);
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Generated web host did not stop.")), 40_000); });
    try { return await Promise.race([exited, timeout]); }
    finally { clearTimeout(timer); }
  };
  const waitForExit = async (instance, timeoutMs, message) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const exit = instance.exited();
      if (exit !== undefined) return exit;
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    instance.child.kill("SIGKILL");
    throw new Error(`${message}\n${instance.output()}`);
  };
  const first = await start();
  await waitForHttp(first);
  const firstExit = await stop(first, "SIGTERM");
  assert.deepEqual(firstExit, { code: 0, signal: null }, first.output());
  await fetch(`http://127.0.0.1:${port}/__k-nex-process-proof`).then(
    () => assert.fail("Generated web host admitted HTTP after shutdown."),
    () => undefined
  );
  const second = await start();
  await waitForHttp(second);
  const secondExit = await stop(second, "SIGINT");
  assert.deepEqual(secondExit, { code: 0, signal: null }, second.output());
  process.stdout.write("P13_3_PACKED_WEB_PROCESS_PASS\n");

  const occupied = createServer((_request, response) => response.writeHead(503).end());
  await new Promise((resolveListen, reject) => occupied.once("error", reject).listen(port, resolveListen));
  try {
    const collision = await start();
    const collisionExit = await waitForExit(collision, 40_000, "Generated web host did not exit after its occupied-port boot failure.");
    assert.notEqual(collisionExit.code, 0, collision.output());
    assert.match(collision.output(), /EADDRINUSE/u);
  } finally {
    await new Promise((resolveClose, reject) => occupied.close((error) => error === undefined ? resolveClose() : reject(error)));
  }
  process.stdout.write("P13_3_PACKED_OCCUPIED_PORT_CLEANUP_PASS\n");

  const realtimePath = resolve(customerDirectory, "dist/k-nex-realtime.js");
  const realtimeSource = readFileSync(realtimePath, "utf8");
  writeFileSync(realtimePath, `export async function startKnexRealtime() { return { close: async () => { throw new Error("P13_3_INJECTED_CLOSE_FAILURE"); } }; }\n`);
  const rejectedClose = await start();
  await waitForHttp(rejectedClose);
  rejectedClose.child.kill("SIGTERM");
  const rejectedExit = await waitForExit(rejectedClose, 10_000, "Generated web host did not exit after its rejected close stage.");
  assert.match(rejectedClose.output(), /P13_3_INJECTED_CLOSE_FAILURE/u);
  assert.notEqual(rejectedExit.code, 0, rejectedClose.output());
  await fetch(`http://127.0.0.1:${port}/__k-nex-process-proof`).then(
    () => assert.fail("Generated web host admitted HTTP after a rejected close stage."),
    () => undefined
  );
  const released = createServer();
  await new Promise((resolveListen, reject) => released.once("error", reject).listen(port, resolveListen));
  await new Promise((resolveClose, reject) => released.close((error) => error === undefined ? resolveClose() : reject(error)));
  process.stdout.write("P13_3_PACKED_REJECTED_CLOSE_DRAIN_PASS\n");

  writeFileSync(realtimePath, realtimeSource);
  const webPath = resolve(customerDirectory, "dist/k-nex-web.js");
  const webSource = readFileSync(webPath, "utf8");
  const injectedHandlerSource = (path, body) => {
    const source = webSource.replace(
      "const handler = nextApp.getRequestHandler();",
      `const nextRequestHandler = nextApp.getRequestHandler();\nconst handler = async (request, response) => {\n  if (request.url === ${JSON.stringify(path)}) {\n${body}\n    return;\n  }\n  return nextRequestHandler(request, response);\n};`
    );
    assert.notEqual(source, webSource, "Generated web host handler seam changed.");
    return source;
  };
  const assertPortReleased = async (label) => {
    const released = createServer();
    await new Promise((resolveListen, reject) => released.once("error", reject).listen(port, resolveListen));
    await new Promise((resolveClose, reject) => released.close((error) => error === undefined ? resolveClose() : reject(error)));
    assert.equal(released.listening, false, `${label} retained the generated web port.`);
  };

  const admittedReleasePath = resolve(customerDirectory, ".p13-3-admitted-release");
  writeFileSync(webPath, injectedHandlerSource("/__k-nex-admitted-tail", `    response.writeHead(200, { "content-type": "text/plain", connection: "close" }).end("P13_3_ADMITTED_RESPONSE_FINISHED");
    console.log("P13_3_ADMITTED_RESPONSE_FINISHED");
    while (!(await import("node:fs")).existsSync(${JSON.stringify(admittedReleasePath)})) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    while (!stopping) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    const query = await payload.db.pool.query("select 1::int as value");
    if (query.rows[0]?.value !== 1) throw new Error("P13_3_ADMITTED_QUERY_RESULT_INVALID");
    console.log("P13_3_ADMITTED_QUERY_SUCCESS");`));
  const admittedTail = await start();
  await waitForHttp(admittedTail);
  const admittedResponse = await fetch(`http://127.0.0.1:${port}/__k-nex-admitted-tail`);
  assert.equal(await admittedResponse.text(), "P13_3_ADMITTED_RESPONSE_FINISHED");
  const admittedExitPromise = stop(admittedTail, "SIGTERM");
  writeFileSync(admittedReleasePath, "release\n");
  const admittedExit = await admittedExitPromise;
  assert.deepEqual(admittedExit, { code: 0, signal: null }, admittedTail.output());
  assert.match(admittedTail.output(), /P13_3_ADMITTED_QUERY_SUCCESS/u);
  await assertPortReleased("admitted handler database tail");
  process.stdout.write("P13_3_PACKED_ADMITTED_HANDLER_DRAIN_PASS\n");

  const admittedNeverSource = injectedHandlerSource("/__k-nex-admitted-never", `    response.writeHead(200, { "content-type": "text/plain", connection: "close" }).end("P13_3_ADMITTED_NEVER_STARTED");
    await new Promise(() => {});`).replace("const gracefulShutdownMs = 30_000;", "const gracefulShutdownMs = 150;");
  assert.notEqual(admittedNeverSource, webSource, "Generated web host admitted handler deadline seam changed.");
  writeFileSync(webPath, admittedNeverSource);
  const admittedNever = await start();
  await waitForHttp(admittedNever);
  assert.equal(await fetch(`http://127.0.0.1:${port}/__k-nex-admitted-never`).then((response) => response.text()), "P13_3_ADMITTED_NEVER_STARTED");
  const admittedNeverStartedAt = Date.now();
  admittedNever.child.kill("SIGTERM");
  const admittedNeverExit = await waitForExit(admittedNever, 5_000, "Generated web host did not force-exit for a never-settling admitted handler.");
  assert.equal(admittedNeverExit.code, 1, admittedNever.output());
  assert.match(admittedNever.output(), /K_NEX_GRACEFUL_SHUTDOWN_EXPIRED/u);
  assert.ok(Date.now() - admittedNeverStartedAt >= 100, "Generated web host did not drain the admitted handler before watchdog expiry.");
  await assertPortReleased("never-settling admitted handler");
  process.stdout.write("P13_3_PACKED_ADMITTED_HANDLER_DEADLINE_PASS\n");

  const rejectedReleasePath = resolve(customerDirectory, ".p13-3-admitted-reject-release");
  writeFileSync(webPath, injectedHandlerSource("/__k-nex-admitted-reject", `    response.writeHead(200, { "content-type": "text/plain", connection: "close" }).end("P13_3_ADMITTED_REJECTION_STARTED");
    while (!(await import("node:fs")).existsSync(${JSON.stringify(rejectedReleasePath)})) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    while (!stopping) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    throw new Error("P13_3_INJECTED_ADMITTED_HANDLER_FAILURE");`));
  const rejectedHandler = await start();
  await waitForHttp(rejectedHandler);
  assert.equal(await fetch(`http://127.0.0.1:${port}/__k-nex-admitted-reject`).then((response) => response.text()), "P13_3_ADMITTED_REJECTION_STARTED");
  const rejectedHandlerExitPromise = stop(rejectedHandler, "SIGTERM");
  writeFileSync(rejectedReleasePath, "release\n");
  const rejectedHandlerExit = await rejectedHandlerExitPromise;
  assert.equal(rejectedHandlerExit.code, 1, rejectedHandler.output());
  assert.match(rejectedHandler.output(), /P13_3_INJECTED_ADMITTED_HANDLER_FAILURE/u);
  assert.match(rejectedHandler.output(), /K-Nex admitted web handler failed/u);
  await assertPortReleased("rejected admitted handler");
  process.stdout.write("P13_3_PACKED_ADMITTED_HANDLER_REJECTION_PASS\n");

  writeFileSync(webPath, webSource);
  const preListenPrimary = webSource.replace(
    "realtime = await startKnexRealtime(payload, server);",
    "realtime = await startKnexRealtime(payload, server);\n  throw new Error(\"P13_3_INJECTED_PRELISTEN_PRIMARY_FAILURE\");"
  );
  assert.notEqual(preListenPrimary, webSource, "Generated web host pre-listen startup seam changed.");
  writeFileSync(webPath, preListenPrimary);
  const preListenFailure = await start();
  const preListenExit = await waitForExit(preListenFailure, 10_000, "Generated web host did not exit after a pre-listen startup failure.");
  assert.equal(preListenExit.code, 1, preListenFailure.output());
  assert.match(preListenFailure.output(), /P13_3_INJECTED_PRELISTEN_PRIMARY_FAILURE/u);
  await assertPortReleased("pre-listen primary failure");
  process.stdout.write("P13_3_PACKED_PRELISTEN_PRIMARY_CLEANUP_PASS\n");

  const preListenCleanupReject = preListenPrimary.replace(
    "await attempt(async () => nextApp.close());",
    "await attempt(async () => { throw new Error(\"P13_3_INJECTED_PRELISTEN_CLEANUP_REJECTION\"); });"
  );
  assert.notEqual(preListenCleanupReject, preListenPrimary, "Generated web host pre-listen cleanup rejection seam changed.");
  writeFileSync(webPath, preListenCleanupReject);
  const preListenRejected = await start();
  const preListenRejectedExit = await waitForExit(preListenRejected, 10_000, "Generated web host swallowed a pre-listen cleanup rejection.");
  assert.equal(preListenRejectedExit.code, 1, preListenRejected.output());
  assert.match(preListenRejected.output(), /P13_3_INJECTED_PRELISTEN_PRIMARY_FAILURE/u);
  assert.match(preListenRejected.output(), /P13_3_INJECTED_PRELISTEN_CLEANUP_REJECTION/u);
  await assertPortReleased("pre-listen cleanup rejection");
  process.stdout.write("P13_3_PACKED_PRELISTEN_REJECTED_CLEANUP_PASS\n");

  const preListenCleanupNever = preListenPrimary
    .replace("const startupCleanupMs = 5_000;", "const startupCleanupMs = 150;")
    .replace("await attempt(async () => nextApp.close());", "await attempt(async () => new Promise(() => {}));");
  assert.notEqual(preListenCleanupNever, preListenPrimary, "Generated web host pre-listen cleanup deadline seam changed.");
  writeFileSync(webPath, preListenCleanupNever);
  const preListenNever = await start();
  const preListenStartedAt = Date.now();
  const preListenNeverExit = await waitForExit(preListenNever, 5_000, "Generated web host did not force-exit after a stalled pre-listen cleanup.");
  assert.equal(preListenNeverExit.code, 1, preListenNever.output());
  assert.match(preListenNever.output(), /K_NEX_STARTUP_CLEANUP_EXPIRED/u);
  assert.ok(Date.now() - preListenStartedAt >= 100, "Generated web host did not wait for its pre-listen cleanup watchdog.");
  await assertPortReleased("pre-listen stalled cleanup");
  process.stdout.write("P13_3_PACKED_PRELISTEN_DEADLINE_PASS\n");

  writeFileSync(webPath, webSource);
  const shortGraceWebSource = webSource.replace("const gracefulShutdownMs = 30_000;", "const gracefulShutdownMs = 150;");
  assert.notEqual(shortGraceWebSource, webSource, "Generated web host graceful shutdown seam changed.");
  const handleFreeNeverWebSource = shortGraceWebSource.replace(
    "return shutdown;\n}",
    "await new Promise(() => {});\n    return shutdown;\n}"
  );
  assert.notEqual(handleFreeNeverWebSource, shortGraceWebSource, "Generated web host shutdown completion seam changed.");
  writeFileSync(webPath, handleFreeNeverWebSource);
  const neverSettles = await start();
  await waitForHttp(neverSettles);
  const neverStartedAt = Date.now();
  neverSettles.child.kill("SIGTERM");
  const neverExit = await waitForExit(neverSettles, 5_000, "Generated web host exited successfully before its referenced shutdown watchdog.");
  assert.equal(neverExit.code, 1, neverSettles.output());
  assert.match(neverSettles.output(), /K_NEX_GRACEFUL_SHUTDOWN_EXPIRED/u);
  assert.ok(Date.now() - neverStartedAt >= 100, "Generated web host did not wait for its shutdown watchdog.");
  process.stdout.write("P13_3_PACKED_HANDLE_FREE_SHUTDOWN_DEADLINE_PASS\n");

  writeFileSync(webPath, shortGraceWebSource);
  writeFileSync(realtimePath, `export async function startKnexRealtime() { return { close: async () => { throw new Error("P13_3_INJECTED_SETTLED_CLOSE_FAILURE"); } }; }\n`);
  const settledRejection = await start();
  await waitForHttp(settledRejection);
  const rejectionStartedAt = Date.now();
  settledRejection.child.kill("SIGTERM");
  const rejectionExit = await waitForExit(settledRejection, 5_000, "Generated web host did not force-exit after a settled shutdown rejection.");
  assert.equal(rejectionExit.code, 1, settledRejection.output());
  assert.match(settledRejection.output(), /P13_3_INJECTED_SETTLED_CLOSE_FAILURE/u);
  assert.ok(Date.now() - rejectionStartedAt < 2_000, "Generated web host waited for its graceful deadline after a settled rejection.");
  process.stdout.write("P13_3_PACKED_SETTLED_REJECTION_IMMEDIATE_PASS\n");

  writeFileSync(realtimePath, realtimeSource);
  writeFileSync(webPath, webSource);
  const injectedWebSource = webSource.replace('server.on("error", (error) => {', 'setTimeout(() => server.emit("error", new Error("P13_3_INJECTED_POST_LISTEN_ERROR")), 100);\nserver.on("error", (error) => {');
  assert.notEqual(injectedWebSource, webSource, "Generated web host post-listen error seam changed.");
  writeFileSync(webPath, injectedWebSource);
  const postListenFailure = await start();
  const postListenExit = await waitForExit(postListenFailure, 10_000, "Generated web host swallowed its post-listen server error.");
  assert.notEqual(postListenExit.code, 0, postListenFailure.output());
  assert.match(postListenFailure.output(), /P13_3_INJECTED_POST_LISTEN_ERROR/u);
  await fetch(`http://127.0.0.1:${port}/__k-nex-process-proof`).then(
    () => assert.fail("Generated web host admitted HTTP after a post-listen server error."),
    () => undefined
  );
  const postListenReleased = createServer();
  await new Promise((resolveListen, reject) => postListenReleased.once("error", reject).listen(port, resolveListen));
  await new Promise((resolveClose, reject) => postListenReleased.close((error) => error === undefined ? resolveClose() : reject(error)));
  process.stdout.write("P13_3_PACKED_POST_LISTEN_ERROR_PASS\n");
}
