import { assertSafeThemeSkinSvg, canonicalJson, ResourceIdSchema, ThemeSkinManifestSchema, ThemeSkinProfileSelectionSchema, type ThemeSkinManifest, type ThemeSkinProfileSelection } from "@k-nex/contracts";
import postcss from "postcss";

import { scopeThemeCss, themeRootSelector } from "./theme-css.js";

const recordId = /^[a-z][a-z0-9-]{2,127}$/u;
const digest = /^sha256:[0-9a-f]{64}$/u;
const assetCall = /asset\("(assets\/[A-Za-z0-9._/-]+)"\)/gu;
const forbiddenCss = /(?:@import|javascript:|expression\s*\(|behavior\s*:|url\s*\(|https?:|data:)/iu;
const allowedFunctions = new Set(["asset", "calc", "clamp", "hsl", "hsla", "linear-gradient", "max", "min", "rgb", "rgba", "var"]);
const allowedProperties = new Set([
  "align-items", "background", "background-color", "background-image", "border", "border-color", "border-radius", "border-style", "border-width",
  "box-shadow", "color", "display", "flex-direction", "font-size", "font-weight", "gap", "grid-template-columns", "height",
  "justify-content", "letter-spacing", "line-height", "margin", "margin-block", "margin-inline", "max-height", "max-width", "min-height", "min-width",
  "opacity", "outline", "outline-color", "outline-offset", "outline-style", "outline-width", "padding", "padding-block", "padding-inline",
  "text-align", "text-decoration", "text-transform", "transform", "transition", "transition-duration", "width"
]);
const requiredTokens = ["--k-nex-color-background", "--k-nex-color-foreground", "--k-nex-color-accent", "--k-nex-focus-ring", "--k-nex-motion-duration"] as const;

export interface ThemeSkinAsset {
  readonly digest: string;
  readonly contentType: "image/svg+xml";
  readonly bytes: Uint8Array;
}

export interface ThemeSkinGenerationInput {
  readonly manifest: unknown;
  readonly generationId: string;
  readonly stylesheets: Readonly<Record<string, string>>;
  readonly assets: Readonly<Record<string, ThemeSkinAsset>>;
}

export interface ThemeSkinGeneration {
  readonly manifest: ThemeSkinManifest;
  readonly generationId: string;
  readonly scopedCss: string;
  readonly assetHandles: Readonly<Record<string, string>>;
}

export interface ResolvedThemeSkin {
  readonly generation: ThemeSkinGeneration;
  readonly selection: ThemeSkinProfileSelection;
  readonly tokens: Readonly<Record<string, string>>;
}

export interface ThemeSkinRegistry {
  resolve(value: unknown): ResolvedThemeSkin;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function color(value: string): readonly [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/iu.exec(value);
  if (!match) return undefined;
  const hex = match[1]!;
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function luminance(rgb: readonly [number, number, number]): number {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(left: string, right: string): number {
  const leftColor = color(left); const rightColor = color(right);
  if (!leftColor || !rightColor) return 0;
  const [bright, dark] = [luminance(leftColor), luminance(rightColor)].sort((a, b) => b - a);
  return (bright! + 0.05) / (dark! + 0.05);
}

function assertAccessibleTokens(tokens: Readonly<Record<string, string>>, palette: string): void {
  if (requiredTokens.some((token) => tokens[token] === undefined)) throw new TypeError(`Theme Skin palette ${palette} is missing required accessibility tokens.`);
  if (contrast(tokens["--k-nex-color-foreground"]!, tokens["--k-nex-color-background"]!) < 4.5) throw new TypeError(`Theme Skin palette ${palette} has insufficient text contrast.`);
  if (contrast(tokens["--k-nex-color-accent"]!, tokens["--k-nex-color-background"]!) < 3) throw new TypeError(`Theme Skin palette ${palette} has insufficient accent contrast.`);
  if (contrast(tokens["--k-nex-focus-ring"]!, tokens["--k-nex-color-background"]!) < 3) throw new TypeError(`Theme Skin palette ${palette} has insufficient focus contrast.`);
  if (!/^(?:0|[1-9]\d{0,3})ms$/u.test(tokens["--k-nex-motion-duration"]!)) throw new TypeError(`Theme Skin palette ${palette} has an invalid motion duration.`);
}

function assetHandle(manifest: ThemeSkinManifest, generationId: string, path: string, assetDigest: string): string {
  return `/api/extensions/skins/${manifest.id}/assets/${generationId}/${assetDigest}/${path.slice("assets/".length)}`;
}

function insideMedia(declaration: postcss.Declaration, params: string): boolean {
  let node = declaration.parent as postcss.Node | undefined;
  while (node) {
    if (node.type === "atrule") {
      const atRule = node as postcss.AtRule;
      if (atRule.name === "media" && atRule.params === params) return true;
    }
    node = node.parent as postcss.Node | undefined;
  }
  return false;
}

function compileCss(manifest: ThemeSkinManifest, stylesheets: Readonly<Record<string, string>>, handles: Readonly<Record<string, string>>): string {
  if (canonicalJson(Object.keys(stylesheets).sort()) !== canonicalJson([...manifest.stylesheets].sort())) throw new TypeError("Theme Skin stylesheet inventory differs from its manifest.");
  const source = manifest.stylesheets.map((path) => stylesheets[path]!).join("\n");
  if (new TextEncoder().encode(source).byteLength > manifest.resourceBudget.maxCssBytes) throw new TypeError("Theme Skin CSS exceeds maxCssBytes.");
  if (forbiddenCss.test(source)) throw new TypeError("Theme Skin CSS contains a remote or executable construct.");
  const root = postcss.parse(source);
  let rules = 0; let declarations = 0; let selectors = 0;
  let reducedMotion = false; let forcedColors = false; let visibleFocus = false;
  root.walkAtRules((rule) => {
    if (rule.name !== "media" && rule.name !== "supports") throw new TypeError(`Theme Skin at-rule is forbidden: @${rule.name}.`);
    if (rule.name === "media" && !/^(?:\((?:prefers-reduced-motion|forced-colors|prefers-color-scheme|min-width|max-width): [A-Za-z0-9 .-]+\))(?: and \((?:min-width|max-width): [A-Za-z0-9 .-]+\))*$/u.test(rule.params)) {
      throw new TypeError(`Theme Skin media query is forbidden: ${rule.params}.`);
    }
    if (/url|import|selector/iu.test(rule.params)) throw new TypeError("Theme Skin conditional CSS contains a forbidden function.");
  });
  root.walkRules((rule) => { rules += 1; selectors += rule.selectors.length; });
  root.walkDecls((declaration) => {
    declarations += 1;
    if (!declaration.prop.startsWith("--k-nex-") && !allowedProperties.has(declaration.prop)) throw new TypeError(`Theme Skin property is forbidden: ${declaration.prop}.`);
    for (const match of declaration.value.matchAll(/([a-z-]+)\(/giu)) if (!allowedFunctions.has(match[1]!.toLowerCase())) throw new TypeError(`Theme Skin CSS function is forbidden: ${match[1]}.`);
    const rule = declaration.parent?.type === "rule" ? declaration.parent : undefined;
    if (declaration.prop === "transition-duration" && declaration.value === "0ms" && declaration.important && insideMedia(declaration, "(prefers-reduced-motion: reduce)")) reducedMotion = true;
    if (["border-color", "outline", "outline-color"].includes(declaration.prop) && /\bCanvasText\b/u.test(declaration.value) && insideMedia(declaration, "(forced-colors: active)")) forcedColors = true;
    if (rule && /(?:\[data-focus-visible\]|:focus-visible)/u.test(rule.selector) && ["outline", "outline-color"].includes(declaration.prop) && declaration.value !== "none") visibleFocus = true;
  });
  if (rules > 512 || selectors > 1024 || declarations > 2048) throw new TypeError("Theme Skin CSS exceeds its rule complexity budget.");
  if (!reducedMotion) throw new TypeError("Theme Skin CSS must preserve reduced motion.");
  if (!forcedColors) throw new TypeError("Theme Skin CSS must preserve forced colors.");
  if (!visibleFocus) throw new TypeError("Theme Skin CSS must preserve a visible focus indicator.");
  const rewritten = root.toString().replace(assetCall, (_match, path: string) => {
    const handle = handles[path];
    if (!handle) throw new TypeError(`Theme Skin CSS references an undeclared asset: ${path}.`);
    return `url("${handle}")`;
  });
  if (/asset\s*\(/iu.test(rewritten)) throw new TypeError("Theme Skin CSS contains a malformed asset reference.");
  return scopeThemeCss(rewritten);
}

export function createThemeSkinGeneration(input: ThemeSkinGenerationInput): ThemeSkinGeneration {
  const manifest = ThemeSkinManifestSchema.parse(input.manifest);
  if (!recordId.test(input.generationId)) throw new TypeError("Theme Skin generation identity is invalid.");
  for (const palette of Object.keys(manifest.palettes)) assertAccessibleTokens({ ...manifest.tokens, ...manifest.palettes[palette] }, palette);
  const declaredAssets = new Map(manifest.assets.map((asset) => [asset.path, asset.digest]));
  if (canonicalJson([...declaredAssets.keys()].sort()) !== canonicalJson(Object.keys(input.assets).sort())) throw new TypeError("Theme Skin asset inventory differs from its manifest.");
  let assetBytes = 0;
  const handles: Record<string, string> = {};
  for (const [path, asset] of Object.entries(input.assets)) {
    const expected = declaredAssets.get(path);
    assetBytes += asset.bytes.byteLength;
    if (!expected || asset.digest !== expected || !digest.test(asset.digest) || asset.contentType !== "image/svg+xml" || !path.endsWith(".svg")) throw new TypeError(`Theme Skin asset is invalid: ${path}.`);
    try { assertSafeThemeSkinSvg(asset.bytes); } catch { throw new TypeError(`Theme Skin SVG contains executable or remote content: ${path}.`); }
    handles[path] = assetHandle(manifest, input.generationId, path, asset.digest);
  }
  if (assetBytes > manifest.resourceBudget.maxAssetBytes) throw new TypeError("Theme Skin assets exceed maxAssetBytes.");
  const scopedCss = compileCss(manifest, input.stylesheets, handles);
  return deepFreeze({ manifest: structuredClone(manifest), generationId: input.generationId, scopedCss, assetHandles: handles });
}

export function createThemeSkinRegistry(generations: readonly ThemeSkinGeneration[]): ThemeSkinRegistry {
  const registry = new Map<string, ThemeSkinGeneration>();
  for (const generation of generations) {
    const key = `${generation.manifest.id}@${generation.manifest.version}#${generation.generationId}`;
    if (registry.has(key)) throw new TypeError(`Duplicate Theme Skin generation: ${key}.`);
    registry.set(key, generation);
  }
  return Object.freeze({
    resolve(value: unknown): ResolvedThemeSkin {
      const selection = ThemeSkinProfileSelectionSchema.parse(value);
      const generation = registry.get(`${selection.id}@${selection.version}#${selection.generationId}`);
      if (!generation) throw new TypeError("Theme Skin generation is not active or retained.");
      const palette = generation.manifest.palettes[selection.palette];
      if (!palette) throw new TypeError(`Theme Skin palette is unavailable: ${selection.palette}.`);
      const values = migrateThemeSkinValues(generation.manifest, selection.values, 1, generation.manifest.profileCompatibility.schemaVersion);
      if (Object.keys(values).some((token) => !Object.hasOwn(generation.manifest.tokens, token))) throw new TypeError("Theme Skin profile overrides an undeclared token.");
      const tokens = Object.freeze({ ...generation.manifest.tokens, ...palette, ...values });
      assertAccessibleTokens(tokens, selection.palette);
      return deepFreeze({ generation, selection: { ...structuredClone(selection), values }, tokens });
    }
  });
}

export function migrateThemeSkinValues(
  manifest: ThemeSkinManifest,
  input: Readonly<Record<string, string>>,
  fromSchemaVersion: number,
  toSchemaVersion: number
): Readonly<Record<string, string>> {
  if (!Number.isSafeInteger(fromSchemaVersion) || !Number.isSafeInteger(toSchemaVersion) || fromSchemaVersion < 1 || toSchemaVersion < fromSchemaVersion) {
    throw new TypeError("Theme Skin profile migration bounds are invalid.");
  }
  let version = fromSchemaVersion;
  let values = { ...input };
  const used = new Set<string>();
  while (version < toSchemaVersion) {
    const migration = manifest.profileMigrations.find((candidate) => candidate.fromSchemaVersion === version && !used.has(`${candidate.fromSchemaVersion}:${candidate.toSchemaVersion}`));
    if (!migration || migration.toSchemaVersion <= version || migration.toSchemaVersion > toSchemaVersion) throw new TypeError("Theme Skin profile migration path is incomplete.");
    for (const rename of migration.renames) {
      if (!Object.hasOwn(values, rename.from)) continue;
      if (Object.hasOwn(values, rename.to)) throw new TypeError(`Theme Skin profile migration collides at ${rename.to}.`);
      values[rename.to] = values[rename.from]!;
      delete values[rename.from];
    }
    used.add(`${migration.fromSchemaVersion}:${migration.toSchemaVersion}`);
    version = migration.toSchemaVersion;
  }
  return Object.freeze(values);
}

export function createThemeSkinCss(resolved: ResolvedThemeSkin, profileRevisionId: string): string {
  if (!ResourceIdSchema.safeParse(profileRevisionId).success) throw new TypeError("Theme profile revision identity is invalid.");
  const selector = `[data-k-nex-theme-profile="${profileRevisionId}"]`;
  const declarations = Object.entries(resolved.tokens).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${name}:${value}`).join(";");
  return `${selector}{${declarations}}${resolved.generation.scopedCss.replaceAll(themeRootSelector, selector)}`;
}
