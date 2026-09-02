import { commitTransaction, initTransaction, killTransaction, type PayloadRequest } from "payload";
import { isCurrentAuthorityTarget, type CurrentAuthorityAdapter, type CurrentAuthorityTarget } from "@k-nex/runtime";

export type PayloadPersistenceOperation = "find" | "create" | "update";

export interface PayloadPersistenceGrant {
  readonly collection: string;
  readonly operations: readonly PayloadPersistenceOperation[];
}

export interface PayloadPersistenceCapabilityContext {
  readonly payload: {
    find(options: Readonly<Record<string, unknown>>): Promise<unknown>;
    create(options: Readonly<Record<string, unknown>>): Promise<unknown>;
    update(options: Readonly<Record<string, unknown>>): Promise<unknown>;
  };
  readonly locale: PayloadRequest["locale"];
  readonly transactionID: PayloadRequest["transactionID"];
  readonly transaction: PayloadPersistenceTransaction;
  guard(input: Readonly<Record<string, unknown>>): Promise<boolean>;
}

export interface PayloadPersistenceTransaction {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Hosts provide narrowly scoped checks that need the same request transaction as a subsequent write. */
export interface PayloadPersistenceGuard {
  guard(input: Readonly<Record<string, unknown>>): boolean | Promise<boolean>;
}

export interface PayloadPersistenceAuthorizer {
  authorize(input: Readonly<{
    grant: PayloadPersistenceGrant;
    operation: PayloadPersistenceOperation;
    collection: string;
  }>): boolean | Promise<boolean>;
}

/** Request-bound adapter; the host maps registered collection operations to branded RBAC targets. */
export class CurrentAuthorityPayloadPersistenceAuthorizer<TContext> implements PayloadPersistenceAuthorizer {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly context: TContext,
    private readonly target: (input: Parameters<PayloadPersistenceAuthorizer["authorize"]>[0]) => CurrentAuthorityTarget
  ) {}

  async authorize(input: Parameters<PayloadPersistenceAuthorizer["authorize"]>[0]): Promise<boolean> {
    try {
      const target = this.target(input);
      return isCurrentAuthorityTarget(target) && await this.authority.allows(this.context, target);
    } catch { return false; }
  }
}

function permitted(grants: readonly PayloadPersistenceGrant[], operation: PayloadPersistenceOperation, options: Readonly<Record<string, unknown>>): PayloadPersistenceGrant {
  const collection = options.collection;
  const grant = typeof collection === "string" ? grants.find((candidate) => candidate.collection === collection && candidate.operations.includes(operation)) : undefined;
  if (grant === undefined) {
    throw new Error("Payload persistence capability denied the collection operation.");
  }
  if (options.overrideAccess !== true) throw new Error("Payload persistence capability requires platform-owned access override.");
  return grant;
}

export function createPayloadPersistenceCapability(
  request: PayloadRequest,
  grants: readonly PayloadPersistenceGrant[],
  authorizer: PayloadPersistenceAuthorizer,
  guard?: PayloadPersistenceGuard
): PayloadPersistenceCapabilityContext {
  const canonicalGrants = Object.freeze(grants.map((grant) => Object.freeze({
    collection: grant.collection,
    operations: Object.freeze([...grant.operations])
  })));
  const invoke = async (operation: PayloadPersistenceOperation, options: Readonly<Record<string, unknown>>): Promise<unknown> => {
    const grant = permitted(canonicalGrants, operation, options);
    if (await authorizer.authorize({ grant, operation, collection: grant.collection }) !== true) {
      throw new Error("Current authority denied the Payload persistence operation.");
    }
    const platformOptions = { ...options, req: request };
    return (request.payload[operation] as (value: unknown) => Promise<unknown>)(platformOptions);
  };
  let ownsTransaction = false;
  let started = false;
  let settled = false;
  const transaction: PayloadPersistenceTransaction = Object.freeze({
    async begin() {
      if (started) return;
      ownsTransaction = await initTransaction(request);
      started = true;
      if (!ownsTransaction && (await request.transactionID) == null) {
        throw new Error("Payload persistence capability could not begin a transaction.");
      }
    },
    async commit() {
      if (!ownsTransaction || settled) return;
      try {
        await commitTransaction(request);
        settled = true;
      } catch (error) {
        await killTransaction(request);
        settled = true;
        throw error;
      }
    },
    async rollback() {
      if (!ownsTransaction || settled) return;
      await killTransaction(request);
      settled = true;
    }
  });
  return Object.freeze({
    payload: Object.freeze({
      find: (options: Readonly<Record<string, unknown>>) => invoke("find", options),
      create: (options: Readonly<Record<string, unknown>>) => invoke("create", options),
      update: (options: Readonly<Record<string, unknown>>) => invoke("update", options)
    }),
    locale: request.locale,
    get transactionID() { return request.transactionID; },
    transaction,
    async guard(input: Readonly<Record<string, unknown>>) {
      if (guard === undefined) throw new Error("Payload persistence capability has no host guard.");
      return await guard.guard(input);
    }
  });
}
