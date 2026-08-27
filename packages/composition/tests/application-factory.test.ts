import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    expect(JSON.parse(first.files["package.json"]!).dependencies).toMatchObject({ payload: "3.88.0", "@k-nex/module-sales": "1.0.0", "@k-nex/theme-minimal": "0.0.0" });
    expect(first.files["src/payload.config.ts"]).toContain("kNexSalesRegistry.collections");
    expect(first.files["src/k-nex-registry.ts"]).toContain("salesRegistration");
    expect(first.files["src/k-nex-readiness.ts"]).toContain("K_NEX_SALES_READY");
    expect(first.installCommands).toEqual([["pnpm", "install", "--lockfile-only"], ["pnpm", "install", "--frozen-lockfile"]]);
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
