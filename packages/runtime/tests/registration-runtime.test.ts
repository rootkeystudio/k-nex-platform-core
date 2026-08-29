import type { AgentToolDescriptor, DataSourceDefinition, PluginManifest } from "@k-nex/contracts";
import { DataSourceDescriptorSchema, registrationPhases } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import type { InstalledPlatformPluginManifest, ResolvedPlatformPluginGraph } from "@k-nex/composition";
import {
  definePluginRegistration,
  executeRegistration,
  RegistrationError,
  type DataSourceHandler,
  type PluginRegistration,
  type SchemaRegistrationContext
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
      permission: "consumer.permission",
      structuralCompatibilityHash: `sha256:${"0".repeat(64)}`,
      presentationMetadataRevision: 1,
      title: "Consumer source",
      inputFields: [],
      paginationModes: [],
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
      permission: "consumer.permission",
      policy: "consumer.domain",
      effect: "write",
      idempotency: "required",
      dryRun: false
    },
    inputSchema: { safeParse: (value) => ({ success: true, data: value }) },
    outputSchema: { safeParse: (value) => ({ success: true, data: value }) }
  };
}

function uiDescriptor(id: string, kind: "component" | "block") {
  return {
    id,
    version: 1,
    ownerPluginId: "module.consumer",
    kind,
    propsSchema: { type: "object" as const, properties: {}, required: [], additionalProperties: false },
    profiles: ["workspace" as const],
    surfaces: ["workspace" as const],
    audience: "authenticated" as const,
    permission: "consumer.permission",
    requiredStates: ["loading" as const, "empty" as const, "error" as const, "forbidden" as const]
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
      schema: { "consumer.schema": "required" },
      migrations: { "consumer.migration": "required" },
      services: { "consumer.service": "required" },
      permissions: { "consumer.permission": "required" },
      settings: { "consumer.setting": "required" },
      sources: { "consumer.source": "required" },
      actions: { "consumer.action": "required" },
      tools: { "consumer.tools.action": "required" },
      events: { "consumer.event": "required" },
      jobs: { "consumer.job": "required" },
      realtimeTopics: { "consumer.realtime": "required" },
      components: { "consumer.component": "required" },
      blocks: { "consumer.block": "required" },
      routes: { "consumer.route": "required" },
      navigation: { "consumer.navigation": "required" },
      pageTemplates: { "consumer.template": "required" },
      localization: { "consumer.localization": "required" },
      healthAudit: { "consumer.health": "required" },
      lifecycle: { "consumer.lifecycle": "required" },
      testingMetadata: { "consumer.testing": "required" }
    },
    ...overrides
  };
}

function installed(manifests: readonly PluginManifest[]): readonly InstalledPlatformPluginManifest[] {
  return manifests.map((manifest) => ({
    package: {
      name: manifest.package,
      version: manifest.version,
      integrity: manifest.id === "provider.storage" ? "sha512-provider" : "sha512-consumer"
    },
    manifest
  }));
}

function graph(): ResolvedPlatformPluginGraph {
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
  actionHandler: ActionHandler = () => ({ accepted: true }),
  registeredTool: AgentToolDescriptor | null = actionTool()
): PluginRegistration {
  return {
    pluginId: "module.consumer",
    contracts(context) {
      context.register("permissions", "consumer.permission", {
        id: "consumer.permission",
        ownerPluginId: "module.consumer",
        title: "Consumer read",
        description: "Read consumer resources.",
        audience: "authenticated",
        resource: "consumer.resource",
        operation: "read",
        policy: { id: "consumer.policy.read", scope: "application", recordScoped: false, fieldScoped: false }
      });
      context.register("settings", "consumer.setting", {
        id: "consumer.setting",
        ownerPluginId: "module.consumer",
        schemaVersion: 1,
        fields: { enabled: { type: "boolean", required: true, default: true } },
        surface: "workspace",
        audience: "authenticated",
        readPermission: "consumer.permission",
        changePermission: "consumer.permission",
        featureRevision: 1,
        publicationRevision: 1
      });
      context.register("sources", "consumer.source", sourceDefinition);
      context.register("actions", "consumer.action", actionDefinition());
      if (registeredTool) context.register("tools", registeredTool.id, registeredTool);
      context.register("events", "consumer.event", {
        id: "consumer.event", version: 1, ownerPluginId: "module.consumer", eventClass: "durable-integration", sourceId: "consumer.source"
      });
      context.register("realtimeTopics", "consumer.realtime", {
        id: "consumer.realtime", version: 1, ownerPluginId: "module.consumer", eventId: "consumer.event",
        sourceId: "consumer.source", permission: "consumer.permission"
      });
    },
    schema(context) {
      context.register("schema", "consumer.schema", { slug: "consumer" });
      context.register("migrations", "consumer.migration", {
        id: "consumer.migration", version: 1, ownerPluginId: "module.consumer", predecessorRevisions: []
      });
    },
    behavior(context) {
      onBehavior?.(context.services);
      context.register("services", "consumer.service", { id: "consumer.service", version: 1, ownerPluginId: "module.consumer" });
      context.register("lifecycle", "consumer.lifecycle", {
        id: "consumer.lifecycle", version: 1, ownerPluginId: "module.consumer",
        disable: "supported", reenable: "supported", purge: "unsupported"
      });
    },
    jobs: (context) => {
      context.register("jobs", "consumer.job", {
        id: "consumer.job", version: 1, ownerPluginId: "module.consumer", timeoutMs: 5_000, maxConcurrency: 1, idempotent: true
      });
      context.bind("consumer.job", () => undefined);
    },
    dataHandlers(context) {
      context.bind("sources", "consumer.source", sourceHandler);
      context.bind("actions", "consumer.action", actionHandler);
      context.bind("events", "consumer.event", () => undefined);
      context.bind("realtimeTopics", "consumer.realtime", () => undefined);
    },
    ui(context) {
      context.register("components", "consumer.component", uiDescriptor("consumer.component", "component"));
      context.register("blocks", "consumer.block", uiDescriptor("consumer.block", "block"));
      context.register("routes", "consumer.route", {
        id: "consumer.route",
        ownerPluginId: "module.consumer",
        path: "/consumer",
        parameters: {},
        surface: "workspace",
        audience: "authenticated",
        permission: "consumer.permission",
        viewId: "consumer.template"
      });
      context.register("navigation", "consumer.navigation", {
        id: "consumer.navigation",
        ownerPluginId: "module.consumer",
        labelMessageId: "consumer.message.navigation",
        route: { routeId: "consumer.route", params: {} },
        permission: "consumer.permission",
        order: 10
      });
      context.register("pageTemplates", "consumer.template", {
        id: "consumer.template",
        version: 1,
        ownerPluginId: "module.consumer",
        route: { routeId: "consumer.route", params: {} },
        surface: "workspace",
        profile: "workspace",
        permission: "consumer.permission",
        publicationPolicy: { ownership: "customer", adoption: "explicit" },
        requirements: { capabilities: [], sources: [], actions: [], blocks: [] },
        document: {
          id: "consumer.template",
          version: 1,
          schemaVersion: 1,
          profile: "workspace",
          regions: { main: [] }
        }
      });
      context.register("localization", "consumer.localization", {
        id: "consumer.localization", version: 1, ownerPluginId: "module.consumer", locale: "en",
        messages: { "consumer.message.title": "Consumer", "consumer.message.navigation": "Consumer" }
      });
      context.bindRenderer("components", "consumer.component", () => undefined);
      context.bindRenderer("blocks", "consumer.block", () => undefined);
    },
    validate(context) {
      context.register("healthAudit", "consumer.health", { id: "consumer.health", version: 1, ownerPluginId: "module.consumer", safe: true });
      context.register("testingMetadata", "consumer.testing", {
        id: "consumer.testing", version: 1, ownerPluginId: "module.consumer", conformancePluginId: "module.consumer"
      });
    }
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
  resolvedGraph: ResolvedPlatformPluginGraph = graph()
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

function corruptedReference(
  phase: "contracts" | "ui",
  targetKind: string,
  targetId: string,
  mutate: (value: unknown) => unknown
): PluginRegistration {
  const base = completeConsumer();
  if (phase === "contracts") return {
    ...base,
    contracts(context) {
      base.contracts?.({
        ...context,
        register: ((kind: string, id: string, value: unknown) =>
          context.register(kind as never, id, kind === targetKind && id === targetId ? mutate(value) : value)) as typeof context.register
      });
    }
  };
  return {
    ...base,
    ui(context) {
      base.ui?.({
        ...context,
        register: ((kind: string, id: string, value: unknown) =>
          context.register(kind as never, id, kind === targetKind && id === targetId ? mutate(value) : value)) as typeof context.register
      });
    }
  };
}

describe("phased registration runtime", () => {
  it("provides a frozen authoring helper without widening plugin registration callbacks", () => {
    const registration = definePluginRegistration({ pluginId: "module.consumer" });
    expect(registration.pluginId).toBe("module.consumer");
    expect(Object.isFrozen(registration)).toBe(true);
  });

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
      admin: () => trace.push(`admin:${pluginId}`),
      validate: () => trace.push(`validate:${pluginId}`)
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
      "admin:provider.storage", "admin:module.consumer",
      "validate:provider.storage", "validate:module.consumer"
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
    expect(service).toBeDefined();
    expect(() => (service as { readonly driver: string }).driver).toThrow(/authoritative lifecycle scoping/);
    expect(serviceKeys).toEqual(["get"]);
    expect(result.inventory).toEqual([
      {
        id: "module.consumer",
        contributions: {
          schema: ["consumer.schema"],
          migrations: ["consumer.migration"],
          services: ["consumer.service"],
          permissions: ["consumer.permission"],
          settings: ["consumer.setting"],
          sources: ["consumer.source"],
          actions: ["consumer.action"],
          tools: ["consumer.tools.action"],
          events: ["consumer.event"],
          jobs: ["consumer.job"],
          realtimeTopics: ["consumer.realtime"],
          components: ["consumer.component"],
          blocks: ["consumer.block"],
          routes: ["consumer.route"],
          navigation: ["consumer.navigation"],
          pageTemplates: ["consumer.template"],
          localization: ["consumer.localization"],
          healthAudit: ["consumer.health"],
          lifecycle: ["consumer.lifecycle"],
          testingMetadata: ["consumer.testing"]
        },
        capabilityAccess: ["storage.records"]
      },
      { id: "provider.storage", contributions: {}, capabilityAccess: [] }
    ]);
    expect(result.contributions.schema[0]).toMatchObject({ pluginId: "module.consumer", id: "consumer.schema" });
    expect(result.bindings).toMatchObject({
      sources: [{ pluginId: "module.consumer", id: "consumer.source" }],
      actions: [{ pluginId: "module.consumer", id: "consumer.action" }],
      components: [{ pluginId: "module.consumer", id: "consumer.component" }],
      blocks: [{ pluginId: "module.consumer", id: "consumer.block" }]
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.inventory)).toBe(true);
  });

  it("accepts a valid data-source definition and server handler binding", () => {
    const definition = dataSourceDefinition("consumer.source");
    const handler: DataSourceHandler = ({ input, selectedFields, signal }) => ({ input, selectedFields, signal });
    const result = run([providerRegistration(), completeConsumer(undefined, definition, handler)]);

    expect(result.contributions.sources).toEqual([{ pluginId: "module.consumer", id: "consumer.source", value: definition }]);
    expect(result.bindings.sources).toEqual([{ pluginId: "module.consumer", id: "consumer.source", value: handler }]);
  });

  it("rejects invalid data-source definitions", () => {
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        context.register("sources", "consumer.source", {} as never);
      }
    }]), "INVALID_CONTRIBUTION");
  });

  it("rejects invalid plugin configuration descriptors during registration", () => {
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        context.register("settings", "consumer.setting", {} as never);
      }
    }]), "INVALID_CONTRIBUTION");
  });

  it("reconciles every descriptor reference against its exact owned category", () => {
    const patch = (fields: Readonly<Record<string, unknown>>) => (value: unknown): unknown => ({ ...(value as object), ...fields });
    const definitionPatch = (fields: Readonly<Record<string, unknown>>) => (value: unknown): unknown => {
      const definition = value as ActionDefinition | DataSourceDefinition;
      return { ...definition, descriptor: { ...definition.descriptor, ...fields } };
    };
    const cases = [
      ["contracts", "settings", "consumer.setting", patch({ readPermission: "consumer.route" })],
      ["contracts", "sources", "consumer.source", definitionPatch({ permission: "consumer.route" })],
      ["contracts", "actions", "consumer.action", definitionPatch({ permission: "consumer.route" })],
      ["contracts", "tools", "consumer.tools.action", patch({ permission: "consumer.route" })],
      ["contracts", "events", "consumer.event", patch({ sourceId: "consumer.permission" })],
      ["contracts", "realtimeTopics", "consumer.realtime", patch({ eventId: "consumer.permission" })],
      ["contracts", "realtimeTopics", "consumer.realtime", patch({ sourceId: "consumer.permission" })],
      ["contracts", "realtimeTopics", "consumer.realtime", patch({ permission: "consumer.route" })],
      ["ui", "components", "consumer.component", patch({ permission: "consumer.route" })],
      ["ui", "components", "consumer.component", patch({ actionPolicy: { required: true, actions: [{ id: "consumer.route", version: 1 }] } })],
      ["ui", "routes", "consumer.route", patch({ permission: "consumer.navigation" })],
      ["ui", "routes", "consumer.route", patch({ viewId: "consumer.permission" })],
      ["ui", "navigation", "consumer.navigation", patch({ route: { routeId: "consumer.permission", params: {} } })],
      ["ui", "navigation", "consumer.navigation", patch({ permission: "consumer.route" })],
      ["ui", "navigation", "consumer.navigation", patch({ parentId: "consumer.route" })],
      ["ui", "pageTemplates", "consumer.template", patch({ route: { routeId: "consumer.permission", params: {} } })],
      ["ui", "pageTemplates", "consumer.template", patch({ permission: "consumer.route" })]
    ] as const;
    for (const [phase, kind, id, mutate] of cases) {
      expectCode(() => run([providerRegistration(), corruptedReference(phase, kind, id, mutate)]), "INVENTORY_MISMATCH");
    }
  });

  it("requires canonical UI descriptor categories and executable renderer bindings", () => {
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      ui(context) {
        context.register("components", "consumer.component", uiDescriptor("consumer.component", "block"));
      }
    }]), "INVALID_CONTRIBUTION");

    expectCode(() => run([providerRegistration(), {
      ...consumer,
      ui(context) {
        consumer.ui?.({
          ...context,
          bindRenderer(kind, id, renderer) {
            if (kind === "components") context.bindRenderer(kind, id, renderer);
          }
        });
      }
    }]), "INVENTORY_MISMATCH");
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
        context.bind("sources", "consumer.source", {} as never);
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
      contributions: { ...consumerManifest().contributions, tools: { "consumer.tools.action": "required" } }
    });
    const plan = (tool: AgentToolDescriptor): PluginRegistration => {
      const consumer = completeConsumer(undefined, undefined, undefined, undefined, null);
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

  it("rejects a source tool whose output contract does not match the registered source", () => {
    const base = consumerManifest();
    const manifest = consumerManifest({
      contributions: { ...base.contributions, tools: { "consumer.tools.source": "required" } }
    });
    const sourceTool = (outputContract: AgentToolDescriptor["outputContract"]): AgentToolDescriptor => ({
      ...actionTool(),
      id: "consumer.tools.source",
      outputSchema: undefined,
      outputContract,
      invocation: { kind: "source", source: { id: "consumer.source", version: 1 } },
      permission: "consumer.permission",
      policy: "consumer.read",
      effect: "read-only",
      approval: "none",
      idempotency: "not-applicable"
    });
    const plan = (tool: AgentToolDescriptor): PluginRegistration => {
      const consumer = completeConsumer(undefined, undefined, undefined, undefined, null);
      return {
        ...consumer,
        contracts(context) {
          consumer.contracts?.(context);
          context.register("tools", tool.id, tool);
        }
      };
    };

    expectCode(
      () => run([providerRegistration(), plan(sourceTool("table.records@1"))], [providerManifest(), manifest]),
      "INVENTORY_MISMATCH"
    );
    expect(() => run([providerRegistration(), plan(sourceTool("metric.scalar@1"))], [providerManifest(), manifest])).not.toThrow();
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
        contracts?.register("permissions", "consumer.permission", {});
        consumer.behavior?.(context);
      }
    }]), "WRONG_PHASE");
  });

  it("rejects undeclared contributions immediately", () => {
    expectCode(() => run([providerRegistration(), {
      ...completeConsumer(),
      schema: (context) => context.register("schema", "consumer.not-declared", {})
    }]), "UNDECLARED_CONTRIBUTION");
  });

  it("allows absent optional declarations but requires a binding when an optional executable contribution registers", () => {
    const optionalMigration = consumerManifest({
      contributions: {
        ...consumerManifest().contributions,
        migrations: { "consumer.migration": "optional" }
      }
    });
    const withoutMigration = completeConsumer();
    expect(() => run([providerRegistration(), {
      ...withoutMigration,
      schema: (context) => context.register("schema", "consumer.schema", { slug: "consumer" })
    }], [providerManifest(), optionalMigration])).not.toThrow();

    const optionalSource = consumerManifest({
      contributions: {
        ...consumerManifest().contributions,
        sources: { "consumer.source": "required", "consumer.optional": "optional" }
      }
    });
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        consumer.contracts?.(context);
        context.register("sources", "consumer.optional", dataSourceDefinition("consumer.optional"));
      }
    }], [providerManifest(), optionalSource]), "INVENTORY_MISMATCH");
  });

  it("rejects unknown categories instead of allowing runtime content to create them", () => {
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        const register = context.register as (kind: string, id: string, value: unknown) => void;
        register("database", "consumer.database", {});
      }
    }]), "INVALID_CONTRIBUTION");
  });

  it("snapshots declarations before hooks can mutate their source objects", () => {
    const manifest = consumerManifest();
    const consumer = completeConsumer();
    expectCode(() => run([providerRegistration(), {
      ...consumer,
      contracts(context) {
        if (manifest.contributions?.schema) manifest.contributions.schema["consumer.injected"] = "required";
        consumer.contracts?.(context);
      },
      schema(context) {
        consumer.schema?.(context);
        context.register("schema", "consumer.injected", {});
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
    const provider = providerManifest({ schema: { "consumer.schema": "required" } });
    expectCode(() => run([
      { ...providerRegistration(), schema: (context) => context.register("schema", "consumer.schema", {}) },
      completeConsumer()
    ], [provider, consumerManifest()]), "DUPLICATE_CONTRIBUTION");
  });

  it("rejects late registration after freeze", () => {
    let schema: SchemaRegistrationContext | undefined;
    const consumer = completeConsumer();
    run([providerRegistration(), {
      ...consumer,
      schema(context) {
        schema = context;
        consumer.schema?.(context);
      }
    }]);
    expectCode(() => schema?.register("schema", "consumer.schema", {}), "FROZEN");
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

  it("rejects capability services that cannot be lifecycle-revoked", () => {
    expectCode(() => run([{
      pluginId: "provider.storage",
      providers: (context) => context.provide("storage.records", null)
    }, completeConsumer()]), "INVALID_CONTRIBUTION");
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
