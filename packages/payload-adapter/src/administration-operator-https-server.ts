import { createHash, X509Certificate } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server, type ServerOptions } from "node:https";

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
  type AdministrationOperatorAuthenticatedCommand,
  type AdministrationOperatorMtlsIdentity,
  type AdministrationOperatorResponse
} from "@k-nex/contracts";

const maximumCredentialBytes = 1024 * 1024;
const maximumBodyBytes = 65_536;
const maximumHeaderBytes = 16 * 1024;
const operatorIdentityPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u;

export type AdministrationOperatorHttpsServerErrorCode = "INVALID_CONFIGURATION" | "INVALID_LISTEN";

export class AdministrationOperatorHttpsServerError extends Error {
  constructor(readonly code: AdministrationOperatorHttpsServerErrorCode, message: string) {
    super(message);
    this.name = "AdministrationOperatorHttpsServerError";
  }
}

export interface AdministrationOperatorHttpsServerOptions {
  readonly certificate: Uint8Array;
  readonly privateKey: Uint8Array;
  readonly certificateAuthority: Uint8Array;
  /** The one URI SAN and closed authority projection expected from the client certificate. */
  readonly verifiedMtlsIdentity: AdministrationOperatorMtlsIdentity;
  readonly operatorIdentity: string;
  readonly maxBodyBytes: number;
  readonly clock: () => Date;
  readonly handler: (command: AdministrationOperatorAuthenticatedCommand) => AdministrationOperatorResponse | Promise<AdministrationOperatorResponse>;
}

/** Test seams only; production uses Node's HTTPS server and verified peer certificate. */
export interface AdministrationOperatorHttpsServerDependencies {
  readonly createServer?: (options: ServerOptions, listener: (request: IncomingMessage, response: ServerResponse) => void) => Server;
  readonly peerCertificate?: (request: IncomingMessage) => Uint8Array | undefined;
}

function fail(code: AdministrationOperatorHttpsServerErrorCode, message: string): never {
  throw new AdministrationOperatorHttpsServerError(code, message);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function credential(value: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > maximumCredentialBytes) {
    fail("INVALID_CONFIGURATION", "Administration operator HTTPS configuration is invalid.");
  }
  return Buffer.from(value);
}

function contentTypeIsJson(value: string | readonly string[] | undefined): boolean {
  return typeof value === "string" && value.split(";", 1)[0]!.trim().toLowerCase() === "application/json";
}

function declaredBodyLength(value: string | readonly string[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return Number.NaN;
  return Number(value);
}

function defaultPeerCertificate(request: IncomingMessage): Uint8Array | undefined {
  const socket = request.socket as unknown as {
    readonly authorized?: unknown;
    getPeerCertificate?: (detailed?: boolean) => { readonly raw?: unknown };
  };
  if (socket.authorized !== true) return undefined;
  const raw = socket.getPeerCertificate?.(true).raw;
  return raw instanceof Uint8Array ? raw : undefined;
}

function hasExactUriSan(certificate: Uint8Array, expectedUriSan: string): boolean {
  try {
    const subjectAltName = new X509Certificate(certificate).subjectAltName;
    if (subjectAltName === undefined) return false;
    const uriSans = subjectAltName.split(",").map((entry) => entry.trim()).filter((entry) => entry.startsWith("URI:")).map((entry) => entry.slice("URI:".length));
    return uriSans.length === 1 && uriSans[0] === expectedUriSan;
  } catch {
    return false;
  }
}

function response(response: ServerResponse, statusCode: number, value: object): void {
  const body = Buffer.from(canonicalJson(value));
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", String(body.byteLength));
  response.end(body);
}

function genericError(responseTarget: ServerResponse, statusCode: number, error: "not-found" | "unauthorized" | "request-rejected" | "operator-unavailable"): void {
  response(responseTarget, statusCode, { error });
}

async function readBoundedBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (value: Buffer | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    request.on("data", (chunk: Buffer | Uint8Array | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maximumBytes) {
        request.resume();
        finish(undefined);
        return;
      }
      chunks.push(buffer);
    });
    request.once("aborted", () => finish(undefined));
    request.once("error", () => finish(undefined));
    request.once("end", () => finish(Buffer.concat(chunks)));
  });
}

/**
 * Deployment-side private HTTPS+mTLS endpoint. It verifies transport identity
 * and the closed command contract, then delegates all lifecycle authority to
 * the injected operator handler.
 */
export class NodeHttpsAdministrationOperatorServer {
  readonly #identity: AdministrationOperatorMtlsIdentity;
  readonly #operatorIdentity: string;
  readonly #maxBodyBytes: number;
  readonly #clock: () => Date;
  readonly #handler: AdministrationOperatorHttpsServerOptions["handler"];
  readonly #peerCertificate: (request: IncomingMessage) => Uint8Array | undefined;
  readonly #server: Server;

  constructor(options: AdministrationOperatorHttpsServerOptions, dependencies: AdministrationOperatorHttpsServerDependencies = {}) {
    if (typeof options !== "object" || options === null || typeof options.operatorIdentity !== "string" || !operatorIdentityPattern.test(options.operatorIdentity) || !positiveSafeInteger(options.maxBodyBytes) || options.maxBodyBytes > maximumBodyBytes ||
      typeof options.clock !== "function" || typeof options.handler !== "function") {
      fail("INVALID_CONFIGURATION", "Administration operator HTTPS configuration is invalid.");
    }
    const identity = AdministrationOperatorMtlsIdentitySchema.safeParse(options.verifiedMtlsIdentity);
    if (!identity.success) fail("INVALID_CONFIGURATION", "Administration operator mTLS identity is invalid.");

    this.#identity = identity.data;
    this.#operatorIdentity = options.operatorIdentity;
    this.#maxBodyBytes = options.maxBodyBytes;
    this.#clock = options.clock;
    this.#handler = options.handler;
    this.#peerCertificate = dependencies.peerCertificate ?? defaultPeerCertificate;
    this.#server = (dependencies.createServer ?? createServer)({
      minVersion: "TLSv1.3",
      requestCert: true,
      rejectUnauthorized: true,
      cert: credential(options.certificate),
      key: credential(options.privateKey),
      ca: credential(options.certificateAuthority),
      maxHeaderSize: maximumHeaderBytes
    }, (request, result) => { void this.handle(request, result); });
  }

  async handle(request: IncomingMessage, result: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== administrationOperatorCommandPath) {
      genericError(result, 404, "not-found");
      return;
    }
    if (!hasExactUriSan(this.#peerCertificate(request) ?? new Uint8Array(), this.#identity.uriSan)) {
      genericError(result, 401, "unauthorized");
      return;
    }
    if (!contentTypeIsJson(request.headers["content-type"])) {
      genericError(result, 400, "request-rejected");
      return;
    }
    const declared = declaredBodyLength(request.headers["content-length"]);
    if (declared !== undefined && (!Number.isSafeInteger(declared) || declared > this.#maxBodyBytes)) {
      genericError(result, 400, "request-rejected");
      return;
    }
    const body = await readBoundedBody(request, this.#maxBodyBytes);
    if (body === undefined) {
      genericError(result, 400, "request-rejected");
      return;
    }

    let input: unknown;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
    catch {
      genericError(result, 400, "request-rejected");
      return;
    }
    const command = AdministrationOperatorCommandSchema.safeParse(input);
    const now = this.#clock();
    if (!command.success || !(now instanceof Date) || !Number.isFinite(now.getTime()) || !isAdministrationOperatorCommandActiveAt(command.data, now.toISOString())) {
      genericError(result, 400, "request-rejected");
      return;
    }
    const authenticated = AdministrationOperatorAuthenticatedCommandSchema.safeParse({ command: command.data, verifiedMtlsIdentity: this.#identity });
    if (!authenticated.success) {
      genericError(result, 403, "request-rejected");
      return;
    }

    try {
      const operatorResponse = AdministrationOperatorResponseSchema.safeParse(await this.#handler(authenticated.data));
      const requestDigest = `sha256:${createHash("sha256").update(canonicalJson(administrationOperatorRequestDigestInput(authenticated.data))).digest("hex")}`;
      const binding = operatorResponse.success
        ? AdministrationOperatorResponseBindingSchema.safeParse({ expectedRequestDigest: requestDigest, expectedOperatorIdentity: this.#operatorIdentity, response: operatorResponse.data })
        : undefined;
      if (!operatorResponse.success || binding === undefined || !binding.success) {
        genericError(result, 503, "operator-unavailable");
        return;
      }
      response(result, 200, operatorResponse.data);
    } catch {
      genericError(result, 503, "operator-unavailable");
    }
  }

  async start(port: number, host?: string): Promise<void> {
    if (!Number.isSafeInteger(port) || port < 0 || port > 65_535 || (host !== undefined && (typeof host !== "string" || host.length === 0)) || this.#server.listening) {
      fail("INVALID_LISTEN", "Administration operator HTTPS listener configuration is invalid.");
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { this.#server.off("error", onError); reject(error); };
      this.#server.once("error", onError);
      this.#server.listen(port, host, () => {
        this.#server.off("error", onError);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.#server.listening) return;
    await new Promise<void>((resolve, reject) => this.#server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}
