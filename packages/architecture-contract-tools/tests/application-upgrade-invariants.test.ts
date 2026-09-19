import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ApplicationReleaseLockSchema, ApplicationUpgradePlanEnvelopeV1Schema, GeneratedFileOwnershipManifestSchema, PreparationResultV1Schema, applicationUpgradePlanDigestInput, preparationResultDigestInput, sha256CanonicalJson } from "@k-nex/contracts";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

import { registerApplicationUpgradeInvariantsKeyword } from "../src/application-upgrade-invariants.js";

const root = resolve(import.meta.dirname, "../../..");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const integrity = `sha512-${"A".repeat(86)}==`;
const ownership = { schemaVersion: 1, applicationId: "customer-alpha", files: [{ path: "src/generated.ts", mode: "managed", producer: { package: "@k-nex/runtime", version: "1.0.0", generatorId: "sales-reference" }, digest: digest("1") }] };
const lock = { schemaVersion: 1, applicationId: "customer-alpha", platformRelease: "1.0.0", releaseManifestDigest: digest("2"), frameworkTupleDigest: digest("3"), packages: [{ package: "@k-nex/runtime", version: "1.0.0", role: "core", integrity }], plugins: [], generator: { package: "@k-nex/runtime", version: "1.0.0", schemaVersion: 1, generatorId: "sales-reference" }, sourceOwnershipDigest: digest("4"), migrationSetDigest: digest("5"), transitionChain: [] };
const planInput = { schemaVersion: 1 as const, planId: "upgrade:abc", inputSnapshotDigest: digest("6"), targetTransitionManifestDigest: digest("7"), operations: [{ path: "src/generated.ts", kind: "replace" as const }] };
const plan = { ...planInput, digest: sha256CanonicalJson(applicationUpgradePlanDigestInput(planInput)) };
const preparationInput = { schemaVersion: 1 as const, planDigest: plan.digest, preparedSourceCommit: "a".repeat(40), preparedReleaseLockDigest: digest("9") };
const preparation = { ...preparationInput, resultDigest: sha256CanonicalJson(preparationResultDigestInput(preparationInput)) };

describe("generated application upgrade schemas", () => {
  it("preserves Zod/AJV parity for cross-field mutations", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true }); addFormatsModule.default(ajv); registerApplicationUpgradeInvariantsKeyword(ajv);
    const compile = async (path: string) => ajv.compile(JSON.parse(await readFile(resolve(root, path), "utf8")) as AnySchema);
    const validators = {
      ownership: await compile("schemas/generated-file-ownership-manifest.v1.schema.json"),
      lock: await compile("schemas/application-release-lock.v1.schema.json"),
      plan: await compile("schemas/application-upgrade-plan-envelope.v1.schema.json"),
      preparation: await compile("schemas/application-upgrade-preparation-result.v1.schema.json")
    };
    for (const [value, schema, validate] of [[ownership, GeneratedFileOwnershipManifestSchema, validators.ownership], [lock, ApplicationReleaseLockSchema, validators.lock], [plan, ApplicationUpgradePlanEnvelopeV1Schema, validators.plan]] as const) {
      expect(schema.safeParse(value).success).toBe(true); expect(validate(value), ajv.errorsText(validate.errors)).toBe(true);
    }
    expect(PreparationResultV1Schema.safeParse(preparation).success).toBe(true); expect(validators.preparation(preparation), ajv.errorsText(validators.preparation.errors)).toBe(true);
    const cases = [
      [{ ...ownership, files: [{ ...ownership.files[0], path: "package.json" }] }, GeneratedFileOwnershipManifestSchema, validators.ownership],
      [{ ...ownership, files: [ownership.files[0], ownership.files[0]] }, GeneratedFileOwnershipManifestSchema, validators.ownership],
      [{ ...lock, generator: { ...lock.generator, package: "@k-nex/missing" } }, ApplicationReleaseLockSchema, validators.lock],
      [{ ...lock, plugins: [{ id: "module.sales", package: "@k-nex/runtime", version: "1.0.0", integrity }] }, ApplicationReleaseLockSchema, validators.lock],
      [{ ...plan, operations: [{ path: "src/z.ts", kind: "add" }, { path: "src/a.ts", kind: "add" }] }, ApplicationUpgradePlanEnvelopeV1Schema, validators.plan],
      [{ ...plan, operations: [{ path: "/tmp/source", kind: "add" }] }, ApplicationUpgradePlanEnvelopeV1Schema, validators.plan]
    ] as const;
    for (const [value, schema, validate] of cases) {
      expect(schema.safeParse(value).success).toBe(false);
      expect(validate(value), ajv.errorsText(validate.errors)).toBe(false);
    }
    for (const [value, schema, validate] of [
      [{ ...plan, inputSnapshotDigest: digest("a") }, ApplicationUpgradePlanEnvelopeV1Schema, validators.plan],
      [{ ...preparation, planDigest: digest("b") }, PreparationResultV1Schema, validators.preparation]
    ] as const) { expect(schema.safeParse(value).success).toBe(false); expect(validate(value), ajv.errorsText(validate.errors)).toBe(false); }
    const changedPlanInput = { ...planInput, inputSnapshotDigest: digest("a") };
    const changedPlan = { ...changedPlanInput, digest: sha256CanonicalJson(applicationUpgradePlanDigestInput(changedPlanInput)) };
    expect(ApplicationUpgradePlanEnvelopeV1Schema.safeParse(changedPlan).success).toBe(true); expect(validators.plan(changedPlan)).toBe(true);
    const changedPreparationInput = { ...preparationInput, planDigest: changedPlan.digest };
    const changedPreparation = { ...changedPreparationInput, resultDigest: sha256CanonicalJson(preparationResultDigestInput(changedPreparationInput)) };
    expect(PreparationResultV1Schema.safeParse(changedPreparation).success).toBe(true); expect(validators.preparation(changedPreparation)).toBe(true);
  });
});
