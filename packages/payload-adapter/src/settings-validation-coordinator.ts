import { createHash } from "node:crypto";

import {
  AuthorizationStateSchema,
  ResumableSettingsOperationSchema,
  SettingsDocumentIdentitySchema,
  SettingsTerminalReceiptSchema,
  type AuthorizationState,
  type PendingSettingsCandidate,
  type ResumableSettingsOperation,
  type SettingsDocumentIdentity,
  type SettingsTerminalReceipt
} from "@k-nex/contracts";

import { PostgresSystemSettingsStore, SystemSettingsStoreError } from "./system-settings-store.js";

export interface SettingsGenerationValidator {
  validate(input: Readonly<{
    identity: SettingsDocumentIdentity;
    runtimeGenerationId: string;
    candidate: PendingSettingsCandidate;
  }>): Promise<Readonly<{ ready: true }> | Readonly<{
    ready: false;
    reason: "generation-not-ready" | "schema-validation-failed" | "descriptor-disabled";
  }>>;
}

export interface SettingsValidationCoordinatorOptions {
  readonly store: PostgresSystemSettingsStore;
  readonly validator: SettingsGenerationValidator;
  readonly readAuthority: (applicationId: string, environment: string) => Promise<AuthorizationState>;
  readonly leaseOwner: string;
  readonly now?: () => Date;
  readonly leaseMilliseconds?: number;
}

/** Restart-safe worker for one persisted generation-validated settings operation. */
export class SettingsValidationCoordinator {
  constructor(private readonly options: SettingsValidationCoordinatorOptions) {
    if (!/^[a-z][a-z0-9-]{2,127}$/u.test(options.leaseOwner)) throw new TypeError("Settings coordinator lease owner is invalid.");
    if (options.leaseMilliseconds !== undefined && (!Number.isSafeInteger(options.leaseMilliseconds) || options.leaseMilliseconds < 1_000 || options.leaseMilliseconds > 300_000)) {
      throw new TypeError("Settings coordinator lease duration is invalid.");
    }
  }

  async run(value: Readonly<{ identity: unknown; operationId: unknown }>): Promise<SettingsTerminalReceipt> {
    const identity = SettingsDocumentIdentitySchema.parse(value.identity);
    if (typeof value.operationId !== "string" || !/^[a-z][a-z0-9-]{2,127}$/u.test(value.operationId)) {
      throw new TypeError("Settings operation identity is invalid.");
    }
    const existing = await this.options.store.readGenerationValidated({ identity, operationId: value.operationId });
    if (!existing) throw new SystemSettingsStoreError("STATE", "System settings operation is unavailable.");
    const terminal = SettingsTerminalReceiptSchema.safeParse(existing);
    if (terminal.success) return terminal.data;
    const resumable = ResumableSettingsOperationSchema.parse(existing);

    const authority = await this.authority(identity);
    const now = (this.options.now ?? (() => new Date()))();
    const expires = new Date(now.valueOf() + (this.options.leaseMilliseconds ?? 60_000));
    const claim = await this.options.store.claimGenerationValidated({
      identity,
      operationId: resumable.operationId,
      expectedOperationRevision: resumable.revision,
      authority,
      leaseOwner: this.options.leaseOwner,
      now: now.toISOString(),
      leaseExpiresAt: expires.toISOString()
    });
    const validation = await this.options.validator.validate({
      identity,
      runtimeGenerationId: claim.runtimeGenerationId,
      candidate: claim.operation.pendingDocument
    });
    const latestAuthority = await this.authority(identity);
    const finishedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const write = await this.write(claim.operation, latestAuthority, finishedAt);
    return validation.ready
      ? this.options.store.promoteGenerationValidated({ ...write, expectedOperationRevision: claim.operation.revision, leaseOwner: this.options.leaseOwner })
      : this.options.store.failGenerationValidated({ ...write, expectedOperationRevision: claim.operation.revision, leaseOwner: this.options.leaseOwner, reason: validation.reason });
  }

  private async authority(identity: SettingsDocumentIdentity): Promise<AuthorizationState> {
    const parsed = AuthorizationStateSchema.safeParse(await this.options.readAuthority(identity.applicationId, identity.environment));
    if (!parsed.success || parsed.data.applicationId !== identity.applicationId || parsed.data.environment !== identity.environment) {
      throw new SystemSettingsStoreError("STATE", "Authorization state is unavailable.");
    }
    return parsed.data;
  }

  private async write(operation: ResumableSettingsOperation, authority: AuthorizationState, occurredAt: string): Promise<Record<string, unknown>> {
    const snapshot = await this.options.store.read(operation.identity);
    const before = snapshot?.document?.values ?? {};
    const after = operation.pendingDocument.values;
    const changedFields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
    return {
      identity: operation.identity,
      document: {
        expectedDocumentRevision: operation.expectedDocumentRevision,
        expectedSettingsRevision: operation.expectedSettingsRevision,
        values: after
      },
      operation: { operationId: operation.operationId, idempotencyKey: operation.idempotencyKey },
      receipt: {
        receiptId: stableId(operation.operationId, "receipt"),
        invalidationId: stableId(operation.operationId, "invalidation"),
        occurredAt
      },
      actor: operation.requestedBy,
      authority,
      auditId: stableId(operation.operationId, "audit"),
      changedFields
    };
  }
}

function stableId(operationId: string, kind: string): string {
  return `settings-${kind}-${createHash("sha256").update(`${operationId}:${kind}`).digest("hex").slice(0, 24)}`;
}
