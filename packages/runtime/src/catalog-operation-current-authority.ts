import { canonicalJson, type AdministrationActorEnvelope, type AuthorizationDecision, type AuthorizationState } from "@k-nex/contracts";

import { CurrentAuthorityAdapter, createCurrentAuthorityTarget } from "./current-authority-adapter.js";

export interface PersistedCatalogAuthorityContextProvider<TContext> {
  current(input: Readonly<{ authority: AdministrationActorEnvelope; refreshId: string; phase: "begin" | "resume" | "accept" }>): Promise<TContext | undefined> | TContext | undefined;
}

/** Re-enters CurrentAuthority for a durable catalog refresh without trusting worker-supplied identity. */
export class PersistedCatalogAuthorityReauthorizer<TContext> {
  constructor(private readonly authority: CurrentAuthorityAdapter<TContext>, private readonly contexts: PersistedCatalogAuthorityContextProvider<TContext>) {}

  async reauthorize(input: Readonly<{ authority: AdministrationActorEnvelope; refreshId: string; phase: "begin" | "resume" | "accept" }>): Promise<AuthorizationState | undefined> {
    let context: TContext | undefined;
    try { context = await this.contexts.current(input); } catch { return undefined; }
    if (context === undefined) return undefined;
    const decisions: AuthorizationDecision[] = [];
    for (const intent of input.authority.permissions) {
      const decision = await this.authority.authorize(context, createCurrentAuthorityTarget({ permissionId: intent.permissionId, scope: intent.scope, facts: { boundary: "persisted-system-catalog", refreshId: input.refreshId, phase: input.phase, owner: intent.owner } }));
      if (decision?.outcome !== "allow" || decision.applicationId !== input.authority.applicationId || decision.environment !== input.authority.environment
        || decision.permissionId !== intent.permissionId || canonicalJson(decision.scope) !== canonicalJson(intent.scope)
        || canonicalJson(decision.owner) !== canonicalJson(intent.owner) || canonicalJson(decision.principal) !== canonicalJson(input.authority.principal)
        || canonicalJson(decision.effectiveActor) !== canonicalJson(input.authority.effectiveActor)
        || canonicalJson(decision.delegation ?? null) !== canonicalJson(input.authority.delegation ?? null)) return undefined;
      decisions.push(decision);
    }
    if (decisions.length === 0 || !decisions.every((decision) => decision.authorizationRevision === decisions[0]!.authorizationRevision && decision.lifecycleRevision === decisions[0]!.lifecycleRevision)) return undefined;
    return Object.freeze({ schemaVersion: 1, applicationId: input.authority.applicationId, environment: input.authority.environment, authorizationRevision: decisions[0]!.authorizationRevision, lifecycleRevision: decisions[0]!.lifecycleRevision });
  }
}
