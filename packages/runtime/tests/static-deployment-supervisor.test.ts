import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson, type StaticCompositionChangePlan, type StaticDeploymentReceipt, type TrustedApplicationBuildEvidence, type WorkerGenerationFence } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  DeploymentSupervisor,
  TrustedStaticApplicationBuildAuthority,
  type GatewayTrafficRouter,
  type StaticApplicationGeneration,
  type StaticApplicationArtifactProvider,
  type StaticCompositionChangeResult,
  type StaticDeploymentSnapshot,
  type StaticDeploymentState,
  type StaticGenerationHost,
  type StaticMigrationExecutor,
  type StaticRealtimeConvergence,
  type VerifiedStaticApplicationBuild
} from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/extensions/valid/static-composition-change-plan.json", import.meta.url), "utf8")) as StaticCompositionChangePlan;
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const blue: StaticApplicationGeneration = {
  generationId: "customer-alpha-blue-8",
  sourceCommit: fixture.base.sourceCommit,
  compositionChangePlanDigest: digest("1"),
  buildEvidenceDigest: digest("2"),
  applicationDigest: fixture.migration.rollbackWindow.state === "open" ? fixture.migration.rollbackWindow.previousApplicationDigest : digest("3"),
  imageDigest: digest("4"),
  imageReference: `k-nex/customer-alpha@${digest("4")}`,
  migrationRevision: fixture.migration.baseRevision
};
const owner = { applicationId: fixture.applicationId, environment: fixture.environment };
const snapshot = (active = blue, rollback?: StaticApplicationGeneration, revision = 0): StaticDeploymentSnapshot => ({
  ...owner,
  revision,
  active,
  ...(rollback ? { rollback } : {}),
  rollbackWindow: rollback ? fixture.migration.rollbackWindow : { state: "not-applicable", contractCleanup: "blocked" },
  stateDigest: digest("5")
});
const fence = (generationId: string, fencingToken: number, revision: number): WorkerGenerationFence => ({
  schemaVersion: 1,
  ...owner,
  activeExecutionGeneration: generationId,
  fencingToken,
  lease: { owner: "worker:phase-9", expiresAt: "2026-08-29T12:30:00.000Z" },
  promotionRevision: revision,
  mode: "active"
});

function trustedBuild(change = fixture): Readonly<{ authority: TrustedStaticApplicationBuildAuthority; token: VerifiedStaticApplicationBuild; evidence: TrustedApplicationBuildEvidence; result: StaticCompositionChangeResult }> {
  const keys = generateKeyPairSync("ed25519");
  const statement = {
    schemaVersion: 1 as const,
    applicationId: change.applicationId,
    environment: change.environment,
    sourceCommit: change.target.sourceCommit,
    authority: { kind: "self-hosted-trusted" as const, builderIdentity: "builder:k-nex-phase-9", trustPolicyDigest: digest("6"), ref: "source-commit" as const },
    composition: change.target.composition,
    sbomDigest: digest("7"),
    provenanceDigest: digest("8"),
    applicationSubject: { name: "customer-alpha-application.tar.gz", digest: change.target.applicationSubjectDigest },
    imageSubject: { repository: "k-nex/customer-alpha", digest: change.target.imageSubjectDigest }
  };
  const evidence = {
    ...statement,
    signature: { algorithm: "ed25519" as const, keyId: "builder:k-nex-phase-9", value: sign(null, Buffer.from(canonicalJson(statement)), keys.privateKey).toString("base64") }
  };
  const result: StaticCompositionChangeResult = { status: "source-change-ready", planDigest: digest("9"), targetSourceCommit: change.target.sourceCommit, change };
  const authority = new TrustedStaticApplicationBuildAuthority({
    "builder:k-nex-phase-9": { publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), authority: statement.authority }
  });
  return { authority, token: authority.verify(result, evidence), evidence, result };
}

function harness(build = trustedBuild(), now = new Date("2026-08-29T12:00:00.000Z")) {
  const events: string[] = [];
  const green: StaticApplicationGeneration = {
    generationId: "customer-alpha-green-9",
    sourceCommit: fixture.target.sourceCommit,
    compositionChangePlanDigest: digest("a"),
    buildEvidenceDigest: digest("b"),
    applicationDigest: fixture.target.applicationSubjectDigest,
    imageDigest: fixture.target.imageSubjectDigest,
    imageReference: `k-nex/customer-alpha@${fixture.target.imageSubjectDigest}`,
    migrationRevision: fixture.migration.targetRevision
  };
  const receipt = { revisionAfter: 1 } as StaticDeploymentReceipt;
  let current = snapshot();
  const checkpoint = (kind: "promote" | "rollback" | "retire-rollback", activeGenerationId: string, previousGenerationId: string, revision: number) => ({ kind, activeGenerationId, previousGenerationId, revision, completedSteps: [] as const });
  const state: StaticDeploymentState = {
    read: vi.fn(async () => current),
    readFence: vi.fn().mockResolvedValueOnce(fence(blue.generationId, 4, 0)).mockResolvedValue(fence(green.generationId, 5, 1)),
    promote: vi.fn(async () => { events.push("promote"); current = { ...snapshot(green, blue, 1), transitionCheckpoint: checkpoint("promote", green.generationId, blue.generationId, 1) }; return receipt; }),
    rollback: vi.fn(async () => { events.push("rollback"); current = { ...snapshot(blue, green, 2), transitionCheckpoint: checkpoint("rollback", blue.generationId, green.generationId, 2) }; return receipt; }),
    reserveRollbackRetirement: vi.fn(async () => { const retained = current.rollback ?? blue; events.push("reserve-retirement"); current = { ...snapshot(current.active, retained, current.revision + 1), rollbackWindow: { state: "retirement-reserved" }, transitionCheckpoint: checkpoint("retire-rollback", current.active.generationId, retained.generationId, current.revision + 1) }; return { revisionAfter: current.revision } as StaticDeploymentReceipt; }),
    closeRollback: vi.fn(async () => { events.push("close-rollback"); return receipt; }),
    completeTransitionStep: vi.fn(async () => undefined),
    assertContractCleanup: vi.fn(async () => undefined)
  };
  const artifacts: StaticApplicationArtifactProvider = {
    resolve: vi.fn(async () => ({
      imageReference: `${build.evidence.imageSubject.repository}@${build.evidence.imageSubject.digest}`,
      applicationDigest: build.evidence.applicationSubject.digest,
      imageDigest: build.evidence.imageSubject.digest,
      runtimeImageDigest: build.evidence.imageSubject.digest
    })),
    reverify: vi.fn(async (generation) => ({
      imageReference: `${build.evidence.imageSubject.repository}@${generation.imageDigest}`,
      applicationDigest: generation.applicationDigest,
      imageDigest: generation.imageDigest,
      runtimeImageDigest: generation.imageDigest
    }))
  };
  const migrations: StaticMigrationExecutor = {
    runOnline: vi.fn(async () => { events.push("migrate"); return fixture.migration.steps.filter((step) => step.phase !== "post-retirement-contract" && step.phase !== "offline-required").map((step) => step.stepId); }),
    runPostRetirement: vi.fn(async () => [])
  };
  const generations: StaticGenerationHost = {
    start: vi.fn(async () => { events.push("start-passive"); }),
    readiness: vi.fn(async (input) => ({ ...input, publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true, workerMode: "passive", gatewayCapacity: true, realtimeReady: true, observedAt: "2026-08-29T12:00:00.000Z" })),
    activateWorker: vi.fn(async () => { events.push("activate-worker"); }),
    drain: vi.fn(async () => { events.push("drain-blue"); }),
    retire: vi.fn(async () => { events.push("retire-green"); })
  };
  const gateway: GatewayTrafficRouter = { converge: vi.fn(async () => { events.push("route-green"); }) };
  const realtime: StaticRealtimeConvergence = { reconnectAndResync: vi.fn(async () => { events.push("realtime-resync"); }) };
  return { build, blue, green, events, state, artifacts, migrations, generations, gateway, realtime, supervisor: new DeploymentSupervisor(build.authority, artifacts, migrations, generations, state, gateway, realtime, { now: () => now }) };
}

describe("static deployment supervisor", () => {
  it("promotes only an attested immutable image after online migration and passive readiness", async () => {
    const value = harness();
    await expect(value.supervisor.deploy({ build: value.build.token, generationId: "customer-alpha-green-9", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .resolves.toMatchObject({ outcome: "promoted" });
    expect(value.events).toEqual(["migrate", "start-passive", "promote", "activate-worker", "route-green", "realtime-resync", "drain-blue"]);
    expect(value.state.promote).toHaveBeenCalledWith(expect.objectContaining({ build: value.build.token, expectedFenceToken: 4, expectedRevision: 0 }));
  });

  it("rejects a runtime image mismatch before migrations or generation-host work", async () => {
    const value = harness();
    vi.mocked(value.artifacts.resolve).mockResolvedValueOnce({
      imageReference: `${value.build.evidence.imageSubject.repository}@${value.build.evidence.imageSubject.digest}`,
      applicationDigest: value.build.evidence.applicationSubject.digest,
      imageDigest: value.build.evidence.imageSubject.digest,
      runtimeImageDigest: digest("0")
    });

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: "customer-alpha-green-9", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .rejects.toMatchObject({ code: "ARTIFACT_MISMATCH" });
    expect(value.migrations.runOnline).not.toHaveBeenCalled();
    expect(value.generations.start).not.toHaveBeenCalled();
    expect(value.generations.readiness).not.toHaveBeenCalled();
    expect(value.generations.activateWorker).not.toHaveBeenCalled();
    expect(value.generations.drain).not.toHaveBeenCalled();
    expect(value.generations.retire).not.toHaveBeenCalled();
  });

  it("returns maintenance-required before resolving artifacts, migrations, or green containers", async () => {
    const build = trustedBuild({ ...fixture, migration: { ...fixture.migration, steps: [{ stepId: "migration-offline-9", phase: "offline-required", migrationDigest: digest("c"), availability: "maintenance-required" }] } });
    const value = harness(build);
    await expect(value.supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-9", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .resolves.toEqual({ outcome: "maintenance-required", reasons: ["offline-migration"] });
    expect(value.artifacts.resolve).not.toHaveBeenCalled();
    expect(value.generations.start).not.toHaveBeenCalled();
    expect(value.gateway.converge).not.toHaveBeenCalled();
  });

  it.each([
    ["does not retain the active application digest", { previousApplicationDigest: digest("0") }],
    ["has already expired", { closesAt: "2026-08-29T11:59:59.999Z" }]
  ])("rejects a rollback window that %s before migrations or generation-host work", async (_reason, override) => {
    const build = trustedBuild({
      ...fixture,
      migration: {
        ...fixture.migration,
        rollbackWindow: { ...fixture.migration.rollbackWindow, ...override }
      }
    });
    const value = harness(build);

    await expect(value.supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-9", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .rejects.toMatchObject({ code: "READINESS_REJECTED" });
    expect(value.artifacts.resolve).not.toHaveBeenCalled();
    expect(value.migrations.runOnline).not.toHaveBeenCalled();
    expect(value.generations.start).not.toHaveBeenCalled();
    expect(value.generations.readiness).not.toHaveBeenCalled();
    expect(value.state.promote).not.toHaveBeenCalled();
  });

  it("keeps blue traffic authoritative when green readiness fails", async () => {
    const value = harness();
    vi.mocked(value.generations.readiness).mockRejectedValueOnce(new Error("green failed"));
    await expect(value.supervisor.deploy({ build: value.build.token, generationId: "customer-alpha-green-9", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toThrow("green failed");
    expect(value.state.promote).not.toHaveBeenCalled();
    expect(value.gateway.converge).not.toHaveBeenCalled();
    expect(value.events).toEqual(["migrate", "start-passive", "retire-green"]);
  });

  it("retires a ready passive target when promotion rejects without committing it", async () => {
    const value = harness();
    const failure = new Error("promotion rejected");
    vi.mocked(value.state.promote).mockRejectedValueOnce(failure);

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toBe(failure);
    expect(value.generations.retire).toHaveBeenCalledWith(value.green.generationId);
    expect(value.events).toEqual(["migrate", "start-passive", "retire-green"]);
  });

  it.each([
    ["active", (value: ReturnType<typeof harness>) => snapshot(value.green, value.blue, 1)],
    ["retained", (value: ReturnType<typeof harness>) => snapshot(value.blue, value.green, 1)]
  ])("keeps a target that a concurrent promotion already committed as %s", async (_state, committed) => {
    const value = harness();
    const failure = new Error("stale promotion revision");
    vi.mocked(value.state.promote).mockImplementationOnce(async () => {
      vi.mocked(value.state.read).mockResolvedValue(committed(value));
      throw failure;
    });

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toBe(failure);
    expect(value.generations.retire).not.toHaveBeenCalled();
  });

  it("preserves a promotion error when passive-target retirement fails after reconciliation", async () => {
    const value = harness();
    const promotionFailure = new Error("promotion rejected");
    vi.mocked(value.state.promote).mockRejectedValueOnce(promotionFailure);
    vi.mocked(value.generations.retire).mockRejectedValueOnce(new Error("retirement unavailable"));

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toBe(promotionFailure);
    expect(value.generations.retire).toHaveBeenCalledWith(value.green.generationId);
  });

  it("preserves a promotion error without retiring when authoritative reconciliation fails", async () => {
    const value = harness();
    const promotionFailure = new Error("promotion rejected");
    vi.mocked(value.state.promote).mockRejectedValueOnce(promotionFailure);
    vi.mocked(value.state.read).mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error("state unavailable"));

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toBe(promotionFailure);
    expect(value.generations.retire).not.toHaveBeenCalled();
  });

  it("reverifies, starts, and freshly proves the retained immutable generation before static rollback state can switch", async () => {
    const value = harness();
    vi.mocked(value.state.read).mockResolvedValue(snapshot(value.green, value.blue, 1));
    vi.mocked(value.state.readFence).mockReset().mockResolvedValueOnce(fence(value.green.generationId, 5, 1)).mockResolvedValue(fence(value.blue.generationId, 6, 2));
    vi.mocked(value.state.rollback).mockImplementationOnce(async () => {
      expect(value.generations.readiness).toHaveBeenCalledOnce();
      value.events.push("rollback");
      return { revisionAfter: 2 } as StaticDeploymentReceipt;
    });
    vi.mocked(value.state.read).mockResolvedValueOnce(snapshot(value.green, value.blue, 1)).mockResolvedValue({
      ...snapshot(value.blue, value.green, 2),
      transitionCheckpoint: { kind: "rollback", activeGenerationId: value.blue.generationId, previousGenerationId: value.green.generationId, revision: 2, completedSteps: [] }
    });
    await expect(value.supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .resolves.toMatchObject({ revisionAfter: 2 });
    expect(value.artifacts.reverify).toHaveBeenCalledWith(value.blue);
    expect(value.generations.start).toHaveBeenCalledWith(expect.objectContaining({ generationId: value.blue.generationId, workerMode: "passive" }));
    expect(value.state.rollback).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, expectedFenceToken: 5 }));
    expect(value.events).toEqual(["start-passive", "rollback", "activate-worker", "route-green", "realtime-resync", "drain-blue"]);
  });

  it("keeps the static pointer unchanged when retained artifact or readiness proof fails", async () => {
    const value = harness();
    vi.mocked(value.state.read).mockResolvedValue(snapshot(value.green, value.blue, 1));
    vi.mocked(value.state.readFence).mockResolvedValue(fence(value.green.generationId, 5, 1));
    vi.mocked(value.artifacts.reverify).mockResolvedValueOnce({ imageReference: "wrong", applicationDigest: digest("0"), imageDigest: value.blue.imageDigest, runtimeImageDigest: value.blue.imageDigest });
    await expect(value.supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toMatchObject({ code: "ARTIFACT_MISMATCH" });
    expect(value.state.rollback).not.toHaveBeenCalled();

    vi.mocked(value.artifacts.reverify).mockResolvedValueOnce({ imageReference: value.blue.imageReference, applicationDigest: value.blue.applicationDigest, imageDigest: value.blue.imageDigest, runtimeImageDigest: value.blue.imageDigest });
    vi.mocked(value.generations.readiness).mockResolvedValueOnce({
      generationId: value.blue.generationId, sourceCommit: value.blue.sourceCommit, applicationDigest: value.blue.applicationDigest, imageDigest: value.blue.imageDigest,
      migrationRevision: value.blue.migrationRevision, completedMigrationSteps: [], publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true,
      workerMode: "passive", gatewayCapacity: false, realtimeReady: true, observedAt: "2026-08-29T12:00:00.000Z"
    });
    await expect(value.supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toMatchObject({ code: "READINESS_REJECTED" });
    expect(value.state.rollback).not.toHaveBeenCalled();
  });

  it("rejects a retained artifact that resolves its attested digest through a mutable image reference", async () => {
    const value = harness();
    vi.mocked(value.state.read).mockResolvedValue(snapshot(value.green, value.blue, 1));
    vi.mocked(value.state.readFence).mockResolvedValue(fence(value.green.generationId, 5, 1));
    vi.mocked(value.artifacts.reverify).mockResolvedValueOnce({
      imageReference: "attacker:latest",
      applicationDigest: value.blue.applicationDigest,
      imageDigest: value.blue.imageDigest,
      runtimeImageDigest: value.blue.imageDigest
    });

    await expect(value.supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .rejects.toMatchObject({ code: "ARTIFACT_MISMATCH" });
    expect(value.generations.start).not.toHaveBeenCalled();
    expect(value.state.rollback).not.toHaveBeenCalled();
  });

  it("atomically reserves the retained inactive generation before draining it", async () => {
    const value = harness();
    const open = snapshot(value.green, value.blue, 1);
    const reserved = {
      ...snapshot(value.green, value.blue, 2), rollbackWindow: { state: "retirement-reserved" },
      transitionCheckpoint: { kind: "retire-rollback" as const, activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 2, completedSteps: [] }
    };
    vi.mocked(value.state.read).mockResolvedValueOnce(open).mockResolvedValue(reserved);
    await value.supervisor.closeRollback(owner);
    expect(value.state.reserveRollbackRetirement).toHaveBeenCalledWith({ ...owner, expectedRevision: 1, retiredGenerationId: value.blue.generationId });
    expect(value.events).toEqual(["reserve-retirement", "drain-blue", "retire-green", "close-rollback"]);
  });

  it("recovery idempotently finishes every post-commit promotion step", async () => {
    const value = harness();
    vi.mocked(value.state.read).mockResolvedValue({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: { kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1, completedSteps: [] }
    });
    vi.mocked(value.state.readFence).mockResolvedValue(fence(value.green.generationId, 5, 1));
    await value.supervisor.recover(owner);
    expect(value.events).toEqual(["activate-worker", "route-green", "realtime-resync", "drain-blue"]);
    expect(value.state.completeTransitionStep).toHaveBeenCalledTimes(4);
  });

  it("restores active worker and gateway authority after a settled process restart", async () => {
    const value = harness();
    vi.mocked(value.state.read).mockResolvedValue(snapshot(value.green, value.blue, 1));
    vi.mocked(value.state.readFence).mockResolvedValue(fence(value.green.generationId, 5, 1));
    await value.supervisor.recover(owner);
    expect(value.events).toEqual(["activate-worker", "route-green"]);
  });

  it("never drains a retained generation that became active during retirement recovery", async () => {
    const value = harness();
    vi.mocked(value.state.read).mockResolvedValue({
      ...snapshot(value.blue, value.green, 2), rollbackWindow: { state: "retirement-reserved" },
      transitionCheckpoint: { kind: "retire-rollback", activeGenerationId: value.blue.generationId, previousGenerationId: value.blue.generationId, revision: 2, completedSteps: [] }
    });
    await expect(value.supervisor.recover(owner)).rejects.toMatchObject({ code: "STATE_UNAVAILABLE" });
    expect(value.generations.drain).not.toHaveBeenCalled();
    expect(value.generations.retire).not.toHaveBeenCalled();
  });
});
