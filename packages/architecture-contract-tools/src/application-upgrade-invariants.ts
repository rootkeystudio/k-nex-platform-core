import { ApplicationReleaseLockSchema, ApplicationUpgradePlanEnvelopeV1Schema, GeneratedFileOwnershipManifestSchema, PreparationResultV1Schema } from "@k-nex/contracts";
import { Ajv2020 } from "ajv/dist/2020.js";

export function registerApplicationUpgradeInvariantsKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: "kNexApplicationUpgradeInvariant",
    type: "object",
    schemaType: "string",
    errors: false,
    validate: (kind: string, data: unknown) => kind === "release-lock" ? ApplicationReleaseLockSchema.safeParse(data).success : kind === "ownership" ? GeneratedFileOwnershipManifestSchema.safeParse(data).success : kind === "plan" ? ApplicationUpgradePlanEnvelopeV1Schema.safeParse(data).success : kind === "preparation" ? PreparationResultV1Schema.safeParse(data).success : false
  });
}
