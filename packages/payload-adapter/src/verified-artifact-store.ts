import { canonicalJson } from "@k-nex/contracts";
import {
  ArtifactVerifier,
  sha256,
  type Digest,
  type StagedArtifact,
  type VerificationRequest,
  type VerifiedArtifact,
  type VerifiedArtifactGenerationOwner,
  type VerifiedArtifactRunnerSource,
  type VerifiedRemoteUiArtifactReader,
  type VerifiedThemeSkinArtifactReader
} from "@k-nex/extension-bundler";
import type {
  DurableDynamicArtifact,
  DurableDynamicArtifactStore,
  ExtensionRollbackCompatibility,
  ExtensionActivationJson,
  VerifiedGenerationAuthority,
  VerifiedGenerationAuthorityOwner
} from "@k-nex/runtime";

import type {
  AuthorizationLifecycleCommittedTransition,
  AuthorizationLifecycleDescriptorResolver
} from "./authorization-lifecycle-projector.js";
import { runtimeExtensionIdentityKey, type RuntimeExtensionPool, type RuntimeExtensionSession } from "./runtime-extension-store.js";

export class VerifiedArtifactStoreError extends Error {
  constructor(readonly code: "ARTIFACT_INVALID" | "ARTIFACT_CONFLICT" | "ARTIFACT_UNAVAILABLE", message: string) {
    super(message);
    this.name = "VerifiedArtifactStoreError";
  }
}

export interface VerifiedDynamicArtifactStage {
  readonly owner: VerifiedArtifactGenerationOwner;
  readonly verification: VerificationRequest;
  readonly authority: VerifiedGenerationAuthority;
  readonly activation: Readonly<{
    compatibility: ExtensionRollbackCompatibility;
    metadata: Readonly<Record<string, ExtensionActivationJson>>;
    settings: Readonly<Record<string, ExtensionActivationJson>>;
    storageSchemaVersions: Readonly<Record<string, number>>;
  }>;
}

interface ArtifactRow {
  artifact_digest: Digest;
  artifact_bytes: Buffer;
}

interface AcceptanceRow {
  artifact_digest: Digest;
  catalog_digest: Digest;
  catalog_json: unknown;
  provenance_bytes: Buffer;
  delivery_class: "hot-application" | "theme-skin";
  extension_id: string;
  version: string;
  runtime_abi: string;
}

interface BindingRow {
  application_id: string;
  environment: string;
  delivery_class: "hot-application" | "theme-skin";
  extension_id: string;
  generation_id: string;
  artifact_digest: Digest;
  catalog_digest: Digest;
  authority_json: VerifiedGenerationAuthority;
  activation_json: VerifiedDynamicArtifactStage["activation"];
  version: string;
}

interface ActiveRemoteUiRow extends BindingRow {}

function fail(code: VerifiedArtifactStoreError["code"], message: string): never {
  throw new VerifiedArtifactStoreError(code, message);
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertAuthority(stage: VerifiedDynamicArtifactStage, verified: VerifiedArtifact): void {
  const { authority, owner, verification } = stage;
  const expectedCatalogDigest = sha256(Buffer.from(canonicalJson(verification.catalog)));
  if ((verified.manifest.deliveryClass !== "hot-application" && verified.manifest.deliveryClass !== "theme-skin") ||
    owner.deliveryClass !== verified.manifest.deliveryClass || verification.deliveryClass !== verified.manifest.deliveryClass ||
    authority.applicationId !== owner.applicationId || authority.environment !== owner.environment || authority.deliveryClass !== owner.deliveryClass ||
    authority.extensionId !== owner.extensionId || authority.generationId !== owner.generationId || authority.artifactDigest !== verified.artifactDigest ||
    authority.extensionId !== verified.manifest.id || authority.manifestDigest !== verified.entry.manifestDigest || authority.catalogDigest !== expectedCatalogDigest ||
    authority.provenanceDigest !== verified.entry.provenanceDigest || authority.sbomDigest !== verified.entry.sbomDigest ||
    authority.sourceCommit !== verified.entry.source.commit || stage.activation === null) {
    fail("ARTIFACT_INVALID", "Verified artifact authority does not bind the immutable dynamic release.");
  }
}

type PriorHotGenerationEvidence = Readonly<{
  applicationId: string;
  environment: string;
  deliveryClass: "hot-application";
  extensionId: string;
  generationId: string;
  sourceCommit: string;
  artifactDigest: string;
  manifestDigest: string;
  catalogDigest: string;
  provenanceDigest: string;
  sbomDigest: string;
}>;

function priorHotGenerationEvidence(value: unknown, transition: AuthorizationLifecycleCommittedTransition): PriorHotGenerationEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("ARTIFACT_INVALID", "Incompatible update has no prior Hot Application generation evidence.");
  }
  const record = value as Record<string, unknown>;
  const keys = ["applicationId", "environment", "deliveryClass", "extensionId", "generationId", "sourceCommit", "artifactDigest", "manifestDigest", "catalogDigest", "provenanceDigest", "sbomDigest"] as const;
  if (record.authority !== "verified-bundle" || keys.some((key) => typeof record[key] !== "string") ||
    record.applicationId !== transition.applicationId || record.environment !== transition.environment ||
    record.deliveryClass !== "hot-application" || record.extensionId !== transition.id ||
    !/^sha256:[0-9a-f]{64}$/u.test(record.artifactDigest as string) || !/^sha256:[0-9a-f]{64}$/u.test(record.manifestDigest as string) ||
    !/^sha256:[0-9a-f]{64}$/u.test(record.catalogDigest as string) || !/^sha256:[0-9a-f]{64}$/u.test(record.provenanceDigest as string) ||
    !/^sha256:[0-9a-f]{64}$/u.test(record.sbomDigest as string)) {
    fail("ARTIFACT_INVALID", "Prior Hot Application evidence does not bind this immutable extension generation.");
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, record[key]])) as PriorHotGenerationEvidence);
}

/**
 * PostgreSQL-backed content-addressed artifact inventory. It deliberately
 * stores original bytes and re-runs verification when bytes are read so a
 * restored database cannot silently turn an inventory row into executable UI
 * or runner source.
 */
export class PostgresVerifiedArtifactStore implements DurableDynamicArtifactStore, VerifiedRemoteUiArtifactReader, VerifiedThemeSkinArtifactReader {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly verifier: ArtifactVerifier) {}

  /** Resolves authorization descriptors only from the immutable generation named by a committed Hot Application transition. */
  async resolveAuthorizationLifecycleDescriptors(
    session: Pick<RuntimeExtensionSession, "query">,
    transition: AuthorizationLifecycleCommittedTransition,
    priorGenerationEvidence?: unknown
  ): ReturnType<AuthorizationLifecycleDescriptorResolver> {
    if (transition.deliveryClass !== "hot-application") {
      fail("ARTIFACT_UNAVAILABLE", "Authorization descriptors are unavailable for this delivery class.");
    }
    const securityQuarantine = transition.eventType === "extension.security-quarantine";
    const evidence = priorGenerationEvidence === undefined
      ? transition.evidence
      : priorHotGenerationEvidence(priorGenerationEvidence, transition);
    const binding = await this.binding(session, {
      applicationId: transition.applicationId,
      environment: transition.environment,
      deliveryClass: "hot-application",
      extensionId: transition.id,
      generationId: evidence.generationId
    }, evidence.artifactDigest, securityQuarantine && priorGenerationEvidence === undefined ? undefined : evidence.catalogDigest);
    if (!binding) fail("ARTIFACT_UNAVAILABLE", "Hot Application generation is not bound to the transition artifact.");
    const verified = await this.verified(session, binding.artifact_digest, binding.catalog_digest);
    if (!verified || verified.manifest.deliveryClass !== "hot-application" || !verified.hotApplicationManifest) {
      fail("ARTIFACT_UNAVAILABLE", "Hot Application authorization manifest is unavailable.");
    }
    const durable = await this.durable(binding, verified, binding.catalog_digest);
    const expectedAuthority = {
      applicationId: transition.applicationId,
      environment: transition.environment,
      deliveryClass: transition.deliveryClass,
      extensionId: transition.id,
      generationId: evidence.generationId,
      sourceCommit: evidence.sourceCommit,
      artifactDigest: evidence.artifactDigest,
      manifestDigest: evidence.manifestDigest,
      catalogDigest: securityQuarantine && priorGenerationEvidence === undefined ? binding.catalog_digest : evidence.catalogDigest,
      provenanceDigest: evidence.provenanceDigest,
      sbomDigest: evidence.sbomDigest
    };
    if (!same(durable.authority, expectedAuthority) ||
      transition.eventType === "extension.security-quarantine" && binding.version !== transition.evidence.version) {
      fail("ARTIFACT_INVALID", "Hot Application generation authority does not exactly match lifecycle evidence.");
    }
    return Object.freeze(verified.hotApplicationManifest.permissions
      .map((permission) => structuredClone(permission))
      .sort((left, right) => left.id.localeCompare(right.id)));
  }

  async stage(input: VerifiedDynamicArtifactStage): Promise<DurableDynamicArtifact> {
    const verified = await this.verifier.verify(input.verification);
    assertAuthority(input, verified);
    const manifest = verified.manifest;
    if (manifest.deliveryClass !== input.owner.deliveryClass) fail("ARTIFACT_INVALID", "Verified artifact delivery class is not dynamic.");
    const artifact = Buffer.from(input.verification.artifact);
    const provenance = Buffer.from(input.verification.provenance);
    const catalogDigest = input.authority.catalogDigest as Digest;
    return this.transaction(async (session) => {
      await session.query(
        `insert into runtime_extension_artifacts (artifact_digest, artifact_bytes)
         values ($1,$2) on conflict (artifact_digest) do nothing`,
        [verified.artifactDigest, artifact]
      );
      await session.query(
        `insert into runtime_extension_artifact_acceptances
          (artifact_digest, catalog_digest, catalog_json, provenance_bytes, delivery_class, extension_id, version, runtime_abi)
         values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8) on conflict (artifact_digest, catalog_digest) do nothing`,
        [verified.artifactDigest, catalogDigest, canonicalJson(input.verification.catalog), provenance, manifest.deliveryClass, manifest.id, manifest.version, manifest.runtimeAbi]
      );
      const storedArtifact = await this.artifact(session, verified.artifactDigest);
      const accepted = await this.acceptance(session, verified.artifactDigest, catalogDigest);
      if (!storedArtifact || !accepted || storedArtifact.artifact_digest !== verified.artifactDigest || !storedArtifact.artifact_bytes.equals(artifact) ||
        accepted.artifact_digest !== verified.artifactDigest || accepted.catalog_digest !== catalogDigest ||
        !same(accepted.catalog_json, input.verification.catalog) || !accepted.provenance_bytes.equals(provenance) ||
        accepted.delivery_class !== manifest.deliveryClass || accepted.extension_id !== manifest.id ||
        accepted.version !== manifest.version || accepted.runtime_abi !== manifest.runtimeAbi) {
        fail("ARTIFACT_CONFLICT", "Immutable artifact acceptance is already bound to different verified content.");
      }
      const reverified = await this.verified(session, verified.artifactDigest, catalogDigest);
      if (!reverified) fail("ARTIFACT_UNAVAILABLE", "Verified artifact bytes are unavailable.");
      await session.query(
        `insert into runtime_extension_artifact_bindings
          (application_id, environment, delivery_class, extension_id, generation_id, artifact_digest, catalog_digest, authority_json, activation_json, version)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10) on conflict do nothing`,
        [input.owner.applicationId, input.owner.environment, input.owner.deliveryClass, input.owner.extensionId, input.owner.generationId, verified.artifactDigest, catalogDigest,
          canonicalJson(input.authority), canonicalJson(input.activation), manifest.version]
      );
      const stored = await this.binding(session, input.owner, verified.artifactDigest, catalogDigest);
      if (!stored || stored.application_id !== input.owner.applicationId || stored.environment !== input.owner.environment ||
        stored.delivery_class !== input.owner.deliveryClass || stored.extension_id !== input.owner.extensionId ||
        stored.generation_id !== input.owner.generationId || stored.artifact_digest !== verified.artifactDigest ||
        stored.catalog_digest !== catalogDigest || !same(stored.authority_json, input.authority) ||
        !same(stored.activation_json, input.activation) || stored.version !== manifest.version) {
        fail("ARTIFACT_CONFLICT", "Immutable dynamic generation is already bound to different verified content.");
      }
      return this.durable(stored, reverified, catalogDigest);
    });
  }

  async resolve(input: Readonly<{ owner: VerifiedGenerationAuthorityOwner; generationId: string; artifactDigest: string }>): Promise<DurableDynamicArtifact | undefined> {
    const binding = await this.binding(this.pool, { ...input.owner, generationId: input.generationId }, input.artifactDigest as Digest);
    if (!binding) return undefined;
    const verified = await this.verified(this.pool, binding.artifact_digest, binding.catalog_digest);
    return verified ? this.durable(binding, verified, binding.catalog_digest) : undefined;
  }

  async read(artifactDigest: Digest, catalogDigest: Digest): Promise<StagedArtifact | undefined> {
    const verified = await this.verified(this.pool, artifactDigest, catalogDigest, true);
    return verified ? Object.freeze({ artifactDigest, catalogDigest, verified }) : undefined;
  }

  async readRemoteUi(identity: Readonly<{
    applicationId: string;
    environment: string;
    extensionId: string;
    generationId: string;
    artifactDigest: Digest;
  }>): Promise<StagedArtifact | undefined> {
    return this.transaction(async (session) => {
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [runtimeExtensionIdentityKey({
        applicationId: identity.applicationId, environment: identity.environment, deliveryClass: "hot-application", extensionId: identity.extensionId
      })]);
      const binding = await this.activeRemoteUiBinding(session, identity);
      if (!binding) return undefined;
      const verified = await this.verified(session, binding.artifact_digest, binding.catalog_digest);
      if (!verified) return undefined;
      await this.durable(binding, verified, binding.catalog_digest);
      return Object.freeze({ artifactDigest: binding.artifact_digest, catalogDigest: binding.catalog_digest, verified });
    });
  }

  async readThemeSkin(identity: Readonly<{
    applicationId: string;
    environment: string;
    skinId: string;
    generationId: string;
    artifactDigest: Digest;
  }>): Promise<StagedArtifact | undefined> {
    const binding = await this.binding(this.pool, {
      applicationId: identity.applicationId,
      environment: identity.environment,
      deliveryClass: "theme-skin",
      extensionId: identity.skinId,
      generationId: identity.generationId
    }, identity.artifactDigest);
    if (!binding) return undefined;
    const verified = await this.verified(this.pool, binding.artifact_digest, binding.catalog_digest, true);
    if (!verified) return undefined;
    await this.durable(binding, verified, binding.catalog_digest);
    return Object.freeze({ artifactDigest: binding.artifact_digest, catalogDigest: binding.catalog_digest, verified });
  }

  async loadThemeSkin(authority: VerifiedGenerationAuthority): Promise<Readonly<{
    authority: VerifiedGenerationAuthority;
    bundleManifest: unknown;
    files: ReadonlyMap<string, Uint8Array>;
  }>> {
    if (authority.deliveryClass !== "theme-skin") fail("ARTIFACT_UNAVAILABLE", "Theme Skin source is unavailable for this delivery class.");
    const binding = await this.binding(this.pool, authority, authority.artifactDigest as Digest, authority.catalogDigest as Digest);
    if (!binding) fail("ARTIFACT_UNAVAILABLE", "Theme Skin generation is not bound to the verified artifact.");
    const verified = await this.verified(this.pool, authority.artifactDigest as Digest, authority.catalogDigest as Digest);
    if (!verified || verified.manifest.deliveryClass !== "theme-skin" || verified.manifest.id !== authority.extensionId) {
      fail("ARTIFACT_UNAVAILABLE", "Theme Skin artifact identity does not match its generation.");
    }
    const durable = await this.durable(binding, verified, binding.catalog_digest);
    if (!same(durable.authority, authority)) fail("ARTIFACT_INVALID", "Theme Skin generation authority no longer matches its durable binding.");
    return Object.freeze({
      authority: durable.authority,
      bundleManifest: structuredClone(verified.manifest),
      files: new Map([...verified.files].map(([path, bytes]) => [path, new Uint8Array(bytes)]))
    });
  }

  runnerSource(): VerifiedArtifactRunnerSource {
    return {
      load: async ({ owner, artifactDigest, serverEntrypoint }) => {
        if (owner.deliveryClass !== "hot-application") fail("ARTIFACT_UNAVAILABLE", "Runner source is unavailable for this delivery class.");
        const binding = await this.binding(this.pool, owner, artifactDigest);
        if (!binding) fail("ARTIFACT_UNAVAILABLE", "Runner generation is not bound to the verified artifact.");
        const verified = await this.verified(this.pool, binding.artifact_digest, binding.catalog_digest);
        if (!verified) fail("ARTIFACT_UNAVAILABLE", "Verified artifact bytes are unavailable.");
        await this.durable(binding, verified, binding.catalog_digest);
        if (verified.manifest.deliveryClass !== "hot-application" || verified.manifest.id !== owner.extensionId || !verified.manifest.entrypoints.server.includes(serverEntrypoint)) {
          fail("ARTIFACT_UNAVAILABLE", "Runner entrypoint is not declared by the verified Hot Application manifest.");
        }
        const body = verified.files.get(serverEntrypoint);
        const metadata = verified.manifest.files[serverEntrypoint];
        if (!body || !metadata || metadata.contentType !== "application/javascript" || sha256(body) !== metadata.digest || body.byteLength !== metadata.bytes) {
          fail("ARTIFACT_INVALID", "Runner entrypoint bytes no longer match the verified inventory.");
        }
        return Object.freeze({ source: body.toString("utf8") });
      }
    };
  }

  private async durable(binding: BindingRow, verified: VerifiedArtifact, catalogDigest: Digest): Promise<DurableDynamicArtifact> {
    const authority = binding.authority_json;
    if (authority.artifactDigest !== binding.artifact_digest || authority.extensionId !== binding.extension_id || authority.generationId !== binding.generation_id ||
      authority.deliveryClass !== binding.delivery_class || authority.manifestDigest !== verified.entry.manifestDigest || authority.provenanceDigest !== verified.entry.provenanceDigest ||
      authority.sbomDigest !== verified.entry.sbomDigest || authority.catalogDigest !== catalogDigest || authority.sourceCommit !== verified.entry.source.commit ||
      authority.applicationId !== binding.application_id || authority.environment !== binding.environment || verified.manifest.deliveryClass !== binding.delivery_class ||
      verified.manifest.id !== binding.extension_id || verified.manifest.version !== binding.version) {
      fail("ARTIFACT_INVALID", "Stored dynamic binding no longer matches its reverified artifact bytes.");
    }
    if (verified.manifest.deliveryClass === "hot-application" && !verified.hotApplicationManifest) {
      fail("ARTIFACT_INVALID", "Reverified Hot Application artifact has no complete signed manifest.");
    }
    return Object.freeze({
      ...binding.activation_json,
      authority: Object.freeze(authority),
      version: binding.version,
      resourceBudget: Object.freeze({ ...verified.manifest.resourceBudget }),
      ...(verified.manifest.deliveryClass === "hot-application" ? {
        capabilities: Object.freeze(structuredClone(verified.manifest.capabilities)),
        hotApplicationManifest: structuredClone(verified.hotApplicationManifest!)
      } : {})
    });
  }

  private async verified(session: Pick<RuntimeExtensionSession, "query">, artifactDigest: Digest, catalogDigest: Digest, absentOk = false): Promise<VerifiedArtifact | undefined> {
    const artifact = await this.artifact(session, artifactDigest);
    const acceptance = await this.acceptance(session, artifactDigest, catalogDigest);
    if (!artifact || !acceptance) {
      if (absentOk) return undefined;
      fail("ARTIFACT_UNAVAILABLE", "Verified artifact bytes are unavailable.");
    }
    return this.verifiedRow({ ...artifact, ...acceptance });
  }

  private async verifiedRow(row: ArtifactRow & AcceptanceRow): Promise<VerifiedArtifact> {
    try {
      if (sha256(Buffer.from(canonicalJson(row.catalog_json))) !== row.catalog_digest) {
        fail("ARTIFACT_INVALID", "Persisted catalog evidence no longer matches its catalog digest.");
      }
      const verified = await this.verifier.verifyAccepted({ catalog: row.catalog_json as VerificationRequest["catalog"], artifact: row.artifact_bytes, provenance: row.provenance_bytes,
        deliveryClass: row.delivery_class, id: row.extension_id, version: row.version, runtimeAbi: row.runtime_abi });
      if (verified.artifactDigest !== row.artifact_digest) fail("ARTIFACT_INVALID", "Artifact bytes no longer match their content address.");
      return verified;
    } catch (error) {
      if (error instanceof VerifiedArtifactStoreError) throw error;
      fail("ARTIFACT_INVALID", "Persisted artifact bytes fail release verification.");
    }
  }

  private async artifact(session: Pick<RuntimeExtensionSession, "query">, artifactDigest: Digest): Promise<ArtifactRow | undefined> {
    const result = await session.query<ArtifactRow>(
      "select artifact_digest, artifact_bytes from runtime_extension_artifacts where artifact_digest=$1",
      [artifactDigest]
    );
    return result.rows[0];
  }

  private async acceptance(session: Pick<RuntimeExtensionSession, "query">, artifactDigest: Digest, catalogDigest: Digest): Promise<AcceptanceRow | undefined> {
    const result = await session.query<AcceptanceRow>(
      `select artifact_digest, catalog_digest, catalog_json, provenance_bytes, delivery_class, extension_id, version, runtime_abi
       from runtime_extension_artifact_acceptances where artifact_digest=$1 and catalog_digest=$2`,
      [artifactDigest, catalogDigest]
    );
    return result.rows[0];
  }

  private async binding(session: Pick<RuntimeExtensionSession, "query">, owner: VerifiedArtifactGenerationOwner, artifactDigest: Digest, catalogDigest?: Digest): Promise<BindingRow | undefined> {
    const result = await session.query<BindingRow>(
      `select application_id, environment, delivery_class, extension_id, generation_id, artifact_digest, catalog_digest, authority_json, activation_json, version
       from runtime_extension_artifact_bindings
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 and artifact_digest=$6${catalogDigest ? " and catalog_digest=$7" : ""}`,
      catalogDigest ? [owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId, owner.generationId, artifactDigest, catalogDigest] :
        [owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId, owner.generationId, artifactDigest]
    );
    return result.rows[0];
  }

  /**
   * This is the Remote UI read linearization point. The serving path accepts
   * bytes only when the immutable artifact binding, canonical active evidence,
   * activation receipt, and unified server/UI/storage generation are all the
   * same durable row.
   */
  private async activeRemoteUiBinding(session: Pick<RuntimeExtensionSession, "query">, identity: Readonly<{
    applicationId: string;
    environment: string;
    extensionId: string;
    generationId: string;
    artifactDigest: Digest;
  }>): Promise<ActiveRemoteUiRow | undefined> {
    const result = await session.query<ActiveRemoteUiRow>(
      `select b.application_id as application_id, b.environment as environment, b.delivery_class as delivery_class,
              b.extension_id as extension_id, b.generation_id as generation_id, b.artifact_digest as artifact_digest, b.catalog_digest as catalog_digest,
              b.authority_json as authority_json, b.activation_json as activation_json, b.version as version
       from runtime_extension_artifact_bindings b
       join runtime_extension_artifacts a on a.artifact_digest=b.artifact_digest
       join runtime_extension_artifact_acceptances c on c.artifact_digest=b.artifact_digest and c.catalog_digest=b.catalog_digest
       join runtime_extensions e
         on e.application_id=b.application_id and e.environment=b.environment and e.delivery_class=b.delivery_class and e.extension_id=b.extension_id
       join runtime_extension_generations g
         on g.application_id=b.application_id and g.environment=b.environment and g.delivery_class=b.delivery_class
        and g.extension_id=b.extension_id and g.generation_id=b.generation_id
       join lateral (
         select r.receipt_id, r.event_json
         from runtime_extension_transition_receipts r
         join runtime_extension_operations o on o.operation_id=r.operation_id
         where o.application_id=b.application_id and o.environment=b.environment and o.delivery_class=b.delivery_class and o.extension_id=b.extension_id
           and o.phase='completed' and o.operation_kind in ('install','update','rollback')
           and r.event_json->>'eventType'='extension.lifecycle-transition'
           and r.event_json->>'operationId'=o.operation_id
           and r.event_json->>'operationPhase'='completed' and r.event_json->>'lifecycleState'='active'
           and r.event_json->>'receiptId'=r.receipt_id
           and r.event_json->>'applicationId'=b.application_id and r.event_json->>'environment'=b.environment
           and r.event_json->>'deliveryClass'=b.delivery_class and r.event_json->>'id'=b.extension_id
           and r.event_json->'evidence'->>'generationId'=b.generation_id
           and r.event_json->'evidence'->>'sourceCommit'=b.authority_json->>'sourceCommit'
           and r.event_json->'evidence'->>'artifactDigest'=b.artifact_digest
           and r.event_json->'evidence'->>'manifestDigest'=b.authority_json->>'manifestDigest'
           and r.event_json->'evidence'->>'catalogDigest'=b.authority_json->>'catalogDigest'
           and r.event_json->'evidence'->>'provenanceDigest'=b.authority_json->>'provenanceDigest'
           and r.event_json->'evidence'->>'sbomDigest'=b.authority_json->>'sbomDigest'
         order by r.revision desc
         limit 1
       ) r on true
       where b.application_id=$1 and b.environment=$2 and b.delivery_class='hot-application' and b.extension_id=$3
         and b.generation_id=$4 and b.artifact_digest=$5
         and e.disposition='active' and e.active_generation_id=b.generation_id
         and e.active_generation=jsonb_build_object(
           'authority', 'verified-bundle', 'applicationId', b.application_id, 'environment', b.environment,
           'deliveryClass', b.delivery_class, 'extensionId', b.extension_id, 'generationId', b.generation_id,
           'version', b.version, 'sourceCommit', b.authority_json->>'sourceCommit', 'artifactDigest', b.artifact_digest,
           'manifestDigest', b.authority_json->>'manifestDigest', 'catalogDigest', b.authority_json->>'catalogDigest',
           'provenanceDigest', b.authority_json->>'provenanceDigest', 'sbomDigest', b.authority_json->>'sbomDigest',
           'receiptId', r.receipt_id
         )
         and g.state='active' and g.authority_json=b.authority_json and g.receipt_id=r.receipt_id
         and g.server_generation_id=b.generation_id and g.ui_generation_id=b.generation_id and g.storage_generation_id=b.generation_id`,
      [identity.applicationId, identity.environment, identity.extensionId, identity.generationId, identity.artifactDigest]
    );
    return result.rows[0];
  }

  private async transaction<T>(work: (session: RuntimeExtensionSession) => Promise<T>): Promise<T> {
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      const result = await work(session);
      await session.query("commit");
      return result;
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }
}
