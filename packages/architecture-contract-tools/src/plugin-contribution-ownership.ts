import { Ajv2020 } from "ajv/dist/2020.js";

const pluginContributionOwnershipKeyword = "kNexPluginContributionOwnership";

export function registerPluginContributionOwnershipKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: pluginContributionOwnershipKeyword,
    type: "object",
    schemaType: "boolean",
    errors: false,
    validate: (enabled: boolean, data: unknown) => {
      if (!enabled || data === null || typeof data !== "object") return true;
      const manifest = data as { id?: unknown; contributions?: unknown };
      if (typeof manifest.id !== "string" || manifest.contributions === undefined) return true;
      if (manifest.contributions === null || typeof manifest.contributions !== "object") return true;
      const namespace = manifest.id.split(".")[1];
      if (namespace === undefined) return true;
      return Object.values(manifest.contributions).every((declaration) =>
        declaration !== null && typeof declaration === "object" && !Array.isArray(declaration) &&
        Object.keys(declaration).every((id) => id.startsWith(`${namespace}.`))
      );
    }
  });
}
