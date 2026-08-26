import { UiDocumentSchema, type JsonValue, type UiDocument } from "@k-nex/contracts";

export type LayoutSubjectSelector =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "group"; readonly groupId: string }
  | { readonly kind: "permission"; readonly permission: string };

export interface LayoutAssignment {
  readonly assignmentId: string;
  readonly subject: LayoutSubjectSelector;
  readonly layoutRevisionId: string;
  readonly priority: number;
  readonly activeFrom?: string;
  readonly activeUntil?: string;
  readonly reason: string;
  readonly source: string;
}

export interface PublishedLayoutSnapshot {
  readonly layoutRevisionId: string;
  readonly revisionNumber: number;
  readonly document: UiDocument;
  readonly previousLayoutRevisionId?: string;
  readonly personalization: {
    readonly movableNodeIds: readonly string[];
    readonly hideableNodeIds: readonly string[];
    readonly resizableNodeIds: readonly string[];
    readonly editableProps: Readonly<Record<string, readonly string[]>>;
  };
}

export type LayoutPatchOperation =
  | { readonly kind: "move"; readonly nodeId: string; readonly beforeNodeId?: string }
  | { readonly kind: "hide"; readonly nodeId: string }
  | { readonly kind: "resize"; readonly nodeId: string; readonly widthToken: string }
  | { readonly kind: "set-prop"; readonly nodeId: string; readonly prop: string; readonly value: JsonValue };

export interface LayoutResolutionResult {
  readonly status: "resolved" | "last-valid";
  readonly document: UiDocument;
  readonly selectedAssignmentId?: string;
  readonly selectedLayoutRevisionId?: string;
  readonly explanation: readonly string[];
}

type MutableNode = {
  id: string;
  props: Record<string, JsonValue>;
  layout?: { tokens?: Record<string, string>; constraints?: Record<string, unknown> };
  children?: MutableNode[];
  [key: string]: unknown;
};

const specificity = (subject: LayoutSubjectSelector) => subject.kind === "user" ? 3 : subject.kind === "group" ? 2 : 1;
const matches = (assignment: LayoutAssignment, context: { userId: string; groups: ReadonlySet<string>; permissions: ReadonlySet<string>; at: string }) => {
  const active = (assignment.activeFrom === undefined || assignment.activeFrom <= context.at) && (assignment.activeUntil === undefined || context.at < assignment.activeUntil);
  if (!active) return false;
  if (assignment.subject.kind === "user") return assignment.subject.userId === context.userId;
  if (assignment.subject.kind === "group") return context.groups.has(assignment.subject.groupId);
  return context.permissions.has(assignment.subject.permission);
};

function findRegion(document: { regions: Record<string, MutableNode[]> }, nodeId: string): { nodes: MutableNode[]; index: number } | undefined {
  const visit = (nodes: MutableNode[]): { nodes: MutableNode[]; index: number } | undefined => {
    const index = nodes.findIndex((node) => node.id === nodeId);
    if (index >= 0) return { nodes, index };
    for (const node of nodes) {
      const nested = node.children === undefined ? undefined : visit(node.children);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  for (const nodes of Object.values(document.regions)) {
    const result = visit(nodes);
    if (result !== undefined) return result;
  }
  return undefined;
}

function applyPatches(snapshot: PublishedLayoutSnapshot, patches: readonly LayoutPatchOperation[]): UiDocument {
  const document = structuredClone(snapshot.document) as unknown as { regions: Record<string, MutableNode[]> };
  const allowed = snapshot.personalization;
  for (const patch of patches) {
    const location = findRegion(document, patch.nodeId);
    if (location === undefined) throw new TypeError(`Personalization node does not exist: ${patch.nodeId}.`);
    const node = location.nodes[location.index]!;
    if (patch.kind === "hide") {
      if (!allowed.hideableNodeIds.includes(patch.nodeId)) throw new TypeError(`Node cannot be hidden: ${patch.nodeId}.`);
      location.nodes.splice(location.index, 1);
    } else if (patch.kind === "move") {
      if (!allowed.movableNodeIds.includes(patch.nodeId)) throw new TypeError(`Node cannot be moved: ${patch.nodeId}.`);
      const before = patch.beforeNodeId === undefined ? location.nodes.length : location.nodes.findIndex((candidate) => candidate.id === patch.beforeNodeId);
      if (before < 0) throw new TypeError(`Move target does not exist in the same region: ${patch.beforeNodeId}.`);
      location.nodes.splice(location.index, 1);
      location.nodes.splice(Math.min(before, location.nodes.length), 0, node);
    } else if (patch.kind === "resize") {
      if (!allowed.resizableNodeIds.includes(patch.nodeId) || !/^size\.[a-z][a-z0-9-]*$/.test(patch.widthToken)) throw new TypeError(`Node resize is not allowed: ${patch.nodeId}.`);
      node.layout ??= {};
      node.layout.tokens ??= {};
      node.layout.tokens.width = patch.widthToken;
    } else {
      if (!(allowed.editableProps[patch.nodeId] ?? []).includes(patch.prop)) throw new TypeError(`Node property is not editable: ${patch.nodeId}.${patch.prop}.`);
      node.props[patch.prop] = structuredClone(patch.value);
    }
  }
  return UiDocumentSchema.parse(document);
}

export function resolveWorkspaceLayout(input: {
  readonly userId: string;
  readonly groupIds: readonly string[];
  readonly permissions: readonly string[];
  readonly at: string;
  readonly assignments: readonly LayoutAssignment[];
  readonly snapshots: readonly PublishedLayoutSnapshot[];
  readonly patches?: readonly LayoutPatchOperation[];
  readonly lastValid?: UiDocument;
  readonly migrate?: (document: UiDocument) => UiDocument;
}): LayoutResolutionResult {
  const context = { userId: input.userId, groups: new Set(input.groupIds), permissions: new Set(input.permissions), at: input.at };
  const candidates = input.assignments.filter((assignment) => matches(assignment, context)).sort((left, right) =>
    right.priority - left.priority || specificity(right.subject) - specificity(left.subject) || left.assignmentId.localeCompare(right.assignmentId)
  );
  const selected = candidates[0];
  const explanation = candidates.map((assignment, index) => `${index === 0 ? "selected" : "superseded"}:${assignment.assignmentId}:priority=${assignment.priority}:specificity=${specificity(assignment.subject)}:source=${assignment.source}:reason=${assignment.reason}`);
  try {
    if (selected === undefined) throw new TypeError("No active layout assignment matched.");
    if (new Set(input.assignments.map((assignment) => assignment.assignmentId)).size !== input.assignments.length) throw new TypeError("Layout assignment IDs are not unique.");
    const snapshot = input.snapshots.find((candidate) => candidate.layoutRevisionId === selected.layoutRevisionId);
    if (snapshot === undefined) throw new TypeError(`Published layout snapshot is missing: ${selected.layoutRevisionId}.`);
    const personalized = applyPatches(snapshot, input.patches ?? []);
    const document = UiDocumentSchema.parse(input.migrate?.(personalized) ?? personalized);
    return Object.freeze({ status: "resolved", document, selectedAssignmentId: selected.assignmentId, selectedLayoutRevisionId: selected.layoutRevisionId, explanation: Object.freeze(explanation) });
  } catch (error) {
    if (input.lastValid === undefined) throw error;
    return Object.freeze({ status: "last-valid", document: UiDocumentSchema.parse(input.lastValid), explanation: Object.freeze([...explanation, `fallback:${error instanceof Error ? error.message : "unknown resolution failure"}`]) });
  }
}
