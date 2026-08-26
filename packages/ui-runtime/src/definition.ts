import {
  DataSourceDescriptorSchema,
  DataSourcePrimaryContractSchema,
  ResourceIdSchema,
  TableFieldIdSchema,
  uiDocumentProfiles,
  type DataSourceDescriptor,
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
  if (definition.audience === "public" && definition.profiles.some((profile) => profile !== "cms")) {
    throw new TypeError("Public UI blocks are limited to the CMS profile.");
  }
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

export function createUiRuntimeRegistry(input: {
  readonly blocks: readonly UiBlockDefinition[];
  readonly sources: readonly DataSourceDescriptor[];
}): UiRuntimeRegistry {
  const blockMap = new Map<string, UiBlockDefinition>();
  const sourceMap = new Map<string, DataSourceDescriptor>();

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
    sourceMap.set(key, descriptor);
  }

  const blocks = Object.freeze([...blockMap.values()]);
  const sources = Object.freeze([...sourceMap.values()]);
  return Object.freeze({
    blocks,
    sources,
    resolveBlock: (id: string, version: number) => blockMap.get(keyOf(id, version)),
    resolveSource: (id: string, version: number) => sourceMap.get(keyOf(id, version))
  });
}
