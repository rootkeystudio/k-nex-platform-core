import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ActionDescriptorSchema,
  AgentToolDescriptorSchema,
  ApplicationManifestSchema,
  canonicalJson,
  CmsPageMetadataSchema,
  DurableEventEnvelopeSchema,
  EVENT_PAYLOAD_MAX_BYTES,
  ExtensionBundleManifestSchema,
  ExtensionCapabilityRequestSchema,
  ExtensionGenerationSchema,
  ExtensionInstallPlanSchema,
  ExtensionInstallReceiptSchema,
  ExtensionLifecycleEventSchema,
  ExtensionResourceBudgetSchema,
  HotApplicationManifestSchema,
  MigrationCompatibilityPlanSchema,
  MetricScalarSchema,
  PackageReleaseManifestSchema,
  RuntimeInventorySchema,
  RuntimeExtensionInventorySchema,
  ThemeSkinManifestSchema,
  RemoteUiIsolationProfileSchema,
  RemoteUiFrameSchema,
  RunnerIsolationProfileSchema,
  StaticCompositionChangePlanSchema,
  StaticDeploymentReceiptSchema,
  TrustedApplicationBuildEvidenceSchema,
  WorkerGenerationFenceSchema,
  DeploymentReceiptSchema,
  PluginManifestSchema,
  TableRecordsSchema,
  ThemeProfileSchema,
  ThemeProfilePublicationEventSchema,
  UiDocumentSchema,
  ZeroDowntimeEligibilitySchema,
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

function identifiedJsonSchema(schema: z.core.$ZodType, id: string, title: string): unknown {
  return { ...(jsonSchema(schema) as Record<string, unknown>), $id: id, title };
}

function secretFieldPattern(): string {
  const separator = "[^A-Za-z0-9]*";
  const words = [
    "authorization", "cookie", "password", "secret", "token", "apikey", "credential", "privatenote",
    "accesstoken", "refreshtoken", "sessiontoken", "idtoken", "authtoken", "bearertoken",
    "clientsecret", "apisecret", "secretkey", "privatekey", "apikeyvalue"
  ];
  return `^(?:${words.map((word) => [...word].map((letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`).join(separator)).join("|")})$`;
}

function safeEventPayloadValue(depth: number): Record<string, unknown> {
  const primitive = [{ type: "null" }, { type: "boolean" }, { type: "number" }, { type: "string" }];
  const propertyNames = { not: { pattern: secretFieldPattern() } };
  if (depth === 8) {
    return { anyOf: [...primitive, { type: "array", maxItems: 0 }, { type: "object", maxProperties: 0, propertyNames }] };
  }
  return {
    anyOf: [
      ...primitive,
      { type: "array", items: { $ref: `#/$defs/__kNexEventPayloadDepth${depth + 1}` } },
      { type: "object", propertyNames, additionalProperties: { $ref: `#/$defs/__kNexEventPayloadDepth${depth + 1}` } }
    ]
  };
}

function eventJsonSchema(): unknown {
  const generated = jsonSchema(DurableEventEnvelopeSchema) as Record<string, any>;
  const definitions = generated.$defs as Record<string, unknown>;
  const payloadReference = generated.properties.payload.$ref as string;
  const payloadDefinition = payloadReference.slice("#/$defs/".length);
  definitions[payloadDefinition] = {
    type: "object",
    kNexMaxCanonicalBytes: EVENT_PAYLOAD_MAX_BYTES,
    kNexNoSecretFields: true,
    propertyNames: { not: { pattern: secretFieldPattern() } },
    additionalProperties: { $ref: "#/$defs/__kNexEventPayloadDepth1" }
  };
  for (let depth = 1; depth <= 8; depth += 1) definitions[`__kNexEventPayloadDepth${depth}`] = safeEventPayloadValue(depth);
  return generated;
}

function applicationJsonSchema(): unknown {
  const generated = jsonSchema(ApplicationManifestSchema) as Record<string, any>;
  const definitions = generated.$defs as Record<string, Record<string, any>>;
  const runtimeReference = generated.properties.runtime.$ref as string;
  const runtime = definitions[runtimeReference.slice("#/$defs/".length)];
  const topology = runtime?.properties?.realtime as Record<string, any> | undefined;
  if (!topology) throw new TypeError("Generated application schema is missing realtime topology.");
  topology.allOf = [
    { not: { properties: { adapter: { const: "distributed" } }, required: ["adapter"] } },
    { properties: { webInstances: { const: 1 }, realtimeGateway: { const: "embedded" }, rollingDeployment: { const: "stop-before-start" } } },
    { not: { properties: { worker: { const: "separate" }, workerInvalidationPath: { const: "direct" } }, required: ["worker", "workerInvalidationPath"] } }
  ];
  generated.allOf = [
    {
      if: {
        properties: {
          providers: {
            properties: { "realtime.gateway": {} },
            required: ["realtime.gateway"],
            type: "object"
          }
        },
        required: ["providers"],
        type: "object"
      },
      then: {
        properties: {
          runtime: { properties: { realtime: {} }, required: ["realtime"], type: "object" }
        },
        required: ["runtime"],
        type: "object"
      }
    }
  ];
  return generated;
}

function uiDocumentJsonSchema(): unknown {
  const generated = jsonSchema(UiDocumentSchema) as Record<string, unknown>;
  generated.kNexUiDocumentInvariants = true;
  return generated;
}

function pluginManifestJsonSchema(): unknown {
  const generated = jsonSchema(PluginManifestSchema) as Record<string, unknown>;
  generated.kNexPluginContributionOwnership = true;
  return generated;
}

function referencedDefinition(schema: Record<string, any>, property: string): Record<string, any> {
  const reference = schema.properties?.[property]?.$ref as string | undefined;
  const definition = reference?.startsWith("#/$defs/") ? schema.$defs?.[reference.slice("#/$defs/".length)] : undefined;
  if (definition === undefined) throw new TypeError(`Generated schema property is missing a local definition: ${property}.`);
  return definition;
}

function cmsPageMetadataJsonSchema(): unknown {
  const generated = jsonSchema(CmsPageMetadataSchema) as Record<string, any>;
  const canonicalTextPattern = "^(?!\\s)(?![\\s\\S]*\\s$)(?![\\s\\S]*[\\u0000-\\u001f\\u007f-\\u009f])[\\s\\S]+$";
  referencedDefinition(generated, "title").pattern = canonicalTextPattern;
  referencedDefinition(generated, "description").pattern = canonicalTextPattern;
  return generated;
}

function themeProfileJsonSchema(): unknown {
  const generated = jsonSchema(ThemeProfileSchema) as Record<string, any>;
  referencedDefinition(generated, "themeId").pattern = "^theme(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$";
  const values = referencedDefinition(generated, "values");
  values.maxProperties = 128;
  values.propertyNames = { allOf: [values.propertyNames, { not: { pattern: "(?:^|\\.)(?:css|class|classname|style|import|function|secret|password|credential|token|fonturl)(?:\\.|$)" } }] };
  const valueReference = values.additionalProperties?.$ref as string | undefined;
  const valueDefinition = valueReference?.startsWith("#/$defs/") ? generated.$defs?.[valueReference.slice("#/$defs/".length)] : undefined;
  const stringValue = valueDefinition?.anyOf?.find((candidate: Record<string, unknown>) => candidate.type === "string");
  if (stringValue === undefined) throw new TypeError("Generated theme token string definition is missing.");
  stringValue.pattern = "^(?![\\s\\S]*(?:[hH][tT][tT][pP][sS]?:\\/\\/|[dD][aA][tT][aA]:|[jJ][aA][vV][aA][sS][cC][rR][iI][pP][tT]:|@[iI][mM][pP][oO][rR][tT]|[uU][rR][lL]\\s*\\(|[{};]))[\\s\\S]+$";
  const skin = referencedDefinition(generated, "skin");
  const skinValues = skin.properties?.values as Record<string, any> | undefined;
  const skinValueReference = skinValues?.additionalProperties?.$ref as string | undefined;
  const skinValueDefinition = skinValueReference?.startsWith("#/$defs/") ? generated.$defs?.[skinValueReference.slice("#/$defs/".length)] : undefined;
  if (skinValueDefinition === undefined) throw new TypeError("Generated Theme Skin token string definition is missing.");
  skinValueDefinition.pattern = stringValue.pattern;
  return generated;
}

interface Artifact {
  path: string;
  value: unknown;
}

const primaryArtifacts = [
  { path: "contracts/architecture-contracts.v1.json", value: architectureRegistry },
  { path: "schemas/action.v1.schema.json", value: jsonSchema(ActionDescriptorSchema) },
  { path: "schemas/agent-tool.v1.schema.json", value: jsonSchema(AgentToolDescriptorSchema) },
  { path: "schemas/plugin-manifest.v1.schema.json", value: pluginManifestJsonSchema() },
  { path: "schemas/hot-application-manifest.v1.schema.json", value: jsonSchema(HotApplicationManifestSchema) },
  { path: "schemas/theme-skin-manifest.v1.schema.json", value: jsonSchema(ThemeSkinManifestSchema) },
  { path: "schemas/extension-bundle-manifest.v1.schema.json", value: jsonSchema(ExtensionBundleManifestSchema) },
  { path: "schemas/extension-capability-request.v1.schema.json", value: identifiedJsonSchema(ExtensionCapabilityRequestSchema, "https://schemas.k-nex.dev/extension-capability-request/v1.json", "K-Nex Extension Capability Request v1") },
  { path: "schemas/extension-resource-budget.v1.schema.json", value: jsonSchema(ExtensionResourceBudgetSchema) },
  { path: "schemas/extension-install-plan.v1.schema.json", value: jsonSchema(ExtensionInstallPlanSchema) },
  { path: "schemas/extension-install-receipt.v1.schema.json", value: jsonSchema(ExtensionInstallReceiptSchema) },
  { path: "schemas/extension-lifecycle-event.v1.schema.json", value: jsonSchema(ExtensionLifecycleEventSchema) },
  { path: "schemas/extension-generation.v1.schema.json", value: jsonSchema(ExtensionGenerationSchema) },
  { path: "schemas/zero-downtime-eligibility.v1.schema.json", value: jsonSchema(ZeroDowntimeEligibilitySchema) },
  { path: "schemas/remote-ui-isolation-profile.v1.schema.json", value: jsonSchema(RemoteUiIsolationProfileSchema) },
  { path: "schemas/remote-ui-frame.v1.schema.json", value: jsonSchema(RemoteUiFrameSchema) },
  { path: "schemas/runner-isolation-profile.v1.schema.json", value: jsonSchema(RunnerIsolationProfileSchema) },
  { path: "schemas/static-composition-change-plan.v1.schema.json", value: jsonSchema(StaticCompositionChangePlanSchema) },
  { path: "schemas/static-deployment-receipt.v1.schema.json", value: jsonSchema(StaticDeploymentReceiptSchema) },
  { path: "schemas/trusted-application-build-evidence.v1.schema.json", value: jsonSchema(TrustedApplicationBuildEvidenceSchema) },
  { path: "schemas/migration-compatibility-plan.v1.schema.json", value: jsonSchema(MigrationCompatibilityPlanSchema) },
  { path: "schemas/worker-generation-fence.v1.schema.json", value: jsonSchema(WorkerGenerationFenceSchema) },
  { path: "schemas/package-release-manifest.v1.schema.json", value: jsonSchema(PackageReleaseManifestSchema) },
  { path: "schemas/runtime-inventory.v1.schema.json", value: jsonSchema(RuntimeInventorySchema) },
  { path: "schemas/runtime-extension-inventory.v1.schema.json", value: jsonSchema(RuntimeExtensionInventorySchema) },
  { path: "schemas/deployment-receipt.v1.schema.json", value: jsonSchema(DeploymentReceiptSchema) },
  { path: "schemas/application-manifest.v1.schema.json", value: applicationJsonSchema() },
  { path: "schemas/event.v1.schema.json", value: eventJsonSchema() },
  { path: "schemas/metric-scalar.v1.schema.json", value: jsonSchema(MetricScalarSchema) },
  { path: "schemas/table-records.v1.schema.json", value: jsonSchema(TableRecordsSchema) },
  { path: "schemas/theme-profile.v1.schema.json", value: themeProfileJsonSchema() },
  { path: "schemas/theme-profile-publication-event.v1.schema.json", value: jsonSchema(ThemeProfilePublicationEventSchema) },
  { path: "schemas/ui-document.v1.schema.json", value: uiDocumentJsonSchema() },
  { path: "schemas/cms-page-metadata.v1.schema.json", value: cmsPageMetadataJsonSchema() }
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
