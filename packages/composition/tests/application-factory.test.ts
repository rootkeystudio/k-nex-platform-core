import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(first.installCommands).toEqual([["pnpm", "install", "--lockfile-only"], ["pnpm", "install", "--frozen-lockfile"]]);
  });

  it("applies idempotently and refuses to overwrite customer files", () => {
    const root = mkdtempSync(join(tmpdir(), "create-knex-app-")); roots.push(root);
    const plan = planCreateKnexApplication({ applicationId: "customer-beta", applicationName: "Customer Beta", theme: "neobrutalism", database: "external" });
    const first = applyCreateKnexApplication(plan, root);
    expect(first.written).toContain("k-nex.app.json");
    expect(first.written).not.toContain("compose.yaml");
    expect(applyCreateKnexApplication(plan, root).unchanged).toEqual(Object.keys(plan.files));
    expect(readFileSync(join(root, ".k-nex/default-pages.json"), "utf8")).toContain("sales.page.tasks");
    writeFileSync(join(root, "package.json"), "customer edit\n");
    expect(() => applyCreateKnexApplication(plan, root)).toThrow("refuses to overwrite package.json");
  });
});
