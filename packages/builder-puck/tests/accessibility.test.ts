import { Children, isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { AccessiblePuckControls, createKeyboardReorderActions } from "../src/accessibility.js";

const content = [
  { type: "content.text__v1", props: { id: "alpha" } },
  { type: "content.text__v1", props: { id: "beta" } }
];

function controls(dispatch = vi.fn()) {
  return {
    dispatch,
    element: AccessiblePuckControls({
      state: { data: { root: { props: {} }, content }, ui: { itemSelector: { index: 1, zone: "root:default-zone" } } } as never,
      dispatch
    })
  };
}

describe("accessible Puck operation", () => {
  it("selects a block through a labelled native control so its fields can be edited by keyboard", () => {
    const { element, dispatch } = controls();
    const children = Children.toArray(element.props.children) as ReactElement[];
    const label = children[0];
    const select = Children.toArray(label.props.children)[1] as ReactElement;
    expect(element.type).toBe("section");
    expect(element.props["aria-label"]).toBe("Canvas block keyboard controls");
    expect(label.type).toBe("label");
    expect(select.type).toBe("select");
    expect(select.props.style).toMatchObject({ minWidth: 44, minHeight: 44, outlineOffset: 2 });
    select.props.onChange({ currentTarget: { value: "0" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { itemSelector: { index: 0, zone: "root:default-zone" } } });
  });

  it("provides named native buttons as a non-drag reorder alternative", () => {
    const { element, dispatch } = controls();
    const buttons = Children.toArray(element.props.children).filter((child) => isValidElement(child) && child.type === "button") as ReactElement[];
    expect(buttons.map((button) => button.props["aria-label"])).toEqual([
      "Move content.text__v1 beta, item 2 earlier",
      "Move content.text__v1 beta, item 2 later"
    ]);
    expect(buttons[0].props.disabled).toBe(false);
    expect(buttons[1].props.disabled).toBe(true);
    buttons[0].props.onClick();
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "move", sourceIndex: 1, sourceZone: "root:default-zone", destinationIndex: 0, destinationZone: "root:default-zone" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "setUi", ui: { itemSelector: { index: 0, zone: "root:default-zone" } } });
  });

  it("exposes selected position through a polite status and bounds reorder actions", () => {
    const { element } = controls();
    const status = Children.toArray(element.props.children).at(-1) as ReactElement;
    expect(status.props).toMatchObject({ role: "status", "aria-live": "polite" });
    expect(status.props.children).toBe("content.text__v1 beta, item 2, position 2 of 2");
    expect(createKeyboardReorderActions({ content, index: 0, direction: "earlier" })).toBeUndefined();
    expect(createKeyboardReorderActions({ content, index: 0, direction: "later" })?.[0]).toMatchObject({ type: "move" });
  });

  it("enumerates and moves blocks inside canonical child slots", () => {
    const nested = [{
      type: "content.card__v1",
      props: { id: "card", __kNexChildren: content }
    }];
    const dispatch = vi.fn();
    const element = AccessiblePuckControls({
      state: { data: { root: { props: {} }, content: nested }, ui: { itemSelector: { index: 1, zone: "card:__kNexChildren" } } } as never,
      dispatch
    });
    const children = Children.toArray(element.props.children) as ReactElement[];
    const select = Children.toArray(children[0].props.children)[1] as ReactElement;
    expect(Children.toArray(select.props.children)).toHaveLength(4);
    expect(Children.toArray(select.props.children).map((option) => (option as ReactElement).props.children)).toEqual([
      "Choose a block",
      "content.card__v1 card, item 1",
      "Nested content.text__v1 alpha, item 1",
      "Nested content.text__v1 beta, item 2"
    ]);
    const buttons = children.filter((child) => isValidElement(child) && child.type === "button") as ReactElement[];
    buttons[0].props.onClick();
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "move",
      sourceIndex: 1,
      sourceZone: "card:__kNexChildren",
      destinationIndex: 0,
      destinationZone: "card:__kNexChildren"
    });
  });
});
