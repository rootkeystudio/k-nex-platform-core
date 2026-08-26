import { createElement, type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { AppState, ComponentData, Data, PuckAction } from "@puckeditor/core";

const controlStyle: CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  outline: "2px solid currentColor",
  outlineOffset: 2
};

export interface AccessiblePuckControlsProps {
  readonly state: AppState;
  readonly dispatch: (action: PuckAction) => void;
}

export function createKeyboardReorderActions(input: {
  readonly content: readonly ComponentData[];
  readonly index: number;
  readonly direction: "earlier" | "later";
}): readonly PuckAction[] | undefined {
  const destinationIndex = input.index + (input.direction === "earlier" ? -1 : 1);
  if (input.index < 0 || input.index >= input.content.length || destinationIndex < 0 || destinationIndex >= input.content.length) return undefined;
  const content = [...input.content];
  const [selected] = content.splice(input.index, 1);
  if (selected === undefined) return undefined;
  content.splice(destinationIndex, 0, selected);
  return [
    { type: "setData", data: { content }, recordHistory: true },
    { type: "setUi", ui: { itemSelector: { index: destinationIndex } } }
  ];
}

function blockName(block: ComponentData, index: number): string {
  return `${block.type} ${index + 1}`;
}

/** Native controls provide a keyboard and screen-reader path independent of drag-and-drop. */
export function AccessiblePuckControls({ state, dispatch }: AccessiblePuckControlsProps): ReactElement {
  const content = state.data.content;
  const selector = state.ui.itemSelector;
  const selectedIndex = selector !== null && (selector?.zone === undefined || selector.zone === "root:default-zone") ? selector.index : -1;
  const selected = content[selectedIndex];
  const move = (direction: "earlier" | "later") => {
    const actions = createKeyboardReorderActions({ content, index: selectedIndex, direction });
    if (actions !== undefined) for (const action of actions) dispatch(action);
  };

  return createElement("section", { "aria-label": "Canvas block keyboard controls", "data-k-nex-accessible-builder-controls": true }, [
    createElement("label", { key: "selection" }, [
      createElement("span", { key: "label" }, "Selected canvas block"),
      createElement("select", {
        key: "select",
        "aria-describedby": "k-nex-builder-position",
        value: selectedIndex < 0 ? "" : String(selectedIndex),
        style: controlStyle,
        onChange: (event: { currentTarget: { value: string } }) => {
          const value = event.currentTarget.value;
          const index = Number(value);
          dispatch({ type: "setUi", ui: { itemSelector: value !== "" && Number.isSafeInteger(index) ? { index } : null } });
        }
      }, [
        createElement("option", { key: "none", value: "" }, "Choose a block"),
        ...content.map((block, index) => createElement("option", { key: block.props.id, value: String(index) }, blockName(block, index)))
      ])
    ]),
    createElement("button", {
      key: "earlier",
      type: "button",
      "aria-label": selected === undefined ? "Move selected block earlier" : `Move ${blockName(selected, selectedIndex)} earlier`,
      disabled: createKeyboardReorderActions({ content, index: selectedIndex, direction: "earlier" }) === undefined,
      style: controlStyle,
      onClick: () => move("earlier")
    }, "Move earlier"),
    createElement("button", {
      key: "later",
      type: "button",
      "aria-label": selected === undefined ? "Move selected block later" : `Move ${blockName(selected, selectedIndex)} later`,
      disabled: createKeyboardReorderActions({ content, index: selectedIndex, direction: "later" }) === undefined,
      style: controlStyle,
      onClick: () => move("later")
    }, "Move later"),
    createElement("span", { key: "status", id: "k-nex-builder-position", role: "status", "aria-live": "polite" },
      selected === undefined ? "No canvas block selected" : `${blockName(selected, selectedIndex)}, position ${selectedIndex + 1} of ${content.length}`)
  ]);
}

export function renderAccessiblePuckHeader(input: {
  readonly children: ReactNode;
  readonly state: AppState<Data>;
  readonly dispatch: (action: PuckAction) => void;
}): ReactElement {
  return createElement("div", { "data-k-nex-accessible-builder-header": true }, [
    createElement("div", { key: "puck-header" }, input.children),
    createElement(AccessiblePuckControls, { key: "controls", state: input.state, dispatch: input.dispatch })
  ]);
}
