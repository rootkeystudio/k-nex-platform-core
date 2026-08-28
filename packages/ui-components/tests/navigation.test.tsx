import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Accordion, Breadcrumbs, ButtonGroup, Carousel, Dialog, Drawer, DropdownMenu,
  Modal, Navigation, Popover, SegmentedControl, SkipLink, Tabs, Toolbar, Tooltip,
  TreeView
} from "../src/index.js";

const items = [{ id: "overview", label: "Overview", href: "/overview" }, { id: "tasks", label: "Tasks", href: "/tasks", current: true }];

describe("navigation, disclosure, and overlay family", () => {
  it("renders route semantics and stable component roots", () => {
    const markup = renderToStaticMarkup(<>
      <SkipLink href="#main" /><Navigation label="Primary" items={items} /><Breadcrumbs label="Breadcrumb" items={items} />
      <Tabs label="Sections" items={[{ id: "one", label: "One", content: "Panel one" }]} />
      <SegmentedControl label="View" items={[{ id: "list", label: "List" }]} value="list" onChange={() => undefined} />
      <ButtonGroup label="Actions"><button>Save</button></ButtonGroup><Toolbar label="Tools"><button>Edit</button></Toolbar>
      <DropdownMenu label="More" items={[{ id: "archive", label: "Archive", onAction: () => undefined }]} />
      <TreeView label="Pages" items={[{ id: "root", label: "Root", children: [{ id: "child", label: "Child" }] }]} />
      <Accordion items={[{ id: "a", title: "Details", content: "Content" }]} />
      <Dialog triggerLabel="Open dialog" title="Dialog">Content</Dialog><Modal triggerLabel="Open modal" title="Modal">Content</Modal>
      <Drawer triggerLabel="Open drawer" title="Drawer">Content</Drawer><Popover triggerLabel="Open popover" label="Popover">Content</Popover>
      <Tooltip triggerLabel="Help">Helpful</Tooltip><Carousel label="Slides" items={[{ id: "one", content: "Slide" }]} />
    </>);
    for (const id of ["skip-link", "navigation", "breadcrumbs", "tabs", "segmented-control", "button-group", "toolbar", "dropdown-menu", "tree-view", "accordion", "dialog", "modal", "drawer", "popover", "tooltip", "carousel"]) expect(markup).toContain(`data-k-nex-component="${id}"`);
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('role="tree"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-level="2"');
    expect(markup).toContain("<details");
  });

  it("uses native radios for segmented selection", () => {
    const markup = renderToStaticMarkup(<SegmentedControl label="View" items={[{ id: "list", label: "List" }, { id: "board", label: "Board", disabled: true }]} value="list" onChange={() => undefined} />);
    expect(markup).toContain("<fieldset");
    expect(markup).toContain("<legend>View</legend>");
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain('disabled=""');
  });
});
