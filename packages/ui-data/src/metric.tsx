import type { ReactElement, ReactNode } from "react";
import type { MetricScalar, MetricScalarValue } from "@k-nex/contracts";
import type { BrowserRequestState } from "@k-nex/ui-runtime";

import { ForbiddenState, LoadingState, QueryErrorState } from "./table-controls.js";

function metricValue(value: MetricScalarValue): string {
  if (value.kind === "money") return `${value.value} ${value.currency}`;
  if (value.kind === "decimal") return `${value.value}${value.unit === undefined ? "" : ` ${value.unit}`}`;
  if (value.kind === "duration") return `${value.value} ${value.unit}`;
  if (value.kind === "percentage") return `${value.value}%`;
  return String(value.value);
}

export interface MetricProps { readonly label: string; readonly metric: MetricScalar; }
export function Metric({ label, metric }: MetricProps): ReactElement { return <div role="status" aria-label={label} data-k-nex-component="metric" data-slot="root"><span data-slot="label">{label}</span><strong data-slot="value">{metricValue(metric.value)}</strong>{metric.comparison === undefined ? null : <span data-slot="comparison" data-state={metric.comparison.sentiment}>{metricValue(metric.comparison.value)}</span>}</div>; }
export interface MetricGroupProps { readonly label: string; readonly children: ReactNode; }
export function MetricGroup({ label, children }: MetricGroupProps): ReactElement { return <section aria-label={label} data-k-nex-component="metric-group" data-slot="root">{children}</section>; }
export function StatCard({ label, metric }: MetricProps): ReactElement { return <article data-k-nex-component="stat-card" data-slot="root"><Metric label={label} metric={metric} /></article>; }

export interface QueryBoundaryProps<T> { readonly state: BrowserRequestState<T>; readonly children: (data: T) => ReactNode; readonly empty?: ReactNode; readonly onRetry?: () => void; }
export function QueryBoundary<T>({ state, children, empty = "No data.", onRetry }: QueryBoundaryProps<T>): ReactElement {
  if (state.state === "idle" || state.state === "loading") return <LoadingState />;
  if (state.state === "forbidden") return <ForbiddenState />;
  if (state.state === "empty") return <div role="status" data-k-nex-component="query-empty" data-state="empty">{empty}</div>;
  if (state.state !== "success") return <QueryErrorState {...(onRetry === undefined ? {} : { onRetry })} />;
  return <div data-k-nex-component="query-boundary" data-state="success">{children(state.data)}</div>;
}
