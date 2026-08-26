import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createDataSourceQueryIdentity,
  dataSourceBindingStates,
  type DataSourceBindingResult
} from "../src/index.js";

const fingerprint = (character: string) => `sha256:${character.repeat(64)}`;

const baseIdentity = {
  source: { id: "sales.tasks", version: 1 },
  input: { window: { from: "2026-08-01", to: "2026-08-31" } },
  selectedFields: ["title", "status"],
  surface: "workspace",
  locale: "en-GB",
  timezone: "Europe/London",
  publicationRevision: "published:r4",
  authorizationBoundary: { kind: "actor", actorFingerprint: fingerprint("a") }
} as const;

describe("P2.8 headless data-source bindings", () => {
  it("represents every documented result state as an exhaustive discriminated union", () => {
    const problem = { code: "SAFE_FAILURE", status: 500 as const };
    const results: DataSourceBindingResult<number>[] = [
      { state: "idle" },
      { state: "loading" },
      { state: "success", data: 1 },
      { state: "empty" },
      { state: "forbidden", problem: { code: "FORBIDDEN", status: 403 } },
      { state: "insufficient-permission", problem: { code: "INSUFFICIENT_PERMISSION", status: 403 } },
      { state: "invalid-contract", problem },
      { state: "rate-limited", problem: { code: "RATE_LIMITED", status: 429 }, retryAfterMs: 1_000 },
      { state: "error", problem },
      { state: "stale", data: 1 },
      { state: "refetching", data: 1 }
    ];

    expect(results.map(({ state }) => state)).toEqual(dataSourceBindingStates);
    expectTypeOf(results).toEqualTypeOf<DataSourceBindingResult<number>[]>();
  });

  it("produces the same digest identity across object key order", async () => {
    const first = await createDataSourceQueryIdentity(baseIdentity);
    const reordered = await createDataSourceQueryIdentity({
      authorizationBoundary: baseIdentity.authorizationBoundary,
      publicationRevision: baseIdentity.publicationRevision,
      timezone: baseIdentity.timezone,
      locale: baseIdentity.locale,
      surface: baseIdentity.surface,
      selectedFields: baseIdentity.selectedFields,
      input: { window: { to: "2026-08-31", from: "2026-08-01" } },
      source: baseIdentity.source
    });
    expect(reordered.key).toBe(first.key);
    expect(first.key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.key).not.toContain("sales.tasks");
    expect(first.key).not.toContain("2026-08-01");
  });

  it("keeps ordered projections and every semantic dimension identity-significant", async () => {
    const original = (await createDataSourceQueryIdentity(baseIdentity)).key;
    for (const changed of [
      { ...baseIdentity, source: { ...baseIdentity.source, version: 2 } },
      { ...baseIdentity, input: { window: { from: "2026-08-02", to: "2026-08-31" } } },
      { ...baseIdentity, selectedFields: ["status", "title"] },
      { ...baseIdentity, surface: "cms" },
      { ...baseIdentity, locale: "tr-TR" },
      { ...baseIdentity, timezone: "Europe/Istanbul" },
      { ...baseIdentity, publicationRevision: "published:r5" },
      { ...baseIdentity, authorizationBoundary: { kind: "actor", actorFingerprint: fingerprint("b") } }
    ]) {
      expect((await createDataSourceQueryIdentity(changed)).key).not.toBe(original);
    }
  });

  it("supports actor, authorization-context, public, and actor-isolated no-store boundaries", async () => {
    for (const authorizationBoundary of [
      { kind: "actor", actorFingerprint: fingerprint("a") },
      { kind: "authorization-context", fingerprint: fingerprint("b") },
      { kind: "public", revision: "public:r3" },
      { kind: "no-store", actorFingerprint: fingerprint("c") }
    ] as const) {
      await expect(createDataSourceQueryIdentity({ ...baseIdentity, authorizationBoundary })).resolves.toMatchObject({
        key: expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
      });
    }
  });

  it("rejects role-only, duplicate, unknown, non-JSON, and oversized identities", async () => {
    for (const invalid of [
      { ...baseIdentity, authorizationBoundary: { kind: "authorization-context", fingerprint: "role:admin" } },
      { ...baseIdentity, authorizationBoundary: { kind: "role", name: "admin" } },
      { ...baseIdentity, selectedFields: ["title", "title"] },
      { ...baseIdentity, extra: true },
      { ...baseIdentity, input: { invalid: Number.NaN } }
    ]) {
      await expect(createDataSourceQueryIdentity(invalid)).rejects.toThrow(TypeError);
    }
    await expect(createDataSourceQueryIdentity({ ...baseIdentity, input: "x".repeat(1_048_576) })).rejects.toThrow(RangeError);
  });

  it("clones and deeply freezes identity dimensions without freezing caller data", async () => {
    const input = { nested: { value: 1 } };
    const identity = await createDataSourceQueryIdentity({ ...baseIdentity, input });
    input.nested.value = 2;

    expect(identity.input).toEqual({ nested: { value: 1 } });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.input)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
  });
});
