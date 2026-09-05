import { canonicalJson, DataSourceDescriptorSchema, ResourceIdSchema, UiDocumentSchema, UiLayoutConstraintsSchema, uiDocumentProfiles, type DataSourceDescriptor, type UiDocument, type UiDocumentProfile, type UiLayoutConstraints, type UiNode } from "@k-nex/contracts";
import { createUiDocumentRuntime, createUiRuntimeRegistry, inspectUiDocumentReadiness } from "@k-nex/ui-runtime";

import { createPuckBuilderAdapter, snapshotPuckBlockBridge, type PuckBlockBridge, type PuckBuilderAdapter, type PuckPreviewContext } from "./adapter.js";

export interface PuckProfileResource {
  readonly id: string;
  readonly version: number;
}

export interface PuckProfileBlockResource extends PuckProfileResource {
  readonly constraints?: UiLayoutConstraints;
}

export interface PuckBuilderProfile {
  readonly id: UiDocumentProfile;
  readonly blocks: readonly PuckProfileBlockResource[];
  readonly sources: readonly PuckProfileResource[];
  readonly actions: readonly PuckProfileResource[];
  readonly publication: "draft-preview-publish" | "save-layout";
}

export interface ResolvedPuckBuilderProfile {
  readonly policy: PuckBuilderProfile;
  readonly adapter: PuckBuilderAdapter;
  validateDocument(value: unknown): UiDocument;
  validateChange(previous: unknown, next: unknown): UiDocument;
  allowsSource(id: string, version: number): boolean;
  allowsAction(id: string, version: number): boolean;
}

export interface PuckBuilderProfileRegistry {
  resolve(profile: UiDocumentProfile): ResolvedPuckBuilderProfile | undefined;
}

export type PuckProfilePreviewContext = Omit<PuckPreviewContext, "sources">;

const profiles = new Set<UiDocumentProfile>(uiDocumentProfiles);
const keyOf = ({ id, version }: PuckProfileResource): string => `${id}@${version}`;

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

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
    blocks: Object.freeze(profile.blocks.map((resource) => Object.freeze({
      ...resource,
      ...(resource.constraints === undefined ? {} : { constraints: deepFreeze(structuredClone(resource.constraints)) })
    }))),
    sources: Object.freeze(profile.sources.map((resource) => Object.freeze({ ...resource }))),
    actions: Object.freeze(profile.actions.map((resource) => Object.freeze({ ...resource })))
  });
}

function combineConstraints(left?: UiLayoutConstraints, right?: UiLayoutConstraints): UiLayoutConstraints | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const intersect = (a?: readonly string[], b?: readonly string[]) => a === undefined ? b === undefined ? undefined : [...b] : b === undefined ? [...a] : a.filter((value) => b.includes(value));
  const editableFields = intersect(left.editableFields, right.editableFields);
  const allowedChildren = intersect(left.allowedChildren, right.allowedChildren);
  const minChildren = left.minChildren === undefined ? right.minChildren : right.minChildren === undefined ? left.minChildren : Math.max(left.minChildren, right.minChildren);
  const maxChildren = left.maxChildren === undefined ? right.maxChildren : right.maxChildren === undefined ? left.maxChildren : Math.min(left.maxChildren, right.maxChildren);
  return {
    locked: left.locked === true || right.locked === true,
    canDelete: left.canDelete !== false && right.canDelete !== false,
    canMove: left.canMove !== false && right.canMove !== false,
    canResize: left.canResize !== false && right.canResize !== false,
    ...(editableFields === undefined ? {} : { editableFields }),
    ...(allowedChildren === undefined ? {} : { allowedChildren }),
    ...(minChildren === undefined ? {} : { minChildren }),
    ...(maxChildren === undefined ? {} : { maxChildren })
  };
}

function effectiveConstraints(bridge: PuckBlockBridge, node: UiNode): UiLayoutConstraints | undefined {
  return combineConstraints(bridge.constraints, node.layout?.constraints);
}

interface NodeLocation {
  readonly node: UiNode;
  readonly position: string;
}

function nodeLocations(document: UiDocument): ReadonlyMap<string, NodeLocation> {
  const locations = new Map<string, NodeLocation>();
  const visit = (node: UiNode, path: readonly (string | number)[], index: number): void => {
    const position = [...path, index];
    locations.set(node.id, { node, position: canonicalJson(position) });
    node.children?.forEach((child, childIndex) => visit(child, [...position, node.id, "children"], childIndex));
  };
  Object.entries(document.regions).forEach(([region, nodes]) => nodes.forEach((node, index) => visit(node, ["region", region], index)));
  return locations;
}

function assertStructuralConstraints(document: UiDocument, blockDefinitions: ReadonlyMap<string, PuckBlockBridge>): void {
  const visit = (node: UiNode): void => {
    const bridge = blockDefinitions.get(`${node.type}@${node.version}`)!;
    const constraints = effectiveConstraints(bridge, node);
    const children = node.children ?? [];
    if (constraints?.minChildren !== undefined && children.length < constraints.minChildren) throw new TypeError(`Block ${node.id} has too few children.`);
    if (constraints?.maxChildren !== undefined && children.length > constraints.maxChildren) throw new TypeError(`Block ${node.id} has too many children.`);
    if (constraints?.allowedChildren !== undefined && children.some((child) => !constraints.allowedChildren!.includes(child.type))) {
      throw new TypeError(`Block ${node.id} contains a forbidden child.`);
    }
    children.forEach(visit);
  };
  Object.values(document.regions).forEach((nodes) => nodes.forEach(visit));
}

function assertAuthorizedChange(
  previous: UiDocument,
  next: UiDocument,
  blockDefinitions: ReadonlyMap<string, PuckBlockBridge>,
  canvasRegion: string
): void {
  if (previous.id !== next.id || previous.version !== next.version || previous.profile !== next.profile || previous.schemaVersion !== next.schemaVersion) {
    throw new TypeError("Puck edits cannot replace canonical document identity.");
  }
  const regions = new Set([...Object.keys(previous.regions), ...Object.keys(next.regions)]);
  for (const region of regions) {
    if (region === canvasRegion) continue;
    if (Object.hasOwn(previous.regions, region) !== Object.hasOwn(next.regions, region) ||
        canonicalJson(previous.regions[region] ?? []) !== canonicalJson(next.regions[region] ?? [])) {
      throw new TypeError(`Puck edits cannot change non-canvas region ${region}.`);
    }
  }
  const before = nodeLocations(previous);
  const after = nodeLocations(next);
  for (const [id, prior] of before) {
    const bridge = blockDefinitions.get(`${prior.node.type}@${prior.node.version}`)!;
    const constraints = effectiveConstraints(bridge, prior.node);
    const current = after.get(id);
    if (current === undefined) {
      if (constraints?.locked || constraints?.canDelete === false) throw new TypeError(`Block ${id} cannot be deleted.`);
      continue;
    }
    if (current.node.type !== prior.node.type || current.node.version !== prior.node.version) throw new TypeError(`Block ${id} identity cannot be edited.`);
    if (canonicalJson(current.node.bindings ?? null) !== canonicalJson(prior.node.bindings ?? null) ||
        canonicalJson(current.node.layout ?? null) !== canonicalJson(prior.node.layout ?? null) ||
        canonicalJson(current.node.engineMetadata ?? null) !== canonicalJson(prior.node.engineMetadata ?? null)) {
      throw new TypeError(`Block ${id} protected metadata cannot be edited.`);
    }
    if ((constraints?.locked || constraints?.canMove === false) && current.position !== prior.position) {
      throw new TypeError(`Block ${id} cannot be moved.`);
    }
    const changedProps = new Set([...Object.keys(prior.node.props), ...Object.keys(current.node.props)]
      .filter((prop) => Object.hasOwn(prior.node.props, prop) !== Object.hasOwn(current.node.props, prop) ||
        canonicalJson(prior.node.props[prop] ?? null) !== canonicalJson(current.node.props[prop] ?? null)));
    const editable = constraints?.locked ? [] : constraints?.editableFields ?? bridge.fields.map(({ prop }) => prop);
    if ([...changedProps].some((prop) => !editable.includes(prop))) throw new TypeError(`Block ${id} contains a forbidden field edit.`);
  }
  for (const [id, current] of after) {
    if (before.has(id)) continue;
    const bridge = blockDefinitions.get(`${current.node.type}@${current.node.version}`)!;
    const editable = bridge.constraints?.locked ? [] : bridge.constraints?.editableFields ?? bridge.fields.map(({ prop }) => prop);
    const declared = new Set(bridge.fields.map(({ prop }) => prop));
    if (canonicalJson(current.node.bindings ?? null) !== canonicalJson(bridge.defaultBindings ?? null) || current.node.layout !== undefined || current.node.engineMetadata !== undefined ||
        Object.keys(current.node.props).some((prop) => !declared.has(prop))) {
      throw new TypeError(`Inserted block ${id} contains protected configuration.`);
    }
    for (const field of bridge.fields) {
      if (!editable.includes(field.prop) && canonicalJson(current.node.props[field.prop] ?? null) !== canonicalJson(bridge.defaultProps[field.prop] ?? null)) {
        throw new TypeError(`Inserted block ${id} contains a forbidden field value.`);
      }
    }
  }
  assertStructuralConstraints(next, blockDefinitions);
}

function assertDocumentPolicy(
  value: unknown,
  policy: PuckBuilderProfile,
  blockDefinitions: ReadonlyMap<string, PuckBlockBridge>,
  sourceKeys: ReadonlySet<string>,
  actionKeys: ReadonlySet<string>
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
    const action = node.bindings?.action;
    if (action !== undefined) {
      const accepted = bridge.definition.actionPolicy?.actions.some(({ id, version }) => id === action.id && version === action.version) === true;
      if (!accepted || !actionKeys.has(`${action.id}@${action.version}`)) {
        throw new TypeError(`Puck ${policy.id} profile forbids action ${action.id}@${action.version}.`);
      }
    }
    node.children?.forEach(visit);
  };
  Object.values(document.regions).forEach((nodes) => nodes.forEach(visit));
  assertStructuralConstraints(document, blockDefinitions);
  return document;
}

export function createPuckBuilderProfileRegistry(input: {
  readonly blocks: readonly PuckBlockBridge[];
  readonly sources: readonly DataSourceDescriptor[];
  readonly profiles: readonly PuckBuilderProfile[];
  readonly canvasRegion?: string;
  readonly preview?: Partial<Record<UiDocumentProfile, PuckProfilePreviewContext>>;
}): PuckBuilderProfileRegistry {
  const canvasRegion = input.canvasRegion ?? "main";
  const bridgeMap = new Map(input.blocks.map(snapshotPuckBlockBridge).map((bridge) => [`${bridge.definition.id}@${bridge.definition.version}`, bridge]));
  if (bridgeMap.size !== input.blocks.length) throw new TypeError("Puck block bridges must be unique before profile resolution.");
  const sourceMap = new Map<string, DataSourceDescriptor>();
  for (const candidate of input.sources) {
    const parsed = DataSourceDescriptorSchema.safeParse(candidate);
    if (!parsed.success) throw new TypeError("Puck profile sources must satisfy the canonical descriptor contract.");
    const key = keyOf(parsed.data);
    if (sourceMap.has(key)) throw new TypeError("Puck profile sources must be unique.");
    sourceMap.set(key, deepFreeze(structuredClone(parsed.data)));
  }
  const resolved = new Map<UiDocumentProfile, ResolvedPuckBuilderProfile>();

  for (const candidate of input.profiles) {
    if (!profiles.has(candidate.id) || resolved.has(candidate.id)) throw new TypeError("Puck builder profile IDs must be recognized and unique.");
    assertResources(candidate.blocks, "Puck profile blocks");
    assertResources(candidate.sources, "Puck profile sources");
    assertResources(candidate.actions, "Puck profile actions");
    for (const block of candidate.blocks) {
      if (block.constraints !== undefined && !UiLayoutConstraintsSchema.safeParse(block.constraints).success) {
        throw new TypeError("Puck profile block constraints must satisfy the canonical contract.");
      }
    }
    const expectedPublication = candidate.id === "cms" ? "draft-preview-publish" : "save-layout";
    if (candidate.publication !== expectedPublication) throw new TypeError(`Puck ${candidate.id} publication policy is invalid.`);
    const selectedBridges = candidate.blocks.map((resource) => {
      const bridge = bridgeMap.get(keyOf(resource));
      if (bridge === undefined) throw new TypeError(`Puck profile references an unknown block: ${keyOf(resource)}.`);
      const constraints = combineConstraints(bridge.constraints, resource.constraints);
      return constraints === undefined ? bridge : snapshotPuckBlockBridge({ ...bridge, constraints });
    });
    for (const bridge of selectedBridges) {
      if (!bridge.definition.profiles.includes(candidate.id)) {
        throw new TypeError(`Puck ${candidate.id} profile cannot allow block ${bridge.definition.id}@${bridge.definition.version}.`);
      }
      const compatible = candidate.id === "cms"
        ? bridge.definition.audience === "public" && bridge.definition.surfaces.includes("public")
        : bridge.definition.surfaces.includes("workspace");
      if (!compatible) throw new TypeError(`Puck ${candidate.id} profile cannot allow block ${bridge.definition.id}@${bridge.definition.version} on its publication surface.`);
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
    const selectedSources = policy.sources.map((resource) => sourceMap.get(keyOf(resource))!);
    const expectedSurface = policy.id === "cms" ? "public" : "workspace";
    const configuredPreview = input.preview?.[policy.id];
    if (configuredPreview !== undefined && configuredPreview.surface !== expectedSurface) {
      throw new TypeError(`Puck ${policy.id} preview must use the ${expectedSurface} surface.`);
    }
    const preview: PuckPreviewContext | undefined = configuredPreview === undefined
      ? undefined
      : { ...configuredPreview, sources: selectedSources };
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({
      blocks: selectedBridges.map(({ definition }) => definition),
      sources: selectedSources
    }));
    const publicationPermissions = new Set<string>([
      ...selectedBridges.flatMap(({ definition }) => definition.permission === undefined ? [] : [definition.permission]),
      ...selectedSources.flatMap((source) => [source.permission, ...(source.outputFields ?? []).map(({ permission }) => permission)])
    ]);
    const validatePublication = (value: unknown): UiDocument => {
      const document = assertDocumentPolicy(value, policy, blockDefinitions, sourceKeys, actionKeys);
      const result = runtime.render({
        document,
        surface: policy.id === "cms" ? "public" : "workspace",
        actor: policy.id === "cms"
          ? { authenticated: false, permissions: new Set() }
          : { authenticated: true, permissions: publicationPermissions }
      });
      const readiness = inspectUiDocumentReadiness(result);
      if (!readiness.ready) throw new TypeError(`Puck ${policy.id} publication is not runtime-ready: ${readiness.issues.map(({ code }) => code).join(", ")}.`);
      return document;
    };
    const baseAdapter = createPuckBuilderAdapter({
      blocks: selectedBridges,
      ...(preview === undefined ? {} : { preview }),
      ...(input.canvasRegion === undefined ? {} : { canvasRegion: input.canvasRegion })
    });
    const adapter: PuckBuilderAdapter = Object.freeze({
      config: baseAdapter.config,
      toPuckData: (document: unknown) => baseAdapter.toPuckData(assertDocumentPolicy(document, policy, blockDefinitions, sourceKeys, actionKeys)),
      fromPuckData: (data: unknown) => assertDocumentPolicy(baseAdapter.fromPuckData(data), policy, blockDefinitions, sourceKeys, actionKeys)
    });
    resolved.set(policy.id, Object.freeze({
      policy,
      adapter,
      validateDocument: validatePublication,
      validateChange: (previous: unknown, next: unknown) => {
        const prior = assertDocumentPolicy(previous, policy, blockDefinitions, sourceKeys, actionKeys);
        const current = assertDocumentPolicy(next, policy, blockDefinitions, sourceKeys, actionKeys);
        assertAuthorizedChange(prior, current, blockDefinitions, canvasRegion);
        return current;
      },
      allowsSource: (id: string, version: number) => sourceKeys.has(`${id}@${version}`),
      allowsAction: (id: string, version: number) => actionKeys.has(`${id}@${version}`)
    }));
  }

  return Object.freeze({ resolve: (profile: UiDocumentProfile) => resolved.get(profile) });
}

export interface PuckBuilderAuthoritySnapshot {
  readonly blocks: readonly PuckProfileResource[];
  readonly sources: readonly PuckProfileResource[];
  readonly actions: readonly PuckProfileResource[];
}

function sourceSatisfiesBlock(source: DataSourceDescriptor, bridge: PuckBlockBridge): boolean {
  const policy = bridge.definition.sourcePolicy;
  if (policy === undefined) return false;
  return policy.contracts.some(({ id, version }) => source.primaryContract.id === id && source.primaryContract.version === version) &&
    policy.requiredFields.every((field) => source.outputFields?.some(({ id }) => id === field) === true);
}

/** Resolves the editor library from server-authorized exact resource identities. */
export function createAuthorizedPuckBuilderProfile(input: {
  readonly profile: UiDocumentProfile;
  readonly publication: PuckBuilderProfile["publication"];
  readonly blocks: readonly PuckBlockBridge[];
  readonly sources: readonly DataSourceDescriptor[];
  readonly authority: PuckBuilderAuthoritySnapshot;
  readonly preview?: PuckProfilePreviewContext;
  readonly canvasRegion?: string;
}): ResolvedPuckBuilderProfile {
  assertResources(input.authority.blocks, "Authorized Puck blocks");
  assertResources(input.authority.sources, "Authorized Puck sources");
  assertResources(input.authority.actions, "Authorized Puck actions");
  const allowedBlocks = new Set(input.authority.blocks.map(keyOf));
  const allowedSources = new Set(input.authority.sources.map(keyOf));
  const allowedActions = new Set(input.authority.actions.map(keyOf));
  const sources = input.sources.filter((source) => allowedSources.has(keyOf(source)));
  const blocks = input.blocks.filter((bridge) => {
    if (!allowedBlocks.has(keyOf(bridge.definition)) || !bridge.definition.profiles.includes(input.profile)) return false;
    const sourcePolicy = bridge.definition.sourcePolicy;
    if (sourcePolicy?.required === true && !sources.some((source) => sourceSatisfiesBlock(source, bridge))) return false;
    const actionPolicy = bridge.definition.actionPolicy;
    if (actionPolicy?.required === true && !actionPolicy.actions.some((action) => allowedActions.has(keyOf(action)))) return false;
    return true;
  });
  const profile: PuckBuilderProfile = {
    id: input.profile,
    blocks: blocks.map(({ definition }) => ({ id: definition.id, version: definition.version })),
    sources: sources.map(({ id, version }) => ({ id, version })),
    actions: input.authority.actions.map(({ id, version }) => ({ id, version })),
    publication: input.publication
  };
  const resolved = createPuckBuilderProfileRegistry({
    blocks,
    sources,
    profiles: [profile],
    ...(input.canvasRegion === undefined ? {} : { canvasRegion: input.canvasRegion }),
    ...(input.preview === undefined ? {} : { preview: { [input.profile]: input.preview } })
  }).resolve(input.profile);
  if (resolved === undefined) throw new TypeError("Authorized Puck profile could not be resolved.");
  return resolved;
}
