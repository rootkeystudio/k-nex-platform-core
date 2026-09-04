import { describe, expect, it } from "vitest";

import { systemOperationsApplicationFiles } from "../src/system-operations-application-files.js";

describe("generated System operations administration", () => {
  const files = systemOperationsApplicationFiles({ applicationId: "customer-alpha" });

  it("uses current authority and existing durable PostgreSQL operation projections", () => {
    const runtime = files["src/k-nex-system-operations.ts"]!;

    expect(runtime).toContain("new SystemOperationsAdministrationService");
    expect(runtime).toContain("authority: authority.adapter");
    expect(runtime).toContain("new PostgresSystemOperationsStore");
    expect(runtime).toContain("k_nex_system_operation_requests");
    expect(runtime).toContain("k_nex_system_operation_receipts");
    expect(runtime).toContain("runtime_extension_operations");
    expect(runtime).toContain("runtime_extension_transition_receipts");
    expect(runtime).toContain("OperationsCenterReferenceSchema.parse");
    expect(runtime).toContain("authorization === undefined || state === undefined ? undefined");
  });

  it("emits only fixed read-only routes and does not invent health or a web mutation path", () => {
    const operations = files["src/app/(workspace)/system/operations/page.tsx"]!;
    const detail = files["src/app/(workspace)/system/operations/[operationId]/page.tsx"]!;
    const encoded = JSON.stringify(files);

    expect(Object.keys(files)).toEqual([
      "src/k-nex-system-operations.ts",
      "src/app/(workspace)/system/operations/page.tsx",
      "src/app/(workspace)/system/operations/[operationId]/page.tsx"
    ]);
    expect(encoded).not.toContain("src/app/api/system/operations");
    expect(encoded).not.toContain("backup: {");
    expect(encoded).not.toContain("restoreDrill: {");
    expect(operations).toContain("health: operations.health.map");
    expect(operations).toContain('state: reference.receiptId === undefined ? "receipt pending" : "receipt recorded"');
    expect(detail).toContain("const matches = operations.references.filter");
    expect(detail).toContain("if (matches.length !== 1) notFound()");
    expect(detail).toContain("Durable receipt");
  });

  it("keeps browser authority and revisions out of generated operation routes", () => {
    const encoded = JSON.stringify(files);

    expect(encoded).toContain("kNexRequestContext(await headers()");
    expect(encoded).toContain("SystemOperationsAdministrationService");
    expect(encoded).not.toContain('name: "expectedOperationsRevision"');
    expect(encoded).not.toContain("request({");
    expect(encoded).not.toContain("fixtures/customer-gate-1");
  });
});
