import { Ajv2020 } from "ajv/dist/2020.js";

const migrationRevisionKeyword = "kNexMigrationRevisionChangeRequiresSteps";

export function registerMigrationRevisionKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: migrationRevisionKeyword,
    type: "object",
    schemaType: "boolean",
    errors: false,
    validate: (enabled: boolean, data: unknown) => {
      if (!enabled || data === null || typeof data !== "object") return true;
      const plan = data as { baseRevision?: unknown; targetRevision?: unknown; steps?: unknown };
      return !Array.isArray(plan.steps) || plan.steps.length > 0 || plan.baseRevision === plan.targetRevision;
    }
  });
}
