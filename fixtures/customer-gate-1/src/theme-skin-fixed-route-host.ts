import { createServer, type Server } from "node:http";

import type { RuntimeExtensionInventory } from "@k-nex/contracts";
import { VerifiedThemeSkinAssetService, type VerifiedThemeSkinArtifactReader } from "@k-nex/extension-bundler";

const assetRoute = /^\/api\/extensions\/skins\/(skin(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+)\/assets\/([a-z][a-z0-9-]{2,127})\/(sha256:[0-9a-f]{64})\/(.+)$/u;

export interface ThemeSkinInventoryReader {
  inventory(applicationId: string, environment: string): Promise<RuntimeExtensionInventory>;
}

export interface ThemeSkinFixedRouteHost {
  readonly url: string;
  readonly assetRequests: readonly string[];
  readonly assetErrors: readonly string[];
  close(): Promise<void>;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server: Server): Promise<void> { return new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }

export async function startThemeSkinFixedRouteHost(input: Readonly<{
  applicationId: string;
  environment: string;
  inventory: ThemeSkinInventoryReader;
  artifacts: VerifiedThemeSkinArtifactReader;
  document: string;
}>): Promise<ThemeSkinFixedRouteHost> {
  const generations = async (skinId: string) => {
    const entry = (await input.inventory.inventory(input.applicationId, input.environment)).extensions.themeSkins[skinId];
    if (!entry) return [];
    return entry.disposition === "active" ? [entry.activeGeneration, entry.rollbackGeneration] : entry.disposition === "disabled" ? [entry.retainedGeneration] : [];
  };
  const assets = new VerifiedThemeSkinAssetService(input.artifacts, {
    async isAvailable(identity) {
      return (await generations(identity.skinId)).some((generation) => generation !== undefined && generation.applicationId === identity.applicationId && generation.environment === identity.environment &&
        generation.deliveryClass === "theme-skin" && generation.extensionId === identity.skinId && generation.generationId === identity.generationId && generation.artifactDigest === identity.artifactDigest);
    }
  });
  const assetRequests: string[] = [];
  const assetErrors: string[] = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://customer.local").pathname;
    const match = request.method === "GET" ? assetRoute.exec(pathname) : null;
    if (!match) {
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" });
        response.end(input.document);
      } else response.writeHead(404, { "x-content-type-options": "nosniff" }).end();
      return;
    }
    assetRequests.push(pathname);
    try {
      const skinId = match[1];
      const generationId = match[2];
      const fileDigest = match[3];
      const encodedPath = match[4];
      if (!skinId || !generationId || !fileDigest || !encodedPath) throw new Error("Theme Skin asset route is incomplete.");
      const generation = (await generations(skinId)).find((candidate) => candidate !== undefined && candidate.generationId === generationId && candidate.applicationId === input.applicationId && candidate.environment === input.environment && candidate.deliveryClass === "theme-skin" && candidate.extensionId === skinId);
      if (!generation) throw new Error("Theme Skin generation is not active or retained.");
      const asset = await assets.read({ applicationId: input.applicationId, environment: input.environment, skinId, generationId, artifactDigest: generation.artifactDigest, fileDigest, path: `assets/${decodeURIComponent(encodedPath)}` });
      response.writeHead(asset.status, asset.headers);
      response.end(asset.body);
    } catch (error) {
      assetErrors.push(error instanceof Error ? error.message : "theme-skin-asset-failed");
      response.writeHead(404, { "x-content-type-options": "nosniff" });
      response.end();
    }
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Theme Skin fixed route host failed to listen.");
  return Object.freeze({ url: `http://127.0.0.1:${address.port}`, assetRequests, assetErrors, close: () => close(server) });
}
