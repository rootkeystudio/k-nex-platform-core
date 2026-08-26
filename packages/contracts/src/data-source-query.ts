import * as z from "zod";

import { dataSourceFilterOperators } from "./data-source.js";
import { TableFieldIdSchema } from "./table-records.js";

const filterScalarSchema = z.union([
  z.string().max(512),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

export const DataSourcePageQuerySchema = z.strictObject({
  number: z.number().finite().int().min(1).max(1_000_000),
  size: z.number().finite().int().min(1).max(100)
});

export const DataSourceFilterQuerySchema = z.strictObject({
  field: TableFieldIdSchema,
  operator: z.enum(dataSourceFilterOperators),
  value: z.union([filterScalarSchema, z.array(filterScalarSchema).min(1).max(20)]).optional()
}).superRefine((filter, context) => {
  const nullOperator = filter.operator === "is-null" || filter.operator === "is-not-null";
  if (nullOperator && filter.value !== undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: "Null filters cannot include a value." });
  }
  if (!nullOperator && filter.value === undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: "This filter operator requires a value." });
  }
});

export const DataSourceSortQuerySchema = z.strictObject({
  field: TableFieldIdSchema,
  direction: z.enum(["asc", "desc"])
});

export const DataSourceQueryControlsSchema = z.strictObject({
  page: DataSourcePageQuerySchema.optional(),
  filters: z.array(DataSourceFilterQuerySchema).max(32).default([]),
  sort: z.array(DataSourceSortQuerySchema).max(16).default([])
});

export type DataSourcePageQuery = z.infer<typeof DataSourcePageQuerySchema>;
export type DataSourceFilterQuery = z.infer<typeof DataSourceFilterQuerySchema>;
export type DataSourceSortQuery = z.infer<typeof DataSourceSortQuerySchema>;
export type DataSourceQueryControls = z.infer<typeof DataSourceQueryControlsSchema>;
