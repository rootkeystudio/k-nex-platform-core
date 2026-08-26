import type { AgentToolDescriptor, DataSourceDefinition, PluginManifest } from "@k-nex/contracts";
import { DataSourceDescriptorSchema, registrationPhases } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import type { InstalledPluginManifest, ResolvedPluginGraph } from "@k-nex/composition";
import {
  executeRegistration,
  RegistrationError,
  type DataSourceHandler,
  type PluginRegistration,
  type SingleKindRegistrationContext
} from "../src/registration-runtime.js";
import type { ActionDefinition, ActionHandler } from "../src/action.js";

const compatibility = {
  core: ">=1.0.0 <2.0.0",
  payload: ">=3.0.0 <4.0.0",
  node: ">=24.0.0 <25.0.0",
  payloadDatabaseAdapters: ["postgres" as const]
};

function dataSourceDefinition(id: string, ownerPluginId = "module.consumer"): DataSourceDefinition {
  return {
    descriptor: {
      id,
      version: 1,
      ownerPluginId,
      primaryContract: { id: "metric.scalar", version: 1 },
      sourceSchema: { id: `${id}.schema`, version: 1 },
      audience: "authenticated",
      surfaces: ["workspace"],
      permission: "consumer.read",
      structuralCompatibilityHash: `sha256:${"0".repeat(64)}`,
      presentationMetadataRevision: 1,
      title: "Consumer source",
      inputFields: [],
      limits: {
        maxSelectedFields: 1,
        maxPageSize: 100,
        maxFilters: 0,
        maxSorts: 0,
        maxBodyBytes: 1024,
        maxResultBytes: 1024,
        maxDepth: 1,
        timeoutMs: 1000,
        maxConcurrency: 1,
        ratePerMinute: 1,
        burst: 1,
        costClass: "low",
        maxCost: 1
      },
      cacheClass: "actor"
    },
    inputSchema: DataSourceDescriptorSchema,
    outputSchema: DataSourceDescriptorSchema
  };
}

function actionDefinition(id = "consumer.action", ownerPluginId = "module.consumer"): ActionDefinition {
  return {
    descriptor: {
      id,
      version: 1,
      ownerPluginId,
      inputSchema: {
        type: "object",
        properties: { value: { type: "string", maxLength: 128 } },
        required: ["value"],
        additionalProperties: false
      },
      outputSchema: {
        type: "object",
        properties: { accepted: { type: "boolean" } },
        required: ["accepted"],
        additionalProperties: false
      },
      permission: "consumer.write",
      policy: "consumer.domain",
      effect: "write",
      idempotency: "required",
      dryRun: false
    },
    inputSchema: { safeParse: (value) => ({ success: true, data: value }) },
    outputSchema: { safeParse: (value) => ({ success: true, data: value }) }
  };
}

function actionTool(inputSchema = actionDefinition().descriptor.inputSchema): AgentToolDescriptor {
  const action = actionDefinition().descriptor;
  return {
    id: "consumer.tools.action",
    version: 1,
    ownerPluginId: "module.consumer",
    title: "Consumer action",
    description: "Runs the registered consumer action.",
    inputSchema,
    outputSchema: action.outputSchema,
    invocation: { kind: "action", action: { id: action.id, version: action.version } },
    audience: "authenticated",
    surfaces: ["workspace"],
    permission: action.permission,
    policy: action.policy,
    effect: "write",
    risk: "medium",
    approval: "per-call",
    idempotency: "required",
    dryRun: false,
    limits: {
      timeoutMs: 1000,
      maxConcurrency: 1,
      ratePerMinute: 10,
      burst: 2,
      costClass: "low",
      maxCost: 1
    },
    redaction: { inputPaths: [], outputPaths: [] },
    audit: { category: "consumer.action" }
  };
}

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

function completeConsumer(
  onBehavior?: (services: { get<T = unknown>(capability: string): T }) => void,
  sourceDefinition: DataSourceDefinition = dataSourceDefinition("consumer.source"),
  sourceHandler: DataSourceHandler = () => undefined,
  actionHandler: ActionHandler = () => ({ accepted: true })
): PluginRegistration {
  return {
    pluginId: "module.consumer",
    contracts(context) {
      context.register("contracts", "consumer.contract", {});
      context.register("dataSources", "consumer.source", sourceDefinition);
      context.register("actions", "consumer.action", actionDefinition());
      context.register("blocks", "consumer.block", {});
    },
    schema: (context) => context.register("consumer.schema", { slug: "consumer" }),
    behavior(context) {
      onBehavior?.(context.services);
      context.register("consumer.behavior", () => undefined);
    },
    jobs: (context) => context.register("consumer.job", () => undefined),
    dataHandlers(context) {
      context.bind("dataSources", "consumer.source", sourceHandler);
      context.bind("actions", "consumer.action", actionHandler);
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

  it("accepts a valid data-source definition and server handler binding", () => {
    const definition = dataSourceDefinition("consumer.source");
    const handler: DataSourceHandler = ({ input, selectedFields, signal }) => ({ input, selectedFields, signal });
    const result = run([providerRegistration(), completeConsumer(undefined, definition, handler)]);

    expect(result.contributions.dataSources).toEqual([{ pluginId: "module.consumer", id: "consumer.source", value: definition }]);
    expect(result.bindings.dataSources).toEqual([{ pluginId: "module.consumer", id: "consumer.source", value: handler }]);
  });

  it("rejects invalid data-source definitions", () => {
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        context.register("dataSources", "consumer.source", {} as never);
      }
    }]), "INVALID_CONTRIBUTION");
  });

  it("rejects data-source descriptor IDs that differ from contribution IDs", () => {
    expectCode(() => run([providerRegistration(), completeConsumer(undefined, dataSourceDefinition("consumer.other"))]), "INVALID_CONTRIBUTION");
  });

  it("rejects data-source descriptors owned by another plugin", () => {
    expectCode(() => run([providerRegistration(), completeConsumer(undefined, dataSourceDefinition("consumer.source", "provider.storage"))]), "INVALID_CONTRIBUTION");
  });

  it("rejects non-function data-source bindings", () => {
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      dataHandlers(context) {
        context.bind("dataSources", "consumer.source", {} as never);
      }
    }]), "INVALID_CONTRIBUTION");
  });

  it("requires a trusted server action handler binding", () => {
    const action: ActionHandler = () => ({ accepted: true });
    const result = run([providerRegistration(), completeConsumer(undefined, dataSourceDefinition("consumer.source"), undefined, action)]);

    expect(result.bindings.actions).toEqual([{ pluginId: "module.consumer", id: "consumer.action", value: action }]);
    expectCode(() => run([providerRegistration(), completeConsumer(
      undefined,
      dataSourceDefinition("consumer.source"),
      undefined,
      {} as ActionHandler
    )]), "INVALID_CONTRIBUTION");
  });

  it("rejects invalid action definitions and mismatched descriptor ownership", () => {
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        context.register("actions", "consumer.action", {} as ActionDefinition);
      }
    }]), "INVALID_CONTRIBUTION");
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        context.register("actions", "consumer.action", actionDefinition("consumer.action", "provider.storage"));
      }
    }]), "INVALID_CONTRIBUTION");
  });

  it("requires exact schema-compatible action tool bindings", () => {
    const manifest = consumerManifest({
      contributions: { ...consumerManifest().contributions, tools: ["consumer.tools.action"] }
    });
    const plan = (tool: AgentToolDescriptor): PluginRegistration => {
      const consumer = completeConsumer();
      return {
        ...consumer,
        contracts(context) {
          consumer.contracts?.(context);
          context.register("tools", tool.id, tool);
        }
      };
    };
    expect(() => run([providerRegistration(), plan(actionTool())], [providerManifest(), manifest])).not.toThrow();
    const incompatible = actionTool({
      type: "object",
      properties: { different: { type: "string" } },
      required: ["different"],
      additionalProperties: false
    });
    expectCode(
      () => run([providerRegistration(), plan(incompatible)], [providerManifest(), manifest]),
      "INVENTORY_MISMATCH"
    );
    expectCode(
      () => run([providerRegistration(), plan({ ...actionTool(), permission: "consumer.understated" })], [providerManifest(), manifest]),
      "INVENTORY_MISMATCH"
    );
    expectCode(
      () => run([providerRegistration(), plan({ ...actionTool(), policy: "consumer.understated" })], [providerManifest(), manifest]),
      "INVENTORY_MISMATCH"
    );
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

  it("rejects access for an optional capability without a compatible resolved grant", () => {
    const manifest = consumerManifest({
      requires: [],
      optional: [{ capability: "storage.records", version: "^2.0.0" }]
    });
    const baseGraph = graph();
    const resolvedGraph = {
      ...baseGraph,
      plugins: baseGraph.plugins.map((node) => node.id === "module.consumer"
        ? { ...node, required: [], optional: [] }
        : node)
    };

    expectCode(() => run([
      providerRegistration(),
      completeConsumer((services) => services.get("storage.records"))
    ], [providerManifest(), manifest], resolvedGraph), "CAPABILITY_UNAVAILABLE");
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
