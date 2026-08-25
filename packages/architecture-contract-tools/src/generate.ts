import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApplicationManifestSchema, PluginManifestSchema, architectureRegistry } from "@k-nex/contracts";
import * as z from "zod";

import { canonicalJson } from "./canonical-json.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function jsonSchema(schema: z.core.$ZodType): unknown {
  const generated = z.toJSONSchema(schema, {
    io: "input",
    reused: "ref",
    target: "draft-2020-12",
    unrepresentable: "throw"
  });
  const descriptor = Object.getOwnPropertyDescriptor(generated, "~standard");
  const metadata = descriptor?.value as { vendor?: unknown } | undefined;
  if (descriptor?.enumerable !== false || metadata?.vendor !== "zod") throw new TypeError("Zod JSON Schema output has unexpected metadata.");
  return { ...generated };
}

interface Artifact {
  path: string;
  value: unknown;
}

const primaryArtifacts = [
  { path: "contracts/architecture-contracts.v1.json", value: architectureRegistry },
  { path: "schemas/plugin-manifest.v1.schema.json", value: jsonSchema(PluginManifestSchema) },
  { path: "schemas/application-manifest.v1.schema.json", value: jsonSchema(ApplicationManifestSchema) }
] satisfies readonly Artifact[];

const artifacts = [
  ...primaryArtifacts,
  {
    path: "contracts/generated-contracts.v1.json",
    value: {
      generator: "@k-nex/architecture-contract-tools",
      version: 1,
      artifacts: primaryArtifacts.map(({ path }) => path)
    }
  }
] satisfies readonly Artifact[];

async function generate(check: boolean): Promise<void> {
  const stale: string[] = [];
  for (const { path: relativePath, value } of artifacts) {
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
