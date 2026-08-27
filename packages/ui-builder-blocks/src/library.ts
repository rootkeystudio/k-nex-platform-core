import { snapshotPuckBlockBridge, reconcilePuckBlockContribution, type PuckBlockAuthoring, type PuckBlockBridge } from "@k-nex/builder-puck";
import { assertJsonValue, resolveDataSourceFieldSelection, TableRecordsSchema, type DataSourceDescriptor, type JsonValue, type RuntimeSchema } from "@k-nex/contracts";
import { createElement, useState, type ReactElement, type ReactNode } from "react";
import { Accordion, Alert, Card, EmptyState, Grid, Heading, Section, Stack, Tabs, Text } from "@k-nex/ui-components";
import { createDataTableState, DataTable, defineDataTable, Metric, type DataTableRequestState } from "@k-nex/ui-data";
import { Form, FormActions, Select, TextInput } from "@k-nex/ui-forms";
import { defineSourceQuery, type UiBlockDefinition, type UiContributionDefinition, type UiBlockRenderInput } from "@k-nex/ui-runtime";

type FieldKind = "text" | "textarea" | "number" | "boolean";
interface GenericField { readonly prop: string; readonly label: string; readonly kind: FieldKind; readonly defaultValue: JsonValue; }
interface GenericBlock {
  readonly id: string;
  readonly label: string;
  readonly allowChildren: boolean;
  readonly fields: readonly GenericField[];
  readonly component: string;
  readonly role: string;
}

const specs: readonly GenericBlock[] = Object.freeze([
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

const genericFormAction = Object.freeze({ id: "content.form.submit", version: 1 });
function sourceInputSchema(source: DataSourceDescriptor): RuntimeSchema<Record<string, JsonValue>> {
  return Object.freeze({
    safeParse(value: unknown) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false as const, error: new TypeError("Source input must be an object.") };
      const record = value as Record<string, unknown>;
      const fields = new Map(source.inputFields.map((field) => [field.id, field]));
      if (Object.keys(record).some((key) => !fields.has(key))) return { success: false as const, error: new TypeError("Source input contains an undeclared field.") };
      for (const field of source.inputFields) {
        if (!Object.hasOwn(record, field.id)) {
          if (field.required) return { success: false as const, error: new TypeError("Source input is missing a required field.") };
          continue;
        }
        const candidate = record[field.id];
        if (candidate === null) {
          if (!field.nullable) return { success: false as const, error: new TypeError("Source input contains a non-nullable null.") };
          continue;
        }
        const valid = field.kind === "integer" ? Number.isSafeInteger(candidate)
          : field.kind === "number" ? typeof candidate === "number" && Number.isFinite(candidate)
          : typeof candidate === "string";
        if (!valid) return { success: false as const, error: new TypeError("Source input field type is invalid.") };
      }
      try {
        assertJsonValue(value);
        return { success: true as const, data: structuredClone(value) as Record<string, JsonValue> };
      } catch (error) {
        return { success: false as const, error };
      }
    }
  });
}

export function createKNextComponentElement(component: unknown, props: Record<string, unknown>): unknown {
  if (typeof component !== "function") throw new TypeError("K-Nex component definition is not executable.");
  return createElement(component as (props: Record<string, unknown>) => ReactNode, props);
}

export interface KNextActionFormField {
  readonly name: string;
  readonly label: string;
  readonly kind: "text" | "select";
  readonly required?: boolean;
  readonly options?: readonly { readonly id: string; readonly label: string }[];
}
interface KNextActionFormProps {
  readonly label: string;
  readonly fields: readonly KNextActionFormField[];
  readonly initialValues: Readonly<Record<string, string>>;
  readonly submitLabel: string;
  readonly enabled: boolean;
  readonly onSubmit: (values: Readonly<Record<string, string>>) => void | Promise<void>;
}
function KNextActionForm({ label, fields, initialValues, submitLabel, enabled, onSubmit }: KNextActionFormProps): ReactElement {
  const [values, setValues] = useState(() => ({ ...initialValues }));
  const update = (name: string, value: string): void => setValues((current) => ({ ...current, [name]: value }));
  const valid = fields.every((field) => field.required !== true || (values[field.name] ?? "").trim().length > 0);
  const children = [
    ...fields.map((field) => field.kind === "select"
      ? createElement(Select, { key: field.name, name: field.name, label: field.label, value: values[field.name] ?? "", options: field.options ?? [], onChange: (value: string) => update(field.name, value) })
      : createElement(TextInput, { key: field.name, name: field.name, label: field.label, value: values[field.name] ?? "", ...(field.required === undefined ? {} : { required: field.required }), onChange: (value: string) => update(field.name, value) })),
    createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: !enabled || !valid }, submitLabel) })
  ];
  return createElement(Form, { label, onSubmit: () => enabled && valid ? onSubmit(values) : undefined, children });
}

export function createKNextActionFormElement(props: KNextActionFormProps): unknown {
  return createElement(KNextActionForm, props);
}

function componentElement(component: unknown, props: Record<string, unknown>): ReactElement {
  return createKNextComponentElement(component, props) as ReactElement;
}

function genericDataTableDefinition(input: UiBlockRenderInput) {
  const source = input.source;
  const binding = input.node.bindings?.source;
  if (source === undefined || binding === undefined || source.primaryContract.id !== "table.records") throw new TypeError("Generic DataTable requires a bound table source.");
  const requestedFields = binding.selectedFields ?? source.outputFields?.map(({ id }) => id) ?? [];
  const allowedFields = new Set((source.outputFields ?? [])
    .filter(({ permission }) => source.audience === "public" || input.actor.permissions.has(permission))
    .map(({ id }) => id));
  const selection = resolveDataSourceFieldSelection(source, requestedFields, allowedFields);
  if (!selection.success) throw new TypeError(`Generic DataTable source fields are invalid: ${selection.reason}.`);
  const selectedFields = selection.selectedFields;
  const fields = (source.outputFields ?? []).filter(({ id }) => selectedFields.includes(id));
  const query = defineSourceQuery({
    source: { id: source.id, version: source.version },
    input: sourceInputSchema(source),
    output: TableRecordsSchema,
    defaults: binding.input as Record<string, JsonValue>,
    selectedFields,
    isEmpty: (value) => value.rows.length === 0
  });
  return defineDataTable({
    id: "content.data-table",
    descriptor: source,
    query,
    columns: fields.map(({ id }) => ({ id, label: id })),
    paginationModes: ["offset"],
    defaultPageSize: Math.min(25, source.limits.maxPageSize),
    ...(fields.find(({ filterOperators }) => filterOperators.includes("contains"))?.id === undefined ? {} : {
      searchField: fields.find(({ filterOperators }) => filterOperators.includes("contains"))!.id
    })
  });
}

function genericDataTableRequestState(input: UiBlockRenderInput): DataTableRequestState {
  if (input.sourceResult === undefined) return { state: "idle" };
  if (input.sourceResult.state === "insufficient-permission") return { state: "insufficient-permission" };
  return input.sourceResult as DataTableRequestState;
}

function genericElement(spec: GenericBlock, props: Record<string, JsonValue>, input: UiBlockRenderInput): ReactElement {
  const value = (key: string): string => String(props[key]);
  switch (spec.id) {
    case "content.stack": return componentElement(Stack, { gap: value("gap"), children: null });
    case "content.grid": return componentElement(Grid, { columns: props.columns, children: null });
    case "content.section": return componentElement(Section, { label: value("label"), children: null });
    case "content.heading": return componentElement(Heading, { level: props.level, children: value("text") });
    case "content.text": return componentElement(Text, { children: value("text") });
    case "content.card": return componentElement(Card, { children: value("title") });
    case "content.alert": return componentElement(Alert, { title: value("title"), children: value("title") });
    case "content.tabs": return componentElement(Tabs, { label: value("label"), items: [{ id: "default", label: value("label"), content: null }], selectedId: "default" });
    case "content.accordion": return componentElement(Accordion, { items: [{ id: "default", title: value("label"), content: null }] });
    case "content.metric": return componentElement(Metric, { label: value("label"), metric: { value: { kind: "number", value: 0 } } });
    case "content.data-table": {
      const definition = genericDataTableDefinition(input);
      return componentElement(DataTable, {
        definition,
        viewState: createDataTableState(definition),
        requestState: genericDataTableRequestState(input),
        label: value("title")
      });
    }
    case "content.form": return createKNextActionFormElement({
      label: value("label"),
      fields: [{ name: "value", label: "Value", kind: "text", required: true }],
      initialValues: { value: "" },
      submitLabel: "Submit",
      enabled: input.action !== undefined && input.dispatchAction !== undefined,
      onSubmit: async (values) => {
        if (input.action === undefined || input.dispatchAction === undefined) return;
        await input.dispatchAction({ action: input.action, input: values, nodeId: input.node.id });
      }
    }) as ReactElement;
    case "content.empty-state": return componentElement(EmptyState, { title: value("title") });
  }
  throw new TypeError(`Unsupported generic block: ${spec.id}`);
}

function propsSchema(fields: readonly GenericField[]): RuntimeSchema<Record<string, JsonValue>> {
  return Object.freeze({ safeParse(value: unknown) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false as const, error: new TypeError("invalid") };
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== fields.length || fields.some((field) => {
      const candidate = record[field.prop];
      return field.kind === "number" ? typeof candidate !== "number" || !Number.isFinite(candidate)
        : field.kind === "boolean" ? typeof candidate !== "boolean" : typeof candidate !== "string";
    })) return { success: false as const, error: new TypeError("invalid") };
    return { success: true as const, data: structuredClone(record) as Record<string, JsonValue> };
  } });
}

function genericBridge(spec: GenericBlock): PuckBlockBridge {
  const schema = propsSchema(spec.fields);
  const definition: UiBlockDefinition = {
    id: spec.id,
    version: 1,
    profiles: ["cms", "workspace"],
    surfaces: ["cms", "public", "workspace"],
    audience: "public",
    propsSchema: schema,
    ...(spec.id === "content.data-table" ? { sourcePolicy: { required: true, contracts: [{ id: "table.records" as const, version: 1 as const }], requiredFields: [] } } : {}),
    ...(spec.id === "content.form" ? { actionPolicy: { required: false, actions: [genericFormAction] } } : {}),
    render: (input) => Object.freeze({
      kind: spec.id.slice("content.".length),
      component: spec.component,
      accessibility: Object.freeze({ role: spec.role, label: String((input.props as Record<string, unknown>)[spec.fields[0]!.prop]) }),
      props: input.props,
      element: genericElement(spec, input.props as Record<string, JsonValue>, input),
      ...(input.sourceResult === undefined ? {} : { state: input.sourceResult.state })
    })
  };
  return snapshotPuckBlockBridge({
    definition,
    label: spec.label,
    fields: spec.fields.map(({ prop, label, kind }) => ({ prop, label, kind })),
    allowChildren: spec.allowChildren,
    defaultProps: Object.fromEntries(spec.fields.map(({ prop, defaultValue }) => [prop, defaultValue]))
  });
}

export const genericPuckBlockBridges = Object.freeze(specs.map(genericBridge));

export function createPuckBlockLibrary(
  definitions: readonly UiContributionDefinition[],
  authoring: Readonly<Record<string, PuckBlockAuthoring>>
): readonly PuckBlockBridge[] {
  if (definitions.length === 0 || new Set(definitions.map(({ id }) => id)).size !== definitions.length) throw new TypeError("Puck contribution definitions must be nonempty and unique.");
  const expected = new Set(definitions.map(({ id }) => id));
  if (Object.keys(authoring).length !== expected.size || Object.keys(authoring).some((id) => !expected.has(id))) throw new TypeError("Puck authoring metadata must exactly cover its definitions.");
  return Object.freeze(definitions.map((definition) => reconcilePuckBlockContribution(definition, authoring[definition.id]!)));
}
