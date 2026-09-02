import { AdministrationActorEnvelopeSchema, CatalogRefreshInputSchema, CatalogRefreshObservationSchema, CatalogRefreshReceiptSchema, ResumableCatalogRefreshOperationSchema, canonicalJson, type AdministrationActorEnvelope, type AuthorizationDecision, type AuthorizationState, type CatalogRefreshObservation, type CatalogRefreshReceipt, type ResumableCatalogRefreshOperation } from "@k-nex/contracts";

import { CurrentAuthorityAdapter, createCurrentAuthorityTarget } from "./current-authority-adapter.js";

export class SystemCatalogAdministrationError extends Error {
  constructor(readonly code: "UNAUTHORIZED" | "REQUEST_INVALID" | "REVISION_CONFLICT" | "OPERATOR_UNAVAILABLE", message: string) { super(message); this.name = "SystemCatalogAdministrationError"; }
}

export interface SystemCatalogAdministrationState extends AuthorizationState { readonly catalogRevision: number; }
export interface SystemCatalogRefreshOperator {
  refresh(input: Readonly<{ expectedCatalogRevision: number; requestedBy: AuthorizationDecision["effectiveActor"]; authorityEnvelope: AdministrationActorEnvelope; idempotencyKey: string; refreshId: string }>): Promise<unknown>;
}

const target = createCurrentAuthorityTarget({ permissionId: "system.catalog.refresh", scope: { kind: "application", resource: "system.catalog" }, facts: { boundary: "system-catalog-administration" } });

/** Fixed RBAC facade around the configured official-catalog refresh coordinator. */
export class SystemCatalogAdministrationService<TContext> {
  constructor(private readonly options: Readonly<{
    authority: CurrentAuthorityAdapter<TContext>;
    state: { readState(applicationId: string, environment: string): Promise<SystemCatalogAdministrationState | undefined> };
    observation: { readObservation(): Promise<CatalogRefreshObservation> };
    operator: { resolve(context: TContext): Promise<SystemCatalogRefreshOperator | undefined> | SystemCatalogRefreshOperator | undefined };
    id(): string;
  }>) {}

  async refresh(input: Readonly<{ context: TContext; request: unknown }>): Promise<CatalogRefreshReceipt | ResumableCatalogRefreshOperation> {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join("\0") !== "context\0request") this.fail("REQUEST_INVALID");
    const request = CatalogRefreshInputSchema.safeParse(input.request);
    if (!request.success) this.fail("REQUEST_INVALID");
    const decision = await this.options.authority.authorize(input.context, target);
    if (decision?.outcome !== "allow" || decision.permissionId !== target.permissionId || decision.scope.kind !== "application" || decision.scope.resource !== "system.catalog") this.fail("UNAUTHORIZED");
    const before = await this.options.state.readState(decision.applicationId, decision.environment);
    if (!before || before.authorizationRevision !== decision.authorizationRevision || before.lifecycleRevision !== decision.lifecycleRevision || before.catalogRevision !== request.data.expectedCatalogRevision) this.fail("REVISION_CONFLICT");
    const observation = CatalogRefreshObservationSchema.parse(await this.options.observation.readObservation());
    if (observation.catalogRevision !== before.catalogRevision) this.fail("REVISION_CONFLICT");
    const operator = await this.options.operator.resolve(input.context);
    if (!operator) this.fail("OPERATOR_UNAVAILABLE");
    const authorityEnvelope = AdministrationActorEnvelopeSchema.parse({
      schemaVersion: 1, applicationId: decision.applicationId, environment: decision.environment,
      principal: decision.principal, effectiveActor: decision.effectiveActor,
      ...(decision.delegation === undefined ? {} : { delegation: decision.delegation }),
      authorizationRevision: decision.authorizationRevision, lifecycleRevision: decision.lifecycleRevision,
      permissions: [{ decisionId: decision.decisionId, permissionId: decision.permissionId, owner: decision.owner, scope: decision.scope }]
    });
    const expectedAuthorityDigest = await digest(authorityEnvelope);
    const result = await operator.refresh({ expectedCatalogRevision: before.catalogRevision, requestedBy: decision.effectiveActor, authorityEnvelope, idempotencyKey: request.data.idempotencyKey, refreshId: this.options.id() });
    const receipt = CatalogRefreshReceiptSchema.safeParse(result);
    if (receipt.success && receipt.data.authorityDigest === expectedAuthorityDigest) return receipt.data;
    const resumable = ResumableCatalogRefreshOperationSchema.safeParse(result);
    if (resumable.success && resumable.data.authorityDigest === expectedAuthorityDigest) return resumable.data;
    this.fail("OPERATOR_UNAVAILABLE");
  }

  private fail(code: SystemCatalogAdministrationError["code"]): never {
    throw new SystemCatalogAdministrationError(code, code === "UNAUTHORIZED" ? "Current authority does not permit catalog refresh." : code === "REQUEST_INVALID" ? "Catalog refresh input is invalid." : code === "REVISION_CONFLICT" ? "Catalog authority or revision changed." : "Catalog refresh operator is unavailable.");
  }
}

async function digest(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
