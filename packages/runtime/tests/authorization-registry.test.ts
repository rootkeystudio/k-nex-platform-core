import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { PluginManifest } from "@k-nex/contracts";
import type { InstalledPlatformPluginManifest, ResolvedPlatformPluginGraph } from "@k-nex/composition";

import {
  AuthorizationRegistryError,
  createEffectiveAuthorizationCatalog,
  createHotApplicationManifestAuthorizationContribution,
  createHotApplicationPolicyExecutable,
  createPlatformPluginRegistrationAuthorizationContribution,
  createPlatformPluginPolicyExecutable,
  platformPermissionDescriptors
} from "../src/authorization-registry.js";
import { AuthoritativeHotApplicationRuntime } from "../src/hot-application-runtime.js";
import { definePluginRegistration, executeRegistration } from "../src/registration-runtime.js";
import { scopePlatformPluginRegistration } from "../src/plugin-lifecycle.js";

const platformPublisher = { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" } as const;
const hotSalesPublisher = { kind: "extension", deliveryClass: "hot-application", extensionId: "app.sales" } as const;
type ExtensionPublisher = Readonly<{ kind: "extension"; deliveryClass: "platform-plugin" | "hot-application"; extensionId: string }>;
const hotProductionProfile = {
  schemaVersion: 1, scope: "production", profile: "os-container-per-generation-v1", isolation: "os-container-per-generation", workloadIdentity: "unique-non-root",
  namespaces: { pid: "separate", mount: "separate", user: "separate", network: "separate" },
  filesystem: { root: "read-only", code: "read-only", temporaryStorage: "bounded-tmpfs", hostMounts: "none" },
  privileges: { linuxCapabilities: "dropped", noNewPrivileges: true, dockerSocket: "none", databaseCredential: "none", hostSecrets: "none" },
  policy: { syscallProfile: "sha256:9e1b305927408a95032982bd0c5713e372cd2a3c205febc954df62e8a0de3ef8", macProfile: "sha256:258d1e7e322b0dd4d9394ddc97e356e191076a89609cd07395fe5ac9656a1814", rawEgress: "denied", inboundListener: "denied", hostNetworkAdapter: "allowlisted-proxy-only" },
  limits: { cpuMilliCores: 2_000, memoryMiB: 512, processes: 256, openFiles: 4_096, tempBytes: 268_435_456 },
  rpc: { transport: "structured-host-rpc-only", schemaValidated: true, shortLivedGenerationActorIdentity: true }
} as const;
const hotDigest = (character: string) => `sha256:${character.repeat(64)}`;

function descriptor(publisher: ExtensionPublisher = platformPublisher, id = "sales.policy.read", scope: "application" | "record" | "field" = "application") {
  return { schemaVersion: 1, id, publisher, title: "Read policy data", description: "Read data through a bounded policy.", audience: "authenticated", resource: scope === "application" ? "sales.policy" : "sales.records", operation: "read", scope };
}

function binding(publisher: ExtensionPublisher = platformPublisher, permissionId = "sales.policy.read", scope: "application" | "record" | "field" = "application", id = "sales.policy.binding", policyReference = "sales.policy.execute") {
  return { schemaVersion: 1, id, publisher, permissionId, policyReference, scope, failureMode: "deny", timeoutMs: 25 };
}

function owner(publisher: ExtensionPublisher = platformPublisher, generation = 7) {
  return { ...publisher, generation };
}

function platformExecutable() {
  return createPlatformPluginPolicyExecutable({
    kind: "platform-plugin", publisher: platformPublisher, bindingId: "sales.policy.binding", policyReference: "sales.policy.execute",
    executor: { evaluate() { return { schemaVersion: 1, outcome: "allow" }; } }
  });
}

function evaluation(permissionId = "sales.policy.read") {
  return {
    schemaVersion: 1, applicationId: "customer-alpha", permissionId,
    scope: { kind: "application", resource: "sales.policy" },
    principal: { kind: "user", id: "user:one" }, effectiveActor: { kind: "user", id: "user:one" }, facts: { recordCount: 1 }
  };
}

function expectCode(action: () => unknown, code: string) {
  expect(action).toThrow(expect.objectContaining({ code } satisfies Partial<AuthorizationRegistryError>));
}

function createCatalog(input: Readonly<{ extensions: readonly unknown[]; executables: readonly unknown[] }>) {
  return createEffectiveAuthorizationCatalog({ applicationId: "customer-alpha", ...input });
}

function registeredPlatformContribution(options: Readonly<{
  pluginId?: string;
  applicationId?: string;
  descriptors?: readonly ReturnType<typeof descriptor>[];
  bindings?: readonly ReturnType<typeof binding>[];
  templates?: readonly ReturnType<typeof template>[];
}> = {}) {
  const pluginId = options.pluginId ?? platformPublisher.extensionId;
  const publisher = { kind: "extension", deliveryClass: "platform-plugin", extensionId: pluginId } as const;
  const descriptors = options.descriptors ?? [descriptor(publisher)];
  const bindings = options.bindings ?? [binding(publisher)];
  const templates = options.templates ?? [template(publisher, "sales.template.viewer", "sales.policy.read")];
  const declared = (values: readonly { readonly id: string }[]) => Object.fromEntries(values.map(({ id }) => [id, "required"]));
  const manifest = {
    apiVersion: 1, id: pluginId, kind: "module", displayName: "Sales", version: "1.0.0", package: `@k-nex/${pluginId.replace(/\./gu, "-")}`,
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "supported" },
    contributions: {
      permissions: declared(descriptors), policyBindings: declared(bindings), roleTemplates: declared(templates)
    }
  } as PluginManifest;
  const graph: ResolvedPlatformPluginGraph = {
    resolverVersion: "1.0.0", plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: "sha512-sales", required: [], optional: [] }],
    capabilityProviders: [], registrationOrder: [manifest.id]
  };
  const installed: readonly InstalledPlatformPluginManifest[] = [{ package: { name: manifest.package, version: manifest.version, integrity: "sha512-sales" }, manifest }];
  const registration = definePluginRegistration({
    pluginId: manifest.id,
    contracts(context) {
      for (const value of descriptors) context.register("permissions", value.id, value);
      for (const value of bindings) context.register("policyBindings", value.id, value);
      for (const value of templates) context.register("roleTemplates", value.id, value);
    }
  });
  const scoped = scopePlatformPluginRegistration(executeRegistration({ graph, installed, registrations: [registration] }), []);
  return createPlatformPluginRegistrationAuthorizationContribution({
    registration: scoped,
    generation: {
      schemaVersion: 1, applicationId: options.applicationId ?? "customer-alpha", owner: owner(publisher), runtimeGenerationIds: ["sales-generation-1"],
      state: "current", authorizationRevision: 1, lifecycleRevision: 1
    }
  });
}

async function registeredHotContribution(options: Readonly<{
  applicationId?: string;
  enabled?: boolean;
  generation?: number;
  ready?: boolean;
  runnerInvoke?: (input: unknown) => unknown | Promise<unknown>;
  state?: "current" | "retired";
}> = {}) {
  const manifest = JSON.parse(readFileSync(new URL("../../../fixtures/extensions/valid/hot-application.manifest.json", import.meta.url), "utf8"));
  const generationNumber = options.generation ?? 7;
  const runtimeGenerationId = `sales-assistant-generation-${generationNumber}`;
  const authority = {
    applicationId: options.applicationId ?? "customer-alpha", environment: "production", deliveryClass: "hot-application" as const, extensionId: manifest.id,
    generationId: runtimeGenerationId, sourceCommit: "a".repeat(40), artifactDigest: hotDigest("a"), manifestDigest: hotDigest("b"),
    catalogDigest: hotDigest("c"), provenanceDigest: hotDigest("d"), sbomDigest: hotDigest("e")
  };
  const activeGeneration = { authority: "verified-bundle" as const, ...authority, version: manifest.version, receiptId: "receipt-hot-auth-1" };
  const artifact = {
    authority, version: manifest.version, hotApplicationManifest: manifest, capabilities: manifest.capabilities, resourceBudget: manifest.resourceBudget,
    compatibility: { status: "compatible", windowId: "rollback-window-1", closesAt: "2026-09-01T01:00:00.000Z", migrationDigest: hotDigest("f"), dataRevision: 1 },
    metadata: {}, settings: {}, storageSchemaVersions: {}
  };
  const runner = { isolationProfile: hotProductionProfile, invoke: vi.fn(async (input) => options.runnerInvoke ? await options.runnerInvoke(input) : { schemaVersion: 1, outcome: "allow" }) };
  const tokens = { issue: vi.fn(() => "capability-token") };
  const capabilities = { authorize: vi.fn(async () => true) };
  const runtime = new AuthoritativeHotApplicationRuntime({
    inventory: vi.fn(async () => ({ extensions: { hotApplications: { [manifest.id]: { disposition: "active" as const, activeGeneration } } } })),
    acquireGenerationLease: vi.fn(async () => "lease-00000000-0000-4000-8000-000000000000"), releaseGenerationLease: vi.fn(async () => {})
  } as never, { resolve: vi.fn(async () => artifact) } as never, tokens as never, runner, capabilities, {
    applicationId: authority.applicationId, environment: authority.environment, appId: manifest.id
  }, "authorization-policy-gateway");
  const source = await runtime.createAuthorizationSource();
  const gateway = runtime.createAuthorizationPolicyGateway(source);
  const generation = {
    schemaVersion: 1, applicationId: authority.applicationId,
    owner: { kind: "extension", deliveryClass: "hot-application", extensionId: manifest.id, generation: generationNumber },
    runtimeGenerationIds: [runtimeGenerationId], state: options.state ?? "current", authorizationRevision: 1, lifecycleRevision: 1
  } as const;
  return Object.freeze({
    manifest, generation, source, gateway, runner, tokens, capabilities,
    contribution: createHotApplicationManifestAuthorizationContribution({
      source, generation, lifecycle: { enabled: options.enabled ?? true, ready: options.ready ?? true }
    })
  });
}

function hotExecutable(hot: Awaited<ReturnType<typeof registeredHotContribution>>) {
  const manifest = hot.manifest;
  return createHotApplicationPolicyExecutable({
    kind: "hot-application", publisher: manifest.permissions[0]!.publisher, bindingId: manifest.policyBindings[0]!.id,
    policyReference: manifest.policyBindings[0]!.policyReference,
    gateway: hot.gateway
  });
}

function template(publisher: ExtensionPublisher, id: string, permissionId: string) {
  return { schemaVersion: 1, id, publisher, version: 1, instantiation: "manual", title: "Policy viewer", permissionIds: [permissionId] };
}

function rawPlatformContribution() {
  const currentOwner = owner();
  return {
    owner: currentOwner,
    generation: {
      schemaVersion: 1, applicationId: "customer-alpha", owner: currentOwner, runtimeGenerationIds: ["sales-generation-1"],
      state: "current", authorizationRevision: 1, lifecycleRevision: 1
    },
    lifecycle: { enabled: true, ready: true },
    descriptors: [descriptor()], bindings: [binding()], templates: [template(platformPublisher, "sales.template.viewer", "sales.policy.read")]
  };
}

describe("effective authorization registry", () => {
  it("freezes exactly the nineteen planned system permissions", () => {
    expect(platformPermissionDescriptors.map(({ id }) => id)).toEqual([
      "system.permissions.read", "system.roles.read", "system.roles.manage", "system.role-assignments.read", "system.role-assignments.manage",
      "system.authorization.audit.read", "system.extensions.read", "system.extensions.plan", "system.extensions.install-hot",
      "system.extensions.deploy-platform-plugin", "system.extensions.enable", "system.extensions.disable", "system.extensions.update",
      "system.extensions.rollback", "system.extensions.uninstall", "system.extensions.quarantine", "system.settings.read",
      "system.settings.manage", "system.themes.manage"
    ]);
    expect(platformPermissionDescriptors.every((entry) => entry.publisher.kind === "platform" && Object.isFrozen(entry))).toBe(true);
  });

  it("reconciles and invokes a trusted Platform Plugin policy binding", async () => {
    const catalog = createCatalog({ extensions: [registeredPlatformContribution()], executables: [platformExecutable()] });
    expect(catalog.permissions.map(({ descriptor: entry }) => entry.id)).toContain("sales.policy.read");
    await expect(catalog.execute(evaluation(), new AbortController().signal)).resolves.toEqual({ schemaVersion: 1, outcome: "allow", reason: "allowed" });
    expect(Object.isFrozen(catalog.permissions)).toBe(true);
  });

  it("routes Hot Application policy execution only through the gateway", async () => {
    const hot = await registeredHotContribution();
    const executable = hotExecutable(hot);
    const catalog = createCatalog({ extensions: [hot.contribution], executables: [executable] });
    await expect(catalog.execute({ ...evaluation("sales-assistant.tasks.read"), scope: { kind: "record", resource: "sales-assistant.tasks", recordId: "task:one" } }, new AbortController().signal)).resolves.toMatchObject({ outcome: "allow" });
    expect(hot.runner.invoke).toHaveBeenCalledWith(expect.objectContaining({ generationId: hot.generation.runtimeGenerationIds[0], artifactDigest: hotDigest("a"), input: expect.objectContaining({ kind: "authorization-policy-evaluation" }) }));
    expect(hot.capabilities.authorize).not.toHaveBeenCalled();
    expect(hot.tokens.issue).toHaveBeenCalledWith(expect.objectContaining({ grants: [] }));
    expectCode(() => createHotApplicationPolicyExecutable({
      kind: "hot-application", publisher: hot.manifest.permissions[0].publisher, bindingId: hot.manifest.policyBindings[0].id,
      policyReference: hot.manifest.policyBindings[0].policyReference, gateway: { evaluate() { return { schemaVersion: 1, outcome: "allow" }; } }
    }), "UNTRUSTED_EXECUTABLE");
    expectCode(() => createCatalog({
      extensions: [hot.contribution],
      executables: [{ kind: "hot-application", publisher: hot.manifest.permissions[0].publisher, bindingId: hot.manifest.policyBindings[0].id, policyReference: hot.manifest.policyBindings[0].policyReference, execute() { return { schemaVersion: 1, outcome: "allow" }; } }]
    }), "HOT_APPLICATION_FUNCTION_FORBIDDEN");
  });

  it("rejects a policy gateway from another verified generation before runner invocation", async () => {
    const [generationA, generationB] = await Promise.all([
      registeredHotContribution({ generation: 7 }),
      registeredHotContribution({ generation: 8 })
    ]);
    expectCode(() => createCatalog({ extensions: [generationA.contribution], executables: [hotExecutable(generationB)] }), "OWNER_MISMATCH");
    expect(generationB.runner.invoke).not.toHaveBeenCalled();
  });

  it("bridges a canonical Hot Application manifest into the effective catalog", async () => {
    const hot = await registeredHotContribution();
    hot.manifest.permissions[0].title = "Mutated after normalization";
    const catalog = createCatalog({
      extensions: [hot.contribution], executables: [hotExecutable(hot)]
    });
    expect(catalog.permissions.map(({ descriptor: entry }) => entry.id)).toContain("sales-assistant.tasks.read");
    expect(catalog.roleTemplates.map(({ template: entry }) => entry.id)).toContain("sales-assistant.template.viewer");
    await expect(catalog.execute({
      schemaVersion: 1, applicationId: "customer-alpha", permissionId: "sales-assistant.tasks.read",
      scope: { kind: "record", resource: "sales-assistant.tasks", recordId: "task:one" },
      principal: { kind: "user", id: "user:one" }, effectiveActor: { kind: "user", id: "user:one" }, facts: {}
    }, new AbortController().signal)).resolves.toMatchObject({ outcome: "allow" });
    expect(Object.isFrozen(hot.contribution)).toBe(true);
    expect(hot.contribution.descriptors[0].title).toBe("Read Sales Assistant tasks");
    expectCode(() => createHotApplicationManifestAuthorizationContribution({
      source: hot.source, generation: { ...hot.generation, owner: { ...hot.generation.owner, extensionId: "app.other" } }, lifecycle: { enabled: true, ready: true }
    }), "OWNER_MISMATCH");
    expectCode(() => createHotApplicationManifestAuthorizationContribution({
      source: hot.source, generation: { ...hot.generation, runtimeGenerationIds: ["sales-assistant-generation-other"] }, lifecycle: { enabled: true, ready: true }
    }), "OWNER_MISMATCH");
    expectCode(() => createHotApplicationManifestAuthorizationContribution({
      source: { ...hot.source }, generation: hot.generation, lifecycle: { enabled: true, ready: true }
    }), "INVALID_INPUT");
  });

  it("accepts only branded static registration and verified manifest contributions", async () => {
    const raw = rawPlatformContribution();
    expectCode(() => createCatalog({ extensions: [raw], executables: [platformExecutable()] }), "INVALID_INPUT");
    const registered = registeredPlatformContribution();
    expectCode(() => createCatalog({ extensions: [{ ...registered }], executables: [platformExecutable()] }), "INVALID_INPUT");
    const hot = await registeredHotContribution();
    expectCode(() => createCatalog({ extensions: [{ ...hot.contribution }], executables: [hotExecutable(hot)] }), "INVALID_INPUT");
  });

  it("rejects missing, duplicate, undeclared, reference, and scope mismatches globally", async () => {
    const registered = registeredPlatformContribution();
    expectCode(() => createCatalog({ extensions: [registered], executables: [] }), "MISSING_EXECUTABLE");
    const hot = await registeredHotContribution();
    const foreignOwner = createHotApplicationPolicyExecutable({ kind: "hot-application", publisher: hotSalesPublisher, bindingId: "sales.policy.binding", policyReference: "sales.policy.execute", gateway: hot.gateway });
    expectCode(() => createCatalog({ extensions: [registered], executables: [foreignOwner] }), "OWNER_MISMATCH");
    expectCode(() => createCatalog({ extensions: [registered], executables: [platformExecutable(), platformExecutable()] }), "DUPLICATE_EXECUTABLE");
    const unused = createPlatformPluginPolicyExecutable({ kind: "platform-plugin", publisher: platformPublisher, bindingId: "sales.policy.unused", policyReference: "sales.policy.unused", executor: { evaluate() { return { schemaVersion: 1, outcome: "allow" }; } } });
    expectCode(() => createCatalog({ extensions: [registered], executables: [platformExecutable(), unused] }), "UNDECLARED_EXECUTABLE");
    const wrongReference = createPlatformPluginPolicyExecutable({ kind: "platform-plugin", publisher: platformPublisher, bindingId: "sales.policy.binding", policyReference: "sales.policy.other", executor: { evaluate() { return { schemaVersion: 1, outcome: "allow" }; } } });
    expectCode(() => createCatalog({ extensions: [registered], executables: [wrongReference] }), "REFERENCE_MISMATCH");
    expectCode(() => createCatalog({
      extensions: [registeredPlatformContribution({
        descriptors: [descriptor(platformPublisher, "sales.policy.read", "record")],
        bindings: [binding(platformPublisher, "sales.policy.read", "application")]
      })], executables: [platformExecutable()]
    }), "SCOPE_MISMATCH");
  });

  it("rejects duplicate active declarations across verified generations", async () => {
    const [first, second] = await Promise.all([registeredHotContribution({ generation: 7 }), registeredHotContribution({ generation: 8 })]);
    expectCode(() => createCatalog({
      extensions: [first.contribution, second.contribution], executables: []
    }), "DUPLICATE_DESCRIPTOR");
  });

  it("omits retired, disabled, and not-ready generations from the authority catalog", async () => {
    for (const inactive of await Promise.all([registeredHotContribution({ state: "retired" }), registeredHotContribution({ enabled: false }), registeredHotContribution({ ready: false })])) {
      const catalog = createCatalog({ extensions: [inactive.contribution], executables: [hotExecutable(inactive)] });
      expect(catalog.permissions.map(({ descriptor: entry }) => entry.id)).not.toContain("sales-assistant.tasks.read");
    }
  });

  it("keeps catalog generations and policy evaluation application-scoped", async () => {
    expectCode(() => createCatalog({ extensions: [registeredPlatformContribution({ applicationId: "customer-beta" })], executables: [platformExecutable()] }), "OWNER_MISMATCH");
    const active = createCatalog({ extensions: [registeredPlatformContribution()], executables: [platformExecutable()] });
    await expect(active.execute({ ...evaluation(), applicationId: "customer-beta" }, new AbortController().signal))
      .resolves.toMatchObject({ outcome: "deny", reason: "invalid-input" });
  });

  it("rejects administrative snapshots as runtime authority", () => {
    const sales = descriptor();
    const snapshot = {
      schemaVersion: 1, id: "snapshot-sales-policy", applicationId: "customer-alpha", source: "administrative-non-authoritative",
      permission: sales, state: "inactive-extension-disabled", owner: owner(), revision: 1
    };
    expectCode(() => createEffectiveAuthorizationCatalog(snapshot), "SNAPSHOT_NOT_AUTHORITY");
  });

  it("denies gateway throws and binding timeouts without leaking policy authority", async () => {
    const hotContribution = await registeredHotContribution({ runnerInvoke() { throw new Error("runner failure"); } });
    const hot = createCatalog({ extensions: [hotContribution.contribution], executables: [hotExecutable(hotContribution)] });
    await expect(hot.execute({ ...evaluation("sales-assistant.tasks.read"), scope: { kind: "record", resource: "sales-assistant.tasks", recordId: "task:one" } }, new AbortController().signal)).resolves.toMatchObject({ outcome: "deny", reason: "failure" });
    const timeout = createPlatformPluginPolicyExecutable({
      kind: "platform-plugin", publisher: platformPublisher, bindingId: "sales.policy.binding", policyReference: "sales.policy.execute",
      executor: { async evaluate() { await new Promise<void>(() => undefined); return { schemaVersion: 1, outcome: "allow" }; } }
    });
    const timed = createCatalog({ extensions: [registeredPlatformContribution({ bindings: [{ ...binding(), timeoutMs: 1 }] })], executables: [timeout] });
    await expect(timed.execute(evaluation(), new AbortController().signal)).resolves.toMatchObject({ outcome: "deny", reason: "timeout" });
  });

  it("snapshots trusted Platform Plugin executor callbacks at binding creation", async () => {
    const executor: { evaluate(): { schemaVersion: 1; outcome: "allow" | "deny" } } = { evaluate() { return { schemaVersion: 1, outcome: "allow" }; } };
    const plugin = createPlatformPluginPolicyExecutable({ kind: "platform-plugin", publisher: platformPublisher, bindingId: "sales.policy.binding", policyReference: "sales.policy.execute", executor });
    executor.evaluate = () => ({ schemaVersion: 1, outcome: "deny" });
    const pluginCatalog = createCatalog({ extensions: [registeredPlatformContribution()], executables: [plugin] });
    await expect(pluginCatalog.execute(evaluation(), new AbortController().signal)).resolves.toMatchObject({ outcome: "allow" });
  });
});
