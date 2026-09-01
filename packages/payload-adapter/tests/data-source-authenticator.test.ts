import { describe, expect, it, vi } from "vitest";

import { DataSourceGatewayError } from "@k-nex/runtime";
import type { PayloadRequest } from "payload";

import { PayloadRequestAuthenticator } from "../src/data-source-authenticator.js";
import { createPayloadPersistenceCapability } from "../src/persistence-capability.js";

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
    authorizationContext: () => ({ permissionRevision: "permissions-7" }),
    requestContext: (request) => createPayloadPersistenceCapability(request, [{ collection: "sales-tasks", operations: ["find"] }], { authorize: () => true })
  });
}

const gatewayRequest = {
  correlationId: "corr-1",
  rawRequest,
  sourceId: "sales.tasks",
  surface: "workspace" as const,
  input: {},
  query: { page: { number: 1, size: 25 }, filters: [], sort: [] },
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
    expect(result.request).toMatchObject({ locale: "en", transactionID: "tx-1" });
    expect((result.request as { payload: unknown }).payload).not.toBe(payload);
    expect(result.request).not.toHaveProperty("headers");
    expect(result.request).not.toHaveProperty("user");
    expect(result.request).not.toHaveProperty("context");
    expect(result.request).not.toHaveProperty("payload.config");
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
      authorizationContext: () => ({}),
      requestContext: () => ({})
    });
    expect(() => invalid.authenticate(gatewayRequest)).toThrowError(DataSourceGatewayError);
  });

  it("denies operations outside the platform-issued collection grant", async () => {
    const context = createPayloadPersistenceCapability(rawRequest, [{ collection: "sales-tasks", operations: ["find"] }], { authorize: () => true });
    await expect(context.payload.find({ collection: "users", overrideAccess: true })).rejects.toThrow(/denied/i);
    await expect(context.payload.update({ collection: "sales-tasks", overrideAccess: true })).rejects.toThrow(/denied/i);
  });

  it("reauthorizes before every Payload operation and never dispatches after denial", async () => {
    const find = vi.fn();
    const request = { ...rawRequest, payload: { find, create: vi.fn(), update: vi.fn() } } as unknown as PayloadRequest;
    const context = createPayloadPersistenceCapability(request, [{ collection: "sales-tasks", operations: ["find"] }], { authorize: () => false });

    await expect(context.payload.find({ collection: "sales-tasks", overrideAccess: true })).rejects.toThrow(/authority denied/i);
    expect(find).not.toHaveBeenCalled();
  });

  it("owns only the transaction it starts and exposes its host guard", async () => {
    const beginTransaction = vi.fn(async () => "tx-owned");
    const commitTransaction = vi.fn(async () => undefined);
    const rollbackTransaction = vi.fn(async () => undefined);
    const request = {
      ...rawRequest,
      transactionID: undefined,
      payload: { find: vi.fn(), create: vi.fn(), update: vi.fn(), db: { beginTransaction, commitTransaction, rollbackTransaction } }
    } as unknown as PayloadRequest;
    const context = createPayloadPersistenceCapability(request, [{ collection: "sales-tasks", operations: ["find"] }], { authorize: () => true }, {
      guard: async (input) => input.id === "task-1"
    });

    await context.transaction.begin();
    expect(context.transactionID).toBe("tx-owned");
    expect(await context.guard({ id: "task-1" })).toBe(true);
    await context.transaction.commit();
    await context.transaction.rollback();
    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commitTransaction).toHaveBeenCalledExactlyOnceWith("tx-owned");
    expect(rollbackTransaction).not.toHaveBeenCalled();

    const inherited = createPayloadPersistenceCapability({
      ...request,
      transactionID: "tx-inherited"
    } as PayloadRequest, [{ collection: "sales-tasks", operations: ["find"] }], { authorize: () => true });
    await inherited.transaction.begin();
    await inherited.transaction.rollback();
    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(rollbackTransaction).not.toHaveBeenCalled();
  });

  it("rolls back and clears an owned request transaction when commit fails", async () => {
    const beginTransaction = vi.fn(async () => "tx-failed");
    const commitTransaction = vi.fn(async () => { throw new Error("commit failed"); });
    const rollbackTransaction = vi.fn(async () => undefined);
    const request = {
      ...rawRequest,
      transactionID: undefined,
      payload: { find: vi.fn(), create: vi.fn(), update: vi.fn(), db: { beginTransaction, commitTransaction, rollbackTransaction } }
    } as unknown as PayloadRequest;
    const context = createPayloadPersistenceCapability(request, [{ collection: "sales-tasks", operations: ["find"] }], { authorize: () => true });

    await context.transaction.begin();
    await expect(context.transaction.commit()).rejects.toThrow("commit failed");
    expect(rollbackTransaction).toHaveBeenCalledExactlyOnceWith("tx-failed");
    expect(request.transactionID).toBeUndefined();
  });
});
