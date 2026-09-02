import {
  AuthorizationDecisionSchema,
  ExtensionIdentitySchema,
  ExtensionOperationActorSchema,
  canonicalJson,
  type ExtensionOperationActor
} from "@k-nex/contracts";

import {
  createEffectiveAuthorizationRequest,
  isTrustedAuthorizationSession,
  type EffectiveAuthorityResolver,
  type TrustedAuthorizationSession
} from "./effective-authority.js";
import type {
  ExtensionManagerOperation,
  ExtensionOperationAuthorizer,
  OperationAuthorizationDecision,
  OperationAuthorizationRequest
} from "./plugin-manager.js";

export type CurrentAuthorityOperationAuthorizerErrorCode = "UNAUTHORIZED";

export class CurrentAuthorityOperationAuthorizerError extends Error {
  constructor(readonly code: CurrentAuthorityOperationAuthorizerErrorCode) {
    super("Current authority does not permit this extension operation.");
    this.name = "CurrentAuthorityOperationAuthorizerError";
  }
}

/** Server-owned session and approval only; no request actor, permission, or scope crosses this port. */
export interface CurrentAuthorityOperationSessionProvider {
  current(request: OperationAuthorizationRequest): Promise<Readonly<{
    session: TrustedAuthorizationSession;
    actor: ExtensionOperationActor;
  }> | undefined>;
}

type RequiredPermission = Readonly<{ permissionId: string; resource: "system.extensions" }>;

const planPermission = Object.freeze({ permissionId: "system.extensions.plan", resource: "system.extensions" } satisfies RequiredPermission);

function operationPermission(request: OperationAuthorizationRequest): RequiredPermission | undefined {
  if (request.operation === "enable") return Object.freeze({ permissionId: "system.extensions.enable", resource: "system.extensions" });
  if (request.operation === "install") {
    if (request.extension.deliveryClass === "hot-application" || request.extension.deliveryClass === "theme-skin") return Object.freeze({ permissionId: "system.extensions.install-live", resource: "system.extensions" });
    if (request.extension.deliveryClass === "platform-plugin") return Object.freeze({ permissionId: "system.extensions.deploy-platform-plugin", resource: "system.extensions" });
  }
  const permissionId: Record<Exclude<ExtensionManagerOperation, "install">, string> = {
    update: "system.extensions.update",
    disable: "system.extensions.disable",
    rollback: "system.extensions.rollback",
    uninstall: "system.extensions.uninstall"
  };
  const value = permissionId[request.operation as Exclude<ExtensionManagerOperation, "install">];
  return value === undefined ? undefined : Object.freeze({ permissionId: value, resource: "system.extensions" });
}

function validRequest(request: OperationAuthorizationRequest): boolean {
  return /^[a-z][a-z0-9-]{2,127}$/u.test(request.applicationId) && /^[a-z][a-z0-9-]{1,63}$/u.test(request.environment) &&
    ExtensionIdentitySchema.safeParse(request.extension).success && /^(?:install|enable|update|disable|rollback|uninstall)$/u.test(request.operation) &&
    /^sha256:[0-9a-f]{64}$/u.test(request.requestDigest) && Number.isSafeInteger(request.expectedRevision) && request.expectedRevision >= 0;
}

function immutableRequest(request: OperationAuthorizationRequest): OperationAuthorizationRequest {
  return Object.freeze({
    applicationId: request.applicationId,
    environment: request.environment,
    extension: Object.freeze({ ...ExtensionIdentitySchema.parse(request.extension) }),
    operation: request.operation,
    requestDigest: request.requestDigest,
    expectedRevision: request.expectedRevision
  });
}

function same(value: unknown, expected: unknown): boolean {
  try { return canonicalJson(value) === canonicalJson(expected); } catch { return false; }
}

function sameOptional(value: unknown, expected: unknown): boolean {
  return value === undefined || expected === undefined ? value === expected : same(value, expected);
}

async function digest(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Adapts the current, server-owned authority session to the Phase 9 manager port.
 * Both plan and concrete lifecycle permission must allow for every operation.
 */
export class CurrentAuthorityOperationAuthorizer implements ExtensionOperationAuthorizer {
  constructor(
    private readonly sessions: CurrentAuthorityOperationSessionProvider,
    private readonly authority: EffectiveAuthorityResolver
  ) {}

  async authorize(request: OperationAuthorizationRequest): Promise<OperationAuthorizationDecision> {
    try {
      if (!validRequest(request)) throw new Error("invalid request");
      const trustedRequest = immutableRequest(request);
      const required = operationPermission(trustedRequest);
      if (!required) throw new Error("unsupported operation");
      const current = await this.sessions.current(trustedRequest);
      if (!current || !isTrustedAuthorizationSession(current.session)) throw new Error("untrusted session");
      const actor = ExtensionOperationActorSchema.safeParse(current.actor);
      if (!actor.success || actor.data.kind !== "actor" || actor.data.id !== current.session.effectiveActor.id ||
        current.session.applicationId !== trustedRequest.applicationId || current.session.environment !== trustedRequest.environment) throw new Error("invalid trusted actor");
      const context = Object.freeze({
        requestDigest: trustedRequest.requestDigest,
        applicationId: current.session.applicationId,
        environment: current.session.environment,
        correlationId: current.session.correlationId,
        principal: current.session.principal,
        effectiveActor: current.session.effectiveActor,
        delegationId: current.session.delegation?.delegationId ?? null,
        actor: { id: actor.data.id, approvalId: actor.data.approvalId }
      });

      const evaluate = async (permission: RequiredPermission) => {
        const scope = Object.freeze({ kind: "application" as const, resource: permission.resource });
        const decision = AuthorizationDecisionSchema.safeParse(await this.authority.authorize(current.session,
          createEffectiveAuthorizationRequest({
            schemaVersion: 1,
            decisionId: await digest({ context, permissionId: permission.permissionId }),
            permissionId: permission.permissionId,
            scope,
            facts: Object.freeze({})
          })
        ));
        if (!decision.success || decision.data.outcome !== "allow" || decision.data.applicationId !== trustedRequest.applicationId ||
          decision.data.environment !== trustedRequest.environment || decision.data.permissionId !== permission.permissionId ||
          decision.data.correlationId !== current.session.correlationId || !same(decision.data.principal, current.session.principal) ||
          !same(decision.data.effectiveActor, current.session.effectiveActor) || !sameOptional(decision.data.delegation, current.session.delegation) ||
          !same(decision.data.scope, scope)) throw new Error("denied");
        return decision.data;
      };

      const [plan, operation] = await Promise.all([evaluate(planPermission), evaluate(required)]);
      if (plan.applicationId !== operation.applicationId || plan.environment !== operation.environment ||
        plan.authorizationRevision !== operation.authorizationRevision || plan.lifecycleRevision !== operation.lifecycleRevision) throw new Error("incoherent authority");
      return Object.freeze({
        actor: Object.freeze(actor.data),
        decisionId: await digest({ context, planDecisionId: plan.decisionId, operationDecisionId: operation.decisionId })
      });
    } catch {
      throw new CurrentAuthorityOperationAuthorizerError("UNAUTHORIZED");
    }
  }
}
