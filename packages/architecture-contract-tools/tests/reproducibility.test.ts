import { describe, expect, it } from "vitest";

import { contentDigest, firstDifference, proveReproducibility } from "../src/reproducibility.js";

describe("P0.5 contract generation reproducibility", () => {
  it("produces byte-identical output trees under controlled path and environment differences", async () => {
    await expect(proveReproducibility()).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it("computes an ordering-independent diagnostic digest", () => {
    const first = new Map<string, Uint8Array>([["b.json", Buffer.from("b")], ["a.json", Buffer.from("a")]]);
    const second = new Map<string, Uint8Array>([["a.json", Buffer.from("a")], ["b.json", Buffer.from("b")]]);
    expect(contentDigest(first)).toBe(contentDigest(second));
  });

  it("reports the first differing file and line", () => {
    const difference = firstDifference(
      new Map([["artifact.json", Buffer.from("one\ntwo\n")]]),
      new Map([["artifact.json", Buffer.from("one\nchanged\n")]])
    );
    expect(difference).toBe("artifact.json:2\n- two\n+ changed");
  });
});
