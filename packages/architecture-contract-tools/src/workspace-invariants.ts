import { WorkspaceContractsSchema } from "@k-nex/contracts";
import { Ajv2020 } from "ajv/dist/2020.js";

const workspaceInvariantsKeyword = "kNexWorkspaceInvariants";

/** Zod owns graph and identity checks; generated schemas invoke the same closed contract. */
export function registerWorkspaceInvariantsKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: workspaceInvariantsKeyword,
    type: "object",
    schemaType: "boolean",
    errors: false,
    validate: (enabled: boolean, data: unknown) => !enabled || WorkspaceContractsSchema.safeParse(data).success
  });
}
