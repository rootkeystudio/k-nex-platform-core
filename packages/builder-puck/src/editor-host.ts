import { Puck, type Config, type Data } from "@puckeditor/core";
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

import type { PuckBuilderAdapter } from "./adapter.js";
import { renderAccessiblePuckHeader } from "./accessibility.js";
import type { UiDocument } from "@k-nex/contracts";

export interface PuckEditorHostProps {
  readonly adapter: PuckBuilderAdapter;
  readonly document: unknown;
  readonly onChange?: (document: UiDocument) => void;
  readonly onPublish?: (document: UiDocument) => void;
}

const editorConfigs = new WeakMap<object, Config>();

function editorConfig(config: Config): Config {
  const cached = editorConfigs.get(config);
  if (cached !== undefined) return cached;
  const components = Object.fromEntries(Object.entries(config.components).map(([id, candidate]) => {
    const component = candidate as unknown as {
      readonly fields?: Readonly<Record<string, { readonly type?: string }>>;
      readonly render: (props: Record<string, unknown>) => ReactNode;
    };
    return [id, {
      ...candidate,
      render: (props: Record<string, unknown>) => createElement(Fragment, null, [
        component.render(props),
        ...Object.entries(component.fields ?? {}).flatMap(([field, definition]) => {
          const slot = props[field];
          return definition.type === "slot" && typeof slot === "function" ? [(slot as () => ReactNode)()] : [];
        })
      ])
    }];
  }));
  const enhanced = { ...config, components } as Config;
  editorConfigs.set(config, enhanced);
  return enhanced;
}

/** The only package-level host that mounts Puck against canonical documents. */
export function PuckEditorHost({ adapter, document, onChange, onPublish }: PuckEditorHostProps): ReactElement {
  const data = adapter.toPuckData(document);
  return createElement(Puck, {
    config: editorConfig(adapter.config),
    data,
    renderHeader: renderAccessiblePuckHeader,
    ...(onChange === undefined ? {} : { onChange: (next: Data) => onChange(adapter.fromPuckData(next)) }),
    ...(onPublish === undefined ? {} : { onPublish: (next: Data) => onPublish(adapter.fromPuckData(next)) })
  });
}
