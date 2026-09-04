import { createHash } from "node:crypto";

import {
  AdministrationActorEnvelopeSchema,
  RuntimeExtensionInventorySchema,
  administrationOperatorAudience,
  canonicalJson,
  type AdministrationActorEnvelope,
  type AdministrationOperatorCommand,
  type AdministrationOperatorResponse,
  type ExtensionIdentity,
  type RuntimeExtensionInventory
} from "@k-nex/contracts";
import {
  isPreparedStaticPlan,
  type ExtensionCatalogRecord,
  type ExtensionChangeRequest,
  type ExtensionOperationStatus,
  type ExtensionSystemStatus,
  type ExtensionValidationReport,
  type PluginManagerPlan,
  type RuntimeExtensionOperation,
  type SystemExtensionOperator,
  type SystemExtensionOperatorMutationResult,
  type VerifiedGenerationAuthority
} from "@k-nex/runtime";

import { NodeHttpsAdministrationOperatorClient } from "./administration-operator-client.js";
import { type PostgresRuntimeExtensionStore } from "./runtime-extension-store.js";

export type RemoteAdministrationExtensionOperatorErrorCode = "AUTHORITY_MISMATCH" | "REVISION_CONFLICT" | "RESULT_INVALID" | "OPERATOR_REJECTED";

export class RemoteAdministrationExtensionOperatorError extends Error {
  constructor(readonly code: RemoteAdministrationExtensionOperatorErrorCode) {
    super("The administration operator request could not be completed.");
    this.name = "RemoteAdministrationExtensionOperatorError";
  }
}

export interface RemoteAdministrationExtensionReaders {
  catalogList(filter?: Readonly<{ deliveryClass?: ExtensionIdentity["deliveryClass"]; includeUnavailable?: boolean }>): Promise<readonly ExtensionCatalogRecord[]>;
  catalogDetail(extension: ExtensionIdentity, version: string): Promise<ExtensionCatalogRecord | undefined>;
  status(applicationId: string, environment: string): Promise<ExtensionSystemStatus>;
}

export interface RemoteAdministrationExtensionOperatorOptions {
  readonly actor: AdministrationActorEnvelope;
  readonly inventory: RuntimeExtensionInventory;
  readonly client: NodeHttpsAdministrationOperatorClient;
  readonly store: Pick<PostgresRuntimeExtensionStore, "inventory" | "readOperation">;
  readonly readers: RemoteAdministrationExtensionReaders;
  readonly now?: () => Date;
  readonly commandTtlMs?: number;
}

const commandTtlMaximumMs = 5 * 60_000;

/**
 * Web-process port: reads local accepted projections, while all lifecycle
 * mutation is submitted to the external mTLS operator.
 */
export class RemoteAdministrationExtensionOperator implements SystemExtensionOperator {
  readonly #actor: AdministrationActorEnvelope;
  readonly #inventory: RuntimeExtensionInventory;
  readonly #client: NodeHttpsAdministrationOperatorClient;
  readonly #store: Pick<PostgresRuntimeExtensionStore, "inventory" | "readOperation">;
  readonly #readers: RemoteAdministrationExtensionReaders;
  readonly #now: () => Date;
  readonly #commandTtlMs: number;

  constructor(options: RemoteAdministrationExtensionOperatorOptions) {
    const actor = AdministrationActorEnvelopeSchema.safeParse(options.actor);
    const inventory = RuntimeExtensionInventorySchema.safeParse(options.inventory);
    const ttl = options.commandTtlMs ?? 60_000;
    if (!actor.success || !inventory.success || actor.data.applicationId !== inventory.data.applicationId || actor.data.environment !== inventory.data.environment ||
      !Number.isSafeInteger(ttl) || ttl < 1 || ttl > commandTtlMaximumMs) fail("AUTHORITY_MISMATCH");
    this.#actor = actor.data;
    this.#inventory = inventory.data;
    this.#client = options.client;
    this.#store = options.store;
    this.#readers = options.readers;
    this.#now = options.now ?? (() => new Date());
    this.#commandTtlMs = ttl;
  }

  async catalogList(filter: Readonly<{ deliveryClass?: ExtensionIdentity["deliveryClass"]; includeUnavailable?: boolean }> = {}): Promise<readonly ExtensionCatalogRecord[]> {
    return this.safe(() => this.#readers.catalogList(filter));
  }

  async catalogDetail(extension: ExtensionIdentity, version: string): Promise<ExtensionCatalogRecord | undefined> {
    return this.safe(() => this.#readers.catalogDetail(extension, version));
  }

  async status(applicationId: string, environment: string): Promise<ExtensionSystemStatus> {
    this.owner(applicationId, environment);
    return this.safe(async () => {
      const [current, status] = await Promise.all([
        this.#store.inventory(applicationId, environment),
        this.#readers.status(applicationId, environment)
      ]);
      this.exactInventory(current);
      this.exactInventory(status.inventory);
      if (status.applicationId !== applicationId || status.environment !== environment) fail("AUTHORITY_MISMATCH");
      return status;
    });
  }

  async operation(operationId: string): Promise<ExtensionOperationStatus> {
    return this.safe(async () => projectOperation(await this.boundOperation(operationId)));
  }

  async plan(request: ExtensionChangeRequest): Promise<PluginManagerPlan> {
    return this.safe(async () => {
      this.owner(request.applicationId, request.environment);
      await this.assertCurrentInventory();
      if (request.expectedRevision !== entryRevision(this.#inventory, request.extension)) fail("REVISION_CONFLICT");
      const response = await this.#client.submit(this.command({
        kind: "extension-plan",
        extension: request.extension,
        version: request.targetVersion,
        operation: request.operation,
        idempotencyKey: request.idempotencyKey,
        extensionRevision: request.expectedRevision
      }));
      const operation = await this.acceptedOperation(response);
      if (!operation.plan || canonicalJson(operation.request) !== canonicalJson(request) || operation.plan.operationId !== operation.operationId) fail("RESULT_INVALID");
      await bindResultDigest(response, operation);
      await this.assertCurrentInventory();
      return operation.plan;
    });
  }

  async stage(operationId: string): Promise<VerifiedGenerationAuthority> {
    return this.safe(async () => {
      const operation = await this.boundOperation(operationId);
      if (!operation.authority || operation.plan?.executionClass !== "live-generation" || !["staged", "waiting-configuration", "waiting-approval", "warming", "completed"].includes(operation.phase)) fail("RESULT_INVALID");
      return operation.authority;
    });
  }

  async validate(operationId: string): Promise<ExtensionValidationReport> {
    return this.safe(async () => {
      const operation = await this.boundOperation(operationId);
      const valid = operation.plan?.executionClass === "static-release"
        ? isPreparedStaticPlan(operation.plan) && ["source-change-ready", "build-attested", "zero-downtime-eligible", "maintenance-required", "rollback-window-open"].includes(operation.phase)
        : operation.plan?.executionClass === "live-generation" && ((["disable", "rollback", "uninstall"].includes(operation.request.operation) && ["planning", "completed"].includes(operation.phase)) ||
          (operation.authority !== undefined && ["staged", "waiting-configuration", "waiting-approval", "warming", "completed"].includes(operation.phase)));
      return Object.freeze({
        operationId,
        executionClass: operation.plan?.executionClass ?? "live-generation",
        phase: operation.phase,
        valid,
        checks: valid ? Object.freeze([operation.plan?.executionClass === "static-release" ? "persisted-prepared-plan" : operation.authority ? "persisted-generation-authority" : "persisted-operation-plan"]) : Object.freeze([])
      });
    });
  }

  activate(operationId: string): Promise<SystemExtensionOperatorMutationResult> { return this.execute(operationId, ["install", "update"]); }
  rollback(operationId: string): Promise<SystemExtensionOperatorMutationResult> { return this.execute(operationId, ["rollback"]); }
  disable(operationId: string): Promise<SystemExtensionOperatorMutationResult> { return this.execute(operationId, ["disable"]); }
  uninstall(operationId: string): Promise<SystemExtensionOperatorMutationResult> { return this.execute(operationId, ["uninstall"]); }

  private async execute(operationId: string, allowed: readonly ExtensionChangeRequest["operation"][]): Promise<SystemExtensionOperatorMutationResult> {
    return this.safe(async () => {
      const before = await this.boundOperation(operationId);
      await this.assertCurrentInventory();
      if (!before.plan || !allowed.includes(before.request.operation) || before.request.expectedRevision !== entryRevision(this.#inventory, before.request.extension)) fail("REVISION_CONFLICT");
      const response = await this.#client.submit(this.command({
        kind: "extension-execute",
        operationId,
        idempotencyKey: executionIdempotencyKey(operationId),
        extensionRevision: before.request.expectedRevision
      }));
      const operation = await this.acceptedOperation(response, operationId);
      if (operation.phase !== "completed" || !operation.result || canonicalJson(operation.request) !== canonicalJson(before.request)) fail("RESULT_INVALID");
      await bindResultDigest(response, operation);
      return operation.result;
    });
  }

  private command(input: Readonly<({ kind: "extension-plan"; extension: ExtensionIdentity; version: string; operation: ExtensionChangeRequest["operation"] } | { kind: "extension-execute"; operationId: string }) & { idempotencyKey: string; extensionRevision: number }>): AdministrationOperatorCommand {
    const now = this.#now();
    if (!Number.isFinite(now.valueOf())) fail("AUTHORITY_MISMATCH");
    const base = {
      schemaVersion: 1 as const,
      audience: administrationOperatorAudience,
      actor: this.#actor,
      expected: {
        authorizationRevision: this.#actor.authorizationRevision,
        lifecycleRevision: this.#actor.lifecycleRevision,
        inventoryRevision: this.#inventory.revision,
        extensionRevision: input.extensionRevision
      },
      idempotencyKey: input.idempotencyKey,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.valueOf() + this.#commandTtlMs).toISOString()
    };
    return input.kind === "extension-plan"
      ? { ...base, kind: input.kind, extension: input.extension, version: input.version, operation: input.operation }
      : { ...base, kind: input.kind, operationId: input.operationId };
  }

  private async acceptedOperation(response: AdministrationOperatorResponse, expectedId?: string): Promise<RuntimeExtensionOperation> {
    if (response.outcome !== "accepted" || response.authoritativeResult.kind !== "operation" || (expectedId !== undefined && response.authoritativeResult.operationId !== expectedId)) fail("OPERATOR_REJECTED");
    return this.boundOperation(response.authoritativeResult.operationId);
  }

  private async boundOperation(operationId: string): Promise<RuntimeExtensionOperation> {
    const operation = await this.#store.readOperation(operationId);
    if (!operation || operation.operationId !== operationId) fail("RESULT_INVALID");
    this.owner(operation.request.applicationId, operation.request.environment);
    return operation;
  }

  private async assertCurrentInventory(): Promise<void> {
    this.exactInventory(await this.#store.inventory(this.#actor.applicationId, this.#actor.environment));
  }

  private exactInventory(inventory: RuntimeExtensionInventory): void {
    const parsed = RuntimeExtensionInventorySchema.safeParse(inventory);
    if (!parsed.success || canonicalJson(inventoryBinding(parsed.data)) !== canonicalJson(inventoryBinding(this.#inventory))) fail("REVISION_CONFLICT");
  }

  private owner(applicationId: string, environment: string): void {
    if (applicationId !== this.#actor.applicationId || environment !== this.#actor.environment) fail("AUTHORITY_MISMATCH");
  }

  private async safe<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof RemoteAdministrationExtensionOperatorError) throw error;
      fail("OPERATOR_REJECTED");
    }
  }
}

export function remoteAdministrationExtensionOperationDigest(operation: RuntimeExtensionOperation): string {
  return `sha256:${createHash("sha256").update(canonicalJson(operationBinding(operation))).digest("hex")}`;
}

function projectOperation(operation: RuntimeExtensionOperation): ExtensionOperationStatus {
  return Object.freeze({
    operationId: operation.operationId,
    request: operation.request,
    requestDigest: operation.requestDigest,
    actor: operation.authorization.actor,
    phase: operation.phase,
    ...(operation.plan ? { plan: operation.plan } : {}),
    ...(operation.result ? { result: operation.result } : {})
  });
}

function operationBinding(operation: RuntimeExtensionOperation) {
  return {
    operationId: operation.operationId,
    request: operation.request,
    requestDigest: operation.requestDigest,
    authorization: operation.authorization,
    phase: operation.phase,
    ...(operation.plan ? { plan: operation.plan } : {}),
    ...(operation.authority ? { authority: operation.authority } : {}),
    ...(operation.result ? { result: operation.result } : {})
  };
}

async function bindResultDigest(response: AdministrationOperatorResponse, operation: RuntimeExtensionOperation): Promise<void> {
  if (response.resultDigest !== remoteAdministrationExtensionOperationDigest(operation)) fail("RESULT_INVALID");
}

function inventoryBinding(inventory: RuntimeExtensionInventory) {
  const { observedAt: _observedAt, $schema: _schema, ...binding } = inventory;
  return binding;
}

function entryRevision(inventory: RuntimeExtensionInventory, extension: ExtensionIdentity): number {
  const entries = extension.deliveryClass === "platform-plugin" ? inventory.extensions.platformPlugins
    : extension.deliveryClass === "hot-application" ? inventory.extensions.hotApplications : inventory.extensions.themeSkins;
  return entries[extension.id]?.revision ?? 0;
}

function executionIdempotencyKey(operationId: string): string {
  return `execute:${operationId}`.slice(0, 160);
}

function fail(code: RemoteAdministrationExtensionOperatorErrorCode): never {
  throw new RemoteAdministrationExtensionOperatorError(code);
}
