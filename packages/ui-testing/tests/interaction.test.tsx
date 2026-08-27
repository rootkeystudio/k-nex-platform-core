// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { componentStateMatrix, validateComponentStateMatrix } from "../src/index.js";
import { MatrixFixture } from "./matrix-fixture.js";

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
});
