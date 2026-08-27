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
export const richTextBudgets = Object.freeze({ blocks: 1_000, listItems: 5_000, inlineNodes: 10_000, depth: 16, textBytes: 1_048_576 });

function validKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function validateInlineRoots(roots: readonly unknown[][]): boolean {
  const pending = roots.map((nodes) => ({ depth: 1, nodes }));
  const encoder = new TextEncoder();
  let nodeCount = 0;
  let textBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || current.depth > richTextBudgets.depth) return false;
    for (const value of current.nodes) {
      nodeCount += 1;
      if (nodeCount > richTextBudgets.inlineNodes || !record(value)) return false;
      if (value.type === "text") {
        if (!validKeys(value, ["type", "text", "marks"]) || typeof value.text !== "string") return false;
        textBytes += encoder.encode(value.text).byteLength;
        if (textBytes > richTextBudgets.textBytes || value.marks !== undefined && (!Array.isArray(value.marks) || new Set(value.marks).size !== value.marks.length || !value.marks.every((mark) => ["bold", "italic", "underline", "code"].includes(String(mark))))) return false;
      } else {
        if (value.type !== "link" || !validKeys(value, ["type", "href", "children"]) || !safeHref(value.href) || !Array.isArray(value.children) || value.children.length > 1_000) return false;
        textBytes += encoder.encode(value.href).byteLength;
        if (textBytes > richTextBudgets.textBytes) return false;
        pending.push({ depth: current.depth + 1, nodes: value.children });
      }
    }
  }
  return true;
}

function blocks(value: readonly unknown[]): value is readonly RichTextBlock[] {
  const inlineRoots: unknown[][] = [];
  let listItems = 0;
  for (const current of value) {
    if (!record(current)) return false;
    if (current.type === "paragraph" || current.type === "quote") {
      if (!validKeys(current, ["type", "children"]) || !Array.isArray(current.children)) return false;
      inlineRoots.push(current.children);
    } else if (current.type === "heading") {
      if (!validKeys(current, ["type", "level", "children"]) || !Number.isInteger(current.level) || Number(current.level) < 1 || Number(current.level) > 6 || !Array.isArray(current.children)) return false;
      inlineRoots.push(current.children);
    } else {
      if (current.type !== "list" || !validKeys(current, ["type", "ordered", "items"]) || typeof current.ordered !== "boolean" || !Array.isArray(current.items)) return false;
      listItems += current.items.length;
      if (listItems > richTextBudgets.listItems || current.items.some((item) => !Array.isArray(item))) return false;
      inlineRoots.push(...current.items);
    }
  }
  return validateInlineRoots(inlineRoots);
}
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }

export function parseRichTextDocument(value: unknown): RichTextDocument {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.blocks) || value.blocks.length > richTextBudgets.blocks || !blocks(value.blocks) || Object.keys(value).some((key) => !["schemaVersion", "blocks"].includes(key))) throw new TypeError("Rich-text document is invalid or exceeds its budget.");
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
