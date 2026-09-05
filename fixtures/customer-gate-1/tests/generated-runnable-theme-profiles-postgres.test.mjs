import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { applyCreateKnexApplication, planCreateKnexApplication } from "@k-nex/composition";
import { PackageReleaseManifestSchema, canonicalJson } from "@k-nex/contracts";
import { PostgresThemeProfileStore } from "@k-nex/payload-adapter";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { chromium } from "playwright";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const environment = "test";

function run(command, arguments_, options) {
  return execFileSync(command, arguments_, { ...options, encoding: "utf8", timeout: 120_000 });
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.notEqual(typeof address, "string");
  const port = address.port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function until(check, failure, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`${failure}: process exited ${child.exitCode}.`);
    const result = await check().catch(() => undefined);
    if (result !== undefined && result !== false) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(failure);
}

function start(command, arguments_, options) {
  const child = spawn(command, arguments_, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  return { child, output: () => output };
}

async function stop(child, label) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveClose, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} process did not stop.`)), 10_000);
    child.once("close", () => { clearTimeout(timeout); resolveClose(); });
  });
}

async function startApplication(application, applicationEnvironment) {
  const port = Number(new URL(applicationEnvironment.K_NEX_PUBLIC_ORIGIN).port);
  const applicationProcess = start(process.execPath, [realpathSync(join(application, "node_modules", "next", "dist", "bin", "next")), "start"], { cwd: application, env: { ...applicationEnvironment, PORT: String(port) } });
  await until(async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).ok, `Generated application did not start.\n${applicationProcess.output()}`, applicationProcess.child);
  return { ...applicationProcess, origin: `http://127.0.0.1:${port}` };
}

async function login(origin, email, password) {
  const response = await fetch(`${origin}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200, await response.text());
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return { header: setCookie.split(";", 1)[0] };
}

function verifiedPackageSource(manifestInput, directory) {
  const manifest = PackageReleaseManifestSchema.parse(manifestInput);
  const release = Object.freeze({});
  const authority = {
    async verify() { throw new Error("Fixture authority accepts only its issued release."); },
    read(token) {
      if (token !== release) throw new Error("Fixture release was not issued by this authority.");
      return { manifest, digest: `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`, attestation: Object.freeze({}) };
    }
  };
  return { kind: "packed-mirror", directory, authority, release };
}

async function assertShellTheme(page, expected) {
  const shell = page.locator('[data-k-nex-component="workspace-shell"]');
  const sidebar = page.locator(".workspace-sidebar");
  const header = page.locator(".workspace-header");
  const sales = page.getByRole("navigation", { name: "Workspace navigation" }).locator('[data-navigation-node="sales.navigation.root"]');
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  await shell.waitFor();
  await sales.waitFor();
  await collapse.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await collapse.evaluate((element) => element.matches(":focus-visible")), true, "Keyboard focus must remain visible.");
  const values = await page.evaluate(({ shellSelector, sidebarSelector, headerSelector, salesSelector, collapseSelector }) => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      shellBackground: style(shellSelector).backgroundColor,
      shellColor: style(shellSelector).color,
      sidebarBackground: style(sidebarSelector).backgroundColor,
      sidebarBorder: style(sidebarSelector).borderInlineEndColor,
      headerBackground: style(headerSelector).backgroundColor,
      headerBorder: style(headerSelector).borderBlockEndColor,
      navigationColor: style(salesSelector).color,
      focusColor: style(collapseSelector).outlineColor
    };
  }, {
    shellSelector: '[data-k-nex-component="workspace-shell"]', sidebarSelector: ".workspace-sidebar", headerSelector: ".workspace-header",
    salesSelector: '[data-navigation-node="sales.navigation.root"]', collapseSelector: 'button[aria-label="Collapse sidebar"]'
  });
  assert.deepEqual(values, expected);
  return values;
}

test("P12.10 generated applications resolve durable shell and page Theme Profiles in Chromium", { timeout: 720_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("p12_theme_profiles").withStartupTimeout(120_000).start();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "p12-generated-themes-")));
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const browser = await chromium.launch();
  try {
    const releaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"), "utf8"));
    const packageSource = verifiedPackageSource(releaseManifest, resolve(repositoryRoot, "fixtures/customer-gate-1/packages"));
    const cases = [
      { theme: "minimal", applicationId: "p12-theme-minimal", expected: { shellBackground: "rgb(255, 255, 255)", shellColor: "rgb(21, 23, 26)", sidebarBackground: "rgb(255, 255, 255)", sidebarBorder: "rgb(214, 217, 224)", headerBackground: "rgb(255, 255, 255)", headerBorder: "rgb(214, 217, 224)", navigationColor: "rgb(21, 23, 26)", focusColor: "rgb(36, 87, 255)" } },
      { theme: "neobrutalism", applicationId: "p12-theme-neobrutalism", expected: { shellBackground: "rgb(255, 244, 204)", shellColor: "rgb(17, 17, 17)", sidebarBackground: "rgb(255, 244, 204)", sidebarBorder: "rgb(17, 17, 17)", headerBackground: "rgb(255, 244, 204)", headerBorder: "rgb(17, 17, 17)", navigationColor: "rgb(17, 17, 17)", focusColor: "rgb(255, 59, 48)" } }
    ];
    for (const current of cases) {
      const application = join(root, current.theme);
      const ownerEmail = `owner-${current.theme}-${randomUUID()}@example.test`;
      const ownerPassword = randomBytes(24).toString("base64url");
      const plan = planCreateKnexApplication({ applicationId: current.applicationId, applicationName: `P12 ${current.theme} Theme`, theme: current.theme, database: "external", packageSource });
      applyCreateKnexApplication(plan, application);
      for (const command of plan.installCommands) run(command[0], command.slice(1), { cwd: application, stdio: "pipe" });
      const applicationEnvironment = { ...process.env, DATABASE_URL: container.getConnectionUri(), K_NEX_ENVIRONMENT: environment, K_NEX_PUBLIC_ORIGIN: `http://127.0.0.1:${await unusedPort()}`, PAYLOAD_SECRET: randomBytes(32).toString("hex") };
      run("pnpm", ["knex:migrate"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
      run("pnpm", ["build"], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
      const tokenFile = join(root, `${current.theme}.owner.token`);
      run("pnpm", ["knex:issue-bootstrap-token", "--output", tokenFile], { cwd: application, env: applicationEnvironment, stdio: "pipe" });
      run("pnpm", ["knex:bootstrap-owner", "--token-file", tokenFile], { cwd: application, env: { ...applicationEnvironment, K_NEX_OWNER_EMAIL: ownerEmail, K_NEX_OWNER_PASSWORD: ownerPassword }, stdio: "pipe" });
      let applicationProcess;
      let context;
      try {
        applicationProcess = await startApplication(application, applicationEnvironment);
        const owner = await login(applicationProcess.origin, ownerEmail, ownerPassword);
        context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
        const page = await context.newPage();
        await page.goto(`${applicationProcess.origin}/login`);
        await page.getByLabel("Email").fill(ownerEmail);
        await page.getByLabel("Password").fill(ownerPassword);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.waitForURL(`${applicationProcess.origin}/`);
        await page.waitForLoadState("networkidle").catch(() => {});
        if (await page.locator('[data-k-nex-component="workspace-shell"]').count() === 0) {
          throw new Error(`Workspace shell missing. url=${page.url()}\nbody=${await page.locator("body").innerText()}\nprocess=${applicationProcess.output()}`);
        }
        const shellBefore = await assertShellTheme(page, current.expected);

        if (current.theme === "minimal") {
          const override = {
            schemaVersion: 1, id: "workspace.theme.override", surface: "admin", themeId: "theme.minimal", themeVersion: "1.0.0", palette: "light", mode: "light",
            values: { "color.background": "#ffe0e0", "color.border": "#cc0000", "color.accent": "#007a00" },
            revision: { id: "workspace.theme.override.one", number: 1, state: "published", createdAt: "2026-09-04T00:00:00.000Z", publishedAt: "2026-09-04T00:00:00.000Z" }
          };
          const profiles = new PostgresThemeProfileStore(pool, { now: () => new Date("2026-09-04T00:00:00.000Z") }, { authorize: () => true }, { validate: () => {} });
          await profiles.stageDraft({ applicationId: current.applicationId, environment, profile: { ...override, revision: { id: override.revision.id, number: override.revision.number, state: "draft", createdAt: override.revision.createdAt } } });
          const receipt = await profiles.publish({ applicationId: current.applicationId, environment, expectedRevision: 0, profile: override });
          assert.equal(receipt.activeRevisionId, override.revision.id);
          assert.equal((await pool.query("select count(*)::int as count from runtime_theme_profile_outbox where application_id=$1 and environment=$2 and profile_id=$3 and event_id=$4", [current.applicationId, environment, override.id, receipt.eventId])).rows[0].count, 1);
          const created = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages`, {
            method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: owner.header, origin: applicationProcess.origin },
            body: new URLSearchParams({ title: "Override boundary", description: "Theme boundary proof", parentNavigationId: "sales.navigation.root", order: "1", themeRevision: `${override.id}|${override.revision.id}`, idempotencyKey: `theme-page-${randomUUID()}` })
          });
          assert.equal(created.status, 303, await created.clone().text());
          const pageId = decodeURIComponent(new URL(created.headers.get("location"), applicationProcess.origin).pathname.split("/").at(-1));
          const copy = await pool.query("select working_copy_revision from k_nex_workspace_pages where application_id=$1 and environment=$2 and page_id=$3", [current.applicationId, environment, pageId]);
          assert.equal(copy.rowCount, 1);
          const published = await fetch(`${applicationProcess.origin}/api/k-nex/workspace-pages/${encodeURIComponent(pageId)}/publish`, {
            method: "POST", headers: { "content-type": "application/json", cookie: owner.header, origin: applicationProcess.origin },
            body: JSON.stringify({ workingCopyRevision: copy.rows[0].working_copy_revision, idempotencyKey: `theme-publish-${randomUUID()}` })
          });
          assert.equal(published.status, 200, await published.clone().text());
          await page.goto(`${applicationProcess.origin}/workspace/pages/${encodeURIComponent(pageId)}`);
          const runtime = page.locator(`#workspace-main section[data-k-nex-theme-profile="${override.revision.id}"][data-k-nex-theme-mode="light"]`);
          await runtime.waitFor({ state: "attached" });
          assert.equal(await runtime.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 224, 224)");
          assert.deepEqual(await assertShellTheme(page, current.expected), shellBefore, "Page Theme Profile must not restyle fixed shell.");
          console.log("P12_DURABLE_PAGE_THEME_OVERRIDE_POSTGRES_HTTP_CHROMIUM_BOUNDARY=PASS");
        }
        console.log(`P12_${current.theme.toUpperCase()}_SHELL_THEME_POSTGRES_HTTP_CHROMIUM=PASS`);
      } finally {
        await context?.close().catch(() => {});
        await stop(applicationProcess?.child, `${current.theme} application`).catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await pool.end().catch(() => {});
    await container.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
