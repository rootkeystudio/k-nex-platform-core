import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PluginManifestSchema } from "@k-nex/contracts";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import { canonicalJson } from "./canonical-json.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormatsModule.default(ajv);

const circular: { self?: unknown } = {};
circular.self = circular;
for (const unsupported of [undefined, Number.NaN, 1n, new Date(0), { value: undefined }, circular]) {
  try {
    canonicalJson(unsupported);
    throw new Error("Canonical JSON accepted an unsupported JavaScript value.");
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
}

async function load<T = unknown>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(resolve(repositoryRoot, relativePath), "utf8")) as T;
}

function assertCanonical(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonical(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;

  const keys = Object.keys(value);
  const sorted = [...keys].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (keys.some((key, index) => key !== sorted[index])) throw new Error(`Generated JSON keys are not sorted at ${path}.`);
  for (const [key, child] of Object.entries(value)) assertCanonical(child, `${path}.${key}`);
}

for (const relativePath of [
  "contracts/architecture-contracts.v1.json",
  "contracts/generated-contracts.v1.json",
  "schemas/plugin-manifest.v1.schema.json",
  "schemas/application-manifest.v1.schema.json"
]) {
  const content = await readFile(resolve(repositoryRoot, relativePath), "utf8");
  if (!content.endsWith("\n") || content.endsWith("\n\n") || content.includes("\r")) throw new Error(`${relativePath} must use LF and one final newline.`);
  assertCanonical(JSON.parse(content), relativePath);
}

const pluginSchema = await load<AnySchema>("schemas/plugin-manifest.v1.schema.json");
const applicationSchema = await load<AnySchema>("schemas/application-manifest.v1.schema.json");
const validatePlugin = ajv.compile(pluginSchema);
ajv.compile(applicationSchema);

const driver = await load("fixtures/plugin-manifests/module.logistics.driver.json");
if (!PluginManifestSchema.safeParse(driver).success) throw new Error("Valid driver fixture failed the Zod authoring schema.");
if (!validatePlugin(driver)) throw new Error(`Valid driver fixture failed generated schema: ${ajv.errorsText(validatePlugin.errors)}`);

const invalidLifecycle = structuredClone(driver) as { lifecycle: { uninstall: string } };
invalidLifecycle.lifecycle.uninstall = "supported";
if (PluginManifestSchema.safeParse(invalidLifecycle).success) throw new Error("Zod authoring schema accepted retained-schema uninstall for a schema-owning V1 plugin.");
if (validatePlugin(invalidLifecycle)) throw new Error("Generated schema accepted retained-schema uninstall for a schema-owning V1 plugin.");

console.log("Generated schemas compile with Ajv and preserve the V1 lifecycle invariant.");
