import type { ExtensionBundleManifest } from "@k-nex/contracts";

function fail(message: string): never { throw new Error(`Invalid bundle inventory: ${message}`); }

export function assertBundleInventory(manifest: Exclude<ExtensionBundleManifest, { deliveryClass: "platform-plugin" }>): void {
  const files = Object.entries(manifest.files);
  const totalBytes = files.reduce((total, [, metadata]) => total + metadata.bytes, 0);
  const assetBytes = files.filter(([path]) => path.startsWith("assets/")).reduce((total, [, metadata]) => total + metadata.bytes, 0);
  if (totalBytes > manifest.resourceBudget.maxBundleBytes) fail("payload exceeds maxBundleBytes");
  if (assetBytes > manifest.resourceBudget.maxAssetBytes) fail("assets exceed maxAssetBytes");

  if (manifest.deliveryClass === "hot-application") {
    for (const path of [...manifest.entrypoints.server, ...manifest.entrypoints.ui]) {
      if (manifest.files[path]?.contentType !== "application/javascript") fail(`entrypoint is absent or has the wrong content type: ${path}`);
    }
    return;
  }

  if (files.some(([path, metadata]) => path.endsWith(".mjs") || metadata.contentType === "application/javascript")) fail("theme skin contains executable JavaScript");
  let cssBytes = 0;
  for (const path of manifest.stylesheets) {
    const metadata = manifest.files[path];
    if (metadata?.contentType !== "text/css") fail(`stylesheet is absent or has the wrong content type: ${path}`);
    cssBytes += metadata.bytes;
  }
  if (cssBytes > manifest.resourceBudget.maxCssBytes) fail("stylesheets exceed maxCssBytes");
}
