import { ResourceIdSchema, UiDocumentSchema, uiDocumentProfiles, type UiDocument, type UiDocumentProfile, type UiNode } from "@k-nex/contracts";

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

function assertDocumentPolicy(value: unknown, policy: PuckBuilderProfile, sourceKeys: ReadonlySet<string>): UiDocument {
  const document = UiDocumentSchema.parse(value);
  if (document.profile !== policy.id) throw new TypeError(`Puck ${policy.id} profile cannot edit a ${document.profile} document.`);
  const visit = (node: UiNode): void => {
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
  readonly profiles: readonly PuckBuilderProfile[];
  readonly canvasRegion?: string;
}): PuckBuilderProfileRegistry {
  const bridgeMap = new Map(input.blocks.map((bridge) => [`${bridge.id}@${bridge.version}`, bridge]));
  if (bridgeMap.size !== input.blocks.length) throw new TypeError("Puck block bridges must be unique before profile resolution.");
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
    const policy = copyProfile(candidate);
    const sourceKeys = new Set(policy.sources.map(keyOf));
    const actionKeys = new Set(policy.actions.map(keyOf));
    const baseAdapter = createPuckBuilderAdapter({ blocks: selectedBridges, ...(input.canvasRegion === undefined ? {} : { canvasRegion: input.canvasRegion }) });
    const adapter: PuckBuilderAdapter = Object.freeze({
      config: baseAdapter.config,
      toPuckData: (document: unknown) => baseAdapter.toPuckData(assertDocumentPolicy(document, policy, sourceKeys)),
      fromPuckData: (data: unknown) => assertDocumentPolicy(baseAdapter.fromPuckData(data), policy, sourceKeys)
    });
    resolved.set(policy.id, Object.freeze({
      policy,
      adapter,
      allowsSource: (id: string, version: number) => sourceKeys.has(`${id}@${version}`),
      allowsAction: (id: string, version: number) => actionKeys.has(`${id}@${version}`)
    }));
  }

  return Object.freeze({ resolve: (profile: UiDocumentProfile) => resolved.get(profile) });
}
