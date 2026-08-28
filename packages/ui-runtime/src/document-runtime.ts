import {
  MetricScalarSchema,
  DataSourceBindingResultSchema,
  dataSourceTableProjectionIsValid,
  resolveDataSourceFieldSelection,
  TableRecordsSchema,
  migrateUiDocumentToCurrent,
  UiDocumentMigrationError,
  type DataSourceDescriptor,
  type DataSourceBindingResult,
  type TableRecords,
  type UiDocument,
  type UiDocumentMigrationErrorCode,
  type UiNode
} from "@k-nex/contracts";

import type {
  UiBlockDefinition,
  UiRuntimeActionDispatcher,
  UiRuntimeActor,
  UiRuntimeRegistry,
  UiRuntimeSurface
} from "./definition.js";

export const uiRuntimeFallbackReasons = [
  "MISSING_BLOCK",
  "MISSING_BLOCK_VERSION",
  "MISSING_PLUGIN",
  "PROFILE_DENIED",
  "SURFACE_DENIED",
  "AUDIENCE_DENIED",
  "PERMISSION_DENIED",
  "INVALID_PROPS",
  "SOURCE_BINDING_REQUIRED",
  "SOURCE_NOT_ACCEPTED",
  "MISSING_SOURCE",
  "SOURCE_STRUCTURAL_HASH_MISMATCH",
  "SOURCE_INPUT_INVALID",
  "SOURCE_SURFACE_DENIED",
  "SOURCE_AUDIENCE_DENIED",
  "SOURCE_PERMISSION_DENIED",
  "SOURCE_FIELD_UNAVAILABLE",
  "SOURCE_FIELD_PERMISSION_DENIED",
  "SOURCE_RESULT_INVALID",
  "ACTION_BINDING_REQUIRED",
  "ACTION_NOT_ACCEPTED",
  "RENDER_FAILED"
] as const;

export type UiRuntimeFallbackReason = (typeof uiRuntimeFallbackReasons)[number];

export type UiRuntimeRemediation =
  | "INSTALL_OR_ENABLE_PLUGIN"
  | "INSTALL_COMPATIBLE_BLOCK_VERSION"
  | "REGISTER_BLOCK"
  | "RESTORE_SOURCE"
  | "UPDATE_SOURCE_BINDING"
  | "MIGRATE_DOCUMENT"
  | "REQUEST_ACCESS"
  | "FIX_BLOCK_CONFIGURATION"
  | "RETRY_OR_REPAIR_RENDERER";

export interface UiRuntimeRenderedNode {
  readonly status: "rendered";
  readonly nodeId: string;
  readonly blockId: string;
  readonly blockVersion: number;
  readonly output: unknown;
  readonly children: readonly UiRuntimeNodeResult[];
}

export interface UiRuntimeFallbackNode {
  readonly status: "fallback";
  readonly nodeId: string;
  readonly blockId: string;
  readonly blockVersion: number;
  readonly reason: UiRuntimeFallbackReason;
  readonly ownerPluginId?: string;
  readonly remediation: UiRuntimeRemediation;
  readonly children: readonly UiRuntimeNodeResult[];
}

export type UiRuntimeNodeResult = UiRuntimeRenderedNode | UiRuntimeFallbackNode;

export interface UiDocumentRuntimeSuccess {
  readonly success: true;
  readonly regions: Readonly<Record<string, readonly UiRuntimeNodeResult[]>>;
}

export type UiDocumentRuntimeFailureCode =
  | "DOCUMENT_MIGRATION_FAILED"
  | "PROFILE_SURFACE_DENIED"
  | "AUTHENTICATION_REQUIRED";

export interface UiDocumentRuntimeFailure {
  readonly success: false;
  readonly code: UiDocumentRuntimeFailureCode;
  readonly migrationCode?: UiDocumentMigrationErrorCode;
  readonly remediation: UiRuntimeRemediation;
}

export type UiDocumentRuntimeResult = UiDocumentRuntimeSuccess | UiDocumentRuntimeFailure;

export interface UiDocumentRuntimeInput {
  readonly document: unknown;
  readonly surface: UiRuntimeSurface;
  readonly actor: UiRuntimeActor;
  readonly sourceResults?: Readonly<Record<string, DataSourceBindingResult<unknown>>>;
  readonly dispatchAction?: UiRuntimeActionDispatcher;
}

export interface UiDocumentRuntime {
  render(input: UiDocumentRuntimeInput): UiDocumentRuntimeResult;
}

function sameSourceReference(left: { readonly id: string; readonly version: number }, right: { readonly id: string; readonly version: number }): boolean {
  return left.id === right.id && left.version === right.version;
}

function hasPermission(actor: UiRuntimeActor, permission: string): boolean {
  return typeof actor.permissions?.has === "function" && actor.permissions.has(permission);
}

function profileAllowsSurface(profile: UiDocument["profile"], surface: UiRuntimeSurface): boolean {
  return profile === "cms" ? surface === "cms" || surface === "public" : surface === "workspace";
}

function sourceAudienceAllowsSurface(
  descriptor: DataSourceDescriptor,
  surface: UiRuntimeSurface,
  authenticated: boolean
): boolean {
  if (surface === "public" && descriptor.audience !== "public") return false;
  if (descriptor.audience === "internal") return false;
  return descriptor.audience === "public" || authenticated;
}

function sourceInputValueMatches(kind: DataSourceDescriptor["inputFields"][number]["kind"], value: unknown): boolean {
  switch (kind) {
    case "integer": return Number.isSafeInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "string":
    case "date":
    case "datetime":
    case "enum": return typeof value === "string";
  }
}

function sourceInputIsCompatible(descriptor: DataSourceDescriptor, input: unknown): boolean {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  const fields = new Map(descriptor.inputFields.map((field) => [field.id, field]));
  if (Object.keys(record).some((key) => !fields.has(key))) return false;
  for (const field of descriptor.inputFields) {
    if (!Object.hasOwn(record, field.id)) {
      if (field.required) return false;
      continue;
    }
    const value = record[field.id];
    if (value === null) {
      if (!field.nullable) return false;
      continue;
    }
    if (!sourceInputValueMatches(field.kind, value)) return false;
  }
  return true;
}

function tableProjectionMatchesAuthority(
  descriptor: DataSourceDescriptor,
  node: UiNode,
  actor: UiRuntimeActor,
  table: TableRecords
): boolean {
  const descriptorFields = new Map((descriptor.outputFields ?? []).map((field) => [field.id, field]));
  const allowedFields = new Set([...descriptorFields.values()]
    .filter((field) => descriptor.audience === "public" || hasPermission(actor, field.permission))
    .map(({ id }) => id));
  const selection = resolveDataSourceFieldSelection(descriptor, node.bindings?.source?.selectedFields ?? [], allowedFields);
  return selection.success && dataSourceTableProjectionIsValid(descriptor, selection.selectedFields, table);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function readonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
  const set = new Set(values);
  let view: ReadonlySet<T>;
  view = Object.freeze({
    get size() { return set.size; },
    has: (value: T) => set.has(value),
    entries: () => set.entries(),
    keys: () => set.keys(),
    values: () => set.values(),
    forEach: (callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown) => {
      set.forEach((value) => callback.call(thisArg, value, value, view));
    },
    [Symbol.iterator]: () => set[Symbol.iterator](),
    [Symbol.toStringTag]: "Set"
  });
  return view;
}

function snapshotActor(actor: UiRuntimeActor): UiRuntimeActor {
  return Object.freeze({ authenticated: actor.authenticated === true, permissions: readonlySet(actor.permissions) });
}

function normalizeSourceResult(
  descriptor: DataSourceDescriptor,
  node: UiNode,
  actor: UiRuntimeActor,
  result: unknown
): DataSourceBindingResult<unknown> | undefined {
  const envelope = DataSourceBindingResultSchema.safeParse(result);
  if (!envelope.success) return undefined;
  const value = envelope.data;
  if (value.state === "success" || value.state === "stale" || value.state === "refetching") {
    const schema = descriptor.primaryContract.id === "metric.scalar" ? MetricScalarSchema : TableRecordsSchema;
    const parsed = schema.safeParse(value.data);
    if (!parsed.success) return undefined;
    if (descriptor.primaryContract.id === "table.records" && !tableProjectionMatchesAuthority(descriptor, node, actor, parsed.data as never)) return undefined;
    return deepFreeze({ ...value, data: structuredClone(parsed.data) }) as DataSourceBindingResult<unknown>;
  }
  return deepFreeze(structuredClone(value)) as DataSourceBindingResult<unknown>;
}

function sourceBindingReason(
  definition: UiBlockDefinition,
  node: UiNode,
  surface: UiRuntimeSurface,
  actor: UiRuntimeActor,
  registry: UiRuntimeRegistry
): UiRuntimeFallbackReason | undefined {
  const policy = definition.sourcePolicy;
  const binding = node.bindings?.source;
  if (policy === undefined) return binding === undefined ? undefined : "SOURCE_NOT_ACCEPTED";
  if (binding === undefined) return policy.required ? "SOURCE_BINDING_REQUIRED" : undefined;

  const descriptor = registry.resolveSource(binding.source.id, binding.source.version);
  if (descriptor === undefined) return "MISSING_SOURCE";
  if (!policy.contracts.some((contract) => sameSourceReference(contract, descriptor.primaryContract))) return "SOURCE_NOT_ACCEPTED";
  if (binding.structuralCompatibilityHash !== descriptor.structuralCompatibilityHash) return "SOURCE_STRUCTURAL_HASH_MISMATCH";
  if (!sourceInputIsCompatible(descriptor, binding.input)) return "SOURCE_INPUT_INVALID";
  if (!descriptor.surfaces.includes(surface)) return "SOURCE_SURFACE_DENIED";
  if (!sourceAudienceAllowsSurface(descriptor, surface, actor.authenticated)) return "SOURCE_AUDIENCE_DENIED";
  if (descriptor.audience !== "public" && !hasPermission(actor, descriptor.permission)) return "SOURCE_PERMISSION_DENIED";

  const selectedFields = binding.selectedFields ?? [];
  const fields = new Map((descriptor.outputFields ?? []).map((field) => [field.id, field]));
  const allowedFields = new Set([...fields.values()]
    .filter((field) => descriptor.audience === "public" || hasPermission(actor, field.permission))
    .map(({ id }) => id));
  const selection = resolveDataSourceFieldSelection(descriptor, selectedFields, allowedFields);
  if (!selection.success) {
    return selection.reason === "REQUIRED_FIELD_NOT_ALLOWED" || selection.reason === "NO_ALLOWED_FIELDS"
      ? "SOURCE_FIELD_PERMISSION_DENIED"
      : "SOURCE_FIELD_UNAVAILABLE";
  }
  if (policy.requiredFields.some((fieldId) => !selectedFields.includes(fieldId))) return "SOURCE_FIELD_UNAVAILABLE";
  if (policy.requiredFields.some((fieldId) => !selection.selectedFields.includes(fieldId))) return "SOURCE_FIELD_PERMISSION_DENIED";
  return undefined;
}

function actionBindingReason(definition: UiBlockDefinition, node: UiNode): UiRuntimeFallbackReason | undefined {
  const policy = definition.actionPolicy;
  const binding = node.bindings?.action;
  if (policy === undefined) return binding === undefined ? undefined : "ACTION_NOT_ACCEPTED";
  if (binding === undefined) return policy.required ? "ACTION_BINDING_REQUIRED" : undefined;
  return policy.actions.some(({ id, version }) => id === binding.id && version === binding.version) ? undefined : "ACTION_NOT_ACCEPTED";
}

function nodeResultMetadata(node: UiNode): Pick<UiRuntimeRenderedNode, "nodeId" | "blockId" | "blockVersion"> {
  return { nodeId: node.id, blockId: node.type, blockVersion: node.version };
}

function nodeResult(
  node: UiNode,
  children: readonly UiRuntimeNodeResult[],
  reason: UiRuntimeFallbackReason,
  diagnostic: { readonly ownerPluginId?: string; readonly remediation?: UiRuntimeRemediation } = {}
): UiRuntimeFallbackNode {
  return {
    status: "fallback",
    ...nodeResultMetadata(node),
    reason,
    remediation: diagnostic.remediation ?? remediationFor(reason),
    ...(diagnostic.ownerPluginId === undefined ? {} : { ownerPluginId: diagnostic.ownerPluginId }),
    children
  };
}

function remediationFor(reason: UiRuntimeFallbackReason): UiRuntimeRemediation {
  if (reason === "MISSING_PLUGIN") return "INSTALL_OR_ENABLE_PLUGIN";
  if (reason === "MISSING_BLOCK_VERSION") return "INSTALL_COMPATIBLE_BLOCK_VERSION";
  if (reason === "MISSING_BLOCK") return "REGISTER_BLOCK";
  if (reason === "MISSING_SOURCE") return "RESTORE_SOURCE";
  if (reason === "SOURCE_STRUCTURAL_HASH_MISMATCH") return "MIGRATE_DOCUMENT";
  if (reason.startsWith("SOURCE_") || reason === "SOURCE_BINDING_REQUIRED") return "UPDATE_SOURCE_BINDING";
  if (reason.startsWith("ACTION_")) return "FIX_BLOCK_CONFIGURATION";
  if (reason === "PERMISSION_DENIED" || reason === "AUDIENCE_DENIED") return "REQUEST_ACCESS";
  if (reason === "RENDER_FAILED") return "RETRY_OR_REPAIR_RENDERER";
  return "FIX_BLOCK_CONFIGURATION";
}

function renderNode(
  node: UiNode,
  document: UiDocument,
  surface: UiRuntimeSurface,
  actor: UiRuntimeActor,
  registry: UiRuntimeRegistry,
  sourceResults: Readonly<Record<string, DataSourceBindingResult<unknown>>>,
  dispatchAction?: UiRuntimeActionDispatcher
): UiRuntimeNodeResult {
  const children = (node.children ?? []).map((child) => renderNode(child, document, surface, actor, registry, sourceResults, dispatchAction));
  const definition = registry.resolveBlock(node.type, node.version);
  if (definition === undefined) {
    const inspection = registry.inspectBlock(node.type, node.version);
    const reason = inspection.exact ? "MISSING_PLUGIN" : inspection.known ? "MISSING_BLOCK_VERSION" : "MISSING_BLOCK";
    return nodeResult(node, children, reason, inspection.ownerPluginId === undefined ? {} : { ownerPluginId: inspection.ownerPluginId });
  }
  if (!definition.profiles.includes(document.profile)) return nodeResult(node, children, "PROFILE_DENIED");
  if (!definition.surfaces.includes(surface)) return nodeResult(node, children, "SURFACE_DENIED");
  if (definition.audience === "authenticated" && !actor.authenticated) return nodeResult(node, children, "AUDIENCE_DENIED");
  if (definition.permission !== undefined && !hasPermission(actor, definition.permission)) return nodeResult(node, children, "PERMISSION_DENIED");

  let parsedProps: { readonly success: true; readonly data: unknown };
  try {
    const parsed = definition.propsSchema.safeParse(node.props);
    if (parsed.success !== true) return nodeResult(node, children, "INVALID_PROPS");
    parsedProps = parsed;
  } catch {
    return nodeResult(node, children, "INVALID_PROPS");
  }

  const actionReason = actionBindingReason(definition, node);
  if (actionReason !== undefined) return nodeResult(node, children, actionReason);

  const sourceReason = sourceBindingReason(definition, node, surface, actor, registry);
  if (sourceReason !== undefined) {
    const reference = node.bindings?.source?.source;
    const descriptor = reference === undefined ? undefined : registry.resolveSource(reference.id, reference.version);
    const inspection = reference === undefined ? undefined : registry.inspectSource(reference.id, reference.version);
    const ownerPluginId = descriptor?.ownerPluginId ?? inspection?.ownerPluginId;
    return nodeResult(node, children, sourceReason, ownerPluginId === undefined ? {} : { ownerPluginId });
  }

  let source: DataSourceDescriptor | undefined;
  let sourceResult: DataSourceBindingResult<unknown> | undefined;
  if (node.bindings?.source !== undefined) {
    source = registry.resolveSource(node.bindings.source.source.id, node.bindings.source.source.version);
    const candidate = sourceResults[node.id] ?? { state: "idle" };
    sourceResult = source === undefined ? undefined : normalizeSourceResult(source, node, actor, candidate);
    if (source === undefined || sourceResult === undefined) return nodeResult(node, children, "SOURCE_RESULT_INVALID");
  }

  const nodeId = node.id;
  const action = node.bindings?.action === undefined ? undefined : Object.freeze({ ...node.bindings.action });
  const scopedDispatchAction = action === undefined || dispatchAction === undefined
    ? undefined
    : (request: Parameters<UiRuntimeActionDispatcher>[0]) => {
      if (request.nodeId !== nodeId || request.action.id !== action.id || request.action.version !== action.version) {
        throw new Error("Action dispatch denied.");
      }
      return dispatchAction({ action, input: request.input, nodeId });
    };

  try {
    const output = definition.render({
      node,
      props: parsedProps.data,
      surface,
      actor,
      ...(source === undefined ? {} : { source }),
      ...(action === undefined ? {} : { action }),
      ...(scopedDispatchAction === undefined ? {} : { dispatchAction: scopedDispatchAction }),
      ...(sourceResult === undefined ? {} : { sourceResult })
    });
    return { status: "rendered", ...nodeResultMetadata(node), output, children };
  } catch {
    return nodeResult(node, children, "RENDER_FAILED");
  }
}

export function createUiDocumentRuntime(registry: UiRuntimeRegistry): UiDocumentRuntime {
  return {
    render(input): UiDocumentRuntimeResult {
      let document: UiDocument;
      try {
        document = migrateUiDocumentToCurrent(input.document);
      } catch (error) {
        return {
          success: false,
          code: "DOCUMENT_MIGRATION_FAILED",
          remediation: "MIGRATE_DOCUMENT",
          ...(error instanceof UiDocumentMigrationError ? { migrationCode: error.code } : {})
        };
      }

      if (!profileAllowsSurface(document.profile, input.surface)) return { success: false, code: "PROFILE_SURFACE_DENIED", remediation: "FIX_BLOCK_CONFIGURATION" };
      const actor = snapshotActor(input.actor);
      if (input.surface !== "public" && !actor.authenticated) return { success: false, code: "AUTHENTICATION_REQUIRED", remediation: "REQUEST_ACCESS" };

      const regions: Record<string, readonly UiRuntimeNodeResult[]> = {};
      for (const [region, nodes] of Object.entries(document.regions)) {
        regions[region] = nodes.map((node) => renderNode(node, document, input.surface, actor, registry, input.sourceResults ?? {}, input.dispatchAction));
      }
      return { success: true, regions };
    }
  };
}

export interface UiDocumentReadinessIssue {
  readonly code: UiRuntimeFallbackReason | UiDocumentRuntimeFailureCode;
  readonly nodeId?: string;
  readonly blockId?: string;
  readonly blockVersion?: number;
  readonly ownerPluginId?: string;
  readonly remediation: UiRuntimeRemediation;
}

export interface UiDocumentReadinessReport {
  readonly ready: boolean;
  readonly issues: readonly UiDocumentReadinessIssue[];
}

export function inspectUiDocumentReadiness(result: UiDocumentRuntimeResult): UiDocumentReadinessReport {
  if (!result.success) return Object.freeze({ ready: false, issues: Object.freeze([{ code: result.code, remediation: result.remediation }]) });
  const issues: UiDocumentReadinessIssue[] = [];
  const visit = (node: UiRuntimeNodeResult): void => {
    if (node.status === "fallback") {
      issues.push({
        code: node.reason,
        nodeId: node.nodeId,
        blockId: node.blockId,
        blockVersion: node.blockVersion,
        ...(node.ownerPluginId === undefined ? {} : { ownerPluginId: node.ownerPluginId }),
        remediation: node.remediation
      });
    }
    node.children.forEach(visit);
  };
  Object.values(result.regions).forEach((nodes) => nodes.forEach(visit));
  return Object.freeze({ ready: issues.length === 0, issues: Object.freeze(issues) });
}
