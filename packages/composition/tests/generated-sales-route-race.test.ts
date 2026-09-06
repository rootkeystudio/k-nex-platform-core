import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";

it("fails the complete generated detail projection when ownership changes during a blocked private history read", async () => {
  const directory = mkdtempSync(join(tmpdir(), "k-nex-sales-route-race-"));
  try {
    const generated = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-sales-routes.ts"]!;
    const source = generated
      .replace('import "server-only";\n', "")
      .replace(/import \{ canonicalJson,[^;]+from "@k-nex\/contracts";/u, 'import { canonicalJson } from "./stubs.mjs";')
      .replace(/import \{ salesTimelineDescriptor \} from "@k-nex\/module-sales\/contracts";/u, 'import { salesTimelineDescriptor } from "./stubs.mjs";')
      .replace(/import \{ projectSalesStateHistory,[^;]+from "@k-nex\/module-sales\/server";/u, 'import { projectSalesStateHistory } from "./stubs.mjs";')
      .replace('import type { Payload } from "payload";\n', "")
      .replace(/import \{ currentSalesGeneration[^;]+from "\.\/k-nex-authority\.js";/u, 'import { currentSalesGeneration as currentSalesAuthorityGeneration } from "./stubs.mjs";')
      .replace('import { kNexIdentity } from "./k-nex-identity.js";', 'import { kNexIdentity } from "./stubs.mjs";')
      .replace('import { kNexSalesRegistry } from "./k-nex-registry.js";', 'import { kNexSalesRegistry } from "./stubs.mjs";')
      .replace(/import \{ executeWorkspaceSalesAction,[^;]+from "\.\/k-nex-sales-workspace\.js";/u, 'import { executeWorkspaceSalesAction, loadWorkspaceSalesSources, workspaceSalesPermissions } from "./stubs.mjs";');
    writeFileSync(join(directory, "routes.mjs"), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText);
    writeFileSync(join(directory, "stubs.mjs"), `
export const control = globalThis.__kNexGeneratedRouteRace ??= { authorized: true, sourceCalls: 0, authorizationRevision: 1, permissions: ["sales.accounts.read", "sales.activities.read", "sales.notes.body.read"], finalGate: undefined, historyOptions: [] };
export const canonicalJson = JSON.stringify;
export const kNexIdentity = { applicationId: "customer-alpha", environment: "production" };
export const salesTimelineDescriptor = { id: "sales.timeline", version: 1, structuralCompatibilityHash: "sha256:${"a".repeat(64)}" };
const document = { id: "sales.page.account-detail", version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [{ id: "primary", type: "sales.account-detail", version: 2, props: {}, bindings: { source: { source: { id: "sales.account.detail", version: 1 }, input: { id: "$route.id" }, structuralCompatibilityHash: "sha256:${"b".repeat(64)}", selectedFields: ["name", "owner-id", "team-id", "status", "revision"] } } }] } };
export const kNexSalesRegistry = { scopedRegistration: { contributions: {
  routes: [{ id: "sales.route.account-detail", value: { id: "sales.route.account-detail", ownerPluginId: "module.sales", permission: "sales.accounts.read", viewId: "sales.page.account-detail", parameters: { id: { type: "string" } } } }],
  pageTemplates: [{ id: "sales.page.account-detail", value: { id: "sales.page.account-detail", ownerPluginId: "module.sales", route: { routeId: "sales.route.account-detail" }, permission: "sales.accounts.read", document, requirements: { actions: [] } } }], actions: []
} } };
export const currentSalesGeneration = async () => ({ state: { authorizationRevision: control.authorizationRevision, lifecycleRevision: 1 } });
export const workspaceSalesPermissions = async () => [...control.permissions];
const sensitive = { fields: ["name", "owner-id", "team-id", "status", "revision"], rows: [{ key: "1", values: { name: { kind: "text", value: "protected-record" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": { kind: "text", value: "team-1" }, status: { kind: "status", value: "active" }, revision: { kind: "integer", value: 1 } } }], page: { number: 1, pageSize: 1, hasNext: false } };
export async function loadWorkspaceSalesSources(_payload, _context, candidate) {
  if (candidate.regions.main.at(-1)?.id === "sales-fixed-timeline") return { "sales-fixed-timeline": { state: "success", data: { fields: ["kind", "subject", "status", "occurred-at", "revision", "body"], rows: [{ key: "note:2", values: { kind: { kind: "text", value: "note" }, subject: { kind: "text", value: "private" }, status: { kind: "status", value: "recorded" }, "occurred-at": { kind: "text", value: "2026-09-06T00:00:00.000Z" }, revision: { kind: "integer", value: 1 }, body: { kind: "text", value: "protected-note" } } }], page: { number: 1, pageSize: 25, hasNext: false } } } };
  control.sourceCalls += 1;
  if (control.sourceCalls === 2 && control.finalGate !== undefined) { control.finalGate.entered.resolve(); await control.finalGate.release.promise; }
  return { primary: control.authorized ? { state: "success", data: sensitive } : { state: "empty" } };
}
export const projectSalesStateHistory = ({ audit }) => { if (audit === "malformed") throw new TypeError("Sales audit history is invalid."); return [{ actionId: "sales.account.update", stateField: "status", fromState: "active", toState: "active", revision: 1, occurredAt: "2026-09-06T00:00:00.000Z" }]; };
export const executeWorkspaceSalesAction = async () => undefined;
`);
    const routes = await import(`${pathToFileURL(join(directory, "routes.mjs")).href}?race`);
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    const payload = { find: async (options: unknown) => { const control = (globalThis as typeof globalThis & { __kNexGeneratedRouteRace: { historyOptions: unknown[] } }).__kNexGeneratedRouteRace; control.historyOptions.push(options); entered.resolve(); await release.promise; return { docs: [{ id: "1", applicationId: "customer-alpha", environment: "production", revision: 1, ownerId: "owner-1", teamId: "team-1", status: "active", audit: [] }] }; } };
    const pending = routes.loadRegisteredSalesRoute(payload, {}, "sales.route.account-detail", { id: "1" });
    await entered.promise;
    const control = (globalThis as typeof globalThis & { __kNexGeneratedRouteRace: { authorized: boolean; sourceCalls: number; authorizationRevision: number; permissions: string[]; finalGate?: { entered: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> }; historyOptions: unknown[] } }).__kNexGeneratedRouteRace;
    control.authorized = false;
    expect(Object.keys((control.historyOptions[0] as { select: Record<string, unknown> }).select).sort()).toEqual(["applicationId", "audit", "environment", "id", "ownerId", "revision", "status", "teamId"]);
    expect(JSON.stringify(control.historyOptions[0])).not.toMatch(/amount|email|phone/u);
    release.resolve();
    const ownershipError = await pending.then(() => "resolved", (error: unknown) => String(error));
    expect(ownershipError).toContain("changed or is no longer authorized");
    expect(ownershipError).not.toContain("protected-record"); expect(ownershipError).not.toContain("protected-note");
    expect(control.sourceCalls).toBe(2);

    control.authorized = true; control.sourceCalls = 0; control.authorizationRevision = 1;
    control.permissions = ["sales.accounts.read", "sales.activities.read", "sales.notes.body.read"];
    control.finalGate = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
    const grantRace = routes.loadRegisteredSalesRoute({ find: async () => ({ docs: [{ id: "1", applicationId: "customer-alpha", environment: "production", revision: 1, ownerId: "owner-1", teamId: "team-1", status: "active", audit: [] }] }) }, {}, "sales.route.account-detail", { id: "1" });
    await control.finalGate.entered.promise;
    control.authorizationRevision = 2;
    control.permissions = ["sales.accounts.read", "sales.activities.read"];
    control.finalGate.release.resolve();
    const grantError = await grantRace.then(() => "resolved", (error: unknown) => String(error));
    expect(grantError).toContain("authority changed during final record authorization");
    expect(grantError).not.toContain("protected-record"); expect(grantError).not.toContain("protected-note");
    expect(control.sourceCalls).toBe(2);

    control.authorized = true; control.sourceCalls = 0; control.authorizationRevision = 1; control.finalGate = undefined; control.historyOptions = [];
    const historyPayload = { find: async (options: unknown) => { control.historyOptions.push(options); return { docs: [{ id: "1", applicationId: "customer-alpha", environment: "production", revision: 1, ownerId: "owner-1", teamId: "team-1", status: "active", audit: [] }] }; } };
    const rendered = await routes.loadRegisteredSalesRoute(historyPayload, {}, "sales.route.account-detail", { id: "1" });
    expect(rendered.stateHistory).toHaveLength(1);
    expect(Object.keys((control.historyOptions[0] as { select: Record<string, unknown> }).select).sort()).toEqual(["applicationId", "audit", "environment", "id", "ownerId", "revision", "status", "teamId"]);
    expect(JSON.stringify(rendered)).not.toMatch(/amount|email|phone/u);

    const malformedError = await routes.loadRegisteredSalesRoute({ find: async (options: unknown) => { control.historyOptions.push(options); return { docs: [{ id: "1", applicationId: "customer-alpha", environment: "production", revision: 1, ownerId: "owner-1", teamId: "team-1", status: "active", audit: "malformed" }] }; } }, {}, "sales.route.account-detail", { id: "1" }).then(() => "resolved", (error: unknown) => String(error));
    expect(malformedError).toContain("Sales audit history is invalid.");
  } finally {
    delete (globalThis as typeof globalThis & { __kNexGeneratedRouteRace?: unknown }).__kNexGeneratedRouteRace;
    rmSync(directory, { recursive: true, force: true });
  }
});
