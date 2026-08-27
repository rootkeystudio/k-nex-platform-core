import { Fragment, type ReactElement, type ReactNode } from "react";

export type RichTextInline =
  | { readonly type: "text"; readonly text: string; readonly marks?: readonly ("bold" | "italic" | "underline" | "code")[] }
  | { readonly type: "link"; readonly href: string; readonly children: readonly RichTextInline[] };
export type RichTextBlock =
  | { readonly type: "paragraph" | "quote"; readonly children: readonly RichTextInline[] }
  | { readonly type: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly children: readonly RichTextInline[] }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly (readonly RichTextInline[])[] };
export interface RichTextDocument { readonly schemaVersion: 1; readonly blocks: readonly RichTextBlock[]; }

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function safeHref(value: unknown): value is string { return typeof value === "string" && value.length <= 2_048 && (/^(https?:\/\/|\/|#)/.test(value)); }
function inline(value: unknown): value is RichTextInline {
  if (!record(value)) return false;
  if (value.type === "text") return Object.keys(value).every((key) => ["type", "text", "marks"].includes(key)) && typeof value.text === "string" && value.text.length <= 100_000 && (value.marks === undefined || Array.isArray(value.marks) && new Set(value.marks).size === value.marks.length && value.marks.every((mark) => ["bold", "italic", "underline", "code"].includes(String(mark))));
  return value.type === "link" && Object.keys(value).every((key) => ["type", "href", "children"].includes(key)) && safeHref(value.href) && Array.isArray(value.children) && value.children.length <= 1_000 && value.children.every(inline);
}
function block(value: unknown): value is RichTextBlock {
  if (!record(value)) return false;
  if (value.type === "paragraph" || value.type === "quote") return Object.keys(value).every((key) => ["type", "children"].includes(key)) && Array.isArray(value.children) && value.children.every(inline);
  if (value.type === "heading") return Object.keys(value).every((key) => ["type", "level", "children"].includes(key)) && Number.isInteger(value.level) && Number(value.level) >= 1 && Number(value.level) <= 6 && Array.isArray(value.children) && value.children.every(inline);
  return value.type === "list" && Object.keys(value).every((key) => ["type", "ordered", "items"].includes(key)) && typeof value.ordered === "boolean" && Array.isArray(value.items) && value.items.length <= 10_000 && value.items.every((item) => Array.isArray(item) && item.every(inline));
}
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }

export function parseRichTextDocument(value: unknown): RichTextDocument {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.blocks) || value.blocks.length > 10_000 || !value.blocks.every(block) || Object.keys(value).some((key) => !["schemaVersion", "blocks"].includes(key))) throw new TypeError("Rich-text document is invalid.");
  return deepFreeze(structuredClone(value as unknown as RichTextDocument));
}

export function migrateRichTextDocument(value: unknown): RichTextDocument {
  if (record(value) && value.schemaVersion === 0 && Array.isArray(value.paragraphs) && value.paragraphs.every((text) => typeof text === "string")) return parseRichTextDocument({ schemaVersion: 1, blocks: value.paragraphs.map((text) => ({ type: "paragraph", children: [{ type: "text", text }] })) });
  return parseRichTextDocument(value);
}

export function publishRichTextDocument(value: unknown): RichTextDocument { return parseRichTextDocument(value); }

function renderInline(nodes: readonly RichTextInline[], prefix: string): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "link") return <a key={`${prefix}-${index}`} href={node.href}>{renderInline(node.children, `${prefix}-${index}`)}</a>;
    let content: ReactNode = node.text;
    for (const mark of node.marks ?? []) content = mark === "bold" ? <strong>{content}</strong> : mark === "italic" ? <em>{content}</em> : mark === "underline" ? <u>{content}</u> : <code>{content}</code>;
    return <Fragment key={`${prefix}-${index}`}>{content}</Fragment>;
  });
}

export interface RichTextRendererProps { readonly document: RichTextDocument; readonly label?: string; }
export function RichTextRenderer({ document, label }: RichTextRendererProps): ReactElement {
  const parsed = parseRichTextDocument(document);
  return <article aria-label={label} data-k-nex-component="rich-text-renderer" data-slot="root">{parsed.blocks.map((current, index) => {
    if (current.type === "heading") { const Heading = `h${current.level}` as "h1"; return <Heading key={index}>{renderInline(current.children, `${index}`)}</Heading>; }
    if (current.type === "quote") return <blockquote key={index}>{renderInline(current.children, `${index}`)}</blockquote>;
    if (current.type === "list") { const List = current.ordered ? "ol" : "ul"; return <List key={index}>{current.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${index}-${itemIndex}`)}</li>)}</List>; }
    return <p key={index}>{renderInline(current.children, `${index}`)}</p>;
  })}</article>;
}
