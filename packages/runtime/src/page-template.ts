import {
  PluginPageTemplateDescriptorSchema,
  UiDocumentSchema,
  type PluginPageTemplateDescriptor,
  type UiDocument
} from "@k-nex/contracts";

export type PageTemplateErrorCode =
  | "ACTION_MISSING"
  | "BLOCK_MISSING"
  | "CAPABILITY_MISSING"
  | "DEFINITION_INVALID"
  | "DOCUMENT_INVALID"
  | "DOWNGRADE_UNSUPPORTED"
  | "INSTANCE_CONFLICT"
  | "INSTANCE_MISSING"
  | "MIGRATION_FAILED"
  | "MIGRATION_UNAVAILABLE"
  | "PERMISSION_MISSING"
  | "ROUTE_MISSING"
  | "SOURCE_MISSING";

export class PageTemplateError extends Error {
  constructor(readonly code: PageTemplateErrorCode, message: string, readonly path: readonly string[] = []) {
    super(message);
    this.name = "PageTemplateError";
  }
}

export interface PageTemplateInventory {
  readonly capabilities: ReadonlyMap<string, string>;
  readonly routes: ReadonlySet<string>;
  readonly permissions: ReadonlySet<string>;
  readonly sources: ReadonlySet<string>;
  readonly actions: ReadonlySet<string>;
  readonly blocks: ReadonlySet<string>;
}

export interface CustomerPageTemplateInstance {
  readonly templateId: string;
  readonly adoptedTemplateVersion: number;
  readonly revision: number;
  readonly ownership: "customer";
  readonly document: UiDocument;
}

export interface PageTemplateStore {
  read(templateId: string): Promise<CustomerPageTemplateInstance | undefined>;
  createIfAbsent(instance: CustomerPageTemplateInstance): Promise<{ readonly created: boolean; readonly instance: CustomerPageTemplateInstance }>;
  replace(instance: CustomerPageTemplateInstance, expectedRevision: number): Promise<CustomerPageTemplateInstance | undefined>;
}

export interface PageTemplateInstantiationResult {
  readonly created: boolean;
  readonly instance: CustomerPageTemplateInstance;
}

export interface PageTemplateComparison {
  readonly status: "current" | "update-available";
  readonly current: CustomerPageTemplateInstance;
  readonly candidate?: UiDocument;
  readonly targetTemplateVersion: number;
}

export type PageTemplateMigration = (current: Readonly<UiDocument>, nextTemplate: Readonly<UiDocument>) => unknown;

function fail(code: PageTemplateErrorCode, message: string, path: readonly string[] = []): never {
  throw new PageTemplateError(code, message, Object.freeze([...path]));
}

function freezeInstance(instance: CustomerPageTemplateInstance): CustomerPageTemplateInstance {
  const clone = structuredClone(instance);
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(clone);
  return clone;
}

function resourceKey(value: { readonly id: string; readonly version: number }): string {
  return `${value.id}@${value.version}`;
}

export function preflightPluginPageTemplate(value: PluginPageTemplateDescriptor, inventory: PageTemplateInventory): PluginPageTemplateDescriptor {
  const parsed = PluginPageTemplateDescriptorSchema.safeParse(value);
  if (!parsed.success) fail("DEFINITION_INVALID", "Plugin page template descriptor is invalid.");
  const descriptor = parsed.data;
  if (!inventory.routes.has(descriptor.route.routeId)) fail("ROUTE_MISSING", `Template route ${descriptor.route.routeId} is unavailable.`, [descriptor.route.routeId]);
  if (!inventory.permissions.has(descriptor.permission)) fail("PERMISSION_MISSING", `Template permission ${descriptor.permission} is unavailable.`, [descriptor.permission]);
  for (const requirement of descriptor.requirements.capabilities) {
    if (inventory.capabilities.get(requirement.id) !== requirement.version) {
      fail("CAPABILITY_MISSING", `Template capability ${requirement.id}@${requirement.version} is unavailable.`, [requirement.id]);
    }
  }
  for (const [kind, requirements, available, code] of [
    ["source", descriptor.requirements.sources, inventory.sources, "SOURCE_MISSING"],
    ["action", descriptor.requirements.actions, inventory.actions, "ACTION_MISSING"],
    ["block", descriptor.requirements.blocks, inventory.blocks, "BLOCK_MISSING"]
  ] as const) {
    for (const requirement of requirements) {
      const key = resourceKey(requirement);
      if (!available.has(key)) fail(code, `Template ${kind} ${key} is unavailable.`, [requirement.id]);
    }
  }
  return descriptor;
}

export async function instantiatePluginPageTemplate(
  descriptorValue: PluginPageTemplateDescriptor,
  inventory: PageTemplateInventory,
  store: PageTemplateStore
): Promise<PageTemplateInstantiationResult> {
  const descriptor = preflightPluginPageTemplate(descriptorValue, inventory);
  const existing = await store.read(descriptor.id);
  if (existing !== undefined) return Object.freeze({ created: false, instance: freezeInstance(existing) });
  const candidate = freezeInstance({
    templateId: descriptor.id,
    adoptedTemplateVersion: descriptor.version,
    revision: 1,
    ownership: "customer",
    document: descriptor.document
  });
  const result = await store.createIfAbsent(candidate);
  return Object.freeze({ created: result.created, instance: freezeInstance(result.instance) });
}

export async function comparePluginPageTemplate(
  descriptorValue: PluginPageTemplateDescriptor,
  inventory: PageTemplateInventory,
  store: PageTemplateStore,
  migrate?: PageTemplateMigration
): Promise<PageTemplateComparison> {
  const descriptor = preflightPluginPageTemplate(descriptorValue, inventory);
  const current = await store.read(descriptor.id);
  if (current === undefined) fail("INSTANCE_MISSING", `Template instance ${descriptor.id} does not exist.`, [descriptor.id]);
  if (current.adoptedTemplateVersion > descriptor.version) fail("DOWNGRADE_UNSUPPORTED", "A page template cannot adopt an older package version.", [descriptor.id]);
  if (current.adoptedTemplateVersion === descriptor.version) {
    return Object.freeze({ status: "current", current: freezeInstance(current), targetTemplateVersion: descriptor.version });
  }
  if (!descriptor.migration?.adoptableFromVersions.includes(current.adoptedTemplateVersion) || migrate === undefined) {
    fail("MIGRATION_UNAVAILABLE", `Template ${descriptor.id} has no explicit adoption migration from version ${current.adoptedTemplateVersion}.`, [descriptor.id]);
  }
  let migrated: unknown;
  try {
    migrated = migrate(structuredClone(current.document), structuredClone(descriptor.document));
  } catch {
    fail("MIGRATION_FAILED", `Template ${descriptor.id} adoption migration failed.`, [descriptor.id]);
  }
  const document = UiDocumentSchema.safeParse(migrated);
  if (!document.success || document.data.id !== descriptor.id || document.data.profile !== descriptor.profile) {
    fail("DOCUMENT_INVALID", `Template ${descriptor.id} adoption migration returned an invalid document.`, [descriptor.id]);
  }
  return Object.freeze({
    status: "update-available",
    current: freezeInstance(current),
    candidate: freezeInstance({ ...current, document: document.data }).document,
    targetTemplateVersion: descriptor.version
  });
}

export async function adoptPluginPageTemplate(
  descriptor: PluginPageTemplateDescriptor,
  inventory: PageTemplateInventory,
  store: PageTemplateStore,
  expectedRevision: number,
  migrate: PageTemplateMigration
): Promise<CustomerPageTemplateInstance> {
  const comparison = await comparePluginPageTemplate(descriptor, inventory, store, migrate);
  if (comparison.status !== "update-available" || comparison.candidate === undefined) return comparison.current;
  if (comparison.current.revision !== expectedRevision) fail("INSTANCE_CONFLICT", "Page template instance revision changed before adoption.", [descriptor.id]);
  const replaced = await store.replace(freezeInstance({
    ...comparison.current,
    adoptedTemplateVersion: comparison.targetTemplateVersion,
    revision: comparison.current.revision + 1,
    document: comparison.candidate
  }), expectedRevision);
  if (replaced === undefined) fail("INSTANCE_CONFLICT", "Page template instance revision changed during adoption.", [descriptor.id]);
  return freezeInstance(replaced);
}
