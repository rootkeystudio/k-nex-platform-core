import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState
} from "@tanstack/react-table";
import { useMemo, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { DataSourceFilterQuery, TableCell, TableRecords, TableRow } from "@k-nex/contracts";
import type { BrowserMutationContext } from "@k-nex/ui-runtime";

import {
  createDataTableController,
  type DataTableActionResult,
  type DataTableBulkActionResult,
  type DataTableController,
  type DataTableDefinition,
  type DataTableMutationExecutor,
  type DataTableRequestState,
  type DataTableViewState
} from "./data-table-controller.js";
import {
  BulkActionBar,
  ColumnChooser,
  DensityControl,
  DetailPanel,
  FacetFilter,
  FilterBar,
  ForbiddenState,
  InsufficientPermissionState,
  LoadMore,
  LoadingState,
  PaginationControl,
  QueryErrorState,
  RowActions,
  SearchControl,
  SortControl,
  StaleState
} from "./table-controls.js";

function cellContent(value: TableCell | null | undefined): ReactNode {
  if (value == null) return "—";
  if (value.kind === "boolean") return value.value ? "Yes" : "No";
  if (value.kind === "resource") return value.label;
  if (value.kind === "money") return `${value.value} ${value.currency}`;
  return String(value.value);
}

export interface DataTableProps<TInput> {
  readonly definition: DataTableDefinition<TInput>;
  readonly viewState: DataTableViewState;
  readonly requestState: DataTableRequestState;
  readonly label?: string;
  readonly mode?: "table" | "grid";
  readonly onViewStateChange?: (state: DataTableViewState) => void;
  readonly mutationExecutor?: DataTableMutationExecutor;
  readonly actionContext?: BrowserMutationContext;
  readonly onActionResult?: (result: DataTableActionResult | DataTableBulkActionResult) => void | Promise<void>;
  readonly onSourceInvalidated?: (sourceId: string) => void;
  readonly onRefetch?: () => void;
  readonly renderDetail?: (row: TableRow) => ReactNode;
  readonly onLoadMore?: () => void;
  readonly loadMoreLoading?: boolean;
  readonly onRetry?: () => void;
}

function firstPage(pagination: DataTableViewState["pagination"]): DataTableViewState["pagination"] {
  return pagination.mode === "offset" ? { mode: "offset", page: 1, size: pagination.size } : { mode: "cursor", size: pagination.size };
}

function facetValue(filters: readonly DataSourceFilterQuery[], field: string): string {
  const filter = filters.find((candidate) => candidate.field === field && candidate.operator === "in");
  if (filter === undefined || Array.isArray(filter.value) || typeof filter.value !== "string") return "";
  return filter.value;
}

function setFacet(state: DataTableViewState, field: string, value: string): DataTableViewState {
  const filters = state.filters.filter((filter) => filter.field !== field || filter.operator !== "in");
  if (value !== "") filters.push({ field, operator: "in", value: [value] });
  return { ...state, filters, pagination: firstPage(state.pagination) };
}

function withoutDetail(state: DataTableViewState): DataTableViewState {
  const { detailRow: _detailRow, ...rest } = state;
  return rest;
}

function notifyActionResult<TInput>(
  controller: DataTableController<TInput>,
  result: DataTableActionResult | DataTableBulkActionResult,
  props: { readonly onActionResult: DataTableProps<TInput>["onActionResult"]; readonly onSourceInvalidated: DataTableProps<TInput>["onSourceInvalidated"]; readonly onRefetch: DataTableProps<TInput>["onRefetch"] }
): void {
  const exactSources = result.invalidatedSources.filter((sourceId) => controller.shouldRefetch(sourceId));
  exactSources.forEach((sourceId) => props.onSourceInvalidated?.(sourceId));
  if (exactSources.length > 0) props.onRefetch?.();
  void Promise.resolve(props.onActionResult?.(result)).catch(() => undefined);
}

interface ReadyTableProps<TInput> extends Omit<DataTableProps<TInput>, "requestState" | "onRetry"> {
  readonly data: TableRecords;
  readonly controller: DataTableController<TInput>;
}

function ReadyTable<TInput>({
  definition,
  viewState,
  data,
  label,
  mode = "table",
  onViewStateChange,
  mutationExecutor,
  actionContext,
  onActionResult,
  onSourceInvalidated,
  onRefetch,
  renderDetail,
  onLoadMore,
  loadMoreLoading,
  controller
}: ReadyTableProps<TInput>): ReactElement {
  const selectable = (definition.bulkActions ?? []).some((action) => action.capability.state === "allowed");
  const columns: ColumnDef<TableRow>[] = definition.columns.map((column) => {
    const size = viewState.columnSizes[column.id] ?? column.size;
    return {
      id: column.id,
      accessorFn: (row) => row.values[column.id],
      header: column.label,
      ...(size === undefined ? {} : { size }),
      cell: ({ getValue }) => cellContent(getValue() as TableCell | null | undefined)
    };
  });
  if (selectable) columns.unshift({
    id: "selection",
    header: ({ table }) => <input type="checkbox" aria-label="Select all rows" checked={table.getIsAllRowsSelected()} onChange={table.getToggleAllRowsSelectedHandler()} />,
    cell: ({ row }) => <input type="checkbox" aria-label={`Select row ${row.original.key}`} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />,
    size: 48
  });
  if (renderDetail !== undefined) columns.push({
    id: "detail",
    header: "",
    cell: ({ row }) => <button type="button" onClick={() => onViewStateChange?.({ ...viewState, detailRow: row.original.key })}>View</button>,
    size: 64
  });
  if ((definition.rowActions ?? []).some((action) => action.capability.state === "allowed")) columns.push({
    id: "actions",
    header: "Actions",
    cell: ({ row }) => <RowActions
      actions={definition.rowActions ?? []}
      disabled={mutationExecutor === undefined}
      onAction={(id) => {
        if (mutationExecutor === undefined) return;
        const context = actionContext ?? { signal: new AbortController().signal };
        void controller.executeAction(mutationExecutor, id, row.original.key, context).then((result) => {
          notifyActionResult(controller, result, { onActionResult, onSourceInvalidated, onRefetch });
        });
      }}
    />
  });
  const visibility: VisibilityState = { ...viewState.columnVisibility };
  const rowSelection: RowSelectionState = Object.fromEntries(viewState.selectedRows.map((key) => [key, true]));
  const update = (patch: Partial<DataTableViewState>): void => onViewStateChange?.({ ...viewState, ...patch });
  const table = useReactTable({
    data: data.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.key,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: true,
    state: { columnOrder: [...(selectable ? ["selection"] : []), ...viewState.columnOrder, ...(renderDetail === undefined ? [] : ["detail"]), ...(columns.some(({ id }) => id === "actions") ? ["actions"] : [])], columnSizing: { ...viewState.columnSizes }, columnVisibility: visibility, rowSelection },
    onColumnOrderChange: (next) => update({ columnOrder: typeof next === "function" ? next([...viewState.columnOrder]) : next }),
    onColumnSizingChange: (next) => update({ columnSizes: typeof next === "function" ? next({ ...viewState.columnSizes }) : next }),
    onColumnVisibilityChange: (next) => update({ columnVisibility: typeof next === "function" ? next(visibility) : next }),
    onRowSelectionChange: (next) => { const value = typeof next === "function" ? next(rowSelection) : next; update({ selectedRows: Object.keys(value).filter((key) => value[key]) }); }
  });
  const keyboard = mode === "grid" ? (event: KeyboardEvent<HTMLTableElement>): void => {
    if (!event.key.startsWith("Arrow")) return;
    const cells = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=gridcell]")];
    const current = cells.indexOf(event.target as HTMLElement);
    if (current < 0) return;
    const width = Math.max(1, table.getVisibleLeafColumns().length);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? width : -width;
    cells[current + delta]?.focus();
    event.preventDefault();
  } : undefined;
  const actionContextValue = actionContext ?? { signal: new AbortController().signal };
  const updateSearch = (search: string): void => update({ search, pagination: firstPage(viewState.pagination) });
  const updateSort = (sort: DataTableViewState["sort"]): void => update({ sort, pagination: firstPage(viewState.pagination) });
  const sortFields = (definition.descriptor.outputFields ?? []).filter((field) => field.sortable).map(({ id }) => ({ id, label: id }));
  const controls = <FilterBar label="Table controls">
    {definition.searchField === undefined ? null : <SearchControl label={`Search ${definition.descriptor.title}`} value={viewState.search} onChange={updateSearch} />}
    {Object.entries(definition.facets ?? {}).map(([field, options]) => <FacetFilter key={field} label={field} value={facetValue(viewState.filters, field)} options={options} onChange={(value) => onViewStateChange?.(setFacet(viewState, field, value))} />)}
    <SortControl label="Sort" {...(viewState.sort[0] === undefined ? {} : { value: viewState.sort[0] })} fields={sortFields} onChange={(sort) => updateSort(sort === undefined ? [] : [sort])} />
    <ColumnChooser columns={definition.columns} visibility={visibility} onChange={(id, visible) => update({ columnVisibility: { ...viewState.columnVisibility, [id]: visible } })} />
    <DensityControl value={viewState.density} onChange={(density) => update({ density })} />
  </FilterBar>;
  const runBulkAction = (id: string): void => {
    if (mutationExecutor === undefined) return;
    void controller.executeBulkAction(mutationExecutor, id, viewState.selectedRows, actionContextValue).then((result) => {
      notifyActionResult(controller, result, { onActionResult, onSourceInvalidated, onRefetch });
    });
  };
  return <div data-k-nex-component={mode === "grid" ? "data-grid" : "data-table"} data-density={viewState.density} data-slot="root">
    {controls}
    <BulkActionBar actions={definition.bulkActions ?? []} disabled={mutationExecutor === undefined} selectionCount={viewState.selectedRows.length} onAction={runBulkAction} />
    <table aria-label={label ?? definition.descriptor.title} {...(mode === "grid" ? { role: "grid", onKeyDown: keyboard } : {})} data-slot="table"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id} role={mode === "grid" ? "row" : undefined}>{group.headers.map((header) => <th key={header.id} scope="col" role={mode === "grid" ? "columnheader" : undefined} style={{ width: header.getSize() }}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} role={mode === "grid" ? "row" : undefined} data-selected={row.getIsSelected() || undefined}>{row.getVisibleCells().map((cell) => <td key={cell.id} role={mode === "grid" ? "gridcell" : undefined} tabIndex={mode === "grid" ? 0 : undefined}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table>
    {viewState.pagination.mode === "offset" ? <PaginationControl page={viewState.pagination.page} hasNext={data.page.hasNext} onPageChange={(page) => update({ pagination: { mode: "offset", page, size: viewState.pagination.size } })} /> : <LoadMore hasNext={data.page.hasNext} {...(loadMoreLoading === undefined ? {} : { loading: loadMoreLoading })} onLoadMore={() => onLoadMore?.()} />}
    {renderDetail === undefined || viewState.detailRow === undefined ? null : (() => { const row = data.rows.find((candidate) => candidate.key === viewState.detailRow); return row === undefined ? null : <DetailPanel label="Row details" onClose={() => onViewStateChange?.(withoutDetail(viewState))}>{renderDetail(row)}</DetailPanel>; })()}
  </div>;
}

export function DataTable<TInput>(props: DataTableProps<TInput>): ReactElement {
  const { requestState } = props;
  const controller = useMemo(() => createDataTableController(props.definition), [props.definition]);
  if (requestState.state === "idle" || requestState.state === "loading") return <LoadingState />;
  if (requestState.state === "forbidden") return <ForbiddenState />;
  if (requestState.state === "insufficient-permission") return <InsufficientPermissionState />;
  if (requestState.state === "error" || requestState.state === "rate-limited" || requestState.state === "invalid-contract" || requestState.state === "cancelled") return <QueryErrorState {...(props.onRetry === undefined ? {} : { onRetry: props.onRetry })} />;
  if (requestState.state === "empty") return <div role="status" data-k-nex-component="query-empty" data-state="empty">No records.</div>;
  const table = <ReadyTable {...props} controller={controller} data={requestState.data} />;
  if (requestState.state === "stale") return <StaleState {...(props.onRetry === undefined ? {} : { onRetry: props.onRetry })}>{table}</StaleState>;
  return requestState.state === "refetching" ? <section aria-label="Refreshing data" data-k-nex-component="query-refetching" data-state="refetching"><div role="status">Refreshing…</div>{table}</section> : table;
}

export function DataGrid<TInput>(props: Omit<DataTableProps<TInput>, "mode">): ReactElement { return <DataTable {...props} mode="grid" />; }
