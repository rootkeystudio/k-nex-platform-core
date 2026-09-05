import { Children, isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { AccessiblePuckControls, createKeyboardMoveActions, createKeyboardReorderActions } from "../src/accessibility.js";

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

function selectionLabel(element: ReactElement): ReactElement {
  return (Children.toArray(element.props.children) as ReactElement[]).find((child) =>
    isValidElement(child) && child.type === "label" && Children.toArray(child.props.children).some((value) => isValidElement(value) && value.props.children === "Selected canvas block"))!;
}

describe("accessible Puck operation", () => {
  it("selects a block through a labelled native control so its fields can be edited by keyboard", () => {
    const { element, dispatch } = controls();
    const label = selectionLabel(element);
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
    const buttons = (Children.toArray(element.props.children).filter((child) => isValidElement(child) && child.type === "button") as ReactElement[])
      .filter((button) => String(button.props["aria-label"]).startsWith("Move "));
    expect(buttons.slice(0, 2).map((button) => button.props["aria-label"])).toEqual([
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
    const select = Children.toArray(selectionLabel(element).props.children)[1] as ReactElement;
    expect(Children.toArray(select.props.children)).toHaveLength(4);
    expect(Children.toArray(select.props.children).map((option) => (option as ReactElement).props.children)).toEqual([
      "Choose a block",
      "content.card__v1 card, item 1",
      "Nested content.text__v1 alpha, item 1",
      "Nested content.text__v1 beta, item 2"
    ]);
    const earlier = (children.filter((child) => isValidElement(child) && child.type === "button") as ReactElement[])
      .find((button) => String(button.props["aria-label"]).endsWith("earlier"))!;
    earlier.props.onClick();
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "move",
      sourceIndex: 1,
      sourceZone: "card:__kNexChildren",
      destinationIndex: 0,
      destinationZone: "card:__kNexChildren"
    });
  });

  it("moves an unlocked child between sibling containers without drag", () => {
    const nested = [{
      type: "content.card__v1",
      props: { id: "left", __kNexChildren: [{ ...content[0], props: { ...content[0]!.props, __kNexCanMove: true } }] }
    }, {
      type: "content.card__v1",
      props: { id: "right", __kNexChildren: [] }
    }];
    const dispatch = vi.fn();
    const element = AccessiblePuckControls({
      state: { data: { root: { props: {} }, content: nested }, ui: { itemSelector: { index: 0, zone: "left:__kNexChildren" } } } as never,
      dispatch
    });
    const children = Children.toArray(element.props.children) as ReactElement[];
    expect(children.some((child) => typeof child.type === "function" && child.props.containers?.length === 3)).toBe(true);
    expect(createKeyboardMoveActions({ content: nested[0]!.props.__kNexChildren, index: 0, sourceZone: "left:__kNexChildren", destinationZone: "left:__kNexChildren", destinationContent: [], destinationIndex: 0 })).toBeUndefined();
    expect(createKeyboardMoveActions({ content: nested[0]!.props.__kNexChildren, index: 0, sourceZone: "left:__kNexChildren", destinationZone: "right:__kNexChildren", destinationContent: [content[1]!], destinationIndex: 2 })).toBeUndefined();
  });

  it("does not expose reorder actions for a trusted immovable component", () => {
    const immovable = [{ ...content[0], props: { ...content[0]!.props, __kNexCanMove: false } }, content[1]!];
    expect(createKeyboardReorderActions({ content: immovable, index: 0, direction: "later" })).toBeUndefined();
    expect(createKeyboardMoveActions({ content: immovable, index: 0, sourceZone: "root:default-zone", destinationZone: "other:__kNexChildren", destinationContent: [], destinationIndex: 0 })).toBeUndefined();
  });

  it("provides keyboard add and delete actions without bypassing trusted delete constraints", () => {
    const dispatch = vi.fn();
    const element = AccessiblePuckControls({
      state: { data: { root: { props: {} }, content }, ui: { itemSelector: { index: 1, zone: "root:default-zone" } } } as never,
      dispatch,
      components: [{ type: "content.text__v1", label: "Text" }]
    });
    const children = Children.toArray(element.props.children) as ReactElement[];
    const buttons = children.filter((child) => isValidElement(child) && child.type === "button") as ReactElement[];
    buttons.find((button) => button.props["aria-label"] === "Add block to canvas")!.props.onClick();
    buttons.find((button) => String(button.props["aria-label"]).startsWith("Delete content.text"))!.props.onClick();
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "insert", componentType: "content.text__v1", destinationIndex: 2, destinationZone: "root:default-zone", id: "builder-node-1" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "remove", index: 1, zone: "root:default-zone" });

    const protectedElement = AccessiblePuckControls({
      state: { data: { root: { props: {} }, content: [{ ...content[0], props: { ...content[0]!.props, __kNexCanDelete: false } }] }, ui: { itemSelector: { index: 0, zone: "root:default-zone" } } } as never,
      dispatch
    });
    const protectedDelete = (Children.toArray(protectedElement.props.children) as ReactElement[])
      .find((child) => isValidElement(child) && child.type === "button" && String(child.props["aria-label"]).startsWith("Delete content.text"))!;
    expect(protectedDelete.props.disabled).toBe(true);
  });
});
