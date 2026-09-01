import {
  RunnerIsolationProfileSchema,
  type ExtensionAuthorizationOwnerRef,
  type HotApplicationManifest,
  type PermissionPolicyBinding,
  type RunnerIsolationProfile
} from "@k-nex/contracts";
import { randomUUID } from "node:crypto";

import type { ExtensionActorIdentity, ExtensionCapabilityTokenRequest, HmacExtensionCapabilityTokens } from "./extension-capability-gateway.js";
import type { DurableDynamicArtifact, DurableDynamicArtifactStore } from "./dynamic-generation-runtime.js";
import type { RuntimeExtensionStore } from "./plugin-manager.js";
import {
  createTrustedAuthorizationSession,
  isTrustedAuthorizationSession,
  type TrustedAuthorizationSession
} from "./effective-authority.js";
import type {
  AuthorizationPolicyEvaluationOutcome,
  HotApplicationPolicyHostCapabilityGateway
} from "./authorization-registry.js";

type ProductionRunnerIsolationProfile = Extract<RunnerIsolationProfile, { scope: "production" }>;
type ActiveGeneration = NonNullable<ReturnType<AuthoritativeHotApplicationRuntime["active"]>>;
type HotApplicationArtifact = DurableDynamicArtifact & Readonly<{ hotApplicationManifest: HotApplicationManifest }>;

export interface AuthoritativeHotApplicationAuthorizationSource { readonly __opaqueHotApplicationAuthorizationSource?: never; }

export interface AuthoritativeHotApplicationAuthorizationRecord {
  readonly applicationId: string;
  readonly environment: string;
  readonly extensionId: string;
  readonly generationId: string;
  readonly sourceCommit: string;
  readonly artifactDigest: `sha256:${string}`;
  readonly manifestDigest: `sha256:${string}`;
  readonly manifest: HotApplicationManifest;
}

const authorizationSources = new WeakSet<object>();
const authorizationSourceRecords = new WeakMap<object, AuthoritativeHotApplicationAuthorizationRecord>();
const policyGatewayRecords = new WeakMap<object, AuthoritativeHotApplicationAuthorizationRecord>();
const trafficContexts = new WeakSet<object>();

/** Internal K-Nex authority check; raw objects and clones cannot satisfy it. */
export function readAuthoritativeHotApplicationAuthorizationSource(value: unknown): AuthoritativeHotApplicationAuthorizationRecord | undefined {
  return typeof value === "object" && value !== null && authorizationSources.has(value)
    ? authorizationSourceRecords.get(value) : undefined;
}

/** Only AuthoritativeHotApplicationRuntime can mint this runner-backed policy route. */
export function isRunnerBackedHotApplicationPolicyGateway(value: unknown): value is HotApplicationPolicyHostCapabilityGateway {
  return readRunnerBackedHotApplicationPolicyGatewaySource(value) !== undefined;
}

export function readRunnerBackedHotApplicationPolicyGatewaySource(value: unknown): AuthoritativeHotApplicationAuthorizationRecord | undefined {
  return typeof value === "object" && value !== null ? policyGatewayRecords.get(value) : undefined;
}

function isHotApplicationArtifact(artifact: DurableDynamicArtifact): artifact is HotApplicationArtifact {
  return artifact.authority.deliveryClass === "hot-application" && artifact.hotApplicationManifest?.deliveryClass === "hot-application";
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export interface HotApplicationServerInvocation {
  readonly owner: Readonly<{ applicationId: string; environment: string; deliveryClass: "hot-application"; extensionId: string }>;
  readonly generationId: string;
  readonly artifactDigest: `sha256:${string}`;
  readonly serverEntrypoint: string;
  readonly invocationId: string;
  readonly drainLeaseId: string;
  readonly token: string;
  readonly input: unknown;
  readonly limits: Readonly<{
    cpuMilliCores: number;
    memoryMiB: number;
    processes: number;
    openFiles: number;
    tempBytes: number;
    wallTimeMs: number;
    inputBytes: number;
    outputBytes: number;
    logBytes: number;
    maxConcurrency: number;
  }>;
  readonly signal?: AbortSignal;
}

export interface HotApplicationServerRunner {
  readonly isolationProfile: ProductionRunnerIsolationProfile | undefined;
  invoke(input: HotApplicationServerInvocation): Promise<unknown>;
}

export interface TrustedHotApplicationInvocationContext { readonly __opaqueTrustedHotApplicationInvocationContext?: never; }

/** Mints the only caller identity accepted by the Hot Application traffic boundary. */
export function createTrustedHotApplicationInvocationContext(value: Readonly<{ session: TrustedAuthorizationSession }>): TrustedHotApplicationInvocationContext {
  if (!isTrustedAuthorizationSession(value.session)) throw new TypeError("Hot Application invocation requires a trusted authorization session.");
  const context = Object.freeze({ session: value.session });
  trafficContexts.add(context);
  return context as unknown as TrustedHotApplicationInvocationContext;
}

function trustedInvocationContext(value: unknown): Readonly<{ session: TrustedAuthorizationSession }> | undefined {
  return typeof value === "object" && value !== null && trafficContexts.has(value)
    ? value as Readonly<{ session: TrustedAuthorizationSession }> : undefined;
}

/** The host owns capability-to-permission/scope mapping; applications only declare requested grants. */
export interface HotApplicationCapabilityAuthorizer {
  authorize(input: Readonly<{
    session: TrustedAuthorizationSession;
    applicationId: string;
    environment: string;
    appId: string;
    generationId: string;
    grant: ExtensionCapabilityTokenRequest["grants"][number];
  }>): boolean | Promise<boolean>;
}

export interface HotApplicationTrafficRequest {
  readonly input: unknown;
  readonly context: TrustedHotApplicationInvocationContext;
  readonly expectedGeneration?: Readonly<{ generationId: string; artifactDigest: `sha256:${string}` }>;
  readonly signal?: AbortSignal;
}

/** Binds traffic to one reverified immutable Hot Application generation. */
export class AuthoritativeHotApplicationRuntime {
  private readonly profile: ProductionRunnerIsolationProfile;

  constructor(
    private readonly store: Pick<RuntimeExtensionStore, "inventory" | "acquireGenerationLease" | "releaseGenerationLease">,
    private readonly artifacts: DurableDynamicArtifactStore,
    private readonly tokens: Pick<HmacExtensionCapabilityTokens, "issue">,
    private readonly runner: HotApplicationServerRunner,
    private readonly capabilities: HotApplicationCapabilityAuthorizer,
    private readonly identity: Readonly<{ applicationId: string; environment: string; appId: string }>,
    private readonly holder: string = "hot-application-traffic",
  ) {
    const parsed = RunnerIsolationProfileSchema.safeParse(runner.isolationProfile);
    if (!parsed.success || parsed.data.scope !== "production" ||
      !/^[a-z][a-z0-9-]{2,127}$/u.test(identity.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(identity.environment) ||
      !/^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(identity.appId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u.test(holder)) {
      throw new TypeError("Hot Application traffic runtime identity or runner-owned production isolation profile is invalid.");
    }
    this.profile = parsed.data;
  }

  async invoke(request: HotApplicationTrafficRequest): Promise<unknown> {
    return this.invokeTrusted(request, false);
  }

  private async invokeTrusted(request: HotApplicationTrafficRequest, policyInvocation: boolean): Promise<unknown> {
    const context = trustedInvocationContext(request.context);
    if (!context || context.session.applicationId !== this.identity.applicationId || context.session.environment !== this.identity.environment) {
      throw new Error("Hot Application invocation identity is not trusted for this application.");
    }
    const extension = { deliveryClass: "hot-application" as const, id: this.identity.appId };
    const owner = { applicationId: this.identity.applicationId, environment: this.identity.environment, deliveryClass: "hot-application" as const, extensionId: this.identity.appId };
    const expected = request.expectedGeneration;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const active = this.active(await this.store.inventory(this.identity.applicationId, this.identity.environment));
      if (!active) throw new Error("Hot Application has no authoritative active generation.");
      if (expected && (active.generationId !== expected.generationId || active.artifactDigest !== expected.artifactDigest)) {
        throw new Error("Hot Application active generation does not match the UI-admitted generation.");
      }
      const artifact = await this.artifacts.resolve({ owner, generationId: active.generationId, artifactDigest: active.artifactDigest });
      if (!artifact || !this.matches(active, artifact) || !isHotApplicationArtifact(artifact)) {
        throw new Error("The authoritative generation has no matching verified Hot Application bytes.");
      }
      const authorized = policyInvocation ? [] : await Promise.all(artifact.hotApplicationManifest.capabilities.map(async (grant) => {
        try {
          const allowed = await this.capabilities.authorize({
            session: context.session,
            applicationId: this.identity.applicationId,
            environment: this.identity.environment,
            appId: this.identity.appId,
            generationId: active.generationId,
            grant
          });
          return Object.freeze({ grant, allowed });
        } catch { return Object.freeze({ grant, allowed: false }); }
      }));
      if (authorized.some(({ grant, allowed }) => grant.required && !allowed)) throw new Error("Hot Application capability authority denied a required declared grant.");
      const grants = authorized.filter(({ allowed }) => allowed).map(({ grant }) => grant);
      const ttlMs = Math.min(300_000, artifact.hotApplicationManifest.resourceBudget.maxWallTimeMs + 1_000);
      let leaseId: string;
      try {
        leaseId = await this.store.acquireGenerationLease({
          applicationId: this.identity.applicationId,
          environment: this.identity.environment,
          extension,
          generationId: active.generationId,
          holder: this.holder,
          ttlMs
        });
      } catch (error) {
        const current = this.active(await this.store.inventory(this.identity.applicationId, this.identity.environment));
        if (expected && (current?.generationId !== expected.generationId || current?.artifactDigest !== expected.artifactDigest)) {
          throw new Error("Hot Application active generation changed after UI admission.");
        }
        if (!expected && attempt === 0 && (current?.generationId !== active.generationId || current?.artifactDigest !== active.artifactDigest)) continue;
        throw error;
      }
      try {
        const invocationId = `invocation-${randomUUID()}`;
        const token = this.tokens.issue({
          tokenId: `token-${randomUUID()}`,
          applicationId: this.identity.applicationId,
          environment: this.identity.environment,
          appId: this.identity.appId,
          generationId: active.generationId,
          invocationId,
          actor: actorFromSession(context.session),
          correlationId: context.session.correlationId,
          drainLeaseId: leaseId,
          grants: grants as ExtensionCapabilityTokenRequest["grants"],
          ttlMs
        } satisfies ExtensionCapabilityTokenRequest);
        const budget = artifact.hotApplicationManifest.resourceBudget;
        const serverEntrypoint = artifact.hotApplicationManifest.entrypoints.server[0];
        if (!serverEntrypoint) throw new Error("Verified Hot Application manifest declares no server entrypoint.");
        return await this.runner.invoke({
          owner,
          generationId: active.generationId,
          artifactDigest: active.artifactDigest as `sha256:${string}`,
          serverEntrypoint,
          invocationId,
          drainLeaseId: leaseId,
          token,
          input: request.input,
          limits: {
            cpuMilliCores: Math.min(budget.maxCpuMilliCores, this.profile.limits.cpuMilliCores),
            memoryMiB: Math.min(budget.maxMemoryMiB, this.profile.limits.memoryMiB),
            processes: this.profile.limits.processes,
            openFiles: this.profile.limits.openFiles,
            tempBytes: this.profile.limits.tempBytes,
            wallTimeMs: budget.maxWallTimeMs,
            inputBytes: budget.maxInputBytes,
            outputBytes: budget.maxOutputBytes,
            logBytes: budget.maxLogBytes,
            maxConcurrency: budget.maxConcurrency
          },
          ...(request.signal ? { signal: request.signal } : {})
        });
      } finally {
        await this.store.releaseGenerationLease(leaseId);
      }
    }
    throw new Error("Hot Application active generation changed during lease acquisition.");
  }

  /** Revalidates active inventory plus immutable bytes before exposing data-only authorization declarations. */
  async createAuthorizationSource(): Promise<AuthoritativeHotApplicationAuthorizationSource> {
    const { active, artifact } = await this.verifiedActive();
    const source = Object.freeze({});
    authorizationSourceRecords.set(source, Object.freeze({
      applicationId: this.identity.applicationId,
      environment: this.identity.environment,
      extensionId: this.identity.appId,
      generationId: active.generationId,
      sourceCommit: active.sourceCommit,
      artifactDigest: active.artifactDigest as `sha256:${string}`,
      manifestDigest: active.manifestDigest as `sha256:${string}`,
      manifest: deepFreeze(structuredClone(artifact.hotApplicationManifest))
    }));
    authorizationSources.add(source);
    return source;
  }

  /** Policy evaluation stays on the existing P9 invocation boundary; callbacks never cross this boundary. */
  createAuthorizationPolicyGateway(source: AuthoritativeHotApplicationAuthorizationSource): HotApplicationPolicyHostCapabilityGateway {
    const record = readAuthoritativeHotApplicationAuthorizationSource(source);
    if (!record || record.applicationId !== this.identity.applicationId || record.environment !== this.identity.environment || record.extensionId !== this.identity.appId) {
      throw new TypeError("Hot Application authorization source is not owned by this runtime.");
    }
    const gateway: HotApplicationPolicyHostCapabilityGateway = Object.freeze({
      evaluate: async (input: Parameters<HotApplicationPolicyHostCapabilityGateway["evaluate"]>[0]) => {
        const { owner, binding, evaluation, signal } = input;
        if (!samePolicyOwner(owner, record) || binding.publisher.kind !== "extension" ||
          binding.publisher.deliveryClass !== "hot-application" || binding.publisher.extensionId !== record.extensionId) {
          throw new Error("Hot Application policy identity does not match the verified generation.");
        }
        const session = createTrustedAuthorizationSession({
          schemaVersion: 1,
          applicationId: this.identity.applicationId,
          environment: this.identity.environment,
          correlationId: `authorization-${randomUUID()}`,
          principal: evaluation.principal,
          effectiveActor: evaluation.effectiveActor,
          ...(evaluation.delegation === undefined ? {} : { delegation: evaluation.delegation })
        });
        return await this.invokeTrusted({
          input: Object.freeze({ schemaVersion: 1, kind: "authorization-policy-evaluation", binding: structuredClone(binding), evaluation: structuredClone(evaluation) }),
          context: createTrustedHotApplicationInvocationContext({ session }),
          expectedGeneration: { generationId: record.generationId, artifactDigest: record.artifactDigest },
          signal
        }, true) as AuthorizationPolicyEvaluationOutcome;
      }
    });
    policyGatewayRecords.set(gateway, record);
    return gateway;
  }

  private async verifiedActive(): Promise<Readonly<{ active: ActiveGeneration; artifact: HotApplicationArtifact }>> {
    const active = this.active(await this.store.inventory(this.identity.applicationId, this.identity.environment));
    if (!active) throw new Error("Hot Application has no authoritative active generation.");
    const owner = { applicationId: this.identity.applicationId, environment: this.identity.environment, deliveryClass: "hot-application" as const, extensionId: this.identity.appId };
    const artifact = await this.artifacts.resolve({ owner, generationId: active.generationId, artifactDigest: active.artifactDigest });
    if (!artifact || !this.matches(active, artifact) || !isHotApplicationArtifact(artifact)) {
      throw new Error("The authoritative generation has no matching verified Hot Application bytes.");
    }
    return Object.freeze({ active, artifact });
  }

  private active(inventory: Awaited<ReturnType<RuntimeExtensionStore["inventory"]>>) {
    const entry = inventory.extensions.hotApplications[this.identity.appId];
    return entry?.disposition === "active" ? entry.activeGeneration : undefined;
  }

  private matches(active: ActiveGeneration, artifact: DurableDynamicArtifact): boolean {
    const authority = artifact.authority;
    return authority.deliveryClass === "hot-application" && authority.applicationId === this.identity.applicationId && authority.environment === this.identity.environment &&
      authority.extensionId === this.identity.appId && authority.generationId === active.generationId && authority.sourceCommit === active.sourceCommit &&
      authority.artifactDigest === active.artifactDigest && authority.manifestDigest === active.manifestDigest && authority.catalogDigest === active.catalogDigest &&
      authority.provenanceDigest === active.provenanceDigest && authority.sbomDigest === active.sbomDigest;
  }
}

function actorFromSession(session: TrustedAuthorizationSession): ExtensionActorIdentity {
  return Object.freeze({
    principalId: session.principal.id,
    effectiveActorId: session.effectiveActor.id,
    ...(session.delegation === undefined ? {} : { delegationId: session.delegation.delegationId })
  });
}

function samePolicyOwner(owner: ExtensionAuthorizationOwnerRef, source: AuthoritativeHotApplicationAuthorizationRecord): boolean {
  return owner.deliveryClass === "hot-application" && owner.extensionId === source.extensionId;
}
