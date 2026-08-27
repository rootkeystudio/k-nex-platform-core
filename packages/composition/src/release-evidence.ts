import { sign, verify } from "node:crypto";

import { canonicalJson } from "@k-nex/contracts";
import { valid as validSemver } from "semver";

export interface ReleaseComponent {
  readonly name: string;
  readonly version: string;
  readonly sha256?: string;
}

export interface ReleaseMaterial {
  readonly name: string;
  readonly digest: string;
}

export interface ReleaseProvenanceStatement {
  readonly predicateType: "https://k-nex.dev/provenance/v1";
  readonly subject: { readonly name: string; readonly digest: string };
  readonly predicate: {
    readonly sourceCommit: string;
    readonly workflowIdentity: string;
    readonly materials: readonly ReleaseMaterial[];
  };
}

export interface SignedReleaseProvenance {
  readonly algorithm: "Ed25519";
  readonly payloadType: "application/vnd.k-nex.provenance+json";
  readonly payload: string;
  readonly signature: string;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

export function createCycloneDxSbom(applicationId: string, components: readonly ReleaseComponent[]) {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(applicationId)) throw new Error("SBOM application identity is invalid.");
  const normalized = components.map((component) => {
    if (!packagePattern.test(component.name) || validSemver(component.version) === null ||
      (component.sha256 !== undefined && !digestPattern.test(component.sha256))) throw new Error("SBOM component is invalid.");
    return Object.freeze({
      type: "library" as const,
      name: component.name,
      version: component.version,
      purl: `pkg:npm/${component.name.replace("@", "%40")}@${component.version}`,
      ...(component.sha256 === undefined ? {} : { hashes: Object.freeze([{ alg: "SHA-256" as const, content: component.sha256.slice(7) }]) })
    });
  }).sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
  if (new Set(normalized.map(({ name }) => name)).size !== normalized.length) throw new Error("SBOM components must be unique by name.");
  return Object.freeze({
    bomFormat: "CycloneDX" as const,
    specVersion: "1.6" as const,
    version: 1,
    metadata: Object.freeze({ component: Object.freeze({ type: "application" as const, name: applicationId }) }),
    components: Object.freeze(normalized)
  });
}

export function createReleaseProvenance(input: {
  readonly subjectName: string;
  readonly artifactDigest: string;
  readonly sourceCommit: string;
  readonly workflowIdentity: string;
  readonly materials: readonly ReleaseMaterial[];
}): ReleaseProvenanceStatement {
  if (input.subjectName.length < 1 || input.subjectName.length > 256 || !digestPattern.test(input.artifactDigest) ||
    !/^[0-9a-f]{40}$/u.test(input.sourceCommit) || !input.workflowIdentity.endsWith(`@${input.sourceCommit}`)) {
    throw new Error("Release subject, source commit, or full-SHA workflow identity is invalid.");
  }
  const materials = [...input.materials].map((material) => {
    if (material.name.length < 1 || material.name.length > 256 || !digestPattern.test(material.digest)) throw new Error("Release material is invalid.");
    return Object.freeze({ ...material });
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(materials.map(({ name }) => name)).size !== materials.length) throw new Error("Release materials must be unique.");
  return Object.freeze({
    predicateType: "https://k-nex.dev/provenance/v1",
    subject: Object.freeze({ name: input.subjectName, digest: input.artifactDigest }),
    predicate: Object.freeze({ sourceCommit: input.sourceCommit, workflowIdentity: input.workflowIdentity, materials: Object.freeze(materials) })
  });
}

export function signReleaseProvenance(statement: ReleaseProvenanceStatement, privateKey: string): SignedReleaseProvenance {
  const payload = canonicalJson(statement);
  return Object.freeze({
    algorithm: "Ed25519",
    payloadType: "application/vnd.k-nex.provenance+json",
    payload,
    signature: sign(null, Buffer.from(payload), privateKey).toString("base64")
  });
}

export function verifyReleaseProvenance(envelope: SignedReleaseProvenance, publicKey: string): ReleaseProvenanceStatement {
  if (envelope.algorithm !== "Ed25519" || envelope.payloadType !== "application/vnd.k-nex.provenance+json" ||
    !verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, "base64"))) {
    throw new Error("Release provenance signature is invalid.");
  }
  const parsed = JSON.parse(envelope.payload) as ReleaseProvenanceStatement;
  const normalized = createReleaseProvenance({
    subjectName: parsed.subject.name,
    artifactDigest: parsed.subject.digest,
    sourceCommit: parsed.predicate.sourceCommit,
    workflowIdentity: parsed.predicate.workflowIdentity,
    materials: parsed.predicate.materials
  });
  if (canonicalJson(normalized) !== envelope.payload) throw new Error("Release provenance payload is non-canonical.");
  return normalized;
}
