import type { VerificationRequest, VerifiedArtifact } from "./verifier.js";
import { ArtifactVerifier } from "./verifier.js";
import { sha256 } from "./bundle.js";
import type { Digest } from "./catalog.js";
import { canonicalJson } from "@k-nex/contracts";

export type StagedArtifact = Readonly<{ artifactDigest: Digest; catalogDigest: Digest; verified: VerifiedArtifact }>;
export type VerifiedArtifactOwner = Readonly<{
  applicationId: string;
  environment: string;
  deliveryClass: "hot-application" | "theme-skin";
  extensionId: string;
}>;
export type VerifiedArtifactGenerationOwner = VerifiedArtifactOwner & Readonly<{ generationId: string }>;

export interface VerifiedArtifactRunnerSource {
  load(input: Readonly<{
    owner: VerifiedArtifactGenerationOwner;
    artifactDigest: Digest;
    serverEntrypoint: string;
  }>): Readonly<{ source: string }> | Promise<Readonly<{ source: string }>>;
}

function ownerKey(owner: VerifiedArtifactGenerationOwner): string {
  return `${owner.applicationId}\0${owner.environment}\0${owner.deliveryClass}\0${owner.extensionId}\0${owner.generationId}`;
}

function acceptanceKey(artifactDigest: Digest, catalogDigest: Digest): string {
  return `${artifactDigest}\0${catalogDigest}`;
}

function copyStagedArtifact(staged: StagedArtifact): StagedArtifact {
  return Object.freeze({
    artifactDigest: staged.artifactDigest,
    catalogDigest: staged.catalogDigest,
    verified: Object.freeze({ ...staged.verified, files: new Map([...staged.verified.files].map(([path, bytes]) => [path, Buffer.from(bytes)])) })
  });
}

export class VerifiedArtifactStore {
  readonly #verifier: ArtifactVerifier;
  readonly #artifacts = new Map<Digest, ReadonlyMap<string, Buffer>>();
  readonly #acceptances = new Map<string, StagedArtifact>();
  readonly #owners = new Map<string, string>();

  constructor(verifier: ArtifactVerifier) { this.#verifier = verifier; }

  async stage(request: VerificationRequest): Promise<StagedArtifact> {
    const verified = await this.#verifier.verify(request);
    const catalogDigest = sha256(Buffer.from(canonicalJson(request.catalog)));
    const key = acceptanceKey(verified.artifactDigest, catalogDigest);
    const existing = this.#acceptances.get(key);
    if (existing) return copyStagedArtifact(existing);
    const files = this.#artifacts.get(verified.artifactDigest) ?? new Map([...verified.files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
    this.#artifacts.set(verified.artifactDigest, files);
    const staged = Object.freeze({ artifactDigest: verified.artifactDigest, catalogDigest, verified: Object.freeze({ ...verified, files }) });
    this.#acceptances.set(key, staged);
    return copyStagedArtifact(staged);
  }

  read(artifactDigest: Digest, catalogDigest: Digest): StagedArtifact | undefined {
    const staged = this.#acceptances.get(acceptanceKey(artifactDigest, catalogDigest));
    return staged && copyStagedArtifact(staged);
  }

  async stageForOwner(owner: VerifiedArtifactGenerationOwner, request: VerificationRequest): Promise<StagedArtifact> {
    if (owner.deliveryClass !== request.deliveryClass || owner.extensionId !== request.id) {
      throw new Error("Verified artifact owner does not match the requested release.");
    }
    const staged = await this.stage(request);
    const key = ownerKey(owner);
    const acceptance = acceptanceKey(staged.artifactDigest, staged.catalogDigest);
    const existing = this.#owners.get(key);
    if (existing !== undefined && existing !== acceptance) {
      throw new Error("Verified artifact owner is already bound to a different immutable artifact.");
    }
    this.#owners.set(key, acceptance);
    return staged;
  }

  runnerSource(): VerifiedArtifactRunnerSource {
    return {
      load: ({ owner, artifactDigest, serverEntrypoint }) => {
        const acceptance = this.#owners.get(ownerKey(owner));
        if (owner.deliveryClass !== "hot-application" || !acceptance) {
          throw new Error("Runner artifact owner or digest is not in the verified inventory.");
        }
        const staged = this.#acceptances.get(acceptance);
        if (!staged || staged.artifactDigest !== artifactDigest) {
          throw new Error("Runner artifact entrypoint is not declared by the verified manifest.");
        }
        const manifest = staged.verified.manifest;
        if (manifest.deliveryClass !== "hot-application" || manifest.id !== owner.extensionId || !manifest.entrypoints.server.includes(serverEntrypoint)) {
          throw new Error("Runner artifact entrypoint is not declared by the verified manifest.");
        }
        const metadata = manifest.files[serverEntrypoint];
        const file = staged.verified.files.get(serverEntrypoint);
        if (!metadata || metadata.contentType !== "application/javascript" || !file || file.byteLength !== metadata.bytes || sha256(file) !== metadata.digest) {
          throw new Error("Runner artifact entrypoint no longer matches the verified inventory.");
        }
        return Object.freeze({ source: Buffer.from(file).toString("utf8") });
      }
    };
  }
}
