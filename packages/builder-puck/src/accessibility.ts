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

export function createKeyboardReorderAction(input: {
  readonly index: number;
  readonly zone: string;
  readonly count: number;
  readonly direction: "earlier" | "later";
}): PuckAction | undefined {
  const destinationIndex = input.index + (input.direction === "earlier" ? -1 : 1);
  if (input.index < 0 || input.index >= input.count || destinationIndex < 0 || destinationIndex >= input.count) return undefined;
  return {
    type: "reorder",
    sourceIndex: input.index,
    destinationIndex,
    destinationZone: input.zone,
    recordHistory: true
  };
}

function blockName(block: ComponentData, index: number): string {
  return `${block.type} ${index + 1}`;
}

/** Native controls provide a keyboard and screen-reader path independent of drag-and-drop. */
export function AccessiblePuckControls({ state, dispatch }: AccessiblePuckControlsProps): ReactElement {
  const content = state.data.content;
  const selector = state.ui.itemSelector;
  const selectedIndex = selector?.zone === "root" ? selector.index : -1;
  const selected = content[selectedIndex];
  const move = (direction: "earlier" | "later") => {
    const action = createKeyboardReorderAction({ index: selectedIndex, zone: "root", count: content.length, direction });
    if (action !== undefined) dispatch(action);
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
          const index = Number(event.currentTarget.value);
          dispatch({ type: "setUi", ui: { itemSelector: Number.isSafeInteger(index) ? { index, zone: "root" } : null } });
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
      disabled: createKeyboardReorderAction({ index: selectedIndex, zone: "root", count: content.length, direction: "earlier" }) === undefined,
      style: controlStyle,
      onClick: () => move("earlier")
    }, "Move earlier"),
    createElement("button", {
      key: "later",
      type: "button",
      "aria-label": selected === undefined ? "Move selected block later" : `Move ${blockName(selected, selectedIndex)} later`,
      disabled: createKeyboardReorderAction({ index: selectedIndex, zone: "root", count: content.length, direction: "later" }) === undefined,
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
