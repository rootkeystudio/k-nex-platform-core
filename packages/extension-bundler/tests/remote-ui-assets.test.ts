import { describe, expect, it, vi } from "vitest";

import { createRemoteUiFrameDocument, createRemoteUiWorkerBootstrapSource, VerifiedRemoteUiAssetService, sha256, type RemoteUiAssetRequest } from "../src/index.js";

const body = Buffer.from("self.onmessage = () => {};\n");
const fileDigest = sha256(body);
const artifactDigest = `sha256:${"a".repeat(64)}` as const;
const files = {
  "ui/main.mjs": { body, contentType: "application/javascript" as const },
  "assets/logo.svg": { body: Buffer.from("<svg/>\n"), contentType: "image/svg+xml" as const },
  "assets/unlisted.svg": { body: Buffer.from("<svg>unlisted</svg>\n"), contentType: "image/svg+xml" as const },
  "locales/en.json": { body: Buffer.from('{"label":"Sales"}\n'), contentType: "application/json" as const },
  "locales/unlisted.json": { body: Buffer.from('{"label":"Unlisted"}\n'), contentType: "application/json" as const }
};
const manifest = {
  deliveryClass: "hot-application", id: "app.sales-assistant",
  entrypoints: { ui: ["ui/main.mjs"] },
  files: Object.fromEntries(Object.entries(files).map(([path, file]) => [path, { digest: sha256(file.body), bytes: file.body.byteLength, contentType: file.contentType }]))
};
const staged = {
  artifactDigest,
  verified: {
    artifactDigest, manifest,
    hotApplicationManifest: { screens: [{ entrypoint: "ui/main.mjs" }], assets: ["assets/logo.svg"], localization: [{ locale: "en", path: "locales/en.json" }] },
    files: new Map(Object.entries(files).map(([path, file]) => [path, file.body]))
  }
} as any;
const reader = (result: unknown = staged) => ({
  readRemoteUi: vi.fn(async (identity) =>
    identity.applicationId === request.applicationId && identity.environment === request.environment && identity.extensionId === request.appId &&
    identity.generationId === request.generationId && identity.artifactDigest === request.artifactDigest ? result : undefined)
});
const unavailableReader = { readRemoteUi: async () => undefined };
const request: RemoteUiAssetRequest = {
  applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant", generationId: "sales-generation-1",
  artifactDigest, fileDigest, path: "ui/main.mjs"
};

describe("verified Remote UI assets", () => {
  it("proxies native Worker failures as one generation-bound failure frame and cleans up once", () => {
    class Port {
      readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
      readonly sent: unknown[] = [];
      closes = 0;
      addEventListener(type: string, listener: (event: { data?: unknown }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
      start() {}
      close() { this.closes += 1; }
      postMessage(value: unknown) { this.sent.push(value); }
      emit(type: string, data?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener({ data }); }
    }
    class Channel {
      static latest: Channel | undefined;
      readonly port1 = new Port();
      readonly port2 = new Port();
      constructor() { Channel.latest = this; }
    }
    let worker: { readonly listeners: Map<string, Array<(event: { data?: unknown; preventDefault?: () => void }) => void>>; readonly sent: unknown[]; terminate: ReturnType<typeof vi.fn> } | undefined;
    let workerUrl: unknown;
    let workerOptions: unknown;
    const Worker = class {
      readonly listeners = new Map<string, Array<(event: { data?: unknown; preventDefault?: () => void }) => void>>();
      readonly sent: unknown[] = [];
      readonly terminate = vi.fn();
      constructor(url: unknown, options: unknown) { workerUrl = url; workerOptions = options; worker = this; }
      addEventListener(type: string, listener: (event: { data?: unknown; preventDefault?: () => void }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
      postMessage(value: unknown, ports?: unknown[]) { this.sent.push([value, ports]); }
      emit(type: string, data?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener({ data, preventDefault() {} }); }
    };
    const listeners = new Map<string, (event: { data?: unknown; ports?: Port[] }) => void>();
    const moduleSource = "export const remoteUiModule = true;\n";
    new Function("addEventListener", "removeEventListener", "Worker", "MessageChannel", createRemoteUiWorkerBootstrapSource(moduleSource))(
      (type: string, listener: (event: { data?: unknown; ports?: Port[] }) => void) => listeners.set(type, listener),
      (type: string) => listeners.delete(type), Worker, Channel
    );
    const host = new Port();
    listeners.get("message")!({ data: { type: "k-nex-connect" }, ports: [host] });
    host.emit("message", { schemaVersion: 1, sessionId: "remote-session-1", appId: "app.sales-assistant", generationId: "sales-generation-1", sequence: 1, direction: "host-to-realm", type: "bootstrap" });
    Channel.latest!.port1.emit("message", { schemaVersion: 1, sessionId: "remote-session-1", appId: "app.sales-assistant", generationId: "sales-generation-1", sequence: 1, direction: "realm-to-host", type: "ready" });
    worker!.emit("error");
    worker!.emit("messageerror");
    Channel.latest!.port1.emit("message", { schemaVersion: 1, sessionId: "remote-session-1", appId: "app.sales-assistant", generationId: "sales-generation-1", sequence: 2, direction: "realm-to-host", type: "ready" });
    expect(host.sent).toEqual([
      { schemaVersion: 1, sessionId: "remote-session-1", appId: "app.sales-assistant", generationId: "sales-generation-1", sequence: 1, direction: "realm-to-host", type: "ready" },
      { schemaVersion: 1, sessionId: "remote-session-1", appId: "app.sales-assistant", generationId: "sales-generation-1", sequence: 2, direction: "realm-to-host", type: "failure", code: "APP_BOOT_FAILED" }
    ]);
    expect(worker!.terminate).toHaveBeenCalledTimes(1);
    expect(workerUrl).toMatch(/^data:text\/javascript;base64,/u);
    expect(Buffer.from((workerUrl as string).slice("data:text/javascript;base64,".length), "base64").toString("utf8")).toBe(moduleSource);
    expect(workerOptions).toEqual({ type: "module" });
    expect(host.closes).toBe(1);
  });

  it("serves only active generation-pinned verified bytes with immutable security headers", async () => {
    const resolved = reader();
    const service = new VerifiedRemoteUiAssetService(resolved);
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
    expect(document.headers["content-security-policy"]).toContain("worker-src data:");
    expect(resolved.readRemoteUi).toHaveBeenCalledWith({
      applicationId: request.applicationId, environment: request.environment, extensionId: request.appId,
      generationId: request.generationId, artifactDigest: request.artifactDigest
    });
  });

  it("rejects inactive, wrong-owner, wrong-generation, digest, traversal, and unverified assets", async () => {
    const bootstrapDigest = sha256(Buffer.from(createRemoteUiWorkerBootstrapSource(body.toString("utf8"))));
    await expect(new VerifiedRemoteUiAssetService(unavailableReader).readBootstrap({ ...request, bootstrapDigest })).rejects.toMatchObject({ code: "GENERATION_INACTIVE" });
    const service = new VerifiedRemoteUiAssetService(reader());
    await expect(service.readBootstrap({ ...request, applicationId: "customer-beta", bootstrapDigest })).rejects.toMatchObject({ code: "GENERATION_INACTIVE" });
    await expect(service.readBootstrap({ ...request, environment: "staging", bootstrapDigest })).rejects.toMatchObject({ code: "GENERATION_INACTIVE" });
    await expect(service.readBootstrap({ ...request, appId: "app.support-assistant", bootstrapDigest })).rejects.toMatchObject({ code: "GENERATION_INACTIVE" });
    await expect(service.readBootstrap({ ...request, generationId: "sales-generation-2", bootstrapDigest })).rejects.toMatchObject({ code: "GENERATION_INACTIVE" });
    await expect(service.readBootstrap({ ...request, artifactDigest: `sha256:${"c".repeat(64)}`, bootstrapDigest })).rejects.toMatchObject({ code: "GENERATION_INACTIVE" });
    await expect(service.readBootstrap({ ...request, fileDigest: `sha256:${"b".repeat(64)}`, bootstrapDigest })).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    await expect(service.readBootstrap({ ...request, path: "ui/../secret.mjs", bootstrapDigest })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    await expect(new VerifiedRemoteUiAssetService({ readRemoteUi: async () => { throw new Error("corrupt"); } }).readBootstrap({ ...request, bootstrapDigest })).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    for (const metadata of [{ ...manifest.files["ui/main.mjs"], bytes: body.byteLength + 1 }, { ...manifest.files["ui/main.mjs"], contentType: "text/plain" }]) {
      const inconsistent = { ...staged, verified: { ...staged.verified, manifest: { ...manifest, files: { "ui/main.mjs": metadata } } } };
      await expect(new VerifiedRemoteUiAssetService(reader(inconsistent)).readBootstrap({ ...request, bootstrapDigest })).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    }
  });

  it("allows bootstrap only for a declared screen entrypoint", async () => {
    const hidden = Buffer.from("self.onmessage = () => {};\n");
    const hiddenDigest = sha256(hidden);
    const hiddenStaged = {
      ...staged,
      verified: {
        ...staged.verified,
        manifest: { ...manifest, entrypoints: { ui: ["ui/main.mjs", "ui/hidden.mjs"] }, files: { ...manifest.files, "ui/hidden.mjs": { digest: hiddenDigest, bytes: hidden.byteLength, contentType: "application/javascript" } } },
        files: new Map([["ui/main.mjs", body], ["ui/hidden.mjs", hidden]])
      }
    };
    await expect(new VerifiedRemoteUiAssetService(reader(hiddenStaged)).readBootstrap({
      ...request, path: "ui/hidden.mjs", fileDigest: hiddenDigest,
      bootstrapDigest: sha256(Buffer.from(createRemoteUiWorkerBootstrapSource(hidden.toString("utf8"))))
    })).rejects.toMatchObject({ code: "ASSET_UNAVAILABLE" });
  });

  it("serves only signed manifest-declared assets and localization with their exact digests", async () => {
    const service = new VerifiedRemoteUiAssetService(reader());
    for (const path of ["assets/logo.svg", "locales/en.json"] as const) {
      const metadata = manifest.files[path];
      const response = await service.read({ ...request, path, fileDigest: metadata.digest });
      expect(Buffer.from(response.body)).toEqual(files[path].body);
      expect(response.headers["content-digest"]).toBe(`sha-256=:${Buffer.from(metadata.digest.slice("sha256:".length), "hex").toString("base64")}:`);
      await expect(service.read({ ...request, path, fileDigest: `sha256:${"b".repeat(64)}` })).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    }
  });

  it("rejects signed inventory assets and locales absent from the signed Hot Application manifest", async () => {
    const service = new VerifiedRemoteUiAssetService(reader());
    for (const path of ["assets/unlisted.svg", "locales/unlisted.json"] as const) {
      await expect(service.read({ ...request, path, fileDigest: manifest.files[path].digest })).rejects.toMatchObject({ code: "ASSET_UNAVAILABLE" });
    }
  });

  it("copies stored bytes and rejects corrupted reader bytes before serving", async () => {
    const original = Buffer.from(body);
    const stored = { ...staged, verified: { ...staged.verified, files: new Map([["ui/main.mjs", original]]) } };
    const service = new VerifiedRemoteUiAssetService(reader(stored));
    const bootstrap = Buffer.from(createRemoteUiWorkerBootstrapSource(original.toString("utf8")));
    const response = await service.readBootstrap({ ...request, bootstrapDigest: sha256(bootstrap) });
    original.fill(0x20);
    expect(Buffer.from(response.body)).toEqual(bootstrap);
    const corruptedBootstrap = Buffer.from(createRemoteUiWorkerBootstrapSource(original.toString("utf8")));
    await expect(service.readBootstrap({ ...request, bootstrapDigest: sha256(corruptedBootstrap) })).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
  });
});
