import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import { afterEach, describe, expect, it } from "vitest";

import { runnerServiceSource } from "../src/service-source.js";

type Frame = Record<string, unknown>;

class RunnerService {
  readonly child: ChildProcessWithoutNullStreams;
  readonly frames: Frame[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(source: string) {
    this.child = spawn(process.execPath, ["--experimental-vm-modules", "-e", runnerServiceSource], { stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity, terminal: false }).on("line", (line) => {
      this.frames.push(JSON.parse(line) as Frame);
      for (const listener of this.listeners) listener();
    });
    this.child.stdin.write(`${JSON.stringify({ type: "invoke", schemaVersion: 1, invocationId: "invocation", generationId: "generation", token: "token", source: `export default ${source}`, input: {}, maxInputBytes: 1024, maxOutputBytes: 1024 })}\n`);
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
const service = (source: string) => {
  const value = new RunnerService(source);
  services.push(value);
  return value;
};
const request = (frame: Frame) => frame.type === "capability-request";
const result = (frame: Frame) => frame.type === "result";

afterEach(async () => {
  await Promise.all(services.splice(0).map((value) => value.stop()));
});

describe("runner service capability lifecycle", () => {
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
});
