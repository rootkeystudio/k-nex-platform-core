import {
  EffectiveSettingsDocumentSchema,
  ResourceIdSchema,
  SettingsStateSchema,
  canonicalJson,
  type EffectiveSettingsDocument,
  type SettingsDocumentIdentity,
  type SystemSettingsDescriptor
} from "@k-nex/contracts";

import { validateSystemSettingsValues } from "./plugin-settings.js";
import type { SystemSettingsDescriptorRecord, SystemSettingsDescriptorSource, SystemSettingsSnapshot } from "./system-settings-administration.js";

export interface EffectiveSettingsStore {
  read(identity: SettingsDocumentIdentity): Promise<SystemSettingsSnapshot | undefined> | SystemSettingsSnapshot | undefined;
}

/** Reads only the exact currently-active descriptor owner; pending and retired values are never effective. */
export class EffectiveSettingsProvider {
  constructor(private readonly descriptors: SystemSettingsDescriptorSource, private readonly store: EffectiveSettingsStore) {}

  async read(input: Readonly<{ applicationId: string; environment: string; settingsId: string }>): Promise<EffectiveSettingsDocument | undefined> {
    exact(input);
    if (!ResourceIdSchema.safeParse(input.settingsId).success) throw new TypeError("Effective settings input is invalid.");
    const before = await this.record(input);
    if (!before || before.lifecycle !== "active") return undefined;
    const snapshot = await this.store.read(before.identity);
    const state = SettingsStateSchema.safeParse(snapshot?.state);
    const document = EffectiveSettingsDocumentSchema.safeParse(snapshot?.document);
    if (!state.success || state.data.applicationId !== input.applicationId || state.data.environment !== input.environment ||
      !document.success || canonicalJson(document.data.identity) !== canonicalJson(before.identity) ||
      document.data.settingsRevision > state.data.settingsRevision || !validValues(before.descriptor, document.data.values)) return undefined;
    const after = await this.record(input);
    if (!after || after.lifecycle !== "active" || canonicalJson(after) !== canonicalJson(before)) return undefined;
    return Object.freeze(document.data);
  }

  private async record(input: Readonly<{ applicationId: string; environment: string; settingsId: string }>): Promise<SystemSettingsDescriptorRecord | undefined> {
    const records = await this.descriptors.list(input.applicationId, input.environment);
    const matching = records.filter((record) => record.descriptor.id === input.settingsId);
    if (matching.length > 1) throw new TypeError("Effective settings descriptors are ambiguous.");
    return matching[0];
  }
}

function validValues(descriptor: SystemSettingsDescriptor, values: EffectiveSettingsDocument["values"]): boolean {
  try { validateSystemSettingsValues(descriptor, values); return true; } catch { return false; }
}

function exact(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).sort().join("\0") !== "applicationId\0environment\0settingsId") {
    throw new TypeError("Effective settings input is invalid.");
  }
}
