import { createHash, createPublicKey, verify } from "node:crypto";

import { canonicalJson, ExactSemverSchema, HotApplicationIdSchema, ThemeSkinIdSchema, compareExactSemverPrecedence } from "@k-nex/contracts";
import * as z from "zod";

export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const PublisherSchema = z.strictObject({ identity: z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9.-]*$/u), publicKey: z.string().min(64).max(2048).regex(/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----\n$/u) });
const SourceSchema = z.strictObject({ repository: z.string().max(512).regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u), commit: z.string().regex(/^[0-9a-f]{40}$/u), assetUrl: z.string().max(512).regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.tar\.gz$/u) });
const ProvenanceSourceSchema = SourceSchema.pick({ repository: true, commit: true });

export const HostedBuildProvenanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: ProvenanceSourceSchema,
  workflowIdentity: z.string().max(768).regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml@[0-9a-f]{40}$/u),
  outputs: z.strictObject({ payloadDigest: DigestSchema, sbomDigest: DigestSchema })
});
const CatalogEntryBase = { version: ExactSemverSchema, runtimeAbi: ExactSemverSchema, publisher: PublisherSchema, source: SourceSchema, artifactDigest: DigestSchema, manifestDigest: DigestSchema, sbomDigest: DigestSchema, provenanceDigest: DigestSchema, support: z.enum(["supported", "deprecated", "unsupported"]), review: z.enum(["approved", "pending", "rejected"]), security: z.enum(["clear", "advisory", "compromised"]), revoked: z.boolean() } as const;
export const CatalogEntrySchema = z.discriminatedUnion("deliveryClass", [
  z.strictObject({ ...CatalogEntryBase, deliveryClass: z.literal("hot-application"), id: HotApplicationIdSchema }),
  z.strictObject({ ...CatalogEntryBase, deliveryClass: z.literal("theme-skin"), id: ThemeSkinIdSchema })
]);
export const CatalogPayloadSchema = z.strictObject({ schemaVersion: z.literal(1), sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), expiresAt: z.string().datetime({ offset: true }), entries: z.array(CatalogEntrySchema).min(1).max(512).refine((entries) => new Set(entries.map((entry) => `${entry.deliveryClass}:${entry.id}:${entry.version}`)).size === entries.length, "Catalog has duplicate entries.") });
export const SignedCatalogSchema = z.strictObject({ schemaVersion: z.literal(1), signer: PublisherSchema, payload: CatalogPayloadSchema, signature: z.string().min(80).max(1024).regex(/^[A-Za-z0-9+/]+={0,2}$/u) });

export type Digest = z.infer<typeof DigestSchema>;
export type Publisher = z.infer<typeof PublisherSchema>;
export type HostedBuildProvenance = z.infer<typeof HostedBuildProvenanceSchema>;
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type CatalogPayload = z.infer<typeof CatalogPayloadSchema>;
export type SignedCatalog = z.infer<typeof SignedCatalogSchema>;

export const catalogPolicyDispositions = [
  "clear",
  "revoked",
  "security-compromised",
  "security-advisory",
  "review-rejected",
  "review-pending",
  "support-unsupported",
  "support-deprecated"
] as const;

export type CatalogPolicyDisposition = typeof catalogPolicyDispositions[number];

/**
 * One policy ordering governs both fresh installs and active-generation
 * revalidation. Earlier conditions win when a signed release has multiple
 * non-installable states.
 */
export function catalogPolicyDisposition(entry: CatalogEntry): CatalogPolicyDisposition {
  if (entry.revoked) return "revoked";
  if (entry.security === "compromised") return "security-compromised";
  if (entry.security === "advisory") return "security-advisory";
  if (entry.review === "rejected") return "review-rejected";
  if (entry.review === "pending") return "review-pending";
  if (entry.support === "unsupported") return "support-unsupported";
  if (entry.support === "deprecated") return "support-deprecated";
  return "clear";
}

export interface CatalogCheckpoint {
  readonly signerIdentity: string;
  readonly sequence: number;
  readonly payloadDigest: Digest;
  readonly highestVersions: Readonly<Record<string, string>>;
}

/** This store is owned by the host's durable runtime state, not by a catalog artifact. */
export interface CatalogCheckpointStore {
  read(signerIdentity: string): Promise<CatalogCheckpoint | undefined>;
  compareAndSet(expected: CatalogCheckpoint | undefined, next: CatalogCheckpoint): Promise<boolean>;
}

export class InMemoryCatalogCheckpointStore implements CatalogCheckpointStore {
  readonly #values = new Map<string, CatalogCheckpoint>();
  async read(signerIdentity: string): Promise<CatalogCheckpoint | undefined> { return this.#values.get(signerIdentity); }
  async compareAndSet(expected: CatalogCheckpoint | undefined, next: CatalogCheckpoint): Promise<boolean> {
    const actual = this.#values.get(next.signerIdentity);
    if (!sameCheckpoint(actual, expected)) return false;
    this.#values.set(next.signerIdentity, freezeCheckpoint(next));
    return true;
  }
}

function freezeCheckpoint(checkpoint: CatalogCheckpoint): CatalogCheckpoint {
  return Object.freeze({ ...checkpoint, highestVersions: Object.freeze({ ...checkpoint.highestVersions }) });
}

function sameCheckpoint(left: CatalogCheckpoint | undefined, right: CatalogCheckpoint | undefined): boolean {
  if (!left || !right) return left === right;
  if (left.signerIdentity !== right.signerIdentity || left.sequence !== right.sequence || left.payloadDigest !== right.payloadDigest) return false;
  const leftVersions = Object.entries(left.highestVersions).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightVersions = Object.entries(right.highestVersions).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return leftVersions.length === rightVersions.length && leftVersions.every(([key, version], index) => key === rightVersions[index]?.[0] && version === rightVersions[index]?.[1]);
}

function parseCatalog(catalog: unknown): SignedCatalog {
  const parsed = SignedCatalogSchema.safeParse(catalog);
  if (!parsed.success) throw new Error(`Invalid official catalog: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`);
  for (const entry of parsed.data.payload.entries) if (!entry.source.assetUrl.startsWith(`${entry.source.repository}/releases/download/`)) throw new Error("Invalid official catalog: asset repository differs from source repository.");
  return parsed.data;
}

export function assertCatalog(catalog: unknown): asserts catalog is SignedCatalog {
  parseCatalog(catalog);
}

export function verifyHostedBuildProvenance(provenance: unknown, entry: CatalogEntry, payloadDigest: Digest): void {
  const parsed = HostedBuildProvenanceSchema.safeParse(provenance);
  if (!parsed.success || parsed.data.source.repository !== entry.source.repository || parsed.data.source.commit !== entry.source.commit ||
    !parsed.data.workflowIdentity.startsWith(`${entry.source.repository}/.github/workflows/`) || !parsed.data.workflowIdentity.endsWith(`@${entry.source.commit}`) ||
    parsed.data.outputs.payloadDigest !== payloadDigest || parsed.data.outputs.sbomDigest !== entry.sbomDigest) throw new Error("Provenance does not bind the exact bundle outputs.");
}

export class CatalogClient {
  readonly #trustedSigners: ReadonlyMap<string, string>;
  readonly #checkpoints: CatalogCheckpointStore;
  readonly #now: () => number;

  constructor(trustedSigners: Readonly<Record<string, string>>, checkpoints: CatalogCheckpointStore, now: () => number = Date.now) {
    this.#trustedSigners = new Map(Object.entries(trustedSigners)); this.#checkpoints = checkpoints; this.#now = now;
  }

  /**
   * Validates a catalog retained with an already accepted immutable artifact.
   * This deliberately does not make a historical acceptance depend on today's
   * freshness, replay, or installability policy.
   */
  async readAcceptanceEvidence(input: unknown): Promise<readonly CatalogEntry[]> {
    return this.signedEntries(input);
  }

  async read(input: unknown): Promise<readonly CatalogEntry[]> {
    const { catalog, entries } = await this.signedCatalog(input);
    const expiry = Date.parse(catalog.payload.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= this.#now()) throw new Error("Official catalog is expired.");
    const payloadDigest = `sha256:${createHash("sha256").update(canonicalJson(catalog.payload)).digest("hex")}` as Digest;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const previous = await this.#checkpoints.read(catalog.signer.identity);
      if (previous && (catalog.payload.sequence < previous.sequence || (catalog.payload.sequence === previous.sequence && payloadDigest !== previous.payloadDigest))) {
        throw new Error("Official catalog checkpoint is stale or replayed.");
      }
      const incomingHighest: Record<string, string> = {};
      for (const entry of entries) {
        const key = `${entry.deliveryClass}:${entry.id}`;
        const incoming = incomingHighest[key];
        if (incoming === undefined || compareExactSemverPrecedence(entry.version, incoming) > 0) incomingHighest[key] = entry.version;
      }
      const highestVersions = { ...(previous?.highestVersions ?? {}) };
      for (const [key, incoming] of Object.entries(incomingHighest)) {
        const highest = highestVersions[key];
        if (highest && compareExactSemverPrecedence(incoming, highest) < 0) throw new Error("Official catalog attempts an unauthorized downgrade.");
        if (highest === undefined || compareExactSemverPrecedence(incoming, highest) > 0) highestVersions[key] = incoming;
      }
      const next = freezeCheckpoint({ signerIdentity: catalog.signer.identity, sequence: catalog.payload.sequence, payloadDigest, highestVersions });
      if (await this.#checkpoints.compareAndSet(previous, next)) return entries;
    }
    throw new Error("Official catalog checkpoint changed repeatedly; refusing an unconfirmed catalog read.");
  }

  private async signedEntries(input: unknown): Promise<readonly CatalogEntry[]> {
    return (await this.signedCatalog(input)).entries;
  }

  private async signedCatalog(input: unknown): Promise<Readonly<{ catalog: SignedCatalog; entries: readonly CatalogEntry[] }>> {
    const catalog = parseCatalog(input);
    const trustedKey = this.#trustedSigners.get(catalog.signer.identity);
    if (!trustedKey || trustedKey !== catalog.signer.publicKey) throw new Error("Catalog signer is not trusted.");
    let publicKey;
    try { publicKey = createPublicKey(catalog.signer.publicKey); } catch { throw new Error("Catalog signer key is invalid."); }
    for (const entry of catalog.payload.entries) try { createPublicKey(entry.publisher.publicKey); } catch { throw new Error("Catalog extension publisher key is invalid."); }
    if (!verify(null, Buffer.from(canonicalJson(catalog.payload)), publicKey, Buffer.from(catalog.signature, "base64"))) throw new Error("Official catalog signature is invalid.");
    return Object.freeze({ catalog, entries: catalog.payload.entries });
  }
}
