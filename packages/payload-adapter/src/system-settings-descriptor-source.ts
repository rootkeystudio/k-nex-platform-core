import {
  VerifiedHotApplicationSettingsDescriptorService,
  type StagedArtifact,
  type VerifiedSettingsDescriptorArtifactIdentity
} from "@k-nex/extension-bundler";
import {
  SystemSettingsDescriptorSchema,
  canonicalJson,
  type SystemSettingsDescriptor
} from "@k-nex/contracts";
import {
  assertExecutableRegistrationAuthority,
  type ScopedRegistrationResult,
  type SystemSettingsDescriptorRecord,
  type SystemSettingsDescriptorSource
} from "@k-nex/runtime";

import type { RuntimeExtensionPool } from "./runtime-extension-store.js";
import type { VerifiedSettingsDescriptorGenerationIdentity } from "./verified-artifact-store.js";

export interface ExtensionSettingsDescriptorResolution {
  readonly applicationId: string;
  readonly environment: string;
  readonly deliveryClass: "platform-plugin" | "hot-application";
  readonly extensionId: string;
  readonly runtimeGenerationId: string;
}

export interface ExtensionSettingsDescriptorResolver {
  resolve(input: ExtensionSettingsDescriptorResolution): Promise<readonly unknown[]> | readonly unknown[];
}

export interface StaticPlatformPluginSettingsRegistration {
  readonly runtimeGenerationId: string;
  readonly registration: ScopedRegistrationResult;
}

export interface VerifiedHotApplicationSettingsArtifactSource {
  readSettingsDescriptorGeneration(identity: VerifiedSettingsDescriptorGenerationIdentity): Promise<StagedArtifact | undefined>;
}

export interface PostgresSystemSettingsDescriptorSourceOptions {
  readonly platformDescriptors?: readonly unknown[];
  readonly platformPlugins: ExtensionSettingsDescriptorResolver;
  readonly hotApplications: ExtensionSettingsDescriptorResolver;
}

interface GenerationRow {
  delivery_class: string;
  extension_id: string;
  authorization_generation: number | string;
  runtime_generation_ids: unknown;
  state: string;
  disposition: string | null;
  active_generation_id: string | null;
  retained_generation: unknown;
}

interface DocumentIdentityRow {
  descriptor_id: string;
  descriptor_schema_version: number | string;
  owner_delivery_class: string;
  owner_extension_id: string;
  owner_generation: number | string;
}

const runtimeGenerationPattern = /^[a-z][a-z0-9-]{2,127}$/u;

/**
 * Joins lifecycle identity from PostgreSQL with definitions from trusted code
 * or reverified artifact bytes. Database rows never author settings schemas.
 */
export class PostgresSystemSettingsDescriptorSource implements SystemSettingsDescriptorSource {
  private readonly platform: readonly SystemSettingsDescriptor[];

  constructor(private readonly pool: RuntimeExtensionPool, private readonly options: PostgresSystemSettingsDescriptorSourceOptions) {
    this.platform = descriptors(options.platformDescriptors ?? [], "platform");
  }

  async list(applicationId: string, environment: string): Promise<readonly SystemSettingsDescriptorRecord[]> {
    if (!/^[a-z][a-z0-9-]{2,127}$/u.test(applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(environment)) {
      throw new TypeError("Settings descriptor source identity is invalid.");
    }
    const [generationRows, documentRows] = await Promise.all([
      this.pool.query<GenerationRow>(
        `select g.delivery_class, g.extension_id, g.authorization_generation, g.runtime_generation_ids, g.state,
                e.disposition, e.active_generation_id, e.retained_generation
         from k_nex_extension_authorization_generations g
         left join runtime_extensions e
           on e.application_id=g.application_id and e.environment=$2 and e.delivery_class=g.delivery_class and e.extension_id=g.extension_id
         where g.application_id=$1 and g.delivery_class in ('platform-plugin','hot-application')
         order by case when g.state='current' then 0 else 1 end, g.delivery_class, g.extension_id, g.authorization_generation desc`,
        [applicationId, environment]
      ),
      this.pool.query<DocumentIdentityRow>(
        `select descriptor_id, descriptor_schema_version, owner_delivery_class, owner_extension_id, owner_generation
         from k_nex_system_settings_documents
         where application_id=$1 and environment=$2 and owner_kind='extension'`,
        [applicationId, environment]
      )
    ]);

    const result = new Map<string, SystemSettingsDescriptorRecord>();
    for (const descriptor of this.platform) result.set(descriptor.id, record(applicationId, environment, descriptor, { kind: "platform", namespace: "system" }, "active"));
    const documents = documentIdentities(documentRows.rows);

    for (const row of generationRows.rows) {
      const generation = positiveInteger(row.authorization_generation);
      const runtimeGenerationIds = runtimeIds(row.runtime_generation_ids);
      const lifecycle = lifecycleGeneration(row, runtimeGenerationIds);
      if (!lifecycle) continue;
      const owner = Object.freeze({
        kind: "extension" as const,
        deliveryClass: lifecycle.deliveryClass,
        extensionId: lifecycle.extensionId,
        generation
      });
      const resolver = lifecycle.deliveryClass === "platform-plugin" ? this.options.platformPlugins : this.options.hotApplications;
      const found = new Map<string, SystemSettingsDescriptor>();
      for (const runtimeGenerationId of lifecycle.runtimeGenerationIds) {
        const resolved = descriptors(await resolver.resolve({
          applicationId, environment, deliveryClass: lifecycle.deliveryClass,
          extensionId: lifecycle.extensionId, runtimeGenerationId
        }), lifecycle.deliveryClass, lifecycle.extensionId);
        for (const descriptor of resolved) {
          const key = `${descriptor.id}@${descriptor.descriptorSchemaVersion}`;
          const prior = found.get(key);
          if (prior && canonicalJson(prior) !== canonicalJson(descriptor)) throw new Error("Trusted settings descriptors conflict for one generation.");
          found.set(key, descriptor);
        }
      }
      for (const descriptor of found.values()) {
        if (lifecycle.lifecycle === "retired" && !documents.has(documentKey(owner, descriptor))) continue;
        const prior = result.get(descriptor.id);
        if (!prior) {
          result.set(descriptor.id, record(applicationId, environment, descriptor, owner, lifecycle.lifecycle));
        } else if (!sameExtensionLineage(prior.identity.owner, owner)) {
          throw new Error("Trusted settings descriptor ID is ambiguous across owners.");
        }
      }
    }
    return Object.freeze([...result.values()].sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id)));
  }
}

function sameExtensionLineage(
  left: SystemSettingsDescriptorRecord["identity"]["owner"],
  right: SystemSettingsDescriptorRecord["identity"]["owner"]
): boolean {
  return left.kind === "extension" && right.kind === "extension" &&
    left.deliveryClass === right.deliveryClass && left.extensionId === right.extensionId;
}

/** Resolves Platform Plugin descriptors only from an immutable trusted registration map. */
export function createStaticPlatformPluginSettingsDescriptorResolver(
  registrations: readonly StaticPlatformPluginSettingsRegistration[]
): ExtensionSettingsDescriptorResolver {
  const byGeneration = new Map<string, ScopedRegistrationResult>();
  for (const entry of registrations) {
    if (!runtimeGenerationPattern.test(entry.runtimeGenerationId) || byGeneration.has(entry.runtimeGenerationId)) {
      throw new TypeError("Static settings registrations are invalid.");
    }
    assertExecutableRegistrationAuthority(entry.registration);
    byGeneration.set(entry.runtimeGenerationId, entry.registration);
  }
  return Object.freeze({
    resolve(input: ExtensionSettingsDescriptorResolution): readonly SystemSettingsDescriptor[] {
      if (input.deliveryClass !== "platform-plugin") throw new TypeError("Static settings resolution requires a Platform Plugin.");
      const registration = byGeneration.get(input.runtimeGenerationId);
      if (!registration || !registration.inventory.some(({ id }) => id === input.extensionId)) {
        throw new Error("Trusted Platform Plugin settings generation is unavailable.");
      }
      return descriptors(
        registration.contributions.settings.filter(({ pluginId }) => pluginId === input.extensionId).map(({ value }) => value),
        "platform-plugin",
        input.extensionId
      );
    }
  });
}

/** Reads Hot Application definitions only from reverified immutable generation bytes. */
export function createVerifiedHotApplicationSettingsDescriptorResolver(
  artifacts: VerifiedHotApplicationSettingsArtifactSource
): ExtensionSettingsDescriptorResolver {
  return Object.freeze({
    async resolve(input: ExtensionSettingsDescriptorResolution): Promise<readonly SystemSettingsDescriptor[]> {
      if (input.deliveryClass !== "hot-application") throw new TypeError("Verified settings resolution requires a Hot Application.");
      const staged = await artifacts.readSettingsDescriptorGeneration({
        applicationId: input.applicationId,
        environment: input.environment,
        extensionId: input.extensionId,
        generationId: input.runtimeGenerationId
      });
      if (!staged) throw new Error("Verified Hot Application settings generation is unavailable.");
      const identity: VerifiedSettingsDescriptorArtifactIdentity = {
        applicationId: input.applicationId,
        environment: input.environment,
        appId: input.extensionId,
        generationId: input.runtimeGenerationId,
        artifactDigest: staged.artifactDigest
      };
      return new VerifiedHotApplicationSettingsDescriptorService({
        readSettingsDescriptors: async (requested) => canonicalJson(requested) === canonicalJson(identity) ? staged : undefined
      }).read(identity);
    }
  });
}

function descriptors(values: readonly unknown[], kind: "platform" | "platform-plugin" | "hot-application", extensionId?: string): readonly SystemSettingsDescriptor[] {
  const result = values.map((value) => {
    const parsed = SystemSettingsDescriptorSchema.safeParse(value);
    const publisher = parsed.success ? parsed.data.publisher : undefined;
    const matches = kind === "platform"
      ? publisher?.kind === "platform" && publisher.namespace === "system"
      : publisher?.kind === "extension" && publisher.deliveryClass === kind && publisher.extensionId === extensionId;
    if (!parsed.success || !matches) throw new TypeError("Trusted settings descriptor identity is invalid.");
    return Object.freeze(structuredClone(parsed.data));
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (result.some(({ id }, index) => index > 0 && result[index - 1]!.id === id)) throw new TypeError("Trusted settings descriptor IDs are not unique.");
  return Object.freeze(result);
}

function lifecycleGeneration(row: GenerationRow, runtimeGenerationIds: readonly string[]): Readonly<{
  deliveryClass: "platform-plugin" | "hot-application";
  extensionId: string;
  lifecycle: "active" | "disabled" | "retired";
  runtimeGenerationIds: readonly string[];
}> | undefined {
  if ((row.delivery_class !== "platform-plugin" && row.delivery_class !== "hot-application") ||
    !/^(?:module|provider|builder|integration|preset|app)(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(row.extension_id)) {
    throw new Error("Persisted settings generation identity is invalid.");
  }
  if (row.state === "retired") return Object.freeze({
    deliveryClass: row.delivery_class, extensionId: row.extension_id, lifecycle: "retired", runtimeGenerationIds
  });
  if (row.state !== "current") throw new Error("Persisted settings generation state is invalid.");
  if (row.disposition === "active" && row.active_generation_id && runtimeGenerationIds.includes(row.active_generation_id)) {
    return Object.freeze({
      deliveryClass: row.delivery_class, extensionId: row.extension_id, lifecycle: "active",
      runtimeGenerationIds: Object.freeze([row.active_generation_id])
    });
  }
  const retained = retainedGenerationId(row.retained_generation);
  if (row.disposition === "disabled" && retained && runtimeGenerationIds.includes(retained)) {
    return Object.freeze({
      deliveryClass: row.delivery_class, extensionId: row.extension_id, lifecycle: "disabled",
      runtimeGenerationIds: Object.freeze([retained])
    });
  }
  throw new Error("Current settings generation does not match runtime lifecycle state.");
}

function runtimeIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !runtimeGenerationPattern.test(id)) || new Set(value).size !== value.length) {
    throw new Error("Persisted settings runtime generation IDs are invalid.");
  }
  return Object.freeze([...value].sort());
}

function retainedGenerationId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const generationId = (value as Record<string, unknown>).generationId;
  return typeof generationId === "string" && runtimeGenerationPattern.test(generationId) ? generationId : undefined;
}

function documentIdentities(rows: readonly DocumentIdentityRow[]): ReadonlySet<string> {
  const result = new Set<string>();
  for (const row of rows) {
    if ((row.owner_delivery_class !== "platform-plugin" && row.owner_delivery_class !== "hot-application") || typeof row.owner_extension_id !== "string") {
      throw new Error("Persisted settings document identity is invalid.");
    }
    result.add(`${row.owner_delivery_class}:${row.owner_extension_id}:${positiveInteger(row.owner_generation)}:${row.descriptor_id}@${positiveInteger(row.descriptor_schema_version)}`);
  }
  return result;
}

function documentKey(
  owner: Readonly<{ deliveryClass: string; extensionId: string; generation: number }>,
  descriptor: SystemSettingsDescriptor
): string {
  return `${owner.deliveryClass}:${owner.extensionId}:${owner.generation}:${descriptor.id}@${descriptor.descriptorSchemaVersion}`;
}

function record(
  applicationId: string,
  environment: string,
  descriptor: SystemSettingsDescriptor,
  owner: SystemSettingsDescriptorRecord["identity"]["owner"],
  lifecycle: SystemSettingsDescriptorRecord["lifecycle"]
): SystemSettingsDescriptorRecord {
  return Object.freeze({
    descriptor,
    identity: Object.freeze({ applicationId, environment, descriptorId: descriptor.id, owner, descriptorSchemaVersion: descriptor.descriptorSchemaVersion }),
    lifecycle
  });
}

function positiveInteger(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Persisted settings generation revision is invalid.");
  return parsed;
}
