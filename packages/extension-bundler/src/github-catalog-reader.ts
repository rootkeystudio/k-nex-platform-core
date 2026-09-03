export type CatalogHttpHeaders = Readonly<Record<string, string | undefined>>;

export interface CatalogHttpResponse {
  readonly status: number;
  readonly headers: CatalogHttpHeaders;
  readonly body: AsyncIterable<Uint8Array>;
}

export interface CatalogHttpTransport {
  request(input: Readonly<{
    url: string;
    headers: Readonly<Record<string, string>>;
    signal: AbortSignal;
  }>): Promise<CatalogHttpResponse>;
}

export type OfficialCatalogReadErrorCode = "BODY_INVALID" | "CONTENT_TYPE" | "DEADLINE" | "ENDPOINT_INVALID" | "REDIRECT_INVALID" | "RESPONSE_INVALID" | "TOO_LARGE";

export class OfficialCatalogReadError extends Error {
  constructor(readonly code: OfficialCatalogReadErrorCode, message: string) {
    super(message);
    this.name = "OfficialCatalogReadError";
  }
}

export interface OfficialGithubCatalogReaderOptions {
  readonly endpoint: string;
  readonly transport: CatalogHttpTransport;
  readonly deadlineMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
}

const githubAssetEndpoint = /^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/assets\/[1-9][0-9]*$/u;
const redirectHosts = new Set(["objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

function initialEndpoint(value: string): string {
  if (!githubAssetEndpoint.test(value)) fail("ENDPOINT_INVALID", "Official catalog endpoint must be one exact GitHub release asset API URL.");
  const url = new URL(value);
  if (url.username || url.password || url.port || url.search || url.hash) fail("ENDPOINT_INVALID", "Official catalog endpoint is invalid.");
  return url.href;
}

function redirectTarget(value: string | undefined): string {
  if (!value) fail("REDIRECT_INVALID", "Official catalog redirect is missing its target.");
  let url: URL;
  try { url = new URL(value); } catch { fail("REDIRECT_INVALID", "Official catalog redirect target is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !redirectHosts.has(url.hostname)) {
    fail("REDIRECT_INVALID", "Official catalog redirect leaves the GitHub release asset boundary.");
  }
  return url.href;
}

function integer(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new TypeError(`${label} is invalid.`);
  return result;
}

function fail(code: OfficialCatalogReadErrorCode, message: string): never {
  throw new OfficialCatalogReadError(code, message);
}

/** Reads one deployment-owned public GitHub release asset without credentials. */
export class OfficialGithubCatalogReader {
  readonly #endpoint: string;
  readonly #transport: CatalogHttpTransport;
  readonly #deadlineMs: number;
  readonly #maxBytes: number;
  readonly #maxRedirects: number;

  constructor(options: OfficialGithubCatalogReaderOptions) {
    this.#endpoint = initialEndpoint(options.endpoint);
    this.#transport = options.transport;
    this.#deadlineMs = integer(options.deadlineMs, 5_000, 100, 30_000, "Official catalog deadline");
    this.#maxBytes = integer(options.maxBytes, 1_048_576, 1_024, 4_194_304, "Official catalog byte limit");
    this.#maxRedirects = integer(options.maxRedirects, 2, 0, 3, "Official catalog redirect limit");
  }

  async read(): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#deadlineMs);
    try {
      let url = this.#endpoint;
      for (let redirect = 0; redirect <= this.#maxRedirects; redirect += 1) {
        const response = await this.request(url, controller.signal);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirect === this.#maxRedirects) fail("REDIRECT_INVALID", "Official catalog exceeded its redirect limit.");
          url = redirectTarget(response.headers.location);
          continue;
        }
        if (response.status !== 200) fail("RESPONSE_INVALID", "Official catalog returned a non-success response.");
        const contentType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "application/json" && contentType !== "application/octet-stream") {
          fail("CONTENT_TYPE", "Official catalog response content type is invalid.");
        }
        const declaredLength = response.headers["content-length"];
        if (declaredLength !== undefined && (!/^(0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > this.#maxBytes)) {
          fail("TOO_LARGE", "Official catalog response exceeds its byte limit.");
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body) {
          if (!(chunk instanceof Uint8Array)) fail("BODY_INVALID", "Official catalog response body is invalid.");
          size += chunk.byteLength;
          if (size > this.#maxBytes) fail("TOO_LARGE", "Official catalog response exceeds its byte limit.");
          chunks.push(chunk);
        }
        try {
          return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
        } catch { fail("BODY_INVALID", "Official catalog response is not valid UTF-8 JSON."); }
      }
      fail("REDIRECT_INVALID", "Official catalog redirect handling failed.");
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof OfficialCatalogReadError)) fail("DEADLINE", "Official catalog read exceeded its deadline.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(url: string, signal: AbortSignal): Promise<CatalogHttpResponse> {
    try {
      return await this.#transport.request({
        url,
        headers: Object.freeze({
          accept: "application/octet-stream",
          "accept-encoding": "identity",
          "user-agent": "k-nex-official-catalog/1.0.0"
        }),
        signal
      });
    } catch (error) {
      if (signal.aborted) fail("DEADLINE", "Official catalog read exceeded its deadline.");
      throw error;
    }
  }
}

/** Native credentialless transport; redirect policy remains owned by the reader. */
export class FetchCatalogHttpTransport implements CatalogHttpTransport {
  async request(input: Readonly<{ url: string; headers: Readonly<Record<string, string>>; signal: AbortSignal }>): Promise<CatalogHttpResponse> {
    const response = await fetch(input.url, { method: "GET", headers: input.headers, redirect: "manual", signal: input.signal, credentials: "omit" });
    const body = response.body;
    if (!body) fail("BODY_INVALID", "Official catalog response body is unavailable.");
    return Object.freeze({
      status: response.status,
      headers: Object.freeze({
        "content-length": response.headers.get("content-length") ?? undefined,
        "content-type": response.headers.get("content-type") ?? undefined,
        location: response.headers.get("location") ?? undefined
      }),
      body
    });
  }
}
