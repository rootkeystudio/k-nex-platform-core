import type { UiDocumentRuntimeResult, UiRuntimeNodeResult } from "./document-runtime.js";

function presentOutput(output: unknown): unknown {
  if (output === null || typeof output !== "object" || Array.isArray(output)) return "Unsupported block presentation";
  const view = output as Record<string, unknown>;
  if (Object.hasOwn(view, "element") && view.element !== undefined) return view.element;
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
export function presentUiRuntimeNode(node: UiRuntimeNodeResult): unknown {
  const current = node.status === "fallback" ? `Unavailable: ${node.reason}` : presentOutput(node.output);
  return joinPresentations([current, ...node.children.map(presentUiRuntimeNode)]);
}

export function presentUiRuntimeResult(result: UiDocumentRuntimeResult, region = "main"): unknown {
  if (!result.success) return `Unavailable: ${result.code}`;
  return joinPresentations((result.regions[region] ?? []).map(presentUiRuntimeNode));
}
