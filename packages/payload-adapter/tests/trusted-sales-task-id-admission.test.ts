import { describe, expect, it } from "vitest";

import {
  admitTrustedSalesTaskCreateId,
  revokeTrustedSalesTaskCreateId,
  withTrustedSalesTaskCreateIdAdmission
} from "../src/persistence-capability.js";

function request(transactionID: number | string = "transaction-1") {
  return { transactionID, context: { forged: { id: 42, resourceId: "42" } } } as never;
}

function hookFor(slug: string) {
  const guarded = withTrustedSalesTaskCreateIdAdmission({ slug, fields: [] });
  const hook = guarded.hooks?.beforeChange?.at(-1);
  if (hook === undefined) throw new Error("Explicit-ID hook was not composed.");
  return hook;
}

describe("trusted Sales task explicit-ID admission", () => {
  it("accepts only the one host-issued Sales task create on the same request and transaction", async () => {
    const req = request();
    await admitTrustedSalesTaskCreateId(req, { id: 42, resourceId: "42" });

    await expect(hookFor("sales-tasks")({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req } as never)).resolves.toEqual({ id: 42 });
    await expect(hookFor("sales-tasks")({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req } as never)).rejects.toThrow("Explicit Payload IDs");
  });

  it("rejects direct, forged-context, non-Task, wrong-transaction, and noncanonical explicit IDs", async () => {
    const tasks = hookFor("sales-tasks");
    const accounts = hookFor("sales-accounts");
    const direct = request();
    await expect(tasks({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req: direct } as never)).rejects.toThrow("Explicit Payload IDs");

    const wrongCollection = request();
    await admitTrustedSalesTaskCreateId(wrongCollection, { id: 42, resourceId: "42" });
    await expect(accounts({ collection: { slug: "sales-accounts" }, data: { id: 42 }, operation: "create", req: wrongCollection } as never)).rejects.toThrow("Explicit Payload IDs");

    for (const id of [0, -1, 2_147_483_648, "42", "042", null]) {
      const req = request();
      await admitTrustedSalesTaskCreateId(req, { id: 42, resourceId: "42" });
      await expect(tasks({ collection: { slug: "sales-tasks" }, data: { id }, operation: "create", req } as never)).rejects.toThrow("Explicit Payload IDs");
    }

    const differentTransaction = request("transaction-1");
    await admitTrustedSalesTaskCreateId(differentTransaction, { id: 42, resourceId: "42" });
    (differentTransaction as { transactionID: string }).transactionID = "transaction-2";
    await expect(tasks({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req: differentTransaction } as never)).rejects.toThrow("Explicit Payload IDs");
  });

  it("rejects malformed host admissions before they can reach a collection", async () => {
    for (const input of [
      { id: 0, resourceId: "0" },
      { id: 42, resourceId: "042" },
      { id: 2_147_483_648, resourceId: "2147483648" }
    ]) {
      await expect(admitTrustedSalesTaskCreateId(request(), input)).rejects.toThrow("Trusted Sales task ID admission is invalid");
    }
  });

  it("checks the final data after a collection hook, so hook-added or hook-mutated IDs cannot bypass admission", async () => {
    const injected = withTrustedSalesTaskCreateIdAdmission({
      slug: "sales-accounts", fields: [], hooks: { beforeChange: [({ data }) => ({ ...data, id: 42 })] }
    });
    const injectedHooks = injected.hooks?.beforeChange;
    if (injectedHooks === undefined) throw new Error("Explicit-ID hook was not composed.");
    const injectedRequest = request();
    const injectedData = await injectedHooks[0]!({ collection: { slug: "sales-accounts" }, data: {}, operation: "create", req: injectedRequest } as never);
    await expect(injectedHooks[1]!({ collection: { slug: "sales-accounts" }, data: injectedData, operation: "create", req: injectedRequest } as never)).rejects.toThrow("Explicit Payload IDs");

    const mutated = withTrustedSalesTaskCreateIdAdmission({
      slug: "sales-tasks", fields: [], hooks: { beforeChange: [({ data }) => ({ ...data, id: 43 })] }
    });
    const mutatedHooks = mutated.hooks?.beforeChange;
    if (mutatedHooks === undefined) throw new Error("Explicit-ID hook was not composed.");
    const mutatedRequest = request();
    await admitTrustedSalesTaskCreateId(mutatedRequest, { id: 42, resourceId: "42" });
    const mutatedData = await mutatedHooks[0]!({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req: mutatedRequest } as never);
    await expect(mutatedHooks[1]!({ collection: { slug: "sales-tasks" }, data: mutatedData, operation: "create", req: mutatedRequest } as never)).rejects.toThrow("Explicit Payload IDs");
  });

  it("shares one closed process registry across independent module evaluations without allowing replacement", async () => {
    const duplicate = await import("../src/persistence-capability.js?trusted-sales-task-id-copy");
    const taskHook = (slug: string) => {
      const hook = duplicate.withTrustedSalesTaskCreateIdAdmission({ slug, fields: [] }).hooks?.beforeChange?.at(-1);
      if (hook === undefined) throw new Error("Explicit-ID hook was not composed.");
      return hook;
    };
    const tasks = taskHook("sales-tasks");
    const accounts = taskHook("sales-accounts");

    const accepted = request();
    await admitTrustedSalesTaskCreateId(accepted, { id: 42, resourceId: "42" });
    await expect(tasks({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req: accepted } as never)).resolves.toEqual({ id: 42 });
    await expect(tasks({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req: accepted } as never)).rejects.toThrow("Explicit Payload IDs");

    const wrongRequest = request();
    await admitTrustedSalesTaskCreateId(wrongRequest, { id: 42, resourceId: "42" });
    await expect(tasks({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req: request() } as never)).rejects.toThrow("Explicit Payload IDs");
    await expect(tasks({ collection: { slug: "sales-tasks" }, data: { id: 43 }, operation: "create", req: wrongRequest } as never)).rejects.toThrow("Explicit Payload IDs");

    const wrongCollection = request();
    await admitTrustedSalesTaskCreateId(wrongCollection, { id: 42, resourceId: "42" });
    await expect(accounts({ collection: { slug: "sales-accounts" }, data: { id: 42 }, operation: "create", req: wrongCollection } as never)).rejects.toThrow("Explicit Payload IDs");

    const wrongTransaction = request("transaction-1");
    await admitTrustedSalesTaskCreateId(wrongTransaction, { id: 42, resourceId: "42" });
    (wrongTransaction as { transactionID: string }).transactionID = "transaction-2";
    await expect(tasks({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req: wrongTransaction } as never)).rejects.toThrow("Explicit Payload IDs");

    const revoked = request();
    await admitTrustedSalesTaskCreateId(revoked, { id: 42, resourceId: "42" });
    revokeTrustedSalesTaskCreateId(revoked);
    await expect(tasks({ collection: { slug: "sales-tasks" }, data: { id: 42 }, operation: "create", req: revoked } as never)).rejects.toThrow("Explicit Payload IDs");

    const registryKey = Symbol.for("@k-nex/payload-adapter/trusted-sales-task-create-id-admission/v1");
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, registryKey);
    expect(descriptor).toMatchObject({ writable: false, configurable: false, enumerable: false });
    expect(Reflect.set(globalThis, registryKey, Object.create(null))).toBe(false);
    expect(Reflect.deleteProperty(globalThis, registryKey)).toBe(false);
  });
});
