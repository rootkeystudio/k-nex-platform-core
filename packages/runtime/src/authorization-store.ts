import {
  AuthorizationDecisionAuditSchema,
  AuthorizationStateSchema,
  BootstrapReceiptSchema,
  ExtensionAuthorizationGenerationSchema,
  PermissionCatalogSnapshotSchema,
  RoleAssignmentSchema,
  RolePermissionGrantSchema,
  RoleSchema,
  TemplateAdoptionSchema,
  type AuthorizationDecisionAudit,
  type AuthorizationState,
  type AuthorizationSubject,
  type BootstrapReceipt,
  type ExtensionAuthorizationGeneration,
  type PermissionCatalogSnapshot,
  type Role,
  type RoleAssignment,
  type RolePermissionGrant,
  type TemplateAdoption
} from "@k-nex/contracts";

export type AuthorizationStoreErrorCode = "MUTATION_INVALID" | "REVISION_CONFLICT" | "SUBJECT_INVALID";

export class AuthorizationStoreError extends Error {
  constructor(readonly code: AuthorizationStoreErrorCode, message: string) {
    super(message);
    this.name = "AuthorizationStoreError";
  }
}

/** The application identity authority; no service identity table is implied by this boundary. */
export interface AuthorizationSubjectValidator {
  validate(applicationId: string, subject: AuthorizationSubject): "accepted" | "rejected" | Promise<"accepted" | "rejected">;
}

export interface AuthorizationExpectedRevision {
  readonly applicationId: string;
  readonly environment: string;
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
}

export type AuthorizationStoreMutation =
  | Readonly<{ readonly kind: "role"; readonly role: Role }>
  | Readonly<{ readonly kind: "grant"; readonly grant: RolePermissionGrant }>
  | Readonly<{ readonly kind: "assignment"; readonly assignment: RoleAssignment }>
  | Readonly<{ readonly kind: "template-adoption"; readonly adoption: TemplateAdoption }>
  | Readonly<{ readonly kind: "catalog-snapshot"; readonly snapshot: PermissionCatalogSnapshot }>
  | Readonly<{ readonly kind: "extension-generation"; readonly generation: ExtensionAuthorizationGeneration }>
  | Readonly<{ readonly kind: "bootstrap-receipt"; readonly receipt: BootstrapReceipt }>
  | Readonly<{ readonly kind: "audit"; readonly audit: AuthorizationDecisionAudit }>;

/** A durable audit record with its database-assigned occurrence time. */
export interface AuthorizationAuditEntry {
  readonly audit: AuthorizationDecisionAudit;
  readonly occurredAt: string;
}

export interface AuthorizationStoreReadTransaction {
  readRole(applicationId: string, roleId: string): Promise<Role | undefined>;
  listRoles(applicationId: string): Promise<readonly Role[]>;
  listGrants(applicationId: string, roleId?: string): Promise<readonly RolePermissionGrant[]>;
  listAssignments(applicationId: string, principal?: AuthorizationSubject): Promise<readonly RoleAssignment[]>;
  listTemplateAdoptions(applicationId: string, roleId?: string): Promise<readonly TemplateAdoption[]>;
  listCatalogSnapshots(applicationId: string): Promise<readonly PermissionCatalogSnapshot[]>;
  listExtensionGenerations(applicationId: string): Promise<readonly ExtensionAuthorizationGeneration[]>;
  readBootstrapReceipt(applicationId: string): Promise<BootstrapReceipt | undefined>;
  listAudits(input: Readonly<{ readonly applicationId: string; readonly afterAuditId?: string; readonly limit: number }>): Promise<readonly AuthorizationAuditEntry[]>;
}

export interface AuthorizationStoreTransaction extends AuthorizationStoreReadTransaction {
  write(mutation: AuthorizationStoreMutation): Promise<void>;
  /** Removes a customer grant inside the current revision-checked transaction. */
  removeGrant(applicationId: string, grantId: string): Promise<RolePermissionGrant | undefined>;
}

export interface AuthorizationTransactionOutcome<T> {
  readonly committed: true;
  readonly value: T;
  readonly state: AuthorizationState;
}

/**
 * The adapter must compare the complete state revision and commit all writes,
 * its state update, and its audit records as one database transaction.
 */
export interface AuthorizationStore {
  readState(applicationId: string, environment: string): Promise<AuthorizationState | undefined>;
  transaction<T>(
    expected: AuthorizationExpectedRevision,
    work: (transaction: AuthorizationStoreTransaction) => Promise<T>
  ): Promise<AuthorizationTransactionOutcome<T>>;
  /** Reads one consistent, revision-checked snapshot without mutation authority. */
  readTransaction<T>(
    expected: AuthorizationExpectedRevision,
    work: (transaction: AuthorizationStoreReadTransaction) => Promise<T>
  ): Promise<AuthorizationTransactionOutcome<T>>;
  /**
   * The only path allowed to create the immutable protected-role baseline and
   * first owner. Implementations must reject non-first-run state and validate
   * the complete staged mutation set before committing it.
   */
  bootstrapFirstOwnerTransaction<T>(
    expected: AuthorizationExpectedRevision,
    work: (transaction: AuthorizationStoreTransaction) => Promise<T>
  ): Promise<AuthorizationTransactionOutcome<T>>;
}

export function parseAuthorizationExpectedRevision(value: unknown): AuthorizationExpectedRevision {
  const input = exactObject(value, ["applicationId", "environment", "authorizationRevision", "lifecycleRevision"]);
  const parsed = AuthorizationStateSchema.safeParse({ schemaVersion: 1, ...input });
  if (!parsed.success) fail("REVISION_CONFLICT", "Authorization expected revision is invalid.");
  const { applicationId, environment, authorizationRevision, lifecycleRevision } = parsed.data;
  return Object.freeze({ applicationId, environment, authorizationRevision, lifecycleRevision });
}

export function assertAuthorizationExpectedRevision(expected: AuthorizationExpectedRevision, current: AuthorizationState | undefined): AuthorizationState {
  if (current === undefined || current.applicationId !== expected.applicationId || current.environment !== expected.environment ||
    current.authorizationRevision !== expected.authorizationRevision || current.lifecycleRevision !== expected.lifecycleRevision) {
    fail("REVISION_CONFLICT", "Authorization state revision changed before mutation.");
  }
  return current;
}

export async function parseAuthorizationStoreMutation(
  value: unknown,
  subjectValidator?: AuthorizationSubjectValidator
): Promise<AuthorizationStoreMutation> {
  const kind = objectValue(value).kind;
  if (kind === "role") return Object.freeze({ kind, role: parseEntity(value, "role", RoleSchema) });
  if (kind === "grant") return Object.freeze({ kind, grant: parseEntity(value, "grant", RolePermissionGrantSchema) });
  if (kind === "template-adoption") return Object.freeze({ kind, adoption: parseEntity(value, "adoption", TemplateAdoptionSchema) });
  if (kind === "catalog-snapshot") return Object.freeze({ kind, snapshot: parseEntity(value, "snapshot", PermissionCatalogSnapshotSchema) });
  if (kind === "extension-generation") return Object.freeze({ kind, generation: parseEntity(value, "generation", ExtensionAuthorizationGenerationSchema) });
  if (kind === "bootstrap-receipt") return Object.freeze({ kind, receipt: parseEntity(value, "receipt", BootstrapReceiptSchema) });
  if (kind === "audit") return Object.freeze({ kind, audit: parseEntity(value, "audit", AuthorizationDecisionAuditSchema) });
  if (kind === "assignment") {
    const assignment = parseEntity(value, "assignment", RoleAssignmentSchema);
    let accepted = false;
    try {
      accepted = subjectValidator !== undefined && await subjectValidator.validate(assignment.applicationId, assignment.principal) === "accepted";
    } catch {
      accepted = false;
    }
    if (!accepted) {
      fail("SUBJECT_INVALID", "Authorization assignment subject is not accepted by the authoritative validator.");
    }
    return Object.freeze({ kind, assignment });
  }
  fail("MUTATION_INVALID", "Authorization mutation kind is invalid.");
}

function exactObject(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  const input = objectValue(value);
  if (Object.keys(input).some((key) => !keys.includes(key))) fail("MUTATION_INVALID", "Authorization mutation contains an unknown field.");
  return input;
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("MUTATION_INVALID", "Authorization mutation must be an object.");
  return value as Readonly<Record<string, unknown>>;
}

function parseEntity<T>(value: unknown, key: string, schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } }): T {
  const input = exactObject(value, ["kind", key]);
  const parsed = schema.safeParse(input[key]);
  if (!parsed.success) fail("MUTATION_INVALID", `Authorization ${key} mutation is not canonical.`);
  return parsed.data;
}

function fail(code: AuthorizationStoreErrorCode, message: string): never {
  throw new AuthorizationStoreError(code, message);
}
