import type {
  ExtensionCapabilityAuthority,
  ExtensionCapabilityClaims,
  ExtensionCapabilitySequenceStore
} from "@k-nex/runtime";

import type { RuntimeExtensionPool } from "./runtime-extension-store.js";

export interface ExtensionCapabilityPrincipalAuthority {
  reauthorize(claims: ExtensionCapabilityClaims): boolean | Promise<boolean>;
}

export interface ExtensionCapabilityAuthorityClock {
  now(): Date;
}

/**
 * PostgreSQL-backed Phase 9 authority. The injected principal authority is the
 * narrow seam Phase 10 replaces with RBAC; it intentionally has no role names
 * or cached permission arrays.
 */
export class PostgresExtensionCapabilityAuthority implements ExtensionCapabilityAuthority {
  constructor(
    private readonly pool: RuntimeExtensionPool,
    private readonly principals: ExtensionCapabilityPrincipalAuthority,
    private readonly clock: ExtensionCapabilityAuthorityClock
  ) {}

  async reauthorize(claims: ExtensionCapabilityClaims): Promise<boolean> {
    if (!await this.principals.reauthorize(claims)) return false;
    const active = await this.pool.query<{ active_generation_id: string | null }>(
      `select active_generation_id from runtime_extensions
       where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3 and disposition='active'`,
      [claims.applicationId, claims.environment, claims.appId]
    );
    if (active.rows[0]?.active_generation_id === claims.generationId) return true;
    if (!claims.drainLeaseId) return false;
    const lease = await this.pool.query<{ lease_id: string }>(
      `select lease_id from runtime_extension_generation_leases
       where lease_id=$1 and application_id=$2 and environment=$3 and delivery_class='hot-application' and extension_id=$4 and generation_id=$5 and expires_at>$6`,
      [claims.drainLeaseId, claims.applicationId, claims.environment, claims.appId, claims.generationId, this.now()]
    );
    return lease.rows.length === 1;
  }

  private now(): string {
    const now = this.clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new TypeError("Capability authority clock is invalid.");
    return now.toISOString();
  }
}

/** Durable, restart-safe capability replay protection for production gateways. */
export class PostgresExtensionCapabilitySequenceStore implements ExtensionCapabilitySequenceStore {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly clock: ExtensionCapabilityAuthorityClock) {}

  async claim(claims: ExtensionCapabilityClaims, sequence: number, maxCalls: number): Promise<boolean> {
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > maxCalls) return false;
    const now = this.now();
    const result = await this.pool.query<{ sequence: number }>(
      `with advanced as (
         update runtime_extension_capability_sequences
         set sequence=$11, expires_at=$12, updated_at=now()
         where application_id=$1 and environment=$2 and app_id=$3 and generation_id=$4 and invocation_id=$5 and token_id=$6 and issued_at=$7
           and principal_id=$8 and effective_actor_id=$9 and delegation_id=$10
           and sequence=$11-1 and expires_at>$13
         returning sequence
       ), initialized as (
       insert into runtime_extension_capability_sequences (
         application_id, environment, app_id, generation_id, invocation_id, token_id, issued_at,
         principal_id, effective_actor_id, delegation_id, sequence, expires_at
       ) select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
       where $11=1
       on conflict (application_id, environment, app_id, generation_id, invocation_id, token_id, issued_at, principal_id, effective_actor_id, delegation_id)
       do nothing
       returning sequence
       ) select sequence from advanced union all select sequence from initialized`,
      [
        claims.applicationId, claims.environment, claims.appId, claims.generationId, claims.invocationId, claims.tokenId, claims.issuedAt,
        claims.actor.principalId, claims.actor.effectiveActorId, claims.actor.delegationId ?? "", sequence, claims.expiresAt, now
      ]
    );
    return result.rows.length === 1;
  }

  private now(): string {
    const now = this.clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new TypeError("Capability sequence clock is invalid.");
    return now.toISOString();
  }
}
