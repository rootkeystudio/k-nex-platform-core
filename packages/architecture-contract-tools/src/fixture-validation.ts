import { AuthorizationContractsSchema, HotApplicationManifestSchema } from "@k-nex/contracts";
import type { ErrorObject, ValidateFunction } from "ajv";

export const fixtureSchemas = [
  "application", "plugin", "hot-application-manifest", "theme-skin-manifest", "extension-bundle-manifest",
  "extension-capability-request", "extension-resource-budget", "extension-install-plan", "extension-install-receipt",
  "extension-generation", "extension-lifecycle-event", "migration-compatibility-plan", "remote-ui-isolation-profile", "runner-isolation-profile", "runtime-extension-inventory",
  "static-composition-change-plan", "static-deployment-receipt", "trusted-application-build-evidence", "worker-generation-fence", "zero-downtime-eligibility", "authorization"
] as const;
export type FixtureSchema = (typeof fixtureSchemas)[number];
export type DiagnosticCode =
  | "DUPLICATE_PLUGIN_ID"
  | "AUTHORIZATION_OWNERSHIP_INVALID"
  | "IDENTITY_INVALID"
  | "LEGACY_SYMBOL_FORBIDDEN"
  | "LIFECYCLE_UNSUPPORTED"
  | "PROVIDER_SELECTION_INVALID"
  | "SCHEMA_INVALID";

export interface Diagnostic {
  code: DiagnosticCode;
  fixturePath: string;
  path: string;
  remediation: string;
  validator: "json-schema" | "repository-semantic";
}

export interface FixtureInput {
  fixturePath: string;
  schema: FixtureSchema;
  value: unknown;
}

interface Registry {
  forbiddenLegacySymbols: string[];
  identity: {
    capabilityIdPattern: string;
    pluginIdPattern: string;
  };
}

type Validators = Partial<Record<FixtureSchema, ValidateFunction>>;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function diagnostic(
  fixturePath: string,
  code: DiagnosticCode,
  path: string,
  remediation: string,
  validator: Diagnostic["validator"]
): Diagnostic {
  return { code, fixturePath, path, remediation, validator };
}

function findLegacySymbol(value: unknown, symbols: readonly string[], path = "$"): { path: string; symbol: string } | undefined {
  if (typeof value === "string") {
    const symbol = symbols.find((candidate) => value.includes(candidate));
    return symbol === undefined ? undefined : { path, symbol };
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const found = findLegacySymbol(child, symbols, `${path}/${index}`);
      if (found !== undefined) return found;
    }
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value).sort()) {
      const symbol = symbols.find((candidate) => key.includes(candidate));
      if (symbol !== undefined) return { path: `${path}/${key}`, symbol };
      const found = findLegacySymbol((value as Record<string, unknown>)[key], symbols, `${path}/${key}`);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function schemaPath(errors: ErrorObject[] | null | undefined): string {
  const first = [...(errors ?? [])].sort((left, right) => {
    const leftKey = `${left.instancePath}:${left.keyword}:${left.schemaPath}`;
    const rightKey = `${right.instancePath}:${right.keyword}:${right.schemaPath}`;
    return compare(leftKey, rightKey);
  })[0];
  return first?.instancePath || "$";
}

function zodPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "$" : `$/${path.map(String).join("/")}`;
}

function semanticDiagnostic(
  fixture: FixtureInput,
  registry: Registry,
  pluginCapabilities: ReadonlyMap<string, ReadonlySet<string>>
): Diagnostic | undefined {
  const legacy = findLegacySymbol(fixture.value, registry.forbiddenLegacySymbols);
  if (legacy !== undefined) {
    return diagnostic(fixture.fixturePath, "LEGACY_SYMBOL_FORBIDDEN", legacy.path, "Replace the deprecated symbol with its canonical contract identity.", "repository-semantic");
  }

  if (fixture.value === null || typeof fixture.value !== "object") return undefined;
  const value = fixture.value as Record<string, unknown>;

  if (fixture.schema === "authorization") {
    const parsed = AuthorizationContractsSchema.safeParse(fixture.value);
    const issue = !parsed.success ? parsed.error.issues.find(({ code }) => code === "custom") : undefined;
    return issue === undefined ? undefined : diagnostic(
      fixture.fixturePath,
      "AUTHORIZATION_OWNERSHIP_INVALID",
      zodPath(issue.path),
      "Keep authorization ownership, generation, and decision invariants aligned with the canonical contract.",
      "repository-semantic"
    );
  }

  if (fixture.schema === "hot-application-manifest") {
    const parsed = HotApplicationManifestSchema.safeParse(fixture.value);
    const issue = !parsed.success ? parsed.error.issues.find(({ code, path }) =>
      code === "custom" && ["permissions", "policyBindings", "roleTemplates"].includes(String(path[0]))) : undefined;
    return issue === undefined ? undefined : diagnostic(
      fixture.fixturePath,
      "AUTHORIZATION_OWNERSHIP_INVALID",
      zodPath(issue.path),
      "Keep Hot Application authorization declarations owned by this manifest and reference only its declared permissions.",
      "repository-semantic"
    );
  }

  if (fixture.schema === "plugin") {
    const lifecycle = value.lifecycle as Record<string, unknown> | undefined;
    if (lifecycle?.ownsPayloadSchema === true && lifecycle.uninstall === "supported") {
      return diagnostic(fixture.fixturePath, "LIFECYCLE_UNSUPPORTED", "$/lifecycle/uninstall", "Declare uninstall as unsupported for schema-owning V1 plugins.", "repository-semantic");
    }

    const pluginPattern = new RegExp(registry.identity.pluginIdPattern);
    if (typeof value.id === "string" && !pluginPattern.test(value.id)) {
      return diagnostic(fixture.fixturePath, "IDENTITY_INVALID", "$/id", "Use the canonical dot-separated plugin identity grammar.", "repository-semantic");
    }
    const capabilityPattern = new RegExp(registry.identity.capabilityIdPattern);
    const provisions = Array.isArray(value.provides) ? value.provides : [];
    for (const [index, provision] of provisions.entries()) {
      const capability = (provision as Record<string, unknown>)?.capability;
      if (typeof capability === "string" && !capabilityPattern.test(capability)) {
        return diagnostic(fixture.fixturePath, "IDENTITY_INVALID", `$/provides/${index}/capability`, "Use the canonical capability identity grammar.", "repository-semantic");
      }
    }
    return undefined;
  }

  const plugins = Array.isArray(value.plugins) ? value.plugins : [];
  const seen = new Set<string>();
  for (const [index, plugin] of plugins.entries()) {
    const id = (plugin as Record<string, unknown>)?.id;
    if (typeof id === "string" && seen.has(id)) {
      return diagnostic(fixture.fixturePath, "DUPLICATE_PLUGIN_ID", `$/plugins/${index}/id`, "Keep one application plugin request per canonical plugin ID.", "repository-semantic");
    }
    if (typeof id === "string") seen.add(id);
  }

  const providers = value.providers;
  if (providers !== null && typeof providers === "object" && !Array.isArray(providers)) {
    for (const capability of Object.keys(providers).sort()) {
      const request = (providers as Record<string, Record<string, unknown>>)[capability];
      const plugin = request?.plugin;
      if (typeof plugin === "string" && !pluginCapabilities.get(plugin)?.has(capability)) {
        return diagnostic(fixture.fixturePath, "PROVIDER_SELECTION_INVALID", `$/providers/${capability}/plugin`, "Select a plugin that declares the provider capability used as the map key.", "repository-semantic");
      }
    }
  }
  return undefined;
}

export function validateFixtures(
  fixtures: readonly FixtureInput[],
  registry: Registry,
  validators: Validators,
  pluginCapabilities: ReadonlyMap<string, ReadonlySet<string>>
): Diagnostic[] {
  return fixtures.map((fixture) => {
    const semantic = semanticDiagnostic(fixture, registry, pluginCapabilities);
    if (semantic !== undefined) return semantic;
    const validate = validators[fixture.schema];
    if (validate === undefined) throw new TypeError(`Missing AJV validator for fixture schema ${fixture.schema}.`);
    if (!validate(fixture.value)) {
      return diagnostic(fixture.fixturePath, "SCHEMA_INVALID", schemaPath(validate.errors), "Make the fixture conform to the generated closed JSON Schema.", "json-schema");
    }
    return undefined;
  }).filter((item): item is Diagnostic => item !== undefined)
    .sort((left, right) => compare(left.fixturePath, right.fixturePath) || compare(left.code, right.code));
}
