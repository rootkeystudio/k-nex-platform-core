import type { VerificationRequest, VerifiedArtifact } from "./verifier.js";
import { ArtifactVerifier } from "./verifier.js";
import type { Digest } from "./catalog.js";

export type StagedArtifact = Readonly<{ artifactDigest: Digest; verified: VerifiedArtifact }>;

export class VerifiedArtifactStore {
  readonly #verifier: ArtifactVerifier;
  readonly #staged = new Map<string, StagedArtifact>();

  constructor(verifier: ArtifactVerifier) { this.#verifier = verifier; }

  stage(request: VerificationRequest): StagedArtifact {
    const verified = this.#verifier.verify(request);
    const existing = this.#staged.get(verified.artifactDigest);
    if (existing) return existing;
    const staged = Object.freeze({ artifactDigest: verified.artifactDigest, verified });
    this.#staged.set(verified.artifactDigest, staged);
    return staged;
  }

  read(artifactDigest: Digest): StagedArtifact | undefined { return this.#staged.get(artifactDigest); }
}
