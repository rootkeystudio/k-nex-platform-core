export interface StaticGenerationApplicationFilesOptions {
  readonly applicationId: string;
}

/**
 * A generated application knows which Platform Plugin generation its own image
 * carries, but nothing in the shipped application ever told the database. The
 * runtime projection every fenced surface reads — Platform Plugin lifecycle,
 * system settings descriptors, worker effect fencing — stayed empty, so a
 * freshly generated application answered 404 on System Settings and ran a
 * worker that processed nothing while reporting itself ready.
 *
 * This is the application declaring its own static generation to its own
 * database. It is not the deployment supervisor's authority: it cannot promote,
 * roll back, or change which generation the image contains. It records the one
 * generation this image was built as, and it is idempotent, so re-running it
 * after every deploy is the expected operation.
 */
function runtimeSource(): string {
  return `import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PostgresRuntimeExtensionStore, PostgresStaticDeploymentStore, SharedStaticPlatformPluginGenerationRebinder, type RuntimeExtensionPool } from "@k-nex/payload-adapter";
import type { Payload } from "payload";

import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { kNexHostInventoryDigest } from "./k-nex-system-extensions.js";
import { migrations } from "./migrations/index.js";

const clock = Object.freeze({ now: () => new Date() });
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;

/**
 * Five minutes is the longest lease the fence admits, so the worker renews well
 * inside it. A worker that dies keeps the fence for at most this long, and the
 * next start of the same owner resumes its own expired lease.
 */
export const kNexWorkerLeaseDurationMs = 240_000;
export const kNexWorkerLeaseRenewalIntervalMs = 60_000;
export const kNexWorkerFencingToken = 1;
export const kNexWorkerFenceOwner = "worker:" + kNexIdentity.applicationId + ":" + kNexIdentity.environment;

function digestOf(value: string): string {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

function generatedArtifactDigest(relativePath: string): string {
  let content: string;
  try { content = readFileSync(resolve(process.cwd(), relativePath), "utf8"); }
  catch { throw new Error("This application cannot describe its generation: " + relativePath + " is unavailable."); }
  return digestOf(content);
}

function requiredEnvironment(name: "K_NEX_SOURCE_COMMIT" | "K_NEX_APPLICATION_DIGEST"): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Required generation identity " + name + " is missing. Set it to the exact source commit and application digest this image was built from.");
  }
  if (name === "K_NEX_SOURCE_COMMIT" && !commitPattern.test(value)) throw new Error("K_NEX_SOURCE_COMMIT must be a full 40-character commit SHA.");
  if (name === "K_NEX_APPLICATION_DIGEST" && !digestPattern.test(value)) throw new Error("K_NEX_APPLICATION_DIGEST must be a sha256:<hex> digest.");
  return value;
}

/**
 * The generation this image is. Every digest is read from what the image
 * actually carries, and the two facts only the build knows — the source commit
 * and the application digest — are supplied by the deployment that built it.
 * A container deployment overrides the image reference with the registry
 * identity it was pulled from; a local deployment has no registry, so the
 * application names itself by its own digest rather than inventing one.
 */
export function kNexStaticGeneration() {
  const sourceCommit = requiredEnvironment("K_NEX_SOURCE_COMMIT");
  const applicationDigest = requiredEnvironment("K_NEX_APPLICATION_DIGEST");
  const imageReference = process.env.K_NEX_IMAGE_REFERENCE ?? kNexIdentity.applicationId + "@" + applicationDigest;
  const imageDigest = imageReference.slice(imageReference.lastIndexOf("@") + 1);
  if (!digestPattern.test(imageDigest)) throw new Error("K_NEX_IMAGE_REFERENCE must end with @sha256:<hex>.");
  return Object.freeze({
    generationId: kNexSalesRegistry.staticRelease.runtimeGenerationId,
    sourceCommit,
    compositionChangePlanDigest: generatedArtifactDigest(".k-nex/application-plan.json"),
    buildEvidenceDigest: generatedArtifactDigest(".k-nex/migration-closure.json"),
    applicationDigest,
    imageDigest,
    imageReference,
    migrationRevision: migrations.length
  });
}

export function kNexStaticDeploymentStore(payload: Payload): PostgresStaticDeploymentStore {
  return new PostgresStaticDeploymentStore(payload.db.pool as RuntimeExtensionPool, clock, {
    read: () => { throw new Error("A generated application never reads a deployment build token."); }
  });
}

export function kNexRuntimeExtensionStore(payload: Payload): PostgresRuntimeExtensionStore {
  return new PostgresRuntimeExtensionStore(payload.db.pool as RuntimeExtensionPool, clock, kNexHostInventoryDigest,
    { sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder() });
}

/**
 * Records this image's generation and seeds the Platform Plugin runtime
 * projection from it. Both steps are idempotent: an application already
 * registered at this exact generation observes its own state and changes
 * nothing, and one registered at a different generation fails closed rather
 * than overwriting a deployment authority it does not hold.
 */
export async function registerKnexStaticGeneration(payload: Payload): Promise<Readonly<{ generationId: string; platformPlugins: number }>> {
  const generation = kNexStaticGeneration();
  const deployments = kNexStaticDeploymentStore(payload);
  await deployments.initialize({
    applicationId: kNexIdentity.applicationId,
    environment: kNexIdentity.environment,
    generation,
    workerOwner: kNexWorkerFenceOwner,
    workerFencingToken: kNexWorkerFencingToken,
    workerLeaseExpiresAt: new Date(clock.now().valueOf() + kNexWorkerLeaseDurationMs).toISOString()
  });
  const inventory = await kNexRuntimeExtensionStore(payload).reconcileStaticHostInventory({
    applicationId: kNexIdentity.applicationId,
    environment: kNexIdentity.environment,
    platformPlugins: [{
      id: kNexSalesRegistry.registration.pluginId,
      package: kNexSalesRegistry.staticRelease.package,
      runtimeGenerationId: kNexSalesRegistry.staticRelease.runtimeGenerationId
    }],
    deployment: { kind: "initial", generation, workerFencingToken: kNexWorkerFencingToken }
  });
  return Object.freeze({
    generationId: generation.generationId,
    platformPlugins: Object.keys(inventory.extensions.platformPlugins).length
  });
}

/** Takes this worker's own execution lease, resuming an expired one it owns. */
export async function acquireKnexWorkerFence(payload: Payload) {
  return kNexStaticDeploymentStore(payload).acquireWorkerFence({
    applicationId: kNexIdentity.applicationId,
    environment: kNexIdentity.environment,
    generationId: kNexSalesRegistry.staticRelease.runtimeGenerationId,
    fencingToken: kNexWorkerFencingToken,
    owner: kNexWorkerFenceOwner,
    leaseDurationMs: kNexWorkerLeaseDurationMs
  });
}

/** Extends the lease this worker holds. A superseded generation is refused. */
export async function renewKnexWorkerFence(payload: Payload, promotionRevision: number) {
  return kNexStaticDeploymentStore(payload).renewWorkerFence({
    applicationId: kNexIdentity.applicationId,
    environment: kNexIdentity.environment,
    generationId: kNexSalesRegistry.staticRelease.runtimeGenerationId,
    fencingToken: kNexWorkerFencingToken,
    owner: kNexWorkerFenceOwner,
    expectedPromotionRevision: promotionRevision,
    leaseDurationMs: kNexWorkerLeaseDurationMs
  });
}
`;
}

function registerCommandSource(): string {
  return `import { bootKnexApplication } from "./boot.js";
import { shutdownKnexApplication } from "./k-nex-authority.js";
import { registerKnexStaticGeneration } from "./k-nex-static-generation.js";

const payload = await bootKnexApplication("static-generation-registrar");
try {
  const result = await registerKnexStaticGeneration(payload);
  console.log("K_NEX_GENERATION_REGISTERED " + result.generationId + " " + String(result.platformPlugins));
} finally { await shutdownKnexApplication(payload); }
process.exit(0);
`;
}

export function staticGenerationApplicationFiles(_options: StaticGenerationApplicationFilesOptions): Readonly<Record<string, string>> {
  return {
    "src/k-nex-static-generation.ts": runtimeSource(),
    "src/k-nex-register-generation.ts": registerCommandSource()
  };
}
