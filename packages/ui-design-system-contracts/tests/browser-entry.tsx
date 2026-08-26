import { useState } from "react";
import { createRoot } from "react-dom/client";

import { reactAriaPrimitives as P } from "../src/index.js";

function Fixture() {
  const [presses, setPresses] = useState(0);
  const [checked, setChecked] = useState(false);
  const [priority, setPriority] = useState("normal");
  return <P.Stack>
    <P.Button onPress={() => setPresses((value) => value + 1)}>Increment</P.Button>
    <P.Status>Presses: {presses}</P.Status>
    <P.Checkbox isSelected={checked} onChange={setChecked}>Receive updates</P.Checkbox>
    <P.Status>Checked: {String(checked)}</P.Status>
    <P.Select
      label="Priority"
      options={[{ id: "normal", label: "Normal" }, { id: "urgent", label: "Urgent" }]}
      selectedKey={priority}
      onChange={setPriority}
    />
    <P.Status>Priority: {priority}</P.Status>
    <P.Dialog title="Confirm action" triggerLabel="Open dialog">Dialog content</P.Dialog>
    <P.Tooltip triggerLabel="More information" delay={0}>Helpful details</P.Tooltip>
    <P.Table
      label="People"
      columns={[{ id: "name", label: "Name", isRowHeader: true }]}
      rows={[{ id: "ada", cells: { name: "Ada" } }]}
    />
  </P.Stack>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
