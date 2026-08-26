import { describe, expect, it } from "vitest";

import { DataSourceGatewayError } from "@k-nex/runtime";
import type { PayloadRequest } from "payload";

import { PayloadRequestAuthenticator } from "../src/data-source-authenticator.js";

const payload = { find: () => undefined };
const rawRequest = {
  user: { id: "user-1", collection: "users" },
  payload,
  locale: "en",
  transactionID: "tx-1",
  headers: { authorization: "secret-token" },
  context: { secret: "private" }
} as unknown as PayloadRequest;

function authenticator() {
  return new PayloadRequestAuthenticator({
    actor(request) {
      expect(request).toBe(rawRequest);
      return {
        principal: { kind: "user", id: "admin-1" },
        effectiveActor: { kind: "user", id: String(request.user?.id) },
        impersonation: { reason: "Support investigation", approvedBy: "admin-1" }
      };
    },
    authorizationContext: () => ({ permissionRevision: "permissions-7" })
  });
}

const gatewayRequest = {
  correlationId: "corr-1",
  rawRequest,
  sourceId: "sales.tasks",
  surface: "workspace" as const,
  input: {},
  selectedFields: ["title"],
  signal: new AbortController().signal
};

describe("Payload data-source authentication adapter", () => {
  it("adapts authenticated req.user and preserves impersonation for policy", () => {
    const result = authenticator().authenticate(gatewayRequest);
    expect(result.actor).toMatchObject({
      principal: { kind: "user", id: "admin-1" },
      effectiveActor: { kind: "user", id: "user-1" },
      impersonation: { approvedBy: "admin-1" }
    });
    expect(result.authorizationContext).toEqual({ permissionRevision: "permissions-7" });
  });

  it("passes only the capability-scoped Payload request context to handlers", () => {
    const result = authenticator().authenticate(gatewayRequest);
    expect(result.request).toEqual({ payload, locale: "en", transactionID: "tx-1" });
    expect(result.request).not.toHaveProperty("headers");
    expect(result.request).not.toHaveProperty("user");
    expect(result.request).not.toHaveProperty("context");
  });

  it("maps an unauthenticated Payload request to an explicit public actor", () => {
    const result = authenticator().authenticate({ ...gatewayRequest, rawRequest: { ...rawRequest, user: null } });
    expect(result.actor).toEqual({
      principal: { kind: "public", id: "anonymous" },
      effectiveActor: { kind: "public", id: "anonymous" }
    });
  });

  it("fails closed for malformed requests or invalid mapped actors", () => {
    expect(() => authenticator().authenticate({ ...gatewayRequest, rawRequest: {} })).toThrowError(DataSourceGatewayError);
    const invalid = new PayloadRequestAuthenticator({
      actor: () => ({ principal: { kind: "user", id: "one" }, effectiveActor: { kind: "user", id: "two" } }),
      authorizationContext: () => ({})
    });
    expect(() => invalid.authenticate(gatewayRequest)).toThrowError(DataSourceGatewayError);
  });
});
