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
      state: { data: { root: { props: {} }, content }, ui: { itemSelector: { index: 1 } } } as never,
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
    expect(dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { itemSelector: { index: 0 } } });
  });

  it("provides named native buttons as a non-drag reorder alternative", () => {
    const { element, dispatch } = controls();
    const buttons = Children.toArray(element.props.children).filter((child) => isValidElement(child) && child.type === "button") as ReactElement[];
    expect(buttons.map((button) => button.props["aria-label"])).toEqual([
      "Move content.text__v1 2 earlier",
      "Move content.text__v1 2 later"
    ]);
    expect(buttons[0].props.disabled).toBe(false);
    expect(buttons[1].props.disabled).toBe(true);
    buttons[0].props.onClick();
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "setData", data: { content: [content[1], content[0]] }, recordHistory: true });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "setUi", ui: { itemSelector: { index: 0 } } });
  });

  it("exposes selected position through a polite status and bounds reorder actions", () => {
    const { element } = controls();
    const status = Children.toArray(element.props.children).at(-1) as ReactElement;
    expect(status.props).toMatchObject({ role: "status", "aria-live": "polite" });
    expect(status.props.children).toBe("content.text__v1 2, position 2 of 2");
    expect(createKeyboardReorderActions({ content, index: 0, direction: "earlier" })).toBeUndefined();
    expect(createKeyboardReorderActions({ content, index: 0, direction: "later" })?.[0]).toMatchObject({ type: "setData" });
  });
});
