import { describe, expect, it } from "vitest";

import { RemoteUiFrameSchema, RemoteUiNodeSchema } from "../src/remote-ui.js";

const identity = { schemaVersion: 1 as const, sessionId: "remote-session-1", appId: "app.sales-assistant", generationId: "sales-generation-1", sequence: 1 };
const root = { nodeId: "root", component: "stack", props: { gap: "medium" }, events: [], children: [
  { nodeId: "title", component: "heading", props: { level: 1, text: "Sales assistant" }, events: [], children: [] },
  { nodeId: "refresh", component: "button", props: { label: "Refresh" }, events: [{ event: "press", handlerId: "sales.refresh" }], children: [] }
] };

describe("remote UI wire contract", () => {
  it("accepts closed generation-bound component, request, event, and response frames", () => {
    expect(RemoteUiNodeSchema.parse(root)).toEqual(root);
    expect(RemoteUiFrameSchema.parse({ ...identity, direction: "realm-to-host", type: "render", root })).toMatchObject({ type: "render" });
    expect(RemoteUiFrameSchema.parse({ ...identity, direction: "realm-to-host", type: "request", operation: "source", requestId: "source-request-1", targetId: "sales.tasks", input: {} })).toMatchObject({ type: "request" });
    expect(RemoteUiFrameSchema.parse({ ...identity, direction: "host-to-realm", type: "event", nodeId: "refresh", event: "press", handlerId: "sales.refresh", payload: null })).toMatchObject({ type: "event" });
  });

  it("rejects executable props, unknown frames, mixed direction, and unbounded trees", () => {
    expect(RemoteUiNodeSchema.safeParse({ ...root, props: { onClick: () => undefined } }).success).toBe(false);
    expect(RemoteUiFrameSchema.safeParse({ ...identity, direction: "host-to-realm", type: "render", root }).success).toBe(false);
    expect(RemoteUiFrameSchema.safeParse({ ...identity, direction: "realm-to-host", type: "eval", source: "alert(1)" }).success).toBe(false);
    expect(RemoteUiNodeSchema.safeParse({ ...root, children: Array.from({ length: 65 }, (_, index) => ({ nodeId: `node_${index}`, component: "text", props: {}, events: [], children: [] })) }).success).toBe(false);
  });
});
