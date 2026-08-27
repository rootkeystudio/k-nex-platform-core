import {
  ResourceIdSchema,
  TableFieldIdSchema,
  UiDocumentSchema,
  UiLayoutConstraintsSchema,
  assertJsonValue,
  canonicalJson,
  type JsonValue,
  type DataSourceBindingResult,
  type DataSourceDescriptor,
  type UiDocument,
  type UiLayoutConstraints,
  type UiNode
} from "@k-nex/contracts";
import type { ComponentData, Config, Data, Field } from "@puckeditor/core";
import {
  createUiDocumentRuntime,
  createUiRuntimeRegistry,
  presentUiRuntimeResult,
  snapshotUiBlockDefinition,
  type UiBlockDefinition,
  type UiContributionDefinition,
  type UiRuntimeActor,
  type UiRuntimeSurface
} from "@k-nex/ui-runtime";

const canonicalNodeKey = "__kNexNode";
const childSlotKey = "__kNexChildren";
const documentKey = "__kNexDocument";
const fieldPrefix = "__kNexField:";
const canMoveKey = "__kNexCanMove";
const puckBridgeSnapshots = new WeakSet<object>();

export type PuckBridgeField =
  | { readonly prop: string; readonly label: string; readonly kind: "text" | "textarea" | "number" | "boolean" }
  | { readonly prop: string; readonly label: string; readonly kind: "select"; readonly options: readonly { readonly label: string; readonly value: JsonValue }[] };

export interface PuckBlockBridge {
  readonly definition: UiBlockDefinition;
  readonly label: string;
  readonly fields: readonly PuckBridgeField[];
  readonly allowChildren: boolean;
  readonly defaultProps: Readonly<Record<string, JsonValue>>;
  readonly constraints?: UiLayoutConstraints;
}

export type PuckBlockAuthoring = Omit<PuckBlockBridge, "definition">;

export interface PuckPreviewContext {
  readonly surface: UiRuntimeSurface;
  readonly actor: UiRuntimeActor;
  readonly sources?: readonly DataSourceDescriptor[];
  readonly sourceResults?: Readonly<Record<string, DataSourceBindingResult<unknown>>>;
}

export interface PuckBuilderAdapter {
  readonly config: Config;
  toPuckData(document: unknown): Data;
  fromPuckData(data: unknown): UiDocument;
}

interface StoredNode {
  readonly type: string;
  readonly version: number;
  readonly props: Readonly<Record<string, JsonValue>>;
  readonly bindings?: UiNode["bindings"];
  readonly layout?: UiNode["layout"];
  readonly engineMetadata?: UiNode["engineMetadata"];
  readonly childrenPresent: boolean;
  readonly profile: UiDocument["profile"];
}

interface StoredDocument {
  readonly id: string;
  readonly version: number;
  readonly schemaVersion: 1;
  readonly profile: UiDocument["profile"];
  readonly canvasRegion: string;
  readonly canvasRegionPresent: boolean;
  readonly preservedRegions: UiDocument["regions"];
}

const bridgeKey = (id: string, version: number): string => `${id}__v${version}`;
const fieldKey = (prop: string): string => `${fieldPrefix}${prop}`;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function cloneJson<T>(value: T): T {
  assertJsonValue(value);
  return structuredClone(value);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function fieldValueIsValid(field: PuckBridgeField, value: unknown): boolean {
  if (field.kind === "text" || field.kind === "textarea") return typeof value === "string";
  if (field.kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (field.kind === "boolean") return typeof value === "boolean";
  return "options" in field && field.options.some((option) => canonicalJson(option.value) === canonicalJson(value));
}

function editableFields(bridge: PuckBlockBridge, nodeConstraints?: UiLayoutConstraints): readonly PuckBridgeField[] {
  if (bridge.constraints?.locked || nodeConstraints?.locked) return [];
  const trusted = bridge.constraints?.editableFields;
  const persisted = nodeConstraints?.editableFields;
  return bridge.fields.filter(({ prop }) =>
    (trusted === undefined || trusted.includes(prop)) && (persisted === undefined || persisted.includes(prop)));
}

function nodeCanMove(bridge: PuckBlockBridge, nodeConstraints?: UiLayoutConstraints): boolean {
  return bridge.constraints?.locked !== true && bridge.constraints?.canMove !== false &&
    nodeConstraints?.locked !== true && nodeConstraints?.canMove !== false;
}

function assertBridge(bridge: PuckBlockBridge): void {
  if (!ResourceIdSchema.safeParse(bridge.definition?.id).success || !Number.isSafeInteger(bridge.definition?.version) || bridge.definition.version < 1) {
    throw new TypeError("Puck block bridges require a canonical block ID and positive version.");
  }
  if (typeof bridge.label !== "string" || bridge.label.length === 0 || bridge.label.length > 120 ||
      typeof bridge.definition.propsSchema?.safeParse !== "function" || typeof bridge.definition.render !== "function") {
    throw new TypeError("Puck block bridges require a bounded label and renderer.");
  }
  if (typeof bridge.allowChildren !== "boolean" || !Array.isArray(bridge.fields)) throw new TypeError("Puck block bridge fields are invalid.");
  const names = bridge.fields.map(({ prop }) => prop);
  if (new Set(names).size !== names.length || !names.every((name) => TableFieldIdSchema.safeParse(name).success)) {
    throw new TypeError("Puck bridge field props must be canonical and unique.");
  }
  for (const field of bridge.fields) {
    if (field.label.length === 0 || field.label.length > 120) throw new TypeError("Puck bridge field labels must be bounded.");
    if ("options" in field) {
      if (field.options.length === 0 || field.options.length > 64) throw new TypeError("Puck select fields require bounded options.");
      for (const option of field.options) {
        if (option.label.length === 0 || option.label.length > 120) throw new TypeError("Puck select option labels must be bounded.");
        assertJsonValue(option.value);
      }
      const optionValues = field.options.map((option: { readonly value: JsonValue }) => canonicalJson(option.value));
      if (new Set(optionValues).size !== optionValues.length) throw new TypeError("Puck select option values must be unique.");
    }
  }
  assertJsonValue(bridge.defaultProps);
  if (Object.keys(bridge.defaultProps).some((prop) => !names.includes(prop)) ||
      bridge.fields.some((field) => !Object.hasOwn(bridge.defaultProps, field.prop) || !fieldValueIsValid(field, bridge.defaultProps[field.prop]))) {
    throw new TypeError("Puck bridge defaults must provide valid values for every declared field.");
  }
  if (bridge.definition.propsSchema.safeParse(bridge.defaultProps).success !== true) {
    throw new TypeError("Puck bridge defaults must satisfy the shared runtime prop schema.");
  }
  if (bridge.constraints !== undefined && !UiLayoutConstraintsSchema.safeParse(bridge.constraints).success) {
    throw new TypeError("Puck bridge constraints must satisfy the canonical layout constraint contract.");
  }
}

export function snapshotPuckBlockBridge(candidate: PuckBlockBridge): PuckBlockBridge {
  if (puckBridgeSnapshots.has(candidate)) return candidate;
  const canonicalDefinition = snapshotUiBlockDefinition(candidate.definition);
  const bridge = { ...candidate, definition: canonicalDefinition };
  assertBridge(bridge);
  const safeParse = canonicalDefinition.propsSchema.safeParse.bind(canonicalDefinition.propsSchema);
  const render = canonicalDefinition.render;
  const definition: UiBlockDefinition = Object.freeze({
    ...(canonicalDefinition.descriptor === undefined ? {} : { descriptor: deepFreeze(structuredClone(canonicalDefinition.descriptor)) }),
    id: canonicalDefinition.id,
    version: canonicalDefinition.version,
    profiles: Object.freeze([...canonicalDefinition.profiles]),
    surfaces: Object.freeze([...canonicalDefinition.surfaces]),
    audience: canonicalDefinition.audience,
    ...(canonicalDefinition.permission === undefined ? {} : { permission: canonicalDefinition.permission }),
    propsSchema: Object.freeze({ safeParse: (value: unknown) => safeParse(value) }),
    ...(canonicalDefinition.sourcePolicy === undefined ? {} : {
      sourcePolicy: Object.freeze({
        required: canonicalDefinition.sourcePolicy.required,
        contracts: Object.freeze(canonicalDefinition.sourcePolicy.contracts.map((contract) => Object.freeze({ ...contract }))),
        requiredFields: Object.freeze([...canonicalDefinition.sourcePolicy.requiredFields])
      })
    }),
    ...(canonicalDefinition.actionPolicy === undefined ? {} : {
      actionPolicy: Object.freeze({
        required: canonicalDefinition.actionPolicy.required,
        actions: Object.freeze(canonicalDefinition.actionPolicy.actions.map((action) => Object.freeze({ ...action })))
      })
    }),
    ...(candidate.definition.actionPolicy === undefined ? {} : {
      actionPolicy: Object.freeze({
        required: candidate.definition.actionPolicy.required,
        actions: Object.freeze(candidate.definition.actionPolicy.actions.map((action) => Object.freeze({ ...action })))
      })
    }),
    render: (input: Parameters<typeof render>[0]) => render(input)
  });
  const snapshot: PuckBlockBridge = Object.freeze({
    definition,
    label: candidate.label,
    fields: deepFreeze(candidate.fields.map((field) => cloneJson(field))),
    allowChildren: candidate.allowChildren,
    defaultProps: deepFreeze(cloneJson(candidate.defaultProps)),
    ...(candidate.constraints === undefined ? {} : { constraints: deepFreeze(cloneJson(candidate.constraints)) })
  });
  puckBridgeSnapshots.add(snapshot);
  return snapshot;
}

export function reconcilePuckBlockContribution(
  definition: UiContributionDefinition,
  authoring: PuckBlockAuthoring
): PuckBlockBridge {
  const canonical = snapshotUiBlockDefinition(definition) as UiContributionDefinition;
  if (canonical.descriptor.kind !== "block") {
    throw new TypeError("Puck may bridge only a reconciled canonical block contribution.");
  }
  return snapshotPuckBlockBridge({ definition: canonical, ...authoring });
}

function puckField(field: PuckBridgeField): Field {
  if (field.kind === "boolean") return { type: "radio", label: field.label, options: [{ label: "Yes", value: true }, { label: "No", value: false }] };
  if (field.kind === "select") return { type: "select", label: field.label, options: field.options.map((option) => ({ ...option })) };
  return { type: field.kind, label: field.label };
}

function puckFields(bridge: PuckBlockBridge, componentNames: readonly string[], nodeConstraints?: UiLayoutConstraints): Record<string, Field> {
  const fields = Object.fromEntries(editableFields(bridge, nodeConstraints).map((field) => [fieldKey(field.prop), puckField(field)]));
  if (bridge.allowChildren) {
    const allowedChildren = bridge.constraints?.allowedChildren === undefined
      ? nodeConstraints?.allowedChildren
      : nodeConstraints?.allowedChildren === undefined
        ? bridge.constraints.allowedChildren
        : bridge.constraints.allowedChildren.filter((id) => nodeConstraints.allowedChildren!.includes(id));
    fields[childSlotKey] = {
      type: "slot",
      allow: allowedChildren === undefined ? [...componentNames] : componentNames.filter((name) => allowedChildren.some((id) => name.startsWith(`${id}__v`)))
    };
  }
  return fields;
}

function nodeCanInsert(bridge: PuckBlockBridge, nodeConstraints?: UiLayoutConstraints): boolean {
  const constraints = bridge.constraints;
  const allowedChildren = constraints?.allowedChildren === undefined
    ? nodeConstraints?.allowedChildren
    : nodeConstraints?.allowedChildren === undefined
      ? constraints.allowedChildren
      : constraints.allowedChildren.filter((id) => nodeConstraints.allowedChildren!.includes(id));
  return bridge.allowChildren && constraints?.locked !== true && nodeConstraints?.locked !== true &&
    constraints?.maxChildren !== 0 && nodeConstraints?.maxChildren !== 0 && allowedChildren?.length !== 0;
}

function storedNode(node: UiNode, profile: UiDocument["profile"]): StoredNode {
  return {
    type: node.type,
    version: node.version,
    props: cloneJson(node.props),
    ...(node.bindings === undefined ? {} : { bindings: cloneJson(node.bindings) }),
    ...(node.layout === undefined ? {} : { layout: cloneJson(node.layout) }),
    ...(node.engineMetadata === undefined ? {} : { engineMetadata: cloneJson(node.engineMetadata) }),
    childrenPresent: node.children !== undefined,
    profile
  };
}

function toComponent(node: UiNode, profile: UiDocument["profile"], bridges: ReadonlyMap<string, PuckBlockBridge>): ComponentData {
  const key = bridgeKey(node.type, node.version);
  const bridge = bridges.get(key);
  if (bridge === undefined) throw new TypeError(`No Puck bridge is registered for ${node.type}@${node.version}.`);
  if (bridge.definition.propsSchema.safeParse(node.props).success !== true) {
    throw new TypeError(`Canonical props are invalid for ${node.type}@${node.version}.`);
  }
  const props: Record<string, unknown> = {
    id: node.id,
    [canonicalNodeKey]: storedNode(node, profile),
    [canMoveKey]: nodeCanMove(bridge, node.layout?.constraints)
  };
  for (const field of editableFields(bridge, node.layout?.constraints)) {
    props[fieldKey(field.prop)] = cloneJson(node.props[field.prop] ?? bridge.defaultProps[field.prop] ?? null);
  }
  if (bridge.allowChildren) props[childSlotKey] = (node.children ?? []).map((child) => toComponent(child, profile, bridges));
  else if ((node.children?.length ?? 0) > 0) throw new TypeError(`Puck bridge ${node.type}@${node.version} does not allow children.`);
  return { type: key, props } as ComponentData;
}

function parseStoredNode(value: unknown): StoredNode {
  if (!isRecord(value) || !ResourceIdSchema.safeParse(value.type).success || !Number.isSafeInteger(value.version) || !isRecord(value.props) ||
      typeof value.childrenPresent !== "boolean" || (value.profile !== "cms" && value.profile !== "workspace")) {
    throw new TypeError("Puck component metadata is invalid.");
  }
  assertJsonValue(value);
  return cloneJson(value) as unknown as StoredNode;
}

function fromComponent(value: unknown, bridges: ReadonlyMap<string, PuckBlockBridge>): UiNode {
  if (!isRecord(value) || typeof value.type !== "string" || !isRecord(value.props) || typeof value.props.id !== "string") {
    throw new TypeError("Puck component data is invalid.");
  }
  const bridge = bridges.get(value.type);
  if (bridge === undefined) throw new TypeError(`Unknown Puck component type: ${value.type}.`);
  const metadata = parseStoredNode(value.props[canonicalNodeKey]);
  if (metadata.type !== bridge.definition.id || metadata.version !== bridge.definition.version) throw new TypeError("Puck component identity does not match canonical metadata.");

  const props = cloneJson(metadata.props) as Record<string, JsonValue>;
  for (const field of editableFields(bridge, metadata.layout?.constraints)) {
    const edited = value.props[fieldKey(field.prop)];
    if (edited === undefined) throw new TypeError(`Puck component field is missing: ${field.prop}.`);
    assertJsonValue(edited);
    if (!fieldValueIsValid(field, edited)) throw new TypeError(`Puck component field has an invalid value: ${field.prop}.`);
    const hadCanonicalValue = Object.hasOwn(metadata.props, field.prop);
    const canonicalValue = metadata.props[field.prop];
    const originalEditorValue = hadCanonicalValue && fieldValueIsValid(field, canonicalValue)
      ? canonicalValue
      : bridge.defaultProps[field.prop];
    if (hadCanonicalValue && fieldValueIsValid(field, canonicalValue) || canonicalJson(edited) !== canonicalJson(originalEditorValue)) {
      props[field.prop] = cloneJson(edited as JsonValue);
    }
  }
  const childrenValue = value.props[childSlotKey];
  if (bridge.allowChildren && !Array.isArray(childrenValue)) throw new TypeError("Puck child slot data is missing.");
  if (!bridge.allowChildren && childrenValue !== undefined) throw new TypeError("Puck child slot data is forbidden for this block.");
  const children = bridge.allowChildren ? (childrenValue as unknown[]).map((child) => fromComponent(child, bridges)) : [];

  const node = {
    id: value.props.id,
    type: metadata.type,
    version: metadata.version,
    props,
    ...(metadata.bindings === undefined ? {} : { bindings: metadata.bindings }),
    ...(metadata.layout === undefined ? {} : { layout: metadata.layout }),
    ...(metadata.childrenPresent || children.length > 0 ? { children } : {}),
    ...(metadata.engineMetadata === undefined ? {} : { engineMetadata: metadata.engineMetadata })
  };
  if (bridge.definition.propsSchema.safeParse(node.props).success !== true) {
    throw new TypeError(`Edited props are invalid for ${metadata.type}@${metadata.version}.`);
  }
  return node;
}

function parseStoredDocument(value: unknown): StoredDocument {
  if (!isRecord(value) || typeof value.id !== "string" || !Number.isSafeInteger(value.version) || value.schemaVersion !== 1 ||
      (value.profile !== "cms" && value.profile !== "workspace") || typeof value.canvasRegion !== "string" ||
      typeof value.canvasRegionPresent !== "boolean" || !isRecord(value.preservedRegions)) {
    throw new TypeError("Puck root document metadata is invalid.");
  }
  assertJsonValue(value);
  return cloneJson(value) as unknown as StoredDocument;
}

function createConfig(bridges: ReadonlyMap<string, PuckBlockBridge>, preview?: PuckPreviewContext): Config {
  const components: Record<string, unknown> = {};
  const componentNames = [...bridges.keys()];
  const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({
    blocks: [...bridges.values()].map(({ definition }) => definition),
    sources: preview?.sources ?? []
  }));
  for (const [key, bridge] of bridges) {
    const fields = puckFields(bridge, componentNames);
    const defaultProps: Record<string, unknown> = {};
    for (const field of editableFields(bridge)) defaultProps[fieldKey(field.prop)] = cloneJson(bridge.defaultProps[field.prop] ?? null);
    const defaultProfile = preview?.surface === "workspace" ? "workspace" : preview?.surface === "cms" || preview?.surface === "public"
      ? "cms"
      : bridge.definition.profiles[0];
    if (defaultProfile === undefined) throw new TypeError("Puck bridge requires a supported document profile.");
    defaultProps[canonicalNodeKey] = storedNode({ id: "new-block", type: bridge.definition.id, version: bridge.definition.version, props: bridge.defaultProps }, defaultProfile);
    defaultProps[canMoveKey] = nodeCanMove(bridge);
    if (bridge.allowChildren) defaultProps[childSlotKey] = [];
    components[key] = {
      label: bridge.label,
      fields,
      defaultProps,
      permissions: {
        drag: nodeCanMove(bridge),
        delete: bridge.constraints?.locked !== true && bridge.constraints?.canDelete !== false,
        duplicate: bridge.constraints?.locked !== true,
        edit: editableFields(bridge).length > 0,
        insert: nodeCanInsert(bridge)
      },
      resolvePermissions: (data: { readonly props?: Record<string, unknown> }) => {
        const metadata = parseStoredNode(data.props?.[canonicalNodeKey]);
        const constraints = metadata.layout?.constraints;
        return {
          drag: nodeCanMove(bridge, constraints),
          delete: bridge.constraints?.locked !== true && bridge.constraints?.canDelete !== false && constraints?.locked !== true && constraints?.canDelete !== false,
          duplicate: bridge.constraints?.locked !== true && constraints?.locked !== true,
          edit: editableFields(bridge, constraints).length > 0,
          insert: nodeCanInsert(bridge, constraints)
        };
      },
      resolveFields: (data: { readonly props?: Record<string, unknown> }) => {
        const metadata = parseStoredNode(data.props?.[canonicalNodeKey]);
        return puckFields(bridge, componentNames, metadata.layout?.constraints);
      },
      render: (props: Record<string, unknown>) => {
        const metadata = parseStoredNode(props[canonicalNodeKey]);
        const canonicalProps: Record<string, JsonValue> = cloneJson(metadata.props) as Record<string, JsonValue>;
        for (const field of editableFields(bridge, metadata.layout?.constraints)) canonicalProps[field.prop] = props[fieldKey(field.prop)] as JsonValue;
        const node: UiNode = {
          id: String(props.id),
          type: metadata.type,
          version: metadata.version,
          props: canonicalProps,
          ...(metadata.bindings === undefined ? {} : { bindings: metadata.bindings }),
          ...(metadata.layout === undefined ? {} : { layout: metadata.layout }),
          ...(metadata.engineMetadata === undefined ? {} : { engineMetadata: metadata.engineMetadata })
        };
        const surface = preview?.surface ?? (metadata.profile === "cms" ? "cms" : "workspace");
        const actor = preview?.actor ?? { authenticated: surface !== "public", permissions: new Set<string>() };
        const result = runtime.render({
          document: { id: "builder.preview", version: 1, schemaVersion: 1, profile: metadata.profile, regions: { main: [node] } },
          surface,
          actor,
          ...(preview?.sourceResults === undefined ? {} : { sourceResults: preview.sourceResults })
        });
        return presentUiRuntimeResult(result);
      }
    };
  }
  return { components } as Config;
}

export function createPuckBuilderAdapter(input: { readonly blocks: readonly PuckBlockBridge[]; readonly canvasRegion?: string; readonly preview?: PuckPreviewContext }): PuckBuilderAdapter {
  const bridges = new Map<string, PuckBlockBridge>();
  for (const candidate of input.blocks) {
    const bridge = snapshotPuckBlockBridge(candidate);
    const key = bridgeKey(bridge.definition.id, bridge.definition.version);
    if (bridges.has(key)) throw new TypeError(`Duplicate Puck block bridge: ${bridge.definition.id}@${bridge.definition.version}.`);
    bridges.set(key, bridge);
  }
  const canvasRegion = input.canvasRegion ?? "main";
  if (!TableFieldIdSchema.safeParse(canvasRegion).success) throw new TypeError("Puck canvas region must be a canonical field ID.");

  return Object.freeze({
    config: createConfig(bridges, input.preview),
    toPuckData(value: unknown): Data {
      const parsed = UiDocumentSchema.parse(value);
      const preservedRegions = Object.fromEntries(Object.entries(parsed.regions).filter(([region]) => region !== canvasRegion));
      const metadata: StoredDocument = {
        id: parsed.id,
        version: parsed.version,
        schemaVersion: parsed.schemaVersion,
        profile: parsed.profile,
        canvasRegion,
        canvasRegionPresent: Object.hasOwn(parsed.regions, canvasRegion),
        preservedRegions: cloneJson(preservedRegions)
      };
      return {
        root: { props: { [documentKey]: metadata } },
        content: (parsed.regions[canvasRegion] ?? []).map((node) => toComponent(node, parsed.profile, bridges))
      } as Data;
    },
    fromPuckData(value: unknown): UiDocument {
      if (!isRecord(value) || !Array.isArray(value.content) || !isRecord(value.root) ||
          (value.zones !== undefined && (!isRecord(value.zones) || Object.keys(value.zones).length > 0))) throw new TypeError("Puck data is invalid.");
      const rootProps = isRecord(value.root.props) ? value.root.props : value.root;
      const metadata = parseStoredDocument(rootProps[documentKey]);
      if (metadata.canvasRegion !== canvasRegion) throw new TypeError("Puck data targets a different canvas region.");
      const canvasNodes = value.content.map((component) => fromComponent(component, bridges));
      const document = {
        id: metadata.id,
        version: metadata.version,
        schemaVersion: metadata.schemaVersion,
        profile: metadata.profile,
        regions: {
          ...metadata.preservedRegions,
          ...(metadata.canvasRegionPresent || canvasNodes.length > 0 ? { [canvasRegion]: canvasNodes } : {})
        }
      };
      return UiDocumentSchema.parse(document);
    }
  });
}
