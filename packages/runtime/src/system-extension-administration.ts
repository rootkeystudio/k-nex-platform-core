import {
  compareExactSemverPrecedence,
  ExtensionAdministrationActionViewSchema,
  ExtensionIdentitySchema,
  type AuthorizationDecision,
  type AuthorizationState,
  type ExtensionAdministrationActionView,
  type ExtensionIdentity
} from "@k-nex/contracts";

import { type AuthorizationExpectedRevision } from "./authorization-store.js";
import { CurrentAuthorityAdapter, createCurrentAuthorityTarget } from "./current-authority-adapter.js";
import { ExtensionOperatorApi, type ExtensionCatalogRecord, type ExtensionSystemStatus } from "./extension-operator-api.js";
import { admittedExtensionOperations, extensionInventoryState, type ExtensionChangeRequest, type ExtensionInventoryState, type ExtensionOperationStatus, type PluginManagerPlan } from "./plugin-manager.js";

export type SystemExtensionAdministrationErrorCode = "UNAUTHORIZED" | "REVISION_CONFLICT" | "REQUEST_INVALID" | "APPROVAL_REQUIRED" | "EXECUTION_UNAVAILABLE";

export class SystemExtensionAdministrationError extends Error {
  constructor(readonly code: SystemExtensionAdministrationErrorCode, message: string) {
    super(message);
    this.name = "SystemExtensionAdministrationError";
  }
}

/** Current PostgreSQL-backed authority/lifecycle state; this facade owns no cache or shadow revision. */
export interface SystemExtensionAdministrationStateSource {
  readState(applicationId: string, environment: string): Promise<AuthorizationState | undefined>;
}

export interface SystemExtensionOperationApprovalVerifier<TContext> {
  verify(input: Readonly<{
    context: TContext;
    expected: SystemExtensionExpectedRevision;
    operation: ExtensionOperationStatus;
  }>): Promise<boolean> | boolean;
}

/** Trusted server boundary that binds the Phase 9 operator to the current opaque request context. */
export interface SystemExtensionOperatorProvider<TContext> {
  resolve(context: TContext): Promise<ExtensionOperatorApi | undefined> | ExtensionOperatorApi | undefined;
}

export interface SystemExtensionAdministrationOptions<TContext> {
  readonly operator: SystemExtensionOperatorProvider<TContext>;
  readonly authority: CurrentAuthorityAdapter<TContext>;
  readonly state: SystemExtensionAdministrationStateSource;
  readonly approval?: SystemExtensionOperationApprovalVerifier<TContext>;
}

export interface SystemExtensionExpectedRevision extends AuthorizationExpectedRevision {
  readonly inventoryRevision: number;
  readonly extensionRevision: number;
}

export type SystemExtensionDisplay =
  | Readonly<{ readonly outcome: "install-live"; readonly deliveryClass: "hot-application" | "theme-skin" }>
  | Readonly<{ readonly outcome: "no-outage-deployment"; readonly deliveryClass: "platform-plugin" }>
  | Readonly<{ readonly outcome: "maintenance-required"; readonly deliveryClass: "platform-plugin"; readonly reasons: readonly string[] }>
  | Readonly<{ readonly outcome: "unsupported"; readonly deliveryClass: "platform-plugin"; readonly reasons: readonly string[] }>;

export interface SystemExtensionPlan {
  readonly operationId: string;
  readonly executionClass: PluginManagerPlan["executionClass"];
  /** The manager's canonical plan is the impact preview; no client reclassifies it. */
  readonly impact: PluginManagerPlan["plan"];
  readonly approvalRequired: boolean;
  readonly display: SystemExtensionDisplay;
}

export interface SystemExtensionExecution {
  readonly result: Awaited<ReturnType<ExtensionOperatorApi["activate"]>>;
  readonly status: SystemExtensionOperationStatus;
}

/** Deliberately excludes the persisted actor, approval ID, request digest, and idempotency key. */
export interface SystemExtensionOperationStatus {
  readonly operationId: string;
  readonly operation: ExtensionChangeRequest["operation"];
  readonly extension: ExtensionIdentity;
  readonly phase: ExtensionOperationStatus["phase"];
  readonly executionClass?: PluginManagerPlan["executionClass"];
  readonly approvalRequired?: boolean;
  readonly result?: ExtensionOperationStatus["result"];
}

const readTarget = createCurrentAuthorityTarget({
  permissionId: "system.extensions.read",
  scope: { kind: "application", resource: "system.extensions" },
  facts: { boundary: "system-extension-administration" }
});
const planTarget = createCurrentAuthorityTarget({
  permissionId: "system.extensions.plan",
  scope: { kind: "application", resource: "system.extensions" },
  facts: { boundary: "system-extension-administration" }
});

/**
 * Server-only facade for `/system/extensions`. Client input never supplies an
 * authority target, actor, approval, application owner, or lifecycle scope.
 */
export class SystemExtensionAdministrationService<TContext> {
  constructor(private readonly options: SystemExtensionAdministrationOptions<TContext>) {}

  async list(input: Readonly<{ readonly context: TContext; readonly includeUnavailable?: boolean }>): Promise<readonly ExtensionCatalogRecord[]> {
    exactInput(input, ["context", "includeUnavailable"], ["includeUnavailable"]);
    if (input.includeUnavailable !== undefined && typeof input.includeUnavailable !== "boolean") invalid("Extension catalog input is invalid.");
    await this.readDecision(input.context);
    return (await this.operator(input.context)).catalogList(input.includeUnavailable === true ? { includeUnavailable: true } : {});
  }

  async detail(input: Readonly<{ readonly context: TContext; readonly extension: unknown; readonly version: string }>): Promise<ExtensionCatalogRecord | undefined> {
    exactInput(input, ["context", "extension", "version"]);
    const extension = ExtensionIdentitySchema.safeParse(input.extension);
    if (!extension.success || typeof input.version !== "string") invalid("Extension catalog detail is invalid.");
    await this.readDecision(input.context);
    return (await this.operator(input.context)).catalogDetail(extension.data, input.version);
  }

  async status(input: Readonly<{ readonly context: TContext }>): Promise<ExtensionSystemStatus> {
    exactInput(input, ["context"]);
    const decision = await this.readDecision(input.context);
    return (await this.operator(input.context)).status(decision.applicationId, decision.environment);
  }

  /** Immutable server projection from the exact accepted catalog records and current verified inventory. */
  async actions(input: Readonly<{ readonly context: TContext }>): Promise<readonly ExtensionAdministrationActionView[]> {
    exactInput(input, ["context"]);
    const decision = await this.readDecision(input.context);
    const operator = await this.operator(input.context);
    const [catalog, status] = await Promise.all([
      operator.catalogList({ includeUnavailable: true }),
      operator.status(decision.applicationId, decision.environment)
    ]);
    return projectExtensionAdministrationActions(status.inventory, catalog);
  }

  async operationStatus(input: Readonly<{ readonly context: TContext; readonly operationId: string }>): Promise<SystemExtensionOperationStatus> {
    exactInput(input, ["context", "operationId"]);
    if (!validId(input.operationId)) invalid("Extension operation ID is invalid.");
    const decision = await this.readDecision(input.context);
    const operation = await (await this.operator(input.context)).operation(input.operationId);
    if (operation.request.applicationId !== decision.applicationId || operation.request.environment !== decision.environment) unauthorized();
    return operationStatus(operation);
  }

  async plan(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly request: unknown }>): Promise<SystemExtensionPlan> {
    exactInput(input, ["context", "expected", "request"]);
    const expected = parseExpected(input.expected);
    const request = parseRequest(input.request, expected);
    await this.planDecision(input.context, expected);
    const operator = await this.operator(input.context);
    await this.current(expected, operator, request.extension);
    const plan = await operator.plan(request);
    return Object.freeze({
      operationId: plan.operationId,
      executionClass: plan.executionClass,
      impact: plan.plan,
      approvalRequired: plan.plan.approvalRequired,
      display: display(plan)
    });
  }

  /**
   * Stages only live install/update bytes, then asks the owning authority for
   * validation. The durable PluginManager operation remains the only state
   * record across page reloads and worker recreation.
   */
  async validate(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly operationId: string }>): Promise<Awaited<ReturnType<ExtensionOperatorApi["validate"]>>> {
    exactInput(input, ["context", "expected", "operationId"]);
    const expected = parseExpected(input.expected);
    if (!validId(input.operationId)) invalid("Extension operation ID is invalid.");
    await this.planDecision(input.context, expected);
    const operator = await this.operator(input.context);
    await this.current(expected, operator);
    const operation = await this.boundOperation(expected, operator, input.operationId);
    await this.current(expected, operator, operation.request.extension);
    const report = await this.prepare(operator, expected, operation);
    await this.current(expected, operator, operation.request.extension);
    return report;
  }

  async execute(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly operationId: string }>): Promise<SystemExtensionExecution> {
    exactInput(input, ["context", "expected", "operationId"]);
    const expected = parseExpected(input.expected);
    if (!validId(input.operationId)) invalid("Extension operation ID is invalid.");
    await this.planDecision(input.context, expected);
    const operator = await this.operator(input.context);
    await this.current(expected, operator);
    const operation = await this.boundOperation(expected, operator, input.operationId);
    if (staticExecutionUnavailable(operation)) unavailable("This Platform Plugin plan requires explicit maintenance or is not supported; web administration cannot execute it.");
    await this.current(expected, operator, operation.request.extension);
    if (liveActivation(operation) || operation.plan!.executionClass === "static-release") {
      if (liveActivation(operation) && !validLiveActivationPhase(operation.phase)) {
        unavailable("Live extension install and update must be staged and validated before execution.");
      }
      const report = await operator.validate(operation.operationId);
      if (!report.valid) unavailable("The current extension operation is not ready for execution.");
      await this.current(expected, operator, operation.request.extension);
    }
    if (operation.plan!.plan.approvalRequired) {
      if (!this.options.approval || !await this.options.approval.verify({ context: input.context, expected, operation })) {
        throw new SystemExtensionAdministrationError("APPROVAL_REQUIRED", "A server-verified approval is required for this extension operation.");
      }
    }
    const result = await execute(operator, operation);
    return Object.freeze({ result, status: operationStatus(await operator.operation(operation.operationId)) });
  }

  private async readDecision(context: TContext): Promise<AuthorizationDecision> {
    const decision = await this.options.authority.authorize(context, readTarget);
    if (!allowsRead(decision)) unauthorized();
    const current = await this.options.state.readState(decision.applicationId, decision.environment);
    if (!current || current.authorizationRevision !== decision.authorizationRevision || current.lifecycleRevision !== decision.lifecycleRevision) conflict("Authorization state changed before extension administration.");
    return decision;
  }

  private async operator(context: TContext): Promise<ExtensionOperatorApi> {
    try {
      const operator = await this.options.operator.resolve(context);
      if (!operator) unauthorized();
      return operator;
    } catch {
      unauthorized();
    }
  }

  private async current(expected: SystemExtensionExpectedRevision, operator: ExtensionOperatorApi, extension?: ExtensionIdentity): Promise<void> {
    const [current, status] = await Promise.all([
      this.options.state.readState(expected.applicationId, expected.environment),
      operator.status(expected.applicationId, expected.environment)
    ]);
    if (!current || current.authorizationRevision !== expected.authorizationRevision || current.lifecycleRevision !== expected.lifecycleRevision) {
      conflict("Authorization or lifecycle state changed before extension operation.");
    }
    if (status.inventory.revision !== expected.inventoryRevision) conflict("Extension inventory changed before extension operation.");
    if (extension && inventoryEntryRevision(status.inventory, extension) !== expected.extensionRevision) {
      conflict("Target extension changed before extension operation.");
    }
  }

  private async boundOperation(expected: SystemExtensionExpectedRevision, operator: ExtensionOperatorApi, operationId: string): Promise<ExtensionOperationStatus> {
    const operation = await operator.operation(operationId);
    if (operation.request.applicationId !== expected.applicationId || operation.request.environment !== expected.environment ||
      operation.request.expectedRevision !== expected.extensionRevision || !operation.plan) conflict("Extension operation is stale or unavailable.");
    return operation;
  }

  private async prepare(
    operator: ExtensionOperatorApi,
    expected: SystemExtensionExpectedRevision,
    operation: ExtensionOperationStatus
  ): Promise<Awaited<ReturnType<ExtensionOperatorApi["validate"]>>> {
    if (operation.plan!.executionClass === "live-generation" && ["install", "update"].includes(operation.request.operation)) {
      await operator.stage(operation.operationId);
      const staged = await this.boundOperation(expected, operator, operation.operationId);
      await this.current(expected, operator, staged.request.extension);
      return operator.validate(staged.operationId);
    }
    return operator.validate(operation.operationId);
  }

  private async planDecision(context: TContext, expected: SystemExtensionExpectedRevision): Promise<void> {
    const decision = await this.options.authority.authorize(context, planTarget);
    if (!allowsPlan(decision) || decision.applicationId !== expected.applicationId || decision.environment !== expected.environment) unauthorized();
    if (decision.authorizationRevision !== expected.authorizationRevision || decision.lifecycleRevision !== expected.lifecycleRevision) {
      conflict("Authorization decision is stale for extension planning.");
    }
  }
}

type AdministrationAction = "install" | "re-enable" | "update" | "disable" | "rollback" | "uninstall";

/**
 * Projects only operations admitted by PluginManager's shared current-inventory
 * admission table. The catalog merely supplies currently installable releases;
 * it never supplies lifecycle state or authority.
 */
export function projectExtensionAdministrationActions(
  inventory: ExtensionSystemStatus["inventory"],
  catalog: readonly ExtensionCatalogRecord[]
): readonly ExtensionAdministrationActionView[] {
  const identities = new Map<string, ExtensionIdentity>();
  for (const record of catalog) identities.set(identityKey(record.extension), ExtensionIdentitySchema.parse(record.extension));
  for (const [id] of Object.entries(inventory.extensions.platformPlugins)) identities.set(identityKey({ deliveryClass: "platform-plugin", id }), { deliveryClass: "platform-plugin", id });
  for (const [id] of Object.entries(inventory.extensions.hotApplications)) identities.set(identityKey({ deliveryClass: "hot-application", id }), { deliveryClass: "hot-application", id });
  for (const [id] of Object.entries(inventory.extensions.themeSkins)) identities.set(identityKey({ deliveryClass: "theme-skin", id }), { deliveryClass: "theme-skin", id });

  const result: ExtensionAdministrationActionView[] = [];
  for (const extension of [...identities.values()].sort((left, right) => identityKey(left).localeCompare(identityKey(right)))) {
    const state = extensionInventoryState(inventory, extension);
    const releases = catalog.filter((record) => sameIdentity(record.extension, extension) && currentlyInstallable(record));
    const admitted = new Set(admittedExtensionOperations(state.disposition));
    if ((state.disposition === "fresh" || state.disposition === "removed") && admitted.has("install") && releases.length > 0) {
      result.push(actionView(extension, state.disposition === "fresh" ? "catalog-available" : "removed", "install"));
    }
    if (state.disposition === "active") {
      if (admitted.has("update") && state.currentVersion && releases.some((record) => compareExactSemverPrecedence(record.version, state.currentVersion!) > 0)) {
        result.push(actionView(extension, "update-available", "update"));
      }
      if (admitted.has("disable")) result.push(actionView(extension, "active", "disable"));
      if (admitted.has("rollback") && state.rollbackGenerationId) result.push(actionView(extension, "rollback-available", "rollback"));
      if (admitted.has("uninstall")) result.push(actionView(extension, "active", "uninstall"));
    }
    if (state.disposition === "disabled") {
      if (admitted.has("install") && state.currentGenerationId && state.currentVersion && releases.some((record) => record.version === state.currentVersion)) {
        result.push(actionView(extension, "disabled", "re-enable"));
      }
      if (admitted.has("uninstall")) result.push(actionView(extension, "disabled", "uninstall"));
    }
    if (state.disposition === "quarantined") {
      if (admitted.has("update") && state.currentVersion && releases.some((record) => compareExactSemverPrecedence(record.version, state.currentVersion!) > 0)) {
        result.push(actionView(extension, "quarantined", "update"));
      }
      if (admitted.has("uninstall")) result.push(actionView(extension, "quarantined", "uninstall"));
    }
  }
  return Object.freeze(result);
}

function actionView(extension: ExtensionIdentity, lifecycleState: ExtensionAdministrationActionView["lifecycleState"], action: AdministrationAction): ExtensionAdministrationActionView {
  const base = { id: extension.id, deliveryClass: extension.deliveryClass, lifecycleState, availability: "available", reauthentication: "required" } as const;
  switch (action) {
    case "install": return Object.freeze(ExtensionAdministrationActionViewSchema.parse({
      ...base, action, executableOperation: "install",
      permissionId: extension.deliveryClass === "platform-plugin" ? "system.extensions.deploy-platform-plugin" : "system.extensions.install-live",
      approval: extension.deliveryClass === "platform-plugin" ? "required" : "canonical-plan"
    }));
    case "re-enable": return Object.freeze(ExtensionAdministrationActionViewSchema.parse({ ...base, action, executableOperation: "install", permissionId: "system.extensions.enable", approval: "canonical-plan" }));
    case "update": return Object.freeze(ExtensionAdministrationActionViewSchema.parse({ ...base, action, executableOperation: "update", permissionId: "system.extensions.update", approval: "canonical-plan" }));
    case "disable": return Object.freeze(ExtensionAdministrationActionViewSchema.parse({ ...base, action, executableOperation: "disable", permissionId: "system.extensions.disable", approval: "canonical-plan" }));
    case "rollback": return Object.freeze(ExtensionAdministrationActionViewSchema.parse({ ...base, action, executableOperation: "rollback", permissionId: "system.extensions.rollback", approval: "canonical-plan" }));
    case "uninstall": return Object.freeze(ExtensionAdministrationActionViewSchema.parse({ ...base, action, executableOperation: "uninstall", permissionId: "system.extensions.uninstall", approval: "required" }));
  }
}

function currentlyInstallable(record: ExtensionCatalogRecord): boolean {
  return !record.revoked && record.review === "approved" && record.security === "clear" && record.support === "supported";
}

function sameIdentity(left: ExtensionIdentity, right: ExtensionIdentity): boolean {
  return left.deliveryClass === right.deliveryClass && left.id === right.id;
}

function identityKey(extension: ExtensionIdentity): string { return `${extension.deliveryClass}:${extension.id}`; }

/** Revision fencing reads only the target entry's persisted revision, not generation evidence. */
function inventoryEntryRevision(inventory: ExtensionSystemStatus["inventory"], extension: ExtensionIdentity): number {
  const entries = extension.deliveryClass === "platform-plugin" ? inventory.extensions.platformPlugins
    : extension.deliveryClass === "hot-application" ? inventory.extensions.hotApplications : inventory.extensions.themeSkins;
  return entries[extension.id]?.revision ?? 0;
}

async function execute(operator: ExtensionOperatorApi, operation: ExtensionOperationStatus): Promise<Awaited<ReturnType<ExtensionOperatorApi["activate"]>>> {
  switch (operation.request.operation) {
    case "install":
    case "update": return operator.activate(operation.operationId);
    case "rollback": return operator.rollback(operation.operationId);
    case "disable": return operator.disable(operation.operationId);
    case "uninstall": return operator.uninstall(operation.operationId);
  }
}

function liveActivation(operation: ExtensionOperationStatus): boolean {
  return operation.plan?.executionClass === "live-generation" && ["install", "update"].includes(operation.request.operation);
}

function validLiveActivationPhase(phase: ExtensionOperationStatus["phase"]): boolean {
  return phase === "staged" || phase === "warming";
}

function staticExecutionUnavailable(operation: ExtensionOperationStatus): boolean {
  return operation.plan?.executionClass === "static-release" &&
    ["maintenance-required", "unsupported"].includes(operation.plan.plan.availability.outcome);
}

function display(plan: PluginManagerPlan): SystemExtensionDisplay {
  const impact = plan.plan;
  if (impact.deliveryClass === "hot-application" || impact.deliveryClass === "theme-skin") {
    return Object.freeze({ outcome: "install-live", deliveryClass: impact.deliveryClass });
  }
  switch (impact.availability.outcome) {
    case "zero-downtime-eligible": return Object.freeze({ outcome: "no-outage-deployment", deliveryClass: "platform-plugin" });
    case "maintenance-required": return Object.freeze({ outcome: "maintenance-required", deliveryClass: "platform-plugin", reasons: impact.availability.reasons });
    case "unsupported": return Object.freeze({ outcome: "unsupported", deliveryClass: "platform-plugin", reasons: impact.availability.reasons });
  }
}

function operationStatus(operation: ExtensionOperationStatus): SystemExtensionOperationStatus {
  return Object.freeze({
    operationId: operation.operationId,
    operation: operation.request.operation,
    extension: Object.freeze({ ...operation.request.extension }),
    phase: operation.phase,
    ...(operation.plan ? { executionClass: operation.plan.executionClass, approvalRequired: operation.plan.plan.approvalRequired } : {}),
    ...(operation.result ? { result: operation.result } : {})
  });
}

function parseExpected(value: unknown): SystemExtensionExpectedRevision {
  const input = exactObject(value, ["applicationId", "authorizationRevision", "environment", "extensionRevision", "inventoryRevision", "lifecycleRevision"]);
  if (!validOwner(input.applicationId) || !validOwnerEnvironment(input.environment) || !revision(input.authorizationRevision) || !revision(input.lifecycleRevision) || !revision(input.inventoryRevision) || !revision(input.extensionRevision)) {
    conflict("Extension administration expected revision is invalid.");
  }
  return Object.freeze({ applicationId: input.applicationId, environment: input.environment, authorizationRevision: input.authorizationRevision, lifecycleRevision: input.lifecycleRevision, inventoryRevision: input.inventoryRevision, extensionRevision: input.extensionRevision });
}

function parseRequest(value: unknown, expected: SystemExtensionExpectedRevision): ExtensionChangeRequest {
  const input = exactObject(value, ["extension", "idempotencyKey", "operation", "targetVersion"]);
  const extension = ExtensionIdentitySchema.safeParse(input.extension);
  const operation = input.operation;
  const targetVersion = input.targetVersion;
  const idempotencyKey = input.idempotencyKey;
  if (!extension.success || typeof operation !== "string" || !["install", "update", "disable", "rollback", "uninstall"].includes(operation) || typeof targetVersion !== "string" ||
    typeof idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(idempotencyKey)) invalid("Extension lifecycle request is invalid.");
  return Object.freeze({
    applicationId: expected.applicationId,
    environment: expected.environment,
    extension: extension.data,
    operation: operation as ExtensionChangeRequest["operation"],
    targetVersion,
    expectedRevision: expected.extensionRevision,
    idempotencyKey,
    correlationId: "system-extension-administration"
  });
}

function allowsRead(decision: AuthorizationDecision | undefined): decision is AuthorizationDecision {
  return decision?.outcome === "allow" && decision.permissionId === readTarget.permissionId && decision.scope.kind === "application" &&
    decision.scope.resource === "system.extensions";
}

function allowsPlan(decision: AuthorizationDecision | undefined): decision is AuthorizationDecision {
  return decision?.outcome === "allow" && decision.permissionId === planTarget.permissionId && decision.scope.kind === "application" &&
    decision.scope.resource === "system.extensions";
}

function exactInput(value: unknown, keys: readonly string[], optional: readonly string[] = []): void { exactObject(value, keys, optional); }

function exactObject(value: unknown, keys: readonly string[], optional: readonly string[] = []): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Extension administration input is invalid.");
  const input = value as Readonly<Record<string, unknown>>;
  const actual = Object.keys(input).sort();
  const allowed = [...keys].sort();
  if (actual.some((key) => !allowed.includes(key)) || keys.some((key) => !optional.includes(key) && !(key in input))) invalid("Extension administration input is invalid.");
  return input;
}

function validOwner(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{2,127}$/u.test(value); }
function validOwnerEnvironment(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{1,63}$/u.test(value); }
function revision(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function validId(value: string): boolean { return /^[a-z][a-z0-9-]{2,127}$/u.test(value); }
function invalid(message: string): never { throw new SystemExtensionAdministrationError("REQUEST_INVALID", message); }
function conflict(message: string): never { throw new SystemExtensionAdministrationError("REVISION_CONFLICT", message); }
function unavailable(message: string): never { throw new SystemExtensionAdministrationError("EXECUTION_UNAVAILABLE", message); }
function unauthorized(): never { throw new SystemExtensionAdministrationError("UNAUTHORIZED", "Current authority does not permit extension administration."); }
