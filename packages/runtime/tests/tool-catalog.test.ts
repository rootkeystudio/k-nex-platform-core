import type { AgentToolDescriptor, DataSourceDefinition, PluginManifest } from "@k-nex/contracts";
import { DataSourceDescriptorSchema } from "@k-nex/contracts";
import type { InstalledPluginManifest, ResolvedPluginGraph } from "@k-nex/composition";
import { describe, expect, it } from "vitest";

import {
  executeRegistration,
  type PluginRegistration
} from "../src/registration-runtime.js";
import {
  ToolCatalog,
  ToolCatalogError,
  type ToolCatalogPolicyRequest,
  type ToolCatalogRequest
} from "../src/tool-catalog.js";

const compatibility = {
  core: ">=1.0.0 <2.0.0",
  payload: ">=3.0.0 <4.0.0",
  node: ">=24.0.0 <25.0.0",
  payloadDatabaseAdapters: ["postgres" as const]
};

const manifest: PluginManifest = {
  apiVersion: 1,
  id: "module.sales",
  kind: "module",
  displayName: "Sales",
  version: "1.0.0",
  package: "@k-nex/module-sales",
  compatibility,
  provides: [],
  requires: [],
  optional: [],
  conflicts: [],
  lifecycle: { ownsPayloadSchema: false, ownsPersistentData: true, disable: "supported", uninstall: "unsupported", purge: "supported" },
  contributions: { dataSources: ["sales.tasks"], tools: ["sales.tools.search", "sales.tools.private"] }
};

const installed: readonly InstalledPluginManifest[] = [{
  package: { name: manifest.package, version: manifest.version, integrity: "sha512-sales" },
  manifest
}];

const graph: ResolvedPluginGraph = {
  resolverVersion: "1.0.0",
  plugins: [{
    id: manifest.id,
    kind: manifest.kind,
    package: manifest.package,
    version: manifest.version,
    integrity: "sha512-sales",
    required: [],
    optional: []
  }],
  capabilityProviders: [],
  registrationOrder: [manifest.id]
};

const source: DataSourceDefinition = {
  descriptor: {
    id: "sales.tasks",
    version: 1,
    ownerPluginId: manifest.id,
    primaryContract: { id: "metric.scalar", version: 1 },
    sourceSchema: { id: "sales.tasks.input", version: 1 },
    audience: "authenticated",
    surfaces: ["workspace", "cms"],
    permission: "sales.tasks.read",
    structuralCompatibilityHash: `sha256:${"0".repeat(64)}`,
    presentationMetadataRevision: 1,
    title: "Tasks",
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

const tool = (id: string, audience: AgentToolDescriptor["audience"] = "authenticated"): AgentToolDescriptor => ({
  id,
  version: 1,
  ownerPluginId: manifest.id,
  title: id,
  description: `Trusted ${id}`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: { type: "string" },
  invocation: { kind: "source", source: { id: source.descriptor.id, version: 1 } },
  audience,
  surfaces: audience === "public" ? ["public"] : ["workspace", "cms"],
  permission: "sales.tasks.read",
  policy: "sales.tasks.tool",
  effect: "read-only",
  risk: "low",
  approval: "none",
  idempotency: "not-applicable",
  dryRun: false,
  limits: { timeoutMs: 1000, maxConcurrency: 1, ratePerMinute: 1, burst: 1, costClass: "low", maxCost: 1 },
  redaction: { inputPaths: [], outputPaths: [] },
  audit: { category: "sales.tasks" }
});

function registration(toolValues: readonly AgentToolDescriptor[] = [tool("sales.tools.search"), tool("sales.tools.private")]): ReturnType<typeof executeRegistration> {
  const plan: PluginRegistration = {
    pluginId: manifest.id,
    contracts(context) {
      context.register("dataSources", source.descriptor.id, source);
      for (const value of toolValues) context.register("tools", value.id, value);
    },
    dataHandlers: (context) => context.bind("dataSources", source.descriptor.id, () => undefined)
  };
  return executeRegistration({ graph, installed, registrations: [plan] });
}

const actor: ToolCatalogRequest["actor"] = {
  principal: { kind: "user", id: "user-1" },
  effectiveActor: { kind: "user", id: "user-1" }
};

function request(overrides: Partial<ToolCatalogRequest> = {}): ToolCatalogRequest {
  return { actor, delegation: { id: "grant-1" }, authorizationContext: { revision: "1" }, surface: "workspace", features: [], ...overrides };
}

describe("P2A.2 tool catalog", () => {
  it("paginates stable frozen descriptors with one revision across pages", async () => {
    const catalog = new ToolCatalog(registration(), { isVisible: () => true });
    const first = await catalog.list({ ...request(), limit: 1 });
    const second = await catalog.list({ ...request(), limit: 1, cursor: first.nextCursor });
    expect(first.tools.map(({ id }) => id)).toEqual(["sales.tools.private"]);
    expect(second.tools.map(({ id }) => id)).toEqual(["sales.tools.search"]);
    expect(first.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second.revision).toBe(first.revision);
    expect(Object.isFrozen(first.tools[0])).toBe(true);
    expect(Object.isFrozen(first.tools[0]?.inputSchema)).toBe(true);
  });

  it("does not leak hidden descriptor changes through the visible revision", async () => {
    const visible = tool("sales.tools.search");
    const hidden = tool("sales.tools.private");
    const changedHidden = { ...hidden, description: "Changed private description" };
    const policy = { isVisible: ({ descriptor }: ToolCatalogPolicyRequest) => descriptor.id === visible.id };
    const first = new ToolCatalog(registration([visible, hidden]), policy);
    const second = new ToolCatalog(registration([visible, changedHidden]), policy);
    expect((await first.list(request())).revision).toBe((await second.list(request())).revision);
  });

  it("applies descriptor audience/surface rules before policy and passes every request dimension", async () => {
    let seen: ToolCatalogPolicyRequest | undefined;
    const catalog = new ToolCatalog(registration([tool("sales.tools.search"), tool("sales.tools.private", "internal")]), {
      isVisible(requestValue) {
        seen = requestValue;
        return requestValue.features.includes("sales");
      }
    });
    expect((await catalog.list({ ...request(), features: ["sales"] })).tools).toHaveLength(1);
    expect(seen?.delegation).toEqual({ id: "grant-1" });
    expect(seen?.authorizationContext).toEqual({ revision: "1" });
    expect(seen?.surface).toBe("workspace");
    expect(seen?.actor).toEqual(actor);
    expect(await catalog.lookup("sales.tools.private", 1, request({ features: ["sales"] }))).toBeUndefined();
  });

  it("omits unknown and stale versions and supports synchronous invalidation subscribers", async () => {
    const catalog = new ToolCatalog(registration(), { isVisible: () => true });
    expect(await catalog.lookup("sales.tools.missing", 1, request())).toBeUndefined();
    expect(await catalog.lookup("sales.tools.search", 2, request())).toBeUndefined();
    let changes = 0;
    const unsubscribe = catalog.subscribe(() => { changes += 1; });
    catalog.notifyChanged();
    unsubscribe();
    catalog.notifyChanged();
    expect(changes).toBe(1);
  });

  it("is unaffected by descriptor mutation after registration and rejects foreign cursors", async () => {
    const mutable = tool("sales.tools.search");
    const catalog = new ToolCatalog(registration([mutable, tool("sales.tools.private")]), { isVisible: () => true });
    mutable.description = "caller mutation";
    (mutable.inputSchema.properties as Record<string, unknown>).secret = { type: "string" };
    expect((await catalog.lookup(mutable.id, 1, request()))?.description).toBe("Trusted sales.tools.search");
    await expect(catalog.list({ ...request(), cursor: `sha256:${"0".repeat(64)}` })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("rejects malformed requests", async () => {
    const catalog = new ToolCatalog(registration(), { isVisible: () => true });
    await expect(catalog.list(request({ actor: {} as ToolCatalogRequest["actor"] }))).rejects.toMatchObject({ code: "INVALID_ACTOR_CONTEXT" });
    await expect(catalog.list(request({ features: ["duplicate", "duplicate"] }))).rejects.toBeInstanceOf(ToolCatalogError);
    await expect(catalog.list({ ...request(), limit: 101 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects malformed, undeclared, duplicate, and unbound tool registrations", () => {
    const malformed = { ...tool("sales.tools.search"), ownerPluginId: "module.missing" } as AgentToolDescriptor;
    expect(() => registration([malformed, tool("sales.tools.private")])).toThrowError(/owner/);

    const undeclared: PluginRegistration = {
      pluginId: manifest.id,
      contracts: (context) => context.register("tools", "sales.tools.undeclared", tool("sales.tools.undeclared"))
    };
    expect(() => executeRegistration({ graph, installed, registrations: [undeclared] })).toThrowError(/did not declare/);

    const duplicate: PluginRegistration = {
      pluginId: manifest.id,
      contracts(context) {
        const value = tool("sales.tools.search");
        context.register("tools", value.id, value);
        context.register("tools", value.id, value);
      }
    };
    expect(() => executeRegistration({ graph, installed, registrations: [duplicate] })).toThrowError(/already registered/);

    const missingTarget = {
      ...tool("sales.tools.search"),
      invocation: { kind: "source" as const, source: { id: "sales.missing", version: 1 } }
    } satisfies AgentToolDescriptor;
    expect(() => registration([missingTarget, tool("sales.tools.private")])).toThrowError(/inventory/);
  });

  it("rejects a tool targeting another plugin's binding", () => {
    const otherManifest: PluginManifest = {
      ...manifest,
      id: "module.other",
      displayName: "Other",
      package: "@k-nex/module-other",
      lifecycle: { ...manifest.lifecycle },
      contributions: { dataSources: ["other.tasks"] }
    };
    const otherSource: DataSourceDefinition = {
      ...source,
      descriptor: { ...source.descriptor, id: "other.tasks", ownerPluginId: otherManifest.id }
    };
    const crossPluginTool: AgentToolDescriptor = {
      ...tool("sales.tools.search"),
      invocation: { kind: "source", source: { id: otherSource.descriptor.id, version: 1 } }
    };
    const otherInstalled: InstalledPluginManifest = {
      package: { name: otherManifest.package, version: otherManifest.version, integrity: "sha512-other" },
      manifest: otherManifest
    };
    const otherNode = {
      id: otherManifest.id,
      kind: otherManifest.kind,
      package: otherManifest.package,
      version: otherManifest.version,
      integrity: "sha512-other",
      required: [],
      optional: []
    } as const;
    const crossGraph: ResolvedPluginGraph = {
      ...graph,
      plugins: [otherNode, ...graph.plugins],
      registrationOrder: [otherManifest.id, manifest.id]
    };
    const plans: PluginRegistration[] = [{
      pluginId: otherManifest.id,
      contracts: (context) => context.register("dataSources", otherSource.descriptor.id, otherSource),
      dataHandlers: (context) => context.bind("dataSources", otherSource.descriptor.id, () => undefined)
    }, {
      pluginId: manifest.id,
      contracts(context) {
        context.register("dataSources", source.descriptor.id, source);
        context.register("tools", crossPluginTool.id, crossPluginTool);
        context.register("tools", "sales.tools.private", tool("sales.tools.private"));
      },
      dataHandlers: (context) => context.bind("dataSources", source.descriptor.id, () => undefined)
    }];
    expect(() => executeRegistration({
      graph: crossGraph,
      installed: [otherInstalled, ...installed],
      registrations: plans
    })).toThrowError(/inventory/);
  });
});
