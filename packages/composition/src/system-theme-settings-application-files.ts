export interface SystemThemeSettingsApplicationFilesOptions {
  readonly applicationId: string;
}

function runtimeSource(): string {
  return `import { randomUUID } from "node:crypto";

import { SystemSettingsDescriptorSchema, ThemeProfileSchema } from "@k-nex/contracts";
import { CurrentAuthorityThemeProfileAuthorizer, PostgresRuntimeExtensionStore, PostgresSystemSettingsDescriptorSource, PostgresSystemSettingsStore, PostgresThemeProfileStore, SharedStaticPlatformPluginGenerationRebinder, type RuntimeExtensionPool } from "@k-nex/payload-adapter";
import { SystemSettingsAdministrationService, SystemThemeAdministrationService } from "@k-nex/runtime";
import type { Payload } from "payload";

import { kNexAuthority, reauthenticateCurrentUser, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexInitialThemeProfile } from "./k-nex-registry.js";
import { kNexHostInventoryDigest } from "./k-nex-system-extensions.js";

export const systemGeneralSettingsDescriptor = SystemSettingsDescriptorSchema.parse({
  schemaVersion: 1,
  id: "system.general",
  publisher: { kind: "platform", namespace: "system" },
  descriptorSchemaVersion: 1,
  validation: "immediate",
  fields: { siteName: { type: "string", required: true, default: "K-Nex" } },
  readPermission: "system.settings.read",
  changePermission: "system.settings.manage"
});

const clock = Object.freeze({ now: () => new Date() });
const noExtensionSettings = Object.freeze({ resolve: (_input: unknown) => [] });

function themeProfileValidator(input: Readonly<{ profile: Readonly<{ themeId: string; themeVersion: string; surface: string; skin?: unknown }> }>): void {
  if (input.profile.themeId !== kNexInitialThemeProfile.themeId || input.profile.themeVersion !== kNexInitialThemeProfile.themeVersion || input.profile.surface !== "admin" || input.profile.skin !== undefined) {
    throw new TypeError("Theme Profile is incompatible with installed theme authority.");
  }
}

function themeCatalog(payload: Payload) {
  const store = new PostgresRuntimeExtensionStore(
    payload.db.pool as RuntimeExtensionPool,
    clock,
    kNexHostInventoryDigest,
    { sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder() }
  );
  return Object.freeze({
    read: async () => Object.freeze({
      packages: Object.freeze([{ id: kNexInitialThemeProfile.themeId, version: kNexInitialThemeProfile.themeVersion, displayName: kNexInitialThemeProfile.themeId, surfaces: Object.freeze(["admin"] as const), availability: "installed" as const }]),
      inventory: await store.inventory(kNexIdentity.applicationId, kNexIdentity.environment),
      catalog: Object.freeze([])
    })
  });
}

export function systemThemeAdministration(payload: Payload, context: KnexRequestContext, password?: string) {
  const authority = kNexAuthority(payload);
  const profiles = new PostgresThemeProfileStore(
    payload.db.pool as RuntimeExtensionPool,
    clock,
    new CurrentAuthorityThemeProfileAuthorizer(authority.adapter, () => context, {
      verify: async () => password !== undefined && reauthenticateCurrentUser(payload, context, password)
    }),
    { validate: themeProfileValidator }
  );
  return new SystemThemeAdministrationService({ authority: authority.adapter, state: authority.store, profiles: { resolve: () => profiles }, catalog: themeCatalog(payload) });
}

export function systemSettingsAdministration(payload: Payload, password?: string) {
  const authority = kNexAuthority(payload);
  return new SystemSettingsAdministrationService({
    authority: authority.adapter,
    state: authority.store,
    store: new PostgresSystemSettingsStore(payload.db.pool as RuntimeExtensionPool),
    descriptorSource: new PostgresSystemSettingsDescriptorSource(payload.db.pool as RuntimeExtensionPool, {
      platformDescriptors: [systemGeneralSettingsDescriptor], platformPlugins: noExtensionSettings, hotApplications: noExtensionSettings
    }),
    metadata: { id: (kind) => "settings-" + kind + "-" + randomUUID(), now: () => new Date() },
    evidence: {
      verify: async ({ context }) => {
        if (password === undefined || !await reauthenticateCurrentUser(payload, context, password)) throw new TypeError("Reauthentication failed.");
        const verifiedAt = new Date();
        return Object.freeze({ reauthentication: "satisfied" as const, evidenceId: "settings-reauth-" + randomUUID(), verifiedAt: verifiedAt.toISOString(), expiresAt: new Date(verifiedAt.valueOf() + 300_000).toISOString() });
      }
    }
  });
}

export function systemRouteId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u.test(value)) throw new TypeError("System route identity is invalid.");
  return value;
}

export function systemText(form: FormData, name: string, maximum: number): string {
  if (form.getAll(name).length !== 1) throw new TypeError("System administration form is invalid.");
  const value = form.get(name);
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > maximum || /[\\u0000-\\u001f\\u007f-\\u009f]/u.test(value)) throw new TypeError("System administration form is invalid.");
  return value;
}

export function systemPassword(form: FormData): string {
  if (form.getAll("password").length !== 1) throw new TypeError("System administration form is invalid.");
  const value = form.get("password");
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024 || value.includes("\\u0000")) throw new TypeError("System administration password is invalid.");
  return value;
}

export function systemJson(form: FormData, name: string, maximum: number): unknown {
  const value = systemText(form, name, maximum);
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("System administration JSON is invalid.");
  return parsed;
}

export function themeProfileForRoute(profileId: string, value: unknown): unknown {
  const profile = ThemeProfileSchema.parse(value);
  if (profile.id !== profileId) throw new TypeError("Theme Profile route identity is invalid.");
  return profile;
}

export function systemMutationError(error: unknown): Response {
  const candidate = error instanceof Error ? error as Error & { code?: unknown } : undefined;
  const code = typeof candidate?.code === "string" ? candidate.code : "MUTATION_INVALID";
  return Response.json({ code }, { status: code === "UNAUTHORIZED" ? 403 : code === "REVISION_CONFLICT" ? 409 : 400, headers: { "cache-control": "no-store" } });
}

export function publishedThemeProfile(profile: Readonly<{ revision: unknown }>): unknown {
  const { revision: rawRevision, ...content } = profile;
  if (rawRevision === null || typeof rawRevision !== "object" || Array.isArray(rawRevision)) throw new TypeError("Theme Profile revision is invalid.");
  const revision = rawRevision as Readonly<Record<string, unknown>>;
  const { state: _state, archivedAt: _archivedAt, ...identity } = revision;
  return { ...content, revision: { ...identity, state: "published", publishedAt: new Date().toISOString() } };
}
`;
}

function navigationSource(): string {
  return `const systemAdministrationNavigation = Object.freeze([
  { id: "settings", label: "Settings", href: "/system/settings" },
  { id: "themes", label: "Themes", href: "/system/themes" },
  { id: "roles", label: "Roles", href: "/system/access/roles" },
  { id: "permissions", label: "Permissions", href: "/system/access/permissions" },
  { id: "assignments", label: "Assignments", href: "/system/access/assignments" },
  { id: "audit", label: "Authorization audit", href: "/system/access/audit" },
  { id: "extensions", label: "Extensions", href: "/system/extensions" },
  { id: "operations", label: "Operations", href: "/system/operations" }
]);
`;
}

function settingsPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemSettingsPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../boot.js";
import { kNexRequestContext } from "../../../../k-nex-authority.js";
import { systemSettingsAdministration } from "../../../../k-nex-system-theme-settings.js";

export const dynamic = "force-dynamic";

export default async function SystemSettingsPageRoute() {
  const payload = await bootKnexApplication("system-settings");
  const context = kNexRequestContext(await headers(), "system-settings");
  try {
    const settings = await systemSettingsAdministration(payload).list({ context });
    return <SystemSettingsPage view={{ navigation: systemAdministrationNavigation, title: "Settings", settings: settings.map((item) => ({ id: item.identity.descriptorId, label: item.identity.descriptorId, href: "/system/settings/" + encodeURIComponent(item.identity.descriptorId), owner: item.identity.owner.kind === "platform" ? "Platform system" : item.identity.owner.extensionId, state: item.state, revision: item.documentRevision + "/" + item.settingsRevision })) }} />;
  } catch { notFound(); }
}

${navigationSource()}`;
}

function settingsDetailPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemSettingsDetailPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../../boot.js";
import { authorizeRequest, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { systemRouteId, systemSettingsAdministration } from "../../../../../k-nex-system-theme-settings.js";

export const dynamic = "force-dynamic";

export default async function SystemSettingsDetailRoute({ params }: Readonly<{ params: Promise<{ settingsId: string }> }>) {
  const payload = await bootKnexApplication("system-settings-detail");
  const context = kNexRequestContext(await headers(), "system-settings-detail");
  try {
    const settingsId = systemRouteId((await params).settingsId);
    const item = await systemSettingsAdministration(payload).detail({ context, settingsId });
    if (!item) notFound();
    const canManage = await authorizeRequest(payload, context, "system.settings.manage", "system.settings");
    const values = Object.fromEntries(Object.entries(item.fields).flatMap(([key, field]) => field.kind === "visible-value" ? [[key, field.value]] : []));
    return <SystemSettingsDetailPage view={{ navigation: systemAdministrationNavigation, title: "Settings", settingsId, settingsLabel: settingsId, owner: item.identity.owner.kind === "platform" ? "Platform system" : item.identity.owner.extensionId, documentState: item.state,
      fields: Object.entries(item.fields).map(([id, field]) => ({ id, label: id, value: field.kind === "visible-value" ? String(field.value) : field.kind === "redacted-secret" ? "••••••" : "—", state: field.kind })),
      ...(canManage ? { save: { label: "Save settings", form: { actionUrl: "/api/system/settings/" + encodeURIComponent(settingsId), textArea: { name: "values", label: "Settings JSON", value: JSON.stringify(values) }, inputs: [{ name: "password", label: "Password", type: "password" }] } } } : {})
    }} />;
  } catch { notFound(); }
}

${navigationSource()}`;
}

function themesPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemThemesPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../boot.js";
import { kNexRequestContext } from "../../../../k-nex-authority.js";
import { systemThemeAdministration } from "../../../../k-nex-system-theme-settings.js";

export const dynamic = "force-dynamic";

export default async function SystemThemesRoute() {
  const payload = await bootKnexApplication("system-themes");
  const context = kNexRequestContext(await headers(), "system-themes");
  try {
    const themes = await systemThemeAdministration(payload, context).list({ context });
    return <SystemThemesPage view={{ navigation: systemAdministrationNavigation, title: "Themes",
      packages: themes.packages.map((item) => ({ id: item.id, label: item.displayName, version: item.version, surfaces: item.surfaces.join(", "), availability: item.availability, referenceImpact: item.removal === "blocked" ? "Blocked by " + item.references.length + " profile reference(s)" : "No references" })),
      skins: themes.skins.map((item) => ({ id: item.id, label: item.id, version: item.version ?? "—", lifecycle: item.disposition, actions: item.actions.map((action) => action.action).join(", ") || "None" })),
      profiles: themes.profiles.map((item) => { const profile = item.draft ?? item.active ?? item.previous; return { id: item.profileId, label: item.profileId, href: "/system/themes/profiles/" + encodeURIComponent(item.profileId), surface: profile?.surface ?? "—", package: profile ? profile.themeId + "@" + profile.themeVersion : "—", skin: profile?.skin ? profile.skin.id + "@" + profile.skin.version : "None", revision: String(item.revision), accessibility: profile ? "validated" : "unavailable" }; })
    }} />;
  } catch { notFound(); }
}

${navigationSource()}`;
}

function themeDetailPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemThemeProfileDetailPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../../../boot.js";
import { authorizeRequest, kNexRequestContext } from "../../../../../../k-nex-authority.js";
import { systemRouteId, systemThemeAdministration } from "../../../../../../k-nex-system-theme-settings.js";

export const dynamic = "force-dynamic";

export default async function SystemThemeProfileDetailRoute({ params }: Readonly<{ params: Promise<{ profileId: string }> }>) {
  const payload = await bootKnexApplication("system-theme-profile-detail");
  const context = kNexRequestContext(await headers(), "system-theme-profile-detail");
  try {
    const profileId = systemRouteId((await params).profileId);
    const item = await systemThemeAdministration(payload, context).detail({ context, profileId });
    if (!item) notFound();
    const profile = item.draft ?? item.active ?? item.previous;
    if (!profile) notFound();
    const canManage = await authorizeRequest(payload, context, "system.themes.manage", "system.themes");
    const base = "/api/system/themes/profiles/" + encodeURIComponent(profileId);
    return <SystemThemeProfileDetailPage view={{ navigation: systemAdministrationNavigation, title: "Theme Profile", profileLabel: profileId, profileId, surface: profile.surface, package: profile.themeId + "@" + profile.themeVersion, skin: profile.skin ? profile.skin.id + "@" + profile.skin.version : "None", publication: profile.revision.state, accessibility: "validated",
      ...(canManage ? { preview: { label: "Preview profile", form: { actionUrl: base + "/preview", textArea: { name: "profile", label: "Theme Profile JSON", value: JSON.stringify(profile) } } }, stage: { label: "Stage profile", form: { actionUrl: base + "/stage", textArea: { name: "profile", label: "Theme Profile JSON", value: JSON.stringify(profile) } } } } : {}),
      ...(canManage && item.draft ? { publish: { label: "Publish profile", form: { actionUrl: base + "/publish", inputs: [{ name: "password", label: "Password", type: "password" }] } } } : {}),
      ...(canManage && item.previous ? { rollback: { label: "Rollback profile", form: { actionUrl: base + "/rollback", inputs: [{ name: "password", label: "Password", type: "password" }] }, confirmation: { title: "Rollback Theme Profile", description: "Restore previous compatible profile.", confirmLabel: "Rollback" } } } : {})
    }} />;
  } catch { notFound(); }
}

${navigationSource()}`;
}

function settingsChangeRouteSource(): string {
  return `import { randomUUID } from "node:crypto";

import { SettingsChangeInputSchema } from "@k-nex/contracts";

import { exactFields, openWorkspaceForm, workspaceRedirect } from "../../../../../k-nex-workspace-page-http.js";
import { systemJson, systemMutationError, systemPassword, systemRouteId, systemSettingsAdministration } from "../../../../../k-nex-system-theme-settings.js";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ settingsId: string }> }>) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "system-settings-change");
    exactFields(form, ["password", "values"]);
    const settingsId = systemRouteId((await params).settingsId);
    const password = systemPassword(form);
    const service = systemSettingsAdministration(payload, password);
    const current = await service.detail({ context, settingsId });
    if (!current) throw new TypeError("Settings are unavailable.");
    const change = SettingsChangeInputSchema.parse({ expectedDocumentRevision: current.documentRevision, expectedSettingsRevision: current.settingsRevision, idempotencyKey: "settings-change-" + randomUUID(), values: systemJson(form, "values", 16_384) });
    await service.change({ context, settingsId, change });
    return workspaceRedirect("/system/settings/" + encodeURIComponent(settingsId));
  } catch (error) { return systemMutationError(error); }
}
`;
}

function themeMutationRouteSource(operation: "preview" | "stage" | "publish" | "rollback"): string {
  const depth = "../../../../../../../";
  const importLine = operation === "preview" || operation === "stage"
    ? `import { systemJson, systemMutationError, systemRouteId, systemThemeAdministration, themeProfileForRoute } from "${depth}k-nex-system-theme-settings.js";`
    : `import { publishedThemeProfile, systemMutationError, systemPassword, systemRouteId, systemThemeAdministration } from "${depth}k-nex-system-theme-settings.js";`;
  const form = operation === "preview" || operation === "stage" ? '["profile"]' : '["password"]';
  const action = operation === "preview"
    ? 'await service.preview({ context, profile: themeProfileForRoute(profileId, systemJson(form, "profile", 16_384)), expectedRevision: current.revision });'
    : operation === "stage"
      ? 'await service.stage({ context, profile: themeProfileForRoute(profileId, systemJson(form, "profile", 16_384)) });'
      : operation === "publish"
        ? 'if (!current.draft) throw new TypeError("Theme Profile draft is unavailable.");\n    await service.publish({ context, profile: publishedThemeProfile(current.draft), expectedRevision: current.revision });'
        : 'await service.rollback({ context, profileId, expectedRevision: current.revision });';
  const password = operation === "preview" || operation === "stage" ? "undefined" : "systemPassword(form)";
  return `import { exactFields, openWorkspaceForm, workspaceRedirect } from "${depth}k-nex-workspace-page-http.js";
${importLine}

export const runtime = "nodejs";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ profileId: string }> }>) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "system-theme-${operation}");
    exactFields(form, ${form});
    const profileId = systemRouteId((await params).profileId);
    const service = systemThemeAdministration(payload, context, ${password});
    const current = await service.detail({ context, profileId });
    if (!current) throw new TypeError("Theme Profile is unavailable.");
    ${action}
    return workspaceRedirect("/system/themes/profiles/" + encodeURIComponent(profileId));
  } catch (error) { return systemMutationError(error); }
}
`;
}

export function systemThemeSettingsApplicationFiles(_options: SystemThemeSettingsApplicationFilesOptions): Readonly<Record<string, string>> {
  return {
    "src/k-nex-system-theme-settings.ts": runtimeSource(),
    "src/app/(workspace)/system/settings/page.tsx": settingsPageSource(),
    "src/app/(workspace)/system/settings/[settingsId]/page.tsx": settingsDetailPageSource(),
    "src/app/(workspace)/system/themes/page.tsx": themesPageSource(),
    "src/app/(workspace)/system/themes/profiles/[profileId]/page.tsx": themeDetailPageSource(),
    "src/app/api/system/settings/[settingsId]/route.ts": settingsChangeRouteSource(),
    "src/app/api/system/themes/profiles/[profileId]/preview/route.ts": themeMutationRouteSource("preview"),
    "src/app/api/system/themes/profiles/[profileId]/stage/route.ts": themeMutationRouteSource("stage"),
    "src/app/api/system/themes/profiles/[profileId]/publish/route.ts": themeMutationRouteSource("publish"),
    "src/app/api/system/themes/profiles/[profileId]/rollback/route.ts": themeMutationRouteSource("rollback")
  };
}
