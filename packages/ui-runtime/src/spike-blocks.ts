import { TableRecordsSchema, type DataSourceBindingResult, type JsonValue, type TableRecords } from "@k-nex/contracts";

import type { RuntimeSchemaResult } from "@k-nex/contracts";
import type { UiBlockDefinition } from "./definition.js";

export interface StaticTextView {
  readonly kind: "text";
  readonly text: string;
}

export interface WorkspaceTaskTableView {
  readonly kind: "data-table";
  readonly title: string;
  readonly state: DataSourceBindingResult<unknown>["state"];
  readonly table?: TableRecords;
  readonly problemCode?: string;
}

function strictStringProps(key: string, maximum: number) {
  return {
    safeParse(value: unknown): RuntimeSchemaResult<Record<string, JsonValue>> {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false, error: "invalid" };
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length !== 1 || typeof record[key] !== "string" || record[key].length === 0 || record[key].length > maximum) {
        return { success: false, error: "invalid" };
      }
      return { success: true, data: { [key]: record[key] } };
    }
  };
}

export function createStaticTextBlockDefinition(): UiBlockDefinition<StaticTextView> {
  const definition: UiBlockDefinition<StaticTextView> = {
    id: "content.text",
    version: 1,
    profiles: ["cms", "workspace"],
    surfaces: ["cms", "public", "workspace"],
    audience: "public",
    propsSchema: strictStringProps("text", 4_096),
    render: ({ props }) => ({ kind: "text", text: (props as { text: string }).text })
  };
  return Object.freeze(definition);
}

export function createWorkspaceTaskTableBlockDefinition(): UiBlockDefinition<WorkspaceTaskTableView> {
  const definition: UiBlockDefinition<WorkspaceTaskTableView> = {
    id: "sales.workspace-task-table",
    version: 1,
    profiles: ["workspace"],
    surfaces: ["workspace"],
    audience: "authenticated",
    permission: "sales.tasks.read",
    propsSchema: strictStringProps("title", 120),
    sourcePolicy: {
      required: true,
      contracts: [{ id: "table.records", version: 1 }],
      requiredFields: ["title", "status"]
    },
    render: ({ props, sourceResult }) => {
      const title = (props as { title: string }).title;
      const result = sourceResult ?? { state: "idle" as const };
      if (result.state === "success" || result.state === "stale" || result.state === "refetching") {
        const table = TableRecordsSchema.parse(result.data);
        return { kind: "data-table", title, state: result.state, table };
      }
      if ("problem" in result) return { kind: "data-table", title, state: result.state, problemCode: result.problem.code };
      return { kind: "data-table", title, state: result.state };
    }
  };
  return Object.freeze(definition);
}
