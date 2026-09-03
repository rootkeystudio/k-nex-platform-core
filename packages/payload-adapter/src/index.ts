import { postgresAdapter } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";
import { assertExecutableRegistrationAuthority, platformPluginEnabledInRegistration, type ScopedRegistrationResult } from "@k-nex/runtime";
import type { CollectionConfig, Config } from "payload";

export * from "./data-source-authenticator.js";
export * from "./persistence-capability.js";
export * from "./mcp-adapter.js";
export * from "./outbox-processor.js";
export * from "./outbox-realtime-relay.js";
export * from "./transactional-outbox.js";
export * from "./runtime-extension-store.js";
export * from "./runtime-extension-outbox.js";
export * from "./theme-profile-store.js";
export * from "./system-operations-store.js";
export * from "./static-deployment-store.js";
export * from "./static-release-authority.js";
export * from "./app-storage.js";
export * from "./verified-artifact-store.js";
export * from "./catalog-checkpoint-store.js";
export * from "./catalog-mirror-store.js";
export * from "./accepted-extension-catalog-source.js";
export * from "./catalog-refresh-coordinator.js";
export * from "./extension-capability-authority.js";
export * from "./active-extension-security-reconciler.js";
export * from "./runner-quarantine-adapter.js";
export * from "./authorization-store.js";
export * from "./authorization-schema-migration.js";
export * from "./authorization-lifecycle-projector.js";
export * from "./authorization-outbox.js";
export * from "./platform-plugin-authorization-descriptors.js";
export * from "./system-settings-store.js";
export * from "./system-settings-outbox.js";
export * from "./system-settings-descriptor-source.js";
export * from "./settings-validation-coordinator.js";

export type PayloadCompositionErrorCode =
  | "INVALID_DATABASE_URL"
  | "INVALID_SCHEMA_CONTRIBUTION"
  | "DUPLICATE_COLLECTION_SLUG"
  | "ROUTE_COLLISION"
  | "INDEX_COLLISION";

export class PayloadCompositionError extends Error {
  readonly code: PayloadCompositionErrorCode;
  readonly path: readonly string[];

  constructor(code: PayloadCompositionErrorCode, message: string, path: readonly string[] = []) {
    super(message);
    this.name = "PayloadCompositionError";
    this.code = code;
    this.path = Object.freeze([...path]);
  }
}

export interface CollectionOwnership {
  readonly slug: string;
  readonly pluginId: string;
  readonly contributionId: string;
}

export interface ComposedPayloadApplication {
  readonly config: Config;
  readonly collectionOwnership: readonly CollectionOwnership[];
}

export interface ComposePayloadApplicationOptions {
  readonly baseConfig: Omit<Config, "collections" | "db">;
  readonly baseCollections?: readonly CollectionConfig[];
  readonly databaseUrl: string;
  readonly migrations?: readonly CustomerPayloadMigration[];
  readonly registration: ScopedRegistrationResult;
}

export interface CustomerPayloadMigration {
  readonly name: string;
  readonly up: (args: MigrateUpArgs) => Promise<void>;
  readonly down: (args: MigrateDownArgs) => Promise<void>;
}

type OwnedCollectionValue = Readonly<{
  readonly type: "payload.collection";
  readonly collection: CollectionConfig;
}>;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: PayloadCompositionErrorCode, message: string, path: readonly string[] = []): never {
  throw new PayloadCompositionError(code, message, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownedCollection(value: unknown): OwnedCollectionValue | undefined {
  if (!isRecord(value) || value.type !== "payload.collection" || !isRecord(value.collection)) return undefined;
  const collection = value.collection as Partial<CollectionConfig>;
  if (typeof collection.slug !== "string" || !Array.isArray(collection.fields)) return undefined;
  return value as unknown as OwnedCollectionValue;
}

function collectionForAvailability(collection: CollectionConfig, enabled: boolean): CollectionConfig {
  if (enabled) return collection;
  return {
    ...collection,
    access: {
      ...collection.access,
      create: () => false,
      delete: () => false,
      update: () => false
    }
  };
}

function normalizedRoute(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}

function validateCollection(collection: CollectionConfig): void {
  const routes = new Set<string>();
  for (const endpoint of collection.endpoints === false ? [] : collection.endpoints ?? []) {
    const key = `${endpoint.method}:${normalizedRoute(endpoint.path)}`;
    if (routes.has(key)) fail("ROUTE_COLLISION", `Collection ${collection.slug} declares route ${key} more than once.`, [collection.slug, key]);
    routes.add(key);
  }

  const indexes = new Set<string>();
  for (const index of collection.indexes ?? []) {
    const key = index.fields.join("\u0000");
    if (new Set(index.fields).size !== index.fields.length || indexes.has(key)) {
      fail("INDEX_COLLISION", `Collection ${collection.slug} declares a duplicate index.`, [collection.slug, ...index.fields]);
    }
    indexes.add(key);
  }
}

function validateApplicationRoutes(config: Omit<Config, "collections" | "db">, collections: readonly CollectionConfig[]): void {
  const routes = new Set<string>();
  const add = (method: string, path: string): void => {
    const key = `${method}:${normalizedRoute(path)}`;
    if (routes.has(key)) fail("ROUTE_COLLISION", `Payload route ${key} is declared more than once.`, [key]);
    routes.add(key);
  };
  for (const endpoint of config.endpoints ?? []) add(endpoint.method, endpoint.path);
  for (const collection of collections) {
    for (const endpoint of collection.endpoints === false ? [] : collection.endpoints ?? []) {
      add(endpoint.method, `/${collection.slug}${normalizedRoute(endpoint.path)}`);
    }
  }
}

export function composePayloadApplication(options: ComposePayloadApplicationOptions): ComposedPayloadApplication {
  assertExecutableRegistrationAuthority(options.registration);
  if (typeof options.databaseUrl !== "string" || options.databaseUrl.trim().length === 0) {
    fail("INVALID_DATABASE_URL", "A non-empty Postgres connection string is required.");
  }

  const collections: CollectionConfig[] = [...(options.baseCollections ?? [])];
  const ownership: CollectionOwnership[] = [];
  for (const contribution of options.registration.contributions.schema) {
    const value = ownedCollection(contribution.value);
    if (!value) {
      fail(
        "INVALID_SCHEMA_CONTRIBUTION",
        `Schema contribution ${contribution.id} is not an owned Payload collection.`,
        [contribution.pluginId, contribution.id]
      );
    }
    collections.push(collectionForAvailability(value.collection, platformPluginEnabledInRegistration(options.registration, contribution.pluginId)));
    ownership.push({
      slug: value.collection.slug,
      pluginId: contribution.pluginId,
      contributionId: contribution.id
    });
  }

  const slugs = new Set<string>();
  for (const collection of collections) {
    if (slugs.has(collection.slug)) {
      fail("DUPLICATE_COLLECTION_SLUG", `Payload collection slug ${collection.slug} is declared more than once.`, [collection.slug]);
    }
    slugs.add(collection.slug);
    validateCollection(collection);
  }
  validateApplicationRoutes(options.baseConfig, collections);

  const config: Config = {
    ...options.baseConfig,
    db: postgresAdapter({
      pool: { connectionString: options.databaseUrl },
      prodMigrations: [...(options.migrations ?? [])],
      push: false
    }),
    collections
  };

  return Object.freeze({
    config,
    collectionOwnership: Object.freeze([...ownership].sort((left, right) => compare(left.slug, right.slug)).map((entry) => Object.freeze(entry)))
  });
}
