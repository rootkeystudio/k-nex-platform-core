import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ApplicationManifestSchema,
  canonicalJson,
  MetricScalarSchema,
  PluginManifestSchema,
  TableRecordsSchema,
  architectureRegistry
} from "@k-nex/contracts";
import * as z from "zod";

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
  { path: "schemas/application-manifest.v1.schema.json", value: jsonSchema(ApplicationManifestSchema) },
  { path: "schemas/metric-scalar.v1.schema.json", value: jsonSchema(MetricScalarSchema) },
  { path: "schemas/table-records.v1.schema.json", value: jsonSchema(TableRecordsSchema) }
] satisfies readonly Artifact[];

const outputContractSchemas = [
  { id: "metric.scalar@1", schema: "schemas/metric-scalar.v1.schema.json" },
  { id: "table.records@1", schema: "schemas/table-records.v1.schema.json" }
] as const;

const artifacts = [
  ...primaryArtifacts,
  {
    path: "contracts/generated-contracts.v1.json",
    value: {
      outputContracts: outputContractSchemas,
      generator: "@k-nex/architecture-contract-tools",
      version: 1,
      artifacts: primaryArtifacts.map(({ path }) => path)
    }
  }
] satisfies readonly Artifact[];

export async function generate(root: string, check: boolean): Promise<void> {
  const stale: string[] = [];
  for (const { path: relativePath, value } of artifacts) {
    const content = canonicalJson(value);
    const path = resolve(root, relativePath);
    if (check) {
      const current = await readFile(path, "utf8").catch(() => "");
      if (current !== content) stale.push(relativePath);
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
  }

  if (stale.length > 0) throw new Error(`Generated contract artifacts are stale: ${stale.join(", ")}`);
  console.log(check ? "Generated contract artifacts are current." : "Generated contract artifacts updated.");
}

let check = false;
let outputRoot = repositoryRoot;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--check") check = true;
  else if (argument === "--output-root") {
    const value = process.argv[index + 1];
    if (value === undefined) throw new Error("--output-root requires a path.");
    outputRoot = resolve(value);
    index += 1;
  } else throw new Error(`Unknown argument: ${argument}`);
}
await generate(outputRoot, check);
