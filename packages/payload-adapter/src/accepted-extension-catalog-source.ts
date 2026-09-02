import { CatalogClient } from "@k-nex/extension-bundler";
import { PluginManifestSchema } from "@k-nex/contracts";
import type { ExtensionCatalogRecord, ExtensionCatalogSource } from "@k-nex/runtime";

import { type PostgresCatalogMirrorStore } from "./catalog-mirror-store.js";

type AcceptedCatalogMirror = Pick<PostgresCatalogMirrorStore, "readAcceptedSnapshot">;

function releaseKey(record: ExtensionCatalogRecord): string {
  return `${record.extension.deliveryClass}:${record.extension.id}:${record.version}`;
}

function frozenRecords(records: readonly ExtensionCatalogRecord[]): readonly ExtensionCatalogRecord[] {
  const keys = records.map(releaseKey);
  if (new Set(keys).size !== keys.length) throw new TypeError("Extension catalog contains duplicate extension releases.");
  return Object.freeze([...records].sort((left, right) => releaseKey(left).localeCompare(releaseKey(right))));
}

function staticRecord(value: unknown): ExtensionCatalogRecord {
  const manifest = PluginManifestSchema.parse(value);
  return Object.freeze({
    extension: Object.freeze({ deliveryClass: "platform-plugin", id: manifest.id }),
    version: manifest.version,
    displayName: manifest.displayName,
    support: "supported",
    review: "approved",
    security: "clear",
    revoked: false,
    availability: "static-release"
  });
}

/**
 * Composes boot-trusted static Platform Plugin releases with the accepted,
 * currently valid dynamic catalog mirror.
 */
export class AcceptedExtensionCatalogSource implements ExtensionCatalogSource {
  private readonly staticRecords: readonly ExtensionCatalogRecord[];

  constructor(
    private readonly mirror: AcceptedCatalogMirror,
    private readonly catalog: CatalogClient,
    trustedPlatformPluginManifests: readonly unknown[]
  ) {
    this.staticRecords = frozenRecords(trustedPlatformPluginManifests.map(staticRecord));
  }

  async list(): Promise<readonly ExtensionCatalogRecord[]> {
    const accepted = await this.mirror.readAcceptedSnapshot();
    if (!accepted) throw new Error("Accepted catalog snapshot is unavailable.");

    const verified = await this.catalog.verifySnapshot(accepted.signedCatalog);
    if (
      verified.checkpoint.signerIdentity !== accepted.signerIdentity ||
      verified.checkpoint.sequence !== accepted.sequence ||
      verified.checkpoint.payloadDigest !== accepted.digest ||
      verified.entries.length !== accepted.releaseCount
    ) {
      throw new Error("Accepted catalog snapshot metadata does not match its durable pointer.");
    }

    const dynamicRecords = verified.entries.map((entry) => Object.freeze({
      extension: Object.freeze({ deliveryClass: entry.deliveryClass, id: entry.id }),
      version: entry.version,
      displayName: entry.id,
      support: entry.support,
      review: entry.review,
      security: entry.security,
      revoked: entry.revoked,
      availability: "live-generation" as const
    }));

    return frozenRecords([...this.staticRecords, ...dynamicRecords]);
  }
}
