import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ApplicationManifestSchema } from "@k-nex/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { applyCreateKnexApplication, planCreateKnexApplication } from "../src/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("create-knex-app", () => {
  it("plans deterministic exact Sales applications for local or external Postgres", () => {
    const options = { applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal", database: "docker-postgres" } as const;
    const first = planCreateKnexApplication(options);
    expect(planCreateKnexApplication(options)).toEqual(first);
    expect(first.files["compose.yaml"]).toContain("postgres:17.6-alpine@sha256:");
    const manifest = ApplicationManifestSchema.parse(JSON.parse(first.files["k-nex.app.json"]!));
    expect(manifest.plugins).toEqual([{ id: "module.sales", package: "@k-nex/module-sales", version: "1.0.0", enabled: true }]);
    expect(manifest.environment.required).toEqual(["DATABASE_URL", "K_NEX_ENVIRONMENT", "K_NEX_PUBLIC_ORIGIN", "PAYLOAD_SECRET"]);
    expect(JSON.parse(first.files["package.json"]!).dependencies).toMatchObject({ payload: "3.88.0", "@k-nex/builder-puck": "1.0.0", "@k-nex/module-sales": "1.0.0", "@k-nex/theme-minimal": "1.0.0" });
    expect(first.files["src/payload.config.ts"]).toContain("kNexSalesRegistry.collections");
    expect(first.files["src/payload.config.ts"]).toContain("prodMigrations: migrations");
    expect(first.files["src/payload.config.ts"]).toContain('kNexApplicationId: "customer-alpha"');
    expect(first.files["src/boot.ts"]).toContain("bootKnexApplication");
    expect(first.files["src/migrations/index.ts"]).toContain("20260827_000002_knex_bootstrap");
    expect(first.files["tsconfig.json"]).toContain('"moduleResolution": "bundler"');
    expect(first.files["tsconfig.scripts.json"]).toContain('"module": "NodeNext"');
    expect(first.files["src/k-nex-registry.ts"]).toContain("salesRegistration");
    expect(first.files["src/k-nex-registry.ts"]).toContain('surface: "admin"');
    expect(first.files["next.config.ts"]).not.toContain('"@k-nex/module-sales"');
    expect(first.files["src/k-nex-workspace-pages.ts"]).toContain("CurrentAuthorityWorkspacePageService");
    expect(first.files["src/k-nex-workspace-pages.ts"]).toContain("registered?.descriptor ?? registered");
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain('descriptor.id === salesOpportunitiesDescriptor.id ? "sales.opportunities" as const : "sales.tasks" as const');
    expect(first.files["src/app/components/k-nex-workspace-page-runtime.tsx"]).not.toMatch(/builder-puck|module-sales\/puck/u);
    expect(first.files["src/app/components/k-nex-workspace-page-editor.tsx"]).toMatch(/builder-puck|module-sales\/puck/u);
    expect(first.files["src/k-nex-readiness.ts"]).toContain("K_NEX_APPLICATION_READY");
    expect(first.files["src/app/(payload)/api/[...slug]/route.ts"]).toContain("REST_GET(config)");
    expect(first.files["src/app/(workspace)/page.tsx"]).toContain("Customer Alpha");
    expect(first.files["src/app/api/health/route.ts"]).toContain('status: "alive"');
    expect(first.files["src/app/api/readiness/route.ts"]).toContain("bootKnexApplication");
    expect(first.files["src/k-nex-users.ts"]).toContain("removeTokenFromResponses: true");
    expect(first.files["src/k-nex-users.ts"]).toContain("useSessions: true");
    expect(first.files["src/k-nex-bootstrap-token.ts"]).toContain("timingSafeEqual");
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain("bootstrapFirstOwner");
    expect(first.files["src/migrations/20260903_000003_knex_authorization.ts"]).toContain("kNexAuthorizationSchemaMigration");
    expect(first.files["src/migrations/20260903_000004_knex_workspace_pages.ts"]).toContain("kNexWorkspacePageSchemaMigration");
    expect(first.files["src/migrations/20260903_000005_knex_event_outbox.ts"]).toContain("kNexEventOutboxSchemaMigration");
    expect(first.files["src/app/api/k-nex/inventory/route.ts"]).toContain("system.extensions.read");
    expect(Object.values(first.files).every((source) => !source.includes("fixtures/customer-gate-1"))).toBe(true);
    const packageJson = JSON.parse(first.files["package.json"]!);
    expect(packageJson.engines.node).toBe(">=24 <25");
    expect(packageJson.scripts).toMatchObject({
      build: "pnpm build:scripts && next build --webpack",
      dev: "next dev --webpack",
      "knex:bootstrap-owner": "node dist/k-nex-bootstrap-owner.js",
      "knex:issue-bootstrap-token": "node dist/k-nex-issue-bootstrap-token.js",
      "knex:db:up": "docker compose up -d postgres",
      "knex:doctor": "node dist/k-nex-doctor.js",
      "knex:migrate": "payload migrate",
      "knex:readiness": "node dist/k-nex-readiness.js",
      "knex:worker": "node dist/k-nex-worker.js",
      start: "next start"
    });
    expect(JSON.parse(first.files[".k-nex/application-plan.json"]!).packageSource.kind).toBe("workspace");
    expect(first.files[".env.example"]!.split("\n").filter(Boolean).every((line) => line.endsWith("="))).toBe(true);
    expect(first.files["src/k-nex-users.ts"]).toContain('secure: kNexIdentity.publicOrigin.protocol === "https:"');
    expect(Object.values(first.files).some((source) => source.includes("K_NEX_OWNER_PASSWORD="))).toBe(true);
    expect(Object.values(first.files).every((source) => !source.includes("K_NEX_OWNER_PASSWORD=secret"))).toBe(true);
    expect(first.installCommands).toEqual([["pnpm", "install", "--lockfile-only"], ["pnpm", "install", "--frozen-lockfile"]]);
  });

  it("binds a generated application to every exact artifact in a packed release mirror", () => {
    const release = JSON.parse(readFileSync(new URL("../../../releases/1.0.0/package-release-manifest.json", import.meta.url), "utf8"));
    const mirror = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    const plan = planCreateKnexApplication({
      applicationId: "packed-customer", applicationName: "Packed Customer", theme: "minimal", database: "external",
      packageSource: { kind: "packed-mirror", directory: mirror, releaseManifest: release }
    });
    const packageJson = JSON.parse(plan.files["package.json"]!);
    const sales = release.packages.find((entry: { package: string }) => entry.package === "@k-nex/module-sales");
    expect(release.release.version).toBe("1.0.0");
    expect(sales.version).toBe("1.0.0");
    expect(packageJson.dependencies["@k-nex/module-sales"]).toBe(`file:.k-nex/packages/k-nex-module-sales-${sales.version}.tgz`);
    expect(plan.files["pnpm-workspace.yaml"]).toContain('"@k-nex/module-sales": "file:.k-nex/packages/k-nex-module-sales-');
    expect(packageJson.scripts["knex:db:up"]).toBeUndefined();
    expect(plan.files["README.md"]).not.toContain("knex:db:up");
    expect(JSON.parse(plan.files["k-nex.app.json"]!).plugins[0].version).toBe(sales.version);
    expect(Object.keys(plan.artifactDigests)).toHaveLength(release.packages.length);
  });

  it("rejects tampered mirrors and installs immutable bytes captured by the verified plan", () => {
    const release = JSON.parse(readFileSync(new URL("../../../releases/1.0.0/package-release-manifest.json", import.meta.url), "utf8"));
    const source = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-mirror-"))); roots.push(root);
    const mirror = join(root, "mirror"); mkdirSync(mirror);
    for (const entry of release.packages) {
      const filename = `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`;
      copyFileSync(join(source, filename), join(mirror, filename));
    }
    const options = { applicationId: "packed-customer", applicationName: "Packed Customer", theme: "minimal", database: "external", packageSource: { kind: "packed-mirror", directory: mirror, releaseManifest: release } } as const;
    const plan = planCreateKnexApplication(options);
    const sales = release.packages.find((entry: { package: string }) => entry.package === "@k-nex/module-sales");
    expect(release.release.version).toBe("1.0.0");
    expect(sales.version).toBe("1.0.0");
    const filename = `${sales.package.slice(1).replace("/", "-")}-${sales.version}.tgz`;
    writeFileSync(join(mirror, filename), "replacement after planning");
    const target = join(root, "application");
    applyCreateKnexApplication(plan, target);
    expect(`sha256:${createHash("sha256").update(readFileSync(join(target, ".k-nex/packages", filename))).digest("hex")}`).toBe(plan.artifactDigests[filename]);
    expect(() => planCreateKnexApplication(options)).toThrow("integrity mismatch");

    copyFileSync(join(source, filename), join(mirror, filename));
    const other = release.packages.find((entry: { package: string }) => entry.package === "@k-nex/composition");
    const otherFilename = `${other.package.slice(1).replace("/", "-")}-${other.version}.tgz`;
    copyFileSync(join(source, filename), join(mirror, otherFilename));
    const forgedRelease = { ...release, packages: release.packages.map((entry: { package: string }) => entry.package === other.package ? { ...entry, integrity: sales.integrity } : entry) };
    expect(() => planCreateKnexApplication({ ...options, packageSource: { ...options.packageSource, releaseManifest: forgedRelease } })).toThrow("package identity mismatch");
  });

  it("applies idempotently and refuses to overwrite customer files", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-"))); roots.push(root);
    const plan = planCreateKnexApplication({ applicationId: "customer-beta", applicationName: "Customer Beta", theme: "neobrutalism", database: "external" });
    const first = applyCreateKnexApplication(plan, root);
    expect(first.written).toContain("k-nex.app.json");
    expect(first.written).not.toContain("compose.yaml");
    expect(applyCreateKnexApplication(plan, root).unchanged).toEqual(Object.keys(plan.files));
    expect(readFileSync(join(root, ".k-nex/default-pages.json"), "utf8")).toContain("sales.page.tasks");
    writeFileSync(join(root, "package.json"), "customer edit\n");
    expect(() => applyCreateKnexApplication(plan, root)).toThrow("refuses to overwrite package.json");
  });

  it("writes byte-identical controlled source to different clean targets", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-determinism-"))); roots.push(root);
    const plan = planCreateKnexApplication({ applicationId: "customer-deterministic", applicationName: "Customer Deterministic", theme: "minimal", database: "external" });
    const first = join(root, "first");
    const second = join(root, "second");
    applyCreateKnexApplication(plan, first);
    applyCreateKnexApplication(plan, second);
    for (const path of Object.keys(plan.files)) expect(readFileSync(join(first, path))).toEqual(readFileSync(join(second, path)));
  });

  it("keeps CLI plan-only side-effect free and no-install complete", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-cli-"))); roots.push(root);
    const script = fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url));
    const planned = join(root, "planned");
    const output = execFileSync(process.execPath, [script, "--target", planned, "--id", "cli-planned", "--name", "CLI Planned", "--database", "external", "--plan-only"], { encoding: "utf8" });
    expect(JSON.parse(output).applicationId).toBe("cli-planned");
    expect(existsSync(planned)).toBe(false);
    const written = join(root, "written");
    execFileSync(process.execPath, [script, "--target", written, "--id", "cli-written", "--name", "CLI Written", "--database", "external", "--no-install"], { encoding: "utf8" });
    expect(readdirSync(written)).toEqual(expect.arrayContaining([".env.example", "package.json", "src"]));
    expect(existsSync(join(written, "node_modules"))).toBe(false);
    expect(existsSync(join(written, "pnpm-lock.yaml"))).toBe(false);
  }, 15_000);

  it("preflights every destination and never partially writes or follows symlinks", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-"))); roots.push(root);
    const plan = planCreateKnexApplication({ applicationId: "customer-gamma", applicationName: "Customer Gamma", theme: "minimal", database: "external" });
    writeFileSync(join(root, "package.json"), "customer edit\n");
    expect(() => applyCreateKnexApplication(plan, root)).toThrow("refuses to overwrite package.json");
    expect(existsSync(join(root, "src", "payload.config.ts"))).toBe(false);

    const outside = mkdtempSync(join(tmpdir(), "create-knex-app-outside-")); roots.push(outside);
    const linkedRoot = join(root, "linked");
    symlinkSync(outside, linkedRoot);
    expect(() => applyCreateKnexApplication(plan, join(linkedRoot, "app"))).toThrow("symlinked target paths");
    expect(existsSync(join(outside, "app"))).toBe(false);
  });
});
