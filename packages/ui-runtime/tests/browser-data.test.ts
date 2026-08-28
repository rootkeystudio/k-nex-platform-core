import { describe, expect, it, vi } from "vitest";

import type { RuntimeSchema } from "@k-nex/contracts";
import {
  defineActionMutation,
  defineSourceQuery,
  deserializeBrowserViewState,
  serializeBrowserViewState,
  type BrowserDataTransport
} from "../src/index.js";

const objectSchema = <T extends Record<string, unknown>>(validate: (value: Record<string, unknown>) => value is T): RuntimeSchema<T> => ({
  safeParse(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && validate(value as Record<string, unknown>)
      ? { success: true, data: structuredClone(value as T) }
      : { success: false, error: new Error("invalid") };
  }
});

const inputSchema = objectSchema<{ status: string }>((value): value is { status: string } =>
  Object.keys(value).length === 1 && typeof value.status === "string");
const outputSchema = objectSchema<{ rows: unknown[] }>((value): value is { rows: unknown[] } =>
  Object.keys(value).length === 1 && Array.isArray(value.rows));
const actionOutputSchema = objectSchema<{ id: string }>((value): value is { id: string } =>
  Object.keys(value).length === 1 && typeof value.id === "string");

const query = defineSourceQuery({
  source: { id: "sales.tasks", version: 1 },
  input: inputSchema,
  output: outputSchema,
  defaults: { status: "open" },
  selectedFields: ["title", "status"],
  isEmpty: (value) => value.rows.length === 0
});

const mutation = defineActionMutation({
  action: { id: "sales.task.create", version: 1 },
  input: inputSchema,
  output: actionOutputSchema,
  invalidates: ["sales.total-potential-revenue", "sales.tasks"]
});

const authorizationBoundary = { kind: "actor", actorFingerprint: `sha256:${"a".repeat(64)}` } as const;
const queryContext = (signal = new AbortController().signal) => ({
  surface: "workspace" as const,
  locale: "en-US",
  timezone: "Europe/Istanbul",
  publicationRevision: "7",
  authorizationBoundary,
  signal
});

function transport(overrides: Partial<BrowserDataTransport> = {}): BrowserDataTransport {
  return {
    query: async () => ({ ok: true, data: { rows: [{ id: "task-1" }] } }),
    mutate: async () => ({ ok: true, data: { id: "task-1" } }),
    ...overrides
  };
}

describe("P6.5 standard browser data factories", () => {
  it("builds a stable authorization-safe query identity", async () => {
    const first = await query.identity({ status: "open" }, queryContext());
    const second = await query.identity({ status: "open" }, queryContext());
    const differentActor = await query.identity({ status: "open" }, {
      ...queryContext(),
      authorizationBoundary: { kind: "actor", actorFingerprint: `sha256:${"b".repeat(64)}` }
    });
    expect(first.key).toBe(second.key);
    expect(first.key).not.toBe(differentActor.key);
    expect(first.key).not.toContain("open");
  });

  it("uses only the injected platform transport and standard result states", async () => {
    const queryCall = vi.fn(async () => ({ ok: true as const, data: { rows: [] } }));
    expect(await query.execute(transport({ query: queryCall }), query.defaults, queryContext())).toEqual({ state: "empty" });
    expect(queryCall).toHaveBeenCalledWith(expect.objectContaining({ source: { id: "sales.tasks", version: 1 }, signal: expect.any(AbortSignal) }));

    expect(await query.execute(transport({ query: async () => ({ ok: false, problem: { code: "DENIED", status: 403 } }) }), query.defaults, queryContext()))
      .toEqual({ state: "forbidden", problem: { code: "DENIED", status: 403 } });
    expect(await query.execute(transport({ query: async () => ({ ok: true, data: { invalid: true } }) }), query.defaults, queryContext()))
      .toEqual({ state: "invalid-contract" });
  });

  it("validates and forwards bounded table query controls", async () => {
    const queryCall = vi.fn(async () => ({ ok: true as const, data: { rows: [{ id: "task-1" }] } }));
    const controls = { page: { number: 2, size: 25 }, filters: [{ field: "status", operator: "eq" as const, value: "open" }], sort: [{ field: "status", direction: "asc" as const }] };
    expect((await query.executeWithControls(transport({ query: queryCall }), query.defaults, controls, queryContext())).state).toBe("success");
    expect(queryCall).toHaveBeenCalledWith(expect.objectContaining({ controls }));
    expect((await query.executeWithControls(transport({ query: queryCall }), query.defaults, { ...controls, page: { number: 0, size: 25 } }, queryContext())).state).toBe("invalid-contract");
    const firstIdentity = await query.identityWithControls(query.defaults, controls, queryContext());
    const secondIdentity = await query.identityWithControls(query.defaults, { ...controls, page: { number: 3, size: 25 } }, queryContext());
    expect(firstIdentity.key).not.toBe(secondIdentity.key);
  });

  it("rejects selected-field overrides outside the definition projection", async () => {
    const controls = { page: { number: 1, size: 25 }, filters: [], sort: [] };
    await expect(query.identityWithControls(query.defaults, controls, queryContext(), ["title", "private-note"]))
      .rejects.toThrow(TypeError);
    const queryCall = vi.fn(async () => ({ ok: true as const, data: { rows: [] } }));
    await expect(query.executeWithControls(transport({ query: queryCall }), query.defaults, controls, queryContext(), ["title", "private-note"]))
      .resolves.toEqual({ state: "invalid-contract" });
    expect(queryCall).not.toHaveBeenCalled();
  });

  it("cancels promptly even when transport ignores its signal", async () => {
    const controller = new AbortController();
    const pending = query.execute(transport({ query: () => new Promise(() => undefined) }), query.defaults, queryContext(controller.signal));
    controller.abort();
    await expect(pending).resolves.toEqual({ state: "cancelled" });
  });

  it("freezes deterministic source/action invalidation metadata", async () => {
    expect(query.invalidation.sources).toEqual(["sales.tasks"]);
    expect(mutation.invalidation.sources).toEqual(["sales.tasks", "sales.total-potential-revenue"]);
    expect(Object.isFrozen(mutation.invalidation.sources)).toBe(true);
    expect(await mutation.execute(transport(), { status: "open" }, { signal: new AbortController().signal, idempotencyKey: "task-create-1" }))
      .toEqual({ state: "success", data: { id: "task-1" } });
  });

  it("serializes canonical Unicode view state to a URL-safe bounded value", () => {
    const encoded = serializeBrowserViewState({ filters: [{ field: "title", value: "İstanbul satış" }], page: 2 });
    expect(encoded).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(deserializeBrowserViewState(encoded)).toEqual({ filters: [{ field: "title", value: "İstanbul satış" }], page: 2 });
    expect(serializeBrowserViewState({ page: 2, filters: [{ value: "İstanbul satış", field: "title" }] })).toBe(encoded);
  });

  it("rejects actor and authorization record scope in query and persisted view state", async () => {
    const unsafeSchema: RuntimeSchema<Record<string, unknown>> = { safeParse: (value) => ({ success: true, data: value as Record<string, unknown> }) };
    expect(() => defineSourceQuery({
      source: { id: "sales.tasks", version: 1 }, input: unsafeSchema, output: outputSchema,
      defaults: { recordScope: { tenant: "customer-1" } }
    })).toThrow(TypeError);
    expect(() => serializeBrowserViewState({ actorId: "user-1", page: 1 })).toThrow(TypeError);
  });
});
