import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

export const themeRootSelector = ":--k-nex-theme-root" as const;

export function scopeThemeCss(input: string): string {
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
