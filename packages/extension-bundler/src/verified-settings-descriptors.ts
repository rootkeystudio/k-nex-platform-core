import { HotApplicationManifestSchema, SystemSettingsDescriptorSchema, type SystemSettingsDescriptor } from "@k-nex/contracts";

import { sha256 } from "./bundle.js";
import type { Digest } from "./catalog.js";
import type { StagedArtifact } from "./store.js";

export interface VerifiedSettingsDescriptorArtifactIdentity {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
  readonly artifactDigest: Digest;
}

/**
 * Resolves only the currently active durable Hot Application generation and
 * reverified bytes as one authority boundary. A digest-only read loses the
 * application, environment, and generation binding required for settings.
 */
export interface VerifiedSettingsDescriptorArtifactReader {
  readSettingsDescriptors(identity: VerifiedSettingsDescriptorArtifactIdentity): StagedArtifact | undefined | Promise<StagedArtifact | undefined>;
}

export class VerifiedSettingsDescriptorError extends Error {
  constructor(
    readonly code: "REQUEST_INVALID" | "GENERATION_INACTIVE" | "ARTIFACT_UNAVAILABLE" | "DESCRIPTOR_UNAVAILABLE" | "DESCRIPTOR_INVALID" | "INVENTORY_MISMATCH",
    message: string
  ) {
    super(message);
    this.name = "VerifiedSettingsDescriptorError";
  }
}

const applicationPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const appPattern = /^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;
const generationPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function validIdentity(identity: VerifiedSettingsDescriptorArtifactIdentity): boolean {
  return applicationPattern.test(identity.applicationId)
    && environmentPattern.test(identity.environment)
    && appPattern.test(identity.appId)
    && generationPattern.test(identity.generationId)
    && digestPattern.test(identity.artifactDigest);
}

/** Reads data-only settings definitions from a single active Hot Application generation. */
export class VerifiedHotApplicationSettingsDescriptorService {
  constructor(private readonly artifacts: VerifiedSettingsDescriptorArtifactReader) {}

  async read(identity: VerifiedSettingsDescriptorArtifactIdentity): Promise<readonly SystemSettingsDescriptor[]> {
    if (!validIdentity(identity)) {
      throw new VerifiedSettingsDescriptorError("REQUEST_INVALID", "Hot Application settings descriptor identity is invalid.");
    }

    let staged: StagedArtifact | undefined;
    try {
      staged = await this.artifacts.readSettingsDescriptors(identity);
    } catch {
      throw new VerifiedSettingsDescriptorError("ARTIFACT_UNAVAILABLE", "Verified Hot Application settings artifact is unavailable.");
    }
    if (!staged || staged.artifactDigest !== identity.artifactDigest || staged.verified.artifactDigest !== identity.artifactDigest) {
      throw new VerifiedSettingsDescriptorError("GENERATION_INACTIVE", "Hot Application generation is not active with its verified artifact.");
    }

    const envelope = staged.verified.manifest;
    if (envelope.deliveryClass !== "hot-application" || envelope.id !== identity.appId || !staged.verified.hotApplicationManifest) {
      throw new VerifiedSettingsDescriptorError("ARTIFACT_UNAVAILABLE", "Verified Hot Application artifact identity does not match.");
    }

    let manifest: typeof staged.verified.hotApplicationManifest;
    try {
      manifest = HotApplicationManifestSchema.parse(staged.verified.hotApplicationManifest);
    } catch {
      throw new VerifiedSettingsDescriptorError("ARTIFACT_UNAVAILABLE", "Verified Hot Application manifest is unavailable.");
    }
    if (manifest.id !== identity.appId || manifest.deliveryClass !== "hot-application") {
      throw new VerifiedSettingsDescriptorError("ARTIFACT_UNAVAILABLE", "Verified Hot Application manifest identity does not match.");
    }

    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const reference of manifest.settings) {
      if (ids.has(reference.id) || paths.has(reference.path)) {
        throw new VerifiedSettingsDescriptorError("DESCRIPTOR_UNAVAILABLE", "Hot Application settings descriptor references are ambiguous.");
      }
      ids.add(reference.id);
      paths.add(reference.path);
    }

    const descriptors: SystemSettingsDescriptor[] = [];
    for (const reference of manifest.settings) {
      const metadata = envelope.files[reference.path];
      const stored = staged.verified.files.get(reference.path);
      if (!metadata || !stored || metadata.contentType !== "application/json") {
        throw new VerifiedSettingsDescriptorError("DESCRIPTOR_UNAVAILABLE", "Hot Application settings descriptor is absent from the verified inventory.");
      }
      const bytes = Buffer.from(stored);
      if (bytes.byteLength !== metadata.bytes || sha256(bytes) !== metadata.digest) {
        throw new VerifiedSettingsDescriptorError("INVENTORY_MISMATCH", "Hot Application settings descriptor no longer matches its verified inventory.");
      }

      let input: unknown;
      try {
        input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new VerifiedSettingsDescriptorError("DESCRIPTOR_INVALID", "Hot Application settings descriptor is not valid UTF-8 JSON.");
      }
      const parsed = SystemSettingsDescriptorSchema.safeParse(input);
      if (!parsed.success || parsed.data.id !== reference.id
        || parsed.data.publisher.kind !== "extension"
        || parsed.data.publisher.deliveryClass !== "hot-application"
        || parsed.data.publisher.extensionId !== identity.appId) {
        throw new VerifiedSettingsDescriptorError("DESCRIPTOR_INVALID", "Hot Application settings descriptor is invalid for its active application.");
      }
      descriptors.push(deepFreeze(structuredClone(parsed.data)));
    }
    return deepFreeze(descriptors.sort((left, right) => left.id.localeCompare(right.id)));
  }
}
