import {
  DataSourceDescriptorSchema,
  DataSourceQueryControlsSchema,
  resolveDataSourceFieldSelection,
  type DataSourceDescriptor,
  type DataSourceFilterQuery,
  type DataSourceQueryControls,
  type DataSourceSortQuery,
  type TableRecords
} from "@k-nex/contracts";
import {
  serializeBrowserViewState,
  type BrowserDataTransport,
  type BrowserQueryContext,
  type BrowserRequestState,
  type SourceQueryDefinition
} from "@k-nex/ui-runtime";

export interface DataTableColumnDefinition { readonly id: string; readonly label: string; readonly defaultVisible?: boolean; readonly size?: number; }
export interface DataTableActionDefinition { readonly id: string; readonly label: string; readonly allowed: boolean; readonly destructive?: boolean; }
export interface DataTableDefinition<TInput> {
  readonly id: string;
  readonly descriptor: DataSourceDescriptor;
  readonly query: SourceQueryDefinition<TInput, TableRecords>;
  readonly columns: readonly DataTableColumnDefinition[];
  readonly paginationModes: readonly ("offset" | "cursor")[];
  readonly defaultPageSize: number;
  readonly searchField?: string;
  readonly facets?: Readonly<Record<string, readonly string[]>>;
  readonly rowActions?: readonly DataTableActionDefinition[];
  readonly bulkActions?: readonly DataTableActionDefinition[];
}

export type DataTablePaginationState =
  | { readonly mode: "offset"; readonly page: number; readonly size: number }
  | { readonly mode: "cursor"; readonly size: number; readonly after?: string; readonly before?: string };
export interface DataTableViewState {
  readonly pagination: DataTablePaginationState;
  readonly search: string;
  readonly filters: readonly DataSourceFilterQuery[];
  readonly sort: readonly DataSourceSortQuery[];
  readonly columnVisibility: Readonly<Record<string, boolean>>;
  readonly columnOrder: readonly string[];
  readonly columnSizes: Readonly<Record<string, number>>;
  readonly density: "compact" | "comfortable" | "spacious";
  readonly selectedRows: readonly string[];
  readonly detailRow?: string;
}

export type DataTableRequestState = BrowserRequestState<TableRecords>
  | { readonly state: "insufficient-permission" }
  | { readonly state: "stale"; readonly data: TableRecords }
  | { readonly state: "refetching"; readonly data: TableRecords };

function freeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }

function validateDefinition<TInput>(input: DataTableDefinition<TInput>): DataTableDefinition<TInput> {
  const descriptor = DataSourceDescriptorSchema.parse(input.descriptor);
  if (descriptor.primaryContract.id !== "table.records" || input.query.source.id !== descriptor.id || input.query.source.version !== descriptor.version) throw new TypeError("DataTable source/query identity is invalid.");
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/.test(input.id)) throw new TypeError("DataTable ID is invalid.");
  const fields = new Map((descriptor.outputFields ?? []).map((field) => [field.id, field]));
  if (input.columns.length === 0 || new Set(input.columns.map(({ id }) => id)).size !== input.columns.length || input.columns.some(({ id }) => !fields.has(id))) throw new TypeError("DataTable columns must be unique declared source fields.");
  for (const field of fields.values()) if (field.binding === "required" && !input.columns.some(({ id }) => id === field.id)) throw new TypeError(`DataTable omits required field: ${field.id}.`);
  if (input.paginationModes.length === 0 || new Set(input.paginationModes).size !== input.paginationModes.length) throw new TypeError("DataTable requires unique pagination modes.");
  if (!Number.isInteger(input.defaultPageSize) || input.defaultPageSize < 1 || input.defaultPageSize > descriptor.limits.maxPageSize) throw new TypeError("DataTable page size exceeds source limits.");
  if (input.searchField !== undefined && !fields.get(input.searchField)?.filterOperators.includes("contains")) throw new TypeError("DataTable search field must allow contains filtering.");
  for (const fieldId of Object.keys(input.facets ?? {})) if (!fields.get(fieldId)?.filterOperators.includes("in")) throw new TypeError(`DataTable facet field does not allow in filtering: ${fieldId}.`);
  return freeze({
    ...input,
    descriptor: structuredClone(descriptor),
    columns: input.columns.map((column) => ({ ...column })),
    paginationModes: [...input.paginationModes],
    ...(input.facets === undefined ? {} : { facets: Object.fromEntries(Object.entries(input.facets).map(([field, values]) => [field, [...values]])) }),
    ...(input.rowActions === undefined ? {} : { rowActions: input.rowActions.map((action) => ({ ...action })) }),
    ...(input.bulkActions === undefined ? {} : { bulkActions: input.bulkActions.map((action) => ({ ...action })) })
  });
}

export function defineDataTable<TInput>(input: DataTableDefinition<TInput>): DataTableDefinition<TInput> { return validateDefinition(input); }

export function createDataTableState<TInput>(definition: DataTableDefinition<TInput>): DataTableViewState {
  const firstMode = definition.paginationModes[0]!;
  return freeze({
    pagination: firstMode === "offset" ? { mode: "offset", page: 1, size: definition.defaultPageSize } : { mode: "cursor", size: definition.defaultPageSize },
    search: "",
    filters: [],
    sort: [],
    columnVisibility: Object.fromEntries(definition.columns.map((column) => [column.id, column.defaultVisible !== false])),
    columnOrder: definition.columns.map(({ id }) => id),
    columnSizes: Object.fromEntries(definition.columns.flatMap((column) => column.size === undefined ? [] : [[column.id, column.size]])),
    density: "comfortable",
    selectedRows: []
  });
}

function controls<TInput>(definition: DataTableDefinition<TInput>, state: DataTableViewState): DataSourceQueryControls {
  const descriptorFields = new Map((definition.descriptor.outputFields ?? []).map((field) => [field.id, field]));
  if (!definition.paginationModes.includes(state.pagination.mode)) throw new TypeError(`DataTable pagination mode is not declared: ${state.pagination.mode}.`);
  if (!Number.isInteger(state.pagination.size) || state.pagination.size < 1 || state.pagination.size > definition.descriptor.limits.maxPageSize) throw new TypeError("DataTable page size exceeds source limits.");
  if (state.pagination.mode === "offset" && (!Number.isInteger(state.pagination.page) || state.pagination.page < 1)) throw new TypeError("DataTable page is invalid.");
  if (state.filters.length > definition.descriptor.limits.maxFilters || state.sort.length > definition.descriptor.limits.maxSorts) throw new TypeError("DataTable query controls exceed source limits.");
  for (const filter of state.filters) if (!descriptorFields.get(filter.field)?.filterOperators.includes(filter.operator)) throw new TypeError(`DataTable filter is not declared: ${filter.field}/${filter.operator}.`);
  for (const sort of state.sort) if (!descriptorFields.get(sort.field)?.sortable) throw new TypeError(`DataTable sort is not declared: ${sort.field}.`);
  const filters = [...state.filters];
  if (state.search.length > 0) {
    if (state.search.length > 512 || definition.searchField === undefined) throw new TypeError("DataTable search is not declared or exceeds its limit.");
    filters.push({ field: definition.searchField, operator: "contains", value: state.search });
  }
  const pagination = state.pagination.mode === "offset"
    ? { page: { number: state.pagination.page, size: state.pagination.size } }
    : { cursor: { size: state.pagination.size, ...(state.pagination.after === undefined ? {} : { after: state.pagination.after }), ...(state.pagination.before === undefined ? {} : { before: state.pagination.before }) } };
  return DataSourceQueryControlsSchema.parse({ ...pagination, filters, sort: state.sort });
}

export function createDataTableController<TInput>(definitionInput: DataTableDefinition<TInput>) {
  const definition = validateDefinition(definitionInput);
  return Object.freeze({
    definition,
    controls(state: DataTableViewState): DataSourceQueryControls { return freeze(controls(definition, state)); },
    identity(input: TInput, state: DataTableViewState, context: Omit<BrowserQueryContext, "signal">) { return definition.query.identityWithControls(input, controls(definition, state), context); },
    async execute(transport: BrowserDataTransport, input: TInput, state: DataTableViewState, allowedFields: ReadonlySet<string>, context: BrowserQueryContext): Promise<DataTableRequestState> {
      const selection = resolveDataSourceFieldSelection(definition.descriptor, definition.query.selectedFields, allowedFields);
      if (!selection.success && selection.reason === "REQUIRED_FIELD_NOT_ALLOWED") return freeze({ state: "insufficient-permission" });
      if (!selection.success) return freeze({ state: "invalid-contract" });
      return definition.query.executeWithControls(transport, input, controls(definition, state), context);
    },
    serializeView(state: DataTableViewState): string {
      return serializeBrowserViewState({ pagination: state.pagination, search: state.search, filters: state.filters, sort: state.sort, columnVisibility: state.columnVisibility, columnOrder: state.columnOrder, columnSizes: state.columnSizes, density: state.density });
    },
    shouldRefetch(sourceId: string): boolean { return sourceId === definition.descriptor.id; }
  });
}
