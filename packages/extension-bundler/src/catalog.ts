import { createPublicKey, verify } from "node:crypto";

import { canonicalJson, ExactSemverSchema, HotApplicationIdSchema, ThemeSkinIdSchema } from "@k-nex/contracts";
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
export const CatalogPayloadSchema = z.strictObject({ schemaVersion: z.literal(1), entries: z.array(CatalogEntrySchema).min(1).max(512).refine((entries) => new Set(entries.map((entry) => `${entry.deliveryClass}:${entry.id}:${entry.version}`)).size === entries.length, "Catalog has duplicate entries.") });
export const SignedCatalogSchema = z.strictObject({ schemaVersion: z.literal(1), signer: PublisherSchema, payload: CatalogPayloadSchema, signature: z.string().min(80).max(1024).regex(/^[A-Za-z0-9+/]+={0,2}$/u) });

export type Digest = z.infer<typeof DigestSchema>;
export type Publisher = z.infer<typeof PublisherSchema>;
export type HostedBuildProvenance = z.infer<typeof HostedBuildProvenanceSchema>;
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type CatalogPayload = z.infer<typeof CatalogPayloadSchema>;
export type SignedCatalog = z.infer<typeof SignedCatalogSchema>;

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

  constructor(trustedSigners: Readonly<Record<string, string>>) { this.#trustedSigners = new Map(Object.entries(trustedSigners)); }

  read(input: unknown): readonly CatalogEntry[] {
    const catalog = parseCatalog(input);
    const trustedKey = this.#trustedSigners.get(catalog.signer.identity);
    if (!trustedKey || trustedKey !== catalog.signer.publicKey) throw new Error("Catalog signer is not trusted.");
    let publicKey;
    try { publicKey = createPublicKey(catalog.signer.publicKey); } catch { throw new Error("Catalog signer key is invalid."); }
    for (const entry of catalog.payload.entries) try { createPublicKey(entry.publisher.publicKey); } catch { throw new Error("Catalog extension publisher key is invalid."); }
    if (!verify(null, Buffer.from(canonicalJson(catalog.payload)), publicKey, Buffer.from(catalog.signature, "base64"))) throw new Error("Official catalog signature is invalid.");
    return catalog.payload.entries;
  }
}
