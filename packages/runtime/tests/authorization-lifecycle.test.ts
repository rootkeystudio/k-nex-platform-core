import { describe, expect, it } from "vitest";

import type { ExtensionAuthorizationGeneration } from "@k-nex/contracts";

import {
  AuthorizationLifecycleError,
  planAuthorizationLifecycle
} from "../src/authorization-lifecycle.js";

const applicationId = "customer-alpha";
const environment = "production";
const platform = { deliveryClass: "platform-plugin", extensionId: "module.sales" } as const;
const hot = { deliveryClass: "hot-application", extensionId: "app.sales" } as const;

describe("authorization lifecycle planner", () => {
  it("keeps Phase 9 extension revisions independent from authorization lifecycle revisions", () => {
    const result = plan({
      expected: expected(3, 7),
      transition: lifecycle(platform, "install", "active", 41, "sales-generation-1"),
      runtimeGenerationIds: ["sales-generation-1"]
    });
    expect(result.lifecycleRevision).toBe(8);
    expect(result.generations).toEqual([generation(platform, 1, "current", ["sales-generation-1"], 3, 8)]);
  });

  it("allocates a fresh generation and preserves it through disable, re-enable, and compatible update", () => {
    const installed = plan({
      expected: expected(3, 7),
      transition: lifecycle(platform, "install", "active", 8, "sales-generation-1"),
      runtimeGenerationIds: ["sales-generation-1"]
    });
    expect(installed.generations).toEqual([generation(platform, 1, "current", ["sales-generation-1"], 3, 8)]);
    expect(installed.mutations).toHaveLength(1);

    const disabled = plan({
      expected: expected(3, 8),
      transition: lifecycle(platform, "disable", "disabled", 9, "sales-generation-1"),
      existingGenerations: installed.generations,
      runtimeGenerationIds: ["sales-generation-1"]
    });
    expect(disabled.generations[0]).toMatchObject({ owner: { generation: 1 }, state: "current", runtimeGenerationIds: ["sales-generation-1"], lifecycleRevision: 9 });
    expect(disabled.snapshots).toEqual([expect.objectContaining({ state: "inactive-extension-disabled", owner: { kind: "extension", ...platform, generation: 1 } })]);

    const reenabled = plan({
      expected: expected(3, 9),
      transition: lifecycle(platform, "install", "active", 10, "sales-generation-2"),
      existingGenerations: disabled.generations,
      runtimeGenerationIds: ["sales-generation-2"]
    });
    expect(reenabled.generations).toEqual([generation(platform, 1, "current", ["sales-generation-2"], 3, 10)]);

    const updated = plan({
      expected: expected(3, 10),
      transition: lifecycle(platform, "update", "active", 11, "sales-generation-3"),
      existingGenerations: reenabled.generations,
      runtimeGenerationIds: ["sales-generation-3"],
      updateCompatibility: "compatible",
      priorGenerationDescriptors: [descriptor(platform)]
    });
    expect(updated.generations).toEqual([generation(platform, 1, "current", ["sales-generation-3"], 3, 11)]);

    const disabledAfterUpdate = plan({
      expected: expected(3, 11),
      transition: lifecycle(platform, "disable", "disabled", 12, "sales-generation-3"),
      existingGenerations: updated.generations,
      runtimeGenerationIds: ["sales-generation-3"]
    });
    expect(disabledAfterUpdate.generations).toEqual([generation(platform, 1, "current", ["sales-generation-3"], 3, 12)]);
  });

  it("keeps target permissions authoritative and snapshots only removed compatible-update permissions as deprecated", () => {
    const result = plan({
      expected: expected(3, 7),
      transition: lifecycle(platform, "update", "active", 8, "sales-generation-2"),
      existingGenerations: [generation(platform, 1, "current", ["sales-generation-1"], 3, 7)],
      runtimeGenerationIds: ["sales-generation-2"],
      updateCompatibility: "compatible",
      priorGenerationDescriptors: [descriptor(platform), descriptor(platform, "sales.orders.write")],
      descriptors: [descriptor(platform, "sales.orders.read"), descriptor(platform, "sales.orders.v2.read")]
    });

    expect(result.generations).toEqual([generation(platform, 1, "current", ["sales-generation-2"], 3, 8)]);
    expect(result.snapshots).toEqual([expect.objectContaining({
      state: "deprecated",
      owner: { kind: "extension", ...platform, generation: 1 },
      permission: expect.objectContaining({ id: "sales.orders.write" })
    })]);
  });

  it("keeps sequential compatible-update deprecations cumulative", () => {
    const first = plan({
      expected: expected(3, 7),
      transition: lifecycle(platform, "update", "active", 8, "sales-generation-2"),
      existingGenerations: [generation(platform, 1, "current", ["sales-generation-1"], 3, 7)],
      runtimeGenerationIds: ["sales-generation-2"], updateCompatibility: "compatible",
      priorGenerationDescriptors: [descriptor(platform, "sales.orders.read")],
      descriptors: [descriptor(platform, "sales.orders.v2.read")]
    });
    const second = plan({
      expected: expected(3, 8),
      transition: lifecycle(platform, "update", "active", 9, "sales-generation-3"),
      existingGenerations: first.generations,
      runtimeGenerationIds: ["sales-generation-3"], updateCompatibility: "compatible",
      priorGenerationDescriptors: [descriptor(platform, "sales.orders.v2.read")],
      descriptors: [descriptor(platform, "sales.orders.v3.read")]
    });

    expect([...first.snapshots, ...second.snapshots].map((snapshot) => snapshot.permission.id)).toEqual([
      "sales.orders.read", "sales.orders.v2.read"
    ]);
  });

  it("retires the old current generation and allocates max plus one for an incompatible update", () => {
    const previous = [generation(platform, 1, "retired", ["sales-generation-1"], 3, 7), generation(platform, 2, "current", ["sales-generation-2"], 3, 7)];
    const result = plan({
      expected: expected(3, 7),
      transition: lifecycle(platform, "update", "active", 8, "sales-generation-3"),
      existingGenerations: previous,
      descriptors: [descriptor(platform, "sales.orders.v2.read")],
      priorGenerationDescriptors: [descriptor(platform)],
      runtimeGenerationIds: ["sales-generation-3"],
      updateCompatibility: "incompatible"
    });
    expect(result.generations).toEqual([
      generation(platform, 1, "retired", ["sales-generation-1"], 3, 7),
      generation(platform, 2, "retired", ["sales-generation-2"], 3, 8),
      generation(platform, 3, "current", ["sales-generation-3"], 3, 8)
    ]);
    expect(result.snapshots).toEqual([expect.objectContaining({
      state: "inactive-generation-retired",
      owner: { kind: "extension", ...platform, generation: 2 },
      permission: expect.objectContaining({ id: "sales.orders.read" })
    })]);
  });

  it.each([platform, hot])("recovers a quarantined %s update as a fresh incompatible authorization generation", (identity) => {
    const result = plan({
      identity,
      expected: expected(3, 8),
      transition: lifecycle(identity, "update", "active", 9, "sales-generation-2"),
      existingGenerations: [generation(identity, 1, "retired", ["sales-generation-1"], 3, 8)],
      descriptors: [descriptor(identity, "sales.orders.v2.read")],
      priorGenerationDescriptors: [descriptor(identity)],
      runtimeGenerationIds: ["sales-generation-2"],
      updateCompatibility: "incompatible"
    });

    expect(result.generations).toEqual([
      generation(identity, 1, "retired", ["sales-generation-1"], 3, 8),
      generation(identity, 2, "current", ["sales-generation-2"], 3, 9)
    ]);
  });

  it("retires current generations for uninstall and security quarantine with truthful administrative states", () => {
    const existing = [generation(platform, 1, "current", ["sales-generation-1"], 3, 7)];
    const removed = plan({
      expected: expected(3, 7), transition: lifecycle(platform, "uninstall", "removed", 8, "sales-generation-1"),
      existingGenerations: existing, runtimeGenerationIds: ["sales-generation-1"]
    });
    expect(removed.generations[0]).toMatchObject({ state: "retired", lifecycleRevision: 8 });
    expect(removed.snapshots).toEqual([expect.objectContaining({ state: "orphaned-after-removal" })]);
    expect(plan({
      expected: expected(3, 7), transition: lifecycle(platform, "uninstall", "removed", 8, "sales-generation-1"),
      existingGenerations: removed.generations, runtimeGenerationIds: ["sales-generation-1"]
    })).toMatchObject({ replayed: true, mutations: [] });

    const quarantined = plan({
      identity: hot,
      expected: expected(3, 7), transition: quarantine(hot, 8, "sales-generation-1"),
      existingGenerations: [generation(hot, 1, "current", ["sales-generation-1"], 3, 7)], runtimeGenerationIds: ["sales-generation-1"]
    });
    expect(quarantined.generations[0]).toMatchObject({ state: "retired", owner: { kind: "extension", ...hot, generation: 1 } });
    expect(quarantined.snapshots).toEqual([expect.objectContaining({ state: "inactive-generation-retired" })]);

    const runnerQuarantined = plan({
      identity: hot,
      expected: expected(3, 7), transition: lifecycle(hot, "install", "quarantined", 8, "sales-generation-1", "failed"),
      existingGenerations: [generation(hot, 1, "current", ["sales-generation-1"], 3, 7)], runtimeGenerationIds: ["sales-generation-1"]
    });
    expect(runnerQuarantined.generations[0]).toMatchObject({ state: "retired" });
    expect(runnerQuarantined.snapshots).toEqual([expect.objectContaining({ state: "inactive-generation-retired" })]);

    const staticUninstalled = plan({
      expected: expected(3, 7), transition: lifecycle(platform, "uninstall", "removed", 8, "host-generation-2"),
      existingGenerations: [generation(platform, 1, "current", ["host-generation-1"], 3, 7)], runtimeGenerationIds: ["host-generation-1"]
    });
    expect(staticUninstalled.generations[0]).toMatchObject({ state: "retired", runtimeGenerationIds: ["host-generation-1"] });

    const removedAfterQuarantine = plan({
      identity: hot,
      expected: expected(3, 8), transition: lifecycle(hot, "uninstall", "removed", 9, "sales-generation-1"),
      existingGenerations: quarantined.generations, runtimeGenerationIds: ["sales-generation-1"]
    });
    expect(removedAfterQuarantine.generations).toEqual([generation(hot, 1, "retired", ["sales-generation-1"], 3, 9)]);
    expect(removedAfterQuarantine.snapshots).toEqual([expect.objectContaining({ state: "orphaned-after-removal" })]);
    expect(() => plan({
      identity: hot,
      expected: expected(3, 8), transition: lifecycle(hot, "uninstall", "removed", 9, "sales-generation-other"),
      existingGenerations: quarantined.generations, runtimeGenerationIds: ["sales-generation-other"]
    })).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" } satisfies Partial<AuthorizationLifecycleError>));
  });

  it("is replay-stable and never revives a retired generation after reinstall", () => {
    const original = {
      expected: expected(3, 7), transition: lifecycle(platform, "install", "active", 8, "sales-generation-2"),
      existingGenerations: [generation(platform, 1, "retired", ["sales-generation-1"], 3, 7)], runtimeGenerationIds: ["sales-generation-2"]
    } as const;
    const installed = plan(original);
    expect(installed.generations).toEqual([
      generation(platform, 1, "retired", ["sales-generation-1"], 3, 7),
      generation(platform, 2, "current", ["sales-generation-2"], 3, 8)
    ]);
    const replay = plan({ ...original, existingGenerations: installed.generations });
    expect(replay.replayed).toBe(true);
    expect(replay.mutations).toEqual([]);
    expect(replay.generations[0]).toMatchObject({ state: "retired" });
  });

  it("fails closed for stale, ambiguous, and cross-owner lifecycle inputs", () => {
    const current = generation(platform, 1, "current", ["sales-generation-1"], 3, 9);
    expect(() => plan({
      expected: expected(3, 7), transition: lifecycle(platform, "disable", "disabled", 8, "sales-generation-1"),
      existingGenerations: [current], runtimeGenerationIds: ["sales-generation-1"]
    })).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" } satisfies Partial<AuthorizationLifecycleError>));
    expect(() => plan({
      expected: expected(3, 7), transition: lifecycle(platform, "install", "active", 8, "sales-generation-1"),
      existingGenerations: [generation(platform, 1, "current", ["sales-generation-1"], 3, 7), generation(platform, 2, "current", ["sales-generation-2"], 3, 7)],
      runtimeGenerationIds: ["sales-generation-1"]
    })).toThrow(expect.objectContaining({ code: "AMBIGUOUS_GENERATION" } satisfies Partial<AuthorizationLifecycleError>));
    expect(() => plan({
      expected: expected(3, 7), transition: lifecycle(platform, "install", "active", 8, "sales-generation-1"),
      runtimeGenerationIds: ["sales-generation-1"], descriptors: [descriptor(hot)]
    })).toThrow(expect.objectContaining({ code: "IDENTITY_MISMATCH" } satisfies Partial<AuthorizationLifecycleError>));
    expect(() => plan({
      expected: expected(3, 7), transition: lifecycle(platform, "install", "active", 8, "sales-generation-2"),
      existingGenerations: [generation(platform, 1, "retired", ["sales-generation-1"], 3, 7)], runtimeGenerationIds: ["sales-generation-2", "sales-generation-1"]
    })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" } satisfies Partial<AuthorizationLifecycleError>));
  });

  it("requires owner-validated prior descriptors for every update only", () => {
    const input = {
      expected: expected(3, 7),
      transition: lifecycle(platform, "update", "active", 8, "sales-generation-2"),
      existingGenerations: [generation(platform, 1, "current", ["sales-generation-1"], 3, 7)],
      runtimeGenerationIds: ["sales-generation-2"],
      updateCompatibility: "incompatible" as const
    };
    expect(() => plan(input)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" } satisfies Partial<AuthorizationLifecycleError>));
    expect(() => plan({ ...input, priorGenerationDescriptors: [descriptor(hot)] })).toThrow(expect.objectContaining({ code: "IDENTITY_MISMATCH" } satisfies Partial<AuthorizationLifecycleError>));
    expect(() => plan({
      expected: expected(3, 7), transition: lifecycle(platform, "update", "active", 8, "sales-generation-2"),
      existingGenerations: [generation(platform, 1, "current", ["sales-generation-1"], 3, 7)], runtimeGenerationIds: ["sales-generation-2"],
      updateCompatibility: "compatible"
    })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" } satisfies Partial<AuthorizationLifecycleError>));
    expect(() => plan({
      expected: expected(3, 7), transition: lifecycle(platform, "install", "active", 8, "sales-generation-1"),
      runtimeGenerationIds: ["sales-generation-1"], priorGenerationDescriptors: [descriptor(platform)]
    })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" } satisfies Partial<AuthorizationLifecycleError>));
  });
});

function plan(input: Readonly<{
  identity?: typeof platform | typeof hot;
  expected: ReturnType<typeof expected>;
  transition: unknown;
  existingGenerations?: readonly ExtensionAuthorizationGeneration[];
  runtimeGenerationIds: readonly string[];
  updateCompatibility?: "compatible" | "incompatible";
  descriptors?: readonly unknown[];
  priorGenerationDescriptors?: readonly unknown[];
}>) {
  const identity = input.identity ?? platform;
  return planAuthorizationLifecycle({
    expected: input.expected,
    transition: input.transition,
    existingGenerations: input.existingGenerations ?? [],
    descriptors: input.descriptors ?? [descriptor(identity)],
    runtimeGenerationIds: input.runtimeGenerationIds,
    ...(input.priorGenerationDescriptors === undefined ? {} : { priorGenerationDescriptors: input.priorGenerationDescriptors }),
    ...(input.updateCompatibility === undefined ? {} : { updateCompatibility: input.updateCompatibility })
  });
}

function expected(authorizationRevision: number, lifecycleRevision: number) {
  return { applicationId, environment, authorizationRevision, lifecycleRevision } as const;
}

function descriptor(identity: typeof platform | typeof hot, id = "sales.orders.read") {
  return {
    schemaVersion: 1,
    id,
    publisher: { kind: "extension", ...identity },
    title: "Read sales orders",
    description: "Read sales orders through the authorized sales extension.",
    audience: "authenticated",
    resource: "sales.orders",
    operation: "read",
    scope: "application"
  } as const;
}

function generation(identity: typeof platform | typeof hot, number: number, state: "current" | "retired", runtimeGenerationIds: readonly string[], authorizationRevision: number, lifecycleRevision: number): ExtensionAuthorizationGeneration {
  return {
    schemaVersion: 1,
    applicationId,
    owner: { kind: "extension", ...identity, generation: number },
    runtimeGenerationIds,
    state,
    authorizationRevision,
    lifecycleRevision
  };
}

function lifecycle(identity: typeof platform | typeof hot, operation: "install" | "update" | "rollback" | "disable" | "uninstall", lifecycleState: "active" | "disabled" | "removed" | "quarantined", revision: number, generationId: string, operationPhase: "completed" | "failed" = "completed") {
  return {
    schemaVersion: 1, applicationId, environment, eventId: `event-${revision}`, eventType: "extension.lifecycle-transition",
    operationId: `operation-${revision}`, operation, operationPhase, lifecycleState,
    expectedRevision: revision - 1, revision, inventoryRevision: revision, actor: { kind: "trusted-automation", identity: "test.lifecycle" },
    receiptId: `receipt-${revision}`, auditId: `audit-${revision}`, idempotencyKey: `lifecycle:${revision}:test`, correlationId: `correlation-${revision}`,
    occurredAt: "2026-09-01T00:00:00.000Z", deliveryClass: identity.deliveryClass, id: identity.extensionId,
    evidence: identity.deliveryClass === "platform-plugin"
      ? { sourceCommit: "a".repeat(40), compositionChangePlanDigest: `sha256:${"b".repeat(64)}`, generationId }
      : { sourceCommit: "a".repeat(40), artifactDigest: `sha256:${"b".repeat(64)}`, generationId }
  } as const;
}

function quarantine(identity: typeof hot, revision: number, generationId: string) {
  return {
    schemaVersion: 1, eventId: `event-${revision}`, eventType: "extension.security-quarantine", securityTransitionId: `security-${revision}`,
    receiptId: `receipt-${revision}`, auditId: `audit-${revision}`, applicationId, environment, expectedRevision: revision - 1,
    revision, inventoryRevision: revision, occurredAt: "2026-09-01T00:00:00.000Z", deliveryClass: identity.deliveryClass, id: identity.extensionId,
    evidence: {
      catalogDigest: `sha256:${"a".repeat(64)}`, catalogSignerIdentity: "test-signer", catalogSequence: 1, disposition: "security-compromised",
      sourceCommit: "a".repeat(40), artifactDigest: `sha256:${"b".repeat(64)}`, manifestDigest: `sha256:${"c".repeat(64)}`,
      provenanceDigest: `sha256:${"d".repeat(64)}`, sbomDigest: `sha256:${"e".repeat(64)}`, generationId, version: "1.0.0"
    }
  } as const;
}
