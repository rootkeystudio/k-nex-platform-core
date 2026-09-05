import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  administrationOperatorRequestDigestInput,
  canonicalJson,
  type AdministrationOperatorResponse
} from "@k-nex/contracts";
import {
  AdministrationOperatorClientError,
  NodeHttpsAdministrationOperatorClient,
  type AdministrationOperatorClientDependencies
} from "../src/administration-operator-client.js";

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
const expectedMtlsIdentity = {
  schemaVersion: 1,
  uriSan: "spiffe://knex-deployment/customer-alpha/production/extensions",
  applicationId: "customer-alpha",
  environment: "production",
  allowedCommandFamilies: ["extension-lifecycle"]
} as const;
const credentials = {
  certificate: Buffer.from("client certificate"),
  privateKey: Buffer.from("client private key"),
  certificateAuthority: Buffer.from("operator certificate authority")
};
const requestDigest = `sha256:${createHash("sha256").update(canonicalJson(administrationOperatorRequestDigestInput({ command, verifiedMtlsIdentity: expectedMtlsIdentity }))).digest("hex")}`;
const acceptedResponse = {
  schemaVersion: 1,
  outcome: "accepted",
  requestDigest,
  authoritativeResult: { kind: "operation", operationId: "operator-operation-1" },
  resultDigest: `sha256:${"a".repeat(64)}`,
  operatorIdentity: "operator:production"
} as const satisfies AdministrationOperatorResponse;

interface FakeResponse {
  readonly statusCode?: number;
  readonly contentType?: string;
  readonly declaredLength?: string;
  readonly body: string;
}

function requester(fake: FakeResponse | undefined, capture: { options?: RequestOptions; body?: Buffer; destroyed?: boolean }):
AdministrationOperatorClientDependencies["request"] {
  return (options, callback) => {
    capture.options = options;
    const request = new EventEmitter() as ClientRequest;
    request.destroy = (() => { capture.destroyed = true; return request; }) as ClientRequest["destroy"];
    request.end = ((body?: Uint8Array) => {
      capture.body = body === undefined ? undefined : Buffer.from(body);
      if (fake !== undefined) queueMicrotask(() => {
        const response = new PassThrough() as IncomingMessage;
        response.statusCode = fake.statusCode ?? 200;
        response.headers = {
          "content-type": fake.contentType ?? "application/json; charset=utf-8",
          ...(fake.declaredLength === undefined ? {} : { "content-length": fake.declaredLength })
        };
        callback(response);
        response.end(fake.body);
      });
      return request;
    }) as ClientRequest["end"];
    return request;
  };
}

function client(fake: FakeResponse | undefined, capture: { options?: RequestOptions; body?: Buffer; destroyed?: boolean } = {}, overrides: Record<string, unknown> = {}) {
  return new NodeHttpsAdministrationOperatorClient({
    hostname: "operator.internal",
    port: 8443,
    ...credentials,
    expectedMtlsIdentity,
    operatorIdentity: "operator:production",
    timeoutMs: 100,
    maxRequestBytes: 16_384,
    maxResponseBytes: 16_384,
    ...overrides
  }, { request: requester(fake, capture), now: () => new Date("2026-09-04T12:01:00.000Z") });
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ name: "AdministrationOperatorClientError", code });
}

describe("NodeHttpsAdministrationOperatorClient", () => {
  it("posts only the canonical command to the fixed mTLS endpoint and accepts an exactly bound response", async () => {
    const capture: { options?: RequestOptions; body?: Buffer; destroyed?: boolean } = {};
    await expect(client({ body: JSON.stringify(acceptedResponse) }, capture).submit(command)).resolves.toEqual(acceptedResponse);

    expect(capture.options).toMatchObject({
      protocol: "https:", hostname: "operator.internal", port: 8443, path: "/v1/commands", method: "POST",
      agent: false, rejectUnauthorized: true, cert: credentials.certificate, key: credentials.privateKey, ca: credentials.certificateAuthority,
      headers: { accept: "application/json", "accept-encoding": "identity", connection: "close", "content-type": "application/json" }
    });
    expect(capture.body?.toString("utf8")).toBe(canonicalJson(command));
    expect(capture.body?.toString("utf8")).not.toContain("verifiedMtlsIdentity");
  });

  it("rejects invalid, inactive, cross-tenant, and oversized commands before transport", async () => {
    const request = vi.fn(requester({ body: JSON.stringify(acceptedResponse) }, {}));
    const value = new NodeHttpsAdministrationOperatorClient({
      hostname: "operator.internal", port: 8443, ...credentials, expectedMtlsIdentity, operatorIdentity: "operator:production",
      timeoutMs: 100, maxRequestBytes: 16_384, maxResponseBytes: 16_384
    }, { request, now: () => new Date("2026-09-04T12:05:00.000Z") });
    await expectCode(value.submit(command), "COMMAND_INACTIVE");
    await expectCode(client({ body: JSON.stringify(acceptedResponse) }, {}, { expectedMtlsIdentity: { ...expectedMtlsIdentity, applicationId: "customer-beta" } }).submit(command), "INVALID_COMMAND");
    await expectCode(client({ body: JSON.stringify(acceptedResponse) }, {}, { maxRequestBytes: 1 }).submit(command), "REQUEST_TOO_LARGE");
    await expectCode(client({ body: JSON.stringify(acceptedResponse) }, {}).submit({ ...command, audience: "browser" } as never), "INVALID_COMMAND");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects unbounded timeout and body-limit configuration", () => {
    for (const overrides of [{ timeoutMs: 30_001 }, { maxRequestBytes: 65_537 }, { maxResponseBytes: 65_537 }]) {
      expect(() => client({ body: JSON.stringify(acceptedResponse) }, {}, overrides)).toThrow(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
    }
  });

  it.each([
    [{ statusCode: 302, body: "{}" }, "RESPONSE_STATUS_INVALID"],
    [{ contentType: "text/plain", body: JSON.stringify(acceptedResponse) }, "RESPONSE_CONTENT_TYPE_INVALID"],
    [{ declaredLength: "99999", body: "{}" }, "RESPONSE_TOO_LARGE"],
    [{ body: "not json" }, "RESPONSE_INVALID"],
    [{ body: "{}" }, "RESPONSE_INVALID"]
  ] as const)("fails closed for malformed HTTP/operator responses %#", async (response, code) => {
    await expectCode(client(response, {}).submit(command), code);
  });

  it("rejects forged request and operator bindings without exposing raw bodies or TLS secrets", async () => {
    const raw = "private upstream diagnostic";
    const forgedDigest = { ...acceptedResponse, requestDigest: `sha256:${"b".repeat(64)}` as const };
    const forgedOperator = { ...acceptedResponse, operatorIdentity: "operator:forged" };
    for (const response of [forgedDigest, forgedOperator]) {
      const error = await client({ body: JSON.stringify(response) }, {}).submit(command).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(AdministrationOperatorClientError);
      expect(error).toMatchObject({ code: "RESPONSE_BINDING_INVALID" });
      expect(JSON.stringify(error)).not.toContain(credentials.privateKey.toString("utf8"));
    }
    const invalid = await client({ body: raw }, {}).submit(command).catch((value: unknown) => value);
    expect(invalid).toMatchObject({ code: "RESPONSE_INVALID" });
    expect(String(invalid)).not.toContain(raw);
  });

  it("destroys a timed-out request and returns only a safe typed error", async () => {
    vi.useFakeTimers();
    try {
      const capture: { destroyed?: boolean } = {};
      const pending = client(undefined, capture).submit(command);
      const rejection = expectCode(pending, "TIMEOUT");
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(capture.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
