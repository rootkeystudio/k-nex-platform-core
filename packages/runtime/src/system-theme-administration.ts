import {
  ExactSemverSchema,
  PluginIdSchema,
  type ExtensionAdministrationActionView,
  type RuntimeExtensionInventory,
  type ThemeProfile
} from "@k-nex/contracts";

import { projectExtensionAdministrationActions } from "./system-extension-administration.js";
import type { ExtensionCatalogRecord } from "./extension-operator-api.js";

export interface SystemThemePackageDescriptor {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly surfaces: readonly ("admin" | "public")[];
  readonly availability: "installed" | "available";
}

export interface SystemThemeProfileSnapshot {
  readonly profileId: string;
  readonly revision: number;
  readonly active?: ThemeProfile;
  readonly previous?: ThemeProfile;
  readonly draft?: ThemeProfile;
}

export interface SystemThemeProfileReference {
  readonly profileId: string;
  readonly state: "active" | "previous" | "draft";
  readonly profileRevisionId: string;
}

export interface SystemThemePackageView extends SystemThemePackageDescriptor {
  readonly class: "package";
  readonly references: readonly SystemThemeProfileReference[];
  readonly removal: "available" | "blocked";
}

export interface SystemThemeSkinView {
  readonly class: "skin";
  readonly id: string;
  readonly disposition: "available" | "active" | "disabled" | "quarantined" | "retirement-pending" | "removed";
  readonly version?: string;
  readonly generationId?: string;
  readonly actions: readonly ExtensionAdministrationActionView[];
}

export interface SystemThemeProfileView extends SystemThemeProfileSnapshot {
  readonly class: "profile";
}

export interface SystemThemeAdministrationView {
  readonly packages: readonly SystemThemePackageView[];
  readonly skins: readonly SystemThemeSkinView[];
  readonly profiles: readonly SystemThemeProfileView[];
}

export function projectSystemThemeAdministration(input: Readonly<{
  readonly packages: readonly SystemThemePackageDescriptor[];
  readonly profiles: readonly SystemThemeProfileSnapshot[];
  readonly inventory: RuntimeExtensionInventory;
  readonly catalog: readonly ExtensionCatalogRecord[];
}>): SystemThemeAdministrationView {
  const profiles = input.profiles.map((profile) => Object.freeze({ class: "profile" as const, ...profile }));
  const packages = input.packages.map((themePackage) => {
    if (!PluginIdSchema.safeParse(themePackage.id).success || !themePackage.id.startsWith("theme.") ||
      !ExactSemverSchema.safeParse(themePackage.version).success || themePackage.displayName.length === 0 ||
      themePackage.surfaces.length === 0 || themePackage.surfaces.some((surface) => surface !== "admin" && surface !== "public") ||
      new Set(themePackage.surfaces).size !== themePackage.surfaces.length) {
      throw new TypeError("Theme Package administration descriptor is invalid.");
    }
    const references = profiles.flatMap((profile) => profileReferences(profile, themePackage.id, themePackage.version));
    return Object.freeze({
      class: "package" as const,
      ...themePackage,
      surfaces: Object.freeze([...themePackage.surfaces]),
      references: Object.freeze(references),
      removal: references.length === 0 ? "available" as const : "blocked" as const
    });
  }).sort((left, right) => `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`));

  const actions = projectExtensionAdministrationActions(input.inventory, input.catalog);
  const catalogSkins = input.catalog.filter((record) => record.extension.deliveryClass === "theme-skin");
  const skinIds = new Set([...Object.keys(input.inventory.extensions.themeSkins), ...catalogSkins.map((record) => record.extension.id)]);
  const skins = [...skinIds].sort().map((id): SystemThemeSkinView => {
    const entry = input.inventory.extensions.themeSkins[id];
    const release = catalogSkins.filter((record) => record.extension.id === id).sort((left, right) => right.version.localeCompare(left.version))[0];
    const generation = entry?.disposition === "active" ? entry.activeGeneration
      : entry && "retainedGeneration" in entry ? entry.retainedGeneration : undefined;
    const version = generation?.version ?? release?.version;
    return Object.freeze({
      class: "skin",
      id,
      disposition: entry?.disposition ?? "available",
      ...(version ? { version } : {}),
      ...(generation ? { generationId: generation.generationId } : {}),
      actions: Object.freeze(actions.filter((action) => action.deliveryClass === "theme-skin" && action.id === id))
    });
  });

  return Object.freeze({ packages: Object.freeze(packages), skins: Object.freeze(skins), profiles: Object.freeze(profiles) });
}

function profileReferences(profile: SystemThemeProfileView, themeId: string, themeVersion: string): SystemThemeProfileReference[] {
  const references: SystemThemeProfileReference[] = [];
  for (const state of ["active", "previous", "draft"] as const) {
    const value = profile[state];
    if (value?.themeId === themeId && value.themeVersion === themeVersion) {
      references.push(Object.freeze({ profileId: profile.profileId, state, profileRevisionId: value.revision.id }));
    }
  }
  return references;
}
