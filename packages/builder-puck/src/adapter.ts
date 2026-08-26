import {
  ResourceIdSchema,
  TableFieldIdSchema,
  UiDocumentSchema,
  assertJsonValue,
  canonicalJson,
  type JsonValue,
  type UiDocument,
  type UiNode
} from "@k-nex/contracts";
import type { ComponentData, Config, Data, Field } from "@puckeditor/core";

const canonicalNodeKey = "__kNexNode";
const childSlotKey = "__kNexChildren";
const documentKey = "__kNexDocument";
const fieldPrefix = "__kNexField:";

export type PuckBridgeField =
  | { readonly prop: string; readonly label: string; readonly kind: "text" | "textarea" | "number" | "boolean" }
  | { readonly prop: string; readonly label: string; readonly kind: "select"; readonly options: readonly { readonly label: string; readonly value: JsonValue }[] };

export interface PuckBlockBridge {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly fields: readonly PuckBridgeField[];
  readonly allowChildren: boolean;
  readonly defaultProps: Readonly<Record<string, JsonValue>>;
  readonly render: (input: { readonly props: Readonly<Record<string, JsonValue>>; readonly children?: unknown }) => unknown;
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

function fieldValueIsValid(field: PuckBridgeField, value: unknown): boolean {
  if (field.kind === "text" || field.kind === "textarea") return typeof value === "string";
  if (field.kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (field.kind === "boolean") return typeof value === "boolean";
  return "options" in field && field.options.some((option) => canonicalJson(option.value) === canonicalJson(value));
}

function assertBridge(bridge: PuckBlockBridge): void {
  if (!ResourceIdSchema.safeParse(bridge.id).success || !Number.isSafeInteger(bridge.version) || bridge.version < 1) {
    throw new TypeError("Puck block bridges require a canonical block ID and positive version.");
  }
  if (typeof bridge.label !== "string" || bridge.label.length === 0 || bridge.label.length > 120 || typeof bridge.render !== "function") {
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
}

function puckField(field: PuckBridgeField): Field {
  if (field.kind === "boolean") return { type: "radio", label: field.label, options: [{ label: "Yes", value: true }, { label: "No", value: false }] };
  if (field.kind === "select") return { type: "select", label: field.label, options: field.options.map((option) => ({ ...option })) };
  return { type: field.kind, label: field.label };
}

function storedNode(node: UiNode): StoredNode {
  return {
    type: node.type,
    version: node.version,
    props: cloneJson(node.props),
    ...(node.bindings === undefined ? {} : { bindings: cloneJson(node.bindings) }),
    ...(node.layout === undefined ? {} : { layout: cloneJson(node.layout) }),
    ...(node.engineMetadata === undefined ? {} : { engineMetadata: cloneJson(node.engineMetadata) })
  };
}

function toComponent(node: UiNode, bridges: ReadonlyMap<string, PuckBlockBridge>): ComponentData {
  const key = bridgeKey(node.type, node.version);
  const bridge = bridges.get(key);
  if (bridge === undefined) throw new TypeError(`No Puck bridge is registered for ${node.type}@${node.version}.`);
  const props: Record<string, unknown> = { id: node.id, [canonicalNodeKey]: storedNode(node) };
  for (const field of bridge.fields) {
    props[fieldKey(field.prop)] = cloneJson(node.props[field.prop] ?? bridge.defaultProps[field.prop] ?? null);
  }
  if (bridge.allowChildren) props[childSlotKey] = (node.children ?? []).map((child) => toComponent(child, bridges));
  else if ((node.children?.length ?? 0) > 0) throw new TypeError(`Puck bridge ${node.type}@${node.version} does not allow children.`);
  return { type: key, props } as ComponentData;
}

function parseStoredNode(value: unknown): StoredNode {
  if (!isRecord(value) || !ResourceIdSchema.safeParse(value.type).success || !Number.isSafeInteger(value.version) || !isRecord(value.props)) {
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
  if (metadata.type !== bridge.id || metadata.version !== bridge.version) throw new TypeError("Puck component identity does not match canonical metadata.");

  const props = cloneJson(metadata.props) as Record<string, JsonValue>;
  for (const field of bridge.fields) {
    const edited = value.props[fieldKey(field.prop)];
    if (edited === undefined) throw new TypeError(`Puck component field is missing: ${field.prop}.`);
    assertJsonValue(edited);
    if (!fieldValueIsValid(field, edited)) throw new TypeError(`Puck component field has an invalid value: ${field.prop}.`);
    props[field.prop] = cloneJson(edited as JsonValue);
  }
  const childrenValue = value.props[childSlotKey];
  if (bridge.allowChildren && !Array.isArray(childrenValue)) throw new TypeError("Puck child slot data is missing.");
  if (!bridge.allowChildren && childrenValue !== undefined) throw new TypeError("Puck child slot data is forbidden for this block.");
  const children = bridge.allowChildren ? (childrenValue as unknown[]).map((child) => fromComponent(child, bridges)) : [];

  return {
    id: value.props.id,
    type: metadata.type,
    version: metadata.version,
    props,
    ...(metadata.bindings === undefined ? {} : { bindings: metadata.bindings }),
    ...(metadata.layout === undefined ? {} : { layout: metadata.layout }),
    ...(children.length === 0 ? {} : { children }),
    ...(metadata.engineMetadata === undefined ? {} : { engineMetadata: metadata.engineMetadata })
  };
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

function createConfig(bridges: ReadonlyMap<string, PuckBlockBridge>): Config {
  const components: Record<string, unknown> = {};
  const componentNames = [...bridges.keys()];
  for (const [key, bridge] of bridges) {
    const fields: Record<string, Field> = {};
    for (const field of bridge.fields) fields[fieldKey(field.prop)] = puckField(field);
    if (bridge.allowChildren) fields[childSlotKey] = { type: "slot", allow: componentNames };
    const defaultProps: Record<string, unknown> = {};
    for (const field of bridge.fields) defaultProps[fieldKey(field.prop)] = cloneJson(bridge.defaultProps[field.prop] ?? null);
    defaultProps[canonicalNodeKey] = storedNode({ id: "new-block", type: bridge.id, version: bridge.version, props: bridge.defaultProps });
    if (bridge.allowChildren) defaultProps[childSlotKey] = [];
    components[key] = {
      label: bridge.label,
      fields,
      defaultProps,
      render: (props: Record<string, unknown>) => {
        const metadata = parseStoredNode(props[canonicalNodeKey]);
        const canonicalProps: Record<string, JsonValue> = cloneJson(metadata.props) as Record<string, JsonValue>;
        for (const field of bridge.fields) canonicalProps[field.prop] = props[fieldKey(field.prop)] as JsonValue;
        return bridge.render({ props: canonicalProps, ...(bridge.allowChildren ? { children: props[childSlotKey] } : {}) });
      }
    };
  }
  return { components } as Config;
}

export function createPuckBuilderAdapter(input: { readonly blocks: readonly PuckBlockBridge[]; readonly canvasRegion?: string }): PuckBuilderAdapter {
  const bridges = new Map<string, PuckBlockBridge>();
  for (const candidate of input.blocks) {
    assertBridge(candidate);
    const bridge: PuckBlockBridge = Object.freeze({
      ...candidate,
      fields: Object.freeze(candidate.fields.map((field) => Object.freeze(cloneJson(field)))),
      defaultProps: Object.freeze(cloneJson(candidate.defaultProps))
    });
    const key = bridgeKey(bridge.id, bridge.version);
    if (bridges.has(key)) throw new TypeError(`Duplicate Puck block bridge: ${bridge.id}@${bridge.version}.`);
    bridges.set(key, bridge);
  }
  const canvasRegion = input.canvasRegion ?? "main";
  if (!TableFieldIdSchema.safeParse(canvasRegion).success) throw new TypeError("Puck canvas region must be a canonical field ID.");

  return Object.freeze({
    config: createConfig(bridges),
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
        content: (parsed.regions[canvasRegion] ?? []).map((node) => toComponent(node, bridges))
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
