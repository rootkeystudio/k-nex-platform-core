import { SystemAdministrationContractsSchema } from "@k-nex/contracts";
import { Ajv2020 } from "ajv/dist/2020.js";

const systemAdministrationInvariantsKeyword = "kNexSystemAdministrationInvariants";

/** Zod owns cross-field descriptor and operation identity checks; generated schemas invoke the same closed contract. */
export function registerSystemAdministrationInvariantsKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: systemAdministrationInvariantsKeyword,
    type: "object",
    schemaType: "boolean",
    errors: false,
    validate: (enabled: boolean, data: unknown) => !enabled || SystemAdministrationContractsSchema.safeParse(data).success
  });
}
