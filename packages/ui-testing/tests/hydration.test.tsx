// @vitest-environment happy-dom
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HydrationProbe } from "./matrix-fixture.js";

describe("SSR and hydration parity", () => {
  it("hydrates deterministic K-Nex table markup without recoverable errors", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<HydrationProbe />);
    document.body.append(container);
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, <HydrationProbe />, { onRecoverableError: (error) => errors.push(error) }); });
    expect(errors).toEqual([]);
    expect(container.querySelector('table[aria-label="Hydration tasks"]')).toBeTruthy();
    await act(async () => root.unmount());
    container.remove();
  });
});
