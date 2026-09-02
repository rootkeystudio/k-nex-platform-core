import { createServer } from "node:http";
import { once } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  OfficialGithubCatalogReader,
  FetchCatalogHttpTransport,
  type CatalogHttpResponse,
  type CatalogHttpTransport
} from "../src/github-catalog-reader.js";

const endpoint = "https://api.github.com/repos/k-nex/official-catalog/releases/assets/42";
const bytes = (value: string) => new TextEncoder().encode(value);
const body = async function* (...chunks: Uint8Array[]) { yield* chunks; };
const response = (status: number, value = "{}", headers: Record<string, string> = { "content-type": "application/json" }): CatalogHttpResponse => ({ status, headers, body: body(bytes(value)) });

function harness(responses: CatalogHttpResponse[], options: Partial<ConstructorParameters<typeof OfficialGithubCatalogReader>[0]> = {}) {
  const request = vi.fn<CatalogHttpTransport["request"]>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  });
  return {
    request,
    reader: new OfficialGithubCatalogReader({ endpoint, transport: { request }, ...options })
  };
}

describe("OfficialGithubCatalogReader", () => {
  it("accepts only one exact configured GitHub release asset API endpoint", () => {
    for (const invalid of [
      "http://api.github.com/repos/k-nex/official-catalog/releases/assets/42",
      "https://api.github.com/repos/k-nex/official-catalog/releases/assets/42?token=browser",
      "https://github.com/k-nex/official-catalog/releases/download/v1/catalog.json",
      "https://evil.test/repos/k-nex/official-catalog/releases/assets/42"
    ]) expect(() => new OfficialGithubCatalogReader({ endpoint: invalid, transport: { request: vi.fn() } })).toThrow(/exact GitHub release asset/u);
  });

  it("reads JSON through one bounded GitHub asset redirect without credentials", async () => {
    const value = harness([
      response(302, "", { location: "https://release-assets.githubusercontent.com/github-production-release-asset/catalog.json?sig=opaque" }),
      response(200, '{"schemaVersion":1}', { "content-type": "application/octet-stream", "content-length": "19" })
    ]);
    await expect(value.reader.read()).resolves.toEqual({ schemaVersion: 1 });
    expect(value.request).toHaveBeenCalledTimes(2);
    expect(value.request.mock.calls[0]![0]).toMatchObject({ url: endpoint, headers: { accept: "application/octet-stream", "accept-encoding": "identity" } });
    expect(value.request.mock.calls[0]![0].headers).not.toHaveProperty("authorization");
  });

  it("rejects redirects outside GitHub asset storage and redirect loops", async () => {
    await expect(harness([response(302, "", { location: "https://evil.test/catalog.json" })]).reader.read()).rejects.toMatchObject({ code: "REDIRECT_INVALID" });
    const location = "https://objects.githubusercontent.com/catalog.json";
    await expect(harness([response(302, "", { location }), response(302, "", { location })], { maxRedirects: 1 }).reader.read()).rejects.toMatchObject({ code: "REDIRECT_INVALID" });
  });

  it("rejects response status and content type before parsing", async () => {
    await expect(harness([response(503)]).reader.read()).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
    await expect(harness([response(200, "{}", { "content-type": "text/html" })]).reader.read()).rejects.toMatchObject({ code: "CONTENT_TYPE" });
  });

  it("enforces declared and streamed byte bounds", async () => {
    await expect(harness([response(200, "{}", { "content-type": "application/json", "content-length": "2048" })], { maxBytes: 1024 }).reader.read()).rejects.toMatchObject({ code: "TOO_LARGE" });
    const streamed = harness([{ status: 200, headers: { "content-type": "application/json" }, body: body(bytes("x".repeat(700)), bytes("x".repeat(700))) }], { maxBytes: 1024 });
    await expect(streamed.reader.read()).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("rejects malformed UTF-8 JSON", async () => {
    await expect(harness([response(200, "not-json")]).reader.read()).rejects.toMatchObject({ code: "BODY_INVALID" });
    const invalidUtf8 = harness([{ status: 200, headers: { "content-type": "application/json" }, body: body(Uint8Array.of(0xff)) }]);
    await expect(invalidUtf8.reader.read()).rejects.toMatchObject({ code: "BODY_INVALID" });
  });

  it("aborts the request at the configured deadline", async () => {
    const request = vi.fn<CatalogHttpTransport["request"]>((input) => new Promise((_resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const reader = new OfficialGithubCatalogReader({ endpoint, transport: { request }, deadlineMs: 100 });
    await expect(reader.read()).rejects.toMatchObject({ code: "DEADLINE" });
  });

  it("enforces the reader through a real streamed HTTP response", async () => {
    const server = createServer((request, result) => {
      if (request.url === "/initial") {
        result.writeHead(302, { location: "https://release-assets.githubusercontent.com/catalog.json?sig=opaque" });
        result.end();
        return;
      }
      result.writeHead(200, { "content-type": "application/octet-stream" });
      result.write('{"schemaVersion":');
      result.end("1}");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server address unavailable");
      const native = new FetchCatalogHttpTransport();
      const transport: CatalogHttpTransport = {
        request: (input) => native.request({
          ...input,
          url: `http://127.0.0.1:${address.port}${input.url === endpoint ? "/initial" : "/asset"}`
        })
      };
      await expect(new OfficialGithubCatalogReader({ endpoint, transport }).read()).resolves.toEqual({ schemaVersion: 1 });
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
