import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState
} from "@tanstack/react-table";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import type { TableCell, TableRecords, TableRow } from "@k-nex/contracts";

import type { DataTableDefinition, DataTableRequestState, DataTableViewState } from "./data-table-controller.js";
import { BulkActionBar, ForbiddenState, InsufficientPermissionState, LoadingState, QueryErrorState, RowActions, StaleState } from "./table-controls.js";

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
  readonly onRowAction?: (actionId: string, rowKey: string) => void;
  readonly onBulkAction?: (actionId: string, rowKeys: readonly string[]) => void;
  readonly onRetry?: () => void;
}

function ReadyTable<TInput>({ definition, viewState, data, label, mode = "table", onViewStateChange, onRowAction, onBulkAction }: Omit<DataTableProps<TInput>, "requestState" | "onRetry"> & { readonly data: TableRecords }): ReactElement {
  const selectable = (definition.bulkActions ?? []).some((action) => action.allowed);
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
  if ((definition.rowActions ?? []).some((action) => action.allowed)) columns.push({ id: "actions", header: "Actions", cell: ({ row }) => <RowActions actions={definition.rowActions ?? []} onAction={(id) => onRowAction?.(id, row.original.key)} /> });
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
    state: { columnOrder: [...(selectable ? ["selection"] : []), ...viewState.columnOrder, ...(columns.some(({ id }) => id === "actions") ? ["actions"] : [])], columnSizing: { ...viewState.columnSizes }, columnVisibility: visibility, rowSelection },
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
  return <div data-k-nex-component={mode === "grid" ? "data-grid" : "data-table"} data-density={viewState.density} data-slot="root">
    <BulkActionBar actions={definition.bulkActions ?? []} selectionCount={viewState.selectedRows.length} onAction={(id) => onBulkAction?.(id, viewState.selectedRows)} />
    <table aria-label={label ?? definition.descriptor.title} {...(mode === "grid" ? { role: "grid", onKeyDown: keyboard } : {})} data-slot="table"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id} role={mode === "grid" ? "row" : undefined}>{group.headers.map((header) => <th key={header.id} scope="col" role={mode === "grid" ? "columnheader" : undefined} style={{ width: header.getSize() }}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} role={mode === "grid" ? "row" : undefined} data-selected={row.getIsSelected() || undefined}>{row.getVisibleCells().map((cell) => <td key={cell.id} role={mode === "grid" ? "gridcell" : undefined} tabIndex={mode === "grid" ? 0 : undefined}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table>
  </div>;
}

export function DataTable<TInput>(props: DataTableProps<TInput>): ReactElement {
  const { requestState } = props;
  if (requestState.state === "idle" || requestState.state === "loading") return <LoadingState />;
  if (requestState.state === "forbidden") return <ForbiddenState />;
  if (requestState.state === "insufficient-permission") return <InsufficientPermissionState />;
  if (requestState.state === "error" || requestState.state === "rate-limited" || requestState.state === "invalid-contract" || requestState.state === "cancelled") return <QueryErrorState {...(props.onRetry === undefined ? {} : { onRetry: props.onRetry })} />;
  if (requestState.state === "empty") return <div role="status" data-k-nex-component="query-empty" data-state="empty">No records.</div>;
  const table = <ReadyTable {...props} data={requestState.data} />;
  if (requestState.state === "stale") return <StaleState {...(props.onRetry === undefined ? {} : { onRetry: props.onRetry })}>{table}</StaleState>;
  return requestState.state === "refetching" ? <section aria-label="Refreshing data" data-k-nex-component="query-refetching" data-state="refetching"><div role="status">Refreshing…</div>{table}</section> : table;
}

export function DataGrid<TInput>(props: Omit<DataTableProps<TInput>, "mode">): ReactElement { return <DataTable {...props} mode="grid" />; }
