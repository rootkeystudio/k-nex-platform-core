import {
  PluginSettingValueSchema,
  SecretReferenceSchema,
  SettingsAdministrationViewSchema,
  SettingsStoredDocumentSchema,
  SystemSettingsDescriptorSchema,
  type PluginSettingValue,
  type SettingsAdministrationView,
  type SettingsStoredDocument,
  type SystemSettingsDescriptor,
  type SystemSettingsFieldDescriptor
} from "@k-nex/contracts";

export type SystemSettingsProjectionErrorCode = "DEFINITION_INVALID" | "FIELD_INVALID" | "FIELD_REQUIRED" | "FIELD_UNKNOWN" | "DOCUMENT_INVALID";

export class SystemSettingsProjectionError extends Error {
  constructor(readonly code: SystemSettingsProjectionErrorCode, message: string, readonly path: readonly string[] = []) {
    super(message);
    this.name = "SystemSettingsProjectionError";
  }
}

function fail(code: SystemSettingsProjectionErrorCode, message: string, path: readonly string[] = []): never {
  throw new SystemSettingsProjectionError(code, message, Object.freeze([...path]));
}

function fieldDefault(field: SystemSettingsFieldDescriptor): PluginSettingValue | undefined {
  return "default" in field ? field.default : undefined;
}

function validFieldValue(field: SystemSettingsFieldDescriptor, value: PluginSettingValue): boolean {
  if (!PluginSettingValueSchema.safeParse(value).success) return false;
  if (field.type === "string") return typeof value === "string" && (field.allowed === undefined || field.allowed.includes(value));
  if (field.type === "integer") return typeof value === "number" && Number.isSafeInteger(value)
    && (field.minimum === undefined || value >= field.minimum) && (field.maximum === undefined || value <= field.maximum);
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "string-list") return Array.isArray(value) && value.every((item) => typeof item === "string");
  return SecretReferenceSchema.safeParse(value).success;
}

function validatedDescriptor(descriptor: SystemSettingsDescriptor): SystemSettingsDescriptor {
  const parsed = SystemSettingsDescriptorSchema.safeParse(descriptor);
  if (!parsed.success) fail("DEFINITION_INVALID", "System settings descriptor is invalid.");
  return parsed.data;
}

function frozenValues(values: Readonly<Record<string, PluginSettingValue>>): Readonly<Record<string, PluginSettingValue>> {
  let clone: Record<string, PluginSettingValue>;
  try { clone = structuredClone(values); }
  catch { fail("FIELD_INVALID", "System settings must contain cloneable data values."); }
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(clone);
  return clone;
}

function resolveValues(
  descriptor: SystemSettingsDescriptor,
  values: Readonly<Record<string, PluginSettingValue>>,
  rejectUnknown: boolean
): Readonly<Record<string, PluginSettingValue>> {
  const definition = validatedDescriptor(descriptor);
  if (rejectUnknown) {
    for (const key of Object.keys(values)) if (definition.fields[key] === undefined) {
      fail("FIELD_UNKNOWN", `System setting ${key} is not declared.`, [key]);
    }
  }
  const resolved: Record<string, PluginSettingValue> = {};
  for (const [key, field] of Object.entries(definition.fields)) {
    const value = Object.hasOwn(values, key) ? values[key] : fieldDefault(field);
    if (value === undefined) {
      if (field.required) fail("FIELD_REQUIRED", `System setting ${key} is required.`, [key]);
      continue;
    }
    if (!validFieldValue(field, value)) fail("FIELD_INVALID", `System setting ${key} has an invalid value.`, [key]);
    resolved[key] = value;
  }
  return frozenValues(resolved);
}

/** Validates one closed write against its exact trusted descriptor. */
export function validateSystemSettingsValues(
  descriptor: SystemSettingsDescriptor,
  values: Readonly<Record<string, PluginSettingValue>>
): Readonly<Record<string, PluginSettingValue>> {
  return resolveValues(descriptor, values, true);
}

/** Projects retained values onto a newer descriptor without executing extension code. */
export function projectSystemSettingsValues(
  descriptor: SystemSettingsDescriptor,
  retainedValues: Readonly<Record<string, PluginSettingValue>> = {}
): Readonly<Record<string, PluginSettingValue>> {
  return resolveValues(descriptor, retainedValues, false);
}

/** Builds the closed, secret-redacted administration projection from stored values. */
export function projectSettingsAdministrationView(
  descriptor: SystemSettingsDescriptor,
  document: SettingsStoredDocument,
  settingsRevision: number,
  state: SettingsAdministrationView["state"] = document.state === "effective" ? "effective" : "pending-validation"
): SettingsAdministrationView {
  const parsedDocument = SettingsStoredDocumentSchema.safeParse(document);
  if (!parsedDocument.success) fail("DOCUMENT_INVALID", "System settings document is invalid.");
  const definition = validatedDescriptor(descriptor);
  const values = projectSystemSettingsValues(definition, parsedDocument.data.values);
  const fields = Object.fromEntries(Object.entries(definition.fields).map(([key, field]) => {
    const value = values[key];
    if (field.type === "secret-reference") return [key, value === undefined ? { kind: "unset" } : { kind: "redacted-secret" }];
    return [key, value === undefined ? { kind: "unset" } : { kind: "visible-value", value }];
  }));
  const view = {
    schemaVersion: 1 as const,
    identity: parsedDocument.data.identity,
    descriptor: definition,
    state,
    documentRevision: parsedDocument.data.documentRevision,
    settingsRevision,
    fields
  };
  const parsedView = SettingsAdministrationViewSchema.safeParse(view);
  if (!parsedView.success) fail("DOCUMENT_INVALID", "System settings document does not match its descriptor.");
  return Object.freeze(parsedView.data);
}
