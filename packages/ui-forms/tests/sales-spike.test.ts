import { salesCreateTaskMutation, salesOpportunitiesQuery, salesOpportunityStageMutation } from "../../../modules/sales/src/browser.js";
import type { BrowserDataTransport } from "@k-nex/ui-runtime";
import { describe, expect, it } from "vitest";

import { createFormController, formEngineDecision } from "../src/index.js";

const signal = new AbortController().signal;

describe("bounded Sales form spike", () => {
  it("submits create-task through the registered mutation and clears dirty state", async () => {
    const calls: string[] = [];
    const transport: BrowserDataTransport = {
      async query() { return { ok: false, problem: { code: "UNUSED", status: 500 } }; },
      async mutate(request) {
        calls.push(request.action.id);
        return { ok: true, data: { id: "task-1", title: (request.input as { title: string }).title, status: "open" } };
      }
    };
    const controller = createFormController({
      initialValues: { title: "", status: "open" as const },
      validate: (values) => values.title.length === 0 ? { title: "Required" } : {},
      submit: (values, requestSignal) => salesCreateTaskMutation.execute(transport, values, { signal: requestSignal, idempotencyKey: "form-task-1" })
    });
    const invalid = await controller.submit(controller.initial(), signal);
    expect(invalid.fieldErrors).toEqual({ title: "Required" });
    const changed = controller.change(controller.initial(), "title", "Follow up");
    expect(changed.dirty).toBe(true);
    const submitted = await controller.submit(changed, signal);
    expect(submitted).toMatchObject({ dirty: false, fieldErrors: {}, submitting: false });
    expect(controller.change(submitted, "title", "Follow up").dirty).toBe(false);
    expect(controller.change(submitted, "title", "Next follow up").dirty).toBe(true);
    expect(calls).toEqual(["sales.task.create"]);
    expect(salesCreateTaskMutation.invalidation.sources).toEqual(["sales.tasks", "sales.total-potential-revenue"]);
  });

  it("maps bounded server field errors and conflicts for opportunity edit", async () => {
    const transport: BrowserDataTransport = {
      async query() { return { ok: false, problem: { code: "UNUSED", status: 500 } }; },
      async mutate() {
        return { ok: false, problem: { code: "OPPORTUNITY_CONFLICT", status: 409, fieldErrors: [{ field: "stage", message: "Stage changed", code: "stale" }, { field: "foreign", message: "Ignored" }] } };
      }
    };
    const controller = createFormController({
      initialValues: { id: "opp-1", stage: "lead" as "lead" | "qualified" | "won" | "lost" },
      validate: () => ({}),
      submit: (values, requestSignal) => salesOpportunityStageMutation.execute(transport, values, { signal: requestSignal, idempotencyKey: "form-opp-1" })
    });
    const result = await controller.submit(controller.change(controller.initial(), "stage", "qualified"), signal);
    expect(result.fieldErrors).toEqual({ stage: "Stage changed" });
    expect(result.formError).toBe("OPPORTUNITY_CONFLICT");
  });

  it("loads async opportunity options through the registered source query", async () => {
    const calls: string[] = [];
    const transport: BrowserDataTransport = {
      async query(request) {
        calls.push(request.source.id);
        return { ok: true, data: {
          fields: ["name", "stage", "value"],
          rows: [{ key: "opp-1", values: { name: { kind: "text", value: "Platform rollout" }, stage: { kind: "status", value: "qualified" }, value: { kind: "money", value: "1200.5", currency: "USD", scale: 2 } } }],
          page: { number: 1, pageSize: 25, hasNext: false }
        } };
      },
      async mutate() { return { ok: false, problem: { code: "UNUSED", status: 500 } }; }
    };
    const result = await salesOpportunitiesQuery.execute(transport, {}, {
      surface: "workspace",
      authorizationBoundary: { kind: "actor", actorFingerprint: `sha256:${"a".repeat(64)}` },
      signal
    });
    expect(result.state).toBe("success");
    expect(calls).toEqual(["sales.opportunities"]);
    expect(formEngineDecision.engine).toBe("native-react-state");
  });

  it("publishes a reachable pending snapshot and coalesces duplicate submission", async () => {
    let resolve!: (result: { readonly state: "success"; readonly data: { readonly id: string } }) => void;
    let calls = 0;
    const controller = createFormController({
      initialValues: { title: "" },
      validate: () => ({}),
      submit: async () => {
        calls += 1;
        return new Promise((done) => { resolve = done; });
      }
    });
    const observed: boolean[] = [];
    const unsubscribe = controller.subscribe((snapshot) => observed.push(snapshot.submitting));
    const changed = controller.change(controller.initial(), "title", "Follow up");
    const first = controller.submit(changed, signal);
    const duplicate = controller.submit(changed, signal);

    expect(duplicate).toBe(first);
    expect(calls).toBe(1);
    expect(controller.snapshot()).toMatchObject({ values: { title: "Follow up" }, submitting: true });
    resolve({ state: "success", data: { id: "task-1" } });
    await expect(first).resolves.toMatchObject({ dirty: false, submitting: false });
    expect(controller.snapshot().submitting).toBe(false);
    expect(observed).toEqual([false, true, false]);
    unsubscribe();
  });
});
