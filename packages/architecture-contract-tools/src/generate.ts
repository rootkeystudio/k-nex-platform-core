import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApplicationManifestSchema, PluginManifestSchema, architectureRegistry } from "@k-nex/contracts";
import * as z from "zod";

import { canonicalJson, type JsonValue } from "./canonical-json.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function jsonSchema(schema: z.core.$ZodType): JsonValue {
  return z.toJSONSchema(schema, {
    io: "input",
    reused: "ref",
    target: "draft-2020-12",
    unrepresentable: "throw"
  }) as JsonValue;
}

const artifacts = new Map<string, JsonValue>([
  ["contracts/architecture-contracts.v1.json", architectureRegistry as unknown as JsonValue],
  ["schemas/plugin-manifest.v1.schema.json", jsonSchema(PluginManifestSchema)],
  ["schemas/application-manifest.v1.schema.json", jsonSchema(ApplicationManifestSchema)],
  ["contracts/generated-contracts.v1.json", {
    generator: "@k-nex/architecture-contract-tools",
    version: 1,
    artifacts: [
      "contracts/architecture-contracts.v1.json",
      "schemas/plugin-manifest.v1.schema.json",
      "schemas/application-manifest.v1.schema.json"
    ]
  }]
]);

async function generate(check: boolean): Promise<void> {
  const stale: string[] = [];
  for (const [relativePath, value] of artifacts) {
    const content = canonicalJson(value);
    const path = resolve(repositoryRoot, relativePath);
    if (check) {
      const current = await readFile(path, "utf8").catch(() => "");
      if (current !== content) stale.push(relativePath);
    } else {
      await writeFile(path, content, "utf8");
    }
  }

  if (stale.length > 0) throw new Error(`Generated contract artifacts are stale: ${stale.join(", ")}`);
  console.log(check ? "Generated contract artifacts are current." : "Generated contract artifacts updated.");
}

const argument = process.argv[2];
if (argument !== undefined && argument !== "--check") throw new Error(`Unknown argument: ${argument}`);
await generate(argument === "--check");
