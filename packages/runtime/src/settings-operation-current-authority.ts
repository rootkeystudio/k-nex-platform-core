import { canonicalJson, type AdministrationAuthorityEnvelope } from "@k-nex/contracts";

import { CurrentAuthorityAdapter, createCurrentAuthorityTarget } from "./current-authority-adapter.js";

export interface PersistedSettingsAuthorityContextProvider<TContext> {
  current(envelope: AdministrationAuthorityEnvelope): Promise<TContext | undefined> | TContext | undefined;
}

/** Re-enters CurrentAuthority for every permission captured by a durable settings operation. */
export class PersistedSettingsAuthorityReauthorizer<TContext> {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly contexts: PersistedSettingsAuthorityContextProvider<TContext>
  ) {}

  async reauthorize(input: Readonly<{ authority: AdministrationAuthorityEnvelope }>): Promise<boolean> {
    let context: TContext | undefined;
    try { context = await this.contexts.current(input.authority); }
    catch { return false; }
    if (context === undefined) return false;
    for (const intent of input.authority.permissions) {
      const decision = await this.authority.authorize(context, createCurrentAuthorityTarget({
        permissionId: intent.permissionId,
        scope: intent.scope,
        facts: { boundary: "persisted-system-settings", owner: intent.owner }
      }));
      if (decision?.outcome !== "allow" || decision.permissionId !== intent.permissionId
        || canonicalJson(decision.scope) !== canonicalJson(intent.scope)
        || canonicalJson(decision.owner) !== canonicalJson(intent.owner)
        || canonicalJson(decision.principal) !== canonicalJson(input.authority.principal)
        || canonicalJson(decision.effectiveActor) !== canonicalJson(input.authority.effectiveActor)
        || canonicalJson(decision.delegation ?? null) !== canonicalJson(input.authority.delegation ?? null)) return false;
    }
    return true;
  }
}
