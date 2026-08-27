import { createElement, type ReactElement } from "react";

import type {
  BadgeProps, BoxProps, CardProps, ContainerProps, EmptyStateProps, ErrorStateProps,
  FormFieldProps, GridProps, HeadingProps, InlineProps, SkeletonProps, StackProps,
  StatusProps, TableProps, TextProps, ToastProps
} from "./types.js";

export function Box({ children, element = "div" }: BoxProps): ReactElement {
  return createElement(element, { "data-k-nex-primitive": "box" }, children);
}

export function Stack({ children, gap = "content", align = "stretch" }: StackProps): ReactElement {
  return <div data-k-nex-primitive="stack" data-gap={gap} data-align={align}>{children}</div>;
}

export function Inline({ children, gap = "content", align = "center", wrap = true }: InlineProps): ReactElement {
  return <div data-k-nex-primitive="inline" data-gap={gap} data-align={align} data-wrap={wrap}>{children}</div>;
}

export function Grid({ children, columns = 1, gap = "content" }: GridProps): ReactElement {
  return <div data-k-nex-primitive="grid" data-columns={columns} data-gap={gap}>{children}</div>;
}

export function Container({ children, size = "content" }: ContainerProps): ReactElement {
  return <div data-k-nex-primitive="container" data-size={size}>{children}</div>;
}

export function Text({ children, element = "span", size = "body", tone = "neutral", weight = "regular" }: TextProps): ReactElement {
  return createElement(element, { "data-k-nex-primitive": "text", "data-size": size, "data-tone": tone, "data-weight": weight }, children);
}

export function Heading({ children, level }: HeadingProps): ReactElement {
  return createElement(`h${level}`, { "data-k-nex-primitive": "heading", "data-level": level }, children);
}

export function Card({ children, variant = "default" }: CardProps): ReactElement {
  return <section data-k-nex-primitive="card" data-variant={variant}>{children}</section>;
}

export function Badge({ children, tone = "neutral" }: BadgeProps): ReactElement {
  return <span data-k-nex-primitive="badge" data-tone={tone}>{children}</span>;
}

export function Status({ children, tone = "neutral", live = "polite" }: StatusProps): ReactElement {
  return <span role={live === "assertive" ? "alert" : "status"} aria-live={live} data-k-nex-primitive="status" data-tone={tone}>{children}</span>;
}

export function FormField({ children, legend, description, error }: FormFieldProps): ReactElement {
  return <fieldset data-k-nex-primitive="form-field" aria-invalid={error === undefined ? undefined : true}>
    <legend>{legend}</legend>
    {description === undefined ? null : <p data-slot="description">{description}</p>}
    {children}
    {error === undefined ? null : <p data-slot="error" role="alert">{error}</p>}
  </fieldset>;
}

export function Toast({ children, tone = "neutral", priority = "polite" }: ToastProps): ReactElement {
  return <div role={priority === "assertive" ? "alert" : "status"} aria-live={priority} data-k-nex-primitive="toast" data-tone={tone}>{children}</div>;
}

export function Skeleton({ label }: SkeletonProps): ReactElement {
  return <div role="status" aria-label={label} data-k-nex-primitive="skeleton" />;
}

export function EmptyState({ title, message, action }: EmptyStateProps): ReactElement {
  return <section data-k-nex-primitive="empty-state"><h2>{title}</h2>{message === undefined ? null : <p>{message}</p>}{action}</section>;
}

export function ErrorState({ title, message, action, code }: ErrorStateProps): ReactElement {
  return <section role="alert" data-k-nex-primitive="error-state"><h2>{title}</h2>{message === undefined ? null : <p>{message}</p>}{code === undefined ? null : <code>{code}</code>}{action}</section>;
}

export function Table({ label, columns, rows, emptyMessage = "No records" }: TableProps): ReactElement {
  return <table aria-label={label} data-k-nex-primitive="table">
    <thead><tr>{columns.map((column) => <th key={column.id} scope="col">{column.label}</th>)}</tr></thead>
    <tbody>{rows.length === 0
      ? <tr><td colSpan={columns.length}>{emptyMessage}</td></tr>
      : rows.map((row) => <tr key={row.id}>{columns.map((column) => column.isRowHeader
        ? <th key={column.id} scope="row">{row.cells[column.id]}</th>
        : <td key={column.id}>{row.cells[column.id]}</td>)}</tr>)}</tbody>
  </table>;
}
