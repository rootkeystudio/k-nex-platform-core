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
  applicationDigest: digest("3"),
  imageDigest: digest("4"),
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
  const authority = new TrustedStaticApplicationBuildAuthority({ "builder:k-nex-phase-9": keys.publicKey.export({ type: "spki", format: "pem" }).toString() });
  return { authority, token: authority.verify(result, evidence), evidence, result };
}

function harness(build = trustedBuild()) {
  const events: string[] = [];
  const green: StaticApplicationGeneration = {
    generationId: "customer-alpha-green-9",
    sourceCommit: fixture.target.sourceCommit,
    compositionChangePlanDigest: digest("a"),
    buildEvidenceDigest: digest("b"),
    applicationDigest: fixture.target.applicationSubjectDigest,
    imageDigest: fixture.target.imageSubjectDigest,
    migrationRevision: fixture.migration.targetRevision
  };
  const receipt = { revisionAfter: 1 } as StaticDeploymentReceipt;
  const state: StaticDeploymentState = {
    read: vi.fn(async () => snapshot()),
    readFence: vi.fn().mockResolvedValueOnce(fence(blue.generationId, 4, 0)).mockResolvedValue(fence(green.generationId, 5, 1)),
    promote: vi.fn(async () => { events.push("promote"); return receipt; }),
    rollback: vi.fn(async () => { events.push("rollback"); return receipt; }),
    closeRollback: vi.fn(async () => { events.push("close-rollback"); return receipt; }),
    assertContractCleanup: vi.fn(async () => undefined)
  };
  const artifacts: StaticApplicationArtifactProvider = {
    resolve: vi.fn(async () => ({
      imageReference: `${build.evidence.imageSubject.repository}@${build.evidence.imageSubject.digest}`,
      applicationDigest: build.evidence.applicationSubject.digest,
      imageDigest: build.evidence.imageSubject.digest
    })),
    reverify: vi.fn(async (generation) => ({
      imageReference: `${build.evidence.imageSubject.repository}@${generation.imageDigest}`,
      applicationDigest: generation.applicationDigest,
      imageDigest: generation.imageDigest
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
  return { build, blue, green, events, state, artifacts, migrations, generations, gateway, realtime, supervisor: new DeploymentSupervisor(build.authority, artifacts, migrations, generations, state, gateway, realtime) };
}

describe("static deployment supervisor", () => {
  it("promotes only an attested immutable image after online migration and passive readiness", async () => {
    const value = harness();
    await expect(value.supervisor.deploy({ build: value.build.token, generationId: "customer-alpha-green-9", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" }))
      .resolves.toMatchObject({ outcome: "promoted" });
    expect(value.events).toEqual(["migrate", "start-passive", "promote", "activate-worker", "route-green", "realtime-resync", "drain-blue"]);
    expect(value.state.promote).toHaveBeenCalledWith(expect.objectContaining({ build: value.build.token, expectedFenceToken: 4, expectedRevision: 0 }));
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

  it("keeps blue traffic authoritative when green readiness fails", async () => {
    const value = harness();
    vi.mocked(value.generations.readiness).mockRejectedValueOnce(new Error("green failed"));
    await expect(value.supervisor.deploy({ build: value.build.token, generationId: "customer-alpha-green-9", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toThrow("green failed");
    expect(value.state.promote).not.toHaveBeenCalled();
    expect(value.gateway.converge).not.toHaveBeenCalled();
    expect(value.events).toEqual(["migrate", "start-passive", "retire-green"]);
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
    vi.mocked(value.artifacts.reverify).mockResolvedValueOnce({ imageReference: "wrong", applicationDigest: digest("0"), imageDigest: value.blue.imageDigest });
    await expect(value.supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toMatchObject({ code: "ARTIFACT_MISMATCH" });
    expect(value.state.rollback).not.toHaveBeenCalled();

    vi.mocked(value.artifacts.reverify).mockResolvedValueOnce({ imageReference: "retained", applicationDigest: value.blue.applicationDigest, imageDigest: value.blue.imageDigest });
    vi.mocked(value.generations.readiness).mockResolvedValueOnce({
      generationId: value.blue.generationId, sourceCommit: value.blue.sourceCommit, applicationDigest: value.blue.applicationDigest, imageDigest: value.blue.imageDigest,
      migrationRevision: value.blue.migrationRevision, completedMigrationSteps: [], publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true,
      workerMode: "passive", gatewayCapacity: false, realtimeReady: true, observedAt: "2026-08-29T12:00:00.000Z"
    });
    await expect(value.supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: "2026-08-29T12:30:00.000Z" })).rejects.toMatchObject({ code: "READINESS_REJECTED" });
    expect(value.state.rollback).not.toHaveBeenCalled();
  });

  it("records rollback-window retirement before draining and retries only the destructive work", async () => {
    const value = harness();
    vi.mocked(value.state.read).mockResolvedValue(snapshot(value.green, value.blue, 1));
    vi.mocked(value.generations.drain).mockImplementationOnce(async () => {
      value.events.push("drain-blue");
      throw new Error("drain interrupted");
    });
    await expect(value.supervisor.closeRollback(owner)).rejects.toThrow("drain interrupted");
    expect(value.events).toEqual(["close-rollback", "drain-blue"]);
    await expect(value.supervisor.closeRollback(owner)).resolves.toMatchObject({ revisionAfter: 1 });
    expect(value.state.closeRollback).toHaveBeenCalledOnce();
    expect(value.events).toEqual(["close-rollback", "drain-blue", "drain-blue", "retire-green"]);
  });

  it("does not drain or retire when a concurrent rollback-window closure loses its expected revision", async () => {
    const value = harness();
    vi.mocked(value.state.read).mockResolvedValue(snapshot(value.green, value.blue, 1));
    vi.mocked(value.state.closeRollback).mockRejectedValueOnce(new Error("revision conflict"));
    await expect(value.supervisor.closeRollback(owner)).rejects.toThrow("revision conflict");
    expect(value.generations.drain).not.toHaveBeenCalled();
    expect(value.generations.retire).not.toHaveBeenCalled();
  });
});
