import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActionBar, AspectRatio, PageHeader, PageShell, ScrollableArea, SplitView } from "../src/index.js";

describe("foundation composition utilities", () => {
  it("renders native semantic page, action, split, scroll, and ratio structures", () => {
    const markup = renderToStaticMarkup(<PageShell label="Workspace"><PageHeader title="Title" description="Description" /><ActionBar label="Actions"><button>Save</button></ActionBar><SplitView primary="Primary" secondary="Secondary" /><ScrollableArea label="Results" maxHeight={320}>Rows</ScrollableArea><AspectRatio ratio={2}>Media</AspectRatio></PageShell>);
    for (const component of ["page-shell", "page-header", "action-bar", "split-view", "scrollable-area", "aspect-ratio"]) expect(markup).toContain(`data-k-nex-component="${component}"`);
    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain("aspect-ratio:2");
  });

  it("rejects invalid aspect ratios", () => { expect(() => renderToStaticMarkup(<AspectRatio ratio={0}>Bad</AspectRatio>)).toThrow(/positive/); });
});
