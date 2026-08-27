import {
  DataSourceDescriptorSchema,
  DataSourceQueryControlsSchema,
  ResourceIdSchema,
  TABLE_ROW_LIMIT,
  TableRowKeySchema,
  resolveDataSourceFieldSelection,
  type DataSourceDescriptor,
  type DataSourceFilterQuery,
  type DataSourceQueryControls,
  type DataSourceSortQuery,
  type TableRecords
} from "@k-nex/contracts";
import {
  serializeBrowserViewState,
  type ActionMutationDefinition,
  type BrowserDataTransport,
  type BrowserMutationContext,
  type BrowserQueryContext,
  type BrowserRequestState,
  type SourceQueryDefinition
} from "@k-nex/ui-runtime";

export interface DataTableColumnDefinition { readonly id: string; readonly label: string; readonly defaultVisible?: boolean; readonly size?: number; }
export interface DataTableActionDefinition {
  readonly id: string;
  readonly action: { readonly id: string; readonly version: number };
  readonly mutation: ActionMutationDefinition<never, unknown>;
  readonly input: (rowKey: string) => unknown;
  readonly label: string;
  readonly destructive?: boolean;
}
export interface DataTableActionCapability {
  readonly state: "allowed" | "denied";
  readonly action: { readonly id: string; readonly version: number };
}
export interface DataTableActionAuthorization {
  readonly actorFingerprint: string;
  readonly catalogRevision: string;
  readonly capabilities: readonly DataTableActionCapability[];
}
export interface DataTableActionCapabilityResolver {
  resolve(request: {
    readonly actorFingerprint: string;
    readonly actions: readonly { readonly id: string; readonly version: number }[];
  }): DataTableActionAuthorization;
}
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

export interface DataTableMutationExecutor {
  execute(
    mutation: ActionMutationDefinition<never, unknown>,
    input: unknown,
    context: BrowserMutationContext
  ): Promise<BrowserRequestState<unknown>>;
}

export interface DataTableActionResult {
  readonly action?: { readonly id: string; readonly version: number };
  readonly rowKey: string;
  readonly result: BrowserRequestState<unknown>;
  readonly invalidatedSources: readonly string[];
}

export interface DataTableBulkActionResult {
  readonly action?: { readonly id: string; readonly version: number };
  readonly state: "success" | "partial" | "failure" | "forbidden" | "cancelled";
  readonly results: readonly DataTableActionResult[];
  readonly succeededRowKeys: readonly string[];
  readonly failedRowKeys: readonly string[];
  readonly invalidatedSources: readonly string[];
}

function freeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }

function actionContractIsValid(action: DataTableActionDefinition): boolean {
  return ResourceIdSchema.safeParse(action.id).success
    && typeof action.action?.id === "string"
    && action.action.id === action.id
    && Number.isSafeInteger(action.action.version)
    && action.action.version > 0
    && action.mutation?.kind === "action-mutation"
    && action.mutation.action.id === action.action.id
    && action.mutation.action.version === action.action.version
    && Array.isArray(action.mutation.invalidation.sources)
    && typeof action.mutation.execute === "function"
    && typeof action.input === "function";
}

const authoritativeActionAuthorizations = new WeakSet<object>();
const authorizationResolvers = new WeakMap<object, { readonly definition: DataTableDefinition<unknown>; readonly resolver: DataTableActionCapabilityResolver }>();
const fingerprintPattern = /^sha256:[0-9a-f]{64}$/;

function actionKey(action: { readonly id: string; readonly version: number }): string { return `${action.id}@${action.version}`; }

export function resolveDataTableActionAuthorization<TInput>(definition: DataTableDefinition<TInput>, actorFingerprint: string, resolver: DataTableActionCapabilityResolver): DataTableActionAuthorization {
  if (!fingerprintPattern.test(actorFingerprint)) throw new TypeError("DataTable action actor fingerprint is invalid.");
  const actions = [...(definition.rowActions ?? []), ...(definition.bulkActions ?? [])];
  const requested = [...new Map(actions.map(({ action }) => [actionKey(action), { ...action }])).values()];
  const response = resolver.resolve(Object.freeze({ actorFingerprint, actions: Object.freeze(requested) }));
  if (response.actorFingerprint !== actorFingerprint || !fingerprintPattern.test(response.catalogRevision)) throw new TypeError("DataTable action authorization identity is invalid.");
  const expected = new Set(requested.map(actionKey));
  const received = new Set<string>();
  for (const capability of response.capabilities) {
    const key = actionKey(capability.action);
    if (!expected.has(key) || received.has(key) || capability.state !== "allowed" && capability.state !== "denied") throw new TypeError(`DataTable action authorization result is invalid: ${key}.`);
    received.add(key);
  }
  if (received.size !== expected.size) throw new TypeError("DataTable action authorization result is incomplete.");
  const authorization = freeze({ actorFingerprint, catalogRevision: response.catalogRevision, capabilities: response.capabilities.map((capability) => ({ state: capability.state, action: { ...capability.action } })) });
  authoritativeActionAuthorizations.add(authorization);
  authorizationResolvers.set(authorization, { definition: definition as DataTableDefinition<unknown>, resolver });
  return authorization;
}

export function allowedDataTableActions(
  actions: readonly DataTableActionDefinition[],
  authorization: DataTableActionAuthorization | undefined,
  actorFingerprint: string | undefined
): readonly DataTableActionDefinition[] {
  if (authorization === undefined || actorFingerprint === undefined || !authoritativeActionAuthorizations.has(authorization) || authorization.actorFingerprint !== actorFingerprint) return [];
  const registration = authorizationResolvers.get(authorization);
  if (registration === undefined) return [];
  try { authorization = resolveDataTableActionAuthorization(registration.definition, actorFingerprint, registration.resolver); } catch { return []; }
  const byIdentity = new Map<string, DataTableActionCapability>();
  for (const capability of authorization.capabilities) {
    const key = actionKey(capability.action);
    if (byIdentity.has(key)) throw new TypeError(`Duplicate DataTable action capability: ${key}.`);
    byIdentity.set(key, capability);
  }
  return actions.filter((action) => byIdentity.get(actionKey(action.action))?.state === "allowed");
}

function actionIsAllowed(action: DataTableActionDefinition, authorization: DataTableActionAuthorization | undefined, actorFingerprint: string | undefined): boolean {
  return allowedDataTableActions([action], authorization, actorFingerprint).length === 1;
}

function actionById(actions: readonly DataTableActionDefinition[], actionId: string): DataTableActionDefinition | undefined {
  return actions.find((action) => action.id === actionId);
}

function actionResult(
  action: DataTableActionDefinition | undefined,
  rowKey: string,
  result: BrowserRequestState<unknown>,
  invalidatedSources: readonly string[] = []
): DataTableActionResult {
  return freeze({
    ...(action === undefined ? {} : { action: { ...action.action } }),
    rowKey,
    result,
    invalidatedSources: [...invalidatedSources]
  });
}

function forbiddenResult(action: DataTableActionDefinition | undefined, rowKey: string): DataTableActionResult {
  return actionResult(action, rowKey, freeze({ state: "forbidden", problem: { code: "ACTION_FORBIDDEN", status: 403 } }));
}

function invalidActionResult(action: DataTableActionDefinition | undefined, rowKey: string): DataTableActionResult {
  return actionResult(action, rowKey, freeze({ state: "invalid-contract" }));
}

function failedActionResult(action: DataTableActionDefinition | undefined, rowKey: string): DataTableActionResult {
  return actionResult(action, rowKey, freeze({ state: "error", problem: { code: "ACTION_FAILED", status: 500 } }));
}

function bulkState(results: readonly DataTableActionResult[]): DataTableBulkActionResult["state"] {
  const successful = results.filter(({ result }) => result.state === "success").length;
  if (successful === results.length) return "success";
  if (successful > 0) return "partial";
  if (results.every(({ result }) => result.state === "cancelled")) return "cancelled";
  if (results.every(({ result }) => result.state === "forbidden")) return "forbidden";
  return "failure";
}

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
  for (const action of [...(input.rowActions ?? []), ...(input.bulkActions ?? [])]) {
    if (!actionContractIsValid(action)) throw new TypeError(`DataTable action is not a canonical registered mutation: ${action.id}.`);
    if (action.mutation.invalidation.sources.some((sourceId) => !ResourceIdSchema.safeParse(sourceId).success)) throw new TypeError(`DataTable action invalidation is invalid: ${action.id}.`);
  }
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
  if (state.sort.length > definition.descriptor.limits.maxSorts) throw new TypeError("DataTable query controls exceed source limits.");
  for (const filter of state.filters) if (!descriptorFields.get(filter.field)?.filterOperators.includes(filter.operator)) throw new TypeError(`DataTable filter is not declared: ${filter.field}/${filter.operator}.`);
  for (const sort of state.sort) if (!descriptorFields.get(sort.field)?.sortable) throw new TypeError(`DataTable sort is not declared: ${sort.field}.`);
  const filters = [...state.filters];
  if (state.search.length > 0) {
    if (state.search.length > 512 || definition.searchField === undefined) throw new TypeError("DataTable search is not declared or exceeds its limit.");
    filters.push({ field: definition.searchField, operator: "contains", value: state.search });
  }
  if (filters.length > definition.descriptor.limits.maxFilters) throw new TypeError("DataTable query controls exceed source limits.");
  const pagination = state.pagination.mode === "offset"
    ? { page: { number: state.pagination.page, size: state.pagination.size } }
    : { cursor: { size: state.pagination.size, ...(state.pagination.after === undefined ? {} : { after: state.pagination.after }), ...(state.pagination.before === undefined ? {} : { before: state.pagination.before }) } };
  return DataSourceQueryControlsSchema.parse({ ...pagination, filters, sort: state.sort });
}

export interface DataTableController<TInput> {
  readonly definition: DataTableDefinition<TInput>;
  controls(state: DataTableViewState): DataSourceQueryControls;
  identity(input: TInput, state: DataTableViewState, allowedFields: ReadonlySet<string>, context: Omit<BrowserQueryContext, "signal">): Promise<import("@k-nex/contracts").DataSourceQueryIdentity>;
  execute(transport: BrowserDataTransport, input: TInput, state: DataTableViewState, allowedFields: ReadonlySet<string>, context: BrowserQueryContext): Promise<DataTableRequestState>;
  executeAction(executor: DataTableMutationExecutor, authorization: DataTableActionAuthorization | undefined, actorFingerprint: string | undefined, actionId: string, rowKey: string, context: BrowserMutationContext): Promise<DataTableActionResult>;
  executeBulkAction(executor: DataTableMutationExecutor, authorization: DataTableActionAuthorization | undefined, actorFingerprint: string | undefined, actionId: string, rowKeys: readonly string[], context: BrowserMutationContext): Promise<DataTableBulkActionResult>;
  serializeView(state: DataTableViewState): string;
  shouldRefetch(sourceId: string): boolean;
}

export function createDataTableMutationExecutor(transport: BrowserDataTransport): DataTableMutationExecutor {
  return Object.freeze({
    execute(mutation: ActionMutationDefinition<never, unknown>, input: unknown, context: BrowserMutationContext) {
      return mutation.execute(transport, input as never, context);
    }
  });
}

export function createDataTableController<TInput>(definitionInput: DataTableDefinition<TInput>): DataTableController<TInput> {
  const definition = validateDefinition(definitionInput);
  const executeRegisteredAction = async (executor: DataTableMutationExecutor, authorization: DataTableActionAuthorization | undefined, actorFingerprint: string | undefined, action: DataTableActionDefinition | undefined, rowKey: string, context: BrowserMutationContext): Promise<DataTableActionResult> => {
    if (action === undefined) return forbiddenResult(action, rowKey);
    if (!actionContractIsValid(action)) return invalidActionResult(action, rowKey);
    if (!actionIsAllowed(action, authorization, actorFingerprint)) return forbiddenResult(action, rowKey);
    if (!TableRowKeySchema.safeParse(rowKey).success) return invalidActionResult(action, rowKey);
    let input: unknown;
    try { input = action.input(rowKey); } catch { return failedActionResult(action, rowKey); }
    try {
      const result = await executor.execute(action.mutation, input, context);
      return actionResult(action, rowKey, result, result.state === "success" ? action.mutation.invalidation.sources : []);
    } catch {
      return failedActionResult(action, rowKey);
    }
  };
  const executeAction = (executor: DataTableMutationExecutor, authorization: DataTableActionAuthorization | undefined, actorFingerprint: string | undefined, actionId: string, rowKey: string, context: BrowserMutationContext): Promise<DataTableActionResult> => executeRegisteredAction(executor, authorization, actorFingerprint, actionById(definition.rowActions ?? [], actionId), rowKey, context);
  const executeBulkAction = async (executor: DataTableMutationExecutor, authorization: DataTableActionAuthorization | undefined, actorFingerprint: string | undefined, actionId: string, rowKeys: readonly string[], context: BrowserMutationContext): Promise<DataTableBulkActionResult> => {
    const action = actionById(definition.bulkActions ?? [], actionId);
    if (rowKeys.length === 0 || rowKeys.length > TABLE_ROW_LIMIT || new Set(rowKeys).size !== rowKeys.length) {
      return freeze({
        ...(action === undefined ? {} : { action: { ...action.action } }),
        state: "failure",
        results: [],
        succeededRowKeys: [],
        failedRowKeys: [...rowKeys],
        invalidatedSources: []
      });
    }
    if (action === undefined || !actionContractIsValid(action) || !actionIsAllowed(action, authorization, actorFingerprint)) {
      const valid = action !== undefined && actionContractIsValid(action);
      const forbidden = action === undefined || valid && !actionIsAllowed(action, authorization, actorFingerprint);
      const results = rowKeys.map((rowKey) => forbidden ? forbiddenResult(action, rowKey) : invalidActionResult(action, rowKey));
      return freeze({
        ...(action === undefined ? {} : { action: { ...action.action } }),
        state: valid ? "forbidden" : "failure",
        results,
        succeededRowKeys: [],
        failedRowKeys: [...rowKeys],
        invalidatedSources: []
      });
    }
    const results: DataTableActionResult[] = [];
    for (const rowKey of rowKeys) {
      if (context.signal.aborted) {
        results.push(actionResult(action, rowKey, freeze({ state: "cancelled" })));
        continue;
      }
      const rowContext = rowKeys.length === 1 || context.idempotencyKey === undefined
        ? context
        : { ...context, idempotencyKey: `${context.idempotencyKey}:${rowKey}` };
      results.push(await executeRegisteredAction(executor, authorization, actorFingerprint, action, rowKey, rowContext));
    }
    const successful = results.filter(({ result }) => result.state === "success").map(({ rowKey }) => rowKey);
    const failed = results.filter(({ result }) => result.state !== "success").map(({ rowKey }) => rowKey);
    const invalidatedSources = [...new Set(results.flatMap(({ invalidatedSources: sources }) => sources))].sort();
    return freeze({
      action: { ...action.action },
      state: bulkState(results),
      results,
      succeededRowKeys: successful,
      failedRowKeys: failed,
      invalidatedSources
    });
  };
  return Object.freeze({
    definition,
    controls(state: DataTableViewState): DataSourceQueryControls { return freeze(controls(definition, state)); },
    identity(input: TInput, state: DataTableViewState, allowedFields: ReadonlySet<string>, context: Omit<BrowserQueryContext, "signal">) {
      const selection = resolveDataSourceFieldSelection(definition.descriptor, definition.query.selectedFields, allowedFields);
      if (!selection.success) return Promise.reject(new TypeError("DataTable field selection is not authorized."));
      return definition.query.identityWithControls(input, controls(definition, state), context, selection.selectedFields);
    },
    async execute(transport: BrowserDataTransport, input: TInput, state: DataTableViewState, allowedFields: ReadonlySet<string>, context: BrowserQueryContext): Promise<DataTableRequestState> {
      const selection = resolveDataSourceFieldSelection(definition.descriptor, definition.query.selectedFields, allowedFields);
      if (!selection.success && selection.reason === "REQUIRED_FIELD_NOT_ALLOWED") return freeze({ state: "insufficient-permission" });
      if (!selection.success) return freeze({ state: "invalid-contract" });
      const result = await definition.query.executeWithControls(transport, input, controls(definition, state), context, selection.selectedFields);
      if (state.pagination.mode === "cursor" && result.state === "success" && result.data.page.hasNext && result.data.page.nextCursor === undefined) return freeze({ state: "invalid-contract" });
      return result;
    },
    executeAction,
    executeBulkAction,
    serializeView(state: DataTableViewState): string {
      return serializeBrowserViewState({ pagination: state.pagination, search: state.search, filters: state.filters, sort: state.sort, columnVisibility: state.columnVisibility, columnOrder: state.columnOrder, columnSizes: state.columnSizes, density: state.density });
    },
    shouldRefetch(sourceId: string): boolean { return sourceId === definition.descriptor.id; }
  });
}
