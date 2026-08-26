import { createElement, type ReactElement, type ReactNode } from "react";
import type { UiDocument } from "@k-nex/contracts";

import { PuckEditorHost, type PuckEditorHostProps } from "./editor-host.js";
import type { ResolvedPuckBuilderProfile } from "./profile.js";

export interface PuckFixedShellHostProps extends Omit<PuckEditorHostProps, "adapter"> {
  readonly profile: ResolvedPuckBuilderProfile;
  readonly authentication: ReactNode;
  readonly router: ReactNode;
  readonly sidebar: ReactNode;
  readonly topBar: ReactNode;
  readonly systemScreens: ReactNode;
  readonly globalDialogs: ReactNode;
}

/** Keeps platform shell/security regions as siblings of, never children owned by, the editor canvas. */
export function PuckFixedShellHost({
  profile,
  authentication,
  router,
  sidebar,
  topBar,
  systemScreens,
  globalDialogs,
  document,
  onChange,
  onPublish
}: PuckFixedShellHostProps): ReactElement {
  return createElement("div", { "data-k-nex-fixed-shell": profile.policy.id }, [
    createElement("div", { key: "authentication", "data-k-nex-shell-authentication": true }, authentication),
    createElement("aside", { key: "sidebar", "data-k-nex-shell-sidebar": true }, sidebar),
    createElement("header", { key: "top-bar", "data-k-nex-shell-top-bar": true }, topBar),
    createElement("div", { key: "router", "data-k-nex-shell-router": true }, router),
    createElement("section", { key: "system", "data-k-nex-shell-system-screens": true }, systemScreens),
    createElement("main", { key: "canvas", "data-k-nex-builder-canvas": profile.policy.id },
      createElement(PuckEditorHost, {
        adapter: profile.adapter,
        document,
        ...(onChange === undefined ? {} : { onChange: (next: UiDocument) => onChange(profile.validateChange(document, next)) }),
        ...(onPublish === undefined ? {} : { onPublish: (next: UiDocument) => onPublish(profile.validateDocument(profile.validateChange(document, next))) })
      })),
    createElement("div", { key: "dialogs", "data-k-nex-shell-global-dialogs": true }, globalDialogs)
  ]);
}
