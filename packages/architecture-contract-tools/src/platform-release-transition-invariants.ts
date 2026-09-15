import { PlatformReleaseTransitionManifestSchema } from "@k-nex/contracts";
import { Ajv2020 } from "ajv/dist/2020.js";

export const platformReleaseTransitionInvariantsKeyword = "kNexPlatformReleaseTransitionInvariants";

/** Zod owns the closed cross-field release-transition invariants used by generated schemas. */
export function registerPlatformReleaseTransitionInvariantsKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: platformReleaseTransitionInvariantsKeyword,
    type: "object",
    schemaType: "boolean",
    errors: false,
    validate: (enabled: boolean, data: unknown) => !enabled || PlatformReleaseTransitionManifestSchema.safeParse(data).success
  });
}
