import type { AgentToolDescriptor, AgentToolEffect } from "@k-nex/contracts";

import { ToolGatewayError, type AgentClientAuthentication, type DelegationEvaluator, type PrincipalAuthentication, type ToolGatewayRequest } from "./tool-gateway.js";
import type { ToolCatalogPolicy, ToolCatalogPolicyRequest } from "./tool-catalog.js";

export const toolDelegationLimits = Object.freeze({
  maxIdLength: 128,
  maxAllowedTools: 100,
  maxLifetimeMs: 24 * 60 * 60 * 1000
} as const);

export interface ToolDelegationGrant {
  readonly id: string;
  readonly principalId: string;
  readonly agentClientId: string;
  readonly applicationId: string;
  readonly allowedTools: readonly { readonly id: string; readonly version: number }[];
  readonly allowedEffects: readonly AgentToolEffect[];
  readonly expiresAtEpochMs: number;
  readonly revocationRevision: number;
  readonly resourceScope?: Readonly<{ readonly kind: string; readonly id: string }>;
}

export interface ToolDelegationIdentity {
  readonly principalId: string;
  readonly agentClientId: string;
  readonly applicationId: string;
}

export interface ToolDelegationGrantResolver {
  resolve(request: ToolGatewayRequest): ToolDelegationGrant | undefined | Promise<ToolDelegationGrant | undefined>;
}

export interface ToolDelegationIdentityResolver {
  resolve(principal: PrincipalAuthentication, client: AgentClientAuthentication): ToolDelegationIdentity;
}

export interface ToolDelegationClock {
  now(): number;
}

export interface ToolDelegationRevocations {
  revision(grantId: string): number | Promise<number>;
}

export interface ToolParentAuthority {
  allows(grant: ToolDelegationGrant, principal: PrincipalAuthentication): boolean | Promise<boolean>;
}

export interface EvaluatedToolDelegation {
  readonly id: string;
  readonly principalId: string;
  readonly agentClientId: string;
  readonly applicationId: string;
  readonly resourceScope?: ToolDelegationGrant["resourceScope"];
  allows(descriptor: AgentToolDescriptor): boolean;
}

export interface PrincipalToolVisibilityPolicy {
  isVisible(request: ToolCatalogPolicyRequest): boolean | Promise<boolean>;
}

export class DelegatedToolCatalogPolicy implements ToolCatalogPolicy {
  constructor(private readonly principal: PrincipalToolVisibilityPolicy) {}

  isVisible(request: ToolCatalogPolicyRequest): boolean | Promise<boolean> {
    const delegation = request.delegation as Partial<EvaluatedToolDelegation> | undefined;
    if (typeof delegation?.allows !== "function" || delegation.allows(request.descriptor) !== true) return false;
    return this.principal.isVisible(request);
  }
}

const effects = new Set<AgentToolEffect>(["read-only", "write", "destructive", "external"]);

function deny(code: string): never {
  throw new ToolGatewayError(code, 403, "Delegation was denied.");
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= toolDelegationLimits.maxIdLength &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function validateGrant(value: ToolDelegationGrant, now: number): void {
  if (!validId(value.id) || !validId(value.principalId) || !validId(value.agentClientId) || !validId(value.applicationId) ||
    !Array.isArray(value.allowedTools) || value.allowedTools.length < 1 || value.allowedTools.length > toolDelegationLimits.maxAllowedTools ||
    !Array.isArray(value.allowedEffects) || value.allowedEffects.length < 1 || value.allowedEffects.length > effects.size ||
    !Number.isSafeInteger(value.expiresAtEpochMs) || value.expiresAtEpochMs <= now || value.expiresAtEpochMs - now > toolDelegationLimits.maxLifetimeMs ||
    !Number.isSafeInteger(value.revocationRevision) || value.revocationRevision < 0) deny("DELEGATION_INVALID");
  const toolKeys = value.allowedTools.map((tool) => `${tool.id}\u0000${tool.version}`);
  if (new Set(toolKeys).size !== toolKeys.length || value.allowedTools.some((tool) =>
    !validId(tool.id) || !Number.isSafeInteger(tool.version) || tool.version < 1
  )) deny("DELEGATION_INVALID");
  if (new Set(value.allowedEffects).size !== value.allowedEffects.length || value.allowedEffects.some((effect) => !effects.has(effect))) {
    deny("DELEGATION_INVALID");
  }
  if (value.resourceScope !== undefined && (!validId(value.resourceScope.kind) || !validId(value.resourceScope.id))) {
    deny("DELEGATION_INVALID");
  }
}

export class BoundToolDelegationEvaluator implements DelegationEvaluator {
  constructor(
    private readonly grants: ToolDelegationGrantResolver,
    private readonly identities: ToolDelegationIdentityResolver,
    private readonly clock: ToolDelegationClock,
    private readonly revocations: ToolDelegationRevocations,
    private readonly parentAuthority: ToolParentAuthority
  ) {}

  async evaluate(
    request: ToolGatewayRequest,
    principal: PrincipalAuthentication,
    client: AgentClientAuthentication
  ): Promise<EvaluatedToolDelegation> {
    const grant = await this.grants.resolve(request);
    if (grant === undefined) deny("DELEGATION_REQUIRED");
    const now = this.clock.now();
    if (!Number.isSafeInteger(now)) deny("DELEGATION_INVALID");
    validateGrant(grant, now);
    const identity = this.identities.resolve(principal, client);
    if (!validId(identity.principalId) || !validId(identity.agentClientId) || !validId(identity.applicationId) ||
      grant.principalId !== identity.principalId || grant.agentClientId !== identity.agentClientId ||
      grant.applicationId !== identity.applicationId) deny("DELEGATION_SUBJECT_MISMATCH");
    if (await this.revocations.revision(grant.id) !== grant.revocationRevision) deny("DELEGATION_REVOKED");
    if (await this.parentAuthority.allows(grant, principal) !== true) deny("DELEGATION_ESCALATION");
    const allowedTools = new Set(grant.allowedTools.map((tool) => `${tool.id}\u0000${tool.version}`));
    const allowedEffects = new Set(grant.allowedEffects);
    return Object.freeze({
      id: grant.id,
      principalId: grant.principalId,
      agentClientId: grant.agentClientId,
      applicationId: grant.applicationId,
      ...(grant.resourceScope === undefined ? {} : { resourceScope: Object.freeze({ ...grant.resourceScope }) }),
      allows: (descriptor: AgentToolDescriptor) =>
        allowedTools.has(`${descriptor.id}\u0000${descriptor.version}`) && allowedEffects.has(descriptor.effect)
    });
  }
}
