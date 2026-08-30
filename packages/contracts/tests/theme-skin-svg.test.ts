import { describe, expect, it } from "vitest";

import { assertSafeThemeSkinSvg } from "../src/index.js";

const bytes = (svg: string) => new TextEncoder().encode(svg);

describe("Theme Skin SVG validation", () => {
  it("accepts the supported data-only SVG subset", () => {
    expect(() => assertSafeThemeSkinSvg(bytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h4v4H0z" fill="#000"/></svg>'))).not.toThrow();
  });

  it.each([
    '<svg><path fill="&#117;&#114;&#108;&#40;&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;&#101;&#118;&#105;&#108;&#46;&#116;&#101;&#115;&#116;&#47;&#112;&#97;&#121;&#108;&#111;&#97;&#100;&#41;"/></svg>',
    '<svg><path fill="\\75\\72\\6c(\\68\\74\\74\\70\\73\\3a\\2f\\2f\\65\\76\\69\\6c\\2e\\74\\65\\73\\74\\2f\\70\\61\\79\\6c\\6f\\61\\64)"/></svg>'
  ])("rejects encoded remote references before attribute parsing", (svg) => {
    expect(() => assertSafeThemeSkinSvg(bytes(svg))).toThrow(/encoded content/);
  });

  it("rejects the network-capable SVG mask surface", () => {
    expect(() => assertSafeThemeSkinSvg(bytes('<svg><path mask="image-set(\'https://evil.test/payload.svg\' 1x)"/></svg>'))).toThrow(/forbidden attribute/);
  });
});
