import {
  MetricScalarSchema,
  TableRecordsSchema,
  migrateUiDocumentToCurrent,
  UiDocumentMigrationError,
  type DataSourceDescriptor,
  type DataSourceBindingResult,
  type UiDocument,
  type UiDocumentMigrationErrorCode,
  type UiNode
} from "@k-nex/contracts";

import type {
  UiBlockDefinition,
  UiRuntimeActor,
  UiRuntimeRegistry,
  UiRuntimeSurface
} from "./definition.js";

export const uiRuntimeFallbackReasons = [
  "MISSING_BLOCK",
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
  "RENDER_FAILED"
] as const;

export type UiRuntimeFallbackReason = (typeof uiRuntimeFallbackReasons)[number];

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
}

export type UiDocumentRuntimeResult = UiDocumentRuntimeSuccess | UiDocumentRuntimeFailure;

export interface UiDocumentRuntimeInput {
  readonly document: unknown;
  readonly surface: UiRuntimeSurface;
  readonly actor: UiRuntimeActor;
  readonly sourceResults?: Readonly<Record<string, DataSourceBindingResult<unknown>>>;
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

function sourceResultIsValid(descriptor: DataSourceDescriptor, result: unknown): result is DataSourceBindingResult<unknown> {
  if (result === null || typeof result !== "object" || Array.isArray(result) || !("state" in result)) return false;
  const value = result as Record<string, unknown>;
  if (value.state === "idle" || value.state === "loading" || value.state === "empty") return true;
  if (value.state === "success" || value.state === "stale" || value.state === "refetching") {
    const schema = descriptor.primaryContract.id === "metric.scalar" ? MetricScalarSchema : TableRecordsSchema;
    return schema.safeParse(value.data).success;
  }
  if (value.state === "forbidden" || value.state === "insufficient-permission" || value.state === "invalid-contract" ||
      value.state === "rate-limited" || value.state === "error") {
    const problem = value.problem;
    if (problem === null || typeof problem !== "object" || Array.isArray(problem)) return false;
    const status = (problem as Record<string, unknown>).status;
    const code = (problem as Record<string, unknown>).code;
    if (![403, 429, 500, 502, 503, 504].includes(status as number) || typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return false;
    return value.retryAfterMs === undefined || value.state === "rate-limited" && Number.isSafeInteger(value.retryAfterMs) && (value.retryAfterMs as number) >= 0;
  }
  return false;
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
  if (selectedFields.some((fieldId) => !fields.has(fieldId))) return "SOURCE_FIELD_UNAVAILABLE";
  if (policy.requiredFields.some((fieldId) => !selectedFields.includes(fieldId))) return "SOURCE_FIELD_UNAVAILABLE";
  if (descriptor.audience !== "public" && selectedFields.some((fieldId) => !hasPermission(actor, fields.get(fieldId)?.permission ?? ""))) {
    return "SOURCE_FIELD_PERMISSION_DENIED";
  }
  return undefined;
}

function nodeResultMetadata(node: UiNode): Pick<UiRuntimeRenderedNode, "nodeId" | "blockId" | "blockVersion"> {
  return { nodeId: node.id, blockId: node.type, blockVersion: node.version };
}

function nodeResult(
  node: UiNode,
  children: readonly UiRuntimeNodeResult[],
  reason: UiRuntimeFallbackReason
): UiRuntimeFallbackNode {
  return { status: "fallback", ...nodeResultMetadata(node), reason, children };
}

function renderNode(
  node: UiNode,
  document: UiDocument,
  surface: UiRuntimeSurface,
  actor: UiRuntimeActor,
  registry: UiRuntimeRegistry,
  sourceResults: Readonly<Record<string, DataSourceBindingResult<unknown>>>
): UiRuntimeNodeResult {
  const children = (node.children ?? []).map((child) => renderNode(child, document, surface, actor, registry, sourceResults));
  const definition = registry.resolveBlock(node.type, node.version);
  if (definition === undefined) return nodeResult(node, children, "MISSING_BLOCK");
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

  const sourceReason = sourceBindingReason(definition, node, surface, actor, registry);
  if (sourceReason !== undefined) return nodeResult(node, children, sourceReason);

  let source: DataSourceDescriptor | undefined;
  let sourceResult: DataSourceBindingResult<unknown> | undefined;
  if (node.bindings?.source !== undefined) {
    source = registry.resolveSource(node.bindings.source.source.id, node.bindings.source.source.version);
    sourceResult = sourceResults[node.id] ?? { state: "idle" };
    if (source === undefined || !sourceResultIsValid(source, sourceResult)) return nodeResult(node, children, "SOURCE_RESULT_INVALID");
  }

  try {
    const output = definition.render({
      node,
      props: parsedProps.data,
      surface,
      actor,
      ...(source === undefined ? {} : { source }),
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
          ...(error instanceof UiDocumentMigrationError ? { migrationCode: error.code } : {})
        };
      }

      if (!profileAllowsSurface(document.profile, input.surface)) return { success: false, code: "PROFILE_SURFACE_DENIED" };
      if (input.surface !== "public" && !input.actor.authenticated) return { success: false, code: "AUTHENTICATION_REQUIRED" };

      const regions: Record<string, readonly UiRuntimeNodeResult[]> = {};
      for (const [region, nodes] of Object.entries(document.regions)) {
        regions[region] = nodes.map((node) => renderNode(node, document, input.surface, input.actor, registry, input.sourceResults ?? {}));
      }
      return { success: true, regions };
    }
  };
}
