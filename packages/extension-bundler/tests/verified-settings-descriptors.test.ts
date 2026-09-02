import { describe, expect, it, vi } from "vitest";

import { sha256, VerifiedHotApplicationSettingsDescriptorService, type VerifiedSettingsDescriptorArtifactIdentity } from "../src/index.js";

const artifactDigest = `sha256:${"a".repeat(64)}` as const;
const identity: VerifiedSettingsDescriptorArtifactIdentity = {
  applicationId: "customer-alpha", environment: "production", appId: "app.sales.settings",
  generationId: "sales-settings-generation-1", artifactDigest
};

const descriptor = (id: string) => ({
  schemaVersion: 1,
  id,
  publisher: { kind: "extension", deliveryClass: "hot-application", extensionId: identity.appId },
  descriptorSchemaVersion: 1,
  validation: "generation-validated",
  fields: { pageSize: { required: true, type: "integer", default: 50, minimum: 1, maximum: 100 } },
  readPermission: `${id}.read`,
  changePermission: `${id}.manage`
});

const descriptorOne = descriptor("sales.settings.one");
const descriptorTwo = descriptor("sales.settings.two");
const descriptorPathOne = "schemas/settings-one.json";
const descriptorPathTwo = "schemas/settings-two.json";

function applicationManifest(settings = [
  { id: descriptorTwo.id, path: descriptorPathTwo },
  { id: descriptorOne.id, path: descriptorPathOne }
]) {
  return {
    schemaVersion: 1, deliveryClass: "hot-application", id: identity.appId, displayName: "Sales settings", version: "1.0.0", runtimeAbi: "1.0.0",
    entrypoints: { server: [], ui: ["ui/main.mjs"] }, capabilities: [], permissions: [], policyBindings: [],
    resourceBudget: { maxBundleBytes: 1024, maxAssetBytes: 1024, maxStorageBytes: 1024, maxMemoryMiB: 64, maxCpuMilliCores: 100, maxWallTimeMs: 1_000, maxInputBytes: 1024, maxOutputBytes: 1024, maxLogBytes: 1024, maxConcurrency: 1 },
    settings, screens: [{ id: "sales.settings.screen", route: "/", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: [], localization: [], healthChecks: []
  };
}

function staged(options: Readonly<{
  manifest?: ReturnType<typeof applicationManifest>;
  files?: Readonly<Record<string, Buffer>>;
  metadata?: Readonly<Record<string, { digest: string; bytes: number; contentType: string }>>;
}> = {}) {
  const files = options.files ?? {
    [descriptorPathOne]: Buffer.from(JSON.stringify(descriptorOne)),
    [descriptorPathTwo]: Buffer.from(JSON.stringify(descriptorTwo)),
    "schemas/undeclared.json": Buffer.from(JSON.stringify(descriptor("sales.settings.undeclared")))
  };
  const metadata = options.metadata ?? Object.fromEntries(Object.entries(files).map(([path, body]) => [path, {
    digest: sha256(body), bytes: body.byteLength, contentType: "application/json"
  }]));
  return {
    artifactDigest,
    verified: {
      artifactDigest,
      manifest: { deliveryClass: "hot-application", id: identity.appId, files: metadata },
      hotApplicationManifest: options.manifest ?? applicationManifest(),
      files: new Map(Object.entries(files))
    }
  } as any;
}

function reader(result: unknown = staged()) {
  return {
    readSettingsDescriptors: vi.fn(async (requested: VerifiedSettingsDescriptorArtifactIdentity) =>
      requested.applicationId === identity.applicationId && requested.environment === identity.environment && requested.appId === identity.appId
      && requested.generationId === identity.generationId && requested.artifactDigest === identity.artifactDigest ? result : undefined)
  };
}

describe("verified Hot Application settings descriptors", () => {
  it("reads every declared descriptor in stable order as deeply frozen data only", async () => {
    const resolved = reader();
    const result = await new VerifiedHotApplicationSettingsDescriptorService(resolved).read(identity);
    expect(result.map(({ id }) => id)).toEqual([descriptorOne.id, descriptorTwo.id]);
    expect(result).toHaveLength(2);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0]!)).toBe(true);
    expect(Object.isFrozen(result[0]!.fields)).toBe(true);
    expect(Object.isFrozen(result[0]!.fields.pageSize!)).toBe(true);
    expect(result.map(({ id }) => id)).not.toContain("sales.settings.undeclared");
    expect(resolved.readSettingsDescriptors).toHaveBeenCalledWith(identity);
  });

  it("fails closed when the active reader cannot prove the exact owner, generation, or artifact", async () => {
    const service = new VerifiedHotApplicationSettingsDescriptorService(reader());
    for (const request of [
      { ...identity, applicationId: "customer-beta" }, { ...identity, environment: "staging" },
      { ...identity, appId: "app.other.settings" }, { ...identity, generationId: "sales-settings-generation-2" },
      { ...identity, artifactDigest: `sha256:${"b".repeat(64)}` }
    ]) {
      await expect(service.read(request)).rejects.toMatchObject({ code: "GENERATION_INACTIVE" });
    }
    await expect(new VerifiedHotApplicationSettingsDescriptorService({ readSettingsDescriptors: async () => undefined }).read(identity)).rejects.toMatchObject({ code: "GENERATION_INACTIVE" });
    await expect(new VerifiedHotApplicationSettingsDescriptorService({ readSettingsDescriptors: async () => { throw new Error("unavailable"); } }).read(identity)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
  });

  it("rejects undeclared, missing, tampered, and non-JSON-inventory descriptor bytes", async () => {
    const service = (value: unknown) => new VerifiedHotApplicationSettingsDescriptorService(reader(value));
    await expect(service(staged({ manifest: applicationManifest([{ id: descriptorOne.id, path: "schemas/missing.json" }]) })).read(identity)).rejects.toMatchObject({ code: "DESCRIPTOR_UNAVAILABLE" });
    const bytes = Buffer.from(JSON.stringify(descriptorOne));
    await expect(service(staged({ manifest: applicationManifest([{ id: descriptorOne.id, path: descriptorPathOne }]), files: { [descriptorPathOne]: bytes }, metadata: { [descriptorPathOne]: { digest: sha256(Buffer.from("tampered")), bytes: bytes.byteLength, contentType: "application/json" } } })).read(identity)).rejects.toMatchObject({ code: "INVENTORY_MISMATCH" });
    await expect(service(staged({ manifest: applicationManifest([{ id: descriptorOne.id, path: descriptorPathOne }]), files: { [descriptorPathOne]: bytes }, metadata: { [descriptorPathOne]: { digest: sha256(bytes), bytes: bytes.byteLength + 1, contentType: "application/json" } } })).read(identity)).rejects.toMatchObject({ code: "INVENTORY_MISMATCH" });
    await expect(service(staged({ manifest: applicationManifest([{ id: descriptorOne.id, path: descriptorPathOne }]), files: { [descriptorPathOne]: bytes }, metadata: { [descriptorPathOne]: { digest: sha256(bytes), bytes: bytes.byteLength, contentType: "text/plain" } } })).read(identity)).rejects.toMatchObject({ code: "DESCRIPTOR_UNAVAILABLE" });
  });

  it("rejects malformed bytes, invalid schemas, ownership mismatches, duplicate references, and executable-looking fields", async () => {
    const service = (value: unknown) => new VerifiedHotApplicationSettingsDescriptorService(reader(value));
    const badBytes = Buffer.from([0xc3, 0x28]);
    for (const body of [badBytes, Buffer.from("{"), Buffer.from(JSON.stringify({ ...descriptorOne, id: "sales.settings.other" })), Buffer.from(JSON.stringify({ ...descriptorOne, publisher: { kind: "extension", deliveryClass: "hot-application", extensionId: "app.other.settings" } })), Buffer.from(JSON.stringify({ ...descriptorOne, fields: { entrypoint: { required: false, type: "string" } } }))]) {
      await expect(service(staged({ manifest: applicationManifest([{ id: descriptorOne.id, path: descriptorPathOne }]), files: { [descriptorPathOne]: body } })).read(identity)).rejects.toMatchObject({ code: "DESCRIPTOR_INVALID" });
    }
    await expect(service(staged({ manifest: applicationManifest([{ id: descriptorOne.id, path: descriptorPathOne }, { id: descriptorOne.id, path: descriptorPathTwo }]) })).read(identity)).rejects.toMatchObject({ code: "DESCRIPTOR_UNAVAILABLE" });
    await expect(service(staged({ manifest: applicationManifest([{ id: descriptorOne.id, path: descriptorPathOne }, { id: descriptorTwo.id, path: descriptorPathOne }]) })).read(identity)).rejects.toMatchObject({ code: "DESCRIPTOR_UNAVAILABLE" });
  });
});
