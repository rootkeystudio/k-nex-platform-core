import type { ChangeEvent, ReactElement, ReactNode } from "react";
import type { DataSourceSortQuery } from "@k-nex/contracts";

import type { DataTableActionDefinition, DataTableViewState } from "./data-table-controller.js";

export interface SearchControlProps { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; }
export function SearchControl({ label, value, onChange }: SearchControlProps): ReactElement {
  return <label data-k-nex-component="search-control" data-slot="root"><span data-slot="label">{label}</span><input type="search" value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value)} data-slot="input" /></label>;
}

export interface FilterBarProps { readonly label?: string; readonly children: ReactNode; }
export function FilterBar({ label = "Filters", children }: FilterBarProps): ReactElement { return <section aria-label={label} data-k-nex-component="filter-bar" data-slot="root">{children}</section>; }

export interface FacetFilterProps { readonly label: string; readonly value: string; readonly options: readonly string[]; readonly onChange: (value: string) => void; }
export function FacetFilter({ label, value, options, onChange }: FacetFilterProps): ReactElement {
  return <label data-k-nex-component="facet-filter" data-slot="root"><span data-slot="label">{label}</span><select value={value} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.currentTarget.value)} data-slot="input"><option value="">All</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

export interface SortControlProps { readonly label: string; readonly value?: DataSourceSortQuery; readonly fields: readonly { readonly id: string; readonly label: string }[]; readonly onChange: (value: DataSourceSortQuery | undefined) => void; }
export function SortControl({ label, value, fields, onChange }: SortControlProps): ReactElement {
  const encoded = value === undefined ? "" : `${value.field}:${value.direction}`;
  return <label data-k-nex-component="sort-control" data-slot="root"><span>{label}</span><select value={encoded} onChange={(event) => { const [field, direction] = event.currentTarget.value.split(":"); onChange(field === undefined || field === "" || (direction !== "asc" && direction !== "desc") ? undefined : { field, direction }); }}><option value="">Unsorted</option>{fields.flatMap((field) => [<option key={`${field.id}:asc`} value={`${field.id}:asc`}>{field.label} ascending</option>, <option key={`${field.id}:desc`} value={`${field.id}:desc`}>{field.label} descending</option>])}</select></label>;
}

export interface ColumnChooserProps { readonly columns: readonly { readonly id: string; readonly label: string }[]; readonly visibility: Readonly<Record<string, boolean>>; readonly onChange: (id: string, visible: boolean) => void; }
export function ColumnChooser({ columns, visibility, onChange }: ColumnChooserProps): ReactElement {
  return <fieldset data-k-nex-component="column-chooser" data-slot="root"><legend>Columns</legend>{columns.map((column) => <label key={column.id}><input type="checkbox" checked={visibility[column.id] !== false} onChange={(event) => onChange(column.id, event.currentTarget.checked)} />{column.label}</label>)}</fieldset>;
}

export interface DensityControlProps { readonly value: DataTableViewState["density"]; readonly onChange: (value: DataTableViewState["density"]) => void; }
export function DensityControl({ value, onChange }: DensityControlProps): ReactElement {
  return <label data-k-nex-component="density-control" data-slot="root"><span>Density</span><select value={value} onChange={(event) => onChange(event.currentTarget.value as DataTableViewState["density"])}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label>;
}

export interface SelectionSummaryProps { readonly count: number; }
export function SelectionSummary({ count }: SelectionSummaryProps): ReactElement { return <span role="status" data-k-nex-component="selection-summary" data-slot="root">{count} selected</span>; }

export interface ActionBarProps { readonly actions: readonly DataTableActionDefinition[]; readonly selectionCount?: number; readonly onAction?: (id: string) => void; }
export function BulkActionBar({ actions, selectionCount = 0, onAction }: ActionBarProps): ReactElement | null {
  const allowed = actions.filter((action) => action.allowed);
  if (selectionCount === 0 || allowed.length === 0) return null;
  return <div aria-label="Bulk actions" data-k-nex-component="bulk-action-bar" data-slot="root"><span>{selectionCount} selected</span>{allowed.map((action) => <button key={action.id} type="button" onClick={() => onAction?.(action.id)} data-state={action.destructive ? "destructive" : "default"}>{action.label}</button>)}</div>;
}

export function RowActions({ actions, onAction }: ActionBarProps): ReactElement | null {
  const allowed = actions.filter((action) => action.allowed);
  if (allowed.length === 0) return null;
  return <div aria-label="Row actions" data-k-nex-component="row-actions" data-slot="root">{allowed.map((action) => <button key={action.id} type="button" onClick={() => onAction?.(action.id)} data-state={action.destructive ? "destructive" : "default"}>{action.label}</button>)}</div>;
}

export interface QueryStateProps { readonly children: ReactNode; readonly onRetry?: () => void; }
export function LoadingState(): ReactElement { return <div role="status" data-k-nex-component="query-loading" data-state="loading">Loading…</div>; }
export function ForbiddenState(): ReactElement { return <div role="alert" data-k-nex-component="query-forbidden" data-state="forbidden">You do not have access.</div>; }
export function InsufficientPermissionState(): ReactElement { return <div role="alert" data-k-nex-component="query-insufficient-permission" data-state="insufficient-permission">Required fields are not available.</div>; }
export function QueryErrorState({ onRetry }: Pick<QueryStateProps, "onRetry">): ReactElement { return <div role="alert" data-k-nex-component="query-error" data-state="error">Data could not be loaded.{onRetry === undefined ? null : <button type="button" onClick={onRetry}>Retry</button>}</div>; }
export function ErrorState(props: Pick<QueryStateProps, "onRetry">): ReactElement { return <QueryErrorState {...props} />; }
export function StaleState({ children, onRetry }: QueryStateProps): ReactElement { return <section aria-label="Stale data" data-k-nex-component="query-stale" data-state="stale"><div role="status">Data may be outdated.{onRetry === undefined ? null : <button type="button" onClick={onRetry}>Refresh</button>}</div>{children}</section>; }

export interface DetailPanelProps { readonly label: string; readonly children: ReactNode; readonly onClose: () => void; }
export function DetailPanel({ label, children, onClose }: DetailPanelProps): ReactElement { return <aside aria-label={label} data-k-nex-component="detail-panel" data-slot="root"><button type="button" onClick={onClose}>Close</button>{children}</aside>; }
export interface LoadMoreProps { readonly hasNext: boolean; readonly loading?: boolean; readonly onLoadMore: () => void; }
export function LoadMore({ hasNext, loading = false, onLoadMore }: LoadMoreProps): ReactElement | null { return hasNext ? <button type="button" disabled={loading} onClick={onLoadMore} data-k-nex-component="load-more" data-state={loading ? "loading" : "ready"}>{loading ? "Loading…" : "Load more"}</button> : null; }
export interface InfiniteListProps { readonly children: ReactNode; readonly hasNext: boolean; readonly loading?: boolean; readonly onLoadMore: () => void; }
export function InfiniteList({ children, hasNext, loading, onLoadMore }: InfiniteListProps): ReactElement { return <section aria-label="Results" data-k-nex-component="infinite-list" data-slot="root">{children}<LoadMore hasNext={hasNext} {...(loading === undefined ? {} : { loading })} onLoadMore={onLoadMore} /></section>; }
