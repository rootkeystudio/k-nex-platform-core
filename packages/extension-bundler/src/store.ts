import type { VerificationRequest, VerifiedArtifact } from "./verifier.js";
import { ArtifactVerifier } from "./verifier.js";
import { sha256 } from "./bundle.js";
import type { Digest } from "./catalog.js";

export type StagedArtifact = Readonly<{ artifactDigest: Digest; verified: VerifiedArtifact }>;
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

export class VerifiedArtifactStore {
  readonly #verifier: ArtifactVerifier;
  readonly #staged = new Map<string, StagedArtifact>();
  readonly #owners = new Map<string, Digest>();

  constructor(verifier: ArtifactVerifier) { this.#verifier = verifier; }

  async stage(request: VerificationRequest): Promise<StagedArtifact> {
    const verified = await this.#verifier.verify(request);
    const existing = this.#staged.get(verified.artifactDigest);
    if (existing) return existing;
    const staged = Object.freeze({ artifactDigest: verified.artifactDigest, verified });
    this.#staged.set(verified.artifactDigest, staged);
    return staged;
  }

  read(artifactDigest: Digest): StagedArtifact | undefined { return this.#staged.get(artifactDigest); }

  async stageForOwner(owner: VerifiedArtifactGenerationOwner, request: VerificationRequest): Promise<StagedArtifact> {
    if (owner.deliveryClass !== request.deliveryClass || owner.extensionId !== request.id) {
      throw new Error("Verified artifact owner does not match the requested release.");
    }
    const staged = await this.stage(request);
    const key = ownerKey(owner);
    const existing = this.#owners.get(key);
    if (existing !== undefined && existing !== staged.artifactDigest) {
      throw new Error("Verified artifact owner is already bound to a different immutable artifact.");
    }
    this.#owners.set(key, staged.artifactDigest);
    return staged;
  }

  runnerSource(): VerifiedArtifactRunnerSource {
    return {
      load: ({ owner, artifactDigest, serverEntrypoint }) => {
        if (owner.deliveryClass !== "hot-application" || this.#owners.get(ownerKey(owner)) !== artifactDigest) {
          throw new Error("Runner artifact owner or digest is not in the verified inventory.");
        }
        const staged = this.#staged.get(artifactDigest);
        if (!staged) {
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
