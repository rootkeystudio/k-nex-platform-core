import {
  PluginSettingsDescriptorSchema,
  PluginSettingsDocumentSchema,
  SecretReferenceSchema,
  type PluginSettingField,
  type PluginSettingValue,
  type PluginSettingsDescriptor,
  type PluginSettingsDocument,
  type RuntimeSchema
} from "@k-nex/contracts";

export type PluginSettingsErrorCode =
  | "ACCESS_DENIED"
  | "DEFINITION_INVALID"
  | "DOCUMENT_INVALID"
  | "FIELD_INVALID"
  | "FIELD_REQUIRED"
  | "FIELD_UNKNOWN"
  | "MIGRATION_INVALID"
  | "MIGRATION_FAILED"
  | "REVISION_CONFLICT"
  | "SCHEMA_INVALID";

export class PluginSettingsError extends Error {
  constructor(readonly code: PluginSettingsErrorCode, message: string, readonly path: readonly string[] = []) {
    super(message);
    this.name = "PluginSettingsError";
  }
}

export interface PluginSettingsMigration {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(values: Readonly<Record<string, PluginSettingValue>>): Readonly<Record<string, PluginSettingValue>>;
}

export interface PluginSettingsRuntimeDefinition<T extends Readonly<Record<string, PluginSettingValue>>> {
  readonly descriptor: PluginSettingsDescriptor;
  readonly schema: RuntimeSchema<T>;
  readonly migrations: readonly PluginSettingsMigration[];
}

export interface ResolvedPluginSettings<T extends Readonly<Record<string, PluginSettingValue>>> {
  readonly settingsId: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly values: T;
}

export interface PluginSettingsAuthorizer<TContext> {
  authorize(input: Readonly<{
    operation: "read" | "change";
    descriptor: PluginSettingsDescriptor;
    context: TContext;
    signal: AbortSignal;
  }>): boolean | Promise<boolean>;
}

export interface PluginSettingsStore {
  read(settingsId: string): Promise<PluginSettingsDocument | undefined>;
  replace(document: PluginSettingsDocument, expectedRevision: number): Promise<PluginSettingsDocument | undefined>;
}

export class PluginSettingsService<TContext> {
  constructor(private readonly store: PluginSettingsStore, private readonly authorizer: PluginSettingsAuthorizer<TContext>) {}

  async read<T extends Readonly<Record<string, PluginSettingValue>>>(
    definition: PluginSettingsRuntimeDefinition<T>,
    context: TContext,
    signal: AbortSignal = new AbortController().signal
  ): Promise<ResolvedPluginSettings<T>> {
    if (!await this.authorized({ operation: "read", descriptor: definition.descriptor, context, signal })) fail("ACCESS_DENIED", "Plugin settings read access is denied.");
    return resolvePluginSettings(definition, await this.store.read(definition.descriptor.id));
  }

  async change<T extends Readonly<Record<string, PluginSettingValue>>>(input: {
    readonly definition: PluginSettingsRuntimeDefinition<T>;
    readonly context: TContext;
    readonly expectedRevision: number;
    readonly values: T;
    readonly signal?: AbortSignal;
  }): Promise<ResolvedPluginSettings<T>> {
    const signal = input.signal ?? new AbortController().signal;
    if (!await this.authorized({ operation: "change", descriptor: input.definition.descriptor, context: input.context, signal })) fail("ACCESS_DENIED", "Plugin settings change access is denied.");
    const current = await this.store.read(input.definition.descriptor.id);
    if (current === undefined || current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Plugin settings revision changed before update.");
    const candidate: PluginSettingsDocument = {
      settingsId: input.definition.descriptor.id,
      schemaVersion: input.definition.descriptor.schemaVersion,
      revision: current.revision + 1,
      values: input.values
    };
    const normalized = resolvePluginSettings(input.definition, candidate);
    const replaced = await this.store.replace({
      settingsId: normalized.settingsId,
      schemaVersion: normalized.schemaVersion,
      revision: normalized.revision,
      values: normalized.values
    }, input.expectedRevision);
    if (replaced === undefined) fail("REVISION_CONFLICT", "Plugin settings revision changed during update.");
    return resolvePluginSettings(input.definition, replaced);
  }

  private async authorized(input: Parameters<PluginSettingsAuthorizer<TContext>["authorize"]>[0]): Promise<boolean> {
    if (input.signal.aborted) return false;
    try { return await this.authorizer.authorize(input) === true && !input.signal.aborted; }
    catch { return false; }
  }
}

function fail(code: PluginSettingsErrorCode, message: string, path: readonly string[] = []): never {
  throw new PluginSettingsError(code, message, Object.freeze([...path]));
}

function cloneRecord(values: Readonly<Record<string, PluginSettingValue>>): Record<string, PluginSettingValue> {
  try {
    return structuredClone(values) as Record<string, PluginSettingValue>;
  } catch {
    fail("FIELD_INVALID", "Plugin settings must contain cloneable data values.");
  }
}

function fieldDefault(field: PluginSettingField): PluginSettingValue | undefined {
  return "default" in field ? field.default : undefined;
}

function validFieldValue(field: PluginSettingField, value: PluginSettingValue): boolean {
  if (field.type === "string") return typeof value === "string" && (field.allowed === undefined || field.allowed.includes(value));
  if (field.type === "integer") {
    return typeof value === "number" && Number.isSafeInteger(value) &&
      (field.minimum === undefined || value >= field.minimum) &&
      (field.maximum === undefined || value <= field.maximum);
  }
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "string-list") return Array.isArray(value) && value.every((item) => typeof item === "string");
  return SecretReferenceSchema.safeParse(value).success;
}

function validateValues(descriptor: PluginSettingsDescriptor, values: Readonly<Record<string, PluginSettingValue>>): void {
  for (const key of Object.keys(values)) {
    if (descriptor.fields[key] === undefined) fail("FIELD_UNKNOWN", `Plugin setting ${key} is not declared.`, [key]);
  }
  for (const [key, field] of Object.entries(descriptor.fields)) {
    const value = values[key];
    if (value === undefined) {
      if (field.required && fieldDefault(field) === undefined) fail("FIELD_REQUIRED", `Plugin setting ${key} is required.`, [key]);
      continue;
    }
    if (!validFieldValue(field, value)) fail("FIELD_INVALID", `Plugin setting ${key} has an invalid value.`, [key]);
  }
}

function migrationMap(descriptor: PluginSettingsDescriptor, migrations: readonly PluginSettingsMigration[]): ReadonlyMap<number, PluginSettingsMigration> {
  const byVersion = new Map<number, PluginSettingsMigration>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.fromVersion) || migration.fromVersion < 1 || migration.toVersion !== migration.fromVersion + 1 ||
      migration.toVersion > descriptor.schemaVersion || byVersion.has(migration.fromVersion) || typeof migration.migrate !== "function") {
      fail("MIGRATION_INVALID", "Plugin settings migrations must be unique sequential version steps.");
    }
    byVersion.set(migration.fromVersion, migration);
  }
  return byVersion;
}

function defaults(descriptor: PluginSettingsDescriptor): Record<string, PluginSettingValue> {
  return Object.fromEntries(Object.entries(descriptor.fields).flatMap(([key, field]) => {
    const value = fieldDefault(field);
    return value === undefined ? [] : [[key, structuredClone(value) as PluginSettingValue]];
  }));
}

function freezeRecord<T extends Readonly<Record<string, PluginSettingValue>>>(values: T): T {
  const clone = structuredClone(values) as T;
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(clone);
  return clone;
}

export function resolvePluginSettings<T extends Readonly<Record<string, PluginSettingValue>>>(
  definition: PluginSettingsRuntimeDefinition<T>,
  document?: PluginSettingsDocument
): ResolvedPluginSettings<T> {
  const descriptor = PluginSettingsDescriptorSchema.safeParse(definition.descriptor);
  if (!descriptor.success || typeof definition.schema?.safeParse !== "function") {
    fail("DEFINITION_INVALID", "Plugin settings definition is invalid.");
  }
  const migrations = migrationMap(descriptor.data, definition.migrations);

  let version = descriptor.data.schemaVersion;
  let revision = 1;
  let values: Record<string, PluginSettingValue> = {};
  if (document !== undefined) {
    const parsed = PluginSettingsDocumentSchema.safeParse(document);
    if (!parsed.success || parsed.data.settingsId !== descriptor.data.id || parsed.data.schemaVersion > descriptor.data.schemaVersion) {
      fail("DOCUMENT_INVALID", "Plugin settings document identity or version is invalid.");
    }
    version = parsed.data.schemaVersion;
    revision = parsed.data.revision;
    values = cloneRecord(parsed.data.values);
  }

  while (version < descriptor.data.schemaVersion) {
    const migration = migrations.get(version);
    if (migration === undefined) fail("MIGRATION_INVALID", `Plugin settings migration ${version} -> ${version + 1} is missing.`);
    let migrated: Readonly<Record<string, PluginSettingValue>>;
    try {
      migrated = migration.migrate(Object.freeze(cloneRecord(values)));
    } catch {
      fail("MIGRATION_FAILED", `Plugin settings migration ${version} -> ${version + 1} failed.`);
    }
    const parsed = PluginSettingsDocumentSchema.safeParse({
      settingsId: descriptor.data.id,
      schemaVersion: version + 1,
      revision: revision + 1,
      values: migrated
    });
    if (!parsed.success) fail("MIGRATION_FAILED", `Plugin settings migration ${version} -> ${version + 1} returned invalid data.`);
    values = cloneRecord(parsed.data.values);
    version += 1;
    revision += 1;
  }

  values = { ...defaults(descriptor.data), ...values };
  validateValues(descriptor.data, values);
  const parsedValues = definition.schema.safeParse(values);
  if (!parsedValues.success) fail("SCHEMA_INVALID", "Plugin settings failed the strict runtime schema.");
  const normalized = PluginSettingsDocumentSchema.safeParse({
    settingsId: descriptor.data.id,
    schemaVersion: descriptor.data.schemaVersion,
    revision,
    values: parsedValues.data
  });
  if (!normalized.success) fail("SCHEMA_INVALID", "Plugin settings runtime schema returned invalid data.");
  validateValues(descriptor.data, normalized.data.values);

  return Object.freeze({
    settingsId: descriptor.data.id,
    schemaVersion: descriptor.data.schemaVersion,
    revision,
    values: freezeRecord(normalized.data.values as T)
  });
}
