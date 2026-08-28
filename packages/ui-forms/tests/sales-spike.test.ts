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
    const pending = controller.snapshot();
    const duplicate = controller.submit(pending, signal);

    expect(duplicate).toBe(first);
    expect(controller.submit(changed, signal)).toBe(first);
    expect(calls).toBe(1);
    expect(controller.snapshot()).toMatchObject({ values: { title: "Follow up" }, submitting: true });
    resolve({ state: "success", data: { id: "task-1" } });
    await expect(first).resolves.toMatchObject({ dirty: false, submitting: false });
    expect(controller.snapshot().submitting).toBe(false);
    expect(observed).toEqual([false, true, false]);
    unsubscribe();
  });

  it("keeps newer edits and submits them independently while an earlier submission settles", async () => {
    const completions: ((result: { readonly state: "success"; readonly data: { readonly id: string } }) => void)[] = [];
    const controller = createFormController({
      initialValues: { title: "" }, validate: () => ({}),
      submit: async () => new Promise((resolve) => completions.push(resolve))
    });
    const firstValues = controller.change(controller.initial(), "title", "First");
    const first = controller.submit(firstValues, signal);
    const secondValues = controller.change(controller.snapshot(), "title", "Second");
    const second = controller.submit(secondValues, signal);

    expect(second).not.toBe(first);
    expect(completions).toHaveLength(2);
    completions[0]!({ state: "success", data: { id: "first" } });
    await expect(first).resolves.toMatchObject({ values: { title: "First" }, dirty: false });
    expect(controller.snapshot()).toMatchObject({ values: { title: "Second" }, initialValues: { title: "First" }, dirty: true, submitting: true });
    completions[1]!({ state: "success", data: { id: "second" } });
    await expect(second).resolves.toMatchObject({ values: { title: "Second" }, dirty: false });
  });

  it("does not let an older cancellation or error overwrite newer edits", async () => {
    const completions: ((result: { readonly state: "cancelled" } | { readonly state: "error"; readonly problem: { readonly code: string; readonly status: number } }) => void)[] = [];
    const controller = createFormController({
      initialValues: { title: "" }, validate: () => ({}),
      submit: async () => new Promise((resolve) => completions.push(resolve))
    });
    const firstValues = controller.change(controller.initial(), "title", "First");
    const first = controller.submit(firstValues, signal);
    const secondValues = controller.change(controller.snapshot(), "title", "Second");
    const second = controller.submit(secondValues, signal);

    completions[0]!({ state: "cancelled" });
    await first;
    expect(controller.snapshot()).toMatchObject({ values: { title: "Second" }, submitting: true });
    completions[1]!({ state: "error", problem: { code: "SECOND_FAILED", status: 500 } });
    await expect(second).resolves.toMatchObject({ values: { title: "Second" }, formError: "SECOND_FAILED", submitting: false });
  });

  it("does not let an older success finishing last replace a newer saved baseline", async () => {
    const completions: ((result: { readonly state: "success"; readonly data: { readonly id: string } }) => void)[] = [];
    const controller = createFormController({
      initialValues: { title: "" }, validate: () => ({}),
      submit: async () => new Promise((resolve) => completions.push(resolve))
    });
    const firstValues = controller.change(controller.initial(), "title", "First");
    const first = controller.submit(firstValues, signal);
    const secondValues = controller.change(controller.snapshot(), "title", "Second");
    const second = controller.submit(secondValues, signal);

    completions[1]!({ state: "success", data: { id: "second" } });
    await second;
    completions[0]!({ state: "success", data: { id: "first" } });
    await first;
    expect(controller.snapshot()).toMatchObject({ values: { title: "Second" }, initialValues: { title: "Second" }, dirty: false });
  });
});
