import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  RichTextEditor, RichTextRenderer, migrateRichTextDocument, parseRichTextDocument,
  publishRichTextDocument, richTextBudgets, richTextEditorAdapter
} from "../src/index.js";

const document = {
  schemaVersion: 1 as const,
  blocks: [
    { type: "heading" as const, level: 2 as const, children: [{ type: "text" as const, text: "Safe content", marks: ["bold" as const] }] },
    { type: "paragraph" as const, children: [{ type: "link" as const, href: "/details", children: [{ type: "text" as const, text: "Details" }] }] },
    { type: "list" as const, ordered: false, items: [[{ type: "text" as const, text: "One" }]] }
  ]
};

describe("versioned rich-text boundary", () => {
  it("renders validated structured content without an HTML injection surface", () => {
    const markup = renderToStaticMarkup(<RichTextRenderer document={document} label="Article" />);
    expect(markup).toContain("<h2");
    expect(markup).toContain("<strong>Safe content</strong>");
    expect(markup).toContain('<a href="/details">Details</a>');
    expect(markup).not.toContain("dangerously");
  });

  it("rejects script URLs, arbitrary fields, duplicate marks, and unknown nodes", () => {
    expect(() => parseRichTextDocument({ schemaVersion: 1, blocks: [{ type: "paragraph", children: [{ type: "link", href: "javascript:alert(1)", children: [] }] }] })).toThrow(/invalid/);
    expect(() => parseRichTextDocument({ ...document, executable: true })).toThrow(/invalid/);
    expect(() => parseRichTextDocument({ schemaVersion: 1, blocks: [{ type: "paragraph", children: [{ type: "text", text: "x", marks: ["bold", "bold"] }] }] })).toThrow(/invalid/);
    expect(() => parseRichTextDocument({ schemaVersion: 1, blocks: [{ type: "script", children: [] }] })).toThrow(/invalid/);
  });

  it("migrates legacy paragraphs and freezes publication output", () => {
    const migrated = migrateRichTextDocument({ schemaVersion: 0, paragraphs: ["One", "Two"] });
    expect(migrated.blocks).toHaveLength(2);
    const published = publishRichTextDocument(migrated);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.blocks)).toBe(true);
  });

  it("keeps Lexical state internal to the K-Nex versioned adapter", () => {
    const markup = renderToStaticMarkup(<RichTextEditor document={{ schemaVersion: 1, blocks: [{ type: "paragraph", children: [{ type: "text", text: "Draft" }] }] }} label="Editor" onChange={() => undefined} />);
    expect(markup).toContain('data-k-nex-component="rich-text-editor"');
    expect(richTextEditorAdapter).toEqual({ id: "lexical", version: "0.49.0", contractVersion: 1, supportedEditingBlocks: ["unmarked-paragraph"], persistedState: "k-nex-rich-text@1" });
    expect(() => renderToStaticMarkup(<RichTextEditor document={document} label="Editor" onChange={() => undefined} />)).toThrow(/only unmarked paragraphs/);
  });

  it("bounds depth, total nodes, and cumulative text bytes", () => {
    let nested: unknown = { type: "text", text: "safe" };
    for (let depth = 0; depth <= richTextBudgets.depth; depth += 1) nested = { type: "link", href: "/safe", children: [nested] };
    expect(() => parseRichTextDocument({ schemaVersion: 1, blocks: [{ type: "paragraph", children: [nested] }] })).toThrow(/budget/);
    const tooMany = Array.from({ length: richTextBudgets.inlineNodes + 1 }, () => ({ type: "text", text: "x" }));
    expect(() => parseRichTextDocument({ schemaVersion: 1, blocks: [{ type: "paragraph", children: tooMany }] })).toThrow(/budget/);
    expect(() => parseRichTextDocument({ schemaVersion: 1, blocks: [{ type: "paragraph", children: [{ type: "text", text: "x".repeat(richTextBudgets.textBytes + 1) }] }] })).toThrow(/budget/);
  });
});
