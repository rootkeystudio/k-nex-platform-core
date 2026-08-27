import { useState } from "react";
import { createRoot } from "react-dom/client";

import { Dialog, DropdownMenu, Popover, SegmentedControl, Tabs, TreeView } from "../src/index.js";

function Fixture() {
  const [action, setAction] = useState("none");
  const [view, setView] = useState("list");
  return <>
    <Tabs label="Sections" items={[{ id: "one", label: "One", content: "Panel one" }, { id: "two", label: "Two", content: "Panel two" }]} />
    <SegmentedControl label="View" items={[{ id: "list", label: "List" }, { id: "board", label: "Board" }]} value={view} onChange={setView} />
    <output aria-label="Selected view">{view}</output>
    <DropdownMenu label="More actions" items={[{ id: "archive", label: "Archive", onAction: () => setAction("archive") }]} />
    <output aria-label="Last action">{action}</output>
    <TreeView label="Workspace pages" items={[{ id: "home", label: "Home" }, { id: "projects", label: "Projects", children: [{ id: "active", label: "Active projects" }, { id: "archive", label: "Archived projects", children: [{ id: "2026", label: "2026 archive" }] }] }, { id: "settings", label: "Settings" }]} onSelectionChange={(id) => setAction(`selected:${id}`)} />
    <Dialog triggerLabel="Open dialog" title="Account dialog">
      <Popover triggerLabel="Open nested popover" label="Nested options"><button type="button">Nested action</button></Popover>
    </Dialog>
  </>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
