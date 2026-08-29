import type { ExtensionCapabilityClaims, ExtensionCapabilityHandler } from "./extension-capability-gateway.js";

export interface ExtensionSecretReferenceResolver {
  resolve(reference: string, context: ExtensionCapabilityClaims): Promise<Readonly<{ header: string; value: string }>>;
}

export interface ExtensionNetworkPolicyAdapter {
  request(input: Readonly<{
    destination: string;
    path: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers: Readonly<Record<string, string>>;
    body?: unknown;
    signal: AbortSignal;
  }>, context: ExtensionCapabilityClaims): Promise<unknown>;
}

export interface ExtensionNetworkPolicy {
  readonly destinations: readonly string[];
  readonly methods: readonly ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[];
  readonly secretReferences: readonly string[];
}

export class ExtensionNetworkError extends Error {
  constructor(readonly code: "REQUEST_INVALID" | "DESTINATION_DENIED" | "METHOD_DENIED" | "SECRET_REFERENCE_DENIED" | "SECRET_OUTPUT_REJECTED", message: string) {
    super(message);
    this.name = "ExtensionNetworkError";
  }
}

interface NetworkInput {
  readonly destination: string;
  readonly path: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly secretReference?: string;
}

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const referencePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function input(value: unknown): NetworkInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ExtensionNetworkError("REQUEST_INVALID", "Network capability input is invalid.");
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data).sort().join("\0");
  if (!["destination\0headers\0method\0path", "body\0destination\0headers\0method\0path", "destination\0headers\0method\0path\0secretReference", "body\0destination\0headers\0method\0path\0secretReference"].includes(keys) ||
    typeof data.destination !== "string" || typeof data.path !== "string" || !/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?-]{0,1023}$/u.test(data.path) ||
    typeof data.method !== "string" || !methods.has(data.method) || typeof data.headers !== "object" || data.headers === null || Array.isArray(data.headers) ||
    (data.secretReference !== undefined && (typeof data.secretReference !== "string" || !referencePattern.test(data.secretReference)))) {
    throw new ExtensionNetworkError("REQUEST_INVALID", "Network capability input is invalid.");
  }
  const headers = data.headers as Record<string, unknown>;
  const normalizedHeaders: Record<string, string> = {};
  if (Object.keys(headers).length > 16) throw new ExtensionNetworkError("REQUEST_INVALID", "Network capability headers exceed their limit.");
  for (const [name, headerValue] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (!/^(?:accept|content-type|if-match|if-none-match|x-[a-z0-9-]{1,64})$/u.test(normalized) || typeof headerValue !== "string" || headerValue.length > 1024 || /[\r\n]/u.test(headerValue)) {
      throw new ExtensionNetworkError("REQUEST_INVALID", "Network capability header is invalid.");
    }
    normalizedHeaders[normalized] = headerValue;
  }
  return { destination: data.destination, path: data.path, method: data.method as NetworkInput["method"], headers: normalizedHeaders, ...(data.body !== undefined ? { body: data.body } : {}), ...(typeof data.secretReference === "string" ? { secretReference: data.secretReference } : {}) };
}

function containsSecret(value: unknown, secret: string): boolean {
  if (secret === "") return false;
  try { return JSON.stringify(value).includes(secret); } catch { return true; }
}

export class BoundedExtensionNetworkCapability implements ExtensionCapabilityHandler {
  private readonly destinations: ReadonlySet<string>;
  private readonly methods: ReadonlySet<string>;
  private readonly secretReferences: ReadonlySet<string>;

  constructor(policy: ExtensionNetworkPolicy, private readonly secrets: ExtensionSecretReferenceResolver, private readonly adapter: ExtensionNetworkPolicyAdapter) {
    this.destinations = new Set(policy.destinations.map((destination) => {
      const url = new URL(destination);
      if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new TypeError("Network policy destination must be an HTTPS origin.");
      return url.origin;
    }));
    this.methods = new Set(policy.methods);
    this.secretReferences = new Set(policy.secretReferences);
    if (this.destinations.size !== policy.destinations.length || this.methods.size !== policy.methods.length || this.secretReferences.size !== policy.secretReferences.length) throw new TypeError("Network policy entries must be unique.");
  }

  validateInput(value: unknown): NetworkInput { return input(value); }

  async invoke(context: ExtensionCapabilityClaims, request: unknown, signal: AbortSignal): Promise<unknown> {
    const value = request as NetworkInput;
    let origin: string;
    try { origin = new URL(value.path, value.destination).origin; } catch { throw new ExtensionNetworkError("REQUEST_INVALID", "Network capability URL is invalid."); }
    if (origin !== value.destination || !this.destinations.has(origin)) throw new ExtensionNetworkError("DESTINATION_DENIED", "Network destination is not allowlisted.");
    if (!this.methods.has(value.method)) throw new ExtensionNetworkError("METHOD_DENIED", "Network method is not allowlisted.");
    const grants = context.grants.filter((grant) => grant.kind === "http-fetch");
    if (!grants.some((grant) => grant.destinations.includes(origin))) throw new ExtensionNetworkError("DESTINATION_DENIED", "Network destination was not granted to this invocation.");
    if (!grants.some((grant) => grant.destinations.includes(origin) && grant.methods.includes(value.method))) throw new ExtensionNetworkError("METHOD_DENIED", "Network method was not granted to this invocation.");
    const headers: Record<string, string> = { ...value.headers };
    let secret = "";
    if (value.secretReference !== undefined) {
      if (!this.secretReferences.has(value.secretReference)) throw new ExtensionNetworkError("SECRET_REFERENCE_DENIED", "Secret reference is not allowlisted.");
      if (!context.grants.some((grant) => grant.kind === "secret-reference" && grant.references.includes(value.secretReference!))) {
        throw new ExtensionNetworkError("SECRET_REFERENCE_DENIED", "Secret reference was not granted to this invocation.");
      }
      const resolved = await this.secrets.resolve(value.secretReference, context);
      const header = resolved.header.toLowerCase();
      if (!/^(?:authorization|x-[a-z0-9-]{1,64})$/u.test(header) || resolved.value === "" || /[\r\n]/u.test(resolved.value)) throw new ExtensionNetworkError("SECRET_REFERENCE_DENIED", "Resolved secret binding is invalid.");
      headers[header] = resolved.value;
      secret = resolved.value;
    }
    const response = await this.adapter.request({ destination: origin, path: value.path, method: value.method, headers, ...(value.body !== undefined ? { body: value.body } : {}), signal }, context);
    if (containsSecret(response, secret)) throw new ExtensionNetworkError("SECRET_OUTPUT_REJECTED", "Network response contained protected secret material.");
    return response;
  }

  validateOutput(value: unknown): unknown { return value; }
}
