import { describe, expect, it } from "vitest";

import { presentUiRuntimeResult, type UiDocumentRuntimeResult } from "../src/index.js";

describe("shared browser presentation", () => {
  it("presents Phase 4 view models and fail-closed runtime results without React", () => {
    const rendered: UiDocumentRuntimeResult = {
      success: true,
      regions: { main: [{
        status: "rendered",
        nodeId: "tasks",
        blockId: "sales.workspace-task-table",
        blockVersion: 1,
        output: { kind: "data-table", title: "Open tasks", state: "success", table: { rows: [{}] } },
        children: []
      }] }
    };
    expect(presentUiRuntimeResult(rendered)).toBe("Open tasks (success, 1 rows)");
    expect(presentUiRuntimeResult({ success: false, code: "AUTHENTICATION_REQUIRED", remediation: "REQUEST_ACCESS" }))
      .toBe("Unavailable: AUTHENTICATION_REQUIRED");
    expect(presentUiRuntimeResult({
      success: true,
      regions: { main: [{
        status: "fallback",
        nodeId: "tasks",
        blockId: "sales.workspace-task-table",
        blockVersion: 1,
        reason: "PERMISSION_DENIED",
        remediation: "REQUEST_ACCESS",
        children: []
      }] }
    })).toBe("Unavailable: PERMISSION_DENIED");
  });
});
