import type { PluginManifest } from "@k-nex/contracts";
import { registrationPhases } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import type { ResolvedPluginGraph } from "../src/deterministic-resolver.js";
import type { InstalledPluginManifest } from "../src/installed-plugin-loader.js";
import {
  executeRegistration,
  RegistrationError,
  type PluginRegistration,
  type SingleKindRegistrationContext
} from "../src/registration-runtime.js";

const compatibility = {
  core: ">=1.0.0 <2.0.0",
  payload: ">=3.0.0 <4.0.0",
  node: ">=24.0.0 <25.0.0",
  payloadDatabaseAdapters: ["postgres" as const]
};

function providerManifest(contributions: PluginManifest["contributions"] = undefined): PluginManifest {
  return {
    apiVersion: 1,
    id: "provider.storage",
    kind: "provider",
    displayName: "Storage",
    version: "1.0.0",
    package: "@k-nex/provider-storage",
    compatibility,
    provides: [{ capability: "storage.records", version: "1.0.0" }],
    requires: [],
    optional: [],
    conflicts: [],
    lifecycle: {
      ownsPayloadSchema: false,
      ownsPersistentData: false,
      disable: "supported",
      uninstall: "supported",
      purge: "supported"
    },
    ...(contributions === undefined ? {} : { contributions })
  };
}

function consumerManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    apiVersion: 1,
    id: "module.consumer",
    kind: "module",
    displayName: "Consumer",
    version: "1.0.0",
    package: "@k-nex/module-consumer",
    compatibility,
    provides: [],
    requires: [{ capability: "storage.records", version: "^1.0.0" }],
    optional: [],
    conflicts: [],
    lifecycle: {
      ownsPayloadSchema: true,
      ownsPersistentData: true,
      disable: "supported",
      uninstall: "unsupported",
      purge: "supported"
    },
    contributions: {
      contracts: ["consumer.contract"],
      schema: ["consumer.schema"],
      behavior: ["consumer.behavior"],
      jobs: ["consumer.job"],
      dataSources: ["consumer.source"],
      actions: ["consumer.action"],
      blocks: ["consumer.block"],
      navigation: ["consumer.navigation"],
      admin: ["consumer.admin"]
    },
    ...overrides
  };
}

function installed(manifests: readonly PluginManifest[]): readonly InstalledPluginManifest[] {
  return manifests.map((manifest) => ({
    package: {
      name: manifest.package,
      version: manifest.version,
      integrity: manifest.id === "provider.storage" ? "sha512-provider" : "sha512-consumer"
    },
    manifest
  }));
}

function graph(): ResolvedPluginGraph {
  return {
    resolverVersion: "1.0.0",
    plugins: [
      {
        id: "module.consumer",
        kind: "module",
        package: "@k-nex/module-consumer",
        version: "1.0.0",
        integrity: "sha512-consumer",
        required: ["provider.storage"],
        optional: []
      },
      {
        id: "provider.storage",
        kind: "provider",
        package: "@k-nex/provider-storage",
        version: "1.0.0",
        integrity: "sha512-provider",
        required: [],
        optional: []
      }
    ],
    capabilityProviders: [{ capability: "storage.records", plugin: "provider.storage", version: "1.0.0" }],
    registrationOrder: ["provider.storage", "module.consumer"]
  };
}

function completeConsumer(onBehavior?: (services: { get<T = unknown>(capability: string): T }) => void): PluginRegistration {
  return {
    pluginId: "module.consumer",
    contracts(context) {
      context.register("contracts", "consumer.contract", {});
      context.register("dataSources", "consumer.source", {});
      context.register("actions", "consumer.action", {});
      context.register("blocks", "consumer.block", {});
    },
    schema: (context) => context.register("consumer.schema", { slug: "consumer" }),
    behavior(context) {
      onBehavior?.(context.services);
      context.register("consumer.behavior", () => undefined);
    },
    jobs: (context) => context.register("consumer.job", () => undefined),
    dataHandlers(context) {
      context.bind("dataSources", "consumer.source", () => undefined);
      context.bind("actions", "consumer.action", () => undefined);
    },
    ui(context) {
      context.bindBlock("consumer.block", {});
      context.registerNavigation("consumer.navigation", {});
    },
    admin: (context) => context.register("consumer.admin", {})
  };
}

function providerRegistration(capability = "storage.records"): PluginRegistration {
  return {
    pluginId: "provider.storage",
    providers: (context) => context.provide(capability, { driver: "postgres" })
  };
}

function run(
  registrations: readonly PluginRegistration[],
  manifests: readonly PluginManifest[] = [providerManifest(), consumerManifest()],
  resolvedGraph: ResolvedPluginGraph = graph()
) {
  return executeRegistration({ graph: resolvedGraph, installed: installed(manifests), registrations });
}

function expectCode(action: () => unknown, code: RegistrationError["code"]): void {
  try {
    action();
    throw new Error("Expected registration to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(RegistrationError);
    expect((error as RegistrationError).code).toBe(code);
  }
}

describe("phased registration runtime", () => {
  it("runs phase-major in canonical order and dependency-first plugin order", () => {
    const trace: string[] = [];
    const hookPlan = (pluginId: string): PluginRegistration => ({
      pluginId,
      contracts: () => trace.push(`contracts:${pluginId}`),
      providers: () => trace.push(`providers:${pluginId}`),
      schema: () => trace.push(`schema:${pluginId}`),
      behavior: () => trace.push(`behavior:${pluginId}`),
      jobs: () => trace.push(`jobs:${pluginId}`),
      dataHandlers: () => trace.push(`data-handlers:${pluginId}`),
      ui: () => trace.push(`ui:${pluginId}`),
      admin: () => trace.push(`admin:${pluginId}`)
    });
    const noContributions = consumerManifest({ requires: [], contributions: undefined });
    const noProviderSelection = { ...graph(), capabilityProviders: [] };

    run(
      [hookPlan("module.consumer"), hookPlan("provider.storage")],
      [providerManifest(), noContributions],
      noProviderSelection
    );

    expect(trace).toEqual([
      "contracts:provider.storage", "contracts:module.consumer",
      "providers:provider.storage", "providers:module.consumer",
      "schema:provider.storage", "schema:module.consumer",
      "behavior:provider.storage", "behavior:module.consumer",
      "jobs:provider.storage", "jobs:module.consumer",
      "data-handlers:provider.storage", "data-handlers:module.consumer",
      "ui:provider.storage", "ui:module.consumer",
      "admin:provider.storage", "admin:module.consumer"
    ]);
  });

  it("executes every canonical phase, exposes scoped services, reconciles inventory, and freezes output", () => {
    let service: unknown;
    let serviceKeys: readonly string[] = [];
    const result = run([providerRegistration(), completeConsumer((services) => {
      serviceKeys = Object.keys(services);
      service = services.get("storage.records");
    })]);

    expect(result.phases).toEqual(registrationPhases);
    expect(service).toEqual({ driver: "postgres" });
    expect(serviceKeys).toEqual(["get"]);
    expect(result.inventory).toEqual([
      {
        id: "module.consumer",
        contributions: {
          contracts: ["consumer.contract"],
          schema: ["consumer.schema"],
          behavior: ["consumer.behavior"],
          jobs: ["consumer.job"],
          dataSources: ["consumer.source"],
          actions: ["consumer.action"],
          blocks: ["consumer.block"],
          navigation: ["consumer.navigation"],
          admin: ["consumer.admin"]
        },
        capabilityAccess: ["storage.records"]
      },
      { id: "provider.storage", contributions: {}, capabilityAccess: [] }
    ]);
    expect(result.contributions.schema[0]).toMatchObject({ pluginId: "module.consumer", id: "consumer.schema" });
    expect(result.bindings).toMatchObject({
      dataSources: [{ pluginId: "module.consumer", id: "consumer.source" }],
      actions: [{ pluginId: "module.consumer", id: "consumer.action" }],
      blocks: [{ pluginId: "module.consumer", id: "consumer.block" }]
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.inventory)).toBe(true);
  });

  it("rejects registration through an API retained from the wrong phase", () => {
    let contracts: Parameters<NonNullable<PluginRegistration["contracts"]>>[0] | undefined;
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        contracts = context;
        consumer.contracts?.(context);
      },
      behavior(context) {
        contracts?.register("contracts", "consumer.contract", {});
        consumer.behavior?.(context);
      }
    }]), "WRONG_PHASE");
  });

  it("rejects undeclared contributions immediately", () => {
    expectCode(() => run([providerRegistration(), {
      ...completeConsumer(),
      schema: (context) => context.register("consumer.not-declared", {})
    }]), "UNDECLARED_CONTRIBUTION");
  });

  it("snapshots declarations before hooks can mutate their source objects", () => {
    const manifest = consumerManifest();
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        manifest.contributions?.schema?.push("consumer.injected");
        consumer.contracts?.(context);
      },
      schema(context) {
        consumer.schema?.(context);
        context.register("consumer.injected", {});
      }
    }], [providerManifest(), manifest]), "UNDECLARED_CONTRIBUTION");
  });

  it("rejects capability access not declared by the plugin", () => {
    const manifest = consumerManifest({ requires: [] });
    expectCode(() => run([
      providerRegistration(),
      completeConsumer((services) => services.get("storage.records"))
    ], [providerManifest(), manifest]), "UNDECLARED_CAPABILITY_ACCESS");
  });

  it("rejects duplicate contribution IDs across plugins", () => {
    const provider = providerManifest({ schema: ["consumer.schema"] });
    expectCode(() => run([
      { ...providerRegistration(), schema: (context) => context.register("consumer.schema", {}) },
      completeConsumer()
    ], [provider, consumerManifest()]), "DUPLICATE_CONTRIBUTION");
  });

  it("rejects late registration after freeze", () => {
    let schema: SingleKindRegistrationContext | undefined;
    const consumer = completeConsumer();
    run([providerRegistration(), {
      ...consumer,
      schema(context) {
        schema = context;
        consumer.schema?.(context);
      }
    }]);
    expectCode(() => schema?.register("consumer.schema", {}), "FROZEN");
  });

  it("rejects manifest and actual inventory mismatch", () => {
    expectCode(() => run([providerRegistration(), { ...completeConsumer(), jobs: undefined }]), "INVENTORY_MISMATCH");
  });

  it("requires declared descriptors to have their executable bindings", () => {
    expectCode(() => run([providerRegistration(), { ...completeConsumer(), dataHandlers: undefined }]), "INVENTORY_MISMATCH");
  });

  it("allows only the resolved provider to bind a capability", () => {
    expectCode(() => run([providerRegistration("storage.other"), completeConsumer()]), "PROVIDER_MISMATCH");
  });

  it("rejects graph identity and registration-plan drift", () => {
    const changed = graph();
    changed.plugins[0]!.integrity = "sha512-wrong";
    expectCode(() => run([providerRegistration(), completeConsumer()], undefined, changed), "GRAPH_MISMATCH");
    expectCode(() => run([providerRegistration(), completeConsumer(), completeConsumer()]), "GRAPH_MISMATCH");
  });

  it("rejects duplicate or manifest-inconsistent capability selections", () => {
    const duplicate = graph();
    duplicate.capabilityProviders = [...duplicate.capabilityProviders, ...duplicate.capabilityProviders];
    expectCode(() => run([providerRegistration(), completeConsumer()], undefined, duplicate), "GRAPH_MISMATCH");

    const wrongVersion = graph();
    wrongVersion.capabilityProviders = [{ capability: "storage.records", plugin: "provider.storage", version: "2.0.0" }];
    expectCode(() => run([providerRegistration(), completeConsumer()], undefined, wrongVersion), "GRAPH_MISMATCH");
  });
});
