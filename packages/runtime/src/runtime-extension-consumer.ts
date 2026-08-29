import type { ExtensionIdentity } from "@k-nex/contracts";

import type { RuntimeExtensionStore } from "./plugin-manager.js";
import { ExtensionRevisionTracker } from "./extension-revision-tracker.js";

export interface RuntimeExtensionInvalidation {
  readonly applicationId: string;
  readonly environment: string;
  readonly extension: ExtensionIdentity;
  readonly inventoryRevision: number;
}

/** A process-local cache whose source of truth remains the runtime store. */
export class RuntimeExtensionRevisionConsumer {
  private readonly tracker = new ExtensionRevisionTracker();

  constructor(
    private readonly store: Pick<RuntimeExtensionStore, "observeActiveGeneration">,
    private readonly applicationId: string,
    private readonly environment: string,
    private readonly extension: ExtensionIdentity
  ) {}

  invalidate(invalidation: RuntimeExtensionInvalidation): boolean {
    if (invalidation.applicationId !== this.applicationId || invalidation.environment !== this.environment ||
      invalidation.extension.deliveryClass !== this.extension.deliveryClass || invalidation.extension.id !== this.extension.id) {
      return false;
    }
    return this.tracker.invalidate(invalidation.inventoryRevision);
  }

  async poll(): Promise<boolean> {
    return this.tracker.observe(await this.store.observeActiveGeneration(this.applicationId, this.environment, this.extension));
  }

  snapshot() {
    return this.tracker.snapshot();
  }
}
