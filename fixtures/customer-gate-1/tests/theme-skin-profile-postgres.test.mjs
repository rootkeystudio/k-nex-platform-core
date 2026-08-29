import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { chromium } from "playwright";

import { ArtifactVerifier, buildBundle, canonicalJson, CatalogClient, InMemoryCatalogCheckpointStore, sha256 } from "@k-nex/extension-bundler";
import { PostgresRuntimeExtensionStore, PostgresThemeProfileStore, PostgresVerifiedArtifactStore } from "@k-nex/payload-adapter";
import { DurableDynamicArtifactPipeline, DurableDynamicGenerationRuntime, PluginManager, ReferenceThemeSkinGenerationWarmer, TrustedAutomationOperationAuthorizer } from "@k-nex/runtime";
import { createThemeSkinCss, DurableThemeSkinResolver } from "@k-nex/ui-design-system-contracts";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const source = { repository: "https://github.com/k-nex/customer-gate-1-skins", commit: "0123456789abcdef0123456789abcdef01234567" };
const publisherKeys = generateKeyPairSync("ed25519");
const catalogKeys = generateKeyPairSync("ed25519");
const publisher = { identity: "customer-gate-1-skin-publisher", publicKey: publisherKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
const catalogSigner = { identity: "customer-gate-1-skin-catalog", publicKey: catalogKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-7-theme-profile-secret", BOOT_KEY: "p9-7-theme-profile" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function signedCatalog(entries) {
  const payload = { schemaVersion: 1, sequence: 1, expiresAt: "2030-01-01T00:00:00.000Z", entries };
  return { schemaVersion: 1, signer: catalogSigner, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), catalogKeys.privateKey).toString("base64") };
}

const skinCss = `:--k-nex-theme-root{background:var(--k-nex-color-background);background-image:asset("assets/grid.svg");color:var(--k-nex-color-foreground)}
:--k-nex-theme-root [data-k-nex-primitive="button"]{background:var(--k-nex-color-accent);border-color:var(--k-nex-color-foreground);transition-duration:var(--k-nex-motion-duration)}
:--k-nex-theme-root [data-k-nex-primitive="button"]:focus-visible{outline:3px solid var(--k-nex-focus-ring)}
@media (prefers-reduced-motion: reduce){:--k-nex-theme-root *{transition-duration:0ms!important}}
@media (forced-colors: active){:--k-nex-theme-root [data-k-nex-primitive="button"]{border-color:CanvasText;outline-color:CanvasText}}`;

function releaseDefinition(generation, version, accent) {
  const asset = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h4v4H0z"/></svg>');
  const themeManifest = {
    schemaVersion: 1, deliveryClass: "theme-skin", id: "skin.neobrutalism", displayName: "Neobrutalism", version, runtimeAbi: "1.0.0",
    profileCompatibility: { schemaVersion: 1 },
    tokens: { "--k-nex-color-background": "#ffffff", "--k-nex-color-foreground": "#111111", "--k-nex-color-accent": accent, "--k-nex-focus-ring": "#000000", "--k-nex-motion-duration": "120ms" },
    palettes: { "skin.bright": {} }, recipes: { surface: "skin.surface", focusRing: "skin.focus", accent: "skin.accent" },
    stylesheets: ["styles/skin.css"], profileMigrations: [], assets: [{ path: "assets/grid.svg", digest: sha256(asset) }], localization: [],
    resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxCssBytes: 65_536 }
  };
  const bundle = buildBundle({
    manifest: { schemaVersion: 1, deliveryClass: "theme-skin", id: themeManifest.id, version, runtimeAbi: "1.0.0", stylesheets: themeManifest.stylesheets, resourceBudget: themeManifest.resourceBudget },
    files: [
      { path: "schemas/theme-skin.json", bytes: Buffer.from(canonicalJson(themeManifest)), contentType: "application/json" },
      { path: "styles/skin.css", bytes: Buffer.from(skinCss), contentType: "text/css" },
      { path: "assets/grid.svg", bytes: asset, contentType: "image/svg+xml" }
    ],
    source, workflowIdentity: `${source.repository}/.github/workflows/release.yml@${source.commit}`
  });
  return {
    generationId: `skin-neobrutalism-generation-${generation}`, version, bundle,
    entry: {
      deliveryClass: "theme-skin", id: "skin.neobrutalism", version, runtimeAbi: "1.0.0", publisher,
      source: { ...source, assetUrl: `https://github.com/k-nex/customer-gate-1-skins/releases/download/${version}/skin.neobrutalism.tar.gz` },
      artifactDigest: sha256(bundle.artifact), manifestDigest: sha256(Buffer.from(canonicalJson(bundle.manifest))), sbomDigest: sha256(bundle.sbom), provenanceDigest: sha256(bundle.provenance),
      support: "supported", review: "approved", security: "clear", revoked: false
    }
  };
}

function request(operation, version, expectedRevision) {
  return {
    applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "theme-skin", id: "skin.neobrutalism" }, operation,
    targetVersion: version, expectedRevision, idempotencyKey: `skin-${operation}-${version}-${expectedRevision}`, correlationId: `skin-${operation}-${version.replaceAll(".", "-")}`
  };
}

function profile(state, revision, generation, version, previousRevisionId) {
  return {
    schemaVersion: 1, id: "theme-profile.public-skin", surface: "public", themeId: "theme.minimal", themeVersion: "1.0.0", palette: "light", mode: "light", values: {},
    skin: { id: "skin.neobrutalism", generationId: generation, version, palette: "skin.bright", values: {} },
    revision: { id: revision, number: revision.endsWith("-1") ? 1 : 2, createdAt: "2026-08-29T09:00:00.000Z", ...(previousRevisionId ? { previousRevisionId } : {}), state, ...(state === "published" ? { publishedAt: "2026-08-29T09:01:00.000Z" } : {}) }
  };
}

async function assertRestoredSkinBrowser(resolved, themeProfile, assetBytes) {
  const assetPath = resolved.generation.assetHandles["assets/grid.svg"];
  assert.ok(assetPath, "Resolved Theme Skin omitted its declared asset handle.");
  assert.ok(assetBytes, "Restored Theme Skin artifact omitted its declared asset bytes.");
  const cssText = createThemeSkinCss(resolved, themeProfile.revision.id);
  let assetRequested = false;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://skin.local").pathname;
    if (path === assetPath) {
      assetRequested = true;
      response.writeHead(200, { "content-type": "image/svg+xml", "x-content-type-options": "nosniff" });
      response.end(assetBytes);
      return;
    }
    response.writeHead(200, { "content-type": "text/html", "x-content-type-options": "nosniff" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><style>${cssText}</style></head><body><main id="root" data-k-nex-theme-profile="${themeProfile.revision.id}" data-skin-generation="${resolved.generation.generationId}"><button data-k-nex-primitive="button">Save sales view</button></main></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Theme Skin browser server failed.");
  const url = `http://127.0.0.1:${address.port}`;
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    const root = page.locator("#root");
    const button = page.getByRole("button", { name: "Save sales view" });
    assert.equal(await root.getAttribute("data-skin-generation"), resolved.generation.generationId);
    assert.equal(await root.getAttribute("data-k-nex-theme-profile"), themeProfile.revision.id);
    assert.equal(await root.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
    assert.ok((await root.evaluate((element) => getComputedStyle(element).backgroundImage)).includes(assetPath), "Restored skin asset was not applied to the document.");
    assert.equal(await button.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(0, 79, 168)");
    await button.focus();
    assert.equal(await button.evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
    assert.equal(await button.evaluate((element) => getComputedStyle(element).outlineColor), "rgb(0, 0, 0)");
    assert.match(await button.ariaSnapshot(), /button "Save sales view"/);
    assert.equal(await page.locator("script").count(), 0, "Theme Skin presentation loaded executable document code.");
    assert.equal(assetRequested, true, "Restored skin asset was not requested from its generation-bound handle.");
    await context.close();

    const reduced = await browser.newContext({ reducedMotion: "reduce" });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(url);
    assert.equal(await reducedPage.getByRole("button", { name: "Save sales view" }).evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
    await reduced.close();

    const forced = await browser.newContext({ forcedColors: "active" });
    const forcedPage = await forced.newPage();
    await forcedPage.goto(url);
    assert.notEqual(await forcedPage.getByRole("button", { name: "Save sales view" }).evaluate((element) => getComputedStyle(element).borderTopStyle), "none");
    await forced.close();
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

test("delivers Theme Skins from signed durable artifacts through PluginManager install, update, rollback, and restore", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("theme_skins").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const clock = { now: () => new Date() };
  try {
    await boot(container.getConnectionUri());
    const releases = [releaseDefinition(1, "1.0.0", "#005fcc"), releaseDefinition(2, "1.1.0", "#004fa8")];
    const catalog = signedCatalog(releases.map((release) => release.entry));
    const verifier = new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, new InMemoryCatalogCheckpointStore()), { [publisher.identity]: publisher.publicKey });
    const artifacts = new PostgresVerifiedArtifactStore(pool, verifier);
    const activation = { compatibility: { status: "compatible", windowId: "skin-window", closesAt: "2030-01-01T00:00:00.000Z", migrationDigest: sha256(Buffer.from("skin")), dataRevision: 1 }, metadata: {}, settings: {}, storageSchemaVersions: {} };
    for (const release of releases) {
      const authority = {
        applicationId: "customer-alpha", environment: "production", deliveryClass: "theme-skin", extensionId: "skin.neobrutalism", generationId: release.generationId,
        sourceCommit: source.commit, artifactDigest: release.entry.artifactDigest, manifestDigest: release.entry.manifestDigest, catalogDigest: sha256(Buffer.from(canonicalJson(catalog))), provenanceDigest: release.entry.provenanceDigest, sbomDigest: release.entry.sbomDigest
      };
      release.authority = authority;
      await artifacts.stage({ owner: authority, authority, activation, verification: { catalog, artifact: release.bundle.artifact, provenance: release.bundle.provenance, deliveryClass: "theme-skin", id: release.entry.id, version: release.version, runtimeAbi: "1.0.0" } });
    }
    const resolver = new DurableThemeSkinResolver({ load: (authority) => artifacts.loadThemeSkin(authority) });
    const warmer = new ReferenceThemeSkinGenerationWarmer({ skins: { prepareSkin: async ({ artifact }) => { await resolver.generation(artifact.authority); } }, clock });
    const extensionStore = new PostgresRuntimeExtensionStore(pool, clock, sha256(Buffer.from("theme-skin-store")));
    const byVersion = new Map(releases.map((release) => [release.version, release]));
    const planner = {
      plan: async (change) => {
        const release = byVersion.get(change.targetVersion); if (!release) throw new Error("Theme Skin release is unavailable.");
        return { sourceCommit: source.commit, generationId: release.generationId, plan: {
          schemaVersion: 1, planId: `theme-plan-${release.generationId}`, operationId: change.operationId, operation: change.operation, version: release.version,
          artifactDigest: release.entry.artifactDigest, expectedRevision: change.expectedRevision, ...(change.currentGenerationId ? { currentGenerationId: change.currentGenerationId } : {}), targetGenerationId: release.generationId, approvalRequired: false,
          rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "theme-skin", id: "skin.neobrutalism", availability: { outcome: "live-generation", activation: "atomic-generation-pointer" },
          resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxCssBytes: 65_536 }
        } };
      }
    };
    const manager = new PluginManager("theme-skin-worker", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), planner, extensionStore, new DurableDynamicArtifactPipeline(artifacts), { request: async () => { throw new Error("Static delivery is not used."); } }, { request: async () => { throw new Error("Static delivery is not used."); }, reverify: async () => false }, new DurableDynamicGenerationRuntime(artifacts, warmer));

    const install = await manager.plan(request("install", "1.0.0", 0));
    await manager.stage(install.operationId);
    const installed = await manager.activate(install.operationId);
    assert.equal(installed.generationId, releases[0].generationId);
    const profiles = new PostgresThemeProfileStore(pool, clock);
    const first = profile("published", "theme-skin.revision-1", releases[0].generationId, releases[0].version);
    await profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", first.revision.id, releases[0].generationId, releases[0].version) });
    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 0, profile: first });
    assert.equal((await resolver.resolve(releases[0].authority, first)).generation.generationId, releases[0].generationId);

    const update = await manager.plan(request("update", "1.1.0", installed.revisionAfter));
    await manager.stage(update.operationId);
    const updated = await manager.activate(update.operationId);
    const second = profile("published", "theme-skin.revision-2", releases[1].generationId, releases[1].version, first.revision.id);
    await profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", second.revision.id, releases[1].generationId, releases[1].version, first.revision.id) });
    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 1, profile: second });
    assert.equal((await resolver.resolve(releases[1].authority, second)).generation.manifest.version, "1.1.0");
    await assert.rejects(resolver.resolve(releases[1].authority, { ...second, skin: { ...second.skin, generationId: releases[0].generationId } }), /Profile|generation/i);

    const uri = new URL(container.getConnectionUri()); uri.hostname = "127.0.0.1"; uri.port = "5432";
    const dumped = await container.exec(["pg_dump", "--format=custom", "--file=/tmp/p9-theme-skin.dump", uri.toString()]);
    assert.equal(dumped.exitCode, 0, dumped.output);
    await pool.query("update runtime_extension_artifacts set artifact_bytes=decode('00','hex') where extension_id='skin.neobrutalism'");
    await assert.rejects(artifacts.loadThemeSkin(releases[1].authority), { code: "ARTIFACT_INVALID" });
    const restored = await container.exec(["pg_restore", "--clean", "--if-exists", "--no-owner", `--dbname=${uri.toString()}`, "/tmp/p9-theme-skin.dump"]);
    assert.equal(restored.exitCode, 0, restored.output);

    const recoveredArtifacts = new PostgresVerifiedArtifactStore(pool, verifier);
    const recoveredResolver = new DurableThemeSkinResolver({ load: (authority) => recoveredArtifacts.loadThemeSkin(authority) });
    const recoveredManager = new PluginManager("theme-skin-recovery", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), planner, new PostgresRuntimeExtensionStore(pool, clock, sha256(Buffer.from("theme-skin-store"))), new DurableDynamicArtifactPipeline(recoveredArtifacts), { request: async () => { throw new Error("Static delivery is not used."); } }, { request: async () => { throw new Error("Static delivery is not used."); }, reverify: async () => false }, new DurableDynamicGenerationRuntime(recoveredArtifacts, new ReferenceThemeSkinGenerationWarmer({ skins: { prepareSkin: async ({ artifact }) => { await recoveredResolver.generation(artifact.authority); } }, clock })));
    assert.equal((await recoveredManager.inventory("customer-alpha", "production")).extensions.themeSkins["skin.neobrutalism"].activeGeneration.generationId, releases[1].generationId);
    const recoveredSkin = await recoveredResolver.resolve(releases[1].authority, second);
    assert.equal(recoveredSkin.generation.generationId, releases[1].generationId);
    const recoveredArtifact = await recoveredArtifacts.loadThemeSkin(releases[1].authority);
    await assertRestoredSkinBrowser(recoveredSkin, second, recoveredArtifact.files.get("assets/grid.svg"));

    await pool.query("update runtime_extension_artifact_bindings set authority_json=jsonb_set(authority_json, '{catalogDigest}', to_jsonb($1::text)) where generation_id=$2", [`sha256:${"f".repeat(64)}`, releases[1].generationId]);
    await assert.rejects(recoveredManager.inventory("customer-alpha", "production"), { code: "ARTIFACT_INVALID" });
    await pool.query("update runtime_extension_artifact_bindings set authority_json=$1::jsonb where generation_id=$2", [JSON.stringify(releases[1].authority), releases[1].generationId]);

    const rollback = await manager.plan(request("rollback", "1.0.0", updated.revisionAfter));
    const rolledBack = await manager.rollback(rollback.operationId);
    assert.equal(rolledBack.generationId, releases[0].generationId);
    const profileRollback = await profiles.rollback({ applicationId: "customer-alpha", environment: "production", profileId: first.id, expectedRevision: 2 });
    assert.equal(profileRollback.skinGenerationId, releases[0].generationId);
    console.log('P9_THEME_SKIN_DURABLE_EVIDENCE={"scenarios":["signed-install-update-rollback","forged-row","altered-bytes","wrong-generation","restore-restart","restored-chromium-presentation"]}');
  } finally {
    await pool.end();
    await container.stop();
  }
});
