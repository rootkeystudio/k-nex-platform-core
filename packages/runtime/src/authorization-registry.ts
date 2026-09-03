import {
  AuthorizationDelegationSchema,
  AuthorizationPermissionDescriptorSchema,
  AuthorizationPermissionIdSchema,
  AuthorizationScopeSchema,
  AuthorizationSubjectSchema,
  ExtensionAuthorizationGenerationSchema,
  ExtensionAuthorizationOwnerRefSchema,
  HotApplicationManifestSchema,
  PermissionCatalogSnapshotSchema,
  PermissionPolicyBindingSchema,
  RoleTemplateSchema,
  canonicalJson,
  workspacePagePermissionIds,
  type AuthorizationOwnerRef,
  type AuthorizationPermissionDescriptor,
  type AuthorizationSubject,
  type ExtensionAuthorizationOwnerRef,
  type ExtensionAuthorizationGeneration,
  type ExtensionPermissionPublisherRef,
  type PermissionPolicyBinding,
  type RoleTemplate
} from "@k-nex/contracts";
import {
  assertExecutableRegistrationAuthority,
  platformPluginEnabledInRegistration,
  type ScopedRegistrationResult
} from "./plugin-lifecycle.js";
import {
  isRunnerBackedHotApplicationPolicyGateway,
  readAuthoritativeHotApplicationAuthorizationSource,
  readRunnerBackedHotApplicationPolicyGatewaySource,
  type AuthoritativeHotApplicationAuthorizationRecord,
  type AuthoritativeHotApplicationAuthorizationSource
} from "./hot-application-runtime.js";

type AuthorizationScope = ReturnType<typeof AuthorizationScopeSchema.parse>;

export type AuthorizationRegistryErrorCode =
  | "INVALID_INPUT" | "SNAPSHOT_NOT_AUTHORITY" | "INVALID_DESCRIPTOR" | "INVALID_BINDING" | "INVALID_TEMPLATE"
  | "INVALID_LIFECYCLE" | "DUPLICATE_DESCRIPTOR" | "DUPLICATE_BINDING" | "DUPLICATE_EXECUTABLE"
  | "MISSING_EXECUTABLE" | "UNDECLARED_EXECUTABLE" | "DUPLICATE_TEMPLATE" | "OWNER_MISMATCH" | "REFERENCE_MISMATCH"
  | "SCOPE_MISMATCH" | "UNTRUSTED_EXECUTABLE" | "HOT_APPLICATION_FUNCTION_FORBIDDEN";

export class AuthorizationRegistryError extends Error {
  constructor(readonly code: AuthorizationRegistryErrorCode, message: string) {
    super(message);
    this.name = "AuthorizationRegistryError";
  }
}

export interface AuthorizationPolicyEvaluationInput {
  readonly schemaVersion: 1;
  readonly applicationId: string;
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
  readonly permissionId: string;
  readonly scope: AuthorizationScope;
  readonly principal: AuthorizationSubject;
  readonly effectiveActor: AuthorizationSubject;
  readonly delegation?: { readonly delegationId: string; readonly delegator: AuthorizationSubject; readonly effect: "reducing" };
  /** Canonical JSON facts selected by the K-Nex authority boundary, never a raw request or service locator. */
  readonly facts: unknown;
}

export interface AuthorizationPolicyEvaluationOutcome { readonly schemaVersion: 1; readonly outcome: "allow" | "deny"; }

/** Trusted static Platform Plugin code may implement this narrow policy port. */
export interface PlatformPluginPolicyExecutor {
  evaluate(input: AuthorizationPolicyEvaluationInput, signal: AbortSignal): AuthorizationPolicyEvaluationOutcome | Promise<AuthorizationPolicyEvaluationOutcome>;
}

/** Hot Applications can evaluate policy only through the isolated runner/host capability boundary. */
export interface HotApplicationPolicyHostCapabilityGateway {
  evaluate(input: Readonly<{
    owner: ExtensionAuthorizationOwnerRef;
    binding: PermissionPolicyBinding;
    evaluation: AuthorizationPolicyEvaluationInput;
    signal: AbortSignal;
  }>): AuthorizationPolicyEvaluationOutcome | Promise<AuthorizationPolicyEvaluationOutcome>;
}

export interface PlatformPluginPolicyExecutableDeclaration {
  readonly kind: "platform-plugin";
  readonly publisher: Extract<ExtensionPermissionPublisherRef, { readonly deliveryClass: "platform-plugin" }>;
  readonly bindingId: string;
  readonly policyReference: string;
  readonly executor: PlatformPluginPolicyExecutor;
}

export interface HotApplicationPolicyExecutableDeclaration {
  readonly kind: "hot-application";
  readonly publisher: Extract<ExtensionPermissionPublisherRef, { readonly deliveryClass: "hot-application" }>;
  readonly bindingId: string;
  readonly policyReference: string;
  readonly gateway: HotApplicationPolicyHostCapabilityGateway;
}

export type TrustedPolicyExecutable = PlatformPluginPolicyExecutableDeclaration | HotApplicationPolicyExecutableDeclaration;

const trustedExecutables = new WeakSet<object>();
const effectiveAuthorizationCatalogs = new WeakSet<object>();
const effectiveAuthorizationCatalogApplications = new WeakMap<object, string>();
const effectiveAuthorizationCatalogBindings = new WeakMap<object, Readonly<{
  lifecycleRevision: number;
  activeGenerations: ReadonlyMap<string, ExtensionAuthorizationGeneration>;
}>>();
const effectiveRoleTemplateApplications = new WeakMap<object, string>();
const platformPluginAuthorizationContributions = new WeakSet<object>();
const hotApplicationAuthorizationContributions = new WeakSet<object>();
const hotApplicationContributionSources = new WeakMap<object, AuthoritativeHotApplicationAuthorizationRecord>();
const hotApplicationExecutableSources = new WeakMap<object, AuthoritativeHotApplicationAuthorizationRecord>();

function fail(code: AuthorizationRegistryErrorCode, message: string): never {
  throw new AuthorizationRegistryError(code, message);
}

function parseExecutableIdentity(value: Readonly<{ publisher: unknown; bindingId: unknown; policyReference: unknown }>): Readonly<{
  publisher: ExtensionPermissionPublisherRef;
  bindingId: string;
  policyReference: string;
}> {
  const publisher = ExtensionAuthorizationOwnerRefSchema.safeParse({ ...(value.publisher as object), generation: 1 });
  const bindingId = AuthorizationPermissionIdSchema.safeParse(value.bindingId);
  const policyReference = AuthorizationPermissionIdSchema.safeParse(value.policyReference);
  if (!publisher.success || !bindingId.success || !policyReference.success) fail("UNTRUSTED_EXECUTABLE", "Trusted policy executable identity is invalid.");
  return Object.freeze({
    publisher: Object.freeze((({ generation: _generation, ...identity }) => identity)(publisher.data)) as ExtensionPermissionPublisherRef,
    bindingId: bindingId.data,
    policyReference: policyReference.data
  });
}

/** True only for the exact effective catalog constructed by this module. */
export function isEffectiveAuthorizationCatalog(value: unknown): value is EffectiveAuthorizationCatalog {
  return typeof value === "object" && value !== null && effectiveAuthorizationCatalogs.has(value);
}

/** True only for an exact effective catalog created for this customer application. */
export function isEffectiveAuthorizationCatalogForApplication(value: unknown, applicationId: string): value is EffectiveAuthorizationCatalog {
  return typeof value === "object" && value !== null && effectiveAuthorizationCatalogApplications.get(value) === applicationId;
}

/** True only for a catalog from this exact authoritative lifecycle revision. */
export function isEffectiveAuthorizationCatalogForLifecycle(
  value: unknown,
  applicationId: string,
  lifecycleRevision: number
): value is EffectiveAuthorizationCatalog {
  return isEffectiveAuthorizationCatalogForApplication(value, applicationId) &&
    effectiveAuthorizationCatalogBindings.get(value)?.lifecycleRevision === lifecycleRevision;
}

/** True only for a catalog from this exact lifecycle revision with this active owner generation. */
export function isEffectiveAuthorizationCatalogForLifecycleOwner(
  value: unknown,
  applicationId: string,
  lifecycleRevision: number,
  owner: ExtensionAuthorizationOwnerRef
): value is EffectiveAuthorizationCatalog {
  if (!isEffectiveAuthorizationCatalogForLifecycle(value, applicationId, lifecycleRevision)) return false;
  const binding = effectiveAuthorizationCatalogBindings.get(value);
  return binding?.activeGenerations.has(ownerKey(owner)) === true;
}

/**
 * True only when this catalog was built from this exact active authorization-generation row.
 * This binds numeric owner, runtime generation IDs, and authorization/lifecycle revisions.
 */
export function isEffectiveAuthorizationCatalogForGeneration(
  value: unknown,
  generationValue: unknown
): value is EffectiveAuthorizationCatalog {
  const generation = ExtensionAuthorizationGenerationSchema.safeParse(generationValue);
  if (!generation.success || generation.data.state !== "current" ||
    !isEffectiveAuthorizationCatalogForApplication(value, generation.data.applicationId)) {
    return false;
  }
  const catalogGeneration = effectiveAuthorizationCatalogBindings.get(value)?.activeGenerations.get(ownerKey(generation.data.owner));
  return catalogGeneration !== undefined && canonicalJson(catalogGeneration) === canonicalJson(generation.data);
}

/** True only for an exact catalog-produced role-template entry bound to this customer application. */
export function isEffectiveRoleTemplateForApplication(value: unknown, applicationId: string): value is EffectiveRoleTemplate {
  return typeof value === "object" && value !== null && effectiveRoleTemplateApplications.get(value) === applicationId;
}

export function createPlatformPluginPolicyExecutable(value: PlatformPluginPolicyExecutableDeclaration): TrustedPolicyExecutable {
  const identity = parseExecutableIdentity(value);
  if (value.kind !== "platform-plugin" || identity.publisher.deliveryClass !== "platform-plugin" || !value.executor || typeof value.executor.evaluate !== "function") {
    fail("UNTRUSTED_EXECUTABLE", "Platform Plugin policy executable must use a narrow trusted executor.");
  }
  const executor = Object.freeze({ evaluate: value.executor.evaluate.bind(value.executor) });
  const executable = Object.freeze({ kind: "platform-plugin" as const, ...identity, publisher: identity.publisher as Extract<ExtensionPermissionPublisherRef, { readonly deliveryClass: "platform-plugin" }>, executor });
  trustedExecutables.add(executable);
  return executable;
}

export function createHotApplicationPolicyExecutable(value: HotApplicationPolicyExecutableDeclaration): TrustedPolicyExecutable {
  const identity = parseExecutableIdentity(value);
  const source = readRunnerBackedHotApplicationPolicyGatewaySource(value.gateway);
  if (value.kind !== "hot-application" || identity.publisher.deliveryClass !== "hot-application" || !isRunnerBackedHotApplicationPolicyGateway(value.gateway) || !source) {
    fail("UNTRUSTED_EXECUTABLE", "Hot Application policy executable must use the host capability gateway.");
  }
  const gateway = Object.freeze({ evaluate: value.gateway.evaluate.bind(value.gateway) });
  const executable = Object.freeze({ kind: "hot-application" as const, ...identity, publisher: identity.publisher as Extract<ExtensionPermissionPublisherRef, { readonly deliveryClass: "hot-application" }>, gateway });
  trustedExecutables.add(executable);
  hotApplicationExecutableSources.set(executable, source);
  return executable;
}

export const platformPermissionDescriptors: readonly AuthorizationPermissionDescriptor[] = Object.freeze([
  ["system.permissions.read", "Read permissions", "View active permission definitions.", "system.permissions", "read"],
  ["system.roles.read", "Read roles", "View customer roles and their grants.", "system.roles", "read"],
  ["system.roles.manage", "Manage roles", "Create and change customer roles and grants.", "system.roles", "manage"],
  ["system.role-assignments.read", "Read role assignments", "View active and revoked role assignments.", "system.role-assignments", "read"],
  ["system.role-assignments.manage", "Manage role assignments", "Create and revoke role assignments.", "system.role-assignments", "manage"],
  ["system.authorization.audit.read", "Read authorization audit", "View authorization audit records.", "system.authorization.audit", "read"],
  ["system.extensions.read", "Read extensions", "View extension state and inventory.", "system.extensions", "read"],
  ["system.catalog.refresh", "Refresh catalog", "Refresh the verified extension catalog.", "system.catalog", "execute"],
  ["system.extensions.plan", "Plan extension changes", "Preview extension lifecycle changes.", "system.extensions", "manage"],
  ["system.extensions.install-live", "Install live extensions", "Install a verified Hot Application or Theme Skin generation.", "system.extensions", "execute"],
  ["system.extensions.deploy-platform-plugin", "Deploy Platform Plugins", "Request a verified Platform Plugin deployment.", "system.extensions", "execute"],
  ["system.extensions.enable", "Enable extensions", "Enable a ready extension generation.", "system.extensions", "execute"],
  ["system.extensions.disable", "Disable extensions", "Disable an extension generation.", "system.extensions", "execute"],
  ["system.extensions.update", "Update extensions", "Request an extension update.", "system.extensions", "execute"],
  ["system.extensions.rollback", "Roll back extensions", "Request an extension rollback.", "system.extensions", "execute"],
  ["system.extensions.uninstall", "Uninstall extensions", "Request an extension uninstall.", "system.extensions", "execute"],
  ["system.extensions.quarantine", "Quarantine extensions", "Quarantine an unsafe extension generation.", "system.extensions", "execute"],
  ["system.settings.read", "Read system settings", "View system settings.", "system.settings", "read"],
  ["system.settings.manage", "Manage system settings", "Change system settings.", "system.settings", "manage"],
  ["system.themes.read", "Read themes", "View themes and theme profiles.", "system.themes", "read"],
  ["system.themes.manage", "Manage themes", "Change active themes and theme settings.", "system.themes", "manage"],
  [workspacePagePermissionIds[0], "Read workspace pages", "View authorized workspace pages.", "system.workspace-pages", "read"],
  [workspacePagePermissionIds[1], "Create workspace pages", "Create customer workspace pages.", "system.workspace-pages", "write"],
  [workspacePagePermissionIds[2], "Edit workspace pages", "Edit authorized workspace page working copies.", "system.workspace-pages", "write"],
  [workspacePagePermissionIds[3], "Publish workspace pages", "Publish or roll back authorized workspace pages.", "system.workspace-pages", "execute"],
  [workspacePagePermissionIds[4], "Manage workspace page access", "Grant or revoke exact page access.", "system.workspace-pages", "manage"],
  ["system.operations.read", "Read operations", "View operations, health, and receipts.", "system.operations", "read"],
  ["system.operations.backup", "Request backups", "Request a protected backup operation.", "system.operations", "execute"],
  ["system.operations.restore-drill", "Request restore drills", "Request a clean-environment restore drill.", "system.operations", "execute"]
].map(([id, title, description, resource, operation]) => deepFreeze(AuthorizationPermissionDescriptorSchema.parse({
  schemaVersion: 1, id, publisher: { kind: "platform", namespace: "system" }, title, description,
  audience: "authenticated", resource, operation, scope: "application"
}))));

export interface EffectivePermissionDescriptor { readonly descriptor: AuthorizationPermissionDescriptor; readonly owner: AuthorizationOwnerRef; }
export interface EffectivePolicyBinding { readonly binding: PermissionPolicyBinding; readonly owner: AuthorizationOwnerRef; }
export interface EffectiveRoleTemplate { readonly template: RoleTemplate; readonly owner: ExtensionAuthorizationOwnerRef; }

export interface EffectiveAuthorizationCatalog {
  readonly permissions: readonly EffectivePermissionDescriptor[];
  readonly policyBindings: readonly EffectivePolicyBinding[];
  readonly roleTemplates: readonly EffectiveRoleTemplate[];
  execute(input: unknown, signal: AbortSignal): Promise<AuthorizationPolicyExecutionResult>;
}

export interface AuthorizationPolicyExecutionResult {
  readonly schemaVersion: 1;
  readonly outcome: "allow" | "deny";
  readonly reason: "allowed" | "policy-denied" | "no-policy-binding" | "invalid-input" | "aborted" | "timeout" | "failure";
}

interface LifecycleState { readonly enabled: boolean; readonly ready: boolean; }
interface ParsedContribution {
  readonly applicationId: string;
  readonly owner: ExtensionAuthorizationOwnerRef;
  readonly generation: ExtensionAuthorizationGeneration;
  readonly active: boolean;
  readonly lifecycleRevision: number;
  readonly descriptors: readonly AuthorizationPermissionDescriptor[];
  readonly bindings: readonly PermissionPolicyBinding[];
  readonly templates: readonly RoleTemplate[];
}

interface BoundExecutable { readonly executable: TrustedPolicyExecutable; readonly binding: PermissionPolicyBinding; readonly owner: ExtensionAuthorizationOwnerRef; }

const maximumPolicyFactsBytes = 16_384;
const maximumPolicyFactsDepth = 8;
const applicationIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ownerKey = (owner: { readonly deliveryClass: string; readonly extensionId: string; readonly generation?: number }) => `${owner.deliveryClass}:${owner.extensionId}:${owner.generation ?? "publisher"}`;
const publisherKey = (publisher: { readonly deliveryClass: string; readonly extensionId: string }) => `${publisher.deliveryClass}:${publisher.extensionId}`;
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function detached<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function exactKeys(value: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === allowed.length && keys.every((key, index) => key === allowed[index]);
}

function parseLifecycle(value: unknown): LifecycleState {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !exactKeys(value, ["enabled", "ready"])) {
    fail("INVALID_LIFECYCLE", "Extension lifecycle state must contain only enabled and ready booleans.");
  }
  const lifecycle = value as Record<string, unknown>;
  if (typeof lifecycle.enabled !== "boolean" || typeof lifecycle.ready !== "boolean") fail("INVALID_LIFECYCLE", "Extension lifecycle state is invalid.");
  return Object.freeze({ enabled: lifecycle.enabled, ready: lifecycle.ready });
}

/** Converts verified declarative Hot Application authorization metadata into one catalog contribution. */
export function createHotApplicationManifestAuthorizationContribution(value: unknown): Readonly<{
  owner: ExtensionAuthorizationOwnerRef;
  generation: ExtensionAuthorizationGeneration;
  lifecycle: LifecycleState;
  descriptors: readonly AuthorizationPermissionDescriptor[];
  bindings: readonly PermissionPolicyBinding[];
  templates: readonly RoleTemplate[];
}> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !exactKeys(value, ["generation", "lifecycle", "source"])) {
    fail("INVALID_INPUT", "Hot Application manifest authorization input must contain only source, generation, and lifecycle.");
  }
  const input = value as Record<string, unknown>;
  const source = readAuthoritativeHotApplicationAuthorizationSource(input.source as AuthoritativeHotApplicationAuthorizationSource);
  const generation = ExtensionAuthorizationGenerationSchema.safeParse(input.generation);
  if (!source || !generation.success) fail("INVALID_INPUT", "Hot Application manifest authorization input lacks verified runtime authority.");
  const manifest = HotApplicationManifestSchema.safeParse(source.manifest);
  if (!manifest.success) fail("INVALID_INPUT", "Hot Application authorization source has no canonical manifest.");
  if (generation.data.owner.deliveryClass !== "hot-application" || generation.data.applicationId !== source.applicationId ||
    generation.data.owner.extensionId !== source.extensionId || !generation.data.runtimeGenerationIds.includes(source.generationId)) {
    fail("OWNER_MISMATCH", "Hot Application authorization generation does not exactly match verified runtime authority.");
  }
  const lifecycle = parseLifecycle(input.lifecycle);
  const contribution = deepFreeze({
    owner: detached(generation.data.owner),
    generation: detached(generation.data),
    lifecycle,
    descriptors: manifest.data.permissions.map(detached),
    bindings: manifest.data.policyBindings.map(detached),
    templates: (manifest.data.roleTemplates ?? []).map(detached)
  });
  parseContribution(contribution);
  hotApplicationAuthorizationContributions.add(contribution);
  hotApplicationContributionSources.set(contribution, source);
  return contribution;
}

/** Converts lifecycle-scoped static plugin registrations into one catalog contribution. */
export function createPlatformPluginRegistrationAuthorizationContribution(value: Readonly<{
  registration: ScopedRegistrationResult;
  generation: unknown;
  /** Durable runtime state may only remove availability from the static registration. */
  lifecycleOverride?: Readonly<{ enabled: boolean; ready: boolean }>;
}>): Readonly<{
  owner: ExtensionAuthorizationOwnerRef;
  generation: ExtensionAuthorizationGeneration;
  lifecycle: LifecycleState;
  descriptors: readonly AuthorizationPermissionDescriptor[];
  bindings: readonly PermissionPolicyBinding[];
  templates: readonly RoleTemplate[];
}> {
  assertExecutableRegistrationAuthority(value.registration);
  const generation = ExtensionAuthorizationGenerationSchema.safeParse(value.generation);
  if (!generation.success || generation.data.owner.deliveryClass !== "platform-plugin") {
    fail("INVALID_INPUT", "Platform Plugin authorization generation is not canonical.");
  }
  const pluginId = generation.data.owner.extensionId;
  if (!value.registration.inventory.some(({ id }) => id === pluginId)) {
    fail("OWNER_MISMATCH", "Platform Plugin authorization generation is not registered.");
  }
  const contributionValues = <T>(kind: "permissions" | "policyBindings" | "roleTemplates"): readonly T[] =>
    value.registration.contributions[kind]
      .filter(({ pluginId: registeredPluginId }) => registeredPluginId === pluginId)
      .map(({ value: contribution }) => detached(contribution) as T);
  const enabled = platformPluginEnabledInRegistration(value.registration, pluginId);
  const override = value.lifecycleOverride === undefined ? undefined : parseLifecycle(value.lifecycleOverride);
  const contribution = deepFreeze({
    owner: detached(generation.data.owner),
    generation: detached(generation.data),
    lifecycle: Object.freeze({ enabled: enabled && (override?.enabled ?? true), ready: enabled && (override?.ready ?? true) }),
    descriptors: contributionValues<AuthorizationPermissionDescriptor>("permissions"),
    bindings: contributionValues<PermissionPolicyBinding>("policyBindings"),
    templates: contributionValues<RoleTemplate>("roleTemplates")
  });
  parseContribution(contribution);
  platformPluginAuthorizationContributions.add(contribution);
  return contribution;
}

function samePublisher(owner: ExtensionAuthorizationOwnerRef, publisher: ExtensionPermissionPublisherRef): boolean {
  return owner.deliveryClass === publisher.deliveryClass && owner.extensionId === publisher.extensionId;
}

function parseDescriptor(value: unknown): AuthorizationPermissionDescriptor {
  if (PermissionCatalogSnapshotSchema.safeParse(value).success) fail("SNAPSHOT_NOT_AUTHORITY", "Administrative permission snapshots cannot authorize.");
  const parsed = AuthorizationPermissionDescriptorSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_DESCRIPTOR", "Permission descriptor is not canonical.");
  return detached(parsed.data);
}

function parseBinding(value: unknown): PermissionPolicyBinding {
  const parsed = PermissionPolicyBindingSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_BINDING", "Policy binding is not canonical.");
  return detached(parsed.data);
}

function parseTemplate(value: unknown): RoleTemplate {
  const parsed = RoleTemplateSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_TEMPLATE", "Role template is not canonical.");
  return detached(parsed.data);
}

function parseContribution(value: unknown): ParsedContribution {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !exactKeys(value, ["bindings", "descriptors", "generation", "lifecycle", "owner", "templates"])) {
    fail("INVALID_INPUT", "Extension catalog contribution has an invalid shape.");
  }
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.descriptors) || !Array.isArray(input.bindings) || !Array.isArray(input.templates)) fail("INVALID_INPUT", "Extension catalog contributions must use descriptor arrays.");
  const owner = ExtensionAuthorizationOwnerRefSchema.safeParse(input.owner);
  const generation = ExtensionAuthorizationGenerationSchema.safeParse(input.generation);
  if (!owner.success || !generation.success || ownerKey(owner.data) !== ownerKey(generation.data.owner)) fail("OWNER_MISMATCH", "Extension contribution owner must exactly match its authorization generation.");
  const lifecycle = parseLifecycle(input.lifecycle);
  const descriptors = input.descriptors.map(parseDescriptor);
  const bindings = input.bindings.map(parseBinding);
  const templates = input.templates.map(parseTemplate);
  for (const descriptor of descriptors) if (!samePublisher(owner.data, descriptor.publisher as ExtensionPermissionPublisherRef)) fail("OWNER_MISMATCH", "Permission descriptor publisher does not match its extension owner.");
  for (const binding of bindings) if (!samePublisher(owner.data, binding.publisher as ExtensionPermissionPublisherRef)) fail("OWNER_MISMATCH", "Policy binding publisher does not match its extension owner.");
  for (const template of templates) if (!samePublisher(owner.data, template.publisher)) fail("OWNER_MISMATCH", "Role template publisher does not match its extension owner.");
  const descriptorIds = new Set<string>();
  for (const descriptor of descriptors) {
    if (descriptorIds.has(descriptor.id)) fail("DUPLICATE_DESCRIPTOR", `Permission descriptor ${descriptor.id} is duplicate.`);
    descriptorIds.add(descriptor.id);
  }
  const bindingIds = new Set<string>();
  const bindingPermissions = new Set<string>();
  for (const binding of bindings) {
    if (bindingIds.has(binding.id) || bindingPermissions.has(binding.permissionId)) fail("DUPLICATE_BINDING", `Policy binding ${binding.id} is duplicate or ambiguously targets one permission.`);
    if (!descriptorIds.has(binding.permissionId)) fail("INVALID_BINDING", `Policy binding ${binding.id} targets an undeclared permission.`);
    const descriptor = descriptors.find(({ id }) => id === binding.permissionId)!;
    if (binding.scope !== descriptor.scope) fail("SCOPE_MISMATCH", `Policy binding ${binding.id} scope does not match ${descriptor.id}.`);
    bindingIds.add(binding.id);
    bindingPermissions.add(binding.permissionId);
  }
  for (const template of templates) for (const permissionId of template.permissionIds) {
    if (!descriptorIds.has(permissionId)) fail("INVALID_TEMPLATE", `Role template ${template.id} references an undeclared permission.`);
  }
  return Object.freeze({
    applicationId: generation.data.applicationId,
    owner: detached(owner.data),
    generation: detached(generation.data),
    active: generation.data.state === "current" && lifecycle.enabled && lifecycle.ready,
    lifecycleRevision: generation.data.lifecycleRevision,
    descriptors,
    bindings,
    templates
  });
}

function parseRoot(value: unknown): Readonly<{ applicationId: string; lifecycleRevision: number; extensions: readonly unknown[]; executables: readonly unknown[] }> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !exactKeys(value, ["applicationId", "executables", "extensions", "lifecycleRevision"])) {
    if (PermissionCatalogSnapshotSchema.safeParse(value).success) fail("SNAPSHOT_NOT_AUTHORITY", "Administrative permission snapshots cannot authorize.");
    fail("INVALID_INPUT", "Effective catalog input must contain only extension contributions and trusted executables.");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.applicationId !== "string" || !applicationIdPattern.test(input.applicationId) || typeof input.lifecycleRevision !== "number" || !Number.isSafeInteger(input.lifecycleRevision) || input.lifecycleRevision < 0
    || !Array.isArray(input.extensions) || !Array.isArray(input.executables)) fail("INVALID_INPUT", "Effective catalog input is invalid.");
  return Object.freeze({ applicationId: input.applicationId, lifecycleRevision: input.lifecycleRevision, extensions: input.extensions, executables: input.executables });
}

function parseTrustedExecutable(value: unknown): TrustedPolicyExecutable {
  if (typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "hot-application" && "execute" in value) {
    fail("HOT_APPLICATION_FUNCTION_FORBIDDEN", "Hot Application policy execution must use the host capability gateway.");
  }
  if (typeof value !== "object" || value === null || !trustedExecutables.has(value)) fail("UNTRUSTED_EXECUTABLE", "Policy executable was not created by a trusted K-Nex binding factory.");
  return value as TrustedPolicyExecutable;
}

function executionKey(publisher: ExtensionPermissionPublisherRef, bindingId: string): string {
  return `${publisherKey(publisher)}:${bindingId}`;
}

function sameHotApplicationSource(
  left: AuthoritativeHotApplicationAuthorizationRecord,
  right: AuthoritativeHotApplicationAuthorizationRecord
): boolean {
  return left.applicationId === right.applicationId && left.environment === right.environment && left.extensionId === right.extensionId &&
    left.generationId === right.generationId && left.sourceCommit === right.sourceCommit &&
    left.artifactDigest === right.artifactDigest && left.manifestDigest === right.manifestDigest;
}

function parseEvaluation(value: unknown): AuthorizationPolicyEvaluationInput | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const allowed = ["applicationId", "authorizationRevision", "delegation", "effectiveActor", "facts", "lifecycleRevision", "permissionId", "principal", "schemaVersion", "scope"];
  const input = value as Record<string, unknown>;
  const expected = input.delegation === undefined ? allowed.filter((key) => key !== "delegation") : allowed;
  const authorizationRevision = input.authorizationRevision;
  const lifecycleRevision = input.lifecycleRevision;
  if (!exactKeys(input, expected) || input.schemaVersion !== 1 || typeof input.applicationId !== "string" || !applicationIdPattern.test(input.applicationId) ||
    typeof authorizationRevision !== "number" || !Number.isSafeInteger(authorizationRevision) || authorizationRevision < 0 ||
    typeof lifecycleRevision !== "number" || !Number.isSafeInteger(lifecycleRevision) || lifecycleRevision < 0) return undefined;
  const permissionId = AuthorizationPermissionIdSchema.safeParse(input.permissionId);
  const scope = AuthorizationScopeSchema.safeParse(input.scope);
  const principal = AuthorizationSubjectSchema.safeParse(input.principal);
  const effectiveActor = AuthorizationSubjectSchema.safeParse(input.effectiveActor);
  const delegation = input.delegation === undefined ? undefined : AuthorizationDelegationSchema.safeParse(input.delegation);
  if (!permissionId.success || !scope.success || !principal.success || !effectiveActor.success || delegation !== undefined && !delegation.success || !boundedJson(input.facts, maximumPolicyFactsBytes, maximumPolicyFactsDepth)) return undefined;
  try {
    return deepFreeze({ schemaVersion: 1, applicationId: input.applicationId, authorizationRevision, lifecycleRevision, permissionId: permissionId.data, scope: detached(scope.data), principal: detached(principal.data), effectiveActor: detached(effectiveActor.data), ...(delegation === undefined ? {} : { delegation: detached(delegation.data) }), facts: detached(input.facts) });
  } catch { return undefined; }
}

function boundedJson(value: unknown, maximumBytes: number, maximumDepth: number): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  try {
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.depth > maximumDepth) return false;
      if (typeof current.value !== "object" || current.value === null) continue;
      if (seen.has(current.value)) return false;
      seen.add(current.value);
      for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value as Record<string, unknown>)) pending.push({ value: child, depth: current.depth + 1 });
    }
    return Buffer.byteLength(canonicalJson(value)) <= maximumBytes;
  } catch { return false; }
}

function result(outcome: "allow" | "deny", reason: AuthorizationPolicyExecutionResult["reason"]): AuthorizationPolicyExecutionResult {
  return Object.freeze({ schemaVersion: 1, outcome, reason });
}

async function invokeBound(executable: BoundExecutable, evaluation: AuthorizationPolicyEvaluationInput, signal: AbortSignal): Promise<AuthorizationPolicyExecutionResult> {
  if (signal.aborted) return result("deny", "aborted");
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { controller.abort(new Error("Policy binding timed out.")); resolve("timeout"); }, executable.binding.timeoutMs); });
    const operation = Promise.resolve().then(() => executable.executable.kind === "platform-plugin"
      ? executable.executable.executor.evaluate(evaluation, controller.signal)
      : executable.executable.gateway.evaluate({ owner: executable.owner, binding: executable.binding, evaluation, signal: controller.signal }))
      .then((value) => ({ kind: "value" as const, value }), () => ({ kind: "failure" as const }));
    const settled = await Promise.race([operation, timeout]);
    if (settled === "timeout") return result("deny", "timeout");
    if (settled.kind === "failure" || controller.signal.aborted) return result("deny", signal.aborted ? "aborted" : "failure");
    const parsed = parseOutcome(settled.value);
    if (!parsed) return result("deny", "failure");
    return parsed.outcome === "allow" ? result("allow", "allowed") : result("deny", "policy-denied");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

function parseOutcome(value: unknown): AuthorizationPolicyEvaluationOutcome | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !exactKeys(value, ["outcome", "schemaVersion"])) return undefined;
  const outcome = value as Record<string, unknown>;
  return outcome.schemaVersion === 1 && (outcome.outcome === "allow" || outcome.outcome === "deny")
    ? Object.freeze({ schemaVersion: 1, outcome: outcome.outcome }) : undefined;
}

/** Builds the only runtime authorization source; administrative snapshots are rejected before reconciliation. */
export function createEffectiveAuthorizationCatalog(value: unknown): EffectiveAuthorizationCatalog {
  const input = parseRoot(value);
  const hotSourceByOwner = new Map<string, AuthoritativeHotApplicationAuthorizationRecord>();
  const contributions = input.extensions.map((extension) => {
    if (typeof extension !== "object" || extension === null ||
      !platformPluginAuthorizationContributions.has(extension) && !hotApplicationAuthorizationContributions.has(extension)) {
      fail("INVALID_INPUT", "Extension catalog contributions must originate from authoritative registration or a verified Hot Application manifest.");
    }
    const contribution = parseContribution(extension);
    const source = hotApplicationContributionSources.get(extension);
    if (source) hotSourceByOwner.set(ownerKey(contribution.owner), source);
    return contribution;
  });
  const contributionKeys = new Set<string>();
  const descriptorIds = new Set<string>();
  const bindingIds = new Set<string>();
  const bindingPermissionIds = new Set<string>();
  const templateIds = new Set<string>();
  for (const contribution of contributions) {
    if (contribution.applicationId !== input.applicationId) fail("OWNER_MISMATCH", "Extension contribution belongs to another application.");
    const key = ownerKey(contribution.owner);
    if (contributionKeys.has(key)) fail("OWNER_MISMATCH", "An extension generation may contribute only one catalog declaration.");
    contributionKeys.add(key);
    for (const descriptor of contribution.descriptors) {
      if (descriptorIds.has(descriptor.id)) fail("DUPLICATE_DESCRIPTOR", `Permission descriptor ${descriptor.id} is duplicate across extension contributions.`);
      descriptorIds.add(descriptor.id);
    }
    for (const binding of contribution.bindings) {
      if (bindingIds.has(binding.id) || bindingPermissionIds.has(binding.permissionId)) fail("DUPLICATE_BINDING", `Policy binding ${binding.id} is duplicate or ambiguously targets one permission across extension contributions.`);
      bindingIds.add(binding.id);
      bindingPermissionIds.add(binding.permissionId);
    }
    for (const template of contribution.templates) {
      if (templateIds.has(template.id)) fail("DUPLICATE_TEMPLATE", `Role template ${template.id} is duplicate across extension contributions.`);
      templateIds.add(template.id);
    }
  }
  if (contributions.some(({ lifecycleRevision }) => lifecycleRevision > input.lifecycleRevision)) {
    fail("INVALID_LIFECYCLE", "Extension generation cannot be newer than its effective catalog.");
  }
  const executables = input.executables.map(parseTrustedExecutable);
  const executableByBinding = new Map<string, TrustedPolicyExecutable>();
  for (const executable of executables) {
    const key = executionKey(executable.publisher, executable.bindingId);
    if (executableByBinding.has(key)) fail("DUPLICATE_EXECUTABLE", `Policy executable ${executable.bindingId} is duplicate.`);
    executableByBinding.set(key, executable);
  }
  const allBindings = contributions.flatMap((contribution) => contribution.bindings.map((binding) => ({ binding, owner: contribution.owner })));
  const boundExecutables = new Map<string, BoundExecutable>();
  for (const { binding, owner } of allBindings) {
    const key = executionKey(binding.publisher as ExtensionPermissionPublisherRef, binding.id);
    const executable = executableByBinding.get(key);
    if (!executable) {
      if (executables.some((candidate) => candidate.bindingId === binding.id)) fail("OWNER_MISMATCH", `Policy executable ${binding.id} belongs to another publisher.`);
      fail("MISSING_EXECUTABLE", `Policy binding ${binding.id} has no trusted executable implementation.`);
    }
    if (!samePublisher(owner, executable.publisher) || executable.policyReference !== binding.policyReference || executable.kind !== owner.deliveryClass) {
      fail(executable.policyReference !== binding.policyReference ? "REFERENCE_MISMATCH" : "OWNER_MISMATCH", `Policy executable ${binding.id} does not exactly match its declaration.`);
    }
    if (executable.kind === "hot-application") {
      const contributionSource = hotSourceByOwner.get(ownerKey(owner));
      const executableSource = hotApplicationExecutableSources.get(executable);
      if (!contributionSource || !executableSource || !sameHotApplicationSource(contributionSource, executableSource)) {
        fail("OWNER_MISMATCH", `Hot Application policy executable ${binding.id} belongs to another verified generation.`);
      }
    }
    boundExecutables.set(key, Object.freeze({ executable, binding, owner }));
  }
  for (const [key] of executableByBinding) if (!boundExecutables.has(key)) fail("UNDECLARED_EXECUTABLE", "Trusted policy executable has no declared policy binding.");

  const platformPermissions = platformPermissionDescriptors.map((descriptor) => deepFreeze({ descriptor: detached(descriptor), owner: Object.freeze({ kind: "platform" as const, namespace: "system" }) }));
  const extensionPermissions = contributions.filter(({ active }) => active).flatMap(({ owner, descriptors }) => descriptors.map((descriptor) => deepFreeze({ descriptor: detached(descriptor), owner: detached(owner) })));
  const activeBindings = contributions.filter(({ active }) => active).flatMap(({ owner, bindings }) => bindings.map((binding) => deepFreeze({ binding: detached(binding), owner: detached(owner) })));
  const templates = contributions.filter(({ active }) => active).flatMap(({ owner, templates }) => templates.map((template) => deepFreeze({ template: detached(template), owner: detached(owner) })));
  const permissions = Object.freeze([...platformPermissions, ...extensionPermissions].sort((left, right) => compare(left.descriptor.id, right.descriptor.id)));
  const policyBindings = Object.freeze(activeBindings.sort((left, right) => compare(left.binding.id, right.binding.id)));
  const roleTemplates = Object.freeze(templates.sort((left, right) => compare(left.template.id, right.template.id)));
  for (const roleTemplate of roleTemplates) effectiveRoleTemplateApplications.set(roleTemplate, input.applicationId);
  const executableByPermission = new Map<string, BoundExecutable>();
  for (const binding of policyBindings) {
    const executable = boundExecutables.get(executionKey(binding.binding.publisher as ExtensionPermissionPublisherRef, binding.binding.id));
    if (executable) executableByPermission.set(binding.binding.permissionId, executable);
  }
  const catalog = Object.freeze({
    permissions,
    policyBindings,
    roleTemplates,
    async execute(evaluationValue: unknown, signal: AbortSignal): Promise<AuthorizationPolicyExecutionResult> {
      const evaluation = parseEvaluation(evaluationValue);
      if (!evaluation) return result("deny", "invalid-input");
      if (evaluation.applicationId !== input.applicationId) return result("deny", "invalid-input");
      if (signal.aborted) return result("deny", "aborted");
      const executable = executableByPermission.get(evaluation.permissionId);
      if (!executable) return result("deny", "no-policy-binding");
      const descriptor = permissions.find(({ descriptor: entry }) => entry.id === evaluation.permissionId)?.descriptor;
      if (!descriptor || descriptor.scope !== executable.binding.scope || evaluation.scope.kind !== descriptor.scope || evaluation.scope.resource !== descriptor.resource) {
        return result("deny", "invalid-input");
      }
      return invokeBound(executable, evaluation, signal);
    }
  });
  effectiveAuthorizationCatalogs.add(catalog);
  effectiveAuthorizationCatalogApplications.set(catalog, input.applicationId);
  effectiveAuthorizationCatalogBindings.set(catalog, Object.freeze({
    lifecycleRevision: input.lifecycleRevision,
    activeGenerations: new Map(contributions
      .filter(({ active }) => active)
      .map(({ owner, generation }) => [ownerKey(owner), generation]))
  }));
  return catalog;
}
