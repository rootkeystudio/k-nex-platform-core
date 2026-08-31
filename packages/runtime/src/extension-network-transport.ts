import { lookup as lookupDns } from "node:dns/promises";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import type { IncomingMessage, ClientRequest } from "node:http";
import type { RequestOptions } from "node:https";
import type { LookupFunction } from "node:net";

import { canonicalJson } from "@k-nex/contracts";

import type { ExtensionCapabilityClaims } from "./extension-capability-gateway.js";
import { ExtensionNetworkError, type ExtensionNetworkPolicyAdapter } from "./extension-network-capability.js";

export interface ExtensionNetworkTransportLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxWallTimeMs: number;
  readonly maxConcurrency: number;
}

export interface ExtensionNetworkAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface NodeHttpsExtensionNetworkTransportDependencies {
  readonly resolve?: (hostname: string) => Promise<readonly ExtensionNetworkAddress[]>;
  readonly request?: (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
}

const maxHeaderBytes = 16 * 1024;
const unsafeHeaders = new Set(["host", "content-length", "transfer-encoding", "connection", "accept-encoding"]);
const nonGlobalIpv6Prefixes: readonly (readonly [readonly number[], number])[] = [
  [[0x20, 0x01, 0x00], 23], // IETF protocol assignments
  [[0x20, 0x01, 0x00, 0x02, 0x00, 0x00], 48], // benchmarking
  [[0x20, 0x01, 0x00, 0x10], 28], // ORCHID
  [[0x20, 0x01, 0x00, 0x20], 28], // ORCHIDv2
  [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
  [[0x20, 0x02], 16], // 6to4
  [[0x26, 0x20, 0x00, 0x4f, 0x80, 0x00], 48], // AS112 direct delegation
  [[0x3f, 0xff, 0x00], 20], // documentation
  [[0x5f, 0x00], 16] // Segment Routing
];

function fail(code: ExtensionNetworkError["code"], message: string): never {
  throw new ExtensionNetworkError(code, message);
}

function validLimits(limits: ExtensionNetworkTransportLimits): void {
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Network transport limits must be positive safe integers.");
}

function requestTarget(destination: string, path: string): URL {
  let base: URL;
  let target: URL;
  try {
    base = new URL(destination);
    target = new URL(path, `${base.origin}/`);
  } catch { return fail("REQUEST_INVALID", "Network request URL is invalid."); }
  if (destination !== base.origin || base.protocol !== "https:" || base.username !== "" || base.password !== "" || base.pathname !== "/" || base.search !== "" || base.hash !== "" ||
    target.protocol !== "https:" || target.username !== "" || target.password !== "" || target.hash !== "" || target.origin !== base.origin || `${target.pathname}${target.search}` !== path) {
    fail("REQUEST_INVALID", "Network request URL changed during parsing.");
  }
  return target;
}

function ipv4(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/u.test(part) || Number(part) > 255)) return undefined;
  return parts.reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function privateIpv4(address: string): boolean {
  const value = ipv4(address);
  if (value === undefined) return true;
  const first = value >>> 24;
  const second = (value >>> 16) & 255;
  const third = (value >>> 8) & 255;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168 || (second === 31 && third === 196) || (second === 52 && third === 193) || (second === 88 && third === 99) || (second === 175 && third === 48))) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113);
}

function ipv6Bytes(address: string): Uint8Array | undefined {
  if (isIP(address) !== 6) return undefined;
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return undefined;
  const groups = (part: string): string[] => part === "" ? [] : part.split(":");
  const left = groups(halves[0]!);
  const right = groups(halves[1] ?? "");
  const embedded = right.length > 0 && right[right.length - 1]!.includes(".") ? right.pop() : left.length > 0 && left[left.length - 1]!.includes(".") ? left.pop() : undefined;
  const embeddedValue = embedded === undefined ? undefined : ipv4(embedded);
  if (embedded !== undefined && embeddedValue === undefined) return undefined;
  const required = left.length + right.length + (embedded === undefined ? 0 : 2);
  if (required > 8 || (halves.length === 1 && required !== 8)) return undefined;
  const values = [...left, ...Array(8 - required).fill("0"), ...right];
  if (embeddedValue !== undefined) values.push(((embeddedValue >>> 16) & 65535).toString(16), (embeddedValue & 65535).toString(16));
  if (values.length !== 8 || values.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return undefined;
  return Uint8Array.from(values.flatMap((group) => [Number.parseInt(group, 16) >>> 8, Number.parseInt(group, 16) & 255]));
}

function ipv6InPrefix(bytes: Uint8Array, prefix: readonly number[], bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  if (prefix.length < fullBytes + (bits % 8 === 0 ? 0 : 1)) return false;
  for (let index = 0; index < fullBytes; index += 1) if (bytes[index] !== prefix[index]) return false;
  const partialBits = bits % 8;
  if (partialBits === 0) return true;
  const mask = 0xff << (8 - partialBits);
  return (bytes[fullBytes]! & mask) === (prefix[fullBytes]! & mask);
}

function privateIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (bytes === undefined) return true;
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 255 && bytes[11] === 255;
  if (mapped) return privateIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  const zero = bytes.every((byte) => byte === 0);
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const globalUnicast = (bytes[0]! & 0xe0) === 0x20;
  return zero || loopback || (bytes[0]! & 0xfe) === 0xfc || (bytes[0]! === 0xfe && (bytes[1]! & 0xc0) === 0x80) || bytes[0] === 0xff ||
    nonGlobalIpv6Prefixes.some(([prefix, bits]) => ipv6InPrefix(bytes, prefix, bits)) || !globalUnicast;
}

function globalAddress(answer: ExtensionNetworkAddress): boolean {
  return answer.family === 4 ? isIP(answer.address) === 4 && !privateIpv4(answer.address) : answer.family === 6 && !privateIpv6(answer.address);
}

function abortError(caller: AbortSignal): ExtensionNetworkError {
  return new ExtensionNetworkError(caller.aborted ? "ABORTED" : "TIMEOUT", caller.aborted ? "Network request was aborted." : "Network request timed out.");
}

async function withSignal<T>(promise: Promise<T>, signal: AbortSignal, caller: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(caller);
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(abortError(caller)); signal.addEventListener("abort", rejectAbort, { once: true }); });
  try { return await Promise.race([promise, aborted]); }
  finally { if (rejectAbort) signal.removeEventListener("abort", rejectAbort); }
}

function safeHeaders(headers: Readonly<Record<string, string>>, body: Buffer | undefined): Record<string, string> {
  const result: Record<string, string> = { "accept-encoding": "identity", connection: "close" };
  for (const [name, value] of Object.entries(headers)) if (!unsafeHeaders.has(name.toLowerCase())) result[name.toLowerCase()] = value;
  if (body !== undefined) {
    result["content-type"] ??= "application/json";
    result["content-length"] = String(body.byteLength);
  }
  return result;
}

/** Host-owned HTTPS transport: DNS answers are checked once, then pinned for the socket lookup. */
export class NodeHttpsExtensionNetworkTransport implements ExtensionNetworkPolicyAdapter {
  private readonly active = new Map<string, number>();
  private readonly resolve: (hostname: string) => Promise<readonly ExtensionNetworkAddress[]>;
  private readonly requester: (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

  constructor(private readonly limits: ExtensionNetworkTransportLimits, dependencies: NodeHttpsExtensionNetworkTransportDependencies = {}) {
    validLimits(limits);
    this.resolve = dependencies.resolve ?? ((hostname) => lookupDns(hostname, { all: true, verbatim: true }) as Promise<ExtensionNetworkAddress[]>);
    this.requester = dependencies.request ?? requestHttps;
  }

  async request(input: Readonly<{ destination: string; path: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; headers: Readonly<Record<string, string>>; body?: unknown; signal: AbortSignal }>, context: ExtensionCapabilityClaims): Promise<unknown> {
    const key = [context.applicationId, context.environment, context.appId, context.generationId].join("\0");
    const active = this.active.get(key) ?? 0;
    if (active >= this.limits.maxConcurrency) fail("CONCURRENCY_EXHAUSTED", "Network concurrency limit is exhausted.");
    this.active.set(key, active + 1);
    const timeout = AbortSignal.timeout(this.limits.maxWallTimeMs);
    const signal = AbortSignal.any([input.signal, timeout]);
    try {
      const target = requestTarget(input.destination, input.path);
      let body: Buffer | undefined;
      if (input.body !== undefined) {
        let json: string;
        try { json = canonicalJson(input.body); } catch { fail("REQUEST_INVALID", "Network request body must be canonical JSON."); }
        body = Buffer.from(json);
        if (body.byteLength > this.limits.maxInputBytes) fail("INPUT_TOO_LARGE", "Network request body exceeds its byte limit.");
      }
      const hostname = target.hostname.startsWith("[") ? target.hostname.slice(1, -1) : target.hostname;
      let answers: readonly ExtensionNetworkAddress[];
      try { answers = await withSignal(this.resolve(hostname), signal, input.signal); }
      catch (error) {
        if (error instanceof ExtensionNetworkError) throw error;
        fail("DNS_FAILED", "Network destination could not be resolved.");
      }
      if (answers.length === 0) fail("DNS_FAILED", "Network destination has no addresses.");
      if (answers.some((answer) => !globalAddress(answer))) fail("DNS_DENIED", "Network destination resolved to a non-global address.");
      return await this.send(target, answers[0]!, input.method, safeHeaders(input.headers, body), body, signal, input.signal);
    } finally {
      const remaining = (this.active.get(key) ?? 1) - 1;
      if (remaining === 0) this.active.delete(key); else this.active.set(key, remaining);
    }
  }

  private async send(target: URL, answer: ExtensionNetworkAddress, method: string, headers: Record<string, string>, body: Buffer | undefined, signal: AbortSignal, caller: AbortSignal): Promise<Readonly<{ status: number; body: unknown }>> {
    if (signal.aborted) throw abortError(caller);
    const hostname = target.hostname.startsWith("[") ? target.hostname.slice(1, -1) : target.hostname;
    return new Promise((resolve, reject) => {
      const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: answer.address, family: answer.family }]);
        else callback(null, answer.address, answer.family);
      };
      let request: ClientRequest | undefined;
      let response: IncomingMessage | undefined;
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", aborted);
        callback();
      };
      const failRequest = (error: ExtensionNetworkError) => {
        response?.destroy(error);
        request?.destroy(error);
        finish(() => reject(error));
      };
      const aborted = () => failRequest(abortError(caller));
      const receive = (incoming: IncomingMessage) => {
        response = incoming;
        const status = incoming.statusCode ?? 0;
        if (status >= 300 && status < 400) return failRequest(new ExtensionNetworkError("REDIRECT_DENIED", "Network redirects are not allowed."));
        const encoding = incoming.headers["content-encoding"];
        if (encoding !== undefined && (typeof encoding !== "string" || encoding.toLowerCase() !== "identity")) return failRequest(new ExtensionNetworkError("RESPONSE_ENCODING_REJECTED", "Encoded network responses are not allowed."));
        const declared = incoming.headers["content-length"];
        const length = declared === undefined ? undefined : typeof declared === "string" ? Number(declared) : Number.NaN;
        if (length !== undefined && (!Number.isSafeInteger(length) || length < 0 || length > this.limits.maxOutputBytes)) return failRequest(new ExtensionNetworkError("OUTPUT_TOO_LARGE", "Network response exceeds its byte limit."));
        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on("data", (chunk: Buffer | Uint8Array | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > this.limits.maxOutputBytes) return failRequest(new ExtensionNetworkError("OUTPUT_TOO_LARGE", "Network response exceeds its byte limit."));
          chunks.push(buffer);
        });
        incoming.once("aborted", () => failRequest(new ExtensionNetworkError("TRANSPORT_FAILED", "Network response was interrupted.")));
        incoming.once("error", () => failRequest(signal.aborted ? abortError(caller) : new ExtensionNetworkError("TRANSPORT_FAILED", "Network response failed.")));
        incoming.once("end", () => {
          if (settled) return;
          let parsed: unknown;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { return failRequest(new ExtensionNetworkError("RESPONSE_INVALID", "Network response was not valid JSON.")); }
          finish(() => resolve(Object.freeze({ status, body: parsed })));
        });
      };
      signal.addEventListener("abort", aborted, { once: true });
      try {
        const options: RequestOptions = { protocol: "https:", hostname, port: target.port || undefined, path: `${target.pathname}${target.search}`, method, headers, agent: false, maxHeaderSize: maxHeaderBytes, rejectUnauthorized: true,
          ...(isIP(hostname) === 0 ? { servername: hostname } : {}), lookup: pinnedLookup };
        request = this.requester(options, receive);
        request.once("error", () => failRequest(signal.aborted ? abortError(caller) : new ExtensionNetworkError("TRANSPORT_FAILED", "Network request failed.")));
        request.end(body);
      } catch { failRequest(signal.aborted ? abortError(caller) : new ExtensionNetworkError("TRANSPORT_FAILED", "Network request failed.")); }
    });
  }
}
