import { describe, expect, it, vi } from "vitest";

import { BoundedExtensionNetworkCapability } from "../src/extension-network-capability.js";

const context = {
  schemaVersion: 1 as const, tokenId: "network-token-1", applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant",
  generationId: "sales-assistant-generation-1", invocationId: "network-invocation-1", actor: { principalId: "user:one", effectiveActorId: "user:one" },
  correlationId: "network-correlation-1", capabilities: ["http-fetch.request" as const], issuedAt: "2026-08-29T10:00:00.000Z", expiresAt: "2026-08-29T10:01:00.000Z"
};

describe("bounded extension network capability", () => {
  it("keeps secret values inside the host adapter and binds requests to exact allowlists", async () => {
    const request = vi.fn(async (input) => ({ status: 200, authenticated: input.headers.authorization === "Bearer protected" }));
    const capability = new BoundedExtensionNetworkCapability(
      { destinations: ["https://api.example.test"], methods: ["GET"], secretReferences: ["sales.api"] },
      { resolve: async () => ({ header: "authorization", value: "Bearer protected" }) }, { request }
    );
    const input = capability.validateInput({ destination: "https://api.example.test", path: "/tasks", method: "GET", headers: { accept: "application/json" }, secretReference: "sales.api" });
    await expect(capability.invoke(context, input, new AbortController().signal)).resolves.toEqual({ status: 200, authenticated: true });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ destination: "https://api.example.test", path: "/tasks", headers: { accept: "application/json", authorization: "Bearer protected" } }), context);
  });

  it("denies unknown destinations, methods, references, caller auth headers, and secret reflection", async () => {
    const capability = new BoundedExtensionNetworkCapability(
      { destinations: ["https://api.example.test"], methods: ["GET"], secretReferences: ["sales.api"] },
      { resolve: async () => ({ header: "authorization", value: "Bearer protected" }) }, { request: async () => ({ body: "Bearer protected" }) }
    );
    expect(() => capability.validateInput({ destination: "https://api.example.test", path: "/", method: "GET", headers: { authorization: "forged" } })).toThrow();
    await expect(capability.invoke(context, capability.validateInput({ destination: "https://evil.example", path: "/", method: "GET", headers: {} }), new AbortController().signal)).rejects.toMatchObject({ code: "DESTINATION_DENIED" });
    await expect(capability.invoke(context, capability.validateInput({ destination: "https://api.example.test", path: "/", method: "POST", headers: {} }), new AbortController().signal)).rejects.toMatchObject({ code: "METHOD_DENIED" });
    await expect(capability.invoke(context, capability.validateInput({ destination: "https://api.example.test", path: "/", method: "GET", headers: {}, secretReference: "other.secret" }), new AbortController().signal)).rejects.toMatchObject({ code: "SECRET_REFERENCE_DENIED" });
    await expect(capability.invoke(context, capability.validateInput({ destination: "https://api.example.test", path: "/", method: "GET", headers: {}, secretReference: "sales.api" }), new AbortController().signal)).rejects.toMatchObject({ code: "SECRET_OUTPUT_REJECTED" });
  });
});
