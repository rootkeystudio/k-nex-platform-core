import type { ReactElement, ReactNode } from "react";

export {
  Badge, Box, Card, Container, EmptyState, ErrorState, Grid, Heading, Inline,
  Link, Skeleton, Stack, Status, Table, Text
} from "@k-nex/ui-design-system-contracts";

export interface SectionProps { readonly children?: ReactNode; readonly label?: string; }
export function Section({ children, label }: SectionProps): ReactElement {
  return <section aria-label={label} data-k-nex-component="section" data-slot="root">{children}</section>;
}

export interface ListProps { readonly children?: ReactNode; readonly ordered?: boolean; }
export function List({ children, ordered = false }: ListProps): ReactElement {
  const Element = ordered ? "ol" : "ul";
  return <Element data-k-nex-component="list" data-slot="root">{children}</Element>;
}

export interface IconProps { readonly children: ReactNode; readonly label?: string; }
export function Icon({ children, label }: IconProps): ReactElement {
  return <span {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })} data-k-nex-component="icon" data-slot="root">{children}</span>;
}

export interface ImageProps {
  readonly src: string;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
  readonly loading?: "eager" | "lazy";
}
export function Image({ src, alt, width, height, loading = "lazy" }: ImageProps): ReactElement {
  return <img src={src} alt={alt} width={width} height={height} loading={loading} data-k-nex-component="image" data-slot="root" />;
}

export interface AvatarProps extends Pick<ImageProps, "src" | "alt"> { readonly fallback: string; }
export function Avatar({ src, alt, fallback }: AvatarProps): ReactElement {
  return <span data-k-nex-component="avatar" data-slot="root"><img src={src} alt={alt} data-slot="image" /><span aria-hidden="true" data-slot="fallback">{fallback}</span></span>;
}

export interface AlertProps { readonly children: ReactNode; readonly title?: string; readonly tone?: "neutral" | "positive" | "warning" | "critical"; }
export function Alert({ children, title, tone = "neutral" }: AlertProps): ReactElement {
  return <section role={tone === "critical" ? "alert" : "status"} data-k-nex-component="alert" data-slot="root" data-state={tone}>{title === undefined ? null : <strong data-slot="title">{title}</strong>}<div data-slot="content">{children}</div></section>;
}

export interface SeparatorProps { readonly orientation?: "horizontal" | "vertical"; }
export function Separator({ orientation = "horizontal" }: SeparatorProps): ReactElement {
  return <hr aria-orientation={orientation} data-k-nex-component="separator" data-slot="root" data-state={orientation} />;
}

export interface SpinnerProps { readonly label: string; }
export function Spinner({ label }: SpinnerProps): ReactElement {
  return <span role="status" aria-label={label} data-k-nex-component="spinner" data-slot="root" data-state="pending" />;
}

export interface ProgressProps { readonly label: string; readonly value?: number; readonly max?: number; }
export function Progress({ label, value, max = 100 }: ProgressProps): ReactElement {
  return <progress aria-label={label} {...(value === undefined ? {} : { value })} max={max} data-k-nex-component="progress" data-slot="root" data-state={value === undefined ? "pending" : "determinate"} />;
}

export function ProgressBar(props: ProgressProps): ReactElement {
  return <progress aria-label={props.label} {...(props.value === undefined ? {} : { value: props.value })} max={props.max ?? 100} data-k-nex-component="progress-bar" data-slot="root" data-state={props.value === undefined ? "pending" : "determinate"} />;
}

export function ProgressIndicator({ label }: SpinnerProps): ReactElement {
  return <span role="status" aria-label={label} data-k-nex-component="progress-indicator" data-slot="root" data-state="pending" />;
}

const visuallyHiddenStyle = Object.freeze({ border: 0, clip: "rect(0 0 0 0)", clipPath: "inset(50%)", height: 1, margin: -1, overflow: "hidden", padding: 0, position: "absolute", whiteSpace: "nowrap", width: 1 } as const);
export interface VisuallyHiddenProps { readonly children: ReactNode; }
export function VisuallyHidden({ children }: VisuallyHiddenProps): ReactElement {
  return <span style={visuallyHiddenStyle} data-k-nex-component="visually-hidden" data-slot="root">{children}</span>;
}

export interface LandmarkProps { readonly children?: ReactNode; readonly label?: string; }
export function Header({ children, label }: LandmarkProps): ReactElement {
  return <header aria-label={label} data-k-nex-component="header" data-slot="root">{children}</header>;
}
export function Footer({ children, label }: LandmarkProps): ReactElement {
  return <footer aria-label={label} data-k-nex-component="footer" data-slot="root">{children}</footer>;
}

export interface HeroProps { readonly title: ReactNode; readonly children?: ReactNode; readonly actions?: ReactNode; }
export function Hero({ title, children, actions }: HeroProps): ReactElement {
  return <section data-k-nex-component="hero" data-slot="root"><div data-slot="title">{title}</div>{children === undefined ? null : <div data-slot="content">{children}</div>}{actions === undefined ? null : <div data-slot="actions">{actions}</div>}</section>;
}

export interface QuoteProps { readonly children: ReactNode; readonly citation?: ReactNode; readonly cite?: string; }
export function Quote({ children, citation, cite }: QuoteProps): ReactElement {
  return <figure data-k-nex-component="quote" data-slot="root"><blockquote cite={cite} data-slot="content">{children}</blockquote>{citation === undefined ? null : <figcaption data-slot="citation">{citation}</figcaption>}</figure>;
}

export interface FileProps { readonly href: string; readonly name: string; readonly metadata?: ReactNode; readonly download?: boolean; }
export function File({ href, name, metadata, download = false }: FileProps): ReactElement {
  return <article data-k-nex-component="file" data-slot="root"><a href={href} {...(download ? { download: true } : {})} data-slot="link">{name}</a>{metadata === undefined ? null : <span data-slot="metadata">{metadata}</span>}</article>;
}

export interface VideoProps { readonly src: string; readonly label: string; readonly poster?: string; readonly captions?: string; }
export function Video({ src, label, poster, captions }: VideoProps): ReactElement {
  return <video src={src} aria-label={label} poster={poster} controls preload="metadata" data-k-nex-component="video" data-slot="root">{captions === undefined ? null : <track kind="captions" src={captions} srcLang="en" label="Captions" default />}</video>;
}
