import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson, type ApplicationManifest } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import type { InstalledPluginManifest } from "../src/installed-plugin-loader.js";
import type { ResolvedPluginGraph } from "../src/deterministic-resolver.js";
import {
  fingerprintCustomerConfigSources,
  generatedArtifactPaths,
  generateStaticArtifacts,
  writeStaticArtifacts
} from "../src/static-artifact-generator.js";

const framework = {
  core: "1.0.0",
  payload: "3.88.0",
  node: "24.19.0",
  pnpm: "11.9.0",
  payloadDatabaseAdapter: "postgres" as const
};

const applicationManifest = {
  schemaVersion: 1,
  application: {
    id: "customer-one",
    name: "Customer One",
    type: "customer-platform" as const,
    defaultLocale: "en-US",
    locales: ["en-US", "tr-TR"]
  },
  runtime: {
    node: "24.19.0",
    packageManager: "pnpm" as const,
    packageManagerVersion: "11.9.0",
    deploymentMode: "container" as const
  },
  framework: {
    payload: {
      database: {
        adapter: "postgres" as const,
        package: "@payloadcms/db-postgres" as const,
        connectionEnvironmentVariable: "DATABASE_URL" as const
      }
    }
  },
  plugins: [
    { id: "module.consumer", package: "@k-nex/plugin-consumer", version: "1.0.0", enabled: true },
    { id: "provider.storage", package: "@k-nex/provider-storage", version: "1.0.0", enabled: true }
  ],
  providers: {
    "storage.records": {
      plugin: "provider.storage",
      package: "@k-nex/provider-storage",
      version: "1.0.0"
    }
  },
  themes: {},
  development: { database: { mode: "external" as const } },
  build: { dockerfile: true, commitGeneratedRegistries: true, validateGeneratedFilesInCI: true },
  environment: { required: ["DATABASE_URL", "PAYLOAD_SECRET"] }
} satisfies ApplicationManifest;

const compatibility = {
  core: ">=1.0.0 <2.0.0",
  payload: ">=3.0.0 <4.0.0",
  node: ">=24.0.0 <25.0.0",
  payloadDatabaseAdapters: ["postgres" as const]
};

const consumerManifest = {
  apiVersion: 1 as const,
  id: "module.consumer",
  kind: "module" as const,
  displayName: "Consumer",
  version: "1.0.0",
  package: "@k-nex/plugin-consumer",
  compatibility,
  provides: [],
  requires: [{ capability: "storage.records", version: "^1.0.0", reason: "records" }],
  optional: [],
  conflicts: [],
  surfaces: ["workspace" as const],
  lifecycle: {
    ownsPayloadSchema: false as const,
    ownsPersistentData: false,
    disable: "supported" as const,
    uninstall: "supported" as const,
    purge: "supported" as const
  },
  contributions: {
    behavior: ["consumer.z", "consumer.a"],
    actions: ["consumer.action"],
    tools: ["consumer.tool"]
  }
};

const providerManifest = {
  apiVersion: 1 as const,
  id: "provider.storage",
  kind: "provider" as const,
  displayName: "Storage provider",
  version: "1.0.0",
  package: "@k-nex/provider-storage",
  compatibility,
  provides: [{ capability: "storage.records", version: "1.0.0" }],
  requires: [],
  optional: [],
  conflicts: [],
  surfaces: ["driver" as const],
  environment: [
    {
      name: "STORAGE_TOKEN",
      secret: true,
      requiredWhen: "enabled" as const,
      description: "provider token"
    },
    { name: "STORAGE_REGION", secret: false, requiredWhen: "installed" as const }
  ],
  lifecycle: {
    ownsPayloadSchema: true as const,
    ownsPersistentData: true,
    disable: "supported" as const,
    uninstall: "unsupported" as const,
    purge: "supported" as const
  },
  contributions: {
    contracts: ["storage.contract"],
    schema: ["storage.z", "storage.a"]
  }
};

const installed = [
  {
    package: {
      name: "@k-nex/plugin-consumer",
      version: "1.0.0",
      integrity: "sha512-Y29uc3VtZXI="
    },
    manifest: consumerManifest
  },
  {
    package: {
      name: "@k-nex/provider-storage",
      version: "1.0.0",
      integrity: "sha512-U3RvcmFnZQ=="
    },
    manifest: providerManifest
  }
] satisfies readonly InstalledPluginManifest[];

const resolvedGraph = {
  resolverVersion: "1.0.0" as const,
  plugins: [
    {
      id: "module.consumer",
      kind: "module",
      package: "@k-nex/plugin-consumer",
      version: "1.0.0",
      integrity: "sha512-Y29uc3VtZXI=",
      required: ["provider.storage"],
      optional: []
    },
    {
      id: "provider.storage",
      kind: "provider",
      package: "@k-nex/provider-storage",
      version: "1.0.0",
      integrity: "sha512-U3RvcmFnZQ==",
      required: [],
      optional: []
    }
  ],
  capabilityProviders: [{ capability: "storage.records", plugin: "provider.storage", version: "1.0.0" }],
  registrationOrder: ["provider.storage", "module.consumer"]
} satisfies ResolvedPluginGraph;

const configSources = [
  { path: "src/customer-config.ts", content: "export const registration = { enabled: true };\n" },
  { path: "src/customer-policy.ts", content: "export const policy = { mode: \"strict\" };\n" }
];

type ArtifactInput = {
  applicationManifest: ApplicationManifest;
  resolvedGraph: ResolvedPluginGraph;
  installed: readonly InstalledPluginManifest[];
  customerConfigFingerprint: string;
  framework: typeof framework;
};

function fingerprint(): string {
  return fingerprintCustomerConfigSources(configSources);
}

function input(): ArtifactInput {
  return {
    applicationManifest,
    resolvedGraph,
    installed,
    customerConfigFingerprint: fingerprint(),
    framework
  };
}

function artifactPaths(): readonly string[] {
  return typeof generatedArtifactPaths === "function"
    ? generatedArtifactPaths()
    : generatedArtifactPaths;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value);
}

function artifactEntries(value: unknown): Map<string, string> {
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value as Record<string, unknown>);
  return new Map(entries.map(([path, content]) => [path, textValue(content)]));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function generation(options: Record<string, unknown> = {}): unknown {
  return generateStaticArtifacts({ ...input(), ...options } as never);
}

async function writeGenerated(root: string, check = false): Promise<unknown> {
  return writeStaticArtifacts(root, input(), { check });
}

async function readTree(root: string): Promise<Map<string, string>> {
  const paths = artifactPaths();
  const entries = await Promise.all(paths.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const));
  return new Map(entries);
}

async function removeTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

describe("static artifact generator", () => {
  it("emits the exact artifact set and a canonical resolved graph without secret values", () => {
    expect(artifactPaths()).toEqual([
      ".k-nex/generated/k-nex.resolved.json",
      ".k-nex/generated/plugin-registry.ts",
      ".k-nex/generated/payload-contributions.ts",
      ".k-nex/generated/runtime-registration.ts",
      ".k-nex/generated/environment-schema.ts"
    ]);

    const artifacts = artifactEntries(generation());
    expect([...artifacts.keys()]).toEqual([...artifactPaths()]);
    const resolvedText = artifacts.get(".k-nex/generated/k-nex.resolved.json");
    expect(resolvedText).toBeDefined();
    const resolved = JSON.parse(resolvedText as string) as Record<string, any>;
    expect(resolvedText).toBe(canonicalJson(resolved));
    expect(resolved).toMatchObject({
      schemaVersion: 1,
      resolverVersion: resolvedGraph.resolverVersion,
      application: { id: applicationManifest.application.id },
      framework,
      runtime: applicationManifest.runtime,
      capabilityProviders: resolvedGraph.capabilityProviders,
      registrationOrder: resolvedGraph.registrationOrder,
      customerConfigFingerprint: fingerprint(),
      environment: { names: ["DATABASE_URL", "PAYLOAD_SECRET", "STORAGE_REGION", "STORAGE_TOKEN"] }
    });
    expect(resolved.plugins).toHaveLength(2);
    expect(resolved.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "provider.storage",
        package: "@k-nex/provider-storage",
        version: "1.0.0",
        integrity: "sha512-U3RvcmFnZQ==",
        manifestDigest: `sha256:${sha256(providerManifest)}`,
        required: [],
        optional: [],
        contributions: { contracts: ["storage.contract"], schema: ["storage.a", "storage.z"] },
        lifecycle: providerManifest.lifecycle,
        environment: { names: ["STORAGE_REGION", "STORAGE_TOKEN"] }
      }),
      expect.objectContaining({
        id: "module.consumer",
        manifestDigest: `sha256:${sha256(consumerManifest)}`,
        contributions: { actions: ["consumer.action"], behavior: ["consumer.a", "consumer.z"], tools: ["consumer.tool"] },
        lifecycle: consumerManifest.lifecycle
      })
    ]));
    expect(resolvedText).not.toContain("provider token");
    expect(resolvedText).not.toContain("SECRET_VALUE");
  });

  it("uses literal static package imports and contains no ambient or dynamic inputs", () => {
    const text = [...artifactEntries(generation()).entries()]
      .filter(([path]) => path.endsWith(".ts"))
      .map(([, content]) => content)
      .join("\n");
    for (const packageName of ["@k-nex/plugin-consumer", "@k-nex/provider-storage"]) {
      expect(text).toMatch(new RegExp(`(?:from\\s+|import\\s*)[\\"']${packageName.replace("/", "\\/")}/manifest[\\"']`));
      expect(text).toMatch(new RegExp(`(?:from\\s+|import\\s*)[\\"']${packageName.replace("/", "\\/")}/server[\\"']`));
    }
    expect(text).not.toContain("import(");
    expect(text).not.toContain("process.env");
    expect(text).not.toMatch(/\$\{[^}]*package/i);
    expect(text).not.toMatch(/Date\.now|new Date|hostname|os\.hostname|Math\.random|generatedAt|timestamp/i);
  });

  it("is byte-identical for reverse input order and changed cwd, TZ, and output roots", () => {
    const originalCwd = process.cwd();
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      process.chdir(tmpdir());
      const forward = artifactEntries(generation());
      process.env.TZ = "UTC";
      process.chdir(originalCwd);
      const reverse = artifactEntries(generation({
        installed: [...installed].reverse(),
        resolvedGraph: { ...resolvedGraph, plugins: [...resolvedGraph.plugins].reverse() }
      }));
      expect([...reverse.entries()]).toEqual([...forward.entries()]);
    } finally {
      process.chdir(originalCwd);
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("writes identical exact trees, checks current output, and reports stale or missing files without mutation", async () => {
    const first = await mkdtemp(join(tmpdir(), "k-nex-static-one-"));
    const second = await mkdtemp(join(tmpdir(), "k-nex-static-two-"));
    try {
      await writeGenerated(first);
      await writeGenerated(second);
      expect([...await readTree(first).then((tree) => tree.entries())]).toEqual([...await readTree(second).then((tree) => tree.entries())]);
      expect((await readdir(join(first, ".k-nex", "generated"))).sort()).toEqual(artifactPaths().map((path) => path.split("/").at(-1)).sort());
      const current = await readTree(first);
      await expect(writeGenerated(first, true)).resolves.toMatchObject({ missing: [], stale: [] });
      expect(await readTree(first)).toEqual(current);

      const stalePath = join(first, artifactPaths()[1] as string);
      await writeFile(stalePath, "stale\n");
      const staleTree = await readTree(first);
      await expect(writeGenerated(first, true)).resolves.toMatchObject({
        stale: [".k-nex/generated/plugin-registry.ts"]
      });
      expect(await readTree(first)).toEqual(staleTree);

      await unlink(join(first, artifactPaths()[2] as string));
      const missingTree = await readTree(first).catch(() => new Map<string, string>());
      await expect(writeGenerated(first, true)).resolves.toMatchObject({
        missing: [".k-nex/generated/payload-contributions.ts"],
        stale: [".k-nex/generated/plugin-registry.ts"]
      });
      expect(await readTree(first).catch(() => new Map<string, string>())).toEqual(missingTree);
    } finally {
      await Promise.all([removeTree(first), removeTree(second)]);
    }
  });

  it("fingerprints source order independently and rejects unsafe or duplicate paths", () => {
    const forward = fingerprintCustomerConfigSources(configSources);
    const reverse = fingerprintCustomerConfigSources([...configSources].reverse());
    expect(forward).toBe(reverse);
    expect(forward).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fingerprintCustomerConfigSources([{ ...configSources[0]!, path: "src/other.ts" }, configSources[1]!])).not.toBe(forward);
    expect(fingerprintCustomerConfigSources([{ ...configSources[0]!, content: "changed" }, configSources[1]!])).not.toBe(forward);
    for (const path of ["", "/tmp/customer.ts", "\\tmp\\customer.ts", "./customer.ts", "../customer.ts", "src/../customer.ts"]) {
      expect(() => fingerprintCustomerConfigSources([{ path, content: "export {};" }])).toThrow();
    }
    expect(() => fingerprintCustomerConfigSources([configSources[0]!, configSources[0]!])).toThrow();
  });

  it.each([
    "process.env.FEATURE",
    "Date.now()",
    "new Date()",
    "Math.random()",
    "crypto.randomUUID()",
    "fetch('https://example.test')",
    "import(dynamicPackage)"
  ])("rejects non-hermetic customer config input %s", (expression) => {
    expect(() => fingerprintCustomerConfigSources([{
      path: "k-nex.config.ts",
      content: `export default ${expression};\n`
    }])).toThrowError(/non-hermetic input/);
  });

  it.each([
    ["graph package", (value: any) => { value.resolvedGraph.plugins[0].package = "@k-nex/wrong"; }],
    ["graph version", (value: any) => { value.resolvedGraph.plugins[0].version = "2.0.0"; }],
    ["graph integrity", (value: any) => { value.resolvedGraph.plugins[0].integrity = "sha512-drift"; }],
    ["manifest package", (value: any) => { value.installed[0].manifest.package = "@k-nex/wrong"; }],
    ["manifest version", (value: any) => { value.installed[0].manifest.version = "2.0.0"; }],
    ["manifest identity", (value: any) => { value.installed[0].manifest.id = "module.other"; }],
    ["application request", (value: any) => { value.applicationManifest.plugins[0].enabled = false; }],
    ["framework", (value: any) => { value.framework.payload = "4.0.0"; }],
    ["application runtime", (value: any) => { value.applicationManifest.runtime.node = "25.0.0"; }],
    ["fingerprint", (value: any) => { value.customerConfigFingerprint = "sha256-not-a-digest"; }]
  ] as const)("rejects %s drift", (_label, mutate) => {
    const value = structuredClone(input()) as any;
    mutate(value);
    expect(() => generateStaticArtifacts(value)).toThrow();
  });

  it("rejects an unsupported builder selection instead of silently dropping it", () => {
    const value = structuredClone(input()) as any;
    value.applicationManifest.builder = {
      plugin: "builder.puck",
      package: "@k-nex/builder-puck",
      version: "1.0.0",
      profiles: {}
    };
    expect(() => generateStaticArtifacts(value)).toThrow(/Builder composition is not supported/);
  });

  it("does not mutate any input object", () => {
    const value = structuredClone(input());
    const before = structuredClone(value);
    generateStaticArtifacts(value);
    expect(value).toEqual(before);
    expect(fingerprintCustomerConfigSources(configSources)).toBe(fingerprint());
    expect(configSources).toEqual([
      { path: "src/customer-config.ts", content: "export const registration = { enabled: true };\n" },
      { path: "src/customer-policy.ts", content: "export const policy = { mode: \"strict\" };\n" }
    ]);
  });
});
