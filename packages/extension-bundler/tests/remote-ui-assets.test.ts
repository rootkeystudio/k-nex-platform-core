import { describe, expect, it } from "vitest";

import { createRemoteUiFrameDocument, createRemoteUiWorkerBootstrapSource, VerifiedRemoteUiAssetService, sha256, type RemoteUiAssetRequest } from "../src/index.js";

const body = Buffer.from("self.onmessage = () => {};\n");
const fileDigest = sha256(body);
const artifactDigest = `sha256:${"a".repeat(64)}` as const;
const manifest = {
  deliveryClass: "hot-application", id: "app.sales-assistant",
  files: { "ui/main.mjs": { digest: fileDigest, bytes: body.byteLength, contentType: "application/javascript" } }
};
const staged = {
  artifactDigest,
  verified: { artifactDigest, manifest, files: new Map([["ui/main.mjs", body]]) }
} as any;
const request: RemoteUiAssetRequest = {
  applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant", generationId: "sales-generation-1",
  artifactDigest, fileDigest, path: "ui/main.mjs"
};

describe("verified Remote UI assets", () => {
  it("serves only active generation-pinned verified bytes with immutable security headers", async () => {
    const service = new VerifiedRemoteUiAssetService({ read: () => staged }, { isActive: async () => true });
    const bootstrap = Buffer.from(createRemoteUiWorkerBootstrapSource(body.toString("utf8")));
    const response = await service.readBootstrap({ ...request, bootstrapDigest: sha256(bootstrap) });
    expect(Buffer.from(response.body)).toEqual(bootstrap);
    expect(response.headers).toMatchObject({
      "cache-control": "public, max-age=31536000, immutable", "content-type": "application/javascript; charset=utf-8",
      "access-control-allow-origin": "null", "cross-origin-resource-policy": "cross-origin", "x-content-type-options": "nosniff"
    });
    expect(response.headers["content-security-policy"]).toContain("connect-src 'none'");
    const document = createRemoteUiFrameDocument(`/api/extensions/apps/app.sales-assistant/assets/sales-generation-1/${response.bootstrapDigest}/bootstrap.js`, response.integrity);
    expect(Buffer.from(document.body).toString("utf8")).toContain('crossorigin="anonymous"');
    expect(document.headers["content-security-policy"]).toContain("worker-src blob:");
  });

  it("rejects staged, mixed-generation, digest, traversal, and unverified assets", async () => {
    const bootstrapDigest = sha256(Buffer.from(createRemoteUiWorkerBootstrapSource(body.toString("utf8"))));
    await expect(new VerifiedRemoteUiAssetService({ read: () => staged }, { isActive: async () => false }).readBootstrap({ ...request, bootstrapDigest })).rejects.toMatchObject({ code: "GENERATION_INACTIVE" });
    const service = new VerifiedRemoteUiAssetService({ read: () => staged }, { isActive: async () => true });
    await expect(service.readBootstrap({ ...request, fileDigest: `sha256:${"b".repeat(64)}`, bootstrapDigest })).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    await expect(service.readBootstrap({ ...request, path: "ui/../secret.mjs", bootstrapDigest })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    await expect(new VerifiedRemoteUiAssetService({ read: () => undefined }, { isActive: async () => true }).readBootstrap({ ...request, bootstrapDigest })).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
  });
});
