// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { componentStateMatrix, validateComponentStateMatrix } from "../src/index.js";
import { MatrixFixture } from "./matrix-fixture.js";
import { VirtualList } from "@k-nex/ui-data";

afterEach(cleanup);

describe("component interaction and semantic matrix", () => {
  it("uses role/name interactions and preserves the same state contract under both themes", async () => {
    const user = userEvent.setup();
    render(<MatrixFixture />);
    for (const label of ["Minimal", "Neobrutalism"]) {
      const surfaceElement = screen.getByTestId(`surface-${label}`);
      const surface = within(surfaceElement);
      expect(surface.getAllByRole("table").length).toBeGreaterThan(0);
      expect(surface.getByRole("form", { name: "Create task" })).toBeTruthy();
      expect(surface.getByRole("grid", { name: "Task grid" })).toBeTruthy();
      validateComponentStateMatrix(componentStateMatrix.filter((state) => surfaceElement.querySelector(`[data-matrix-state="${state}"]`) !== null));
    }
    const minimal = within(screen.getByTestId("surface-Minimal"));
    const search = minimal.getAllByRole("searchbox", { name: "Search Sales tasks" })[0]!;
    await user.type(search, "customer");
    expect(search).toHaveProperty("value", "customer");
    await user.click(minimal.getAllByRole("checkbox", { name: "Select row task-1" })[0]!);
    expect(minimal.getAllByText("1 selected").length).toBeGreaterThan(0);
    const cells = minimal.getAllByRole("gridcell");
    cells[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cells[1]);
    await user.click(screen.getByRole("button", { name: "Switch matrix theme" }));
    expect(screen.getByTestId("surface-Minimal").getAttribute("data-theme-id")).toBe("theme.neobrutalism");
  });

  it("does not steal mount focus and keeps virtual-list focus on stable item identities", async () => {
    const user = userEvent.setup();
    const view = render(<><button autoFocus>Keep focus</button><VirtualList label="Rows" items={["a", "b", "c"]} getKey={(item) => item} renderItem={(item) => item} height={72} estimateSize={36} /></>);
    const retainedFocus = screen.getByRole("button", { name: "Keep focus" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(retainedFocus);

    const item = (key: string): HTMLElement => view.container.querySelector<HTMLElement>(`[data-key="${key}"]`)!;
    await user.click(item("b"));
    view.rerender(<VirtualList label="Rows" items={["c", "b", "a"]} getKey={(value) => value} renderItem={(value) => value} height={72} estimateSize={36} />);
    view.rerender(<VirtualList label="Rows" items={["a"]} getKey={(value) => value} renderItem={(value) => value} height={72} estimateSize={36} />);
    expect(view.getByRole("list").getAttribute("aria-rowcount")).toBe("1");
    view.rerender(<VirtualList label="Rows" items={[]} getKey={(value: string) => value} renderItem={(value) => value} height={72} estimateSize={36} />);
    expect(view.getByRole("list").tabIndex).toBe(0);
    expect(view.container.querySelector("[role=listitem]")).toBeNull();
  });
});
