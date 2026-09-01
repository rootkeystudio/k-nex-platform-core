import { assertSafeThemeSkinSvg, canonicalJson, ResourceIdSchema, ThemeSkinManifestSchema, ThemeSkinProfileSelectionSchema, type ThemeSkinManifest, type ThemeSkinProfileSelection } from "@k-nex/contracts";
import postcss from "postcss";

import { scopeThemeCss, themeRootSelector } from "./theme-css.js";

const recordId = /^[a-z][a-z0-9-]{2,127}$/u;
const digest = /^sha256:[0-9a-f]{64}$/u;
const allowedFunctions = new Set(["var"]);
const allowedProperties = new Set([
  "background", "background-color", "border", "border-color", "border-radius", "border-style", "border-width",
  "color", "font-weight", "gap", "letter-spacing", "padding", "padding-block", "padding-inline",
  "text-align", "text-decoration", "text-transform", "transition-duration"
]);
const requiredTokens = ["--k-nex-skin-color-background", "--k-nex-skin-color-foreground", "--k-nex-skin-color-accent", "--k-nex-skin-focus-ring", "--k-nex-skin-motion-duration"] as const;
const safeCssValue = /^[A-Za-z0-9#%(),.+\-*/: ]+$/u;
const hostAccessibilityCss = `@media (prefers-reduced-motion: reduce){${themeRootSelector},${themeRootSelector} *,${themeRootSelector} *::before,${themeRootSelector} *::after{transition-duration:0ms!important}}\n${themeRootSelector} [data-focus-visible],${themeRootSelector} :focus-visible{outline:3px solid var(--k-nex-skin-focus-ring)!important;outline-offset:2px!important}\n@media (forced-colors: active){${themeRootSelector} [data-k-nex-primitive]{border-color:CanvasText!important;outline-color:CanvasText!important}${themeRootSelector} [data-focus-visible],${themeRootSelector} :focus-visible{outline:3px solid CanvasText!important;outline-offset:2px!important}}`;

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
  if (contrast(tokens["--k-nex-skin-color-foreground"]!, tokens["--k-nex-skin-color-background"]!) < 4.5) throw new TypeError(`Theme Skin palette ${palette} has insufficient text contrast.`);
  if (contrast(tokens["--k-nex-skin-color-accent"]!, tokens["--k-nex-skin-color-background"]!) < 3) throw new TypeError(`Theme Skin palette ${palette} has insufficient accent contrast.`);
  if (contrast(tokens["--k-nex-skin-color-foreground"]!, tokens["--k-nex-skin-color-accent"]!) < 4.5) throw new TypeError(`Theme Skin palette ${palette} has insufficient foreground-on-accent contrast.`);
  if (contrast(tokens["--k-nex-skin-focus-ring"]!, tokens["--k-nex-skin-color-background"]!) < 3) throw new TypeError(`Theme Skin palette ${palette} has insufficient focus contrast.`);
  if (contrast(tokens["--k-nex-skin-focus-ring"]!, tokens["--k-nex-skin-color-accent"]!) < 3) throw new TypeError(`Theme Skin palette ${palette} has insufficient focus-on-accent contrast.`);
  if (!/^(?:0|[1-9]\d{0,3})ms$/u.test(tokens["--k-nex-skin-motion-duration"]!)) throw new TypeError(`Theme Skin palette ${palette} has an invalid motion duration.`);
}

function assetHandle(manifest: ThemeSkinManifest, generationId: string, path: string, assetDigest: string): string {
  return `/api/extensions/skins/${manifest.id}/assets/${generationId}/${assetDigest}/${path.slice("assets/".length)}`;
}

function assertSafeCssValue(value: string, declaredTokens: ReadonlySet<string>): void {
  if (!safeCssValue.test(value) || value.includes("//") || /(?:\\|\/\*|\*\/|@import|(?:javascript|https?|data):)/iu.test(value)) {
    throw new TypeError("Theme Skin CSS value is not a closed safe value.");
  }
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")" && --depth < 0) throw new TypeError("Theme Skin CSS value has unbalanced functions.");
  }
  if (depth !== 0) throw new TypeError("Theme Skin CSS value has unbalanced functions.");
  for (const match of value.matchAll(/([a-z-]+)\(/giu)) {
    if (!allowedFunctions.has(match[1]!.toLowerCase())) throw new TypeError(`Theme Skin CSS function is forbidden: ${match[1]}.`);
  }
  const variables = [...value.matchAll(/var\(([^()]*)\)/giu)];
  if (variables.length !== [...value.matchAll(/var\(/giu)].length) throw new TypeError("Theme Skin CSS variables cannot be nested.");
  for (const match of variables) {
    if (!/^--k-nex-skin-[a-z0-9-]{1,75}$/u.test(match[1]!) || !declaredTokens.has(match[1]!)) throw new TypeError("Theme Skin CSS variables must reference declared tokens directly.");
  }
}

function assertDeclaration(declaration: postcss.Declaration, declaredTokens: ReadonlySet<string>): void {
  if (!allowedProperties.has(declaration.prop)) throw new TypeError(`Theme Skin property is forbidden: ${declaration.prop}.`);
  if (declaration.important) throw new TypeError("Theme Skin CSS cannot use !important.");
  assertSafeCssValue(declaration.value, declaredTokens);
  if (declaration.prop === "transition-duration" && declaration.value !== "var(--k-nex-skin-motion-duration)") throw new TypeError("Theme Skin transitions must use the validated motion token.");
  if (declaration.prop === "color" && declaration.value !== "var(--k-nex-skin-color-foreground)") throw new TypeError("Theme Skin text color must use the validated foreground token.");
  if (["background", "background-color"].includes(declaration.prop) && !/^var\(--k-nex-skin-color-(?:background|accent)\)$/u.test(declaration.value)) {
    throw new TypeError("Theme Skin backgrounds must use validated color tokens.");
  }
  if (declaration.prop === "border" && !/^[1-9]\d?px (?:solid|dashed) var\(--k-nex-skin-color-(?:foreground|accent)\)$/u.test(declaration.value)) throw new TypeError("Theme Skin borders must use validated color tokens.");
  if (declaration.prop === "border-style" && !/^(?:solid|dashed)$/u.test(declaration.value)) throw new TypeError("Theme Skin borders must remain visible.");
  if (declaration.prop === "border-width" && !/^[1-9]\d?px$/u.test(declaration.value)) throw new TypeError("Theme Skin borders must remain visible.");
  if (declaration.prop === "border-color" && !/^var\(--k-nex-skin-color-(?:foreground|accent)\)$/u.test(declaration.value)) throw new TypeError("Theme Skin border color must use a validated color token.");
  const pixel = "(?:0|[1-9]\\d?)px";
  const box = new RegExp(`^${pixel}(?: ${pixel}){0,3}$`, "u");
  if (["padding", "padding-block", "padding-inline"].includes(declaration.prop) && !box.test(declaration.value)) throw new TypeError("Theme Skin padding must be a bounded literal.");
  if (declaration.prop === "gap" && !new RegExp(`^${pixel}$`, "u").test(declaration.value)) throw new TypeError("Theme Skin gap must be a bounded literal.");
  if (declaration.prop === "border-radius" && !/^(?:0|[1-9]\d?)px$/u.test(declaration.value) && !/^(?:[1-9]\d?|100)%$/u.test(declaration.value)) throw new TypeError("Theme Skin border radius must be bounded.");
  if (declaration.prop === "letter-spacing" && !/^(?:0|[1-9]\d?)px$/u.test(declaration.value)) throw new TypeError("Theme Skin letter spacing must be bounded.");
  if (declaration.prop === "font-weight" && !/^(?:400|500|600|700)$/u.test(declaration.value)) throw new TypeError("Theme Skin font weight is forbidden.");
  if (declaration.prop === "text-align" && !/^(?:start|center|end)$/u.test(declaration.value)) throw new TypeError("Theme Skin text alignment is forbidden.");
  if (declaration.prop === "text-decoration" && declaration.value !== "underline") throw new TypeError("Theme Skin text decoration cannot remove affordances.");
  if (declaration.prop === "text-transform" && !/^(?:none|uppercase|lowercase)$/u.test(declaration.value)) throw new TypeError("Theme Skin text transform is forbidden.");
}

function compileCss(manifest: ThemeSkinManifest, stylesheets: Readonly<Record<string, string>>): string {
  if (canonicalJson(Object.keys(stylesheets).sort()) !== canonicalJson([...manifest.stylesheets].sort())) throw new TypeError("Theme Skin stylesheet inventory differs from its manifest.");
  const source = manifest.stylesheets.map((path) => stylesheets[path]!).join("\n");
  if (new TextEncoder().encode(source).byteLength > manifest.resourceBudget.maxCssBytes) throw new TypeError("Theme Skin CSS exceeds maxCssBytes.");
  if (/(?:\\|\/\*|\*\/)/u.test(source)) throw new TypeError("Theme Skin CSS contains an escaped or declaration-breaking token.");
  let root: postcss.Root;
  try { root = postcss.parse(source); } catch { throw new TypeError("Theme Skin CSS is invalid."); }
  const declaredTokens = new Set(Object.keys(manifest.tokens));
  let rules = 0; let declarations = 0; let selectors = 0;
  root.walkComments(() => { throw new TypeError("Theme Skin CSS comments are forbidden."); });
  root.walkAtRules((rule) => {
    if (rule.name !== "media" || rule.parent?.type !== "root") throw new TypeError(`Theme Skin at-rule is forbidden: @${rule.name}.`);
    if (rule.name === "media" && !/^(?:\((?:prefers-reduced-motion|forced-colors|prefers-color-scheme|min-width|max-width): [A-Za-z0-9 .-]+\))(?: and \((?:min-width|max-width): [A-Za-z0-9 .-]+\))*$/u.test(rule.params)) {
      throw new TypeError(`Theme Skin media query is forbidden: ${rule.params}.`);
    }
    if (rule.params === "(prefers-reduced-motion: reduce)" || rule.params === "(forced-colors: active)") throw new TypeError("Theme Skin CSS cannot redefine host accessibility guards.");
    if (/(?:\\|\/\*|\*\/|url|import|selector|(?:javascript|https?|data):)/iu.test(rule.params)) throw new TypeError("Theme Skin conditional CSS contains a forbidden function.");
  });
  root.walkRules((rule) => {
    if (/::|:(?:before|after|first-letter|first-line)(?![a-z-])/iu.test(rule.selector)) throw new TypeError("Theme Skin CSS cannot target pseudo-elements.");
    rules += 1; selectors += rule.selectors.length;
  });
  root.walkDecls((declaration) => {
    declarations += 1;
    assertDeclaration(declaration, declaredTokens);
  });
  if (rules > 512 || selectors > 1024 || declarations > 2048) throw new TypeError("Theme Skin CSS exceeds its rule complexity budget.");
  const rewritten = root.toString();
  if (/asset\s*\(/iu.test(rewritten)) throw new TypeError("Theme Skin CSS cannot place assets in CSS.");
  const scoped = scopeThemeCss(rewritten);
  const finalRoot = postcss.parse(scoped);
  finalRoot.walkComments(() => { throw new TypeError("Generated Theme Skin CSS contains a comment."); });
  finalRoot.walkDecls((declaration) => assertDeclaration(declaration, declaredTokens));
  return `${scoped}${scopeThemeCss(hostAccessibilityCss)}`;
}

export function createThemeSkinGeneration(input: ThemeSkinGenerationInput): ThemeSkinGeneration {
  const manifest = ThemeSkinManifestSchema.parse(input.manifest);
  if (!recordId.test(input.generationId)) throw new TypeError("Theme Skin generation identity is invalid.");
  for (const [palette, values] of Object.entries(manifest.palettes)) {
    if (Object.keys(values).some((token) => !Object.hasOwn(manifest.tokens, token))) throw new TypeError(`Theme Skin palette ${palette} declares an unknown token.`);
    assertAccessibleTokens({ ...manifest.tokens, ...values }, palette);
  }
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
  const scopedCss = compileCss(manifest, input.stylesheets);
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
