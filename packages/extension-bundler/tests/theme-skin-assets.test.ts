import { describe, expect, it } from "vitest";

import { sha256, VerifiedThemeSkinAssetService, type ThemeSkinAssetRequest } from "../src/index.js";

const body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h4v4H0z"/></svg>');
const fileDigest = sha256(body);
const artifactDigest = `sha256:${"a".repeat(64)}` as const;
const manifest = {
  deliveryClass: "theme-skin", id: "skin.neobrutalism",
  files: { "assets/grid.svg": { digest: fileDigest, bytes: body.byteLength, contentType: "image/svg+xml" } }
};
const staged = { artifactDigest, verified: { artifactDigest, manifest, files: new Map([["assets/grid.svg", body]]) } } as any;
const request: ThemeSkinAssetRequest = {
  applicationId: "customer-alpha", environment: "production", skinId: "skin.neobrutalism", generationId: "skin-generation-1",
  artifactDigest, fileDigest, path: "assets/grid.svg"
};

describe("verified Theme Skin assets", () => {
  it("serves only generation-pinned verified SVG bytes with immutable headers", async () => {
    const response = await new VerifiedThemeSkinAssetService({ readThemeSkin: async () => staged }, { isAvailable: async () => true }).read(request);
    expect(Buffer.from(response.body)).toEqual(body);
    expect(response.headers).toMatchObject({
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "image/svg+xml",
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff"
    });
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("rejects unavailable generations, traversal, digest mismatch, executable SVG, and unverified artifacts", async () => {
    await expect(new VerifiedThemeSkinAssetService({ readThemeSkin: async () => staged }, { isAvailable: async () => false }).read(request)).rejects.toMatchObject({ code: "GENERATION_UNAVAILABLE" });
    const service = new VerifiedThemeSkinAssetService({ readThemeSkin: async () => staged }, { isAvailable: async () => true });
    await expect(service.read({ ...request, path: "assets/../secret.svg" })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    await expect(service.read({ ...request, fileDigest: `sha256:${"b".repeat(64)}` })).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    const unsafe = Buffer.from("<svg><script>alert(1)</script></svg>");
    const unsafeDigest = sha256(unsafe);
    const unsafeStaged = { ...staged, verified: { ...staged.verified, manifest: { ...manifest, files: { "assets/grid.svg": { ...manifest.files["assets/grid.svg"], digest: unsafeDigest, bytes: unsafe.byteLength } } }, files: new Map([["assets/grid.svg", unsafe]]) } };
    await expect(new VerifiedThemeSkinAssetService({ readThemeSkin: async () => unsafeStaged }, { isAvailable: async () => true }).read({ ...request, fileDigest: unsafeDigest })).rejects.toMatchObject({ code: "ASSET_UNSAFE" });
    await expect(new VerifiedThemeSkinAssetService({ readThemeSkin: async () => undefined }, { isAvailable: async () => true }).read(request)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
  });

  it("rejects bytes that no longer match verified metadata", async () => {
    const byteMismatch = { ...staged, verified: { ...staged.verified, manifest: { ...manifest, files: { "assets/grid.svg": { ...manifest.files["assets/grid.svg"], bytes: body.byteLength + 1 } } } } };
    await expect(new VerifiedThemeSkinAssetService({ readThemeSkin: async () => byteMismatch }, { isAvailable: async () => true }).read(request)).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
  });

  it.each([
    '<svg><use href="//evil.test/icon.svg#x"/></svg>',
    '<svg><use href="/assets/icon.svg#x"/></svg>',
    '<svg><style>@import url("https://evil.test/theme.css");</style></svg>',
    '<svg><path style="fill:url(https://evil.test/payload)"/></svg>',
    '<svg><path fill="&#117;&#114;&#108;&#40;&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;&#101;&#118;&#105;&#108;&#46;&#116;&#101;&#115;&#116;&#47;&#112;&#97;&#121;&#108;&#111;&#97;&#100;&#41;"/></svg>',
    '<svg><path fill="\\75\\72\\6c(\\68\\74\\74\\70\\73\\3a\\2f\\2f\\65\\76\\69\\6c\\2e\\74\\65\\73\\74\\2f\\70\\61\\79\\6c\\6f\\61\\64)"/></svg>',
    '<svg><path mask="image-set(\'https://evil.test/payload.svg\' 1x)"/></svg>'
  ])("rejects SVG network references while serving: %s", async (unsafe) => {
    const unsafeBytes = Buffer.from(unsafe);
    const unsafeDigest = sha256(unsafeBytes);
    const unsafeStaged = { ...staged, verified: { ...staged.verified, manifest: { ...manifest, files: { "assets/grid.svg": { ...manifest.files["assets/grid.svg"], digest: unsafeDigest, bytes: unsafeBytes.byteLength } } }, files: new Map([["assets/grid.svg", unsafeBytes]]) } };
    await expect(new VerifiedThemeSkinAssetService({ readThemeSkin: async () => unsafeStaged }, { isAvailable: async () => true }).read({ ...request, fileDigest: unsafeDigest })).rejects.toMatchObject({ code: "ASSET_UNSAFE" });
  });
});
