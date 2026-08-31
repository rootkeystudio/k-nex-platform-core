import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { ExtensionNetworkError } from "../src/extension-network-capability.js";
import { NodeHttpsExtensionNetworkTransport } from "../src/extension-network-transport.js";

const claims = {
  schemaVersion: 1 as const, tokenId: "network-token-1", applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant",
  generationId: "sales-assistant-generation-1", invocationId: "network-invocation-1", actor: { principalId: "user:one", effectiveActorId: "user:one" },
  correlationId: "network-correlation-1", grants: [], issuedAt: "2026-08-29T10:00:00.000Z", expiresAt: "2026-08-29T10:01:00.000Z"
};

class FakeRequest extends EventEmitter {
  readonly ended: Buffer[] = [];
  destroyed = false;
  end(body?: Buffer): void { if (body !== undefined) this.ended.push(body); }
  destroy(): this { this.destroyed = true; return this; }
}

class FakeResponse extends Readable {
  destroyedByTransport = false;
  constructor(readonly statusCode: number, readonly headers: Record<string, string | undefined> = {}) {
    super();
    this.on("error", () => undefined);
  }
  _read(): void {}
  override destroy(error?: Error): this { this.destroyedByTransport = true; return super.destroy(error); }
}

const limits = { maxInputBytes: 32, maxOutputBytes: 16, maxWallTimeMs: 100, maxConcurrency: 1 };
const requestInput = (overrides: Partial<{ destination: string; path: string; headers: Record<string, string>; body: unknown; signal: AbortSignal }> = {}) => ({
  destination: "https://api.example.test", path: "/v1/tasks?state=open", method: "POST" as const, headers: { accept: "application/json", ...overrides.headers }, ...(overrides.body === undefined ? {} : { body: overrides.body }), signal: overrides.signal ?? new AbortController().signal,
  ...("destination" in overrides ? { destination: overrides.destination! } : {}), ...("path" in overrides ? { path: overrides.path! } : {})
});
const publicAnswers = [{ address: "8.8.8.8", family: 4 as const }];

function transport(response?: FakeResponse, overrides: Partial<ConstructorParameters<typeof NodeHttpsExtensionNetworkTransport>[1]> = {}, customLimits = limits) {
  const request = vi.fn((options: RequestOptions, callback: (value: IncomingMessage) => void) => {
    const fake = new FakeRequest();
    if (response) queueMicrotask(() => callback(response as never));
    return fake as never;
  });
  return { value: new NodeHttpsExtensionNetworkTransport(customLimits, { resolve: vi.fn(async () => publicAnswers), request: request as never, ...overrides }), request };
}

function json(response: FakeResponse, value: unknown): void {
  queueMicrotask(() => { response.push(JSON.stringify(value)); response.push(null); });
}

describe("Node HTTPS extension network transport", () => {
  it.each([
    ["non-HTTPS destination", "http://api.example.test", "/"],
    ["destination credentials", "https://user:password@api.example.test", "/"],
    ["destination path", "https://api.example.test/other", "/"],
    ["origin drift", "https://api.example.test", "//private.example.test/"]
  ])("rejects %s before DNS or transport", async (_label, destination, path) => {
    const { value, request } = transport();
    await expect(value.request(requestInput({ destination, path }), claims)).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    "0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1",
    "::", "::1", "fc00::1", "fe80::1", "2001:db8::1", "2001:2::1", "2001:20::1", "2002:7f00::1", "3fff::1", "ff00::1", "::ffff:127.0.0.1"
  ])("rejects private, loopback, link-local, CGNAT, documentation, multicast, reserved, and mapped answers: %s", async (address) => {
    const family = address.includes(":") ? 6 as const : 4 as const;
    // URL canonicalization itself rejects the dotted IPv4-mapped literal, so
    // exercise that classifier through a normal hostname DNS answer instead.
    const destination = address === "::ffff:127.0.0.1" ? "https://api.example.test" : `https://${family === 6 ? `[${address}]` : address}`;
    const resolve = vi.fn(async () => [{ address, family }]);
    const { value, request } = transport(undefined, { resolve });
    await expect(value.request(requestInput({ destination, path: "/" }), claims)).rejects.toMatchObject({ code: "DNS_DENIED" });
    expect(resolve).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects mixed public/private DNS answers and empty resolution", async () => {
    for (const answers of [[...publicAnswers, { address: "127.0.0.1", family: 4 as const }], []] as const) {
      const { value, request } = transport(undefined, { resolve: async () => answers });
      await expect(value.request(requestInput(), claims)).rejects.toMatchObject({ code: answers.length === 0 ? "DNS_FAILED" : "DNS_DENIED" });
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("resolves once, pins the vetted answer in lookup, and never sends capability identity metadata", async () => {
    for (const answer of [
      { address: "1.1.1.1", family: 4 as const },
      { address: "2001:4860::8888", family: 6 as const },
      { address: "2606:4700:4700::1111", family: 6 as const }
    ]) {
      const response = new FakeResponse(200);
      const resolve = vi.fn(async () => [answer]);
      const { value, request } = transport(response, { resolve });
      const pending = value.request(requestInput({ headers: { "x-request": "kept", host: "forged", connection: "keep-alive", "accept-encoding": "gzip" } }), claims);
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
      const options = request.mock.calls[0]![0];
      await new Promise<void>((resolveLookup, rejectLookup) => (options.lookup as never)("api.example.test", {}, (error: Error | null, address: string, family: number) => error ? rejectLookup(error) : (expect(address).toBe(answer.address), expect(family).toBe(answer.family), resolveLookup())));
      await new Promise<void>((resolveLookup, rejectLookup) => (options.lookup as never)("api.example.test", { all: true }, (error: Error | null, addresses: readonly typeof answer[]) => error ? rejectLookup(error) : (expect(addresses).toEqual([answer]), resolveLookup())));
      expect(resolve).toHaveBeenCalledOnce();
      expect(options.headers).toEqual({ "accept-encoding": "identity", connection: "close", accept: "application/json", "x-request": "kept" });
      expect(JSON.stringify(options.headers)).not.toContain(claims.tokenId);
      expect(JSON.stringify(options.headers)).not.toContain(claims.actor.principalId);
      expect(JSON.stringify(options.headers)).not.toContain(claims.generationId);
      json(response, { ok: true });
      await expect(pending).resolves.toEqual({ status: 200, body: { ok: true } });
    }
  });

  it("rejects oversized bodies before DNS/request and replaces caller transport headers", async () => {
    const { value, request } = transport();
    await expect(value.request(requestInput({ body: { tooLong: "x".repeat(40) } }), claims)).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    expect(request).not.toHaveBeenCalled();

    const response = new FakeResponse(200);
    const healthy = transport(response);
    const pending = healthy.value.request(requestInput({ body: { ok: true }, headers: { "content-length": "999", "transfer-encoding": "chunked", host: "private", connection: "upgrade" } }), claims);
    await vi.waitFor(() => expect(healthy.request).toHaveBeenCalledOnce());
    const options = healthy.request.mock.calls[0]![0];
    expect(options.headers).toMatchObject({ "content-type": "application/json", connection: "close", "accept-encoding": "identity" });
    expect(options.headers?.["content-length"]).not.toBe("999");
    expect(options.headers).not.toHaveProperty("host");
    expect(options.headers).not.toHaveProperty("transfer-encoding");
    json(response, {});
    await expect(pending).resolves.toEqual({ status: 200, body: {} });
  });

  it.each([300, 301, 302, 303, 307, 308])("rejects redirect status %i without following Location", async (status) => {
    const response = new FakeResponse(status, { location: "https://127.0.0.1/internal" });
    const { value, request } = transport(response);
    await expect(value.request(requestInput(), claims)).rejects.toMatchObject({ code: "REDIRECT_DENIED" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(response.destroyedByTransport).toBe(true);
  });

  it.each([
    ["encoded response", new FakeResponse(200, { "content-encoding": "gzip" }), "RESPONSE_ENCODING_REJECTED"],
    ["oversized Content-Length", new FakeResponse(200, { "content-length": "17" }), "OUTPUT_TOO_LARGE"],
    ["invalid JSON", new FakeResponse(200), "RESPONSE_INVALID"]
  ])("rejects %s", async (_label, response, code) => {
    const { value } = transport(response);
    const pending = value.request(requestInput(), claims);
    if (code === "RESPONSE_INVALID") queueMicrotask(() => { response.push("nope"); response.push(null); });
    await expect(pending).rejects.toMatchObject({ code });
    expect(response.destroyedByTransport).toBe(true);
  });

  it("enforces header parsing and incremental chunked output limits before retention", async () => {
    const headerOverflow = transport(undefined, { request: (() => { throw new Error("Parse Error: Header overflow"); }) as never });
    await expect(headerOverflow.value.request(requestInput(), claims)).rejects.toMatchObject({ code: "TRANSPORT_FAILED" });

    const response = new FakeResponse(200);
    const { value } = transport(response);
    const pending = value.request(requestInput(), claims);
    queueMicrotask(() => { response.push("123456789"); response.push("012345678"); });
    await expect(pending).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });
    expect(response.destroyedByTransport).toBe(true);
  });

  it("destroys caller-aborted requests, releases concurrency, and permits the next request", async () => {
    const requests: FakeRequest[] = [];
    const request = vi.fn((_options: RequestOptions, _callback: (response: IncomingMessage) => void) => { const fake = new FakeRequest(); requests.push(fake); return fake as never; });
    const controller = new AbortController();
    const value = new NodeHttpsExtensionNetworkTransport({ ...limits, maxWallTimeMs: 1_000 }, { resolve: async () => publicAnswers, request: request as never });
    const first = value.request(requestInput({ signal: controller.signal }), claims);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await expect(value.request(requestInput(), claims)).rejects.toMatchObject({ code: "CONCURRENCY_EXHAUSTED" });
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: "ABORTED" });
    expect(requests[0]!.destroyed).toBe(true);

    const response = new FakeResponse(201);
    request.mockImplementationOnce((_options, callback) => { const fake = new FakeRequest(); queueMicrotask(() => callback(response as never)); return fake as never; });
    const next = value.request(requestInput(), claims);
    json(response, { ok: 1 });
    await expect(next).resolves.toEqual({ status: 201, body: { ok: 1 } });
  });

  it("destroys timed-out requests and permits the next request", async () => {
    const requests: FakeRequest[] = [];
    const request = vi.fn((_options: RequestOptions, _callback: (response: IncomingMessage) => void) => { const fake = new FakeRequest(); requests.push(fake); return fake as never; });
    const value = new NodeHttpsExtensionNetworkTransport({ ...limits, maxWallTimeMs: 5 }, { resolve: async () => publicAnswers, request: request as never });
    const first = value.request(requestInput(), claims);
    await expect(first).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(requests[0]!.destroyed).toBe(true);

    const response = new FakeResponse(201);
    request.mockImplementationOnce((_options, callback) => { const fake = new FakeRequest(); queueMicrotask(() => callback(response as never)); return fake as never; });
    const next = value.request(requestInput(), claims);
    json(response, { ok: 1 });
    await expect(next).resolves.toEqual({ status: 201, body: { ok: 1 } });
  });

  it("surfaces TLS/request failure and returns only bounded status/body on success", async () => {
    const request = vi.fn((_options: RequestOptions, _callback: (response: IncomingMessage) => void) => {
      const fake = new FakeRequest(); queueMicrotask(() => fake.emit("error", new Error("certificate verify failed"))); return fake as never;
    });
    const failed = new NodeHttpsExtensionNetworkTransport(limits, { resolve: async () => publicAnswers, request: request as never });
    await expect(failed.request(requestInput(), claims)).rejects.toMatchObject({ code: "TRANSPORT_FAILED" });

    const response = new FakeResponse(204);
    const healthy = transport(response);
    const pending = healthy.value.request(requestInput(), claims);
    json(response, ["bounded"]);
    await expect(pending).resolves.toEqual({ status: 204, body: ["bounded"] });
  });
});
