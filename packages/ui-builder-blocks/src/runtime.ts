import { assertJsonValue, resolveDataSourceFieldSelection, TableRecordsSchema, type DataSourceDescriptor, type JsonValue, type RuntimeSchema } from "@k-nex/contracts";
import { createElement, Fragment, useState, type ReactElement, type ReactNode } from "react";
import { Accordion, Alert, Card, EmptyState, Grid, Heading, presentUiRuntimeReact, Section, Stack, Tabs, Text } from "@k-nex/ui-components";
import { createDataTableState, DataTable, defineDataTable, Metric, type DataTableRequestState } from "@k-nex/ui-data";
import { Form, FormActions, Select, TextInput } from "@k-nex/ui-forms";
import { defineSourceQuery, type UiBlockDefinition, type UiBlockRenderInput, type UiRuntimeChildPresentation } from "@k-nex/ui-runtime";

type FieldKind = "text" | "textarea" | "number" | "boolean";
interface GenericField { readonly prop: string; readonly label: string; readonly kind: FieldKind; readonly defaultValue: JsonValue; }
interface GenericBlock { readonly id: string; readonly label: string; readonly allowChildren: boolean; readonly fields: readonly GenericField[]; readonly component: string; readonly role: string; }

export const genericBlockSpecs: readonly GenericBlock[] = Object.freeze([
  { id: "content.stack", label: "Stack", component: "Stack", role: "generic", allowChildren: true, fields: [{ prop: "gap", label: "Gap", kind: "text", defaultValue: "content" }] },
  { id: "content.grid", label: "Grid", component: "Grid", role: "generic", allowChildren: true, fields: [{ prop: "columns", label: "Columns", kind: "number", defaultValue: 2 }] },
  { id: "content.section", label: "Section", component: "Section", role: "region", allowChildren: true, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Section" }] },
  { id: "content.heading", label: "Heading", component: "Heading", role: "heading", allowChildren: false, fields: [{ prop: "text", label: "Text", kind: "text", defaultValue: "Heading" }, { prop: "level", label: "Level", kind: "number", defaultValue: 2 }] },
  { id: "content.text", label: "Text", component: "Text", role: "generic", allowChildren: false, fields: [{ prop: "text", label: "Text", kind: "textarea", defaultValue: "Text" }] },
  { id: "content.card", label: "Card", component: "Card", role: "generic", allowChildren: true, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Card" }] },
  { id: "content.alert", label: "Alert", component: "Alert", role: "status", allowChildren: true, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Alert" }] },
  { id: "content.tabs", label: "Tabs", component: "Tabs", role: "tablist", allowChildren: true, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Tabs" }] },
  { id: "content.accordion", label: "Accordion", component: "Accordion", role: "generic", allowChildren: true, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Accordion" }] },
  { id: "content.metric", label: "Metric", component: "Metric", role: "status", allowChildren: false, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Metric" }] },
  { id: "content.data-table", label: "DataTable", component: "DataTable", role: "table", allowChildren: false, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Data" }] },
  { id: "content.form", label: "Form", component: "Form", role: "form", allowChildren: true, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Form" }] },
  { id: "content.empty-state", label: "EmptyState", component: "EmptyState", role: "generic", allowChildren: false, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Nothing here" }] }
]);

function sourceInputSchema(source: DataSourceDescriptor): RuntimeSchema<Record<string, JsonValue>> {
  return Object.freeze({ safeParse(value: unknown) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false as const, error: new TypeError("Source input must be an object.") };
    const record = value as Record<string, unknown>;
    const fields = new Map(source.inputFields.map((field) => [field.id, field]));
    if (Object.keys(record).some((key) => !fields.has(key))) return { success: false as const, error: new TypeError("Source input contains an undeclared field.") };
    for (const field of source.inputFields) {
      if (!Object.hasOwn(record, field.id)) { if (field.required) return { success: false as const, error: new TypeError("Source input is missing a required field.") }; continue; }
      const candidate = record[field.id];
      if (candidate === null) { if (!field.nullable) return { success: false as const, error: new TypeError("Source input contains a non-nullable null.") }; continue; }
      const valid = field.kind === "integer" ? Number.isSafeInteger(candidate) : field.kind === "number" ? typeof candidate === "number" && Number.isFinite(candidate) : field.kind === "boolean" ? typeof candidate === "boolean" : typeof candidate === "string";
      if (!valid) return { success: false as const, error: new TypeError("Source input field type is invalid.") };
    }
    try { assertJsonValue(value); return { success: true as const, data: structuredClone(value) as Record<string, JsonValue> }; } catch (error) { return { success: false as const, error }; }
  } });
}

function componentElement(component: unknown, props: Record<string, unknown>): ReactElement {
  if (typeof component !== "function") throw new TypeError("K-Nex component definition is not executable.");
  return createElement(component as (props: Record<string, unknown>) => ReactNode, props);
}

function dataTableDefinition(input: UiBlockRenderInput) {
  const source = input.source;
  const binding = input.node.bindings?.source;
  if (source === undefined || binding === undefined || source.primaryContract.id !== "table.records") throw new TypeError("Generic DataTable requires a bound table source.");
  const requestedFields = binding.selectedFields ?? source.outputFields?.map(({ id }) => id) ?? [];
  const allowedFields = new Set((source.outputFields ?? []).filter(({ permission }) => source.audience === "public" || input.actor.permissions.has(permission)).map(({ id }) => id));
  const selection = resolveDataSourceFieldSelection(source, requestedFields, allowedFields);
  if (!selection.success) throw new TypeError(`Generic DataTable source fields are invalid: ${selection.reason}.`);
  const fields = (source.outputFields ?? []).filter(({ id }) => selection.selectedFields.includes(id));
  const query = defineSourceQuery({ source: { id: source.id, version: source.version }, input: sourceInputSchema(source), output: TableRecordsSchema, defaults: binding.input as Record<string, JsonValue>, selectedFields: selection.selectedFields, isEmpty: (value) => value.rows.length === 0 });
  return defineDataTable({ id: "content.data-table", descriptor: source, query, columns: fields.map(({ id }) => ({ id, label: id })), paginationModes: ["offset"], defaultPageSize: Math.min(25, source.limits.maxPageSize), ...(fields.find(({ filterOperators }) => filterOperators.includes("contains"))?.id === undefined ? {} : { searchField: fields.find(({ filterOperators }) => filterOperators.includes("contains"))!.id }) });
}

function element(spec: GenericBlock, props: Record<string, JsonValue>, input: UiBlockRenderInput, children: readonly ReactNode[] = []): ReactElement {
  const value = (key: string): string => String(props[key]);
  switch (spec.id) {
    case "content.stack": return componentElement(Stack, { gap: value("gap"), children });
    case "content.grid": return componentElement(Grid, { columns: props.columns, children });
    case "content.section": return componentElement(Section, { label: value("label"), children });
    case "content.heading": return componentElement(Heading, { level: props.level, children: value("text") });
    case "content.text": return componentElement(Text, { children: value("text") });
    case "content.card": return componentElement(Card, { children: [createElement("span", { key: "title", "data-slot": "title" }, value("title")), ...children] });
    case "content.alert": return componentElement(Alert, { title: value("title"), children });
    case "content.tabs": return componentElement(Tabs, { label: value("label"), items: [{ id: "default", label: value("label"), content: children }], selectedId: "default" });
    case "content.accordion": return componentElement(Accordion, { items: [{ id: "default", title: value("label"), content: children }] });
    case "content.metric": return componentElement(Metric, { label: value("label"), metric: { value: { kind: "number", value: 0 } } });
    case "content.data-table": return componentElement(DataTable, { definition: dataTableDefinition(input), viewState: createDataTableState(dataTableDefinition(input)), requestState: input.sourceResult === undefined ? { state: "idle" } : input.sourceResult as DataTableRequestState, label: value("title") });
    case "content.form": return componentElement(Form, { label: value("label"), onSubmit: () => undefined, children: [createElement(TextInput, { key: "value", name: "value", label: "Value", value: "", required: true, onChange: () => undefined }), createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: true }, "Submit") }), ...children] });
    case "content.empty-state": return componentElement(EmptyState, { title: value("title") });
  }
  throw new TypeError(`Unsupported generic block: ${spec.id}`);
}

function propsSchema(fields: readonly GenericField[]): RuntimeSchema<Record<string, JsonValue>> {
  return Object.freeze({ safeParse(value: unknown) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false as const, error: new TypeError("invalid") };
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== fields.length || fields.some((field) => { const candidate = record[field.prop]; return field.kind === "number" ? typeof candidate !== "number" || !Number.isFinite(candidate) : field.kind === "boolean" ? typeof candidate !== "boolean" : typeof candidate !== "string"; })) return { success: false as const, error: new TypeError("invalid") };
    return { success: true as const, data: structuredClone(record) as Record<string, JsonValue> };
  } });
}

function definition(spec: GenericBlock): UiBlockDefinition {
  const schema = propsSchema(spec.fields);
  return Object.freeze({ id: spec.id, version: 1, profiles: ["cms", "workspace"], surfaces: ["cms", "public", "workspace"], audience: "public", propsSchema: schema,
    ...(spec.id === "content.data-table" ? { sourcePolicy: { required: true, contracts: [{ id: "table.records" as const, version: 1 as const }], requiredFields: [] } } : {}),
    render: (input) => Object.freeze({ kind: spec.id.slice("content.".length), component: spec.component, accessibility: Object.freeze({ role: spec.role, label: String((input.props as Record<string, unknown>)[spec.fields[0]!.prop]) }), props: input.props, element: element(spec, input.props as Record<string, JsonValue>, input), ...(spec.allowChildren ? { composeChildren: (children: readonly UiRuntimeChildPresentation[], injectedChildren: readonly unknown[]) => element(spec, input.props as Record<string, JsonValue>, input, [...children.map(({ nodeId, presentation }) => createElement(Fragment, { key: nodeId }, presentUiRuntimeReact(presentation))), ...(injectedChildren as readonly ReactNode[])]) } : {}), ...(input.sourceResult === undefined ? {} : { state: input.sourceResult.state }) })
  });
}

export const genericUiBlockDefinitions: readonly UiBlockDefinition[] = Object.freeze(genericBlockSpecs.map(definition));
