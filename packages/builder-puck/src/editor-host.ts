import { Puck, type Data } from "@puckeditor/core";
import { createElement, type ReactElement } from "react";

import type { PuckBuilderAdapter } from "./adapter.js";
import type { UiDocument } from "@k-nex/contracts";

export interface PuckEditorHostProps {
  readonly adapter: PuckBuilderAdapter;
  readonly document: unknown;
  readonly onChange?: (document: UiDocument) => void;
  readonly onPublish?: (document: UiDocument) => void;
}

/** The only package-level host that mounts Puck against canonical documents. */
export function PuckEditorHost({ adapter, document, onChange, onPublish }: PuckEditorHostProps): ReactElement {
  const data = adapter.toPuckData(document);
  return createElement(Puck, {
    config: adapter.config,
    data,
    ...(onChange === undefined ? {} : { onChange: (next: Data) => onChange(adapter.fromPuckData(next)) }),
    ...(onPublish === undefined ? {} : { onPublish: (next: Data) => onPublish(adapter.fromPuckData(next)) })
  });
}
