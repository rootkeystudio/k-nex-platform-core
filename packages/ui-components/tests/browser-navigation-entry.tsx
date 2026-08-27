import { useState } from "react";
import { createRoot } from "react-dom/client";

import { Dialog, DropdownMenu, Popover, Tabs } from "../src/index.js";

function Fixture() {
  const [action, setAction] = useState("none");
  return <>
    <Tabs label="Sections" items={[{ id: "one", label: "One", content: "Panel one" }, { id: "two", label: "Two", content: "Panel two" }]} />
    <DropdownMenu label="More actions" items={[{ id: "archive", label: "Archive", onAction: () => setAction("archive") }]} />
    <output aria-label="Last action">{action}</output>
    <Dialog triggerLabel="Open dialog" title="Account dialog">
      <Popover triggerLabel="Open nested popover" label="Nested options"><button type="button">Nested action</button></Popover>
    </Dialog>
  </>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
