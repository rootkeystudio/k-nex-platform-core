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
  type VerifiedRemoteUiArtifactReader
} from "@k-nex/extension-bundler";
import type {
  DurableDynamicArtifact,
  DurableDynamicArtifactStore,
  ExtensionRollbackCompatibility,
  ExtensionActivationJson,
  VerifiedGenerationAuthority,
  VerifiedGenerationAuthorityOwner
} from "@k-nex/runtime";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

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
  catalog_json: unknown;
  artifact_bytes: Buffer;
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
  authority_json: VerifiedGenerationAuthority;
  activation_json: VerifiedDynamicArtifactStage["activation"];
  version: string;
}

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

/**
 * PostgreSQL-backed content-addressed artifact inventory. It deliberately
 * stores original bytes and re-runs verification when bytes are read so a
 * restored database cannot silently turn an inventory row into executable UI
 * or runner source.
 */
export class PostgresVerifiedArtifactStore implements DurableDynamicArtifactStore, VerifiedRemoteUiArtifactReader {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly verifier: ArtifactVerifier) {}

  async stage(input: VerifiedDynamicArtifactStage): Promise<DurableDynamicArtifact> {
    const verified = await this.verifier.verify(input.verification);
    assertAuthority(input, verified);
    const manifest = verified.manifest;
    if (manifest.deliveryClass !== input.owner.deliveryClass) fail("ARTIFACT_INVALID", "Verified artifact delivery class is not dynamic.");
    const artifact = Buffer.from(input.verification.artifact);
    const provenance = Buffer.from(input.verification.provenance);
    await this.transaction(async (session) => {
      await session.query(
        `insert into runtime_extension_artifacts (artifact_digest, catalog_json, artifact_bytes, provenance_bytes, delivery_class, extension_id, version, runtime_abi)
         values ($1,$2::jsonb,$3,$4,$5,$6,$7,$8) on conflict (artifact_digest) do nothing`,
        [verified.artifactDigest, canonicalJson(input.verification.catalog), artifact, provenance, manifest.deliveryClass, manifest.id, manifest.version, manifest.runtimeAbi]
      );
      await session.query(
        `insert into runtime_extension_artifact_bindings
          (application_id, environment, delivery_class, extension_id, generation_id, artifact_digest, authority_json, activation_json, version)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) on conflict do nothing`,
        [input.owner.applicationId, input.owner.environment, input.owner.deliveryClass, input.owner.extensionId, input.owner.generationId, verified.artifactDigest,
          canonicalJson(input.authority), canonicalJson(input.activation), manifest.version]
      );
    });
    const stored = await this.binding(input.owner, verified.artifactDigest);
    if (!stored || !same(stored.authority_json, input.authority) || !same(stored.activation_json, input.activation) || stored.version !== manifest.version) {
      fail("ARTIFACT_CONFLICT", "Immutable dynamic generation is already bound to different verified content.");
    }
    const reverified = await this.verified(verified.artifactDigest);
    if (!reverified) fail("ARTIFACT_UNAVAILABLE", "Verified artifact bytes are unavailable.");
    return this.durable(stored, reverified, sha256(Buffer.from(canonicalJson(input.verification.catalog))));
  }

  async resolve(input: Readonly<{ owner: VerifiedGenerationAuthorityOwner; generationId: string; artifactDigest: string }>): Promise<DurableDynamicArtifact | undefined> {
    const binding = await this.binding({ ...input.owner, generationId: input.generationId }, input.artifactDigest as Digest);
    if (!binding) return undefined;
    const verified = await this.verified(input.artifactDigest as Digest);
    return verified ? this.durable(binding, verified, await this.catalogDigest(input.artifactDigest as Digest)) : undefined;
  }

  async read(artifactDigest: Digest): Promise<StagedArtifact | undefined> {
    const verified = await this.verified(artifactDigest, true);
    return verified ? Object.freeze({ artifactDigest, verified }) : undefined;
  }

  async loadThemeSkin(authority: VerifiedGenerationAuthority): Promise<Readonly<{
    authority: VerifiedGenerationAuthority;
    bundleManifest: unknown;
    files: ReadonlyMap<string, Uint8Array>;
  }>> {
    if (authority.deliveryClass !== "theme-skin") fail("ARTIFACT_UNAVAILABLE", "Theme Skin source is unavailable for this delivery class.");
    const binding = await this.binding(authority, authority.artifactDigest as Digest);
    if (!binding) fail("ARTIFACT_UNAVAILABLE", "Theme Skin generation is not bound to the verified artifact.");
    const verified = await this.verified(authority.artifactDigest as Digest);
    if (!verified || verified.manifest.deliveryClass !== "theme-skin" || verified.manifest.id !== authority.extensionId) {
      fail("ARTIFACT_UNAVAILABLE", "Theme Skin artifact identity does not match its generation.");
    }
    const durable = await this.durable(binding, verified, await this.catalogDigest(authority.artifactDigest as Digest));
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
        const binding = await this.binding(owner, artifactDigest);
        if (!binding) fail("ARTIFACT_UNAVAILABLE", "Runner generation is not bound to the verified artifact.");
        const verified = await this.verified(artifactDigest);
        if (!verified) fail("ARTIFACT_UNAVAILABLE", "Verified artifact bytes are unavailable.");
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

  private async verified(artifactDigest: Digest, absentOk = false): Promise<VerifiedArtifact | undefined> {
    const result = await this.pool.query<ArtifactRow>(
      `select artifact_digest, catalog_json, artifact_bytes, provenance_bytes, delivery_class, extension_id, version, runtime_abi
       from runtime_extension_artifacts where artifact_digest=$1`,
      [artifactDigest]
    );
    const row = result.rows[0];
    if (!row) {
      if (absentOk) return undefined;
      fail("ARTIFACT_UNAVAILABLE", "Verified artifact bytes are unavailable.");
    }
    try {
      const verified = await this.verifier.verifyAccepted({ catalog: row.catalog_json as VerificationRequest["catalog"], artifact: row.artifact_bytes, provenance: row.provenance_bytes,
        deliveryClass: row.delivery_class, id: row.extension_id, version: row.version, runtimeAbi: row.runtime_abi });
      if (verified.artifactDigest !== artifactDigest) fail("ARTIFACT_INVALID", "Artifact bytes no longer match their content address.");
      return verified;
    } catch (error) {
      if (error instanceof VerifiedArtifactStoreError) throw error;
      fail("ARTIFACT_INVALID", "Persisted artifact bytes fail release verification.");
    }
  }

  private async binding(owner: VerifiedArtifactGenerationOwner, artifactDigest: Digest): Promise<BindingRow | undefined> {
    const result = await this.pool.query<BindingRow>(
      `select application_id, environment, delivery_class, extension_id, generation_id, artifact_digest, authority_json, activation_json, version
       from runtime_extension_artifact_bindings
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 and artifact_digest=$6`,
      [owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId, owner.generationId, artifactDigest]
    );
    return result.rows[0];
  }

  private async catalogDigest(artifactDigest: Digest): Promise<Digest> {
    const result = await this.pool.query<{ catalog_json: unknown }>("select catalog_json from runtime_extension_artifacts where artifact_digest=$1", [artifactDigest]);
    const row = result.rows[0];
    if (!row) fail("ARTIFACT_UNAVAILABLE", "Verified artifact bytes are unavailable.");
    return sha256(Buffer.from(canonicalJson(row.catalog_json)));
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
