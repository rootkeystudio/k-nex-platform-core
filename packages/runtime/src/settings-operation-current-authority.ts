import { SettingsDocumentIdentitySchema, canonicalJson, type AdministrationAuthorityEnvelope, type AuthorizationDecision, type AuthorizationState, type SettingsDocumentIdentity } from "@k-nex/contracts";

import { CurrentAuthorityAdapter, createCurrentAuthorityTarget } from "./current-authority-adapter.js";

export interface PersistedSettingsAuthorityContextProvider<TContext> {
  current(input: Readonly<{ authority: AdministrationAuthorityEnvelope; identity: SettingsDocumentIdentity; operationId: string; phase: "claim" | "promote" }>): Promise<TContext | undefined> | TContext | undefined;
}

/** Re-enters CurrentAuthority for every permission captured by a durable settings operation. */
export class PersistedSettingsAuthorityReauthorizer<TContext> {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly contexts: PersistedSettingsAuthorityContextProvider<TContext>
  ) {}

  async reauthorize(input: Readonly<{ authority: AdministrationAuthorityEnvelope; identity: SettingsDocumentIdentity; operationId: string; phase: "claim" | "promote" }>): Promise<AuthorizationState | undefined> {
    const identity = SettingsDocumentIdentitySchema.safeParse(input.identity);
    if (!identity.success || !/^[a-z][a-z0-9-]{2,127}$/u.test(input.operationId) || (input.phase !== "claim" && input.phase !== "promote")
      || input.authority.applicationId !== identity.data.applicationId || input.authority.environment !== identity.data.environment) return undefined;
    let context: TContext | undefined;
    try { context = await this.contexts.current({ ...input, identity: identity.data }); }
    catch { return undefined; }
    if (context === undefined) return undefined;
    const decisions: AuthorizationDecision[] = [];
    for (const intent of input.authority.permissions) {
      const decision = await this.authority.authorize(context, createCurrentAuthorityTarget({
        permissionId: intent.permissionId,
        scope: intent.scope,
        facts: { boundary: "persisted-system-settings", identity: identity.data, operationId: input.operationId, phase: input.phase, owner: intent.owner }
      }));
      if (decision?.outcome !== "allow" || decision.permissionId !== intent.permissionId
        || decision.applicationId !== identity.data.applicationId || decision.environment !== identity.data.environment
        || canonicalJson(decision.scope) !== canonicalJson(intent.scope)
        || canonicalJson(decision.owner) !== canonicalJson(intent.owner)
        || canonicalJson(decision.principal) !== canonicalJson(input.authority.principal)
        || canonicalJson(decision.effectiveActor) !== canonicalJson(input.authority.effectiveActor)
        || canonicalJson(decision.delegation ?? null) !== canonicalJson(input.authority.delegation ?? null)) return undefined;
      decisions.push(decision);
    }
    if (decisions.length === 0 || !decisions.every((decision) => decision.authorizationRevision === decisions[0]!.authorizationRevision && decision.lifecycleRevision === decisions[0]!.lifecycleRevision)) return undefined;
    return Object.freeze({ schemaVersion: 1, applicationId: identity.data.applicationId, environment: identity.data.environment, authorizationRevision: decisions[0]!.authorizationRevision, lifecycleRevision: decisions[0]!.lifecycleRevision });
  }
}
