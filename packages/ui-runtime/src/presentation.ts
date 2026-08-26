import type { UiDocumentRuntimeResult, UiRuntimeNodeResult } from "./document-runtime.js";

function presentOutput(output: unknown): string {
  if (output === null || typeof output !== "object" || Array.isArray(output)) return "Unsupported block presentation";
  const view = output as Record<string, unknown>;
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

/** Browser-safe presentation shared by production surfaces and editor preview. */
export function presentUiRuntimeNode(node: UiRuntimeNodeResult): string {
  return node.status === "fallback" ? `Unavailable: ${node.reason}` : presentOutput(node.output);
}

export function presentUiRuntimeResult(result: UiDocumentRuntimeResult, region = "main"): string {
  if (!result.success) return `Unavailable: ${result.code}`;
  return (result.regions[region] ?? []).map(presentUiRuntimeNode).join("\n");
}
