import * as z from "zod";

import {
  MetricDecimalValueSchema,
  MetricIntegerValueSchema,
  MetricMoneyValueSchema,
  MetricNumberValueSchema,
  MetricTextValueSchema
} from "./metric-scalar.js";

/** The maximum number of fields a table projection can return. */
export const TABLE_FIELD_LIMIT = 64;
/** The maximum number of records in one table page. */
export const TABLE_ROW_LIMIT = 100;
/** The maximum number of values in one row projection. */
export const TABLE_VALUE_LIMIT = TABLE_FIELD_LIMIT;
/** The maximum number of route parameters in one registered route reference. */
export const ROUTE_PARAMETER_LIMIT = 16;

const FIELD_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REGISTERED_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/;
const ROUTE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;

const boundedString = (max: number) => z.string().min(1).max(max);

/** Stable opaque field IDs; storage paths and dotted IDs are intentionally invalid. */
export const TableFieldIdSchema = boundedString(64).regex(FIELD_ID_PATTERN);
export const TableRowKeySchema = boundedString(128);
export const TableResourceTypeSchema = boundedString(128).regex(REGISTERED_ID_PATTERN);
export const TableResourceIdSchema = boundedString(128);
export const TableRouteIdSchema = boundedString(128).regex(ROUTE_ID_PATTERN);
export const TableRouteParameterNameSchema = boundedString(64).regex(/^[A-Za-z][A-Za-z0-9]*$/);
export const TableRouteParameterValueSchema = boundedString(256);

const boundedRecord = <K extends z.core.$ZodRecordKey, V extends z.core.SomeType>(
  key: K,
  value: V,
  limit: number,
  message: string
) => z.record(key, value).superRefine((record, context) => {
  if (Object.keys(record).length > limit) context.addIssue({ code: "custom", message });
});

export const TableRouteSchema = z.strictObject({
  routeId: TableRouteIdSchema,
  params: boundedRecord(
    TableRouteParameterNameSchema,
    TableRouteParameterValueSchema,
    ROUTE_PARAMETER_LIMIT,
    `A route reference may contain at most ${ROUTE_PARAMETER_LIMIT} parameters.`
  )
});

const DateTimeValueSchema = z.iso.datetime({ offset: true }).max(64);
const DateValueSchema = z.iso.date();
const StatusValueSchema = boundedString(64);
const EnumValueSchema = boundedString(128);

export const TableResourceCellSchema = z.strictObject({
  kind: z.literal("resource"),
  resourceType: TableResourceTypeSchema,
  id: TableResourceIdSchema,
  label: boundedString(256),
  route: TableRouteSchema
});

export const TableCellSchema = z.discriminatedUnion("kind", [
  MetricTextValueSchema,
  MetricIntegerValueSchema,
  MetricNumberValueSchema,
  MetricDecimalValueSchema,
  MetricMoneyValueSchema,
  z.strictObject({ kind: z.literal("datetime"), value: DateTimeValueSchema }),
  z.strictObject({ kind: z.literal("date"), value: DateValueSchema }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("status"), value: StatusValueSchema }),
  z.strictObject({ kind: z.literal("enum"), value: EnumValueSchema }),
  TableResourceCellSchema
]);

export const TableRowSchema = z.strictObject({
  key: TableRowKeySchema,
  values: boundedRecord(
    TableFieldIdSchema,
    z.union([TableCellSchema, z.null()]),
    TABLE_VALUE_LIMIT,
    `A row may contain at most ${TABLE_VALUE_LIMIT} values.`
  )
});

export const TablePageSchema = z.strictObject({
  number: z.number().int().min(1).max(1_000_000),
  pageSize: z.number().int().min(1).max(TABLE_ROW_LIMIT),
  hasNext: z.boolean()
});

export const TableRecordsSchema = z.strictObject({
  fields: z.array(TableFieldIdSchema).min(1).max(TABLE_FIELD_LIMIT),
  rows: z.array(TableRowSchema).max(TABLE_ROW_LIMIT),
  page: TablePageSchema
}).superRefine((table, context) => {
  if (table.rows.length > table.page.pageSize) {
    context.addIssue({ code: "custom", path: ["rows"], message: "Rows must not exceed the declared page size." });
  }

  const fieldIds = new Set<string>();
  for (const [index, fieldId] of table.fields.entries()) {
    if (fieldIds.has(fieldId)) {
      context.addIssue({ code: "custom", path: ["fields", index], message: "Selected field IDs must be unique." });
    }
    fieldIds.add(fieldId);
  }

  const rowKeys = new Set<string>();
  for (const [rowIndex, row] of table.rows.entries()) {
    if (rowKeys.has(row.key)) {
      context.addIssue({ code: "custom", path: ["rows", rowIndex, "key"], message: "Row keys must be unique." });
    }
    rowKeys.add(row.key);

    for (const fieldId of Object.keys(row.values)) {
      if (!fieldIds.has(fieldId)) {
        context.addIssue({
          code: "custom",
          path: ["rows", rowIndex, "values", fieldId],
          message: "Row values must be limited to selected fields."
        });
      }
    }
  }
});

export type TableFieldId = z.infer<typeof TableFieldIdSchema>;
export type TableRowKey = z.infer<typeof TableRowKeySchema>;
export type TableResourceType = z.infer<typeof TableResourceTypeSchema>;
export type TableResourceId = z.infer<typeof TableResourceIdSchema>;
export type TableRouteId = z.infer<typeof TableRouteIdSchema>;
export type TableRouteParameterName = z.infer<typeof TableRouteParameterNameSchema>;
export type TableRouteParameterValue = z.infer<typeof TableRouteParameterValueSchema>;
export type TableRoute = z.infer<typeof TableRouteSchema>;
export type TableResourceCell = z.infer<typeof TableResourceCellSchema>;
export type TableCell = z.infer<typeof TableCellSchema>;
export type TableRow = z.infer<typeof TableRowSchema>;
export type TablePage = z.infer<typeof TablePageSchema>;
export type TableRecords = z.infer<typeof TableRecordsSchema>;
