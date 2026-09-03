import { describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

describe("generated workspace invalidation runtime", () => {
  it("dispatches both durable outboxes through one PostgreSQL channel", () => {
    const worker = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-worker.ts"]!;

    expect(worker).toContain("PostgresAuthorizationOutboxDispatcher");
    expect(worker).toContain("PostgresWorkspacePageOutboxDispatcher");
    expect(worker.match(/environment: kNexIdentity\.environment/g)).toHaveLength(2);
    expect(worker).toContain('pool.query("select pg_notify($1,$2)"');
    expect(worker).toContain('notify("authorization", invalidation, signal)');
    expect(worker).toContain('notify("workspace-page", invalidation, signal)');
  });

  it("consumes validated notifications into one periodically reconciled session registry", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const runtime = files["src/k-nex-workspace-pages.ts"]!;
    const mutations = files["src/app/api/k-nex/workspace-pages/[pageId]/[operation]/route.ts"]!;
    const action = files["src/app/api/k-nex/workspace-pages/[pageId]/actions/[actionId]/route.ts"]!;

    expect(runtime).toContain('client.query("LISTEN k_nex_runtime_invalidation")');
    expect(runtime).toContain("parseWorkspacePageInvalidation(envelope.invalidation)");
    expect(runtime).toContain("const sessions = new WorkspacePageSessionRegistry()");
    expect(runtime).toContain("setInterval(() => { void synchronize().catch(() => undefined); }, 1_000)");
    expect(runtime).toContain("const state = await runtime.synchronizeInvalidations()");
    expect(runtime).toContain("runtime.sessions.open({ ...scope, pageId, sessionId");
    expect(mutations).toContain("openWorkspacePageSession(payload, context, pageId");
    expect(mutations).toContain("session.signal");
    expect(action).toContain("executeWorkspaceSalesAction(payload, context, action, value.input, value.idempotencyKey, session.signal)");
  });
});
