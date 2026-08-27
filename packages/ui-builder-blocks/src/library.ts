import { snapshotPuckBlockBridge, reconcilePuckBlockContribution, type PuckBlockAuthoring, type PuckBlockBridge } from "@k-nex/builder-puck";
import type { JsonValue, RuntimeSchema } from "@k-nex/contracts";
import { createElement, type ReactElement, type ReactNode } from "react";
import { Accordion, Alert, Card, EmptyState, Grid, Heading, Section, Stack, Tabs, Text } from "@k-nex/ui-components";
import { Metric, Table } from "@k-nex/ui-data";
import { Form } from "@k-nex/ui-forms";
import type { UiBlockDefinition, UiContributionDefinition } from "@k-nex/ui-runtime";

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
  { id: "content.data-table", label: "DataTable", component: "Table", role: "table", allowChildren: false, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Data" }] },
  { id: "content.form", label: "Form", component: "Form", role: "form", allowChildren: true, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Form" }] },
  { id: "content.empty-state", label: "EmptyState", component: "EmptyState", role: "generic", allowChildren: false, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Nothing here" }] }
]);

export function createKNextComponentElement(component: unknown, props: Record<string, unknown>): unknown {
  if (typeof component !== "function") throw new TypeError("K-Nex component definition is not executable.");
  return createElement(component as (props: Record<string, unknown>) => ReactNode, props);
}

function componentElement(component: unknown, props: Record<string, unknown>): ReactElement {
  return createKNextComponentElement(component, props) as ReactElement;
}

function genericElement(spec: GenericBlock, props: Record<string, JsonValue>): ReactElement {
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
    case "content.data-table": return componentElement(Table, { label: value("title"), columns: [{ id: "value", label: value("title") }], rows: [] });
    case "content.form": return componentElement(Form, { label: value("label"), onSubmit: () => undefined, children: null });
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
    render: ({ props, sourceResult }) => Object.freeze({
      kind: spec.id.slice("content.".length),
      component: spec.component,
      accessibility: Object.freeze({ role: spec.role, label: String((props as Record<string, unknown>)[spec.fields[0]!.prop]) }),
      props,
      element: genericElement(spec, props as Record<string, JsonValue>),
      ...(sourceResult === undefined ? {} : { state: sourceResult.state })
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
