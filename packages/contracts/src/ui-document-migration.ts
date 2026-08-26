import {
  UI_DOCUMENT_SCHEMA_VERSION,
  UiDocumentSchema,
  type UiDocument
} from "./ui-document.js";

export type UiDocumentMigrationErrorCode =
  | "MISSING_SCHEMA_VERSION"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_DOCUMENT";

export class UiDocumentMigrationError extends Error {
  readonly code: UiDocumentMigrationErrorCode;

  constructor(code: UiDocumentMigrationErrorCode, message: string) {
    super(message);
    this.name = "UiDocumentMigrationError";
    this.code = code;
  }
}

function schemaVersionOf(value: unknown): number | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "schemaVersion")) {
    return undefined;
  }

  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  return typeof schemaVersion === "number" ? schemaVersion : undefined;
}

/** Validate the current UI document version and return an isolated document snapshot. */
export function migrateUiDocumentToCurrent(value: unknown): UiDocument {
  const schemaVersion = schemaVersionOf(value);
  if (schemaVersion === undefined) {
    throw new UiDocumentMigrationError("MISSING_SCHEMA_VERSION", "UI document schemaVersion is required.");
  }
  if (schemaVersion !== UI_DOCUMENT_SCHEMA_VERSION) {
    throw new UiDocumentMigrationError("UNSUPPORTED_SCHEMA_VERSION", "UI document schemaVersion is unsupported.");
  }

  const parsed = UiDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new UiDocumentMigrationError("INVALID_DOCUMENT", "UI document does not satisfy the canonical schema.");
  }

  return parsed.data;
}
