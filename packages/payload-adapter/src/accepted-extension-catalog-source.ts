import { CatalogClient } from "@k-nex/extension-bundler";
import type { ExtensionCatalogRecord, ExtensionCatalogSource } from "@k-nex/runtime";

import { type PostgresCatalogMirrorStore } from "./catalog-mirror-store.js";

type AcceptedCatalogMirror = Pick<PostgresCatalogMirrorStore, "readAcceptedSnapshot">;

/**
 * Projects only the accepted, currently valid dynamic catalog mirror. Platform
 * Plugin releases are composed from trusted static application inputs elsewhere.
 */
export class AcceptedExtensionCatalogSource implements ExtensionCatalogSource {
  constructor(
    private readonly mirror: AcceptedCatalogMirror,
    private readonly catalog: CatalogClient
  ) {}

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

    return Object.freeze(verified.entries.map((entry) => Object.freeze({
      extension: Object.freeze({ deliveryClass: entry.deliveryClass, id: entry.id }),
      version: entry.version,
      displayName: entry.id,
      support: entry.support,
      review: entry.review,
      security: entry.security,
      revoked: entry.revoked,
      availability: "live-generation" as const
    })).sort((left, right) => (
      `${left.extension.deliveryClass}:${left.extension.id}:${left.version}`
        .localeCompare(`${right.extension.deliveryClass}:${right.extension.id}:${right.version}`)
    )));
  }
}
