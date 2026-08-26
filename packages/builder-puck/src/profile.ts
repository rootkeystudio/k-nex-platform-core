import { DataSourceDescriptorSchema, ResourceIdSchema, UiDocumentSchema, uiDocumentProfiles, type DataSourceDescriptor, type UiDocument, type UiDocumentProfile, type UiNode } from "@k-nex/contracts";

import { createPuckBuilderAdapter, type PuckBlockBridge, type PuckBuilderAdapter } from "./adapter.js";

export interface PuckProfileResource {
  readonly id: string;
  readonly version: number;
}

export interface PuckBuilderProfile {
  readonly id: UiDocumentProfile;
  readonly blocks: readonly PuckProfileResource[];
  readonly sources: readonly PuckProfileResource[];
  readonly actions: readonly PuckProfileResource[];
  readonly publication: "draft-preview-publish" | "save-layout";
}

export interface ResolvedPuckBuilderProfile {
  readonly policy: PuckBuilderProfile;
  readonly adapter: PuckBuilderAdapter;
  validateDocument(value: unknown): UiDocument;
  allowsSource(id: string, version: number): boolean;
  allowsAction(id: string, version: number): boolean;
}

export interface PuckBuilderProfileRegistry {
  resolve(profile: UiDocumentProfile): ResolvedPuckBuilderProfile | undefined;
}

const profiles = new Set<UiDocumentProfile>(uiDocumentProfiles);
const keyOf = ({ id, version }: PuckProfileResource): string => `${id}@${version}`;

function assertResources(resources: readonly PuckProfileResource[], label: string): void {
  const keys = resources.map(keyOf);
  if (new Set(keys).size !== keys.length || resources.some(({ id, version }) =>
    !ResourceIdSchema.safeParse(id).success || !Number.isSafeInteger(version) || version < 1)) {
    throw new TypeError(`${label} must contain unique canonical resource identities.`);
  }
}

function copyProfile(profile: PuckBuilderProfile): PuckBuilderProfile {
  return Object.freeze({
    ...profile,
    blocks: Object.freeze(profile.blocks.map((resource) => Object.freeze({ ...resource }))),
    sources: Object.freeze(profile.sources.map((resource) => Object.freeze({ ...resource }))),
    actions: Object.freeze(profile.actions.map((resource) => Object.freeze({ ...resource })))
  });
}

function assertDocumentPolicy(
  value: unknown,
  policy: PuckBuilderProfile,
  blockDefinitions: ReadonlyMap<string, PuckBlockBridge>,
  sourceKeys: ReadonlySet<string>
): UiDocument {
  const document = UiDocumentSchema.parse(value);
  if (document.profile !== policy.id) throw new TypeError(`Puck ${policy.id} profile cannot edit a ${document.profile} document.`);
  const visit = (node: UiNode): void => {
    const bridge = blockDefinitions.get(`${node.type}@${node.version}`);
    if (bridge === undefined) {
      throw new TypeError(`Puck ${policy.id} profile forbids block ${node.type}@${node.version}.`);
    }
    if (bridge.definition.propsSchema.safeParse(node.props).success !== true) {
      throw new TypeError(`Puck ${policy.id} profile rejects props for ${node.type}@${node.version}.`);
    }
    const source = node.bindings?.source?.source;
    if (source !== undefined && !sourceKeys.has(`${source.id}@${source.version}`)) {
      throw new TypeError(`Puck ${policy.id} profile forbids source ${source.id}@${source.version}.`);
    }
    node.children?.forEach(visit);
  };
  Object.values(document.regions).forEach((nodes) => nodes.forEach(visit));
  return document;
}

export function createPuckBuilderProfileRegistry(input: {
  readonly blocks: readonly PuckBlockBridge[];
  readonly sources: readonly DataSourceDescriptor[];
  readonly profiles: readonly PuckBuilderProfile[];
  readonly canvasRegion?: string;
}): PuckBuilderProfileRegistry {
  const bridgeMap = new Map(input.blocks.map((bridge) => [`${bridge.definition.id}@${bridge.definition.version}`, bridge]));
  if (bridgeMap.size !== input.blocks.length) throw new TypeError("Puck block bridges must be unique before profile resolution.");
  const sourceMap = new Map<string, DataSourceDescriptor>();
  for (const candidate of input.sources) {
    const parsed = DataSourceDescriptorSchema.safeParse(candidate);
    if (!parsed.success) throw new TypeError("Puck profile sources must satisfy the canonical descriptor contract.");
    const key = keyOf(parsed.data);
    if (sourceMap.has(key)) throw new TypeError("Puck profile sources must be unique.");
    sourceMap.set(key, Object.freeze(structuredClone(parsed.data)));
  }
  const resolved = new Map<UiDocumentProfile, ResolvedPuckBuilderProfile>();

  for (const candidate of input.profiles) {
    if (!profiles.has(candidate.id) || resolved.has(candidate.id)) throw new TypeError("Puck builder profile IDs must be recognized and unique.");
    assertResources(candidate.blocks, "Puck profile blocks");
    assertResources(candidate.sources, "Puck profile sources");
    assertResources(candidate.actions, "Puck profile actions");
    const expectedPublication = candidate.id === "cms" ? "draft-preview-publish" : "save-layout";
    if (candidate.publication !== expectedPublication) throw new TypeError(`Puck ${candidate.id} publication policy is invalid.`);
    const selectedBridges = candidate.blocks.map((resource) => {
      const bridge = bridgeMap.get(keyOf(resource));
      if (bridge === undefined) throw new TypeError(`Puck profile references an unknown block: ${keyOf(resource)}.`);
      return bridge;
    });
    for (const bridge of selectedBridges) {
      if (!bridge.definition.profiles.includes(candidate.id)) {
        throw new TypeError(`Puck ${candidate.id} profile cannot allow block ${bridge.definition.id}@${bridge.definition.version}.`);
      }
    }
    for (const resource of candidate.sources) {
      const source = sourceMap.get(keyOf(resource));
      if (source === undefined) throw new TypeError(`Puck profile references an unknown source: ${keyOf(resource)}.`);
      const compatible = candidate.id === "cms"
        ? source.audience === "public" && source.surfaces.includes("public")
        : source.surfaces.includes("workspace");
      if (!compatible) throw new TypeError(`Puck ${candidate.id} profile cannot allow source ${keyOf(resource)}.`);
    }
    const policy = copyProfile(candidate);
    const blockDefinitions = new Map(selectedBridges.map((bridge) => [keyOf(bridge.definition), bridge]));
    const sourceKeys = new Set(policy.sources.map(keyOf));
    const actionKeys = new Set(policy.actions.map(keyOf));
    const baseAdapter = createPuckBuilderAdapter({ blocks: selectedBridges, ...(input.canvasRegion === undefined ? {} : { canvasRegion: input.canvasRegion }) });
    const adapter: PuckBuilderAdapter = Object.freeze({
      config: baseAdapter.config,
      toPuckData: (document: unknown) => baseAdapter.toPuckData(assertDocumentPolicy(document, policy, blockDefinitions, sourceKeys)),
      fromPuckData: (data: unknown) => assertDocumentPolicy(baseAdapter.fromPuckData(data), policy, blockDefinitions, sourceKeys)
    });
    resolved.set(policy.id, Object.freeze({
      policy,
      adapter,
      validateDocument: (value: unknown) => assertDocumentPolicy(value, policy, blockDefinitions, sourceKeys),
      allowsSource: (id: string, version: number) => sourceKeys.has(`${id}@${version}`),
      allowsAction: (id: string, version: number) => actionKeys.has(`${id}@${version}`)
    }));
  }

  return Object.freeze({ resolve: (profile: UiDocumentProfile) => resolved.get(profile) });
}
