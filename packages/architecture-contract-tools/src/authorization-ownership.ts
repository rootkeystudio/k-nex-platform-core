import { AuthorizationContractsSchema } from "@k-nex/contracts";
import { Ajv2020 } from "ajv/dist/2020.js";

const authorizationOwnershipKeyword = "kNexAuthorizationOwnership";

export function registerAuthorizationOwnershipKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: authorizationOwnershipKeyword,
    type: "object",
    schemaType: "boolean",
    errors: false,
    validate: (enabled: boolean, data: unknown) => !enabled || AuthorizationContractsSchema.safeParse(data).success
  });
}
