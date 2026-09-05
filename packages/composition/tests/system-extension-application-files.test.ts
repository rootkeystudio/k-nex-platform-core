import { describe, expect, it } from "vitest";

import { systemExtensionApplicationFiles } from "../src/system-extension-application-files.js";

describe("generated System extension administration", () => {
  const files = systemExtensionApplicationFiles({ applicationId: "customer-alpha" });

  it("emits only fixed extension routes and uses the remote operator facade", () => {
    expect(Object.keys(files).filter((path) => path.includes("[..."))).toEqual([]);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      "src/k-nex-system-extensions.ts",
      "src/app/(workspace)/system/extensions/page.tsx",
      "src/app/(workspace)/system/extensions/[extensionId]/page.tsx",
      "src/app/api/system/extensions/[extensionId]/plan/route.ts",
      "src/app/api/system/extensions/[extensionId]/operations/[operationId]/execute/route.ts"
    ]));
    expect(files["src/k-nex-system-extensions.ts"]).toContain("new RemoteAdministrationExtensionOperator");
    expect(files["src/k-nex-system-extensions.ts"]).toContain("new NodeHttpsAdministrationOperatorClient");
    expect(files["src/k-nex-system-extensions.ts"]).not.toContain("PluginManager");
  });

  it("derives authority, revisions, inventory, action permission, and evidence on server", () => {
    const runtime = files["src/k-nex-system-extensions.ts"]!;
    const plan = files["src/app/api/system/extensions/[extensionId]/plan/route.ts"]!;
    const execute = files["src/app/api/system/extensions/[extensionId]/operations/[operationId]/execute/route.ts"]!;

    expect(runtime).toContain("currentExtensionExpected");
    expect(runtime).toContain("extensionMutationContext");
    expect(runtime).toContain("reauthenticateCurrentUser");
    expect(runtime).toContain("inventoryRevision: inventory.revision");
    expect(runtime).toContain("export const kNexHostInventoryDigest");
    expect(plan).toContain("exactFields(form, [\"intent\"])");
    expect(plan).toContain("const intent = extensionPlanIntent(form.get(\"intent\"))");
    expect(plan).toContain("currentExtensionAction(payload, context, record.extension, intent.operation)");
    expect(plan).toContain("extensionPlanIntentSubmission(payload, mutation, intent, record.extension, record.version, expected)");
    expect(plan).not.toContain("randomUUID()");
    expect(execute).toContain("exactFields(form, [\"password\"])");
    expect(execute).toContain("extensionStatusFor");
    expect(execute).toContain("extensionPassword(form)");
    expect(execute).not.toContain('form.get("expected")');
  });

  it("uses local accepted read projections but sends mutation only over mTLS", () => {
    const runtime = files["src/k-nex-system-extensions.ts"]!;
    expect(runtime).toContain("catalogList: async");
    expect(runtime).toContain("status: async");
    expect(runtime).toContain("expectedMtlsIdentity");
    expect(runtime).toContain("allowedCommandFamilies: [\"extension-lifecycle\"]");
    expect(runtime).not.toContain("payload.db.pool.query");
    expect(JSON.stringify(files)).not.toContain("fixtures/customer-gate-1");
  });

  it("binds a signed plan intent to the current actor and exact revisions before replay", () => {
    const runtime = files["src/k-nex-system-extensions.ts"]!;
    const detail = files["src/app/(workspace)/system/extensions/[extensionId]/page.tsx"]!;
    const plan = files["src/app/api/system/extensions/[extensionId]/plan/route.ts"]!;

    expect(runtime).toContain("createHmac");
    expect(runtime).toContain("timingSafeEqual");
    expect(runtime).toContain("payloadSecret");
    expect(runtime).toContain("issueExtensionPlanIntent");
    expect(runtime).toContain("extensionPlanIntent");
    expect(runtime).toContain("extensionPlanIntentSubmission");
    expect(runtime).toContain('const idempotencyKey = "extension-plan:" + intent.intentId');
    expect(runtime).toContain("canonicalJson(intent.extension) !== canonicalJson(extension) || intent.version !== version");
    expect(runtime).toContain("actorDigest: planIntentActorDigest(await actor(payload, context))");
    expect(runtime).toContain("expected: await currentExtensionExpected(payload, extension)");
    expect(runtime).toContain("intent.actorDigest !== planIntentActorDigest(currentActor)");
    expect(runtime).toContain("const exactPlanningAdvance = expected.inventoryRevision === intent.expected.inventoryRevision + 1");
    expect(runtime).toContain("current?.lastOperationId === replay.operationId");
    expect(runtime).toContain("const planIntentLifetimeMs = 5 * 60_000");
    expect(runtime).not.toContain("authorizationRevision: intent");
    expect(runtime).not.toContain("lifecycleRevision: intent");
    expect(detail).toContain("currentExtension, currentExtensionAction, extensionMutationContext,");
    expect(detail).toContain("issueExtensionPlanIntent(payload, mutation, record.extension, action.executableOperation, record.version)");
    expect(detail).toContain('{ name: "intent", value: intent }');
    expect(detail).not.toContain('{ name: "operation", value: action.executableOperation }');
    expect(detail).not.toContain('{ name: "version", value: record.version }');
    expect(plan).toContain("const expected = await currentExtensionExpected(payload, record.extension)");
    expect(plan).toContain("await extensionPlanIntentSubmission(payload, mutation, intent, record.extension, record.version, expected)");
    expect(plan).toContain("if (submission.operationId) return workspaceRedirect");
  });
});
