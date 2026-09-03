import { canonicalJson } from "@k-nex/contracts";
import { sha256 } from "@k-nex/extension-bundler";
import { describe, expect, it, vi } from "vitest";

import { PostgresVerifiedArtifactStore } from "../src/index.js";

const artifactDigest = `sha256:${"a".repeat(64)}` as const;
const manifestDigest = `sha256:${"b".repeat(64)}` as const;
const provenanceDigest = `sha256:${"c".repeat(64)}` as const;
const sbomDigest = `sha256:${"d".repeat(64)}` as const;
const authority = {
  applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application" as const,
  extensionId: "app.sales-assistant", generationId: "sales-generation-1", sourceCommit: "abcdef1234567890",
  artifactDigest, manifestDigest, provenanceDigest, sbomDigest, catalogDigest: "" as string
};
const catalog = { payload: { sequence: 1 } };
authority.catalogDigest = sha256(Buffer.from(canonicalJson(catalog)));
const securityCatalogDigest = sha256(Buffer.from(canonicalJson({ payload: { sequence: 2 } })));
const permissions = [
  {
    schemaVersion: 1, id: "sales.orders.write", publisher: { kind: "extension", deliveryClass: "hot-application", extensionId: authority.extensionId },
    title: "Write sales orders", description: "Write sales orders through the authorized sales extension.", audience: "authenticated", resource: "sales.orders", operation: "write", scope: "application"
  },
  {
    schemaVersion: 1, id: "sales.orders.read", publisher: { kind: "extension", deliveryClass: "hot-application", extensionId: authority.extensionId },
    title: "Read sales orders", description: "Read sales orders through the authorized sales extension.", audience: "authenticated", resource: "sales.orders", operation: "read", scope: "application"
  }
] as const;

const verified = {
  artifactDigest,
  entry: { manifestDigest, provenanceDigest, sbomDigest, source: { commit: authority.sourceCommit } },
  manifest: {
    deliveryClass: "hot-application" as const, id: authority.extensionId, version: "1.0.0", resourceBudget: { maxCpuMs: 1 }
  },
  hotApplicationManifest: { screens: [], permissions },
  files: new Map()
};

function securityMirror() {
  return { readSecuritySnapshot: vi.fn(async () => ({ snapshotId: "catalog-snapshot-1", signedCatalog: catalog, signerIdentity: "catalog", sequence: 1, digest: authority.catalogDigest, releaseCount: 1, observedAt: "2026-09-02T00:00:00.000Z" })) };
}

function currentSecurityDecision(disposition = "clear") {
  return vi.fn(async () => ({ disposition }));
}

function stagedVerification() {
  return vi.fn(async () => ({ verified, snapshot: { catalog, entries: [], checkpoint: { signerIdentity: "catalog", sequence: 1, payloadDigest: authority.catalogDigest, highestVersions: {} } } }));
}

function binding() {
  return {
    application_id: authority.applicationId, environment: authority.environment, delivery_class: authority.deliveryClass,
    extension_id: authority.extensionId, generation_id: authority.generationId, artifact_digest: authority.artifactDigest, catalog_digest: authority.catalogDigest,
    authority_json: authority, activation_json: { compatibility: { mode: "compatible" }, metadata: {}, settings: {}, storageSchemaVersions: {} }, version: "1.0.0"
  };
}

function lifecycleTransition(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1, eventType: "extension.lifecycle-transition", applicationId: authority.applicationId, environment: authority.environment,
    deliveryClass: "hot-application", id: authority.extensionId, evidence: {
      generationId: authority.generationId, sourceCommit: authority.sourceCommit, artifactDigest: authority.artifactDigest,
      manifestDigest, catalogDigest: authority.catalogDigest, provenanceDigest, sbomDigest
    },
    ...overrides
  } as any;
}

function securityTransition(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1, eventId: "security-event-1", eventType: "extension.security-quarantine", securityTransitionId: "security-transition-1",
    receiptId: "security-receipt-1", auditId: "security-audit-1", applicationId: authority.applicationId, environment: authority.environment,
    deliveryClass: "hot-application", id: authority.extensionId, expectedRevision: 4, revision: 5, inventoryRevision: 5,
    occurredAt: "2026-09-01T00:00:00.000Z", evidence: {
      generationId: authority.generationId, sourceCommit: authority.sourceCommit, artifactDigest: authority.artifactDigest,
      manifestDigest, catalogDigest: securityCatalogDigest, catalogSignerIdentity: "security-catalog", catalogSequence: 2,
      provenanceDigest, sbomDigest, version: "1.0.0", disposition: "revoked"
    },
    ...overrides
  } as any;
}

function resolverHarness(row: ReturnType<typeof binding> | null = binding()) {
  const query = vi.fn(async (text: string) => {
    if (text.includes("from runtime_extension_artifact_bindings")) return { rows: row ? [row] : [] };
    if (text.includes("from runtime_extension_artifacts")) return { rows: [{ artifact_digest: artifactDigest, artifact_bytes: Buffer.from("bundle") }] };
    if (text.includes("from runtime_extension_artifact_acceptances")) {
      return { rows: [{ artifact_digest: artifactDigest, catalog_digest: authority.catalogDigest, catalog_json: catalog, provenance_bytes: Buffer.from("provenance"), delivery_class: authority.deliveryClass, extension_id: authority.extensionId, version: "1.0.0", runtime_abi: "1.0.0" }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const session = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => { throw new Error("resolver must not open a transaction"); }), query: vi.fn(async () => { throw new Error("resolver must use its supplied session"); }) };
  const verifier = { verifyAccepted: vi.fn(async () => verified), currentSecurityDecisionFromCurrentSnapshot: currentSecurityDecision() };
  const mirror = securityMirror();
  return { query, session, pool, verifier, mirror, store: new PostgresVerifiedArtifactStore(pool as any, verifier as any, mirror as any, authority) };
}

const settingsIdentity = {
  applicationId: authority.applicationId,
  environment: authority.environment,
  appId: authority.extensionId,
  generationId: authority.generationId,
  artifactDigest
} as const;

function settingsReaderHarness(options: Readonly<{
  lifecycle?: "active" | "disabled" | "quarantined" | "retired" | "stale";
  bindingRow?: ReturnType<typeof binding> | null;
  artifact?: boolean;
  acceptance?: boolean;
  corrupt?: boolean;
}> = {}) {
  const queries: string[] = [];
  const lifecycle = options.lifecycle ?? "active";
  const row = options.bindingRow === undefined ? binding() : options.bindingRow;
  const session = {
    query: vi.fn(async (text: string, values?: readonly unknown[]) => {
      queries.push(text);
      if (text.includes("from runtime_extension_artifact_bindings")) {
        if (values?.length === 4) return { rows: row ? [row] : [] };
        const exact = JSON.stringify(values) === JSON.stringify([
          authority.applicationId, authority.environment, authority.extensionId, authority.generationId, artifactDigest
        ]);
        return { rows: lifecycle === "active" && exact && row ? [row] : [] };
      }
      if (text.includes("from runtime_extension_artifacts")) {
        return { rows: options.artifact === false ? [] : [{ artifact_digest: artifactDigest, artifact_bytes: Buffer.from("bundle") }] };
      }
      if (text.includes("from runtime_extension_artifact_acceptances")) {
        return { rows: options.acceptance === false ? [] : [{
          artifact_digest: artifactDigest, catalog_digest: authority.catalogDigest, catalog_json: catalog,
          provenance_bytes: Buffer.from("provenance"), delivery_class: authority.deliveryClass,
          extension_id: authority.extensionId, version: "1.0.0", runtime_abi: "1.0.0"
        }] };
      }
      return { rows: [] };
    }),
    release: vi.fn()
  };
  const pool = { connect: vi.fn(async () => session), query: vi.fn((text: string, values?: readonly unknown[]) => session.query(text, values)) };
  const verifier = {
    verifyAccepted: vi.fn(async () => {
      if (options.corrupt) throw new Error("corrupt verified evidence");
      return verified;
    }),
    currentSecurityDecisionFromCurrentSnapshot: currentSecurityDecision()
  };
  const mirror = securityMirror();
  return { queries, session, pool, verifier, mirror, store: new PostgresVerifiedArtifactStore(pool as any, verifier as any, mirror as any, authority) };
}

describe("PostgresVerifiedArtifactStore Remote UI reader", () => {
  it.each(["release-missing", "security-compromised"] as const)("rejects a staged %s release before binding it", async (disposition) => {
    const writes: string[] = [];
    const session = { query: vi.fn(async (text: string) => { writes.push(text); return { rows: [] }; }), release: vi.fn() };
    const mirror = securityMirror();
    const store = new PostgresVerifiedArtifactStore(
      { connect: vi.fn(async () => session) } as any,
      { verifyCurrentSnapshot: stagedVerification(), currentSecurityDecisionFromSnapshot: vi.fn(() => ({ disposition })) } as any,
      mirror as any,
      authority
    );

    await expect(store.stage({
      owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId, generationId: authority.generationId },
      verification: { catalog, artifact: Buffer.from("bundle"), provenance: Buffer.from("provenance"), deliveryClass: authority.deliveryClass, id: authority.extensionId, version: "1.0.0", runtimeAbi: "1.0.0" },
      authority, activation: { compatibility: { mode: "compatible" }, metadata: {}, settings: {}, storageSchemaVersions: {} } as any
    })).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(mirror.readSecuritySnapshot).toHaveBeenCalledOnce();
    expect(writes).toEqual([]);
  });

  it("uses the exact nonmutating mirror snapshot for admission", async () => {
    const writes: string[] = [];
    const session = { query: vi.fn(async (text: string) => { writes.push(text); return { rows: [] }; }), release: vi.fn() };
    const mirror = securityMirror();
    const verifier = {
      verify: vi.fn(),
      verifyCurrentSnapshot: stagedVerification(),
      currentSecurityDecisionFromSnapshot: vi.fn(() => ({ disposition: "clear" }))
    };
    const store = new PostgresVerifiedArtifactStore({ connect: vi.fn(async () => session) } as any, verifier as any, mirror as any, authority);

    await expect(store.stage({
      owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId, generationId: authority.generationId },
      verification: { catalog, artifact: Buffer.from("bundle"), provenance: Buffer.from("provenance"), deliveryClass: authority.deliveryClass, id: authority.extensionId, version: "1.0.0", runtimeAbi: "1.0.0" },
      authority, activation: { compatibility: { mode: "compatible" }, metadata: {}, settings: {}, storageSchemaVersions: {} } as any
    })).rejects.toMatchObject({ code: "ARTIFACT_CONFLICT" });

    expect(verifier.verify).not.toHaveBeenCalled();
    expect(verifier.verifyCurrentSnapshot).toHaveBeenCalledWith(expect.anything(), {
      signerIdentity: "catalog", sequence: 1, payloadDigest: authority.catalogDigest, highestVersions: {}
    });
    expect(mirror.readSecuritySnapshot).toHaveBeenCalledWith({ applicationId: authority.applicationId, environment: authority.environment });
    expect(mirror.readSecuritySnapshot).toHaveBeenCalledTimes(2);
    expect(writes.some((query) => query.includes("runtime_catalog_checkpoints"))).toBe(false);
  });

  it("denies cross-tenant reads before touching the catalog mirror", async () => {
    const value = settingsReaderHarness();

    await expect(value.store.resolve({
      owner: { applicationId: "customer-beta", environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId },
      generationId: authority.generationId, artifactDigest
    })).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });

    expect(value.pool.query).not.toHaveBeenCalled();
    expect(value.mirror.readSecuritySnapshot).not.toHaveBeenCalled();
  });

  it("denies admission when the mirror pointer or signer rotates during verification", async () => {
    let releaseVerification: (() => void) | undefined;
    let verificationStarted: (() => void) | undefined;
    const pause = new Promise<void>((resolve) => { releaseVerification = resolve; });
    const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
    const initial = { snapshotId: "catalog-snapshot-1", signedCatalog: catalog, signerIdentity: "catalog", sequence: 1, digest: authority.catalogDigest, releaseCount: 1, observedAt: "2026-09-02T00:00:00.000Z" };
    const rotated = { ...initial, snapshotId: "catalog-snapshot-2", signerIdentity: "catalog-rotated", sequence: 2, digest: securityCatalogDigest };
    const mirror = { readSecuritySnapshot: vi.fn(async () => mirror.readSecuritySnapshot.mock.calls.length === 1 ? initial : rotated) };
    const verifier = {
      verify: vi.fn(),
      verifyCurrentSnapshot: vi.fn(async () => {
        verificationStarted?.();
        await pause;
        return { verified, snapshot: { catalog, entries: [], checkpoint: { signerIdentity: "catalog", sequence: 1, payloadDigest: authority.catalogDigest, highestVersions: {} } } };
      }),
      currentSecurityDecisionFromSnapshot: vi.fn(() => ({ disposition: "clear" }))
    };
    const writes: string[] = [];
    const session = { query: vi.fn(async (text: string) => { writes.push(text); return { rows: [] }; }), release: vi.fn() };
    const store = new PostgresVerifiedArtifactStore({ connect: vi.fn(async () => session) } as any, verifier as any, mirror as any, authority);
    const staging = store.stage({
      owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId, generationId: authority.generationId },
      verification: { catalog, artifact: Buffer.from("bundle"), provenance: Buffer.from("provenance"), deliveryClass: authority.deliveryClass, id: authority.extensionId, version: "1.0.0", runtimeAbi: "1.0.0" },
      authority, activation: { compatibility: { mode: "compatible" }, metadata: {}, settings: {}, storageSchemaVersions: {} } as any
    });

    await started;
    releaseVerification?.();
    await expect(staging).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("denies artifact staging when the current mirror snapshot is expired", async () => {
    const writes: string[] = [];
    const session = { query: vi.fn(async (text: string) => { writes.push(text); return { rows: [] }; }), release: vi.fn() };
    const store = new PostgresVerifiedArtifactStore(
      { connect: vi.fn(async () => session) } as any,
      { verifyCurrentSnapshot: vi.fn(async () => { throw new Error("Official catalog is expired."); }) } as any,
      securityMirror() as any,
      authority
    );

    await expect(store.stage({
      owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId, generationId: authority.generationId },
      verification: { catalog, artifact: Buffer.from("bundle"), provenance: Buffer.from("provenance"), deliveryClass: authority.deliveryClass, id: authority.extensionId, version: "1.0.0", runtimeAbi: "1.0.0" },
      authority, activation: { compatibility: { mode: "compatible" }, metadata: {}, settings: {}, storageSchemaVersions: {} } as any
    })).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
    expect(writes).toEqual([]);
  });

  it("blocks activation when the staged policy is compromised", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("from runtime_extension_artifact_bindings")) return { rows: [binding()] };
      if (text.includes("from runtime_extension_artifacts")) return { rows: [{ artifact_digest: artifactDigest, artifact_bytes: Buffer.from("bundle") }] };
      if (text.includes("from runtime_extension_artifact_acceptances")) return { rows: [{ artifact_digest: artifactDigest, catalog_digest: authority.catalogDigest, catalog_json: catalog, provenance_bytes: Buffer.from("provenance"), delivery_class: authority.deliveryClass, extension_id: authority.extensionId, version: "1.0.0", runtime_abi: "1.0.0" }] };
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const mirror = securityMirror();
    const store = new PostgresVerifiedArtifactStore(
      { query } as any,
      { verifyAccepted: vi.fn(async () => verified), currentSecurityDecisionFromCurrentSnapshot: currentSecurityDecision("security-compromised") } as any,
      mirror as any,
      authority
    );

    await expect(store.resolve({ owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId }, generationId: authority.generationId, artifactDigest })).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(mirror.readSecuritySnapshot).toHaveBeenCalledTimes(2);
  });

  it.each(["release-missing", "security-compromised"] as const)("does not serve a staged %s release", async (disposition) => {
    const value = settingsReaderHarness();
    value.verifier.currentSecurityDecisionFromCurrentSnapshot.mockImplementation(currentSecurityDecision(disposition));

    await expect(value.store.readSettingsDescriptors(settingsIdentity)).resolves.toBeUndefined();
    expect(value.mirror.readSecuritySnapshot).toHaveBeenCalledTimes(2);
  });

  it("does not serve artifacts under an expired accepted or staged mirror", async () => {
    const value = settingsReaderHarness();
    value.verifier.currentSecurityDecisionFromCurrentSnapshot.mockRejectedValue(new Error("Official catalog is expired."));

    await expect(value.store.readSettingsDescriptors(settingsIdentity)).resolves.toBeUndefined();
    expect(value.mirror.readSecuritySnapshot).toHaveBeenCalledOnce();
  });

  it("rejects poisoned accepted evidence before creating a binding", async () => {
    const writes: string[] = [];
    const activation = { compatibility: { mode: "compatible" }, metadata: {}, settings: {}, storageSchemaVersions: {} } as any;
    const session = {
      query: vi.fn(async (text: string) => {
        writes.push(text);
        if (text.includes("from runtime_extension_artifacts")) return { rows: [{ artifact_digest: artifactDigest, artifact_bytes: Buffer.from("bundle") }] };
        if (text.includes("from runtime_extension_artifact_acceptances")) {
          return { rows: [{ artifact_digest: artifactDigest, catalog_digest: authority.catalogDigest, catalog_json: { payload: { sequence: 2 } }, provenance_bytes: Buffer.from("provenance"), delivery_class: authority.deliveryClass, extension_id: authority.extensionId, version: "1.0.0", runtime_abi: "1.0.0" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    const pool = {
      connect: async () => session,
      query: vi.fn(async () => { throw new Error("stage must validate through its transaction session"); })
    };
    const store = new PostgresVerifiedArtifactStore(pool as any, {
      verifyCurrentSnapshot: stagedVerification(), currentSecurityDecisionFromSnapshot: vi.fn(() => ({ disposition: "clear" }))
    } as any, securityMirror() as any, authority);

    await expect(store.stage({
      owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId, generationId: authority.generationId },
      verification: { catalog, artifact: Buffer.from("bundle"), provenance: Buffer.from("provenance"), deliveryClass: authority.deliveryClass, id: authority.extensionId, version: "1.0.0", runtimeAbi: "1.0.0" },
      authority, activation
    })).rejects.toMatchObject({ code: "ARTIFACT_CONFLICT" });
    expect(writes.find((query) => query.includes("insert into runtime_extension_artifacts"))).toContain("(artifact_digest, artifact_bytes)");
    expect(writes.find((query) => query.includes("insert into runtime_extension_artifact_acceptances"))).toContain("(artifact_digest, catalog_digest");
    expect(writes.some((query) => query.includes("insert into runtime_extension_artifact_bindings"))).toBe(false);
    expect(writes.filter((query) => query.includes("insert into runtime_extension_artifact")).every((query) => !query.includes("do update"))).toBe(true);
  });

  it("reads remote UI through its max-1 transaction session without deadlocking", async () => {
    let releaseLock: (() => void) | undefined;
    const lock = new Promise<void>((resolve) => { releaseLock = resolve; });
    const queries: string[] = [];
    const row = {
      application_id: authority.applicationId, environment: authority.environment, delivery_class: authority.deliveryClass,
      extension_id: authority.extensionId, generation_id: authority.generationId, artifact_digest: artifactDigest, catalog_digest: authority.catalogDigest,
      authority_json: authority, activation_json: { metadata: {}, settings: {}, storageSchemaVersions: {} }, version: "1.0.0"
    };
    const session = {
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        queries.push(text);
        if (text.startsWith("select pg_advisory_xact_lock")) await lock;
        if (text.includes("from runtime_extension_artifact_bindings")) {
          expect(values).toEqual([authority.applicationId, authority.environment, authority.extensionId, authority.generationId, artifactDigest]);
          return { rows: [row] };
        }
        if (text.includes("from runtime_extension_artifacts")) {
          expect(values).toEqual([artifactDigest]);
          return { rows: [{ artifact_digest: artifactDigest, artifact_bytes: Buffer.from("bundle") }] };
        }
        if (text.includes("from runtime_extension_artifact_acceptances")) {
          expect(values).toEqual([artifactDigest, authority.catalogDigest]);
          return { rows: [{ artifact_digest: artifactDigest, catalog_digest: authority.catalogDigest, catalog_json: catalog, provenance_bytes: Buffer.from("provenance"), delivery_class: authority.deliveryClass, extension_id: authority.extensionId, version: "1.0.0", runtime_abi: "1.0.0" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    const pool = {
      max: 1,
      connect: async () => session,
      query: vi.fn(async () => { throw new Error("readRemoteUi must not request a second pool session"); })
    };
    const store = new PostgresVerifiedArtifactStore(
      pool as any,
      { verifyAccepted: vi.fn(async () => verified), currentSecurityDecisionFromCurrentSnapshot: currentSecurityDecision() } as any,
      securityMirror() as any,
      authority
    );

    const reading = store.readRemoteUi({
      applicationId: authority.applicationId, environment: authority.environment, extensionId: authority.extensionId,
      generationId: authority.generationId, artifactDigest
    });
    await Promise.resolve();
    expect(queries.some((query) => query.includes("from runtime_extension_artifact_bindings"))).toBe(false);

    releaseLock?.();
    await expect(reading).resolves.toMatchObject({ artifactDigest, catalogDigest: authority.catalogDigest });
    const activeBindingQuery = queries.find((query) => query.includes("from runtime_extension_artifact_bindings"));
    expect(activeBindingQuery).toContain("e.active_generation=jsonb_build_object(");
    expect(activeBindingQuery).toContain("'receiptId', r.receipt_id");
    expect(activeBindingQuery).toContain("g.authority_json=b.authority_json");
    expect(activeBindingQuery).toContain("and g.receipt_id=r.receipt_id");
    expect(activeBindingQuery).toContain("join runtime_extension_artifact_acceptances c on c.artifact_digest=b.artifact_digest and c.catalog_digest=b.catalog_digest");
    expect(activeBindingQuery).toContain("join lateral (");
    expect(activeBindingQuery).toContain("order by r.revision desc");
    expect(activeBindingQuery).toContain("o.operation_kind in ('install','update','rollback')");
    expect(activeBindingQuery).toContain("r.event_json->>'receiptId'=r.receipt_id");
    expect(activeBindingQuery).toContain("r.event_json->'evidence'->>'catalogDigest'=b.authority_json->>'catalogDigest'");
    expect(queries.findIndex((query) => query.startsWith("select pg_advisory_xact_lock"))).toBeLessThan(
      queries.findIndex((query) => query.includes("from runtime_extension_artifact_bindings"))
    );
    expect(queries.some((query) => query.includes("runtime_extension_artifacts where artifact_digest=$1"))).toBe(true);
    expect(queries.some((query) => query.includes("runtime_extension_artifact_acceptances where artifact_digest=$1 and catalog_digest=$2"))).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
    expect(session.release).toHaveBeenCalledOnce();
  });
});

describe("PostgresVerifiedArtifactStore settings descriptor reader", () => {
  it("returns only the exact active reverified Hot Application generation through the lifecycle lock", async () => {
    const value = settingsReaderHarness();

    await expect(value.store.readSettingsDescriptors(settingsIdentity)).resolves.toMatchObject({
      artifactDigest,
      catalogDigest: authority.catalogDigest
    });

    const activeBindingQuery = value.queries.find((query) => query.includes("from runtime_extension_artifact_bindings"));
    expect(value.session.query.mock.calls.find(([text]) => String(text).includes("from runtime_extension_artifact_bindings"))?.[1]).toEqual([
      authority.applicationId, authority.environment, authority.extensionId, authority.generationId, artifactDigest
    ]);
    expect(activeBindingQuery).toContain("e.disposition='active'");
    expect(activeBindingQuery).toContain("e.active_generation_id=b.generation_id");
    expect(activeBindingQuery).toContain("g.state='active'");
    expect(activeBindingQuery).toContain("g.authority_json=b.authority_json");
    expect(activeBindingQuery).toContain("g.server_generation_id=b.generation_id");
    expect(value.queries.findIndex((query) => query.startsWith("select pg_advisory_xact_lock"))).toBeLessThan(
      value.queries.findIndex((query) => query.includes("from runtime_extension_artifact_bindings"))
    );
    expect(value.verifier.verifyAccepted).toHaveBeenCalledOnce();
  });

  it("fails closed for an application, environment, app, generation, or artifact digest mismatch", async () => {
    for (const identity of [
      { ...settingsIdentity, applicationId: "customer-beta" },
      { ...settingsIdentity, environment: "staging" },
      { ...settingsIdentity, appId: "app.other" },
      { ...settingsIdentity, generationId: "sales-generation-2" },
      { ...settingsIdentity, artifactDigest: `sha256:${"e".repeat(64)}` as const }
    ]) {
      const value = settingsReaderHarness();
      await expect(value.store.readSettingsDescriptors(identity)).resolves.toBeUndefined();
      expect(value.verifier.verifyAccepted).not.toHaveBeenCalled();
    }
  });

  it.each(["disabled", "quarantined", "retired", "stale"] as const)("fails closed for a %s lifecycle generation", async (lifecycle) => {
    const value = settingsReaderHarness({ lifecycle });

    await expect(value.store.readSettingsDescriptors(settingsIdentity)).resolves.toBeUndefined();
    expect(value.verifier.verifyAccepted).not.toHaveBeenCalled();
  });

  it("fails closed for missing, corrupt, or unverified durable artifact evidence", async () => {
    const invalidBinding = binding();
    invalidBinding.authority_json = { ...authority, generationId: "sales-generation-2" } as any;
    for (const options of [
      { bindingRow: null },
      { artifact: false },
      { acceptance: false },
      { corrupt: true },
      { bindingRow: invalidBinding }
    ]) {
      const value = settingsReaderHarness(options);
      await expect(value.store.readSettingsDescriptors(settingsIdentity)).resolves.toBeUndefined();
    }
  });

  it("reverifies an exact immutable generation for lifecycle-bound diagnostic discovery", async () => {
    const value = settingsReaderHarness({ lifecycle: "disabled" });

    await expect(value.store.readSettingsDescriptorGeneration({
      applicationId: authority.applicationId,
      environment: authority.environment,
      extensionId: authority.extensionId,
      generationId: authority.generationId
    })).resolves.toMatchObject({ artifactDigest, catalogDigest: authority.catalogDigest });
    expect(value.pool.query).toHaveBeenCalledWith(expect.stringContaining("delivery_class='hot-application'"), [
      authority.applicationId, authority.environment, authority.extensionId, authority.generationId
    ]);
    expect(value.verifier.verifyAccepted).toHaveBeenCalledOnce();
  });
});

describe("PostgresVerifiedArtifactStore authorization lifecycle resolver", () => {
  it("resolves detached, sorted permissions from the exact transition binding in the supplied session", async () => {
    const value = resolverHarness();

    const descriptors = await value.store.resolveAuthorizationLifecycleDescriptors(value.session as any, lifecycleTransition());

    expect(descriptors.map((descriptor: any) => descriptor.id)).toEqual(["sales.orders.read", "sales.orders.write"]);
    expect(descriptors[0]).not.toBe(permissions[1]);
    expect(value.query.mock.calls.find(([text]) => String(text).includes("from runtime_extension_artifact_bindings"))?.[1]).toEqual([
      authority.applicationId, authority.environment, "hot-application", authority.extensionId, authority.generationId, artifactDigest, authority.catalogDigest
    ]);
    expect(value.verifier.verifyAccepted).toHaveBeenCalledOnce();
    expect(value.pool.connect).not.toHaveBeenCalled();
    expect(value.pool.query).not.toHaveBeenCalled();
    expect(value.query.mock.calls.some(([text]) => String(text).includes("from runtime_extensions"))).toBe(false);
  });

  it("rejects a binding from another generation even if a query adapter returns it", async () => {
    const value = resolverHarness();

    await expect(value.store.resolveAuthorizationLifecycleDescriptors(value.session as any, lifecycleTransition({ evidence: {
      ...lifecycleTransition().evidence, generationId: "sales-generation-2"
    } }))).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
    expect(value.query.mock.calls.find(([text]) => String(text).includes("from runtime_extension_artifact_bindings"))?.[1]?.[4]).toBe("sales-generation-2");
  });

  it("rejects a binding whose authority catalog digest differs from transition evidence", async () => {
    const value = resolverHarness();
    const catalogDigest = `sha256:${"e".repeat(64)}`;

    await expect(value.store.resolveAuthorizationLifecycleDescriptors(value.session as any, lifecycleTransition({ evidence: {
      ...lifecycleTransition().evidence, catalogDigest
    } }))).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
    expect(value.query.mock.calls.find(([text]) => String(text).includes("from runtime_extension_artifact_bindings"))?.[1]?.[6]).toBe(catalogDigest);
  });

  it("rejects non-Hot-Application transitions before querying", async () => {
    const value = resolverHarness();

    await expect(value.store.resolveAuthorizationLifecycleDescriptors(value.session as any, { deliveryClass: "theme-skin" } as any)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(value.query).not.toHaveBeenCalled();
  });

  it("retains the signed descriptors needed to project a revoked security transition", async () => {
    const value = resolverHarness();

    await expect(value.store.resolveAuthorizationLifecycleDescriptors(value.session as any, securityTransition())).resolves.toHaveLength(2);
    expect(value.query.mock.calls.find(([text]) => String(text).includes("from runtime_extension_artifact_bindings"))?.[1]).toEqual([
      authority.applicationId, authority.environment, "hot-application", authority.extensionId, authority.generationId, artifactDigest
    ]);
    expect(value.query.mock.calls.find(([text]) => String(text).includes("from runtime_extension_artifact_acceptances"))?.[1]).toEqual([
      artifactDigest, authority.catalogDigest
    ]);
    expect(value.query.mock.calls.some(([text]) => String(text).includes("from runtime_extensions"))).toBe(false);
  });

  it("rejects security evidence that mismatches the immutable release", async () => {
    const value = resolverHarness();

    await expect(value.store.resolveAuthorizationLifecycleDescriptors(value.session as any, securityTransition({ evidence: {
      ...securityTransition().evidence,
      sourceCommit: "f".repeat(40)
    } }))).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
  });

  it("fails closed when the transition generation has no immutable binding", async () => {
    const value = resolverHarness(null);

    await expect(value.store.resolveAuthorizationLifecycleDescriptors(value.session as any, lifecycleTransition())).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(value.verifier.verifyAccepted).not.toHaveBeenCalled();
  });
});
