import {
  DataSourceDescriptorSchema,
  DataSourcePrimaryContractSchema,
  PluginIdSchema,
  ResourceIdSchema,
  TableFieldIdSchema,
  uiDocumentProfiles,
  type DataSourceDescriptor,
  type DataSourceBindingResult,
  type DataSourcePrimaryContract,
  type RuntimeSchema,
  type TableFieldId,
  type UiDocumentProfile,
  type UiNode
} from "@k-nex/contracts";

export type UiRuntimeSurface = "workspace" | "cms" | "public";

export interface UiRuntimeActor {
  readonly authenticated: boolean;
  readonly permissions: ReadonlySet<string>;
}

export interface UiBlockSourcePolicy {
  readonly required: boolean;
  readonly contracts: readonly DataSourcePrimaryContract[];
  readonly requiredFields: readonly TableFieldId[];
}

export interface UiBlockRenderInput {
  readonly node: UiNode;
  readonly props: unknown;
  readonly surface: UiRuntimeSurface;
  readonly actor: UiRuntimeActor;
  readonly source?: DataSourceDescriptor;
  readonly sourceResult?: DataSourceBindingResult<unknown>;
}

export type UiBlockRenderer<TResult = unknown> = (input: UiBlockRenderInput) => TResult;

export interface UiBlockDefinition<TResult = unknown> {
  readonly id: string;
  readonly version: number;
  readonly profiles: readonly UiDocumentProfile[];
  readonly surfaces: readonly UiRuntimeSurface[];
  readonly audience: "public" | "authenticated";
  readonly permission?: string;
  readonly propsSchema: RuntimeSchema;
  readonly sourcePolicy?: UiBlockSourcePolicy;
  readonly render: UiBlockRenderer<TResult>;
}

export interface UiRuntimeRegistry {
  readonly blocks: readonly UiBlockDefinition[];
  readonly sources: readonly DataSourceDescriptor[];
  resolveBlock(id: string, version: number): UiBlockDefinition | undefined;
  resolveSource(id: string, version: number): DataSourceDescriptor | undefined;
  inspectBlock(id: string, version: number): UiRuntimeCatalogInspection;
  inspectSource(id: string, version: number): UiRuntimeCatalogInspection;
}

export interface UiRuntimeCatalogEntry {
  readonly id: string;
  readonly version: number;
  readonly ownerPluginId: string;
}

export interface UiRuntimeCatalogInspection {
  readonly known: boolean;
  readonly exact: boolean;
  readonly ownerPluginId?: string;
  readonly availableVersions: readonly number[];
}

const surfaces = new Set<UiRuntimeSurface>(["workspace", "cms", "public"]);
const profiles = new Set<UiDocumentProfile>(uiDocumentProfiles);
const keyOf = (id: string, version: number): string => `${id}@${version}`;

function assertUniqueStrings(values: readonly string[], label: string): void {
  if (values.length === 0 || new Set(values).size !== values.length) throw new TypeError(`${label} must be nonempty and unique.`);
}

function assertBlockDefinition(definition: UiBlockDefinition): void {
  if (!ResourceIdSchema.safeParse(definition.id).success || !Number.isSafeInteger(definition.version) || definition.version < 1) {
    throw new TypeError("UI block identity must use a canonical ID and positive safe version.");
  }
  assertUniqueStrings(definition.profiles, "UI block profiles");
  assertUniqueStrings(definition.surfaces, "UI block surfaces");
  if (!definition.profiles.every((profile) => profiles.has(profile)) || !definition.surfaces.every((surface) => surfaces.has(surface))) {
    throw new TypeError("UI block profiles and surfaces must be recognized.");
  }
  if (definition.audience !== "public" && definition.audience !== "authenticated") {
    throw new TypeError("UI block audience must be recognized.");
  }
  const hasPublicSurface = definition.surfaces.includes("public");
  if ((definition.audience === "public") !== hasPublicSurface) throw new TypeError("Only public UI blocks may use the public surface.");
  if (definition.permission !== undefined && !ResourceIdSchema.safeParse(definition.permission).success) {
    throw new TypeError("UI block permission must be a canonical resource ID.");
  }
  if (typeof definition.propsSchema?.safeParse !== "function" || typeof definition.render !== "function") {
    throw new TypeError("UI block definitions require executable prop validation and rendering callbacks.");
  }
  if (definition.sourcePolicy === undefined) return;
  if (typeof definition.sourcePolicy.required !== "boolean") throw new TypeError("UI block source policy must declare whether a source is required.");

  const contractKeys = definition.sourcePolicy.contracts.map(({ id, version }) => keyOf(id, version));
  assertUniqueStrings(contractKeys, "UI block source contracts");
  if (!definition.sourcePolicy.contracts.every((contract) => DataSourcePrimaryContractSchema.safeParse(contract).success)) {
    throw new TypeError("UI block source contracts must be canonical.");
  }
  const requiredFields = definition.sourcePolicy.requiredFields;
  if (new Set(requiredFields).size !== requiredFields.length || !requiredFields.every((field) => TableFieldIdSchema.safeParse(field).success)) {
    throw new TypeError("UI block required source fields must be canonical and unique.");
  }
  if (requiredFields.length > 0 && !definition.sourcePolicy.contracts.some(({ id }) => id === "table.records")) {
    throw new TypeError("Required source fields need an accepted table.records contract.");
  }
}

function copyBlock(definition: UiBlockDefinition): UiBlockDefinition {
  return Object.freeze({
    ...definition,
    profiles: Object.freeze([...definition.profiles]),
    surfaces: Object.freeze([...definition.surfaces]),
    ...(definition.sourcePolicy === undefined ? {} : {
      sourcePolicy: Object.freeze({
        ...definition.sourcePolicy,
        contracts: Object.freeze(definition.sourcePolicy.contracts.map((contract) => Object.freeze({ ...contract }))),
        requiredFields: Object.freeze([...definition.sourcePolicy.requiredFields])
      })
    })
  });
}

function catalogMap(entries: readonly UiRuntimeCatalogEntry[], label: string): Map<string, UiRuntimeCatalogEntry> {
  const result = new Map<string, UiRuntimeCatalogEntry>();
  for (const entry of entries) {
    if (!ResourceIdSchema.safeParse(entry.id).success || !Number.isSafeInteger(entry.version) || entry.version < 1 || !PluginIdSchema.safeParse(entry.ownerPluginId).success) {
      throw new TypeError(`${label} catalog entries must use canonical identities.`);
    }
    const key = keyOf(entry.id, entry.version);
    if (result.has(key)) throw new TypeError(`${label} catalog entries must be unique.`);
    result.set(key, Object.freeze({ ...entry }));
  }
  return result;
}

function inspectCatalog(
  catalog: ReadonlyMap<string, UiRuntimeCatalogEntry>,
  available: readonly { readonly id: string; readonly version: number }[],
  id: string,
  version: number
): UiRuntimeCatalogInspection {
  const exactEntry = catalog.get(keyOf(id, version));
  const availableVersions = available.filter((entry) => entry.id === id).map((entry) => entry.version).sort((left, right) => left - right);
  const knownEntries = [...catalog.values()].filter((entry) => entry.id === id);
  const knownVersions = knownEntries.map((entry) => entry.version);
  const owners = new Set(knownEntries.map((entry) => entry.ownerPluginId));
  const ownerPluginId = exactEntry?.ownerPluginId ?? (owners.size === 1 ? knownEntries[0]?.ownerPluginId : undefined);
  return Object.freeze({
    known: exactEntry !== undefined || knownVersions.length > 0 || availableVersions.length > 0,
    exact: exactEntry !== undefined,
    ...(ownerPluginId === undefined ? {} : { ownerPluginId }),
    availableVersions: Object.freeze(availableVersions)
  });
}

export function createUiRuntimeRegistry(input: {
  readonly blocks: readonly UiBlockDefinition[];
  readonly sources: readonly DataSourceDescriptor[];
  readonly blockCatalog?: readonly UiRuntimeCatalogEntry[];
  readonly sourceCatalog?: readonly UiRuntimeCatalogEntry[];
}): UiRuntimeRegistry {
  const blockMap = new Map<string, UiBlockDefinition>();
  const sourceMap = new Map<string, DataSourceDescriptor>();
  const blockCatalog = catalogMap(input.blockCatalog ?? [], "UI block");
  const sourceCatalog = catalogMap(input.sourceCatalog ?? [], "UI source");

  for (const candidate of input.blocks) {
    assertBlockDefinition(candidate);
    const definition = copyBlock(candidate);
    const key = keyOf(definition.id, definition.version);
    if (blockMap.has(key)) throw new TypeError(`Duplicate UI block definition: ${key}.`);
    blockMap.set(key, definition);
  }
  for (const candidate of input.sources) {
    const parsed = DataSourceDescriptorSchema.safeParse(candidate);
    if (!parsed.success) throw new TypeError("UI runtime source descriptors must satisfy the canonical contract.");
    const descriptor = Object.freeze(structuredClone(parsed.data));
    const key = keyOf(descriptor.id, descriptor.version);
    if (sourceMap.has(key)) throw new TypeError(`Duplicate UI source descriptor: ${key}.`);
    const catalogEntry = sourceCatalog.get(key);
    if (catalogEntry !== undefined && catalogEntry.ownerPluginId !== descriptor.ownerPluginId) {
      throw new TypeError(`UI source catalog owner does not match ${key}.`);
    }
    sourceMap.set(key, descriptor);
  }

  const blocks = Object.freeze([...blockMap.values()]);
  const sources = Object.freeze([...sourceMap.values()]);
  return Object.freeze({
    blocks,
    sources,
    resolveBlock: (id: string, version: number) => blockMap.get(keyOf(id, version)),
    resolveSource: (id: string, version: number) => sourceMap.get(keyOf(id, version)),
    inspectBlock: (id: string, version: number) => inspectCatalog(blockCatalog, blocks, id, version),
    inspectSource: (id: string, version: number) => inspectCatalog(sourceCatalog, sources, id, version)
  });
}
