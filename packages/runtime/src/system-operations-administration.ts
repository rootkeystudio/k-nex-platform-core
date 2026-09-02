import {
  AdministrationActorEnvelopeSchema,
  OperationsCenterReceiptSchema,
  OperationsCenterReferenceSchema,
  OperationsCenterRequestInputSchema,
  SystemHealthObservationSchema,
  canonicalJson,
  type AdministrationActorEnvelope,
  type AuthorizationDecision,
  type AuthorizationState,
  type OperationsCenterReceipt,
  type OperationsCenterReference,
  type SystemHealthObservation
} from "@k-nex/contracts";

import { CurrentAuthorityAdapter, createCurrentAuthorityTarget } from "./current-authority-adapter.js";

export type SystemOperationKind = "backup" | "restore-drill";
export type SystemOperationsAdministrationErrorCode = "UNAUTHORIZED" | "REVISION_CONFLICT" | "REQUEST_INVALID" | "APPROVAL_REQUIRED" | "OPERATOR_UNAVAILABLE";

export class SystemOperationsAdministrationError extends Error {
  constructor(readonly code: SystemOperationsAdministrationErrorCode, message: string) {
    super(message);
    this.name = "SystemOperationsAdministrationError";
  }
}

export interface SystemOperationsState extends AuthorizationState {
  readonly operationsRevision: number;
  readonly inventoryDigest: string;
}

export interface SystemOperationsStateSource {
  readState(applicationId: string, environment: string): Promise<SystemOperationsState | undefined>;
}

export interface SystemOperationsProjectionSource {
  read(input: Readonly<{ applicationId: string; environment: string }>): Promise<Readonly<{
    readonly operationsRevision: number;
    readonly inventoryDigest: string;
    readonly references: readonly OperationsCenterReference[];
    readonly health: readonly SystemHealthObservation[];
  }>>;
}

export interface SystemOperationsProjectionStateSource {
  read(applicationId: string, environment: string): Promise<Readonly<{ operationsRevision: number; inventoryDigest: string }> | undefined>;
}

export interface SystemOperationsReferenceSource {
  read(applicationId: string, environment: string): Promise<readonly OperationsCenterReference[]>;
}

export interface SystemHealthSource {
  read(applicationId: string, environment: string): Promise<readonly SystemHealthObservation[]>;
}

/** Joins references only; each owning subsystem remains the authoritative state machine. */
export class CompositeSystemOperationsProjection implements SystemOperationsProjectionSource {
  constructor(private readonly state: SystemOperationsProjectionStateSource, private readonly references: readonly SystemOperationsReferenceSource[], private readonly health: readonly SystemHealthSource[]) {}

  async read(input: Readonly<{ applicationId: string; environment: string }>): Promise<Readonly<{ operationsRevision: number; inventoryDigest: string; references: readonly OperationsCenterReference[]; health: readonly SystemHealthObservation[] }>> {
    const before = await this.state.read(input.applicationId, input.environment);
    if (!before) conflict();
    const [referenceGroups, healthGroups] = await Promise.all([
      Promise.all(this.references.map((source) => source.read(input.applicationId, input.environment))),
      Promise.all(this.health.map((source) => source.read(input.applicationId, input.environment)))
    ]);
    const references = unique(referenceGroups.flat().map((value) => Object.freeze(OperationsCenterReferenceSchema.parse(value))));
    const health = unique(healthGroups.flat().map((value) => {
      const parsed = SystemHealthObservationSchema.parse(value);
      if (parsed.applicationId !== input.applicationId || parsed.environment !== input.environment) conflict();
      return Object.freeze(parsed);
    }));
    const after = await this.state.read(input.applicationId, input.environment);
    if (!after || after.operationsRevision !== before.operationsRevision || after.inventoryDigest !== before.inventoryDigest) conflict();
    return Object.freeze({ operationsRevision: after.operationsRevision, inventoryDigest: after.inventoryDigest, references, health });
  }
}

export interface SystemOperationsOperator {
  replay(input: Readonly<{ kind: SystemOperationKind; applicationId: string; environment: string; expectedOperationsRevision: number; requestedBy: AuthorizationDecision["effectiveActor"]; authorityEnvelope: AdministrationActorEnvelope; idempotencyKey: string }>): Promise<OperationsCenterReceipt | undefined>;
  submit(input: Readonly<{
    readonly kind: SystemOperationKind;
    readonly applicationId: string;
    readonly environment: string;
    readonly expectedOperationsRevision: number;
    readonly expectedInventoryDigest: string;
    readonly requestedBy: AuthorizationDecision["effectiveActor"];
    readonly authorityEnvelope: AdministrationActorEnvelope;
    readonly idempotencyKey: string;
  }>): Promise<OperationsCenterReceipt>;
}

export interface SystemOperationsOperatorProvider<TContext> {
  resolve(context: TContext): Promise<SystemOperationsOperator | undefined> | SystemOperationsOperator | undefined;
}

export interface SystemOperationsEvidenceVerifier<TContext> {
  verify(input: Readonly<{ context: TContext; kind: SystemOperationKind; decision: AuthorizationDecision; state: SystemOperationsState }>): Promise<Readonly<{
    readonly reauthentication: "satisfied";
    readonly approval: "not-required" | "satisfied";
  }> | undefined> | Readonly<{ readonly reauthentication: "satisfied"; readonly approval: "not-required" | "satisfied" }> | undefined;
}

const readTarget = createCurrentAuthorityTarget({ permissionId: "system.operations.read", scope: { kind: "application", resource: "system.operations" }, facts: { boundary: "system-operations-administration" } });
const backupTarget = createCurrentAuthorityTarget({ permissionId: "system.operations.backup", scope: { kind: "application", resource: "system.operations" }, facts: { boundary: "system-operations-administration" } });
const restoreTarget = createCurrentAuthorityTarget({ permissionId: "system.operations.restore-drill", scope: { kind: "application", resource: "system.operations" }, facts: { boundary: "system-operations-administration" } });

export class SystemOperationsAdministrationService<TContext> {
  constructor(private readonly options: Readonly<{
    authority: CurrentAuthorityAdapter<TContext>;
    state: SystemOperationsStateSource;
    projection: SystemOperationsProjectionSource;
    operator: SystemOperationsOperatorProvider<TContext>;
    evidence: SystemOperationsEvidenceVerifier<TContext>;
  }>) {}

  async read(input: Readonly<{ context: TContext }>): Promise<Awaited<ReturnType<SystemOperationsProjectionSource["read"]>>> {
    exact(input, ["context"]);
    const decision = await this.authorize(input.context, "read");
    const state = await this.current(decision);
    const view = await this.options.projection.read({ applicationId: decision.applicationId, environment: decision.environment });
    validateProjection(view, state);
    const confirmed = await this.authorize(input.context, "read");
    if (!sameDecision(decision, confirmed)) unauthorized();
    await this.current(confirmed, state);
    return Object.freeze({ ...view, references: Object.freeze([...view.references]), health: Object.freeze([...view.health]) });
  }

  async request(input: Readonly<{ context: TContext; kind: SystemOperationKind; request: unknown }>): Promise<OperationsCenterReceipt> {
    exact(input, ["context", "kind", "request"]);
    if (input.kind !== "backup" && input.kind !== "restore-drill") invalid();
    const request = OperationsCenterRequestInputSchema.safeParse(input.request);
    if (!request.success) invalid();
    const decision = await this.authorize(input.context, input.kind);
    const state = await this.current(decision);
    const authorityEnvelope = actorEnvelope(decision);
    const authorityDigest = await digest(authorityEnvelope);
    const operator = await this.operator(input.context);
    const replay = await operator.replay({ kind: input.kind, applicationId: decision.applicationId, environment: decision.environment, expectedOperationsRevision: request.data.expectedOperationsRevision, requestedBy: decision.effectiveActor, authorityEnvelope, idempotencyKey: request.data.idempotencyKey });
    if (replay) return this.receipt(replay, input.kind, decision, undefined, authorityDigest, request.data.idempotencyKey);
    if (request.data.expectedOperationsRevision !== state.operationsRevision) conflict();
    const evidence = await this.options.evidence.verify({ context: input.context, kind: input.kind, decision, state });
    if (evidence?.reauthentication !== "satisfied") unauthorized();
    if (input.kind === "restore-drill" && evidence.approval !== "satisfied") throw new SystemOperationsAdministrationError("APPROVAL_REQUIRED", "Restore drill requires current server approval.");
    if (input.kind === "backup" && evidence.approval !== "not-required" && evidence.approval !== "satisfied") unauthorized();
    await this.current(decision, state);
    const receipt = await operator.submit({
      kind: input.kind,
      applicationId: decision.applicationId,
      environment: decision.environment,
      expectedOperationsRevision: state.operationsRevision,
      expectedInventoryDigest: state.inventoryDigest,
      requestedBy: decision.effectiveActor,
      authorityEnvelope,
      idempotencyKey: request.data.idempotencyKey
    });
    return this.receipt(receipt, input.kind, decision, state.inventoryDigest, authorityDigest, request.data.idempotencyKey);
  }

  private async authorize(context: TContext, operation: "read" | SystemOperationKind): Promise<AuthorizationDecision> {
    const target = operation === "read" ? readTarget : operation === "backup" ? backupTarget : restoreTarget;
    const decision = await this.options.authority.authorize(context, target);
    if (decision?.outcome !== "allow" || decision.permissionId !== target.permissionId || decision.scope.kind !== "application" || decision.scope.resource !== "system.operations") unauthorized();
    return decision;
  }

  private async current(decision: AuthorizationDecision, expected?: SystemOperationsState): Promise<SystemOperationsState> {
    const state = await this.options.state.readState(decision.applicationId, decision.environment);
    if (!state || state.authorizationRevision !== decision.authorizationRevision || state.lifecycleRevision !== decision.lifecycleRevision ||
      expected && (state.operationsRevision !== expected.operationsRevision || state.inventoryDigest !== expected.inventoryDigest)) conflict();
    return state;
  }

  private async operator(context: TContext): Promise<SystemOperationsOperator> {
    try {
      const value = await this.options.operator.resolve(context);
      if (value) return value;
    } catch { /* fail closed */ }
    throw new SystemOperationsAdministrationError("OPERATOR_UNAVAILABLE", "Trusted operations operator is unavailable.");
  }

  private receipt(value: unknown, kind: SystemOperationKind, decision: AuthorizationDecision, inventoryDigest: string | undefined, authorityDigest: string, idempotencyKey: string): OperationsCenterReceipt {
    const receipt = OperationsCenterReceiptSchema.safeParse(value);
    if (!receipt.success || receipt.data.kind !== kind || receipt.data.applicationId !== decision.applicationId ||
      receipt.data.environment !== decision.environment || inventoryDigest !== undefined && receipt.data.expectedInventoryDigest !== inventoryDigest ||
      receipt.data.requestedBy.kind !== decision.effectiveActor.kind || receipt.data.requestedBy.id !== decision.effectiveActor.id ||
      receipt.data.authorityDigest !== authorityDigest ||
      receipt.data.idempotencyKey !== idempotencyKey) throw new SystemOperationsAdministrationError("OPERATOR_UNAVAILABLE", "Trusted operation receipt is invalid.");
    return Object.freeze(receipt.data);
  }
}

function actorEnvelope(decision: AuthorizationDecision): AdministrationActorEnvelope {
  return AdministrationActorEnvelopeSchema.parse({
    schemaVersion: 1,
    applicationId: decision.applicationId,
    environment: decision.environment,
    principal: decision.principal,
    effectiveActor: decision.effectiveActor,
    ...(decision.delegation === undefined ? {} : { delegation: decision.delegation }),
    authorizationRevision: decision.authorizationRevision,
    lifecycleRevision: decision.lifecycleRevision,
    permissions: [{ decisionId: decision.decisionId, permissionId: decision.permissionId, owner: decision.owner, scope: decision.scope }]
  });
}

async function digest(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function validateProjection(value: Awaited<ReturnType<SystemOperationsProjectionSource["read"]>>, state: SystemOperationsState): void {
  if (value.operationsRevision !== state.operationsRevision || value.inventoryDigest !== state.inventoryDigest ||
    !value.references.every((entry) => OperationsCenterReferenceSchema.safeParse(entry).success) ||
    !value.health.every((entry) => SystemHealthObservationSchema.safeParse(entry).success)) conflict();
}

function sameDecision(left: AuthorizationDecision, right: AuthorizationDecision): boolean {
  return left.decisionId === right.decisionId && left.applicationId === right.applicationId && left.environment === right.environment &&
    left.authorizationRevision === right.authorizationRevision && left.lifecycleRevision === right.lifecycleRevision;
}

function unique<T>(values: readonly T[]): readonly T[] {
  const entries = new Map(values.map((value) => [canonicalJson(value), value]));
  return Object.freeze([...entries.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value));
}

function exact(value: unknown, keys: readonly string[]): void {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
function invalid(): never { throw new SystemOperationsAdministrationError("REQUEST_INVALID", "Operations administration input is invalid."); }
function conflict(): never { throw new SystemOperationsAdministrationError("REVISION_CONFLICT", "Operations authority or inventory changed."); }
function unauthorized(): never { throw new SystemOperationsAdministrationError("UNAUTHORIZED", "Current authority does not permit operations administration."); }
