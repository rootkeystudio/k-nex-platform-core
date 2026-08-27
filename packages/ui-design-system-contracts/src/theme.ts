import {
  ExactSemverSchema,
  PluginIdSchema,
  ThemeProfileSchema,
  type RuntimeSchema,
  type ThemeProfile,
  type ThemeProfileTokenValue
} from "@k-nex/contracts";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

import { semanticPrimitiveNames, type SemanticPrimitives } from "./types.js";
import { createSemanticPrimitives } from "./provider.js";

export type ThemeTokenValues = Readonly<Record<string, ThemeProfileTokenValue>>;
export const themeRootSelector = ":--k-nex-theme-root" as const;

export interface ThemePalette {
  readonly id: string;
  readonly values: ThemeTokenValues;
}

export interface ThemeProfileMigration {
  readonly from: number;
  readonly to: number;
  readonly migrate: (profile: ThemeProfile) => unknown;
}

export interface ThemePackage {
  readonly id: string;
  readonly version: string;
  readonly surfaces: readonly ("admin" | "public")[];
  readonly tokenSchema: RuntimeSchema<ThemeTokenValues>;
  readonly defaults: ThemeTokenValues;
  readonly palettes: readonly ThemePalette[];
  readonly recipes: Readonly<Partial<Record<keyof SemanticPrimitives, readonly string[]>>>;
  readonly structuralCss: string;
  readonly migrations: readonly ThemeProfileMigration[];
  readonly primitiveOverrides?: Partial<SemanticPrimitives>;
}

export interface ResolvedThemeProfile {
  readonly package: ThemePackage;
  readonly profile: ThemeProfile;
  readonly values: ThemeTokenValues;
}

export interface ThemePresentationSnapshot {
  readonly profileRevisionId: string;
  readonly themeId: string;
  readonly themeVersion: string;
  readonly surface: "admin" | "public";
  readonly mode: "light" | "dark" | "system";
  readonly cssVariables: Readonly<Record<string, string>>;
  readonly cssText: string;
  readonly primitives: SemanticPrimitives;
}

function cloneValues(values: ThemeTokenValues): ThemeTokenValues {
  return Object.freeze({ ...values });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function scopeStructuralCss(input: string): string {
  let root: ReturnType<typeof postcss.parse>;
  try {
    root = postcss.parse(input);
  } catch {
    throw new TypeError("Theme structural CSS must be valid CSS.");
  }
  root.walkAtRules((rule) => {
    if (rule.name !== "media" && rule.name !== "supports") throw new TypeError(`Theme structural CSS at-rule is not allowed: @${rule.name}.`);
  });
  let count = 0;
  const ownershipSuffix = `:where(:not(${themeRootSelector} [data-k-nex-theme-profile],${themeRootSelector} [data-k-nex-theme-profile] *))`;
  root.walkRules((rule) => {
    rule.selectors = rule.selectors.map((selector) => {
      let parsed: ReturnType<ReturnType<typeof selectorParser>["astSync"]>;
      try {
        parsed = selectorParser().astSync(selector);
      } catch {
        throw new TypeError(`Theme structural CSS selector is invalid: ${selector}.`);
      }
      const target = parsed.first;
      for (const node of [...target.nodes]) if (node.toString() === ownershipSuffix) target.removeChild(node);
      const first = target.first;
      const boundary = target.nodes[1];
      const selectsRoot = target.length === 1;
      const selectsDescendant = boundary?.type === "combinator" && (boundary.value === " " || boundary.value === ">");
      if (first?.type !== "pseudo" || first.value !== themeRootSelector || (!selectsRoot && !selectsDescendant)) {
        throw new TypeError(`Every theme structural CSS selector must select ${themeRootSelector} or its descendants; unscoped: ${selector}.`);
      }
      const ownership = selectorParser().astSync(ownershipSuffix).first.first;
      const pseudoElement = target.nodes.find((node) => node.type === "pseudo" && node.value.startsWith("::"));
      if (pseudoElement === undefined) target.append(ownership);
      else target.insertBefore(pseudoElement, ownership);
      count += 1;
      return parsed.toString();
    });
  });
  if (count === 0) throw new TypeError("Theme structural CSS requires at least one selector.");
  return root.toString();
}

function snapshotThemePackage(input: ThemePackage): ThemePackage {
  if (!PluginIdSchema.safeParse(input.id).success || !input.id.startsWith("theme.")) throw new TypeError("Theme package ID must use the theme.* namespace.");
  if (!ExactSemverSchema.safeParse(input.version).success) throw new TypeError("Theme package version must be exact semver.");
  if (input.surfaces.length === 0 || new Set(input.surfaces).size !== input.surfaces.length) throw new TypeError("Theme package surfaces must be non-empty and unique.");
  if (/(@import|url\s*\(|https?:\/\/|javascript:)/i.test(input.structuralCss)) throw new TypeError("Theme structural CSS cannot import or load remote content.");
  const structuralCss = scopeStructuralCss(input.structuralCss);
  const parse = input.tokenSchema.safeParse.bind(input.tokenSchema);
  const tokenSchema: RuntimeSchema<ThemeTokenValues> = Object.freeze({ safeParse: (value: unknown) => parse(value) });
  const defaults = cloneValues(input.defaults);
  if (!tokenSchema.safeParse(defaults).success) throw new TypeError("Theme defaults do not satisfy the package token schema.");
  const paletteIds = new Set<string>();
  const palettes = input.palettes.map((palette) => {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(palette.id) || paletteIds.has(palette.id)) throw new TypeError("Theme palette IDs must be unique canonical identifiers.");
    paletteIds.add(palette.id);
    const values = cloneValues(palette.values);
    if (!tokenSchema.safeParse({ ...defaults, ...values }).success) throw new TypeError(`Theme palette ${palette.id} does not satisfy the package token schema.`);
    return Object.freeze({ id: palette.id, values });
  });
  if (palettes.length === 0) throw new TypeError("Theme packages require at least one palette.");
  const recipes = Object.freeze(Object.fromEntries(Object.entries(input.recipes).map(([name, variants]) => {
    if (!(semanticPrimitiveNames as readonly string[]).includes(name)) throw new TypeError(`Unknown primitive recipe: ${name}.`);
    const snapshot = Object.freeze([...(variants ?? [])]);
    if (snapshot.length !== new Set(snapshot).size) throw new TypeError(`Primitive recipe variants must be unique: ${name}.`);
    return [name, snapshot];
  }))) as ThemePackage["recipes"];
  const migrations = Object.freeze(input.migrations.map((migration) => Object.freeze({
    from: migration.from,
    to: migration.to,
    migrate: (profile: ThemeProfile) => migration.migrate(profile)
  })));
  const primitiveOverrides = input.primitiveOverrides === undefined ? undefined : Object.freeze(Object.fromEntries(
    semanticPrimitiveNames.filter((name) => input.primitiveOverrides?.[name] !== undefined).map((name) => [name, input.primitiveOverrides![name]])
  )) as Partial<SemanticPrimitives>;
  return Object.freeze({
    id: input.id,
    version: input.version,
    surfaces: Object.freeze([...input.surfaces]),
    tokenSchema,
    defaults,
    palettes: Object.freeze(palettes),
    recipes,
    structuralCss,
    migrations,
    ...(primitiveOverrides === undefined ? {} : { primitiveOverrides })
  });
}

export function defineThemePackage(input: ThemePackage): ThemePackage {
  return snapshotThemePackage(input);
}

export function createThemeRegistry(inputs: readonly ThemePackage[]) {
  const packages = new Map<string, ThemePackage>();
  for (const input of inputs) {
    const snapshot = snapshotThemePackage(input);
    const key = `${snapshot.id}@${snapshot.version}`;
    if (packages.has(key)) throw new TypeError(`Duplicate theme package: ${key}.`);
    packages.set(key, snapshot);
  }
  return Object.freeze({
    get(id: string, version: string): ThemePackage | undefined {
      return packages.get(`${id}@${version}`);
    },
    resolveProfile(value: unknown): ResolvedThemeProfile {
      const profile = ThemeProfileSchema.parse(value);
      const themePackage = packages.get(`${profile.themeId}@${profile.themeVersion}`);
      if (themePackage === undefined) throw new TypeError(`Theme package is not installed: ${profile.themeId}@${profile.themeVersion}.`);
      if (!themePackage.surfaces.includes(profile.surface)) throw new TypeError(`Theme package does not support surface: ${profile.surface}.`);
      const palette = themePackage.palettes.find((candidate) => candidate.id === profile.palette);
      if (palette === undefined) throw new TypeError(`Theme palette is not installed: ${profile.palette}.`);
      const result = themePackage.tokenSchema.safeParse({ ...themePackage.defaults, ...palette.values, ...profile.values });
      if (!result.success) throw new TypeError("Theme profile values do not satisfy the installed package schema.");
      return Object.freeze({ package: themePackage, profile: deepFreeze(structuredClone(profile)), values: cloneValues(result.data) });
    }
  });
}

export function createThemePresentation(resolved: ResolvedThemeProfile): ThemePresentationSnapshot {
  const prefix = `--k-nex-${resolved.profile.surface}-`;
  const cssVariables = Object.freeze(Object.fromEntries(Object.entries(resolved.values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [
      `${prefix}${key.replaceAll(".", "-")}`,
      typeof value === "boolean" ? value ? "1" : "0" : String(value)
    ])));
  const declarations = Object.entries(cssVariables).map(([name, value]) => `${name}:${value}`).join(";");
  const selector = `[data-k-nex-theme-profile="${resolved.profile.revision.id}"]`;
  return Object.freeze({
    profileRevisionId: resolved.profile.revision.id,
    themeId: resolved.profile.themeId,
    themeVersion: resolved.profile.themeVersion,
    surface: resolved.profile.surface,
    mode: resolved.profile.mode,
    cssVariables,
    cssText: `${selector}{${declarations}}${resolved.package.structuralCss.replaceAll(themeRootSelector, selector)}`,
    primitives: createSemanticPrimitives(resolved.package.primitiveOverrides)
  });
}
