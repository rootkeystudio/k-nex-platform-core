import type { UiDocumentRuntimeResult, UiRuntimeNodeResult } from "./document-runtime.js";

export interface UiRuntimeComposablePresentation {
  readonly element: unknown;
  readonly composeChildren: (children: readonly UiRuntimeChildPresentation[], injectedChildren: readonly unknown[]) => unknown;
}

export interface UiRuntimeChildPresentation {
  readonly nodeId: string;
  readonly presentation: unknown;
}

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

function joinPresentations(values: readonly unknown[]): unknown {
  if (values.every((value) => typeof value === "string")) return values.join("\n");
  return values.length === 1 ? values[0] : values;
}

/** Browser-safe presentation shared by production surfaces and editor preview. */
export function presentUiRuntimeNode(node: UiRuntimeNodeResult, injectedChildren: readonly unknown[] = []): unknown {
  const children = node.children.map((child) => ({ nodeId: child.nodeId, presentation: presentUiRuntimeNode(child) }));
  const childValues = children.map(({ presentation }) => presentation);
  if (node.status === "fallback") return joinPresentations([`Unavailable: ${node.reason}`, ...childValues, ...injectedChildren]);
  const current = presentOutput(node.output, children, injectedChildren);
  return typeof node.output === "object" && node.output !== null && !Array.isArray(node.output) && typeof (node.output as Record<string, unknown>).composeChildren === "function"
    ? current
    : joinPresentations([current, ...childValues, ...injectedChildren]);
}

export function presentUiRuntimeResult(result: UiDocumentRuntimeResult, region = "main"): unknown {
  if (!result.success) return `Unavailable: ${result.code}`;
  return joinPresentations((result.regions[region] ?? []).map((node) => presentUiRuntimeNode(node)));
}
