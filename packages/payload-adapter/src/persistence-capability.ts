import { commitTransaction, initTransaction, killTransaction, type CollectionBeforeChangeHook, type CollectionConfig, type PayloadRequest } from "payload";
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
  /** Minimal trusted host identity; request config and ambient credentials remain unavailable. */
  readonly applicationIdentity?: Readonly<{ applicationId: string; environment: string }>;
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

/** Process-/worker-local only: separate isolates intentionally cannot share request admissions. */
const trustedSalesTaskCreateIdRegistryKey = Symbol.for("@k-nex/payload-adapter/trusted-sales-task-create-id-admission/v1");
const trustedSalesTaskCreateIdRegistryBrand = Symbol.for("@k-nex/payload-adapter/trusted-sales-task-create-id-admission-brand/v1");

type TrustedSalesTaskCreateIdAdmission = Readonly<{
  readonly id: number;
  readonly resourceId: string;
  readonly actionId: "sales.task.create";
  readonly transactionId: number | string;
}>;

type TrustedSalesTaskCreateIdRegistry = Readonly<{
  readonly version: 1;
  readonly admissions: WeakMap<object, TrustedSalesTaskCreateIdAdmission>;
  readonly [trustedSalesTaskCreateIdRegistryBrand]: true;
}>;

function validRegistryDescriptor(descriptor: PropertyDescriptor | undefined, value: unknown): value is TrustedSalesTaskCreateIdRegistry {
  if (descriptor === undefined || descriptor.value !== value || descriptor.get !== undefined || descriptor.set !== undefined ||
    descriptor.writable !== false || descriptor.configurable !== false || descriptor.enumerable !== false ||
    value === null || typeof value !== "object") return false;
  const record = value as Record<PropertyKey, unknown>;
  const names = Object.getOwnPropertyNames(record).sort();
  const symbols = Object.getOwnPropertySymbols(record);
  if (names.length !== 2 || names[0] !== "admissions" || names[1] !== "version" || symbols.length !== 1 || symbols[0] !== trustedSalesTaskCreateIdRegistryBrand ||
    record.version !== 1 || !(record.admissions instanceof WeakMap) || record[trustedSalesTaskCreateIdRegistryBrand] !== true) return false;
  for (const key of ["version", "admissions", trustedSalesTaskCreateIdRegistryBrand] as const) {
    const property = Object.getOwnPropertyDescriptor(record, key);
    if (property === undefined || property.get !== undefined || property.set !== undefined || property.writable !== false || property.configurable !== false || property.enumerable !== false) return false;
  }
  return Object.isFrozen(record);
}

function trustedSalesTaskCreateIdRegistry(): TrustedSalesTaskCreateIdRegistry {
  const existing = Object.getOwnPropertyDescriptor(globalThis, trustedSalesTaskCreateIdRegistryKey);
  if (existing !== undefined) {
    if (!validRegistryDescriptor(existing, existing.value)) throw new Error("Trusted Sales task ID admission registry is invalid.");
    return existing.value;
  }
  const registry = Object.freeze(Object.defineProperties(Object.create(null), {
    version: { value: 1, writable: false, configurable: false, enumerable: false },
    admissions: { value: new WeakMap<object, TrustedSalesTaskCreateIdAdmission>(), writable: false, configurable: false, enumerable: false },
    [trustedSalesTaskCreateIdRegistryBrand]: { value: true, writable: false, configurable: false, enumerable: false }
  })) as TrustedSalesTaskCreateIdRegistry;
  Object.defineProperty(globalThis, trustedSalesTaskCreateIdRegistryKey, {
    value: registry,
    writable: false,
    configurable: false,
    enumerable: false
  });
  const stored = Object.getOwnPropertyDescriptor(globalThis, trustedSalesTaskCreateIdRegistryKey);
  if (!validRegistryDescriptor(stored, registry)) throw new Error("Trusted Sales task ID admission registry is invalid.");
  return registry;
}

const trustedSalesTaskCreateIds = trustedSalesTaskCreateIdRegistry().admissions;

function isTrustedSalesTaskId(id: unknown, resourceId: unknown): id is number {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 &&
    typeof resourceId === "string" && /^[1-9][0-9]*$/u.test(resourceId) && resourceId === String(id);
}

function isTransactionId(value: unknown): value is number | string {
  return typeof value === "string" && value.length > 0 || typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * The generated host mints this request-bound admission only after its task-create
 * fence and idempotency reservation. It deliberately has no request-context form.
 */
export async function admitTrustedSalesTaskCreateId(request: PayloadRequest, input: Readonly<{ id: number; resourceId: string }>): Promise<void> {
  const transactionId = await request.transactionID;
  if (!isTrustedSalesTaskId(input.id, input.resourceId) || !isTransactionId(transactionId)) {
    throw new Error("Trusted Sales task ID admission is invalid.");
  }
  trustedSalesTaskCreateIds.set(request, Object.freeze({
    id: input.id,
    resourceId: input.resourceId,
    actionId: "sales.task.create",
    transactionId
  }));
}

/** Clears an unused one-shot admission when the host action exits without creating. */
export function revokeTrustedSalesTaskCreateId(request: PayloadRequest): void {
  trustedSalesTaskCreateIds.delete(request);
}

const trustedSalesTaskCreateIdHook: CollectionBeforeChangeHook = async ({ collection, data, operation, req }) => {
  if (operation !== "create" || !Object.hasOwn(data, "id")) return data;
  const admission = trustedSalesTaskCreateIds.get(req);
  // One use only, including a mismatched create attempt on the same request.
  trustedSalesTaskCreateIds.delete(req);
  const id = data.id;
  const transactionId = await req.transactionID;
  if (collection.slug !== "sales-tasks" || admission === undefined || admission.actionId !== "sales.task.create" ||
    transactionId !== admission.transactionId || !isTrustedSalesTaskId(id, admission.resourceId) || id !== admission.id) {
    throw new Error("Explicit Payload IDs are reserved for trusted Sales task creation.");
  }
  return data;
};

/** Applies the closed explicit-ID guard last, after collection hooks have finalized data. */
export function withTrustedSalesTaskCreateIdAdmission(collection: CollectionConfig): CollectionConfig {
  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      beforeChange: [...(collection.hooks?.beforeChange ?? []), trustedSalesTaskCreateIdHook]
    }
  };
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

function applicationIdentity(request: PayloadRequest): PayloadPersistenceCapabilityContext["applicationIdentity"] {
  const custom = request.payload.config?.custom as { readonly kNexApplicationId?: unknown; readonly kNexEnvironment?: unknown } | undefined;
  if (typeof custom?.kNexApplicationId !== "string" || custom.kNexApplicationId.length === 0 ||
    typeof custom.kNexEnvironment !== "string" || custom.kNexEnvironment.length === 0) return undefined;
  return Object.freeze({ applicationId: custom.kNexApplicationId, environment: custom.kNexEnvironment });
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
    const mutableRequest = request as PayloadRequest & { context: unknown };
    const previousContext = mutableRequest.context;
    if (Object.hasOwn(options, "context")) mutableRequest.context = options.context as PayloadRequest["context"];
    try { return await (request.payload[operation] as (value: unknown) => Promise<unknown>)(platformOptions); }
    finally { mutableRequest.context = previousContext; }
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
  const hostIdentity = applicationIdentity(request);
  return Object.freeze({
    payload: Object.freeze({
      find: (options: Readonly<Record<string, unknown>>) => invoke("find", options),
      create: (options: Readonly<Record<string, unknown>>) => invoke("create", options),
      update: (options: Readonly<Record<string, unknown>>) => invoke("update", options)
    }),
    locale: request.locale,
    ...(hostIdentity === undefined ? {} : { applicationIdentity: hostIdentity }),
    get transactionID() { return request.transactionID; },
    transaction,
    async guard(input: Readonly<Record<string, unknown>>) {
      if (guard === undefined) throw new Error("Payload persistence capability has no host guard.");
      return await guard.guard(input);
    }
  });
}
