import { createElement, Fragment, useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from "react";

import { PuckFixedShellHost } from "./fixed-shell-host.js";
import type { ResolvedPuckBuilderProfile } from "./profile.js";
import type { WorkspaceEditorSession } from "./workspace-editor-session.js";

const controlStyle: CSSProperties = { minWidth: 44, minHeight: 44, outlineOffset: 2 };

export interface WorkspaceEditorRollbackRevision {
  readonly id: string;
  readonly label: string;
}

export interface WorkspacePuckEditorHostProps {
  readonly profile: ResolvedPuckBuilderProfile;
  readonly session: WorkspaceEditorSession;
  readonly rollbackRevisions: readonly WorkspaceEditorRollbackRevision[];
  readonly authentication: ReactNode;
  readonly router: ReactNode;
  readonly sidebar: ReactNode;
  readonly topBar: ReactNode;
  readonly systemScreens: ReactNode;
  readonly globalDialogs: ReactNode;
}

/** Product editor shell. Persistence and current authority stay behind the supplied session port. */
export function WorkspacePuckEditorHost({
  profile,
  session,
  rollbackRevisions,
  authentication,
  router,
  sidebar,
  topBar,
  systemScreens,
  globalDialogs
}: WorkspacePuckEditorHostProps): ReactElement {
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const [rollbackRevisionId, setRollbackRevisionId] = useState(rollbackRevisions[0]?.id ?? "");
  useEffect(() => () => session.dispose(), [session]);
  const busy = state.status === "saving" || state.status === "publishing" || state.status === "rolling-back";
  const publicationControls = createElement("section", { "aria-label": "Page publication controls", "data-k-nex-workspace-publication-controls": true }, [
    createElement("span", { key: "status", role: state.status === "error" || state.status === "conflict" ? "alert" : "status", "aria-live": "polite" }, state.message),
    ...(state.conflict === undefined ? [] : [createElement("button", {
      key: "reload-conflict",
      type: "button",
      style: controlStyle,
      onClick: () => session.reloadConflict()
    }, "Reload newer server version")]),
    ...(!session.canRetryAutosave() ? [] : [createElement("button", {
      key: "retry",
      type: "button",
      style: controlStyle,
      onClick: () => session.retryAutosave()
    }, "Retry autosave")]),
    createElement("button", {
      key: "publish",
      type: "button",
      style: controlStyle,
      disabled: busy || state.status === "conflict" || state.status === "error",
      onClick: () => { void session.publish().catch(() => undefined); }
    }, "Publish page"),
    createElement("label", { key: "rollback-target" }, [
      createElement("span", { key: "label" }, "Rollback revision"),
      createElement("select", {
        key: "select",
        value: rollbackRevisionId,
        disabled: rollbackRevisions.length === 0,
        style: controlStyle,
        onChange: (event: { currentTarget: { value: string } }) => setRollbackRevisionId(event.currentTarget.value)
      }, rollbackRevisions.map((revision) => createElement("option", { key: revision.id, value: revision.id }, revision.label)))
    ]),
    createElement("button", {
      key: "rollback",
      type: "button",
      style: controlStyle,
      disabled: busy || state.status === "dirty" || state.status === "conflict" || state.status === "error" || rollbackRevisionId === "",
      onClick: () => { void session.rollback(rollbackRevisionId).catch(() => undefined); }
    }, "Rollback page")
  ]);

  return createElement(PuckFixedShellHost, {
    profile,
    editorKey: state.workingCopyRevision,
    document: state.document,
    authentication,
    router,
    sidebar,
    topBar: createElement(Fragment, null, topBar, publicationControls),
    systemScreens,
    globalDialogs,
    onChange: (document) => { session.change(document); }
  });
}
