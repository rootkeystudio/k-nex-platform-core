import { createHash } from "node:crypto";

import {
  AdministrationActorEnvelopeSchema,
  AdministrationOperatorAuthenticatedCommandSchema,
  AdministrationOperatorResponseSchema,
  AuthorizationStateSchema,
  RuntimeExtensionInventorySchema,
  administrationOperatorRequestDigestInput,
  canonicalJson,
  isAdministrationOperatorCommandActiveAt,
  type AdministrationActorEnvelope,
  type AdministrationOperatorAuthenticatedCommand,
  type AdministrationOperatorResponse,
  type AuthorizationState,
  type RuntimeExtensionInventory
} from "@k-nex/contracts";
import type { ExtensionChangeRequest, ExtensionOperatorApi, RuntimeExtensionOperation } from "@k-nex/runtime";

import { remoteAdministrationExtensionOperationDigest } from "./remote-administration-extension-operator.js";
import type { PostgresRuntimeExtensionStore } from "./runtime-extension-store.js";

export interface AdministrationExtensionCommandHandlerOptions {
  readonly applicationId: string;
  readonly environment: string;
  readonly operatorIdentity: string;
  readonly clock: () => Date;
  readonly authorizationState: Readonly<{ readState(applicationId: string, environment: string): Promise<AuthorizationState | undefined> }>;
  readonly store: Pick<PostgresRuntimeExtensionStore, "inventory" | "readOperation" | "readOperationByIdempotency" | "claimExecutionRequestDigest" | "executionRequestDigest">;
  readonly operatorForActor: (actor: AdministrationActorEnvelope) => ExtensionOperatorApi | Promise<ExtensionOperatorApi>;
}

/** Deployment-side admission for the closed extension lifecycle command family. */
export class AdministrationExtensionCommandHandler {
  constructor(private readonly options: AdministrationExtensionCommandHandlerOptions) {
    if (!validOwner(options.applicationId, options.environment) || !validOperatorIdentity(options.operatorIdentity)) {
      throw new TypeError("Administration extension command handler configuration is invalid.");
    }
  }

  async handle(input: AdministrationOperatorAuthenticatedCommand): Promise<AdministrationOperatorResponse> {
    const authenticated = AdministrationOperatorAuthenticatedCommandSchema.parse(input);
    const { command } = authenticated;
    if ((command.kind !== "extension-plan" && command.kind !== "extension-execute") ||
      command.actor.applicationId !== this.options.applicationId || command.actor.environment !== this.options.environment ||
      !isAdministrationOperatorCommandActiveAt(command, now(this.options.clock))) {
      throw new TypeError("Administration extension command is not admissible.");
    }

    const actor = immutableActor(command.actor);
    if (command.kind === "extension-plan") {
      const request = planRequest(command, requestDigest(authenticated), this.options.applicationId, this.options.environment);
      const replay = await this.options.store.readOperationByIdempotency(request);
      if (replay) return this.response(authenticated, exactPlanReplay(replay, request, actor));
    } else {
      const operation = await this.boundOperation(command.operationId);
      if (operation.phase === "completed" && operation.result) {
        if (await this.options.store.executionRequestDigest({ operationId: operation.operationId, applicationId: this.options.applicationId, environment: this.options.environment }) !== requestDigest(authenticated)) {
          throw new TypeError("Administration execution replay does not match its durable request.");
        }
        const inventory = await this.options.store.inventory(this.options.applicationId, this.options.environment);
        return this.response(authenticated, exactExecuteReplay(command, operation, actor, inventory));
      }
    }
    const [state, inventory] = await Promise.all([
      this.options.authorizationState.readState(this.options.applicationId, this.options.environment),
      this.options.store.inventory(this.options.applicationId, this.options.environment)
    ]);
    assertCurrent(state, actor);
    const currentInventory = assertInventory(inventory, this.options.applicationId, this.options.environment, command.expected.inventoryRevision);

    const operation = command.kind === "extension-plan"
      ? await this.plan(command, actor, currentInventory, planRequest(command, requestDigest(authenticated), this.options.applicationId, this.options.environment))
      : await this.execute(command, actor, currentInventory, requestDigest(authenticated));
    return this.response(authenticated, operation);
  }

  private response(authenticated: AdministrationOperatorAuthenticatedCommand, operation: RuntimeExtensionOperation): AdministrationOperatorResponse {
    return AdministrationOperatorResponseSchema.parse({
      schemaVersion: 1,
      outcome: "accepted",
      requestDigest: requestDigest(authenticated),
      authoritativeResult: { kind: "operation", operationId: operation.operationId },
      resultDigest: remoteAdministrationExtensionOperationDigest(operation),
      operatorIdentity: this.options.operatorIdentity
    });
  }

  private async plan(
    command: Extract<AdministrationOperatorAuthenticatedCommand["command"], { kind: "extension-plan" }>,
    actor: AdministrationActorEnvelope,
    inventory: RuntimeExtensionInventory,
    request: ExtensionChangeRequest
  ): Promise<RuntimeExtensionOperation> {
    if (entryRevision(inventory, command.extension) !== command.expected.extensionRevision) {
      throw new TypeError("Extension target revision is stale.");
    }
    const plan = await (await this.options.operatorForActor(actor)).plan(request);
    const operation = await this.boundOperation(plan.operationId);
    if (!operation.plan || canonicalJson(operation.request) !== canonicalJson(request) || canonicalJson(operation.plan) !== canonicalJson(plan)) {
      throw new TypeError("Durable extension operation does not bind the command.");
    }
    return operation;
  }

  private async execute(
    command: Extract<AdministrationOperatorAuthenticatedCommand["command"], { kind: "extension-execute" }>,
    actor: AdministrationActorEnvelope,
    inventory: RuntimeExtensionInventory,
    commandDigest: string
  ): Promise<RuntimeExtensionOperation> {
    const before = await this.boundOperation(command.operationId);
    const request = canonicalJson(before.request);
    const revision = entryRevision(inventory, before.request.extension);
    const impactOnlyStatic = before.plan?.executionClass === "static-release" && before.plan.preparation === "impact-only";
    if (!before.plan || revision !== command.expected.extensionRevision ||
      (impactOnlyStatic ? before.request.expectedRevision !== revision : before.request.expectedRevision >= revision || entry(inventory, before.request.extension)?.lastOperationId !== before.operationId)) {
      throw new TypeError("Extension operation no longer owns the current target.");
    }
    await this.options.store.claimExecutionRequestDigest({ operationId: before.operationId, applicationId: this.options.applicationId, environment: this.options.environment, requestDigest: commandDigest });
    const operator = await this.options.operatorForActor(actor);
    switch (before.request.operation) {
      case "install":
      case "update": await operator.activate(before.operationId); break;
      case "rollback": await operator.rollback(before.operationId); break;
      case "disable": await operator.disable(before.operationId); break;
      case "uninstall": await operator.uninstall(before.operationId); break;
    }
    const after = await this.boundOperation(before.operationId);
    if (after.phase !== "completed" || !after.result || canonicalJson(after.request) !== request) {
      throw new TypeError("Extension execution did not produce the bound durable result.");
    }
    return after;
  }

  private async boundOperation(operationId: string): Promise<RuntimeExtensionOperation> {
    const operation = await this.options.store.readOperation(operationId);
    if (!operation || operation.operationId !== operationId || operation.request.applicationId !== this.options.applicationId || operation.request.environment !== this.options.environment) {
      throw new TypeError("Extension operation is unavailable.");
    }
    return operation;
  }
}

function now(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new TypeError("Administration command clock is invalid.");
  return value.toISOString();
}

function immutableActor(value: AdministrationActorEnvelope): AdministrationActorEnvelope {
  const parsed = AdministrationActorEnvelopeSchema.parse(value);
  return Object.freeze({
    ...parsed,
    principal: Object.freeze({ ...parsed.principal }),
    effectiveActor: Object.freeze({ ...parsed.effectiveActor }),
    ...(parsed.delegation === undefined ? {} : { delegation: Object.freeze({ ...parsed.delegation }) }),
    permissions: Object.freeze(parsed.permissions.map((permission) => Object.freeze({ ...permission, owner: Object.freeze({ ...permission.owner }), scope: Object.freeze({ ...permission.scope }) })))
  }) as AdministrationActorEnvelope;
}

function assertCurrent(state: AuthorizationState | undefined, actor: AdministrationActorEnvelope): void {
  const parsed = AuthorizationStateSchema.safeParse(state);
  if (!parsed.success || parsed.data.applicationId !== actor.applicationId || parsed.data.environment !== actor.environment ||
    parsed.data.authorizationRevision !== actor.authorizationRevision || parsed.data.lifecycleRevision !== actor.lifecycleRevision) {
    throw new TypeError("Administration authority is stale.");
  }
}

function assertInventory(value: RuntimeExtensionInventory, applicationId: string, environment: string, expectedRevision: number): RuntimeExtensionInventory {
  const parsed = RuntimeExtensionInventorySchema.safeParse(value);
  if (!parsed.success || parsed.data.applicationId !== applicationId || parsed.data.environment !== environment || parsed.data.revision !== expectedRevision) {
    throw new TypeError("Runtime extension inventory is stale.");
  }
  return parsed.data;
}

function entry(inventory: RuntimeExtensionInventory, extension: RuntimeExtensionOperation["request"]["extension"]) {
  const entries = extension.deliveryClass === "platform-plugin" ? inventory.extensions.platformPlugins
    : extension.deliveryClass === "hot-application" ? inventory.extensions.hotApplications : inventory.extensions.themeSkins;
  return entries[extension.id];
}

function entryRevision(inventory: RuntimeExtensionInventory, extension: RuntimeExtensionOperation["request"]["extension"]): number {
  return entry(inventory, extension)?.revision ?? 0;
}

function requestDigest(value: AdministrationOperatorAuthenticatedCommand): string {
  return `sha256:${createHash("sha256").update(canonicalJson(administrationOperatorRequestDigestInput(value))).digest("hex")}`;
}

function planRequest(
  command: Extract<AdministrationOperatorAuthenticatedCommand["command"], { kind: "extension-plan" }>,
  commandDigest: string,
  applicationId: string,
  environment: string
): ExtensionChangeRequest {
  return Object.freeze({
    applicationId,
    environment,
    extension: command.extension,
    operation: command.operation,
    targetVersion: command.version,
    expectedRevision: command.expected.extensionRevision,
    idempotencyKey: command.idempotencyKey,
    correlationId: `administration-${commandDigest.slice("sha256:".length, "sha256:".length + 32)}`
  });
}

function boundActor(operation: RuntimeExtensionOperation, actor: AdministrationActorEnvelope): boolean {
  return operation.authorization.actor.kind === "actor" && operation.authorization.actor.id === actor.effectiveActor.id;
}

function exactPlanReplay(operation: RuntimeExtensionOperation, request: ExtensionChangeRequest, actor: AdministrationActorEnvelope): RuntimeExtensionOperation {
  if (!boundActor(operation, actor) || !operation.plan || operation.operationId !== operation.plan.operationId ||
    canonicalJson(operation.request) !== canonicalJson(request) || operation.requestDigest !== canonicalDigest(operation.request)) throw new TypeError("Administration plan replay does not match its durable operation.");
  return operation;
}

function exactExecuteReplay(
  command: Extract<AdministrationOperatorAuthenticatedCommand["command"], { kind: "extension-execute" }>,
  operation: RuntimeExtensionOperation,
  actor: AdministrationActorEnvelope,
  inventoryInput: RuntimeExtensionInventory
): RuntimeExtensionOperation {
  const inventory = RuntimeExtensionInventorySchema.parse(inventoryInput);
  const result = operation.result;
  const current = entry(inventory, operation.request.extension);
  if (!boundActor(operation, actor) || operation.requestDigest !== canonicalDigest(operation.request) || command.idempotencyKey !== `execute:${operation.operationId}`.slice(0, 160) || !isLifecycleReceipt(result) ||
    result.operationId !== operation.operationId || result.operation !== operation.request.operation || result.revisionBefore !== command.expected.extensionRevision ||
    result.revisionAfter <= result.revisionBefore || result.inventoryRevision !== command.expected.inventoryRevision + 1 ||
    inventory.revision !== result.inventoryRevision || !current || current.revision !== result.revisionAfter ||
    current.lastOperationId !== operation.operationId || current.lastReceiptId !== result.receiptId) {
    throw new TypeError("Administration execution replay does not match its durable result.");
  }
  return operation;
}

function isLifecycleReceipt(result: RuntimeExtensionOperation["result"]): result is Exclude<NonNullable<RuntimeExtensionOperation["result"]>, { applicationId: string }> {
  return result !== undefined && "operationId" in result && "inventoryRevision" in result;
}

function canonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function validOwner(applicationId: string, environment: string): boolean {
  return /^[a-z][a-z0-9-]{2,127}$/u.test(applicationId) && /^[a-z][a-z0-9-]{1,63}$/u.test(environment);
}

function validOperatorIdentity(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(value);
}
