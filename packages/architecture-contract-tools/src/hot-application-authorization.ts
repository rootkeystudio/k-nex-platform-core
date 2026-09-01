import { HotApplicationManifestSchema } from "@k-nex/contracts";
import { Ajv2020 } from "ajv/dist/2020.js";

const hotApplicationAuthorizationKeyword = "kNexHotApplicationAuthorization";

export function registerHotApplicationAuthorizationKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: hotApplicationAuthorizationKeyword,
    type: "object",
    schemaType: "boolean",
    errors: false,
    validate: (enabled: boolean, data: unknown) => !enabled || HotApplicationManifestSchema.safeParse(data).success
  });
}
