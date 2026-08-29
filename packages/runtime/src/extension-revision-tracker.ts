import type { ActiveGenerationObservation } from "./plugin-manager.js";

export class ExtensionRevisionTracker {
  private current?: ActiveGenerationObservation;

  observe(observation: ActiveGenerationObservation): boolean {
    if (this.current && observation.inventoryRevision <= this.current.inventoryRevision) return false;
    this.current = Object.freeze({ ...observation });
    return true;
  }

  invalidate(inventoryRevision: number): boolean {
    return !this.current || inventoryRevision > this.current.inventoryRevision;
  }

  snapshot(): ActiveGenerationObservation | undefined {
    return this.current;
  }
}
