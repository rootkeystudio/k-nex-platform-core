"use client";

import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $createParagraphNode, $createTextNode, $getRoot, type EditorState } from "lexical";
import type { ReactElement } from "react";

import { parseRichTextDocument, type RichTextDocument, type RichTextInline } from "./rich-text.js";

function plainText(document: RichTextDocument): string[] {
  const text = (nodes: readonly RichTextInline[]): string => nodes.map((node) => node.type === "text" ? node.text : text(node.children)).join("");
  return document.blocks.flatMap((current) => current.type === "list" ? current.items.map(text) : [text(current.children)]);
}

export interface RichTextEditorProps { readonly document: RichTextDocument; readonly label: string; readonly placeholder?: string; readonly onChange: (document: RichTextDocument) => void; }
export function RichTextEditor({ document, label, placeholder = "Enter text", onChange }: RichTextEditorProps): ReactElement {
  const parsed = parseRichTextDocument(document);
  const initialConfig = {
    namespace: "k-nex-rich-text-v1",
    theme: {},
    onError(error: Error) { throw error; },
    editorState() {
      const root = $getRoot();
      root.clear();
      for (const value of plainText(parsed)) root.append($createParagraphNode().append($createTextNode(value)));
    }
  };
  const handleChange = (editorState: EditorState): void => {
    editorState.read(() => onChange(parseRichTextDocument({
      schemaVersion: 1,
      blocks: $getRoot().getChildren().map((node) => ({ type: "paragraph", children: [{ type: "text", text: node.getTextContent() }] }))
    })));
  };
  return <div data-k-nex-component="rich-text-editor" data-slot="root"><LexicalComposer initialConfig={initialConfig}><RichTextPlugin contentEditable={<ContentEditable aria-label={label} aria-placeholder={placeholder} placeholder={<span>{placeholder}</span>} data-slot="content" />} ErrorBoundary={LexicalErrorBoundary} /><HistoryPlugin /><OnChangePlugin onChange={handleChange} /></LexicalComposer></div>;
}

export const richTextEditorAdapter = Object.freeze({ id: "lexical", version: "0.49.0", contractVersion: 1, supportedEditingBlocks: Object.freeze(["paragraph"]), persistedState: "k-nex-rich-text@1" });
