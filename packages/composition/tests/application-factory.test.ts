import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ApplicationManifestSchema, PackageReleaseManifestSchema, canonicalJson, type PackageReleaseManifest, type PackageReleaseManifestAuthority, type VerifiedPackageReleaseManifest } from "@k-nex/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { applyCreateKnexApplication, planCreateKnexApplication } from "../src/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function verifiedPackageSource(manifestInput: unknown, directory: string) {
  const manifest = PackageReleaseManifestSchema.parse(manifestInput);
  const values = new WeakMap<object, { manifest: PackageReleaseManifest; digest: string; attestation: unknown }>();
  const authority: PackageReleaseManifestAuthority = {
    async verify() { throw new Error("Test authority does not accept unissued manifests."); },
    read(token) {
      const value = values.get(token);
      if (value === undefined) throw new Error("Test release manifest was not issued by this authority.");
      return value;
    }
  };
  const release = Object.freeze({}) as VerifiedPackageReleaseManifest;
  values.set(release, { manifest, digest: `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`, attestation: Object.freeze({}) });
  return { kind: "packed-mirror" as const, directory, authority, release };
}

function hostedVerification(manifestInput: unknown) {
  const manifest = PackageReleaseManifestSchema.parse(manifestInput);
  const sourceCommit = "a".repeat(40);
  const workflowIdentity = `rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@${sourceCommit}`;
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "package-release-manifest.json", digest: { sha256: createHash("sha256").update(canonicalJson(manifest)).digest("hex") } }],
    predicateType: "https://k-nex.dev/release-manifest/v1",
    predicate: { sourceCommit, workflowIdentity, materials: [] }
  };
  return [{
    attestation: { bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } },
    verificationResult: { statement, signature: { certificate: {
      githubWorkflowRepository: "rootkeystudio/k-nex-platform-core", runnerEnvironment: "github-hosted", sourceRepositoryDigest: sourceCommit,
      githubWorkflowSHA: sourceCommit, buildConfigDigest: sourceCommit, githubWorkflowRef: "refs/heads/main",
      buildConfigURI: "https://github.com/rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@refs/heads/main"
    } } }
  }];
}

function fakeGh(root: string, verification: unknown) {
  const directory = join(root, "bin"); mkdirSync(directory);
  const path = join(directory, "gh");
  writeFileSync(path, `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.GH_ARGS_LOG, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(JSON.stringify(verification))});\n`);
  chmodSync(path, 0o755);
  return directory;
}

describe("create-knex-app", () => {
  it("serializes generated JSX application names", () => {
    for (const applicationName of ["Workspace {alpha}", 'Workspace "alpha"', "Workspace\nalpha", "Workspace\u0000\u001f\talpha"]) {
      const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName, theme: "minimal" });
      const expression = `{${JSON.stringify(applicationName)}}`;
      expect(files["src/app/(workspace)/page.tsx"]).toContain(`<h1>${expression}</h1>`);
      expect(files["src/app/(workspace)/layout.tsx"]).toContain(`applicationLabel=${expression}`);
    }
  });

  it("plans deterministic exact Sales applications for local or external Postgres", () => {
    const options = { applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal", database: "docker-postgres" } as const;
    const first = planCreateKnexApplication(options);
    expect(planCreateKnexApplication(options)).toEqual(first);
    expect(first.files["compose.yaml"]).toContain("postgres:17.6-alpine@sha256:");
    const manifest = ApplicationManifestSchema.parse(JSON.parse(first.files["k-nex.app.json"]!));
    expect(manifest.plugins).toEqual([{ id: "module.sales", package: "@k-nex/module-sales", version: "1.0.0", enabled: true }]);
    expect(manifest.builder).toEqual({ plugin: "builder.puck", package: "@k-nex/builder-puck", version: "1.0.0", profiles: { workspace: { enabled: true, drafts: true, surfaces: ["workspace"] } } });
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
    expect(first.files["src/k-nex-registry.ts"]).not.toContain("salesPageTemplates");
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
    expect(first.files["src/k-nex-bootstrap-token.ts"]).toContain("update k_nex_owner_bootstrap_tokens set consumed_at=now() where application_id=$1 and environment=$2 and consumed_at is null");
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain("acquireBootstrapLock");
    expect(first.files["src/k-nex-bootstrap-owner.ts"]!.indexOf("const priorReceipt")).toBeLessThan(first.files["src/k-nex-bootstrap-owner.ts"]!.indexOf("const existing = await payload.find"));
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
      "knex:worker": "node dist/k-nex-worker.js",
      start: "next start"
    });
    expect(packageJson.scripts).not.toHaveProperty("knex:readiness");
    const applicationPlan = JSON.parse(first.files[".k-nex/application-plan.json"]!);
    expect(applicationPlan.packageSource.kind).toBe("workspace");
    expect(applicationPlan.composition).toMatchObject({ plugins: ["module.sales@1.0.0"], builder: "builder.puck@1.0.0" });
    expect(first.files[".k-nex/default-pages.json"]).toBeUndefined();
    expect(first.files[".k-nex/package-release-manifest.json"]).toBeUndefined();
    expect(Object.values(first.files).every((source) => !source.includes("defaultPages") && !source.includes("default-pages") && !source.includes("salesPageTemplates"))).toBe(true);
    expect(first.files[".env.example"]!.split("\n").filter(Boolean).every((line) => line.endsWith("="))).toBe(true);
    expect(first.files["src/k-nex-users.ts"]).toContain('secure: kNexIdentity.publicOrigin.protocol === "https:"');
    expect(Object.values(first.files).some((source) => source.includes("K_NEX_OWNER_PASSWORD="))).toBe(true);
    expect(Object.values(first.files).every((source) => !source.includes("K_NEX_OWNER_PASSWORD=secret"))).toBe(true);
    expect(first.files["pnpm-lock.yaml"]).toBeUndefined();
    expect(first.installCommands).toEqual([]);
  });

  it("binds a generated application to every exact artifact in a packed release mirror", () => {
    const release = JSON.parse(readFileSync(new URL("../../../releases/1.0.0/package-release-manifest.json", import.meta.url), "utf8"));
    const mirror = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    const plan = planCreateKnexApplication({
      applicationId: "packed-customer", applicationName: "Packed Customer", theme: "minimal", database: "external",
      packageSource: verifiedPackageSource(release, mirror)
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
    const packageReleaseManifest = plan.files[".k-nex/package-release-manifest.json"]!;
    expect(packageReleaseManifest).toBe(canonicalJson(PackageReleaseManifestSchema.parse(release)));
    expect(`sha256:${createHash("sha256").update(packageReleaseManifest).digest("hex")}`).toBe(JSON.parse(plan.files[".k-nex/application-plan.json"]!).packageSource.manifestDigest);
    expect(plan.files["pnpm-lock.yaml"]).toContain("lockfileVersion: '9.0'");
    const neobrutalism = planCreateKnexApplication({
      applicationId: "packed-neobrutalism", applicationName: "Packed Neobrutalism", theme: "neobrutalism", database: "external",
      packageSource: verifiedPackageSource(release, mirror)
    });
    expect(neobrutalism.files["pnpm-lock.yaml"]).not.toBe(plan.files["pnpm-lock.yaml"]);
    expect(neobrutalism.files["pnpm-lock.yaml"]).toContain("k-nex-theme-neobrutalism-1.0.0.tgz");
    expect(plan.installCommands).toEqual([["pnpm", "install", "--frozen-lockfile"]]);
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
    for (const entry of Object.values(release.factoryLockTemplates) as { theme: string; digest: string }[]) {
      const filename = `factory-lock-sales-reference-${entry.theme}-${entry.digest.slice(7)}.yaml`;
      copyFileSync(join(source, filename), join(mirror, filename));
    }
    const options = { applicationId: "packed-customer", applicationName: "Packed Customer", theme: "minimal", database: "external", packageSource: verifiedPackageSource(release, mirror) } as const;
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
    expect(() => planCreateKnexApplication({ ...options, packageSource: verifiedPackageSource(forgedRelease, mirror) })).toThrow("package identity mismatch");
    expect(() => planCreateKnexApplication({ ...options, packageSource: { ...options.packageSource, release: release as never } })).toThrow("not issued by this authority");
  });

  it("applies idempotently and refuses to overwrite customer files", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-"))); roots.push(root);
    const plan = planCreateKnexApplication({ applicationId: "customer-beta", applicationName: "Customer Beta", theme: "neobrutalism", database: "external" });
    const first = applyCreateKnexApplication(plan, root);
    expect(first.written).toContain("k-nex.app.json");
    expect(first.written).not.toContain("compose.yaml");
    expect(applyCreateKnexApplication(plan, root).unchanged).toEqual(Object.keys(plan.files));
    expect(existsSync(join(root, ".k-nex/default-pages.json"))).toBe(false);
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

  it("uses workspace only for side-effect-free planning and defaults to the verified bundled release", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-cli-"))); roots.push(root);
    const script = fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url));
    const planned = join(root, "planned");
    const output = execFileSync(process.execPath, [script, "--target", planned, "--id", "cli-planned", "--name", "CLI Planned", "--database", "external", "--workspace", "--plan-only"], { encoding: "utf8" });
    expect(JSON.parse(output).applicationId).toBe("cli-planned");
    expect(JSON.parse(output).installCommands).toEqual([]);
    expect(existsSync(planned)).toBe(false);
    const manifestPath = fileURLToPath(new URL("../../../releases/1.0.0/package-release-manifest.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const argsLog = join(root, "gh-args.json");
    const bin = fakeGh(root, hostedVerification(manifest));
    const written = join(root, "written");
    execFileSync(process.execPath, [script, "--target", written, "--id", "cli-written", "--name", "CLI Written", "--database", "external", "--no-install"], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_ARGS_LOG: argsLog }
    });
    expect(readdirSync(written)).toEqual(expect.arrayContaining([".env.example", "package.json", "pnpm-lock.yaml", "src"]));
    expect(existsSync(join(written, "node_modules"))).toBe(false);
    expect(JSON.parse(readFileSync(argsLog, "utf8"))).toEqual([
      "attestation", "verify", manifestPath, "--repo", "rootkeystudio/k-nex-platform-core",
      "--predicate-type", "https://k-nex.dev/release-manifest/v1", "--format", "json"
    ]);
    const explicit = join(root, "explicit");
    execFileSync(process.execPath, [script, "--target", explicit, "--id", "cli-explicit", "--name", "CLI Explicit", "--database", "external", "--release-manifest", manifestPath, "--package-mirror", fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url)), "--no-install"], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_ARGS_LOG: join(root, "explicit-gh-args.json") }
    });
    expect(existsSync(join(explicit, "pnpm-lock.yaml"))).toBe(true);
  }, 15_000);

  it("rejects workspace apply or no-install before target write", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-workspace-"))); roots.push(root);
    const script = fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url));
    for (const [name, mode, error] of [["apply", [], "--workspace requires --plan-only"], ["no-install", ["--plan-only", "--no-install"], "--workspace is plan-only"]] as const) {
      const target = join(root, name);
      expect(() => execFileSync(process.execPath, [script, "--target", target, "--id", `workspace-${name}`, "--name", "Workspace Rejected", "--workspace", ...mode], { encoding: "utf8", stdio: "pipe" })).toThrow(error);
      expect(existsSync(target)).toBe(false);
    }
  });

  it("rejects a coherently forged manifest, tarball, and lock before target write", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-forged-"))); roots.push(root);
    const sourceManifestPath = fileURLToPath(new URL("../../../releases/1.0.0/package-release-manifest.json", import.meta.url));
    const original = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
    const mirrorSource = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    const mirror = join(root, "mirror"); mkdirSync(mirror);
    for (const filename of readdirSync(mirrorSource)) copyFileSync(join(mirrorSource, filename), join(mirror, filename));
    const forged = structuredClone(original);
    const packed = forged.packages.find((entry: { package: string }) => entry.package === "@k-nex/module-sales");
    const packedPath = join(mirror, `k-nex-module-sales-${packed.version}.tgz`);
    const packedBytes = readFileSync(packedPath); packedBytes[9] = packedBytes[9] === 0xff ? 0x03 : 0xff; writeFileSync(packedPath, packedBytes);
    packed.integrity = `sha512-${createHash("sha512").update(packedBytes).digest("base64")}`;
    const lock = forged.factoryLockTemplates.minimal;
    const oldLock = join(mirror, `factory-lock-sales-reference-minimal-${lock.digest.slice(7)}.yaml`);
    const lockContent = `${readFileSync(oldLock, "utf8")}# forged\n`;
    lock.digest = `sha256:${createHash("sha256").update(lockContent).digest("hex")}`;
    const newLock = join(mirror, `factory-lock-sales-reference-minimal-${lock.digest.slice(7)}.yaml`);
    writeFileSync(newLock, lockContent); rmSync(oldLock);
    const manifestPath = join(root, "package-release-manifest.json"); writeFileSync(manifestPath, `${JSON.stringify(forged, null, 2)}\n`);
    const bin = fakeGh(root, hostedVerification(original));
    const target = join(root, "target");
    expect(() => execFileSync(process.execPath, [fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url)), "--target", target, "--id", "forged", "--name", "Forged", "--database", "external", "--release-manifest", manifestPath, "--package-mirror", mirror, "--no-install"], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_ARGS_LOG: join(root, "forged-gh-args.json") }, stdio: "pipe"
    })).toThrow();
    expect(existsSync(target)).toBe(false);
  }, 15_000);

  it("rejects nonofficial hosted workflow and source identities before target write", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-identity-"))); roots.push(root);
    const manifestPath = fileURLToPath(new URL("../../../releases/1.0.0/package-release-manifest.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const mirror = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    const script = fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url));
    for (const [name, mutate] of [
      ["workflow", (entry: any) => { entry.verificationResult.signature.certificate.githubWorkflowRepository = "attacker/repository"; }],
      ["source", (entry: any) => { entry.verificationResult.signature.certificate.sourceRepositoryDigest = "b".repeat(40); }]
    ] as const) {
      const verification = hostedVerification(manifest); mutate(verification[0]);
      const caseRoot = join(root, name); mkdirSync(caseRoot);
      const bin = fakeGh(caseRoot, verification);
      const target = join(caseRoot, "target");
      expect(() => execFileSync(process.execPath, [script, "--target", target, "--id", `identity-${name}`, "--name", `Identity ${name}`, "--database", "external", "--release-manifest", manifestPath, "--package-mirror", mirror, "--no-install"], {
        encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_ARGS_LOG: join(caseRoot, "gh-args.json") }, stdio: "pipe"
      })).toThrow();
      expect(existsSync(target)).toBe(false);
    }
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
