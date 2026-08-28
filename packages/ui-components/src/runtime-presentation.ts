import { createElement, Fragment, type ReactNode } from "react";
import { isUiRuntimePresentationList, type UiRuntimeChildPresentation } from "@k-nex/ui-runtime";

function canonicalChildren(children: readonly UiRuntimeChildPresentation[]): readonly ReactNode[] {
  return children.map(({ nodeId, presentation }) => createElement(Fragment, { key: nodeId }, presentUiRuntimeReact(presentation)));
}

/** Converts the React-free runtime presentation tree at the React host boundary. */
export function presentUiRuntimeReact(presentation: unknown): ReactNode {
  if (!isUiRuntimePresentationList(presentation)) return presentation as ReactNode;
  return createElement(Fragment, null,
    ...(presentation.leading === undefined ? [] : [createElement(Fragment, { key: "k-nex:leading" }, presentUiRuntimeReact(presentation.leading))]),
    ...(presentation.canonical.length === 0 ? [] : [createElement(Fragment, { key: "k-nex:canonical" }, canonicalChildren(presentation.canonical))]),
    ...(presentation.injected.length === 0 ? [] : [createElement(Fragment, { key: "k-nex:injected" }, presentation.injected as readonly ReactNode[])])
  );
}
