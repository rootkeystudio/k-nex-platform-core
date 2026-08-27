import type { PayloadRequest } from "payload";

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
}

function permitted(grants: readonly PayloadPersistenceGrant[], operation: PayloadPersistenceOperation, options: Readonly<Record<string, unknown>>): void {
  const collection = options.collection;
  if (typeof collection !== "string" || !grants.some((grant) => grant.collection === collection && grant.operations.includes(operation))) {
    throw new Error("Payload persistence capability denied the collection operation.");
  }
  if (options.overrideAccess !== true) throw new Error("Payload persistence capability requires platform-owned access override.");
}

export function createPayloadPersistenceCapability(
  request: PayloadRequest,
  grants: readonly PayloadPersistenceGrant[]
): PayloadPersistenceCapabilityContext {
  const canonicalGrants = Object.freeze(grants.map((grant) => Object.freeze({
    collection: grant.collection,
    operations: Object.freeze([...grant.operations])
  })));
  const invoke = async (operation: PayloadPersistenceOperation, options: Readonly<Record<string, unknown>>): Promise<unknown> => {
    permitted(canonicalGrants, operation, options);
    const platformOptions = { ...options, req: request };
    return (request.payload[operation] as (value: unknown) => Promise<unknown>)(platformOptions);
  };
  return Object.freeze({
    payload: Object.freeze({
      find: (options: Readonly<Record<string, unknown>>) => invoke("find", options),
      create: (options: Readonly<Record<string, unknown>>) => invoke("create", options),
      update: (options: Readonly<Record<string, unknown>>) => invoke("update", options)
    }),
    locale: request.locale,
    transactionID: request.transactionID
  });
}
