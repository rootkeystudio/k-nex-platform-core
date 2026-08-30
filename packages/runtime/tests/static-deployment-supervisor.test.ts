import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson, type StaticCompositionChangePlan, type StaticDeploymentReceipt, type TrustedApplicationBuildEvidence, type WorkerGenerationFence } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  DeploymentSupervisor,
  StaticDeploymentEffectNotDispatchedError,
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
  const rejectedReservation = {
    ...owner,
    generationId: green.generationId,
    reservationId: "11111111-1111-4111-8111-111111111111",
    reservedAt: "2026-08-29T12:00:00.000Z"
  };
  const retainedReservation = { ...rejectedReservation, generationId: blue.generationId, reservationId: "22222222-2222-4222-8222-222222222222" };
  let current = snapshot();
  let workerHealthy = false;
  const checkpoint = (kind: "promote" | "rollback" | "retire-rollback", activeGenerationId: string, previousGenerationId: string, revision: number) => ({ kind, activeGenerationId, previousGenerationId, revision, completedSteps: [] as const });
  let pendingRecovery: Awaited<ReturnType<StaticDeploymentState["readWorkerRecoveryActivation"]>>;
  const recoveryTicket = () => ({ ...owner, generationId: current.active.generationId, revision: current.revision, fencingToken: 5, promotionRevision: 1, leaseOwner: "worker:phase-9", executionLeaseDurationMs: 1_000, recoveryId: "33333333-3333-4333-8333-333333333333", recoveryExpiresAt: "2026-08-29T12:01:00.000Z" } as const);
  const state: StaticDeploymentState = {
    read: vi.fn(async () => current),
    readFence: vi.fn().mockResolvedValueOnce(fence(blue.generationId, 4, 0)).mockResolvedValue(fence(green.generationId, 5, 1)),
    isWorkerFenceLive: vi.fn(async () => true),
    promote: vi.fn(async () => { events.push("promote"); current = { ...snapshot(green, blue, 1), transitionCheckpoint: checkpoint("promote", green.generationId, blue.generationId, 1) }; return receipt; }),
    rollback: vi.fn(async () => { events.push("rollback"); current = { ...snapshot(blue, green, 2), transitionCheckpoint: checkpoint("rollback", blue.generationId, green.generationId, 2) }; return { revisionAfter: 2 } as StaticDeploymentReceipt; }),
    reserveRollbackRetirement: vi.fn(async () => {
      const pending = current.transitionCheckpoint;
      const required = pending?.kind === "retire-rollback" ? 2 : 4;
      if (pending && pending.completedSteps.length !== required) throw Object.assign(new Error("incomplete transition checkpoint"), { code: "REVISION_CONFLICT" });
      const retained = current.rollback ?? blue; events.push("reserve-retirement"); current = { ...snapshot(current.active, retained, current.revision + 1), rollbackWindow: { state: "retirement-reserved" }, transitionCheckpoint: checkpoint("retire-rollback", current.active.generationId, retained.generationId, current.revision + 1) }; return { ...retainedReservation, generationId: retained.generationId };
    }),
    reserveGenerationRetirement: vi.fn(async ({ generationId }) => {
      if (current.active.generationId === generationId || current.rollback?.generationId === generationId) return undefined;
      events.push("reserve-rejected");
      return { ...rejectedReservation, generationId };
    }),
    readGenerationRetirement: vi.fn(async ({ generationId }) => generationId === (current.rollback?.generationId ?? "") ? { ...retainedReservation, generationId } : undefined),
    listPendingGenerationRetirements: vi.fn(async () => []),
    completeGenerationRetirement: vi.fn(async () => { events.push("complete-rejected"); }),
    closeRollback: vi.fn(async () => { events.push("close-rollback"); return receipt; }),
    reserveTransitionStep: vi.fn(async ({ expectedRevision, step, reservationId }) => {
      const transition = current.transitionCheckpoint!;
      const reservationExpiresAt = "2026-08-29T12:01:00.000Z";
      current = { ...current, transitionCheckpoint: { ...transition, reservedStep: step, reservationId, reservationExpiresAt } };
      return { ...owner, generationId: ["activate-worker", "converge-gateway", "reconnect-realtime"].includes(step) ? transition.activeGenerationId : transition.previousGenerationId, activeGenerationId: transition.activeGenerationId, revision: expectedRevision, fencingToken: 5, promotionRevision: 1, leaseOwner: "worker:phase-9", checkpointKind: transition.kind, step, reservationId, reservationExpiresAt };
    }),
    releaseTransitionStep: vi.fn(async (ticket) => {
      const transition = current.transitionCheckpoint!;
      if (transition.reservedStep === ticket.step) {
        const { reservedStep: _reservedStep, reservationId: _reservationId, reservationExpiresAt: _reservationExpiresAt, ...unreserved } = transition;
        current = { ...current, transitionCheckpoint: unreserved };
      }
    }),
    completeTransitionStep: vi.fn(async (ticket) => {
      const transition = current.transitionCheckpoint!;
      const { reservedStep: _reservedStep, reservationId: _reservationId, reservationExpiresAt: _reservationExpiresAt, ...unreserved } = transition;
      current = { ...current, transitionCheckpoint: { ...unreserved, completedSteps: [...transition.completedSteps, ticket.step] } };
    }),
    assertTransitionTicket: vi.fn(async () => undefined),
    reserveWorkerRecoveryActivation: vi.fn(async () => pendingRecovery ??= recoveryTicket()),
    readWorkerRecoveryActivation: vi.fn(async () => pendingRecovery),
    expireWorkerRecoveryActivation: vi.fn(async () => false),
    completeWorkerRecoveryActivation: vi.fn(async () => { pendingRecovery = undefined; }),
    assertWorkerRecoveryActivation: vi.fn(async () => undefined),
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
    activateWorker: vi.fn(async () => { workerHealthy = true; events.push("activate-worker"); }),
    hasHealthyActiveWorker: vi.fn(async () => workerHealthy),
    recoverActiveWorker: vi.fn(async () => { workerHealthy = true; events.push("recover-active-worker"); }),
    drain: vi.fn(async () => { events.push("drain-blue"); }),
    retire: vi.fn(async () => { events.push("retire-green"); })
  };
  const gateway: GatewayTrafficRouter = { converge: vi.fn(async () => { events.push("route-green"); }) };
  const realtime: StaticRealtimeConvergence = { reconnectAndResync: vi.fn(async () => { events.push("realtime-resync"); }) };
  return { build, blue, green, rejectedReservation, events, state, artifacts, migrations, generations, gateway, realtime, setCurrent: (next: StaticDeploymentSnapshot) => { current = next; }, setWorkerHealthy: (healthy: boolean) => { workerHealthy = healthy; }, supervisor: new DeploymentSupervisor(build.authority, artifacts, migrations, generations, state, gateway, realtime, { now: () => now }) };
}

describe("static deployment supervisor", () => {
  it("leaves a settled healthy exact worker untouched during recovery", async () => {
    const value = harness();
    vi.mocked(value.generations.hasHealthyActiveWorker).mockResolvedValue(true);
    await value.supervisor.recover(owner);
    expect(value.state.reserveWorkerRecoveryActivation).not.toHaveBeenCalled();
    expect(value.generations.recoverActiveWorker).not.toHaveBeenCalled();
  });

  it("rechecks the exact fence after the host health probe before taking the no-op path", async () => {
    const value = harness();
    vi.mocked(value.generations.hasHealthyActiveWorker).mockResolvedValueOnce(true);
    vi.mocked(value.state.isWorkerFenceLive).mockResolvedValueOnce(false);
    await value.supervisor.recover(owner);
    expect(value.generations.hasHealthyActiveWorker.mock.invocationCallOrder[0]).toBeLessThan(value.state.isWorkerFenceLive.mock.invocationCallOrder[0]!);
    expect(value.state.reserveWorkerRecoveryActivation).toHaveBeenCalledOnce();
  });

  it("keeps a recovery activation ticket durable when its accepted host response is lost", async () => {
    const value = harness();
    vi.mocked(value.generations.recoverActiveWorker).mockRejectedValueOnce(new Error("activation response lost"));
    vi.mocked(value.generations.hasHealthyActiveWorker).mockResolvedValueOnce(false).mockResolvedValue(true);

    await expect(value.supervisor.recover(owner)).rejects.toThrow("activation response lost");
    expect(value.state.completeWorkerRecoveryActivation).not.toHaveBeenCalled();

    await value.supervisor.recover(owner);
    expect(value.state.reserveWorkerRecoveryActivation).toHaveBeenCalledTimes(1);
    expect(value.state.completeWorkerRecoveryActivation).toHaveBeenCalledTimes(1);
  });

  it("expires a response-lost recovery claim before a healthy late restart takes the no-op path", async () => {
    const value = harness();
    vi.mocked(value.state.expireWorkerRecoveryActivation).mockResolvedValueOnce(true);
    vi.mocked(value.generations.hasHealthyActiveWorker).mockResolvedValue(true);

    await value.supervisor.recover(owner);

    expect(value.state.expireWorkerRecoveryActivation).toHaveBeenCalled();
    expect(value.state.reserveWorkerRecoveryActivation).not.toHaveBeenCalled();
  });

  it("recovers an activated worker before later post-commit steps continue", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: {
        kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1,
        completedSteps: ["activate-worker"]
      }
    });

    await value.supervisor.recover(owner);

    expect(value.events).toEqual(["recover-active-worker", "route-green", "realtime-resync", "drain-blue"]);
  });

  it("rechecks worker liveness after post-commit steps close a probe-to-finish race", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: {
        kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1,
        completedSteps: ["activate-worker"]
      }
    });
    vi.mocked(value.generations.hasHealthyActiveWorker).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await value.supervisor.recover(owner);

    expect(value.events).toEqual(["route-green", "realtime-resync", "drain-blue", "recover-active-worker"]);
  });

  it("promotes only an attested immutable image after online migration and passive readiness", async () => {
    const value = harness();
    await expect(value.supervisor.deploy({ build: value.build.token, generationId: "customer-alpha-green-9", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .resolves.toMatchObject({ outcome: "promoted" });
    expect(value.events).toEqual(["migrate", "start-passive", "promote", "activate-worker", "route-green", "realtime-resync", "drain-blue"]);
    expect(value.state.promote).toHaveBeenCalledWith(expect.objectContaining({ build: value.build.token, expectedFenceToken: 4, expectedRevision: 0 }));
  });

  it("recovers a worker that dies during successful deploy post-commit steps before returning", async () => {
    const value = harness();
    vi.mocked(value.gateway.converge).mockImplementationOnce(async () => { value.events.push("route-green"); value.setWorkerHealthy(false); });

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: "customer-alpha-green-9", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .resolves.toMatchObject({ outcome: "promoted" });

    expect(value.events).toEqual(["migrate", "start-passive", "promote", "activate-worker", "route-green", "realtime-resync", "drain-blue", "recover-active-worker"]);
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

  it.each(["reserved", "completed"])('rejects a %s generation retirement tombstone before migrations or target work', async (state) => {
    const value = harness();
    vi.mocked(value.state.readGenerationRetirement).mockResolvedValueOnce({
      ...value.rejectedReservation,
      ...(state === "completed" ? { completedAt: "2026-08-29T12:01:00.000Z" } : {})
    });

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .rejects.toMatchObject({ code: "STATE_UNAVAILABLE" });
    expect(value.migrations.runOnline).not.toHaveBeenCalled();
    expect(value.generations.start).not.toHaveBeenCalled();
    expect(value.generations.readiness).not.toHaveBeenCalled();
    expect(value.state.promote).not.toHaveBeenCalled();
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
    expect(value.events).toEqual(["migrate", "start-passive", "reserve-rejected", "retire-green", "complete-rejected"]);
  });

  it("retires a ready passive target when promotion rejects without committing it", async () => {
    const value = harness();
    const failure = new Error("promotion rejected");
    vi.mocked(value.state.promote).mockRejectedValueOnce(failure);

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toBe(failure);
    expect(value.state.reserveGenerationRetirement).toHaveBeenCalledWith({ ...owner, generationId: value.green.generationId });
    expect(value.generations.retire).toHaveBeenCalledWith({ reservation: value.rejectedReservation });
    expect(value.state.completeGenerationRetirement).toHaveBeenCalledWith(value.rejectedReservation);
    expect(value.events).toEqual(["migrate", "start-passive", "reserve-rejected", "retire-green", "complete-rejected"]);
  });

  it.each([
    ["active", (value: ReturnType<typeof harness>) => snapshot(value.green, value.blue, 1)],
    ["retained", (value: ReturnType<typeof harness>) => snapshot(value.blue, value.green, 1)]
  ])("keeps a target that a concurrent promotion already committed as %s", async (_state, committed) => {
    const value = harness();
    const failure = new Error("stale promotion revision");
    const protectedState = committed(value);
    expect([protectedState.active.generationId, protectedState.rollback?.generationId]).toContain(value.green.generationId);
    vi.mocked(value.state.promote).mockImplementationOnce(async () => {
      vi.mocked(value.state.reserveGenerationRetirement).mockResolvedValueOnce(undefined);
      throw failure;
    });

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toBe(failure);
    expect(value.generations.retire).not.toHaveBeenCalled();
  });

  it("preserves a promotion error when passive-target retirement fails after reconciliation", async () => {
    const value = harness();
    const promotionFailure = Object.assign(new Error("promotion rejected"), { code: "REVISION_CONFLICT", status: 409 });
    vi.mocked(value.state.promote).mockRejectedValueOnce(promotionFailure);
    vi.mocked(value.generations.retire).mockRejectedValueOnce(new Error("retirement unavailable"));

    try {
      await value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" });
      expect.unreachable("promotion must preserve its primary error");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error).toMatchObject({ message: "promotion rejected", code: "REVISION_CONFLICT", status: 409, cause: promotionFailure });
      expect((error as AggregateError).errors).toEqual([promotionFailure, expect.objectContaining({ message: "retirement unavailable" })]);
    }
    expect(value.generations.retire).toHaveBeenCalledWith({ reservation: value.rejectedReservation });
    expect(value.state.completeGenerationRetirement).not.toHaveBeenCalled();
  });

  it("never recreates a completed generation identity", async () => {
    const value = harness();
    const completed = { ...value.rejectedReservation, completedAt: "2026-08-29T12:01:00.000Z" };
    vi.mocked(value.state.readGenerationRetirement).mockResolvedValueOnce(completed);

    await expect(value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toMatchObject({ code: "STATE_UNAVAILABLE" });
    expect(value.migrations.runOnline).not.toHaveBeenCalled();
    expect(value.generations.start).not.toHaveBeenCalled();
    expect(value.state.promote).not.toHaveBeenCalled();
  });

  it("surfaces durable retirement reservation failure alongside the promotion error", async () => {
    const value = harness();
    const promotionFailure = new Error("promotion rejected");
    vi.mocked(value.state.promote).mockRejectedValueOnce(promotionFailure);
    vi.mocked(value.state.reserveGenerationRetirement).mockRejectedValueOnce(new Error("state unavailable"));

    try {
      await value.supervisor.deploy({ build: value.build.token, generationId: value.green.generationId, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" });
      expect.unreachable("promotion must preserve its primary error");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error).toMatchObject({ message: "promotion rejected", cause: promotionFailure });
      expect((error as AggregateError).errors).toEqual([promotionFailure, expect.objectContaining({ message: "state unavailable" })]);
    }
    expect(value.generations.retire).not.toHaveBeenCalled();
  });

  it("reverifies, starts, and freshly proves the retained immutable generation before static rollback state can switch", async () => {
    const value = harness();
    value.setCurrent(snapshot(value.green, value.blue, 1));
    vi.mocked(value.state.readFence).mockReset().mockResolvedValueOnce(fence(value.green.generationId, 5, 1)).mockResolvedValue(fence(value.blue.generationId, 6, 2));
    vi.mocked(value.gateway.converge).mockImplementationOnce(async () => { value.events.push("route-green"); value.setWorkerHealthy(false); });
    await expect(value.supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .resolves.toMatchObject({ revisionAfter: 2 });
    expect(value.artifacts.reverify).toHaveBeenCalledWith(value.blue);
    expect(value.generations.start).toHaveBeenCalledWith(expect.objectContaining({ generationId: value.blue.generationId, workerMode: "passive" }));
    expect(value.state.rollback).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, expectedFenceToken: 5 }));
    expect(value.events).toEqual(["start-passive", "rollback", "activate-worker", "route-green", "realtime-resync", "drain-blue", "recover-active-worker"]);
  });

  it("keeps the pointer and retained rollback target when artifact or readiness proof fails", async () => {
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
    expect(value.state.reserveGenerationRetirement).not.toHaveBeenCalled();
    expect(value.generations.retire).not.toHaveBeenCalled();
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
    value.setCurrent(open);
    await value.supervisor.closeRollback(owner);
    expect(value.state.reserveRollbackRetirement).toHaveBeenCalledWith({ ...owner, expectedRevision: 1, retiredGenerationId: value.blue.generationId });
    expect(value.events).toEqual(["reserve-retirement", "drain-blue", "retire-green", "complete-rejected", "close-rollback"]);
  });

  it("finishes a partially promoted gateway transition before reserving rollback retirement", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: { kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1, completedSteps: ["activate-worker"] }
    });
    await value.supervisor.closeRollback(owner);
    expect(value.events).toEqual(["route-green", "realtime-resync", "drain-blue", "reserve-retirement", "drain-blue", "retire-green", "complete-rejected", "close-rollback"]);
  });

  it("recovery idempotently finishes every post-commit promotion step", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: { kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1, completedSteps: [] }
    });
    vi.mocked(value.state.readFence).mockResolvedValue(fence(value.green.generationId, 5, 1));
    await value.supervisor.recover(owner);
    expect(value.events).toEqual(["activate-worker", "route-green", "realtime-resync", "drain-blue"]);
    expect(value.state.completeTransitionStep).toHaveBeenCalledTimes(4);
  });

  it("does not drain a generation made active while a stale supervisor is paused", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: { kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1, completedSteps: ["activate-worker", "converge-gateway", "reconnect-realtime"] }
    });
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.mocked(value.state.reserveTransitionStep).mockImplementationOnce(async () => {
      arrived.resolve();
      await release.promise;
      throw Object.assign(new Error("stale deployment revision"), { code: "REVISION_CONFLICT" });
    });
    const stale = value.supervisor.recover(owner);
    await arrived.promise;
    value.setCurrent({
      ...snapshot(value.blue, value.green, 2),
      transitionCheckpoint: { kind: "rollback", activeGenerationId: value.blue.generationId, previousGenerationId: value.green.generationId, revision: 2, completedSteps: [] }
    });
    release.resolve();
    await expect(stale).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(value.generations.drain).not.toHaveBeenCalled();
    expect(value.generations.retire).not.toHaveBeenCalled();
  });

  it("bounds live transition-claim retries even when the authority clock is fixed", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: {
        kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1,
        completedSteps: ["activate-worker", "converge-gateway", "reconnect-realtime"], reservedStep: "drain-previous",
        reservationId: "12345678-1234-4abc-8def-123456789abc", reservationExpiresAt: "2026-08-29T12:01:00.000Z"
      }
    });
    const waiter = { wait: vi.fn(async () => undefined) };
    const supervisor = new DeploymentSupervisor(value.build.authority, value.artifacts, value.migrations, value.generations, value.state, value.gateway, value.realtime, { now: () => new Date("2026-08-29T12:00:00.000Z") }, waiter);
    vi.mocked(value.state.reserveTransitionStep).mockRejectedValue(new Error("live claim"));

    await expect(supervisor.recover(owner)).rejects.toThrow("live claim");
    expect(value.state.reserveTransitionStep).toHaveBeenCalledTimes(71);
    expect(waiter.wait).toHaveBeenCalledTimes(70);
  });

  it("replays the same durable transition reservation after a lost reserve response", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: { kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1, completedSteps: ["activate-worker", "converge-gateway", "reconnect-realtime"] }
    });
    const waiter = { wait: vi.fn(async () => undefined) };
    const supervisor = new DeploymentSupervisor(value.build.authority, value.artifacts, value.migrations, value.generations, value.state, value.gateway, value.realtime, { now: () => new Date("2026-08-29T12:00:00.000Z") }, waiter);
    vi.mocked(value.state.reserveTransitionStep).mockImplementationOnce(async (input) => {
      const current = await value.state.read(owner);
      value.setCurrent({ ...current!, transitionCheckpoint: { ...current!.transitionCheckpoint!, reservedStep: input.step, reservationId: input.reservationId, reservationExpiresAt: "2026-08-29T12:01:00.000Z" } });
      throw new Error("reserve response lost");
    });

    await supervisor.recover(owner);

    const reservationIds = vi.mocked(value.state.reserveTransitionStep).mock.calls.slice(0, 2).map(([input]) => input.reservationId);
    expect(reservationIds).toHaveLength(2);
    expect(new Set(reservationIds).size).toBe(1);
    expect(waiter.wait).toHaveBeenCalledOnce();
  });

  it("retains a transition claim after an accepted effect loses its response", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: {
        kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1,
        completedSteps: ["activate-worker"]
      }
    });
    vi.mocked(value.gateway.converge).mockImplementationOnce(async () => {
      value.events.push("gateway-effect-accepted");
      throw new Error("gateway response lost after acceptance");
    });

    await expect(value.supervisor.recover(owner)).rejects.toThrow("gateway response lost after acceptance");
    expect(value.events).toEqual(["recover-active-worker", "gateway-effect-accepted"]);
    expect(value.state.releaseTransitionStep).not.toHaveBeenCalled();
    expect((await value.state.read(owner))?.transitionCheckpoint).toMatchObject({ reservedStep: "converge-gateway" });

    const waiter = { wait: vi.fn(async () => undefined) };
    const concurrent = new DeploymentSupervisor(value.build.authority, value.artifacts, value.migrations, value.generations, value.state, value.gateway, value.realtime, { now: () => new Date("2026-08-29T12:00:00.000Z") }, waiter);
    vi.mocked(value.state.reserveTransitionStep).mockReset().mockRejectedValue(new Error("live transition claim"));
    await expect(concurrent.recover(owner)).rejects.toThrow("live transition claim");
    expect(value.state.reserveTransitionStep).toHaveBeenCalledTimes(71);
    expect(waiter.wait).toHaveBeenCalledTimes(70);
    expect(value.gateway.converge).toHaveBeenCalledTimes(1);
  });

  it("releases a transition claim only when the boundary proves no effect was dispatched", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: {
        kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1,
        completedSteps: ["activate-worker"]
      }
    });
    vi.mocked(value.gateway.converge).mockRejectedValueOnce(new StaticDeploymentEffectNotDispatchedError("gateway request was not dispatched"));

    await expect(value.supervisor.recover(owner)).rejects.toThrow("gateway request was not dispatched");
    expect(value.state.releaseTransitionStep).toHaveBeenCalledOnce();
    expect((await value.state.read(owner))?.transitionCheckpoint).not.toHaveProperty("reservedStep");
  });

  it("recovers bounded pending generation retirements before checkpoint work", async () => {
    const value = harness();
    value.setCurrent(snapshot(value.green, value.blue, 1));
    vi.mocked(value.state.listPendingGenerationRetirements).mockResolvedValueOnce([value.rejectedReservation]);
    await value.supervisor.recover(owner);
    expect(value.generations.retire).toHaveBeenCalledWith({ reservation: value.rejectedReservation });
    expect(value.state.completeGenerationRetirement).toHaveBeenCalledWith(value.rejectedReservation);
  });

  it("continues bounded retirement recovery through 32-plus-1 pages", async () => {
    const value = harness();
    value.setCurrent(snapshot(value.green, value.blue, 1));
    const reservations = Array.from({ length: 33 }, (_, index) => ({
      ...value.rejectedReservation,
      generationId: `customer-alpha-retired-${index + 10}`,
      reservationId: `12345678-1234-4abc-8def-${String(index + 10).padStart(12, "0")}`
    }));
    vi.mocked(value.state.listPendingGenerationRetirements)
      .mockResolvedValueOnce(reservations.slice(0, 32))
      .mockResolvedValueOnce(reservations.slice(32))
      .mockResolvedValueOnce([]);

    await value.supervisor.recover(owner);
    expect(value.state.listPendingGenerationRetirements).toHaveBeenCalledTimes(3);
    expect(value.generations.retire).toHaveBeenCalledTimes(33);
    expect(value.state.completeGenerationRetirement).toHaveBeenCalledTimes(33);
  });

  it("fails closed when pending retirement recovery exceeds its total bound", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.green, value.blue, 1),
      transitionCheckpoint: { kind: "promote", activeGenerationId: value.green.generationId, previousGenerationId: value.blue.generationId, revision: 1, completedSteps: ["activate-worker"] }
    });
    const page = (offset: number) => Array.from({ length: 32 }, (_, index) => ({
      ...value.rejectedReservation,
      generationId: `customer-alpha-retired-${offset + index + 10}`,
      reservationId: `12345678-1234-4abc-8def-${String(offset + index + 10).padStart(12, "0")}`
    }));
    vi.mocked(value.state.listPendingGenerationRetirements)
      .mockResolvedValueOnce(page(0))
      .mockResolvedValueOnce(page(32))
      .mockResolvedValueOnce(page(64))
      .mockResolvedValueOnce(page(96))
      .mockResolvedValueOnce([{
        ...value.rejectedReservation,
        generationId: "customer-alpha-retired-overflow-138",
        reservationId: "12345678-1234-4abc-8def-000000000138"
      }]);

    await expect(value.supervisor.recover(owner)).rejects.toMatchObject({ code: "STATE_UNAVAILABLE" });
    expect(value.generations.retire).toHaveBeenCalledTimes(128);
    expect(value.gateway.converge).not.toHaveBeenCalled();
  });

  it("does not repeat settled transition effects after a process restart", async () => {
    const value = harness();
    value.setCurrent(snapshot(value.green, value.blue, 1));
    vi.mocked(value.state.readFence).mockResolvedValue(fence(value.green.generationId, 5, 1));
    await value.supervisor.recover(owner);
    expect(value.events).toEqual(["recover-active-worker"]);
  });

  it("never drains a retained generation that became active during retirement recovery", async () => {
    const value = harness();
    value.setCurrent({
      ...snapshot(value.blue, value.green, 2), rollbackWindow: { state: "retirement-reserved" },
      transitionCheckpoint: { kind: "retire-rollback", activeGenerationId: value.blue.generationId, previousGenerationId: value.blue.generationId, revision: 2, completedSteps: [] }
    });
    await expect(value.supervisor.recover(owner)).rejects.toMatchObject({ code: "STATE_UNAVAILABLE" });
    expect(value.generations.drain).not.toHaveBeenCalled();
    expect(value.generations.retire).not.toHaveBeenCalled();
  });
});
