const elements = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "title", "desc"]);
const attributes = new Set(["xmlns", "viewBox", "width", "height", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity", "transform", "d", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "rx", "ry", "r", "points", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "clip-path", "mask", "id", "href"]);
const names = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/u;
const attributesPattern = /\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("[^"]*"|'[^']*')/gu;

/** Validates the deliberately small, data-only SVG subset accepted by Theme Skins. */
export function assertSafeThemeSkinSvg(bytes: Uint8Array): void {
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new TypeError("Theme Skin SVG must be valid UTF-8."); }
  if (/<!|<\?|<\/(?![A-Za-z])|\b(?:script|style|foreignObject)\b|\bon[a-z]+\s*=/iu.test(source)) throw new TypeError("Theme Skin SVG contains executable content.");
  const tags = source.match(/<[^>]*>/gu);
  if (!tags || tags.length === 0 || !/^\s*<svg\b/u.test(source)) throw new TypeError("Theme Skin SVG must have an SVG root.");
  let depth = 0;
  for (const tag of tags) {
    const closing = /^<\//u.test(tag);
    const match = /^<\/?([A-Za-z_:][A-Za-z0-9_.:-]*)([\s\S]*?)\/?\s*>$/u.exec(tag);
    if (!match || !names.test(match[1]!) || !elements.has(match[1]!)) throw new TypeError("Theme Skin SVG contains a forbidden element.");
    if (closing) { if (--depth < 0) throw new TypeError("Theme Skin SVG is malformed."); continue; }
    const body = match[2]!;
    let consumed = "";
    for (const attribute of body.matchAll(attributesPattern)) {
      const name = attribute[1]!;
      const value = attribute[2]!.slice(1, -1);
      consumed += attribute[0]!;
      if (!attributes.has(name) || name === "style" || /^on/iu.test(name)) throw new TypeError("Theme Skin SVG contains a forbidden attribute.");
      if (name === "xmlns" ? value !== "http://www.w3.org/2000/svg" : name === "href" ? !/^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(value) : /(?:https?:|\/\/|data:|javascript:|@import|url\s*\()/iu.test(value)) throw new TypeError("Theme Skin SVG contains a remote reference.");
    }
    if (body.replace(attributesPattern, "").trim() !== "") throw new TypeError("Theme Skin SVG has malformed attributes.");
    if (!/\/>$/u.test(tag)) depth += 1;
  }
  if (depth !== 0) throw new TypeError("Theme Skin SVG is malformed.");
}
