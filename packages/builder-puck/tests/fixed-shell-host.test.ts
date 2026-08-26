import { Children, isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { createPuckBuilderProfileRegistry, type PuckBlockBridge } from "../src/index.js";
import { PuckFixedShellHost } from "../src/editor.js";

const block: PuckBlockBridge = {
  definition: {
    id: "content.text", version: 1, profiles: ["cms", "workspace"], surfaces: ["cms", "public", "workspace"], audience: "public",
    propsSchema: { safeParse: (value: unknown) => ({ success: true as const, data: value }) }, render: ({ props }) => props
  },
  label: "Text",
  fields: [{ prop: "text", label: "Text", kind: "text" }],
  allowChildren: false,
  defaultProps: { text: "" }
};

describe("fixed builder shell", () => {
  it("keeps security and platform regions outside the editor canvas", () => {
    const profile = createPuckBuilderProfileRegistry({
      blocks: [block], sources: [],
      profiles: [{ id: "cms", blocks: [{ id: "content.text", version: 1 }], sources: [], actions: [], publication: "draft-preview-publish" }]
    }).resolve("cms");
    if (profile === undefined) throw new Error("Expected CMS profile.");
    const shell = PuckFixedShellHost({
      profile,
      document: { id: "cms.home", version: 1, schemaVersion: 1, profile: "cms", regions: { main: [] } },
      authentication: "auth",
      router: "router",
      sidebar: "sidebar",
      topBar: "topbar",
      systemScreens: "system",
      globalDialogs: "dialogs"
    });
    const children = Children.toArray(shell.props.children) as ReactElement[];
    const canvas = children.find((child) => isValidElement(child) && child.props["data-k-nex-builder-canvas"] === "cms");
    expect(canvas).toBeDefined();
    expect(children.map((child) => Object.keys(child.props).find((key) => key.startsWith("data-k-nex-shell-")))).toEqual([
      "data-k-nex-shell-authentication",
      "data-k-nex-shell-sidebar",
      "data-k-nex-shell-top-bar",
      "data-k-nex-shell-router",
      "data-k-nex-shell-system-screens",
      undefined,
      "data-k-nex-shell-global-dialogs"
    ]);
    expect(JSON.stringify(canvas?.props)).not.toContain("sidebar");
    expect(JSON.stringify(canvas?.props)).not.toContain("system");
    expect(JSON.stringify(canvas?.props)).not.toContain("dialogs");
  });
});
