import { snapshotPuckBlockBridge, reconcilePuckBlockContribution, type PuckBlockAuthoring, type PuckBlockBridge } from "@k-nex/builder-puck";
import type { JsonValue, RuntimeSchema } from "@k-nex/contracts";
import type { UiBlockDefinition, UiContributionDefinition } from "@k-nex/ui-runtime";

type FieldKind = "text" | "textarea" | "number" | "boolean";
interface GenericField { readonly prop: string; readonly label: string; readonly kind: FieldKind; readonly defaultValue: JsonValue; }
interface GenericBlock { readonly id: string; readonly label: string; readonly allowChildren: boolean; readonly fields: readonly GenericField[]; }

const specs: readonly GenericBlock[] = Object.freeze([
  { id: "content.stack", label: "Stack", allowChildren: true, fields: [{ prop: "gap", label: "Gap", kind: "text", defaultValue: "content" }] },
  { id: "content.grid", label: "Grid", allowChildren: true, fields: [{ prop: "columns", label: "Columns", kind: "number", defaultValue: 2 }] },
  { id: "content.section", label: "Section", allowChildren: true, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Section" }] },
  { id: "content.heading", label: "Heading", allowChildren: false, fields: [{ prop: "text", label: "Text", kind: "text", defaultValue: "Heading" }, { prop: "level", label: "Level", kind: "number", defaultValue: 2 }] },
  { id: "content.text", label: "Text", allowChildren: false, fields: [{ prop: "text", label: "Text", kind: "textarea", defaultValue: "Text" }] },
  { id: "content.card", label: "Card", allowChildren: true, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Card" }] },
  { id: "content.alert", label: "Alert", allowChildren: true, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Alert" }] },
  { id: "content.tabs", label: "Tabs", allowChildren: true, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Tabs" }] },
  { id: "content.accordion", label: "Accordion", allowChildren: true, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Accordion" }] },
  { id: "content.metric", label: "Metric", allowChildren: false, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Metric" }] },
  { id: "content.data-table", label: "DataTable", allowChildren: false, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Data" }] },
  { id: "content.form", label: "Form", allowChildren: true, fields: [{ prop: "label", label: "Label", kind: "text", defaultValue: "Form" }] },
  { id: "content.empty-state", label: "EmptyState", allowChildren: false, fields: [{ prop: "title", label: "Title", kind: "text", defaultValue: "Nothing here" }] }
]);

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
      props,
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
