import { createElement, type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { AppState, ComponentData, Data, PuckAction } from "@puckeditor/core";

const controlStyle: CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  outline: "2px solid currentColor",
  outlineOffset: 2
};
const childSlotKey = "__kNexChildren";
const rootZone = "root:default-zone";

export interface AccessiblePuckControlsProps {
  readonly state: AppState;
  readonly dispatch: (action: PuckAction) => void;
}

export function createKeyboardReorderActions(input: {
  readonly content: readonly ComponentData[];
  readonly index: number;
  readonly zone?: string;
  readonly direction: "earlier" | "later";
}): readonly PuckAction[] | undefined {
  const destinationIndex = input.index + (input.direction === "earlier" ? -1 : 1);
  if (input.index < 0 || input.index >= input.content.length || destinationIndex < 0 || destinationIndex >= input.content.length) return undefined;
  const zone = input.zone ?? rootZone;
  return [
    { type: "move", sourceIndex: input.index, sourceZone: zone, destinationIndex, destinationZone: zone },
    { type: "setUi", ui: { itemSelector: { index: destinationIndex, zone } } }
  ];
}

function blockName(block: ComponentData, index: number): string {
  return `${block.type} ${index + 1}`;
}

interface BlockLocation {
  readonly block: ComponentData;
  readonly content: readonly ComponentData[];
  readonly index: number;
  readonly zone: string;
  readonly depth: number;
}

function blockLocations(content: readonly ComponentData[], zone = rootZone, depth = 0): readonly BlockLocation[] {
  return content.flatMap((block, index) => {
    const location: BlockLocation = { block, content, index, zone, depth };
    const children = block.props[childSlotKey];
    return Array.isArray(children)
      ? [location, ...blockLocations(children as ComponentData[], `${String(block.props.id)}:${childSlotKey}`, depth + 1)]
      : [location];
  });
}

/** Native controls provide a keyboard and screen-reader path independent of drag-and-drop. */
export function AccessiblePuckControls({ state, dispatch }: AccessiblePuckControlsProps): ReactElement {
  const locations = blockLocations(state.data.content);
  const selector = state.ui.itemSelector;
  const selectedZone = selector?.zone ?? rootZone;
  const selectedLocationIndex = selector === null ? -1 : locations.findIndex(({ zone, index }) => zone === selectedZone && index === selector.index);
  const selected = locations[selectedLocationIndex];
  const move = (direction: "earlier" | "later") => {
    if (selected === undefined) return;
    const actions = createKeyboardReorderActions({ content: selected.content, index: selected.index, zone: selected.zone, direction });
    if (actions !== undefined) for (const action of actions) dispatch(action);
  };

  return createElement("section", { "aria-label": "Canvas block keyboard controls", "data-k-nex-accessible-builder-controls": true }, [
    createElement("label", { key: "selection" }, [
      createElement("span", { key: "label" }, "Selected canvas block"),
      createElement("select", {
        key: "select",
        "aria-describedby": "k-nex-builder-position",
        value: selectedLocationIndex < 0 ? "" : String(selectedLocationIndex),
        style: controlStyle,
        onChange: (event: { currentTarget: { value: string } }) => {
          const value = event.currentTarget.value;
          const index = Number(value);
          const location = value !== "" && Number.isSafeInteger(index) ? locations[index] : undefined;
          dispatch({ type: "setUi", ui: { itemSelector: location === undefined ? null : { index: location.index, zone: location.zone } } });
        }
      }, [
        createElement("option", { key: "none", value: "" }, "Choose a block"),
        ...locations.map((location, index) => createElement("option", { key: location.block.props.id, value: String(index) },
          `${"Nested ".repeat(location.depth)}${blockName(location.block, location.index)}`))
      ])
    ]),
    createElement("button", {
      key: "earlier",
      type: "button",
      "aria-label": selected === undefined ? "Move selected block earlier" : `Move ${blockName(selected.block, selected.index)} earlier`,
      disabled: selected === undefined || createKeyboardReorderActions({ content: selected.content, index: selected.index, zone: selected.zone, direction: "earlier" }) === undefined,
      style: controlStyle,
      onClick: () => move("earlier")
    }, "Move earlier"),
    createElement("button", {
      key: "later",
      type: "button",
      "aria-label": selected === undefined ? "Move selected block later" : `Move ${blockName(selected.block, selected.index)} later`,
      disabled: selected === undefined || createKeyboardReorderActions({ content: selected.content, index: selected.index, zone: selected.zone, direction: "later" }) === undefined,
      style: controlStyle,
      onClick: () => move("later")
    }, "Move later"),
    createElement("span", { key: "status", id: "k-nex-builder-position", role: "status", "aria-live": "polite" },
      selected === undefined ? "No canvas block selected" : `${blockName(selected.block, selected.index)}, position ${selected.index + 1} of ${selected.content.length}`)
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
