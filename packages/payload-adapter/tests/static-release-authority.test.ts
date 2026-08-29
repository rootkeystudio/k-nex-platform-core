import { describe, expect, it, vi } from "vitest";

import { PostgresTrustedBuildDeploymentClient, StaticReleaseAuthorityStoreError } from "../src/static-release-authority.js";
import type { RuntimeExtensionPool } from "../src/runtime-extension-store.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const green = {
  sourceCommit: "a".repeat(40), changePlanDigest: digest("b"), buildEvidenceDigest: digest("c"), applicationDigest: digest("d"), imageDigest: digest("e")
};
const retained = {
  sourceCommit: "f".repeat(40), compositionChangePlanDigest: digest("0"), buildEvidenceDigest: digest("1"), applicationDigest: digest("2"), imageDigest: digest("3")
};
const requestDigest = digest("4");

const rollbackReceipt = {
  schemaVersion: 1,
  receiptId: "static-rollback-3",
  operation: "rollback",
  applicationId: "customer-alpha",
  environment: "production",
  activeGenerationId: "customer-alpha-blue-1",
  previousGenerationId: "customer-alpha-green-2",
  ...retained,
  migrationRevision: 7,
  workerFencingToken: 5,
  promotionRevision: 3,
  revisionBefore: 2,
  revisionAfter: 3,
  rollbackWindow: { state: "open", windowId: "window-3", closesAt: "2026-08-30T00:00:00.000Z" },
  contractCleanup: "blocked",
  occurredAt: "2026-08-29T00:00:00.000Z"
} as const;

const retainedReceipt = {
  ...rollbackReceipt,
  receiptId: "static-promotion-1",
  operation: "promote",
  previousGenerationId: "customer-alpha-bootstrap-0",
  workerFencingToken: 2,
  promotionRevision: 1,
  revisionBefore: 0,
  revisionAfter: 1
} as const;

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    request_digest: requestDigest,
    application_id: "customer-alpha",
    environment: "production",
    version: "1.1.0",
    source_commit: green.sourceCommit,
    change_plan_digest: green.changePlanDigest,
    status: "deployment-requested",
    generation_id: null,
    build_evidence_digest: green.buildEvidenceDigest,
    application_digest: green.applicationDigest,
    image_digest: green.imageDigest,
    migration_revision: null,
    worker_fencing_token: null,
    receipt_id: null,
    receipt_json: null,
    ...overrides
  };
}

function deployedRow(receipt = rollbackReceipt) {
  return requestRow({
    status: "deployed",
    generation_id: receipt.activeGenerationId,
    migration_revision: receipt.migrationRevision,
    worker_fencing_token: receipt.workerFencingToken,
    receipt_id: receipt.receiptId,
    receipt_json: receipt
  });
}

function matchesRetainedAuthority(values: readonly unknown[]): boolean {
  return values[2] === rollbackReceipt.activeGenerationId && values[3] === rollbackReceipt.migrationRevision &&
    values[7] === rollbackReceipt.applicationId && values[8] === rollbackReceipt.environment && values[9] === rollbackReceipt.revisionAfter &&
    values[10] === rollbackReceipt.sourceCommit && values[11] === rollbackReceipt.compositionChangePlanDigest &&
    values[12] === rollbackReceipt.buildEvidenceDigest && values[13] === rollbackReceipt.applicationDigest && values[14] === rollbackReceipt.imageDigest;
}

function authorityReadMatches(values: readonly unknown[]): boolean {
  return values[0] === rollbackReceipt.applicationId && values[1] === rollbackReceipt.environment && values[2] === rollbackReceipt.revisionAfter &&
    values[3] === rollbackReceipt.activeGenerationId && values[4] === rollbackReceipt.sourceCommit && values[5] === rollbackReceipt.compositionChangePlanDigest &&
    values[6] === rollbackReceipt.buildEvidenceDigest && values[7] === rollbackReceipt.applicationDigest && values[8] === rollbackReceipt.imageDigest && values[9] === rollbackReceipt.migrationRevision;
}

function client(options: Readonly<{ recoveryReceipt?: unknown; deployed?: boolean; stored?: ReturnType<typeof requestRow> }> = {}) {
  const query = vi.fn(async <T extends object>(text: string, values: readonly unknown[] = []) => {
    if (text.startsWith("update runtime_static_release_requests")) {
      return { rows: options.deployed !== false && matchesRetainedAuthority(values) ? [deployedRow()] as T[] : [] as T[] };
    }
    if (text.startsWith("select retained.event_json")) {
      return { rows: authorityReadMatches(values) ? [{ event_json: retainedReceipt }] as T[] : [] as T[] };
    }
    if (text.startsWith("select event_json from runtime_static_deployment_outbox")) {
      return { rows: [{ event_json: options.recoveryReceipt ?? rollbackReceipt }] as T[] };
    }
    if (text.startsWith("select request_digest")) return { rows: [options.stored ?? requestRow()] as T[] };
    throw new Error(`Unexpected query: ${text}`);
  });
  return { client: new PostgresTrustedBuildDeploymentClient({ query } as RuntimeExtensionPool), query };
}

describe("PostgresTrustedBuildDeploymentClient rollback authority", () => {
  it("binds every rollback evidence field to the retained generation receipt chain", async () => {
    const value = client();
    await expect(value.client.recordDeployment({ buildRequestDigest: requestDigest, expectedVersion: "1.1.0", receipt: rollbackReceipt })).resolves.toMatchObject({
      status: "deployed", receipt: rollbackReceipt
    });

    const update = value.query.mock.calls.find(([text]) => String(text).startsWith("update runtime_static_release_requests"))?.[0] as string;
    expect(update).toContain("runtime_static_deployments deployment");
    expect(update).toContain("retained.revision < $10");
    expect(update).not.toContain("='rollback' or");

    const mismatches = [
      { ...rollbackReceipt, sourceCommit: "9".repeat(40) },
      { ...rollbackReceipt, compositionChangePlanDigest: digest("5") },
      { ...rollbackReceipt, buildEvidenceDigest: digest("6") },
      { ...rollbackReceipt, applicationDigest: digest("7") },
      { ...rollbackReceipt, imageDigest: digest("8") },
      { ...rollbackReceipt, migrationRevision: rollbackReceipt.migrationRevision + 1 }
    ];
    for (const receipt of mismatches) {
      await expect(client().client.recordDeployment({ buildRequestDigest: requestDigest, expectedVersion: "1.1.0", receipt })).rejects.toMatchObject({
        code: "RELEASE_TRANSITION_CONFLICT"
      } satisfies Partial<StaticReleaseAuthorityStoreError>);
      await expect(client({ stored: deployedRow(receipt) }).client.readRequest(requestDigest)).rejects.toMatchObject({
        code: "AUTHORITY_MISMATCH"
      } satisfies Partial<StaticReleaseAuthorityStoreError>);
    }
  });

  it("rejects a persisted rollback receipt when its retained authority is absent", async () => {
    const read = vi.fn(async <T extends object>(text: string) => {
      if (text.startsWith("select request_digest")) return { rows: [deployedRow()] as T[] };
      if (text.startsWith("select retained.event_json")) return { rows: [] as T[] };
      throw new Error(`Unexpected query: ${text}`);
    });
    const stored = new PostgresTrustedBuildDeploymentClient({ query: read } as RuntimeExtensionPool);
    await expect(stored.readRequest(requestDigest)).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" } satisfies Partial<StaticReleaseAuthorityStoreError>);
  });

  it("recovers only the outbox rollback receipt that still binds the retained authority", async () => {
    const value = client();
    await expect(value.client.recoverDeployment({
      buildRequestDigest: requestDigest,
      expectedVersion: "1.1.0",
      expectedRevision: 2,
      targetGenerationId: rollbackReceipt.activeGenerationId,
      operation: "rollback"
    })).resolves.toMatchObject({ status: "deployed", receipt: rollbackReceipt });

    const mismatched = { ...rollbackReceipt, imageDigest: digest("9") };
    await expect(client({ recoveryReceipt: mismatched }).client.recoverDeployment({
      buildRequestDigest: requestDigest,
      expectedVersion: "1.1.0",
      expectedRevision: 2,
      targetGenerationId: rollbackReceipt.activeGenerationId,
      operation: "rollback"
    })).rejects.toMatchObject({ code: "RELEASE_TRANSITION_CONFLICT" } satisfies Partial<StaticReleaseAuthorityStoreError>);
  });
});
