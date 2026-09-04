import { createHash } from "node:crypto";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as requestHttps, type RequestOptions } from "node:https";
import { isIP } from "node:net";

import {
  AdministrationOperatorAuthenticatedCommandSchema,
  AdministrationOperatorCommandSchema,
  AdministrationOperatorMtlsIdentitySchema,
  AdministrationOperatorResponseBindingSchema,
  AdministrationOperatorResponseSchema,
  administrationOperatorCommandPath,
  administrationOperatorRequestDigestInput,
  canonicalJson,
  isAdministrationOperatorCommandActiveAt,
  type AdministrationOperatorCommand,
  type AdministrationOperatorMtlsIdentity,
  type AdministrationOperatorResponse
} from "@k-nex/contracts";

export type AdministrationOperatorClientErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_COMMAND"
  | "COMMAND_INACTIVE"
  | "REQUEST_TOO_LARGE"
  | "TIMEOUT"
  | "TRANSPORT_FAILED"
  | "RESPONSE_STATUS_INVALID"
  | "RESPONSE_CONTENT_TYPE_INVALID"
  | "RESPONSE_TOO_LARGE"
  | "RESPONSE_INVALID"
  | "RESPONSE_BINDING_INVALID";

export class AdministrationOperatorClientError extends Error {
  constructor(readonly code: AdministrationOperatorClientErrorCode, message: string) {
    super(message);
    this.name = "AdministrationOperatorClientError";
  }
}

export interface AdministrationOperatorClientOptions {
  readonly hostname: string;
  readonly port: number;
  readonly certificate: Uint8Array;
  readonly privateKey: Uint8Array;
  readonly certificateAuthority: Uint8Array;
  readonly expectedMtlsIdentity: AdministrationOperatorMtlsIdentity;
  readonly operatorIdentity: string;
  readonly timeoutMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
}

export interface AdministrationOperatorClientDependencies {
  readonly request?: (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
  readonly now?: () => Date;
}

const maximumCredentialBytes = 1024 * 1024;
const maximumHeaderBytes = 16 * 1024;
const maximumTimeoutMs = 30_000;
const maximumBodyBytes = 65_536;
const operatorIdentityPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u;
const dnsNamePattern = /^(?=.{1,253}\.?$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.?$/u;

function fail(code: AdministrationOperatorClientErrorCode, message: string): never {
  throw new AdministrationOperatorClientError(code, message);
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function credential(value: Uint8Array): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > maximumCredentialBytes) {
    fail("INVALID_CONFIGURATION", "Administration operator TLS configuration is invalid.");
  }
  return Buffer.from(value);
}

/** Server-only mTLS client for the single administration operator command endpoint. */
export class NodeHttpsAdministrationOperatorClient {
  readonly #hostname: string;
  readonly #port: number;
  readonly #certificate: Buffer;
  readonly #privateKey: Buffer;
  readonly #certificateAuthority: Buffer;
  readonly #expectedMtlsIdentity: AdministrationOperatorMtlsIdentity;
  readonly #operatorIdentity: string;
  readonly #timeoutMs: number;
  readonly #maxRequestBytes: number;
  readonly #maxResponseBytes: number;
  readonly #request: (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
  readonly #now: () => Date;

  constructor(options: AdministrationOperatorClientOptions, dependencies: AdministrationOperatorClientDependencies = {}) {
    if (typeof options !== "object" || options === null) fail("INVALID_CONFIGURATION", "Administration operator client configuration is invalid.");
    if (typeof options.hostname !== "string" || (isIP(options.hostname) === 0 && !dnsNamePattern.test(options.hostname)) || !positiveSafeInteger(options.port) || options.port > 65_535 ||
      !positiveSafeInteger(options.timeoutMs) || options.timeoutMs > maximumTimeoutMs ||
      !positiveSafeInteger(options.maxRequestBytes) || options.maxRequestBytes > maximumBodyBytes ||
      !positiveSafeInteger(options.maxResponseBytes) || options.maxResponseBytes > maximumBodyBytes ||
      typeof options.operatorIdentity !== "string" || !operatorIdentityPattern.test(options.operatorIdentity)) {
      fail("INVALID_CONFIGURATION", "Administration operator client configuration is invalid.");
    }
    const identity = AdministrationOperatorMtlsIdentitySchema.safeParse(options.expectedMtlsIdentity);
    if (!identity.success) fail("INVALID_CONFIGURATION", "Administration operator mTLS identity is invalid.");
    this.#hostname = options.hostname;
    this.#port = options.port;
    this.#certificate = credential(options.certificate);
    this.#privateKey = credential(options.privateKey);
    this.#certificateAuthority = credential(options.certificateAuthority);
    this.#expectedMtlsIdentity = identity.data;
    this.#operatorIdentity = options.operatorIdentity;
    this.#timeoutMs = options.timeoutMs;
    this.#maxRequestBytes = options.maxRequestBytes;
    this.#maxResponseBytes = options.maxResponseBytes;
    this.#request = dependencies.request ?? requestHttps;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async submit(commandInput: AdministrationOperatorCommand): Promise<AdministrationOperatorResponse> {
    const command = AdministrationOperatorCommandSchema.safeParse(commandInput);
    if (!command.success) fail("INVALID_COMMAND", "Administration operator command is invalid.");
    const now = this.#now();
    if (!Number.isFinite(now.getTime()) || !isAdministrationOperatorCommandActiveAt(command.data, now.toISOString())) {
      fail("COMMAND_INACTIVE", "Administration operator command is not active.");
    }
    const authenticated = AdministrationOperatorAuthenticatedCommandSchema.safeParse({ command: command.data, verifiedMtlsIdentity: this.#expectedMtlsIdentity });
    if (!authenticated.success) fail("INVALID_COMMAND", "Administration operator command does not match the configured mTLS identity.");
    const body = Buffer.from(canonicalJson(command.data));
    if (body.byteLength > this.#maxRequestBytes) fail("REQUEST_TOO_LARGE", "Administration operator command exceeds its byte limit.");
    const requestDigest = `sha256:${createHash("sha256").update(canonicalJson(administrationOperatorRequestDigestInput(authenticated.data))).digest("hex")}`;
    const response = await this.#send(body);
    const parsed = AdministrationOperatorResponseSchema.safeParse(response);
    if (!parsed.success) fail("RESPONSE_INVALID", "Administration operator response is invalid.");
    const binding = AdministrationOperatorResponseBindingSchema.safeParse({
      expectedRequestDigest: requestDigest,
      expectedOperatorIdentity: this.#operatorIdentity,
      response: parsed.data
    });
    if (!binding.success) fail("RESPONSE_BINDING_INVALID", "Administration operator response binding is invalid.");
    return parsed.data;
  }

  async #send(body: Buffer): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let request: ClientRequest | undefined;
      let response: IncomingMessage | undefined;
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const rejectSafe = (error: AdministrationOperatorClientError) => {
        response?.destroy();
        request?.destroy();
        finish(() => reject(error));
      };
      const timer = setTimeout(() => rejectSafe(new AdministrationOperatorClientError("TIMEOUT", "Administration operator request timed out.")), this.#timeoutMs);
      const receive = (incoming: IncomingMessage) => {
        response = incoming;
        if (incoming.statusCode !== 200) return rejectSafe(new AdministrationOperatorClientError("RESPONSE_STATUS_INVALID", "Administration operator response status is invalid."));
        const contentType = incoming.headers["content-type"];
        if (typeof contentType !== "string" || contentType.split(";", 1)[0]!.trim().toLowerCase() !== "application/json") {
          return rejectSafe(new AdministrationOperatorClientError("RESPONSE_CONTENT_TYPE_INVALID", "Administration operator response content type is invalid."));
        }
        const declared = incoming.headers["content-length"];
        const length = declared === undefined ? undefined : typeof declared === "string" && /^(?:0|[1-9][0-9]*)$/u.test(declared) ? Number(declared) : Number.NaN;
        if (length !== undefined && (!Number.isSafeInteger(length) || length > this.#maxResponseBytes)) {
          return rejectSafe(new AdministrationOperatorClientError("RESPONSE_TOO_LARGE", "Administration operator response exceeds its byte limit."));
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on("data", (chunk: Buffer | Uint8Array | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > this.#maxResponseBytes) return rejectSafe(new AdministrationOperatorClientError("RESPONSE_TOO_LARGE", "Administration operator response exceeds its byte limit."));
          chunks.push(buffer);
        });
        incoming.once("aborted", () => rejectSafe(new AdministrationOperatorClientError("TRANSPORT_FAILED", "Administration operator response was interrupted.")));
        incoming.once("error", () => rejectSafe(new AdministrationOperatorClientError("TRANSPORT_FAILED", "Administration operator response failed.")));
        incoming.once("end", () => {
          if (settled) return;
          let value: unknown;
          try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { return rejectSafe(new AdministrationOperatorClientError("RESPONSE_INVALID", "Administration operator response is invalid.")); }
          finish(() => resolve(value));
        });
      };
      try {
        request = this.#request({
          protocol: "https:",
          hostname: this.#hostname,
          port: this.#port,
          path: administrationOperatorCommandPath,
          method: "POST",
          agent: false,
          rejectUnauthorized: true,
          maxHeaderSize: maximumHeaderBytes,
          cert: this.#certificate,
          key: this.#privateKey,
          ca: this.#certificateAuthority,
          headers: {
            accept: "application/json",
            "accept-encoding": "identity",
            connection: "close",
            "content-type": "application/json",
            "content-length": String(body.byteLength)
          }
        }, receive);
        request.once("error", () => rejectSafe(new AdministrationOperatorClientError("TRANSPORT_FAILED", "Administration operator request failed.")));
        request.end(body);
      } catch {
        rejectSafe(new AdministrationOperatorClientError("TRANSPORT_FAILED", "Administration operator request failed."));
      }
    });
  }
}
