import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceEditorSession,
  createPuckBuilderProfileRegistry,
  type PuckBlockBridge,
  type WorkspaceEditorPersistence
} from "../src/index.js";

const block: PuckBlockBridge = {
  definition: {
    id: "content.text", version: 1, profiles: ["workspace"], surfaces: ["workspace"], audience: "authenticated",
    propsSchema: { safeParse: (value: unknown) => ({ success: true as const, data: value }) }, render: ({ props }) => props
  },
  label: "Text",
  fields: [{ prop: "text", label: "Text", kind: "text" }],
  allowChildren: false,
  defaultProps: { text: "" }
};
const profile = createPuckBuilderProfileRegistry({
  blocks: [block],
  sources: [],
  profiles: [{ id: "workspace", blocks: [{ id: block.definition.id, version: 1 }], sources: [], actions: [], publication: "save-layout" }]
}).resolve("workspace")!;
const document = (version: number, text: string) => ({
  id: "workspace.document.sales-board", version, schemaVersion: 1 as const, profile: "workspace" as const,
  regions: { main: [{ id: "text-one", type: block.definition.id, version: 1, props: { text } }] }
});

function session(persistence: WorkspaceEditorPersistence) {
  return new WorkspaceEditorSession({
    profile,
    persistence,
    workingCopy: { revision: 1, document: document(1, "Initial") },
    editorSessionId: "workspace-editor-session",
    issueIdempotencyKey: (operation, sequence) => `workspace-${operation}-${sequence}`,
    debounceMs: 500,
    lostResponseRetryMs: 250
  });
}

afterEach(() => vi.useRealTimers());

describe("workspace Puck editor session", () => {
  it("debounces writes and replays a lost response with the same idempotency key", async () => {
    vi.useFakeTimers();
    const autosave = vi.fn<WorkspaceEditorPersistence["autosave"]>(async (input) => {
      if (autosave.mock.calls.length === 1) throw new Error("response lost");
      return { status: "saved", workingCopy: { revision: input.document.version, document: input.document } };
    });
    const value = session({ autosave, publish: vi.fn(), rollback: vi.fn() });
    value.change(document(1, "Edited"));
    await vi.advanceTimersByTimeAsync(500);
    expect(value.snapshot()).toMatchObject({ status: "error", workingCopyRevision: 1 });
    await vi.advanceTimersByTimeAsync(250);
    expect(autosave).toHaveBeenCalledTimes(2);
    expect(autosave.mock.calls[0]![0]).toEqual(autosave.mock.calls[1]![0]);
    expect(autosave.mock.calls[0]![0]).toMatchObject({ expectedRevision: 1, idempotencyKey: "workspace-autosave-1", document: { version: 2 } });
    expect(value.snapshot()).toMatchObject({ status: "saved", workingCopyRevision: 2, document: { version: 2 } });
    value.dispose();
  });

  it("exposes a multi-tab conflict and reloads only after explicit user recovery", async () => {
    const autosave = vi.fn<WorkspaceEditorPersistence["autosave"]>(async () => ({ status: "conflict", workingCopy: { revision: 3, document: document(3, "Remote") } }));
    const value = session({ autosave, publish: vi.fn(), rollback: vi.fn() });
    value.change(document(1, "Local"));
    await value.flush();
    expect(value.snapshot()).toMatchObject({ status: "conflict", document: { regions: { main: [{ props: { text: "Local" } }] } }, conflict: { revision: 3 } });
    expect(() => value.change(document(1, "Overwrite"))).toThrow(/Resolve/u);
    expect(value.reloadConflict()).toMatchObject({ version: 3, regions: { main: [{ props: { text: "Remote" } }] } });
    expect(value.snapshot()).toMatchObject({ status: "saved", workingCopyRevision: 3, conflict: undefined });
    value.dispose();
  });

  it("flushes before publish and keeps rollback as an explicit separate operation", async () => {
    const autosave = vi.fn<WorkspaceEditorPersistence["autosave"]>(async (input) => ({ status: "saved", workingCopy: { revision: input.document.version, document: input.document } }));
    const publish = vi.fn<WorkspaceEditorPersistence["publish"]>(async () => undefined);
    const rollback = vi.fn<WorkspaceEditorPersistence["rollback"]>(async () => undefined);
    const value = session({ autosave, publish, rollback });
    value.change(document(1, "Ready"));
    await value.publish();
    expect(autosave).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith({ workingCopyRevision: 2, idempotencyKey: "workspace-publish-2" }, expect.any(AbortSignal));
    expect(value.snapshot().status).toBe("published");
    await value.rollback("workspace.publication-one");
    expect(rollback).toHaveBeenCalledWith({ revisionId: "workspace.publication-one", idempotencyKey: "workspace-rollback-3" }, expect.any(AbortSignal));
    expect(value.snapshot().status).toBe("rolled-back");
    value.dispose();
  });
});
