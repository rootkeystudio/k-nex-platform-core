import { describe, expect, it } from "vitest";
import type { PluginManifest } from "@k-nex/contracts";
import {
  assertExecutableRegistrationAuthority,
  assertPluginDestructiveOperationSafe,
  assertPluginUninstallSupported,
  createPluginLifecycleState,
  disablePlugin,
  executeRegistration,
  planPluginInstall,
  pluginReadyForEnable,
  reenablePlugin,
  reconcilePluginAvailability,
  scopePluginRegistration,
  scanPluginReferences,
  type RegistrationResult
} from "../src/index.js";
import type { InstalledPluginManifest, ResolvedPluginGraph } from "@k-nex/composition";
import type { PluginRegistration } from "../src/registration-runtime.js";

const integrity = `sha512-${"a".repeat(86)}==`;
const manifest = {
  apiVersion: 1, id: "module.sales", kind: "module", displayName: "Sales", version: "1.0.0", package: "@k-nex/module-sales",
  compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
  provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"],
  lifecycle: { ownsPayloadSchema: true, ownsPersistentData: true, disable: "supported", uninstall: "unsupported", purge: "supported" },
  contributions: { schema: { "sales.tasks.collection": "required" }, actions: { "sales.task.create": "required" }, pageTemplates: { "sales.page.tasks": "required" } }
} as const satisfies PluginManifest;

function state(overrides = {}) {
  return createPluginLifecycleState({
    pluginId: "module.sales", catalogStatus: "supported",
    package: { status: "installed", name: "@k-nex/module-sales", version: "1.0.0", integrity },
    enabled: true, configuration: { revision: 1, ready: true }, migration: { current: 6, required: 6, ready: true },
    dataState: "active", releaseStatus: "supported", ...overrides
  });
}

const empty = () => [];
const registration = {
  phases: [], inventory: [],
  contributions: {
    schema: [{ pluginId: "module.sales", id: "sales.tasks.collection", value: {} }],
    migrations: [], services: [], permissions: [], settings: [], sources: [],
    actions: [{ pluginId: "module.sales", id: "sales.task.create", value: {} }], tools: [], events: [],
    jobs: [{ pluginId: "module.sales", id: "sales.job.audit", value: () => "ran" }], realtimeTopics: [],
    components: [], blocks: [{ pluginId: "module.sales", id: "sales.block.tasks", value: {} }],
    routes: [{ pluginId: "module.sales", id: "sales.route.tasks", value: {} }], navigation: [], pageTemplates: [],
    localization: [], healthAudit: [], lifecycle: [{ pluginId: "module.sales", id: "sales.lifecycle.reference", value: {} }], testingMetadata: []
  },
  bindings: {
    sources: empty(),
    actions: [{ pluginId: "module.sales", id: "sales.task.create", value: () => "ran" }],
    components: empty(),
    blocks: [{ pluginId: "module.sales", id: "sales.block.tasks", value: () => "rendered" }]
  }
} as unknown as RegistrationResult;

function lifecycleManifest(input: {
  readonly id: string;
  readonly provides?: readonly { readonly capability: string; readonly version: string }[];
  readonly requires?: PluginManifest["requires"];
  readonly optional?: PluginManifest["optional"];
  readonly jobs?: boolean;
  readonly lifecycle?: boolean;
}): PluginManifest {
  const namespace = input.id.split(".")[1]!;
  return {
    apiVersion: 1, id: input.id, kind: input.provides ? "provider" : "module", displayName: input.id, version: "1.0.0",
    package: `@k-nex/${input.id.replace(".", "-")}`,
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: input.provides ?? [], requires: input.requires ?? [], optional: input.optional ?? [], conflicts: [], surfaces: ["workspace"],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "supported" },
    contributions: {
      ...(input.lifecycle === false ? {} : { lifecycle: { [`${namespace}.lifecycle`]: "required" } }),
      ...(input.jobs ? { jobs: { [`${namespace}.job`]: "required" } } : {})
    }
  };
}

function lifecycleState(manifestValue: PluginManifest, enabled = true, ready = true) {
  return createPluginLifecycleState({
    pluginId: manifestValue.id, catalogStatus: "supported",
    package: { status: "installed", name: manifestValue.package, version: manifestValue.version, integrity },
    enabled, configuration: { revision: 1, ready }, migration: { current: ready ? 1 : 0, required: 1, ready },
    dataState: enabled ? "active" : "retained", releaseStatus: "supported"
  });
}

function lifecyclePlan(
  manifestValue: PluginManifest,
  options: {
    readonly provideCapability?: string;
    readonly capability?: string;
    readonly service?: unknown;
    readonly capture?: (service: {
      readonly now: () => string;
      readonly derived: () => { readonly now: () => string };
      readonly callable: () => () => string;
    }) => void;
    readonly captureService?: (service: unknown) => void;
    readonly jobs?: boolean;
    readonly lifecycle?: boolean;
  } = {}
): PluginRegistration {
  const namespace = manifestValue.id.split(".")[1]!;
  return {
    pluginId: manifestValue.id,
    providers: options.provideCapability === undefined ? undefined : (context) => context.provide(options.provideCapability!, options.service),
    behavior(context) {
      if (options.capture && options.capability) options.capture(context.services.get(options.capability));
      if (options.captureService && options.capability) options.captureService(context.services.get(options.capability));
      if (options.lifecycle !== false) {
        context.register("lifecycle", `${namespace}.lifecycle`, {
          id: `${namespace}.lifecycle`, version: 1, ownerPluginId: manifestValue.id,
          disable: "supported", reenable: "supported", purge: "supported"
        });
      }
    },
    jobs: options.jobs ? (context) => {
      context.register("jobs", `${namespace}.job`, {
        id: `${namespace}.job`, version: 1, ownerPluginId: manifestValue.id, timeoutMs: 1_000, maxConcurrency: 1, idempotent: true
      });
      context.bind(`${namespace}.job`, () => undefined);
    } : undefined
  };
}

function executeLifecycleRegistration(
  manifests: readonly PluginManifest[],
  registrations: readonly PluginRegistration[],
  graph: ResolvedPluginGraph
): RegistrationResult {
  const installed: readonly InstalledPluginManifest[] = manifests.map((entry) => ({
    package: { name: entry.package, version: entry.version, integrity: `sha512-${entry.id}` }, manifest: entry
  }));
  return executeRegistration({ graph, installed, registrations });
}

describe("plugin lifecycle", () => {
  it("rejects every registration until authoritative lifecycle scoping", () => {
    const raw = { ...registration, contributions: { ...registration.contributions, lifecycle: [] } } as unknown as RegistrationResult;
    expect(() => assertExecutableRegistrationAuthority(raw)).toThrow(/authoritative lifecycle scoping/);
    expect(() => assertExecutableRegistrationAuthority(scopePluginRegistration(raw, []))).not.toThrow();
    const forged = { ...registration, requiredProviders: { "module.sales": ["provider.forged"] } } as unknown as RegistrationResult;
    const availability = reconcilePluginAvailability(registration, state());
    expect(scopePluginRegistration(forged, [availability]).contributions.actions).toHaveLength(1);
  });

  it("plans source-controlled install and idempotent customer-owned template seeding", () => {
    const first = planPluginInstall({ manifest, package: { name: manifest.package, version: manifest.version, integrity } });
    expect(first).toEqual({ operation: "install", packageChange: { name: manifest.package, version: manifest.version, integrity }, requiresDeployment: true, seedTemplateIds: ["sales.page.tasks"] });
    expect(planPluginInstall({ manifest, package: { name: manifest.package, version: manifest.version, integrity }, state: state(), existingTemplateIds: ["sales.page.tasks"] })).toMatchObject({ operation: "noop", packageChange: null, seedTemplateIds: [] });
  });

  it("disables behavior while retaining schema and restores it only when ready", () => {
    const disabled = disablePlugin(state(), manifest);
    expect(disabled).toMatchObject({ enabled: false, dataState: "retained" });
    const availability = reconcilePluginAvailability(registration, disabled);
    expect(availability.isAvailable("schema", "sales.tasks.collection")).toBe(true);
    expect(availability.isAvailable("actions", "sales.task.create")).toBe(false);
    const scoped = scopePluginRegistration(registration, [availability]);
    expect(() => scopePluginRegistration(registration, [{ ...availability }])).toThrow(/not authoritative/);
    expect(scoped.contributions.schema).toHaveLength(1);
    expect(scoped.contributions.actions).toEqual([]);
    expect(scoped.contributions.jobs).toEqual([]);
    expect(scoped.contributions.routes).toEqual([]);
    expect(scoped.bindings.actions).toEqual([]);
    expect(scoped.bindings.blocks).toEqual([]);
    expect(() => scopePluginRegistration(registration, [])).toThrow(/requires lifecycle availability/);
    expect(reenablePlugin(disabled, manifest)).toMatchObject({ enabled: true, dataState: "active" });
    const stale = createPluginLifecycleState({ ...disabled, migration: { current: 5, required: 6, ready: false } });
    expect(pluginReadyForEnable(stale)).toBe(false);
    expect(() => reenablePlugin(stale, manifest)).toThrow(/not ready/);
  });

  it("revokes required consumers and captured capability services when a provider becomes unavailable", () => {
    const provider = lifecycleManifest({ id: "provider.clock", provides: [{ capability: "clock.now", version: "1.0.0" }] });
    const consumer = lifecycleManifest({ id: "module.consumer", requires: [{ capability: "clock.now", version: "^1.0.0" }], jobs: true });
    const graph: ResolvedPluginGraph = {
      resolverVersion: "1.0.0",
      plugins: [
        { id: provider.id, kind: provider.kind, package: provider.package, version: provider.version, integrity: "sha512-provider.clock", required: [], optional: [] },
        { id: consumer.id, kind: consumer.kind, package: consumer.package, version: consumer.version, integrity: "sha512-module.consumer", required: [provider.id], optional: [] }
      ],
      capabilityProviders: [{ capability: "clock.now", plugin: provider.id, version: "1.0.0" }],
      registrationOrder: [provider.id, consumer.id]
    };
    let captured: { readonly now: () => string } | undefined;
    let capturedNow: (() => string) | undefined;
    let capturedDerived: { readonly now: () => string } | undefined;
    let capturedReturned: (() => string) | undefined;
    const registrationResult = executeLifecycleRegistration(
      [provider, consumer],
      [
        lifecyclePlan(provider, {
          provideCapability: "clock.now",
          service: { now: () => "now", derived: () => ({ now: () => "derived" }), callable: () => () => "returned" }
        }),
        lifecyclePlan(consumer, { capability: "clock.now", capture: (service) => {
          captured = service;
          capturedNow = service.now;
          capturedDerived = service.derived();
          capturedReturned = service.callable();
        }, jobs: true })
      ],
      graph
    );
    const enabled = scopePluginRegistration(registrationResult, [
      reconcilePluginAvailability(registrationResult, lifecycleState(provider)),
      reconcilePluginAvailability(registrationResult, lifecycleState(consumer))
    ]);
    expect(enabled.contributions.jobs).toHaveLength(1);
    expect(enabled.bindings.jobs).toHaveLength(1);
    expect(captured?.now()).toBe("now");
    expect(capturedNow?.()).toBe("now");
    expect(capturedDerived?.now()).toBe("derived");
    expect(capturedReturned?.()).toBe("returned");

    const disabled = scopePluginRegistration(registrationResult, [
      reconcilePluginAvailability(registrationResult, lifecycleState(provider, false)),
      reconcilePluginAvailability(registrationResult, lifecycleState(consumer))
    ]);
    expect(disabled.contributions.jobs).toEqual([]);
    expect(disabled.bindings.jobs).toEqual([]);
    expect(disabled.contributions.lifecycle.filter(({ pluginId }) => pluginId === consumer.id)).toEqual([]);
    expect(disabled.inventory.find(({ id }) => id === consumer.id)?.contributions).toEqual({});
    expect(() => captured?.now()).toThrow(/Capability service is unavailable/);
    expect(() => capturedNow?.()).toThrow(/Capability service is unavailable/);
    expect(() => capturedDerived?.now()).toThrow(/Capability service is unavailable/);
    expect(() => capturedReturned?.()).toThrow(/Capability service is unavailable/);

    const notReady = scopePluginRegistration(registrationResult, [
      reconcilePluginAvailability(registrationResult, lifecycleState(provider, true, false)),
      reconcilePluginAvailability(registrationResult, lifecycleState(consumer))
    ]);
    expect(notReady.contributions.jobs).toEqual([]);

    const reenabled = scopePluginRegistration(registrationResult, [
      reconcilePluginAvailability(registrationResult, lifecycleState(provider)),
      reconcilePluginAvailability(registrationResult, lifecycleState(consumer))
    ]);
    expect(reenabled.contributions.jobs).toHaveLength(1);
    expect(capturedNow?.()).toBe("now");
  });

  for (const lifecycle of [true, false]) {
    it(`leases async capability results through ${lifecycle ? "lifecycle" : "non-lifecycle"} providers`, async () => {
      const provider = lifecycleManifest({
        id: "provider.clock", provides: [{ capability: "clock.now", version: "1.0.0" }], lifecycle
      });
      const consumer = lifecycleManifest({
        id: "module.consumer", requires: [{ capability: "clock.now", version: "^1.0.0" }], lifecycle
      });
      const graph: ResolvedPluginGraph = {
        resolverVersion: "1.0.0",
        plugins: [
          { id: provider.id, kind: provider.kind, package: provider.package, version: provider.version, integrity: "sha512-provider.clock", required: [], optional: [] },
          { id: consumer.id, kind: consumer.kind, package: consumer.package, version: consumer.version, integrity: "sha512-module.consumer", required: [provider.id], optional: [] }
        ],
        capabilityProviders: [{ capability: "clock.now", plugin: provider.id, version: "1.0.0" }],
        registrationOrder: [provider.id, consumer.id]
      };
      let releaseDelayed!: () => void;
      const delayed = new Promise<void>((resolve) => { releaseDelayed = resolve; });
      let service: {
        readonly derived: () => Promise<{ readonly ping: () => string }>;
        readonly delayed: () => Promise<{ readonly ping: () => string }>;
      } | undefined;
      const registrationResult = executeLifecycleRegistration(
        [provider, consumer],
        [
          lifecyclePlan(provider, {
            provideCapability: "clock.now",
            service: {
              async derived() { return { ping: () => "still-ran" }; },
              delayed() {
                return { then: (resolve: (value: { readonly ping: () => string }) => void) => {
                  void delayed.then(() => resolve({ ping: () => "still-ran" }));
                } };
              }
            },
            lifecycle
          }),
          lifecyclePlan(consumer, { capability: "clock.now", captureService: (value) => { service = value as typeof service; }, lifecycle })
        ],
        graph
      );
      const available = () => [
        reconcilePluginAvailability(registrationResult, lifecycleState(provider)),
        reconcilePluginAvailability(registrationResult, lifecycleState(consumer))
      ];
      scopePluginRegistration(registrationResult, available());

      const promise = service!.derived();
      expect(promise).toBeInstanceOf(Promise);
      const derived = await promise;
      expect(derived.ping()).toBe("still-ran");

      scopePluginRegistration(registrationResult, [
        reconcilePluginAvailability(registrationResult, lifecycleState(provider, false)),
        reconcilePluginAvailability(registrationResult, lifecycleState(consumer))
      ]);
      expect(() => derived.ping()).toThrow(/Capability service is unavailable/);

      scopePluginRegistration(registrationResult, available());
      const pending = service!.delayed();
      scopePluginRegistration(registrationResult, [
        reconcilePluginAvailability(registrationResult, lifecycleState(provider, false)),
        reconcilePluginAvailability(registrationResult, lifecycleState(consumer))
      ]);
      releaseDelayed();
      await expect(pending).rejects.toThrow(/Capability service is unavailable/);
    });
  }

  it("scopes required graph participants without lifecycle contributions and preserves unrelated registrations", () => {
    const provider = lifecycleManifest({
      id: "provider.clock", provides: [{ capability: "clock.now", version: "1.0.0" }], lifecycle: false
    });
    const consumer = lifecycleManifest({
      id: "module.consumer", requires: [{ capability: "clock.now", version: "^1.0.0" }], jobs: true, lifecycle: false
    });
    const independent = lifecycleManifest({ id: "module.independent", jobs: true, lifecycle: false });
    const manifests = [provider, consumer, independent] as const;
    const graph: ResolvedPluginGraph = {
      resolverVersion: "1.0.0",
      plugins: [
        { id: provider.id, kind: provider.kind, package: provider.package, version: provider.version, integrity: "sha512-provider.clock", required: [], optional: [] },
        { id: consumer.id, kind: consumer.kind, package: consumer.package, version: consumer.version, integrity: "sha512-module.consumer", required: [provider.id], optional: [] },
        { id: independent.id, kind: independent.kind, package: independent.package, version: independent.version, integrity: "sha512-module.independent", required: [], optional: [] }
      ],
      capabilityProviders: [{ capability: "clock.now", plugin: provider.id, version: "1.0.0" }],
      registrationOrder: manifests.map(({ id }) => id)
    };
    let capturedNow: (() => string) | undefined;
    const registrationResult = executeLifecycleRegistration(
      manifests,
      [
        lifecyclePlan(provider, { provideCapability: "clock.now", service: { now: () => "now" }, lifecycle: false }),
        lifecyclePlan(consumer, { capability: "clock.now", capture: (service) => { capturedNow = service.now; }, jobs: true, lifecycle: false }),
        lifecyclePlan(independent, { jobs: true, lifecycle: false })
      ],
      graph
    );
    const providerAvailability = reconcilePluginAvailability(registrationResult, lifecycleState(provider));
    const consumerAvailability = reconcilePluginAvailability(registrationResult, lifecycleState(consumer));

    expect(() => scopePluginRegistration(registrationResult, [consumerAvailability])).toThrow(/requires lifecycle availability/);
    const enabled = scopePluginRegistration(registrationResult, [providerAvailability, consumerAvailability]);
    expect(enabled.contributions.jobs.map(({ pluginId }) => pluginId)).toEqual([consumer.id, independent.id]);
    expect(capturedNow?.()).toBe("now");

    const disabled = scopePluginRegistration(registrationResult, [
      reconcilePluginAvailability(registrationResult, lifecycleState(provider, false)),
      consumerAvailability
    ]);
    expect(disabled.contributions.jobs.map(({ pluginId }) => pluginId)).toEqual([independent.id]);
    expect(disabled.bindings.jobs.map(({ pluginId }) => pluginId)).toEqual([independent.id]);
    expect(disabled.inventory.find(({ id }) => id === consumer.id)?.contributions).toEqual({});
    expect(() => capturedNow?.()).toThrow(/Capability service is unavailable/);

    const notReady = scopePluginRegistration(registrationResult, [
      reconcilePluginAvailability(registrationResult, lifecycleState(provider, true, false)),
      consumerAvailability
    ]);
    expect(notReady.contributions.jobs.map(({ pluginId }) => pluginId)).toEqual([independent.id]);
    expect(() => capturedNow?.()).toThrow(/Capability service is unavailable/);
  });

  it("propagates required dependency revocation transitively without revoking optional consumers", () => {
    const provider = lifecycleManifest({ id: "provider.clock" });
    const middle = lifecycleManifest({ id: "module.middle", requires: [{ plugin: provider.id, version: "^1.0.0" }], jobs: true });
    const requiredConsumer = lifecycleManifest({ id: "module.required", requires: [{ plugin: middle.id, version: "^1.0.0" }], jobs: true });
    const optionalConsumer = lifecycleManifest({ id: "module.optional", optional: [{ plugin: provider.id, version: "^1.0.0" }], jobs: true });
    const manifests = [provider, middle, requiredConsumer, optionalConsumer] as const;
    const graph: ResolvedPluginGraph = {
      resolverVersion: "1.0.0",
      plugins: [
        { id: provider.id, kind: provider.kind, package: provider.package, version: provider.version, integrity: "sha512-provider.clock", required: [], optional: [] },
        { id: middle.id, kind: middle.kind, package: middle.package, version: middle.version, integrity: "sha512-module.middle", required: [provider.id], optional: [] },
        { id: requiredConsumer.id, kind: requiredConsumer.kind, package: requiredConsumer.package, version: requiredConsumer.version, integrity: "sha512-module.required", required: [middle.id], optional: [] },
        { id: optionalConsumer.id, kind: optionalConsumer.kind, package: optionalConsumer.package, version: optionalConsumer.version, integrity: "sha512-module.optional", required: [], optional: [provider.id] }
      ], capabilityProviders: [], registrationOrder: manifests.map(({ id }) => id)
    };
    const registrationResult = executeLifecycleRegistration(manifests, manifests.map((entry) => lifecyclePlan(entry, { jobs: entry.id !== provider.id })), graph);
    const scoped = scopePluginRegistration(registrationResult, manifests.map((entry) =>
      reconcilePluginAvailability(registrationResult, lifecycleState(entry, entry.id !== provider.id))
    ));
    expect(scoped.contributions.jobs.map(({ pluginId }) => pluginId)).toEqual([optionalConsumer.id]);
    expect(scoped.bindings.jobs.map(({ pluginId }) => pluginId)).toEqual([optionalConsumer.id]);
  });

  it("scans references deterministically and refuses unsafe destructive lifecycle", () => {
    const references = [
      { kind: "document", id: "page.sales", pluginId: "module.sales" },
      { kind: "dependency", id: "module.consumer", pluginId: "module.sales" },
      { kind: "document", id: "page.sales", pluginId: "module.sales" }
    ] as const;
    expect(scanPluginReferences("module.sales", references).map(({ id }) => id)).toEqual(["module.consumer", "page.sales"]);
    expect(() => assertPluginDestructiveOperationSafe(manifest, references)).toThrow(/2 active reference/);
    expect(() => assertPluginDestructiveOperationSafe(manifest, [])).not.toThrow();
    expect(() => assertPluginUninstallSupported(manifest)).toThrow(/does not support uninstall/);
  });
});
