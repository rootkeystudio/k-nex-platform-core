import { describe, expect, it } from "vitest";

import { createPuckBuilderProfileRegistry, type PuckBlockBridge, type PuckBuilderProfile } from "../src/index.js";

const staticBlock: PuckBlockBridge = {
  id: "content.text",
  version: 1,
  label: "Text",
  fields: [{ prop: "text", label: "Text", kind: "text" }],
  allowChildren: false,
  defaultProps: { text: "" },
  render: ({ props }) => props.text
};
const workspaceBlock: PuckBlockBridge = { ...staticBlock, id: "sales.workspace-task-table", label: "Task table" };
const cms: PuckBuilderProfile = {
  id: "cms",
  blocks: [{ id: "content.text", version: 1 }],
  sources: [{ id: "sales.public-task-summary", version: 1 }],
  actions: [{ id: "content.public-signup", version: 1 }],
  publication: "draft-preview-publish"
};
const workspace: PuckBuilderProfile = {
  id: "workspace",
  blocks: [{ id: "content.text", version: 1 }, { id: "sales.workspace-task-table", version: 1 }],
  sources: [{ id: "sales.tasks", version: 1 }],
  actions: [{ id: "sales.workspace-task-create", version: 1 }],
  publication: "save-layout"
};

describe("profile-specific Puck policy", () => {
  it("uses one engine with distinct palettes and authority allowlists", () => {
    const registry = createPuckBuilderProfileRegistry({ blocks: [staticBlock, workspaceBlock], profiles: [cms, workspace] });
    const cmsProfile = registry.resolve("cms");
    const workspaceProfile = registry.resolve("workspace");
    expect(Object.keys(cmsProfile?.adapter.config.components ?? {})).toEqual(["content.text__v1"]);
    expect(Object.keys(workspaceProfile?.adapter.config.components ?? {})).toEqual(["content.text__v1", "sales.workspace-task-table__v1"]);
    expect(cmsProfile?.allowsSource("sales.tasks", 1)).toBe(false);
    expect(cmsProfile?.allowsSource("sales.public-task-summary", 1)).toBe(true);
    expect(workspaceProfile?.allowsSource("sales.tasks", 1)).toBe(true);
    expect(workspaceProfile?.allowsSource("sales.public-task-summary", 1)).toBe(false);
    expect(cmsProfile?.allowsAction("sales.workspace-task-create", 1)).toBe(false);
    expect(workspaceProfile?.allowsAction("sales.workspace-task-create", 1)).toBe(true);
  });

  it("rejects unknown blocks, duplicates, and crossed publication rules", () => {
    expect(() => createPuckBuilderProfileRegistry({ blocks: [staticBlock], profiles: [{ ...cms, blocks: [{ id: "missing.block", version: 1 }] }] })).toThrow(/unknown block/);
    expect(() => createPuckBuilderProfileRegistry({ blocks: [staticBlock], profiles: [cms, cms] })).toThrow(/unique/);
    expect(() => createPuckBuilderProfileRegistry({ blocks: [staticBlock], profiles: [{ ...cms, publication: "save-layout" }] })).toThrow(/publication/);
    expect(() => createPuckBuilderProfileRegistry({ blocks: [staticBlock], profiles: [{ ...workspace, blocks: [{ id: "content.text", version: 1 }], publication: "draft-preview-publish" }] })).toThrow(/publication/);
  });

  it("rejects documents from another profile and sources outside the profile allowlist", () => {
    const profile = createPuckBuilderProfileRegistry({ blocks: [staticBlock], profiles: [cms] }).resolve("cms");
    if (profile === undefined) throw new Error("Expected CMS profile.");
    const node = { id: "text-1", type: "content.text", version: 1, props: { text: "Hello" } };
    expect(() => profile.adapter.toPuckData({ id: "workspace.home", version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [node] } })).toThrow(/cannot edit/);
    expect(() => profile.adapter.toPuckData({
      id: "cms.home",
      version: 1,
      schemaVersion: 1,
      profile: "cms",
      regions: { main: [{ ...node, bindings: { source: { source: { id: "sales.tasks", version: 1 }, input: {}, structuralCompatibilityHash: `sha256:${"a".repeat(64)}`, selectedFields: ["title"] } } }] }
    })).toThrow(/forbids source/);
  });
});
