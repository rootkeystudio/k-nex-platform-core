import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canonicalJson, supportedFrameworkTuple, type ApplicationManifest, type PluginManifest, type SupportedFrameworkTuple } from "@k-nex/contracts";
import * as semver from "semver";

import { resolvePluginGraph, type ResolvedPluginGraph, type ResolvedPluginNode } from "./deterministic-resolver.js";
import type { InstalledPluginManifest } from "./installed-plugin-loader.js";

const generatedArtifactPathValues = [
  ".k-nex/generated/k-nex.resolved.json",
  ".k-nex/generated/plugin-registry.ts",
  ".k-nex/generated/payload-contributions.ts",
  ".k-nex/generated/runtime-registration.ts",
  ".k-nex/generated/environment-schema.ts"
] as const;

export const generatedArtifactPaths = Object.freeze(generatedArtifactPathValues);
export type GeneratedArtifactPath = (typeof generatedArtifactPathValues)[number];

export type StaticArtifactFrameworkTuple = SupportedFrameworkTuple;

export interface StaticArtifactGenerationInput {
  readonly applicationManifest: ApplicationManifest;
  readonly resolvedGraph: ResolvedPluginGraph;
  readonly installed: readonly InstalledPluginManifest[];
  readonly framework: StaticArtifactFrameworkTuple;
  readonly customerConfigFingerprint: string;
}

export interface StaticArtifactWriteReport {
  readonly written: readonly GeneratedArtifactPath[];
  readonly missing: readonly GeneratedArtifactPath[];
  readonly stale: readonly GeneratedArtifactPath[];
}

export type CustomerConfigSource = Readonly<{
  readonly path: string;
  readonly content: string | Uint8Array;
}>;

const forbiddenCustomerConfigInputs = [
  /\bprocess\s*\.\s*env\b/,
  /\bDate\s*\.\s*now\s*\(/,
  /\bnew\s+Date\s*\(/,
  /\bMath\s*\.\s*random\s*\(/,
  /\bcrypto\s*\.\s*randomUUID\s*\(/,
  /\bfetch\s*\(/,
  /\bimport\s*\(/
] as const;

export class StaticArtifactGenerationError extends Error {
  readonly code: "INVALID_INPUT" | "GRAPH_MISMATCH";

  constructor(code: StaticArtifactGenerationError["code"], message: string) {
    super(message);
    this.name = "StaticArtifactGenerationError";
    this.code = code;
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digestBytes(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function digestJson(value: unknown): string {
  return digestBytes(Buffer.from(canonicalJson(value), "utf8"));
}

function invalidInput(message: string): never {
  throw new StaticArtifactGenerationError("INVALID_INPUT", message);
}

function graphMismatch(message: string): never {
  throw new StaticArtifactGenerationError("GRAPH_MISMATCH", message);
}

function validateSourcePath(path: unknown): asserts path is string {
  if (typeof path !== "string" || path.length === 0 || path.includes("\\") || path.startsWith("/")) {
    invalidInput("Customer config source paths must be non-empty relative POSIX paths.");
  }
  if (/^[A-Za-z]:/.test(path)) invalidInput("Customer config source paths must be relative POSIX paths.");
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    invalidInput("Customer config source paths may not contain empty, dot, or dot-dot segments.");
  }
}

export function fingerprintCustomerConfigSources(sources: readonly CustomerConfigSource[]): string {
  if (!Array.isArray(sources)) invalidInput("Customer config sources must be an array.");

  const sorted = [...sources].sort((left, right) => compareStrings(left.path, right.path));
  const paths = new Set<string>();
  const hash = createHash("sha256");
  for (const source of sorted) {
    validateSourcePath(source.path);
    if (paths.has(source.path)) invalidInput("Customer config source paths must be unique.");
    paths.add(source.path);
    if (typeof source.content !== "string" && !(source.content instanceof Uint8Array)) {
      invalidInput("Customer config source content must be text or bytes.");
    }
    // ponytail: Gate 1 never executes config; reject direct ambient inputs until the CLI owns a full sandbox.
    if (typeof source.content === "string" && forbiddenCustomerConfigInputs.some((pattern) => pattern.test(source.content))) {
      invalidInput(`Customer config source ${source.path} contains a non-hermetic input.`);
    }
    hash.update(Buffer.from(source.path, "utf8"));
    hash.update(Buffer.of(0));
    hash.update(typeof source.content === "string" ? Buffer.from(source.content, "utf8") : Buffer.from(source.content));
    hash.update(Buffer.of(0));
  }
  return `sha256:${hash.digest("hex")}`;
}

function sortedUnique(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...new Set(values ?? [])].sort(compareStrings));
}

const contributionKinds = [
  "contracts",
  "schema",
  "behavior",
  "jobs",
  "dataSources",
  "actions",
  "tools",
  "blocks",
  "navigation",
  "admin"
] as const;

type NormalizedContributions = Readonly<Partial<Record<(typeof contributionKinds)[number], readonly string[]>>>;

function normalizeContributions(manifest: PluginManifest): NormalizedContributions {
  const contributions = manifest.contributions;
  const normalized = Object.fromEntries(
    contributionKinds
      .filter((kind) => contributions?.[kind] !== undefined)
      .map((kind) => [kind, sortedUnique(contributions?.[kind])])
  ) as NormalizedContributions;
  return Object.freeze(normalized);
}

function normalizeLifecycle(manifest: PluginManifest): PluginManifest["lifecycle"] {
  return {
    disable: manifest.lifecycle.disable,
    ownsPayloadSchema: manifest.lifecycle.ownsPayloadSchema,
    ownsPersistentData: manifest.lifecycle.ownsPersistentData,
    purge: manifest.lifecycle.purge,
    uninstall: manifest.lifecycle.uninstall
  } as PluginManifest["lifecycle"];
}

function normalizeEnvironment(manifest: PluginManifest): readonly string[] {
  return sortedUnique(manifest.environment?.map(({ name }) => name));
}

function normalizeNode(node: ResolvedPluginNode): ResolvedPluginNode {
  return {
    id: node.id,
    kind: node.kind,
    package: node.package,
    version: node.version,
    integrity: node.integrity,
    required: sortedUnique(node.required),
    optional: sortedUnique(node.optional)
  };
}

function normalizeGraph(graph: ResolvedPluginGraph): ResolvedPluginGraph {
  return {
    resolverVersion: graph.resolverVersion,
    plugins: [...graph.plugins].map(normalizeNode).sort((left, right) => compareStrings(left.id, right.id)),
    capabilityProviders: [...graph.capabilityProviders].sort((left, right) => compareStrings(
      `${left.capability}\u0000${left.plugin}\u0000${left.version}`,
      `${right.capability}\u0000${right.plugin}\u0000${right.version}`
    )),
    registrationOrder: [...graph.registrationOrder]
  };
}

function validateFramework(framework: StaticArtifactFrameworkTuple): void {
  if (!framework || framework.core !== supportedFrameworkTuple.core || framework.payload !== supportedFrameworkTuple.payload || framework.node !== supportedFrameworkTuple.node || framework.pnpm !== supportedFrameworkTuple.pnpm || framework.payloadDatabaseAdapter !== supportedFrameworkTuple.payloadDatabaseAdapter) {
    invalidInput("The framework tuple is not supported by this K-Nex release.");
  }
}

function validateRuntime(input: StaticArtifactGenerationInput): void {
  if (
    input.framework.node !== input.applicationManifest.runtime.node ||
    input.framework.pnpm !== input.applicationManifest.runtime.packageManagerVersion
  ) {
    invalidInput("The framework tuple does not match the application runtime.");
  }
}

function validateFingerprint(fingerprint: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) invalidInput("The customer config fingerprint must be a SHA-256 digest.");
}

function validatePluginCompatibility(
  framework: StaticArtifactFrameworkTuple,
  graph: ResolvedPluginGraph,
  installedById: ReadonlyMap<string, InstalledPluginManifest>
): void {
  for (const node of graph.plugins) {
    const installed = installedById.get(node.id);
    if (!installed) continue;
    const compatibility = installed.manifest.compatibility;
    const versions = [
      ["core", framework.core, compatibility.core],
      ["payload", framework.payload, compatibility.payload],
      ["node", framework.node, compatibility.node]
    ] as const;
    if (compatibility.payloadDatabaseAdapters.includes("postgres") === false || versions.some(([, version, range]) => semver.validRange(range, { loose: false }) === null || !semver.satisfies(version, range, { loose: false }))) {
      graphMismatch(`Resolved plugin ${node.id} is incompatible with the framework tuple.`);
    }
  }
}

function reconcileInstalled(
  graph: ResolvedPluginGraph,
  installed: readonly InstalledPluginManifest[]
): ReadonlyMap<string, InstalledPluginManifest> {
  const byId = new Map<string, InstalledPluginManifest>();
  const byPackage = new Map<string, InstalledPluginManifest>();
  for (const entry of installed) {
    const id = entry.manifest.id;
    if (byId.has(id) || byPackage.has(entry.package.name)) graphMismatch("Installed plugin identities must be unique.");
    if (entry.manifest.package !== entry.package.name || entry.manifest.version !== entry.package.version) {
      graphMismatch(`Installed plugin ${id} has inconsistent package identity.`);
    }
    byId.set(id, entry);
    byPackage.set(entry.package.name, entry);
  }

  const seen = new Set<string>();
  const nodes = [...graph.plugins].map(normalizeNode).sort((left, right) => compareStrings(left.id, right.id));
  for (const node of nodes) {
    if (seen.has(node.id)) graphMismatch(`Resolved plugin ${node.id} is declared more than once.`);
    seen.add(node.id);
    const entry = byId.get(node.id);
    if (!entry || entry.package.name !== node.package || entry.package.version !== node.version || entry.package.integrity !== node.integrity || entry.manifest.kind !== node.kind) {
      graphMismatch(`Resolved plugin ${node.id} does not match an installed plugin identity.`);
    }
  }
  return byId;
}

function validateGraphReferences(graph: ResolvedPluginGraph): void {
  const ids = new Set(graph.plugins.map(({ id }) => id));
  const order = graph.registrationOrder;
  if (new Set(order).size !== order.length || order.length !== ids.size || order.some((id) => !ids.has(id))) {
    graphMismatch("Resolved registration order does not contain exactly the resolved plugins.");
  }
  const providers = new Set<string>();
  const capabilityProviders = [...graph.capabilityProviders].sort((left, right) => compareStrings(
    `${left.capability}\u0000${left.plugin}\u0000${left.version}`,
    `${right.capability}\u0000${right.plugin}\u0000${right.version}`
  ));
  for (const provider of capabilityProviders) {
    if (!ids.has(provider.plugin)) graphMismatch(`Capability provider ${provider.plugin} is not resolved.`);
    const key = `${provider.capability}\u0000${provider.plugin}`;
    if (providers.has(key)) graphMismatch("Resolved capability providers must be unique.");
    providers.add(key);
  }
}

interface ResolvedPluginDocument {
  readonly id: string;
  readonly kind: string;
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
  readonly manifestDigest: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly contributions: NormalizedContributions;
  readonly lifecycle: PluginManifest["lifecycle"];
  readonly environment: Readonly<{ readonly names: readonly string[] }>;
}

function pluginDocument(node: ResolvedPluginNode, installed: InstalledPluginManifest): ResolvedPluginDocument {
  return {
    id: node.id,
    kind: node.kind,
    package: node.package,
    version: node.version,
    integrity: node.integrity,
    manifestDigest: digestJson(installed.manifest),
    required: sortedUnique(node.required),
    optional: sortedUnique(node.optional),
    contributions: normalizeContributions(installed.manifest),
    lifecycle: normalizeLifecycle(installed.manifest),
    environment: { names: normalizeEnvironment(installed.manifest) }
  };
}

function environmentNames(manifest: ApplicationManifest, plugins: readonly ResolvedPluginDocument[]): readonly string[] {
  const names = new Set<string>(manifest.environment.required);
  for (const plugin of plugins) for (const name of plugin.environment.names) names.add(name);
  return Object.freeze([...names].sort(compareStrings));
}

function literal(value: unknown): string {
  return JSON.stringify(value);
}

function generatePluginRegistry(plugins: readonly ResolvedPluginDocument[]): string {
  const imports = plugins.map((plugin, index) => `import manifest${index} from ${literal(`${plugin.package}/manifest`)} with { type: "json" };`);
  const entries = plugins.map((plugin, index) => `  ${literal(plugin.id)}: manifest${index},`);
  return `${imports.length > 0 ? `${imports.join("\n")}\n\n` : ""}export const pluginRegistry = {\n${entries.join("\n")}\n} as const;\n\nexport default pluginRegistry;\n`;
}

function generateServerRegistry(
  plugins: readonly ResolvedPluginDocument[],
  include: (plugin: ResolvedPluginDocument) => boolean,
  name: "payloadContributions" | "runtimeRegistration"
): string {
  const selected = plugins.filter(include);
  const imports = selected.map((plugin, index) => `import * as server${index} from ${literal(`${plugin.package}/server`)};`);
  const entries = selected.map((plugin, index) => `  ${literal(plugin.id)}: server${index},`);
  return `${imports.length > 0 ? `${imports.join("\n")}\n\n` : ""}export const ${name} = {\n${entries.join("\n")}\n} as const;\n\nexport default ${name};\n`;
}

function generateEnvironmentSchema(names: readonly string[]): string {
  const entries = names.map((name) => `  ${literal(name)}: { type: "string" },`);
  return `export const environmentSchema = {\n${entries.join("\n")}\n} as const;\n\nexport default environmentSchema;\n`;
}

export function generateStaticArtifacts(input: StaticArtifactGenerationInput): ReadonlyMap<GeneratedArtifactPath, string> {
  if (!input || !input.applicationManifest || !input.resolvedGraph) invalidInput("Static artifact generation input is incomplete.");
  if (input.applicationManifest.builder !== undefined) invalidInput("Builder composition is not supported by the Gate 1 static artifact generator.");
  validateRuntime(input);
  validateFramework(input.framework);
  validateFingerprint(input.customerConfigFingerprint);
  const graph = normalizeGraph(input.resolvedGraph);
  const expectedGraph = normalizeGraph(resolvePluginGraph({
    plugins: input.applicationManifest.plugins,
    providers: input.applicationManifest.providers,
    installed: input.installed
  }));
  if (canonicalJson(graph) !== canonicalJson(expectedGraph)) {
    graphMismatch("The resolved plugin graph does not match the application manifest.");
  }
  const installedById = reconcileInstalled(graph, input.installed);
  validateGraphReferences(graph);
  validatePluginCompatibility(input.framework, graph, installedById);

  const plugins = graph.plugins
    .map((node) => {
      const installed = installedById.get(node.id);
      if (!installed) graphMismatch(`Resolved plugin ${node.id} does not match an installed plugin identity.`);
      return pluginDocument(node, installed);
    });
  const names = environmentNames(input.applicationManifest, plugins);
  const resolvedDocument = {
    schemaVersion: 1,
    resolverVersion: graph.resolverVersion,
    application: {
      id: input.applicationManifest.application.id,
      manifestDigest: digestJson(input.applicationManifest)
    },
    runtime: input.applicationManifest.runtime,
    framework: {
      core: input.framework.core,
      payload: input.framework.payload,
      node: input.framework.node,
      pnpm: input.framework.pnpm,
      payloadDatabaseAdapter: input.framework.payloadDatabaseAdapter
    },
    customerConfigFingerprint: input.customerConfigFingerprint,
    plugins,
    capabilityProviders: graph.capabilityProviders,
    registrationOrder: graph.registrationOrder,
    environment: { names }
  };

  const output = new Map<GeneratedArtifactPath, string>();
  output.set(generatedArtifactPathValues[0], canonicalJson(resolvedDocument));
  output.set(generatedArtifactPathValues[1], generatePluginRegistry(plugins));
  output.set(generatedArtifactPathValues[2], generateServerRegistry(plugins, (plugin) => (plugin.contributions.schema?.length ?? 0) > 0, "payloadContributions"));
  output.set(generatedArtifactPathValues[3], generateServerRegistry(plugins, () => true, "runtimeRegistration"));
  output.set(generatedArtifactPathValues[4], generateEnvironmentSchema(names));
  return output;
}

export function writeStaticArtifacts(
  root: string,
  input: StaticArtifactGenerationInput,
  options: Readonly<{ readonly check?: boolean }> = {}
): StaticArtifactWriteReport {
  const check = options.check === true;
  if (typeof root !== "string" || root.length === 0) invalidInput("The artifact root is required.");
  const artifacts = generateStaticArtifacts(input);
  const missing: GeneratedArtifactPath[] = [];
  const stale: GeneratedArtifactPath[] = [];
  for (const path of generatedArtifactPathValues) {
    const target = resolve(root, path);
    if (check) {
      let actual: string;
      try {
        actual = readFileSync(target, "utf8");
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") missing.push(path);
        else stale.push(path);
        continue;
      }
      if (actual !== artifacts.get(path)) stale.push(path);
      continue;
    }
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, artifacts.get(path)!, "utf8");
    } catch {
      throw new StaticArtifactGenerationError("INVALID_INPUT", "Static artifacts could not be written.");
    }
  }
  const report: StaticArtifactWriteReport = {
    written: check ? [] : [...generatedArtifactPathValues],
    missing: Object.freeze(missing),
    stale: Object.freeze(stale)
  };
  return report;
}
