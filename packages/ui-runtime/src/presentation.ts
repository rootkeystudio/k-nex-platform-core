import type { UiDocumentRuntimeResult, UiRuntimeNodeResult } from "./document-runtime.js";

export interface UiRuntimeComposablePresentation {
  readonly element: unknown;
  readonly composeChildren: (children: readonly UiRuntimeChildPresentation[], injectedChildren: readonly unknown[]) => unknown;
}

export interface UiRuntimeChildPresentation {
  readonly nodeId: string;
  readonly presentation: unknown;
}

export interface UiRuntimePresentationList {
  readonly kind: "ui-runtime-presentation-list";
  readonly leading?: unknown;
  readonly canonical: readonly UiRuntimeChildPresentation[];
  readonly injected: readonly unknown[];
}

const presentationLists = new WeakSet<object>();

function presentOutput(output: unknown, children: readonly UiRuntimeChildPresentation[], injectedChildren: readonly unknown[]): unknown {
  if (output === null || typeof output !== "object" || Array.isArray(output)) return "Unsupported block presentation";
  const view = output as Record<string, unknown>;
  if (Object.hasOwn(view, "element") && view.element !== undefined) {
    if (typeof view.composeChildren === "function") return (view.composeChildren as UiRuntimeComposablePresentation["composeChildren"])(children, injectedChildren);
    return view.element;
  }
  if (view.kind === "text" && typeof view.text === "string") return view.text;
  if (view.kind === "data-table" && typeof view.title === "string" && typeof view.state === "string") {
    const rows = view.table !== null && typeof view.table === "object" && !Array.isArray(view.table) &&
      Array.isArray((view.table as Record<string, unknown>).rows)
      ? (view.table as { readonly rows: readonly unknown[] }).rows.length
      : undefined;
    return rows === undefined ? `${view.title} (${view.state})` : `${view.title} (${view.state}, ${rows} rows)`;
  }
  return "Unsupported block presentation";
}

function joinPresentations(
  leading: unknown | undefined,
  canonical: readonly UiRuntimeChildPresentation[],
  injected: readonly unknown[]
): unknown {
  const values = [...(leading === undefined ? [] : [leading]), ...canonical.map(({ presentation }) => presentation), ...injected];
  if (values.every((value) => typeof value === "string")) return values.join("\n");
  if (canonical.length === 0 && injected.length === 0) return leading;
  const list = Object.freeze({
    kind: "ui-runtime-presentation-list" as const,
    ...(leading === undefined ? {} : { leading }),
    canonical: Object.freeze(canonical.map(({ nodeId, presentation }) => Object.freeze({ nodeId, presentation }))),
    injected: Object.freeze([...injected])
  });
  presentationLists.add(list);
  return list;
}

export function isUiRuntimePresentationList(value: unknown): value is UiRuntimePresentationList {
  return value !== null && typeof value === "object" && presentationLists.has(value);
}

/** Browser-safe presentation shared by production surfaces and editor preview. */
export function presentUiRuntimeNode(node: UiRuntimeNodeResult, injectedChildren: readonly unknown[] = []): unknown {
  const children = node.children.map((child) => ({ nodeId: child.nodeId, presentation: presentUiRuntimeNode(child) }));
  if (node.status === "fallback") return joinPresentations(`Unavailable: ${node.reason}`, children, injectedChildren);
  const current = presentOutput(node.output, children, injectedChildren);
  return typeof node.output === "object" && node.output !== null && !Array.isArray(node.output) && typeof (node.output as Record<string, unknown>).composeChildren === "function"
    ? current
    : joinPresentations(current, children, injectedChildren);
}

/** Preserves a node's canonical identity when it is presented as a host root. */
export function presentUiRuntimeNodeWithIdentity(node: UiRuntimeNodeResult, injectedChildren: readonly unknown[] = []): unknown {
  return joinPresentations(undefined, [{ nodeId: node.nodeId, presentation: presentUiRuntimeNode(node, injectedChildren) }], []);
}

export function presentUiRuntimeResult(result: UiDocumentRuntimeResult, region = "main"): unknown {
  if (!result.success) return `Unavailable: ${result.code}`;
  const roots = (result.regions[region] ?? []).map((node) => ({ nodeId: node.nodeId, presentation: presentUiRuntimeNode(node) }));
  return joinPresentations(undefined, roots, []);
}
