import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import { afterEach, describe, expect, it } from "vitest";

import { runnerServiceSource } from "../src/service-source.js";

type Frame = Record<string, unknown>;

class RunnerService {
  readonly child: ChildProcessWithoutNullStreams;
  readonly frames: Frame[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(source: string, input: unknown = {}) {
    this.child = spawn(process.execPath, ["--experimental-vm-modules", "-e", runnerServiceSource], { stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity, terminal: false }).on("line", (line) => {
      this.frames.push(JSON.parse(line) as Frame);
      for (const listener of this.listeners) listener();
    });
    this.child.stdin.write(`${JSON.stringify({ type: "invoke", schemaVersion: 1, invocationId: "invocation", generationId: "generation", token: "token", source: `export default ${source}`, input, maxInputBytes: 1024, maxOutputBytes: 1024 })}\n`);
  }

  async next(predicate: (frame: Frame) => boolean): Promise<Frame> {
    const found = this.frames.find(predicate);
    if (found) return found;
    return new Promise<Frame>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error("runner frame timed out"));
      }, 1_000);
      const listener = () => {
        const frame = this.frames.find(predicate);
        if (!frame) return;
        clearTimeout(timeout);
        this.listeners.delete(listener);
        resolve(frame);
      };
      this.listeners.add(listener);
    });
  }

  respond(sequence: number, output: unknown = null, error: { code: string } | null = null): void {
    this.child.stdin.write(`${JSON.stringify({ type: "capability-response", schemaVersion: 1, invocationId: "invocation", generationId: "generation", sequence, ok: error === null, output, error })}\n`);
  }

  async stop(): Promise<void> {
    this.child.stdin.end();
    if (this.child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => this.child.kill("SIGKILL"), 1_000);
      this.child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

const services: RunnerService[] = [];
const service = (source: string, input?: unknown) => {
  const value = new RunnerService(source, input);
  services.push(value);
  return value;
};
const request = (frame: Frame) => frame.type === "capability-request";
const result = (frame: Frame) => frame.type === "result";
const invokeAck = (frame: Frame) => frame.type === "invoke-ack";

afterEach(async () => {
  await Promise.all(services.splice(0).map((value) => value.stop()));
});

describe("runner service capability lifecycle", () => {
  it("acknowledges a valid invocation before executing it", async () => {
    const runner = service(`() => ({ done: true })`);

    await expect(runner.next(invokeAck)).resolves.toEqual({
      type: "invoke-ack",
      schemaVersion: 1,
      invocationId: "invocation",
      generationId: "generation",
    });
    await expect(runner.next(result)).resolves.toMatchObject({ ok: true, output: { done: true } });
  });

  it("joins a fire-and-forget capability call before returning and closes calls made after the entrypoint settles", async () => {
    const runner = service(`({ host }) => {
      host.call("records.query", { first: true });
      Promise.resolve().then(() => Promise.resolve().then(() => host.call("records.query", { late: true }).catch((error) => console.log(error.message))));
      return { done: true };
    }`);

    const first = await runner.next(request);
    expect(first.sequence).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runner.frames.find(result)).toBeUndefined();
    runner.respond(1, { accepted: true });
    await expect(runner.next(result)).resolves.toMatchObject({ ok: true, output: { done: true } });
    await expect(runner.next((frame) => frame.type === "log" && frame.text === "CAPABILITY_REQUEST_CLOSED")).resolves.toBeDefined();
    expect(runner.frames.filter(request)).toHaveLength(1);
  });

  it("preserves concurrent request order and handled capability denials", async () => {
    const runner = service(`async ({ host }) => {
      const values = await Promise.all([
        host.call("records.query", { position: 1 }),
        host.call("records.query", { position: 2 })
      ]);
      let denied;
      try { await host.call("records.action", {}); } catch (error) { denied = error.message; }
      return { values, denied };
    }`);

    const first = await runner.next((frame) => request(frame) && frame.sequence === 1);
    const second = await runner.next((frame) => request(frame) && frame.sequence === 2);
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    runner.respond(2, "second");
    runner.respond(1, "first");
    const denied = await runner.next((frame) => request(frame) && frame.sequence === 3);
    runner.respond(denied.sequence as number, null, { code: "CAPABILITY_DENIED" });
    await expect(runner.next(result)).resolves.toMatchObject({ ok: true, output: { values: ["first", "second"], denied: "CAPABILITY_DENIED" } });
  });

  it("joins an in-flight capability call before reporting an application failure", async () => {
    const runner = service(`({ host }) => {
      host.call("records.query", {});
      throw new Error("fixture failure");
    }`);

    const call = await runner.next(request);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runner.frames.find(result)).toBeUndefined();
    runner.respond(call.sequence as number, null, { code: "CAPABILITY_DENIED" });
    await expect(runner.next(result)).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_FAILED" } });
  });

  it("keeps source-facing constructors in the VM realm across logs, input, capabilities, promises, errors, and output", async () => {
    const runner = service(`async ({ input, host }) => {
      const escape = (constructor) => {
        try { return constructor("return process")().pid ? "escaped" : "missing"; } catch { return "blocked"; }
      };
      const log = escape(console.log.constructor);
      const call = host.call("records.query", { nested: input.nested });
      const hostCall = escape(host.call.constructor);
      const promise = escape(call.constructor.constructor);
      const inputRoot = escape(input.constructor.constructor);
      const inputNested = escape(input.nested.constructor.constructor);
      const response = await call;
      const responseOutput = escape(response.constructor.constructor);
      let error;
      try { await host.call("records.action", {}); } catch (caught) { error = escape(caught.constructor.constructor); }
      return { log, hostCall, promise, inputRoot, inputNested, responseOutput, error, returnedPromise: escape(Promise.constructor), returnedError: escape(Error.constructor) };
    }`, { nested: { value: true } });

    const first = await runner.next((frame) => request(frame) && frame.sequence === 1);
    runner.respond(first.sequence as number, { response: true });
    const second = await runner.next((frame) => request(frame) && frame.sequence === 2);
    runner.respond(second.sequence as number, null, { code: "CAPABILITY_DENIED" });
    await expect(runner.next(result)).resolves.toMatchObject({
      ok: true,
      output: {
        log: "blocked",
        hostCall: "blocked",
        promise: "blocked",
        inputRoot: "blocked",
        inputNested: "blocked",
        responseOutput: "blocked",
        error: "blocked",
        returnedPromise: "blocked",
        returnedError: "blocked",
      },
    });
  });

  it("blocks global constructor and prototype-chain escapes to Node process and built-ins", async () => {
    const runner = service(`() => {
      const recover = (candidate) => {
        try {
          const value = candidate.constructor("return process")();
          return value && value.pid ? "escaped" : "missing";
        } catch { return "blocked"; }
      };
      const recoverRequire = (candidate) => {
        try {
          const value = candidate.constructor("return require")();
          return typeof value === "function" ? "escaped" : "missing";
        } catch { return "blocked"; }
      };
      const recoverBuiltin = (candidate) => {
        try {
          const process = candidate.constructor("return process")();
          return typeof process.getBuiltinModule === "function" ? "escaped" : "missing";
        } catch { return "blocked"; }
      };
      const globalConstructor = globalThis.constructor;
      const thisConstructor = (function () { return this.constructor; }).call(globalThis);
      const objectPrototype = Object.getPrototypeOf({});
      const globalPrototype = Object.getPrototypeOf(globalThis);
      return {
        globalThisProcess: recover(globalConstructor),
        globalThisRequire: recoverRequire(globalConstructor),
        globalThisBuiltin: recoverBuiltin(globalConstructor),
        thisProcess: recover(thisConstructor),
        thisRequire: recoverRequire(thisConstructor),
        thisBuiltin: recoverBuiltin(thisConstructor),
        objectPrototypeProcess: recover(objectPrototype),
        objectPrototypeRequire: recoverRequire(objectPrototype),
        objectPrototypeBuiltin: recoverBuiltin(objectPrototype),
        globalPrototypeProcess: recover(globalPrototype),
        globalPrototypeRequire: recoverRequire(globalPrototype),
        globalPrototypeBuiltin: recoverBuiltin(globalPrototype),
      };
    }`);

    await expect(runner.next(result)).resolves.toMatchObject({
      ok: true,
      output: {
        globalThisProcess: "blocked",
        globalThisRequire: "blocked",
        globalThisBuiltin: "blocked",
        thisProcess: "blocked",
        thisRequire: "blocked",
        thisBuiltin: "blocked",
        objectPrototypeProcess: "blocked",
        objectPrototypeRequire: "blocked",
        objectPrototypeBuiltin: "blocked",
        globalPrototypeProcess: "blocked",
        globalPrototypeRequire: "blocked",
        globalPrototypeBuiltin: "blocked",
      },
    });
  });

  it("does not expose bootstrap bridges as global lexical bindings", async () => {
    const runner = service(`({ input, host }) => {
      const hidden = (read) => {
        try { return read().constructor("return process")().pid ? "escaped" : "reachable"; }
        catch (error) { return error instanceof ReferenceError ? "reference-error" : "blocked"; }
      };
      return {
        bridge: hidden(() => bridge),
        logBridge: hidden(() => logBridge),
        settleBridge: hidden(() => settleBridge),
        inputJson: hidden(() => inputJson),
        injectedBridge: hidden(() => __bridge),
        injectedLogBridge: hidden(() => __logBridge),
        injectedSettleBridge: hidden(() => __settleBridge),
        injectedInputJson: hidden(() => __inputJson),
        runEntrypoint: hidden(() => __runEntrypoint),
        injectedEntrypoint: hidden(() => __entrypoint),
      };
    }`);

    await expect(runner.next(result)).resolves.toMatchObject({
      ok: true,
      output: {
        bridge: "reference-error",
        logBridge: "reference-error",
        settleBridge: "reference-error",
        inputJson: "reference-error",
        injectedBridge: "reference-error",
        injectedLogBridge: "reference-error",
        injectedSettleBridge: "reference-error",
        injectedInputJson: "reference-error",
        runEntrypoint: "reference-error",
        injectedEntrypoint: "reference-error",
      },
    });
  });
});
