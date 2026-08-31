import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { chromium } from "playwright";

import { ArtifactVerifier, buildBundle, canonicalJson, CatalogClient, InMemoryCatalogCheckpointStore, sha256 } from "@k-nex/extension-bundler";
import { PostgresRuntimeExtensionStore, PostgresThemeProfileStore, PostgresVerifiedArtifactStore } from "@k-nex/payload-adapter";
import { DurableDynamicArtifactPipeline, DurableDynamicGenerationRuntime, PluginManager, ReferenceThemeSkinGenerationWarmer, TrustedAutomationOperationAuthorizer } from "@k-nex/runtime";
import { createThemeSkinCss, DurableThemeSkinResolver } from "@k-nex/ui-design-system-contracts";
import { startThemeSkinFixedRouteHost } from "../dist/src/theme-skin-fixed-route-host.js";

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

const skinCss = `:--k-nex-theme-root{background:var(--k-nex-skin-color-background);color:var(--k-nex-skin-color-foreground)}
:--k-nex-theme-root [data-k-nex-primitive="button"]{background:var(--k-nex-skin-color-background);border-color:var(--k-nex-skin-color-foreground);transition-duration:var(--k-nex-skin-motion-duration);padding:8px}`;
const skinAsset = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"><path d="M0 0h4v4H0z"/></svg>');

function releaseDefinition(generation, version, accent) {
  const asset = skinAsset;
  const themeManifest = {
    schemaVersion: 1, deliveryClass: "theme-skin", id: "skin.neobrutalism", displayName: "Neobrutalism", version, runtimeAbi: "1.0.0",
    profileCompatibility: { schemaVersion: 1 },
    tokens: { "--k-nex-skin-color-background": "#ffffff", "--k-nex-skin-color-foreground": "#111111", "--k-nex-skin-color-accent": accent, "--k-nex-skin-focus-ring": "#000000", "--k-nex-skin-motion-duration": "120ms" },
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
  const revisionNumber = Number(revision.split("-").at(-1));
  return {
    schemaVersion: 1, id: "theme-profile.public-skin", surface: "public", themeId: "theme.minimal", themeVersion: "1.0.0", palette: "light", mode: "light", values: {},
    ...(generation && version ? { skin: { id: "skin.neobrutalism", generationId: generation, version, palette: "skin.bright", values: {} } } : {}),
    revision: { id: revision, number: revisionNumber, createdAt: "2026-08-29T09:00:00.000Z", ...(previousRevisionId ? { previousRevisionId } : {}), state, ...(state === "published" ? { publishedAt: "2026-08-29T09:01:00.000Z" } : {}) }
  };
}

async function waitForLockWaiters(pool, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query("select count(*)::int count from pg_stat_activity where datname=current_database() and wait_event_type='Lock'");
    if (result.rows[0]?.count >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} PostgreSQL lock waiters.`);
}

async function assertRestoredSkinBrowser(resolved, themeProfile, host) {
  const assetPath = resolved.generation.assetHandles["assets/grid.svg"];
  assert.ok(assetPath, "Resolved Theme Skin omitted its declared asset handle.");
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    let assetResponse;
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === assetPath) assetResponse = response;
    });
    await page.goto(host.url);
    const root = page.locator("#root");
    const grid = page.getByRole("img", { name: "Neobrutalist grid" });
    const button = page.getByRole("button", { name: "Save sales view" });
    assert.equal(await root.getAttribute("data-skin-generation"), resolved.generation.generationId);
    assert.equal(await root.getAttribute("data-k-nex-theme-profile"), themeProfile.revision.id);
    assert.equal(await root.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
    assert.equal(await root.evaluate((element) => getComputedStyle(element).backgroundImage), "none", "Untrusted Skin CSS placed an asset behind semantic content.");
    assert.equal(await button.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
    await button.focus();
    assert.equal(await button.evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
    assert.equal(await button.evaluate((element) => getComputedStyle(element).outlineColor), "rgb(0, 0, 0)");
    assert.match(await button.ariaSnapshot(), /button "Save sales view"/);
    assert.equal(await grid.getAttribute("alt"), "Neobrutalist grid");
    assert.deepEqual(await grid.evaluate((element) => ({ complete: element.complete, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight })), { complete: true, naturalWidth: 4, naturalHeight: 4 });
    assert.ok(assetResponse, "Theme Skin asset handle produced no browser response.");
    const assetHeaders = await assetResponse.allHeaders();
    assert.equal(assetResponse.status(), 200);
    assert.equal(assetHeaders["cache-control"], "public, max-age=31536000, immutable");
    assert.equal(assetHeaders["content-type"], "image/svg+xml");
    assert.match(assetHeaders["content-digest"] ?? "", /^sha-256=:[A-Za-z0-9+/]{43}=:/u);
    assert.match(assetHeaders["content-security-policy"] ?? "", /default-src 'none'; sandbox/u);
    assert.equal(assetHeaders["x-content-type-options"], "nosniff");
    assert.equal(assetHeaders["content-length"], String(skinAsset.byteLength));
    assert.deepEqual(Buffer.from(await assetResponse.body()), skinAsset);
    assert.equal(host.assetRequests.filter((path) => path === assetPath).length, 1, "Theme Skin asset handle was not served through the verified boundary.");
    assert.deepEqual(host.assetErrors, []);
    assert.equal(await page.locator("script").count(), 0, "Theme Skin presentation loaded executable document code.");
    await context.close();

    const reduced = await browser.newContext({ reducedMotion: "reduce" });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(host.url);
    assert.equal(await reducedPage.getByRole("button", { name: "Save sales view" }).evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
    await reduced.close();

    const forced = await browser.newContext({ forcedColors: "active" });
    const forcedPage = await forced.newPage();
    await forcedPage.goto(host.url);
    assert.notEqual(await forcedPage.getByRole("button", { name: "Save sales view" }).evaluate((element) => getComputedStyle(element).borderTopStyle), "none");
    await forced.close();
  } finally {
    await browser?.close();
  }
}

function themeSkinDocument(resolved, themeProfile) {
  const assetPath = resolved.generation.assetHandles["assets/grid.svg"];
  return `<!doctype html><html><head><meta charset="utf-8"><style>${createThemeSkinCss(resolved, themeProfile.revision.id)}</style></head><body><main id="root" data-k-nex-theme-profile="${themeProfile.revision.id}" data-skin-generation="${resolved.generation.generationId}"><img id="skin-grid" src="${assetPath}" alt="Neobrutalist grid" width="4" height="4"><button data-k-nex-primitive="button">Save sales view</button></main></body></html>`;
}

function skinAssetPath(release) {
  return `/api/extensions/skins/skin.neobrutalism/assets/${release.generationId}/${sha256(skinAsset)}/grid.svg`;
}

async function assertAssetStatus(host, path, status) {
  const response = await fetch(`${host.url}${path}`);
  assert.equal(response.status, status, `${path} returned an unexpected Theme Skin asset status.`);
  return response;
}

test("delivers Theme Skins from signed durable artifacts through PluginManager install, update, rollback, and restore", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("theme_skins").withStartupTimeout(120_000).start();
  let pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let skinHost;
  const clock = { now: () => new Date() };
  try {
    await boot(container.getConnectionUri());
    const releases = [releaseDefinition(1, "1.0.0", "#0088cc"), releaseDefinition(2, "1.1.0", "#0099cc"), releaseDefinition(3, "1.2.0", "#0088cc")];
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
      validate: async () => undefined,
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
    const manager = new PluginManager("theme-skin-worker", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), planner, extensionStore, new DurableDynamicArtifactPipeline(artifacts), { request: async () => { throw new Error("Static delivery is not used."); } }, { request: async () => { throw new Error("Static delivery is not used."); }, reverify: async () => false }, new DurableDynamicGenerationRuntime(artifacts, warmer), clock);

    const install = await manager.plan(request("install", "1.0.0", 0));
    await manager.stage(install.operationId);
    const installed = await manager.activate(install.operationId);
    assert.equal(installed.generationId, releases[0].generationId);
    let profiles = new PostgresThemeProfileStore(pool, clock);
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
    await pool.query("update runtime_extension_artifacts set artifact_bytes=decode('00','hex') where artifact_digest=$1", [releases[1].authority.artifactDigest]);
    await assert.rejects(artifacts.loadThemeSkin(releases[1].authority), { code: "ARTIFACT_INVALID" });
    const restored = await container.exec(["pg_restore", "--clean", "--if-exists", "--no-owner", `--dbname=${uri.toString()}`, "/tmp/p9-theme-skin.dump"]);
    assert.equal(restored.exitCode, 0, restored.output);
    await pool.end();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    profiles = new PostgresThemeProfileStore(pool, clock);

    const recoveredArtifacts = new PostgresVerifiedArtifactStore(pool, verifier);
    const recoveredResolver = new DurableThemeSkinResolver({ load: (authority) => recoveredArtifacts.loadThemeSkin(authority) });
    const recoveredManager = new PluginManager("theme-skin-recovery", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), planner, new PostgresRuntimeExtensionStore(pool, clock, sha256(Buffer.from("theme-skin-store"))), new DurableDynamicArtifactPipeline(recoveredArtifacts), { request: async () => { throw new Error("Static delivery is not used."); } }, { request: async () => { throw new Error("Static delivery is not used."); }, reverify: async () => false }, new DurableDynamicGenerationRuntime(recoveredArtifacts, new ReferenceThemeSkinGenerationWarmer({ skins: { prepareSkin: async ({ artifact }) => { await recoveredResolver.generation(artifact.authority); } }, clock })), clock);
    assert.equal((await recoveredManager.inventory("customer-alpha", "production")).extensions.themeSkins["skin.neobrutalism"].activeGeneration.generationId, releases[1].generationId);
    const recoveredSkin = await recoveredResolver.resolve(releases[1].authority, second);
    assert.equal(recoveredSkin.generation.generationId, releases[1].generationId);
    skinHost = await startThemeSkinFixedRouteHost({ applicationId: "customer-alpha", environment: "production", inventory: recoveredManager, artifacts: recoveredArtifacts, document: themeSkinDocument(recoveredSkin, second) });
    await assertRestoredSkinBrowser(recoveredSkin, second, skinHost);
    await assertAssetStatus(skinHost, skinAssetPath(releases[0]), 200);
    await assertAssetStatus(skinHost, skinAssetPath(releases[1]).replace(releases[1].generationId, "skin-generation-unrelated"), 404);
    await assertAssetStatus(skinHost, skinAssetPath(releases[1]).replace(sha256(skinAsset), `sha256:${"f".repeat(64)}`), 404);
    await pool.query("update runtime_extension_artifacts set artifact_bytes=decode('00','hex') where artifact_digest=$1", [releases[0].authority.artifactDigest]);
    await assertAssetStatus(skinHost, skinAssetPath(releases[0]), 404);
    await pool.query("update runtime_extension_artifacts set artifact_bytes=$1 where artifact_digest=$2", [releases[0].bundle.artifact, releases[0].authority.artifactDigest]);
    await assertAssetStatus(skinHost, skinAssetPath(releases[0]), 200);
    await pool.query("delete from runtime_extension_artifact_bindings where generation_id=$1", [releases[0].generationId]);
    await assertAssetStatus(skinHost, skinAssetPath(releases[0]), 404);
    await recoveredArtifacts.stage({ owner: releases[0].authority, authority: releases[0].authority, activation, verification: { catalog, artifact: releases[0].bundle.artifact, provenance: releases[0].bundle.provenance, deliveryClass: "theme-skin", id: releases[0].entry.id, version: releases[0].version, runtimeAbi: "1.0.0" } });
    await assertAssetStatus(skinHost, skinAssetPath(releases[0]), 200);

    const verifiedProvenance = (await pool.query(
      "select provenance_bytes from runtime_extension_artifact_acceptances where artifact_digest=$1 and catalog_digest=$2",
      [releases[1].authority.artifactDigest, releases[1].authority.catalogDigest]
    )).rows[0].provenance_bytes;
    await pool.query(
      "update runtime_extension_artifact_acceptances set provenance_bytes=decode('00','hex') where artifact_digest=$1 and catalog_digest=$2",
      [releases[1].authority.artifactDigest, releases[1].authority.catalogDigest]
    );
    await assert.rejects(recoveredArtifacts.loadThemeSkin(releases[1].authority), { code: "ARTIFACT_INVALID" });
    await pool.query(
      "update runtime_extension_artifact_acceptances set provenance_bytes=$1 where artifact_digest=$2 and catalog_digest=$3",
      [verifiedProvenance, releases[1].authority.artifactDigest, releases[1].authority.catalogDigest]
    );

    const rollback = await recoveredManager.plan(request("rollback", "1.0.0", updated.revisionAfter));
    const rolledBack = await recoveredManager.rollback(rollback.operationId);
    assert.equal(rolledBack.generationId, releases[0].generationId);
    const profileRollback = await profiles.rollback({ applicationId: "customer-alpha", environment: "production", profileId: first.id, expectedRevision: 2 });
    assert.equal(profileRollback.skinGenerationId, releases[0].generationId);

    const disable = await recoveredManager.plan(request("disable", "1.0.0", rolledBack.revisionAfter));
    await assert.rejects(recoveredManager.disable(disable.operationId), { code: "REFERENCE_CONFLICT" });

    const noSkin2 = profile("published", "theme-skin.no-skin-2", undefined, undefined, first.revision.id);
    await profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", noSkin2.revision.id, undefined, undefined, first.revision.id) });
    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: profileRollback.revisionAfter, profile: noSkin2 });
    await assert.rejects(recoveredManager.disable(disable.operationId), { code: "REFERENCE_CONFLICT" });
    const noSkin3 = profile("published", "theme-skin.no-skin-3", undefined, undefined, noSkin2.revision.id);
    await profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", noSkin3.revision.id, undefined, undefined, noSkin2.revision.id) });
    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 4, profile: noSkin3 });

    const skin4 = profile("published", "theme-skin.race-skin-4", releases[0].generationId, releases[0].version, noSkin3.revision.id);
    const extensionLock = await pool.connect();
    let extensionLockOpen = false;
    try {
      await extensionLock.query("begin");
      extensionLockOpen = true;
      await extensionLock.query(
        `select 1 from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='theme-skin' and extension_id=$3 for update`,
        ["customer-alpha", "production", "skin.neobrutalism"]
      );
      const staging = profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", skin4.revision.id, releases[0].generationId, releases[0].version, noSkin3.revision.id) });
      await waitForLockWaiters(pool, 1);
      const disposition = recoveredManager.disable(disable.operationId);
      await waitForLockWaiters(pool, 2);
      await extensionLock.query("commit");
      extensionLockOpen = false;
      const outcomes = await Promise.allSettled([staging, disposition]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1, "Exactly one draft stage/disposition race participant must commit.");
      assert.equal(outcomes[0]?.status, "fulfilled", "The queued draft stage must commit before the competing disposition scans references.");
      assert.equal(outcomes[1]?.status, "rejected");
      if (outcomes[1]?.status === "rejected") assert.equal(outcomes[1].reason?.code, "REFERENCE_CONFLICT");
    } finally {
      if (extensionLockOpen) await extensionLock.query("rollback");
      extensionLock.release();
    }
    const danglingReference = await pool.query(
      `select count(*)::int count from runtime_theme_profile_publications p
       where p.application_id=$1 and p.environment=$2 and (
         p.active_profile->'skin'->>'id'=$3 or p.previous_profile->'skin'->>'id'=$3 or p.draft_profile->'skin'->>'id'=$3
       ) and not exists (
         select 1 from runtime_extensions e join runtime_extension_generations g
           on g.application_id=e.application_id and g.environment=e.environment and g.delivery_class=e.delivery_class
             and g.extension_id=e.extension_id and g.generation_id=e.active_generation_id
         where e.application_id=p.application_id and e.environment=p.environment and e.delivery_class='theme-skin' and e.extension_id=$3
           and e.disposition='active' and g.state='active'
       )`,
      ["customer-alpha", "production", "skin.neobrutalism"]
    );
    assert.equal(danglingReference.rows[0]?.count, 0, "Concurrent draft staging and disposition committed an unavailable Theme Skin reference.");

    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 5, profile: skin4 });
    await assert.rejects(recoveredManager.disable(disable.operationId), { code: "REFERENCE_CONFLICT" });
    const noSkin5 = profile("published", "theme-skin.no-skin-5", undefined, undefined, skin4.revision.id);
    await profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", noSkin5.revision.id, undefined, undefined, skin4.revision.id) });
    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 6, profile: noSkin5 });
    await assert.rejects(recoveredManager.disable(disable.operationId), { code: "REFERENCE_CONFLICT" });
    const noSkin6 = profile("published", "theme-skin.no-skin-6", undefined, undefined, noSkin5.revision.id);
    await profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", noSkin6.revision.id, undefined, undefined, noSkin5.revision.id) });
    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 7, profile: noSkin6 });
    const disabled = await recoveredManager.disable(disable.operationId);
    assert.equal(disabled.disposition, "disabled");
    await assertAssetStatus(skinHost, skinAssetPath(releases[0]), 200);
    await pool.query("delete from runtime_extension_artifact_bindings where generation_id=$1", [releases[0].generationId]);
    await assertAssetStatus(skinHost, skinAssetPath(releases[0]), 404);

    const reinstalled = await recoveredManager.plan(request("install", "1.2.0", disabled.revisionAfter));
    await recoveredManager.stage(reinstalled.operationId);
    const reactivated = await recoveredManager.activate(reinstalled.operationId);
    const skin7 = profile("published", "theme-skin.uninstall-skin-7", releases[2].generationId, releases[2].version, noSkin6.revision.id);
    await profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", skin7.revision.id, releases[2].generationId, releases[2].version, noSkin6.revision.id) });
    const uninstall = await recoveredManager.plan(request("uninstall", "1.2.0", reactivated.revisionAfter));
    await assert.rejects(recoveredManager.uninstall(uninstall.operationId), { code: "REFERENCE_CONFLICT" });
    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 8, profile: skin7 });
    await assert.rejects(recoveredManager.uninstall(uninstall.operationId), { code: "REFERENCE_CONFLICT" });
    const noSkin8 = profile("published", "theme-skin.no-skin-8", undefined, undefined, skin7.revision.id);
    await profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", noSkin8.revision.id, undefined, undefined, skin7.revision.id) });
    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 9, profile: noSkin8 });
    await assert.rejects(recoveredManager.uninstall(uninstall.operationId), { code: "REFERENCE_CONFLICT" });
    const noSkin9 = profile("published", "theme-skin.no-skin-9", undefined, undefined, noSkin8.revision.id);
    await profiles.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile("draft", noSkin9.revision.id, undefined, undefined, noSkin8.revision.id) });
    await profiles.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 10, profile: noSkin9 });
    const uninstalled = await recoveredManager.uninstall(uninstall.operationId);
    assert.equal(uninstalled.disposition, "removed");
    await assertAssetStatus(skinHost, skinAssetPath(releases[2]), 404);
    console.log('P9_THEME_SKIN_DURABLE_EVIDENCE={"scenarios":["signed-install-update-rollback","forged-row","altered-bytes","wrong-generation-artifact-file-digest","restore-pool-reconstruction","verified-asset-route-chromium-presentation","corrupt-rollback-route-denial","deleted-rollback-binding-route-denial","profile-reference-disposition","draft-disposition-race","disabled-retained-route","deleted-disabled-binding-route-denial","removed-asset-route-denial"]}');
  } finally {
    await skinHost?.close();
    await pool.end();
    await container.stop();
  }
});
