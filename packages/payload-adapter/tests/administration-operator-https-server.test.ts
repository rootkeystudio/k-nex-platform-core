import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Server, ServerOptions } from "node:https";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  administrationOperatorRequestDigestInput,
  canonicalJson,
  type AdministrationOperatorAuthenticatedCommand,
  type AdministrationOperatorResponse
} from "@k-nex/contracts";
import {
  NodeHttpsAdministrationOperatorServer,
  type AdministrationOperatorHttpsServerDependencies
} from "../src/administration-operator-https-server.js";

const identity = {
  schemaVersion: 1,
  uriSan: "spiffe://knex-deployment/customer-alpha/production/extensions",
  applicationId: "customer-alpha",
  environment: "production",
  allowedCommandFamilies: ["extension-lifecycle"]
} as const;
const command = {
  schemaVersion: 1,
  kind: "extension-plan",
  audience: "k-nex-administration-operator",
  actor: {
    schemaVersion: 1,
    applicationId: "customer-alpha",
    environment: "production",
    principal: { kind: "user", id: "user:owner" },
    effectiveActor: { kind: "user", id: "user:owner" },
    authorizationRevision: 7,
    lifecycleRevision: 11,
    permissions: [{ decisionId: "decision-1", permissionId: "system.extensions.plan", owner: { kind: "platform", namespace: "system" }, scope: { kind: "application", resource: "system.extensions" } }]
  },
  expected: { authorizationRevision: 7, lifecycleRevision: 11, inventoryRevision: 13, extensionRevision: 17 },
  idempotencyKey: "operator-command-1",
  issuedAt: "2026-09-04T12:00:00.000Z",
  expiresAt: "2026-09-04T12:05:00.000Z",
  extension: { deliveryClass: "platform-plugin", id: "module.sales" },
  version: "1.0.0",
  operation: "update"
} as const;
const operatorResponse = {
  schemaVersion: 1,
  outcome: "accepted",
  requestDigest: `sha256:${"a".repeat(64)}`,
  authoritativeResult: { kind: "operation", operationId: "operator-operation-1" },
  resultDigest: `sha256:${"b".repeat(64)}`,
  operatorIdentity: "operator:production"
} as const satisfies AdministrationOperatorResponse;

function responseFor(authenticated: AdministrationOperatorAuthenticatedCommand): AdministrationOperatorResponse {
  return {
    ...operatorResponse,
    requestDigest: `sha256:${createHash("sha256").update(canonicalJson(administrationOperatorRequestDigestInput(authenticated))).digest("hex")}`
  };
}

// Public test certificate whose only URI SAN is the expected deployment identity.
const certificate = Buffer.from("MIIDYTCCAkmgAwIBAgIUeqzp7ZE2FZRmNko8ODwgrCA06RUwDQYJKoZIhvcNAQELBQAwGjEYMBYGA1UEAwwPb3BlcmF0b3ItY2xpZW50MB4XDTI2MDkwNDIyMzU0N1oXDTI2MDkwNTIyMzU0N1owGjEYMBYGA1UEAwwPb3BlcmF0b3ItY2xpZW50MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmBQlNh7agLi88alLm/BY50UujmbwjsKdnSM3SR0SqphRE/GnIlGiwPDCaVUJVlbr93j4LBeLPCb+tblFGKGJc82XCc5Lg9GZ4gawNC3o6id9nCFcZnVrawPsvOqOM5qf/6Id5/HJfpSk43EHEMiSZBOUDHsbvkD8azKfo6JWlvCVtQpNaE3iGt+HnznjannoETOeeWrNnKOYEw/8qBtHLSzOSkxAYvgZmSewMCstqdhlxbs+FnYiY//eC5wUB91q5ppeDHtPd7YYxzqXiwJUoGfiIrUtxeg13IXnL43Cv+qiDWHytjx8g/XDro1LNKFY5DBCv7UCC3iGCg/AnidO9QIDAQABo4GeMIGbMB0GA1UdDgQWBBSZtGlQcp8ekdwlWl8WCbV2OUJaqjAfBgNVHSMEGDAWgBSZtGlQcp8ekdwlWl8WCbV2OUJaqjAPBgNVHRMBAf8EBTADAQH/MEgGA1UdEQRBMD+GPXNwaWZmZTovL2tuZXgtZGVwbG95bWVudC9jdXN0b21lci1hbHBoYS9wcm9kdWN0aW9uL2V4dGVuc2lvbnMwDQYJKoZIhvcNAQELBQADggEBAJZZimlmt9E/YLKspHsyQZiRc432Al5WSGHrgv9rXX64coITKi55ETUKArFjzZ9m1uFH7OKZL+vNwAixY1OjUk3ivCJurWWx+AgsOQt1KPM9fXnhUpK/7lqi8MoIZ8lavLMr0uPmsNlyr1+Bm5y1KfO4vD0PSrDXB/lo78u81EYchFUODEbFRn02cOMEJEgXDzdGN6/ib37dtjTevl3tPL+o3oaiElwrqhaF96Gxj3bexFl3D6AnXfcPbJXqho3R7xClarsZ8UG15gFZpN/giX07nx4wGYwOP7i169y1tCLu9r/di8nFApaOtv778UjZTrv0iOpIxBmS3+vylnWjShM=", "base64");
const wrongUriCertificate = Buffer.from("MIIDYTCCAkmgAwIBAgIUMSiG9fdzmEpcZ9ZthmFEHoI4z8QwDQYJKoZIhvcNAQELBQAwGjEYMBYGA1UEAwwPb3BlcmF0b3ItY2xpZW50MB4XDTI2MDkwNDIyMzg0M1oXDTI2MDkwNTIyMzg0M1owGjEYMBYGA1UEAwwPb3BlcmF0b3ItY2xpZW50MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2F8dYLEvGz0R68cZJxwIU4ng949+z1vvkal9kc9xo5GabgvOX8iXXOvJ5NYwGuCo2IUakhimlF0k3ZlNtUyCj6VP3uXx50ucDH3bYL2i299aDjsjBvBVpsTZ3EWSvOn0AmwOjC5/BZ3XOPrsHU+vJOz1+lo5JPS+FwklEumOYFGf899Ax+9XLdZ3+Pb39tBIBVinDGu2kCA7GmHxhPM9YVzsVWoEHz9ojIawPuRn5ScTLWiL7C7zs6j5iIpQw/5YDyi/jK4Za4LxF68054kuVCKpCDIepjUFeZ9Xkz4f+NRG6Ftp/sSuUq9Em+KHhVkp8NewSCuyFyRks+e9QnXy0wIDAQABo4GeMIGbMB0GA1UdDgQWBBSIZxwHHE4KWiM+MAPKgyWSbTk8PjAfBgNVHSMEGDAWgBSIZxwHHE4KWiM+MAPKgyWSbTk8PjAPBgNVHRMBAf8EBTADAQH/MEgGA1UdEQRBMD+GPXNwaWZmZTovL2tuZXgtZGVwbG95bWVudC9jdXN0b21lci1hbHBoYS9wcm9kdWN0aW9uL2NhdGFsb2d1ZXMwDQYJKoZIhvcNAQELBQADggEBAKEDAkLFbz80DWMYJ1mtuqN3L6TylD8MjROOrmfNlF2Ou2YVvVEeKBmBK48GhMrZPGJdwKNAxElCj10fk70B83roicFSsR5vWJ66Y0hvtH3TZb91+tcE8h2u20gs2KvcWEr92FNtNWtxp8tAeJxQMcz/+A7fqhQNzDwKJvCGYmJj6zoRUX5oeN70R/+pYnfQ9W4SJ1IDTVmMA7icLFAFt5BIiTw6qhvP5I6Oxb1PdXUvFMsgYOWYo2uJTBwImMVwpnYOwFtkV2tHl8piTmzaHuENGsKa9Mde2MW+kVGH9cWcgx3pRoTtUfZsM4GPPfj9p3JoOu/YK+qteS+PJ5k4FPQ=", "base64");

class CapturedResponse {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  body = Buffer.alloc(0);

  setHeader(name: string, value: number | string | readonly string[]): this {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
    return this;
  }

  end(chunk?: Uint8Array | string): this {
    this.body = chunk === undefined ? Buffer.alloc(0) : Buffer.from(chunk);
    return this;
  }
}

function request(body: string, overrides: { method?: string; url?: string; contentType?: string; contentLength?: string; certificate?: Uint8Array } = {}): IncomingMessage {
  const value = new PassThrough() as IncomingMessage;
  Object.assign(value, {
    method: overrides.method ?? "POST",
    url: overrides.url ?? "/v1/commands",
    headers: {
      "content-type": overrides.contentType ?? "application/json",
      "content-length": overrides.contentLength ?? String(Buffer.byteLength(body))
    }
  });
  queueMicrotask(() => value.end(body));
  return value;
}

function fakeServer(): Server {
  const value = new EventEmitter() as Server;
  Object.defineProperty(value, "listening", { configurable: true, value: false, writable: true });
  value.listen = ((_: number, __: string | undefined, callback: () => void) => {
    Object.defineProperty(value, "listening", { value: true });
    callback();
    return value;
  }) as Server["listen"];
  value.close = ((callback: (error?: Error) => void) => {
    Object.defineProperty(value, "listening", { value: false });
    callback();
    return value;
  }) as Server["close"];
  return value;
}

function server(capture: { options?: ServerOptions; commands: unknown[] }, overrides: Record<string, unknown> = {}, dependencies: Partial<AdministrationOperatorHttpsServerDependencies> = {}) {
  return new NodeHttpsAdministrationOperatorServer({
    certificate: Buffer.from("operator certificate"),
    privateKey: Buffer.from("operator private key"),
    certificateAuthority: Buffer.from("client certificate authority"),
    verifiedMtlsIdentity: identity,
    operatorIdentity: "operator:production",
    maxBodyBytes: 16_384,
    clock: () => new Date("2026-09-04T12:01:00.000Z"),
    handler: async (authenticated) => {
      capture.commands.push(authenticated);
      return responseFor(authenticated);
    },
    ...overrides
  }, {
    createServer: (options) => {
      capture.options = options;
      return fakeServer();
    },
    peerCertificate: () => certificate,
    ...dependencies
  });
}

async function dispatch(value: NodeHttpsAdministrationOperatorServer, body: string, overrides?: Parameters<typeof request>[1]) {
  const result = new CapturedResponse();
  await value.handle(request(body, overrides), result as unknown as ServerResponse);
  return result;
}

describe("NodeHttpsAdministrationOperatorServer", () => {
  it("requires TLS 1.3 mTLS, verifies its exact URI SAN, and passes only an authenticated command to the handler", async () => {
    const capture: { options?: ServerOptions; commands: unknown[] } = { commands: [] };
    const result = await dispatch(server(capture), canonicalJson(command));

    expect(capture.options).toMatchObject({
      minVersion: "TLSv1.3", requestCert: true, rejectUnauthorized: true,
      cert: Buffer.from("operator certificate"), key: Buffer.from("operator private key"), ca: Buffer.from("client certificate authority")
    });
    expect(capture.commands).toEqual([{ command, verifiedMtlsIdentity: identity }]);
    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual(new Map([["cache-control", "no-store"], ["content-type", "application/json; charset=utf-8"], ["content-length", String(result.body.byteLength)]]));
    expect(result.body.toString("utf8")).toBe(canonicalJson(responseFor({ command, verifiedMtlsIdentity: identity })));
  });

  it("rejects non-endpoint methods, malformed bodies, expired commands, wrong audience, cross-tenant commands, and denied families without invoking the handler", async () => {
    const cases: Array<[string, string, Parameters<typeof request>[1] | undefined, number]> = [
      ["route", canonicalJson(command), { method: "GET" }, 404],
      ["malformed", "{", undefined, 400],
      ["expired", canonicalJson({ ...command, expiresAt: "2026-09-04T12:01:00.000Z" }), undefined, 400],
      ["audience", canonicalJson({ ...command, audience: "browser" }), undefined, 400],
      ["tenant", canonicalJson({ ...command, actor: { ...command.actor, applicationId: "customer-beta" } }), undefined, 403],
      ["oversized", canonicalJson(command), { contentLength: "999999" }, 400]
    ];
    for (const [_, body, overrides, expectedStatus] of cases) {
      const capture: { options?: ServerOptions; commands: unknown[] } = { commands: [] };
      const result = await dispatch(server(capture), body, overrides);
      expect(result.statusCode).toBe(expectedStatus);
      expect(result.body.toString("utf8")).toBe(canonicalJson({ error: expectedStatus === 404 ? "not-found" : "request-rejected" }));
      expect(capture.commands).toEqual([]);
    }

    const catalogCommand = {
      schemaVersion: 1,
      kind: "catalog-refresh",
      audience: "k-nex-administration-operator",
      actor: command.actor,
      expected: { authorizationRevision: 7, lifecycleRevision: 11, catalogRevision: 5, inventoryRevision: 13 },
      idempotencyKey: "operator-command-2",
      issuedAt: command.issuedAt,
      expiresAt: command.expiresAt
    };
    const capture: { options?: ServerOptions; commands: unknown[] } = { commands: [] };
    const result = await dispatch(server(capture), canonicalJson(catalogCommand));
    expect(result.statusCode).toBe(403);
    expect(capture.commands).toEqual([]);
  });

  it("fails closed for absent or wrong URI SAN certificates and never exposes handler failures", async () => {
    const capture: { options?: ServerOptions; commands: unknown[] } = { commands: [] };
    const wrongSan = await dispatch(server(capture, {}, { peerCertificate: () => wrongUriCertificate }), canonicalJson(command));
    expect(wrongSan.statusCode).toBe(401);
    expect(wrongSan.body.toString("utf8")).toBe(canonicalJson({ error: "unauthorized" }));
    expect(capture.commands).toEqual([]);

    for (const handler of [
      () => operatorResponse,
      (authenticated: AdministrationOperatorAuthenticatedCommand) => ({ ...responseFor(authenticated), operatorIdentity: "operator:forged" })
    ]) {
      const forged = await dispatch(server(capture, { handler }), canonicalJson(command));
      expect(forged.statusCode).toBe(503);
      expect(forged.body.toString("utf8")).toBe(canonicalJson({ error: "operator-unavailable" }));
    }

    const unavailable = await dispatch(server(capture, { handler: () => { throw new Error("private operator detail"); } }), canonicalJson(command));
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body.toString("utf8")).toBe(canonicalJson({ error: "operator-unavailable" }));
    expect(unavailable.body.toString("utf8")).not.toContain("private operator detail");
  });

  it("owns idempotent listener lifecycle without binding a real port", async () => {
    const capture: { options?: ServerOptions; commands: unknown[] } = { commands: [] };
    const value = server(capture);
    await expect(value.start(0, "127.0.0.1")).resolves.toBeUndefined();
    await expect(value.close()).resolves.toBeUndefined();
    await expect(value.close()).resolves.toBeUndefined();
  });
});
