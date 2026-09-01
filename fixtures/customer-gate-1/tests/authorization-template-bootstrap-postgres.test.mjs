import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import salesManifest from "@k-nex/module-sales/manifest" with { type: "json" };
import { salesPermissionDescriptors, salesRegistration } from "@k-nex/module-sales/server";
import {
  bootstrapFirstOwner,
  compareInstantiatedRoleTemplate,
  copyTemplatePermissionsToRole,
  createAuthorizationCatalogProvider,
  createEffectiveAuthorizationCatalog,
  createEffectiveAuthorizationRequest,
  createPlatformPluginLifecycleState,
  createPlatformPluginRegistrationAuthorizationContribution,
  createPlatformPluginPolicyExecutable,
  createTrustedAuthorizationSession,
  definePluginRegistration,
  digestTemplateBaseline,
  EffectiveAuthorityResolver,
  executeRegistration,
  instantiateRoleTemplate,
  protectedPlatformRoleBaselines,
  reconcileAutomaticRoleTemplates,
  reconcilePlatformPluginAvailability,
  scopePlatformPluginRegistration,
  tombstoneAutomaticRoleTemplate
} from "@k-nex/runtime";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-template-bootstrap";
const environment = "production";
const owner = Object.freeze({ kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 });
const platform = Object.freeze({ kind: "platform", namespace: "system" });
const expected = (state) => ({ applicationId, environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision });
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const canonical = (permissionIds) => [...new Set(permissionIds)].sort(compare);

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        NODE_ENV: "production",
        PAYLOAD_SECRET: "p10-6-template-bootstrap",
        BOOT_KEY: "p10-6-template-bootstrap"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function graph(manifest) {
  return {
    resolverVersion: "1.0.0",
    plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=", required: [], optional: [] }],
    capabilityProviders: [],
    registrationOrder: [manifest.id]
  };
}

function salesCatalog() {
  const registration = executeRegistration({
    graph: graph(salesManifest),
    installed: [{ package: { name: salesManifest.package, version: salesManifest.version, integrity: "sha512-c2FsZXM=" }, manifest: salesManifest }],
    registrations: [salesRegistration]
  });
  const lifecycle = reconcilePlatformPluginAvailability(registration, createPlatformPluginLifecycleState({
    pluginId: "module.sales", catalogStatus: "supported",
    package: { status: "installed", name: salesManifest.package, version: salesManifest.version, integrity: "sha512-c2FsZXM=" },
    enabled: true, configuration: { revision: 1, ready: true }, migration: { current: 1, required: 1, ready: true }, dataState: "active", releaseStatus: "supported"
  }));
  const scoped = scopePlatformPluginRegistration(registration, [lifecycle]);
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({
    registration: scoped,
    generation: { schemaVersion: 1, applicationId, owner, runtimeGenerationIds: ["sales-template-generation"], state: "current", authorizationRevision: 1, lifecycleRevision: 1 }
  });
  const executables = scoped.contributions.policyBindings.filter(({ pluginId }) => pluginId === "module.sales").map(({ value }) =>
    createPlatformPluginPolicyExecutable({ kind: "platform-plugin", publisher: value.publisher, bindingId: value.id, policyReference: value.policyReference, executor: { evaluate: () => ({ schemaVersion: 1, outcome: "allow" }) } })
  );
  return createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision: 1, extensions: [contribution], executables });
}

function testSalesTemplate(template, descriptorIds, templateOwner = owner) {
  const descriptors = salesPermissionDescriptors.filter(({ id }) => descriptorIds.includes(id));
  const manifest = {
    apiVersion: 1, id: "module.sales", kind: "module", displayName: "Sales test template", version: "1.0.0", package: "@k-nex/module-sales",
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "supported" },
    contributions: { permissions: Object.fromEntries(descriptors.map(({ id }) => [id, "required"])), policyBindings: {}, roleTemplates: { [template.id]: "required" } }
  };
  const registration = definePluginRegistration({ pluginId: "module.sales", contracts(context) {
    for (const descriptor of descriptors) context.register("permissions", descriptor.id, descriptor);
    context.register("roleTemplates", template.id, template);
  } });
  const scoped = scopePlatformPluginRegistration(executeRegistration({
    graph: graph(manifest),
    installed: [{ package: { name: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=" }, manifest }],
    registrations: [registration]
  }), []);
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({
    registration: scoped,
    generation: { schemaVersion: 1, applicationId, owner: templateOwner, runtimeGenerationIds: ["sales-template-generation"], state: "current", authorizationRevision: 1, lifecycleRevision: 1 }
  });
  return createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision: 1, extensions: [contribution], executables: [] }).roleTemplates[0];
}

function ownerAuthority(store, principalId) {
  const catalog = createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision: 0, extensions: [], executables: [] });
  const resolver = new EffectiveAuthorityResolver({
    store,
    catalogProvider: createAuthorizationCatalogProvider(({ applicationId: requested, lifecycleRevision }) =>
      requested === applicationId && lifecycleRevision === 0 ? Object.freeze({ applicationId, lifecycleRevision, catalog }) : undefined)
  });
  const session = createTrustedAuthorizationSession({
    schemaVersion: 1, applicationId, environment, correlationId: "p10-6-protected-role-immutability",
    principal: { kind: "user", id: principalId }, effectiveActor: { kind: "user", id: principalId }
  });
  const request = createEffectiveAuthorizationRequest({
    schemaVersion: 1, decisionId: "p10-6-owner-system-roles-manage", permissionId: "system.roles.manage",
    scope: { kind: "application", resource: "system.roles" }, facts: {}
  });
  return Object.freeze({ resolver, request, session });
}

test("P10.6 persists protected roles and Sales template bootstrap through PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("authorization_template_bootstrap").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await boot(container.getConnectionUri());
    const store = new PostgresAuthorizationStore(pool, { validate: (currentApplicationId, subject) =>
      currentApplicationId === applicationId && subject.kind === "user" && ["user:owner", "user:contender"].includes(subject.id) ? "accepted" : "rejected"
    });

    const bootstrap = await Promise.allSettled([
      bootstrapFirstOwner({ store, expected: { applicationId, environment, authorizationRevision: 0, lifecycleRevision: 0 }, firstOwner: { kind: "user", id: "user:owner" } }),
      bootstrapFirstOwner({ store, expected: { applicationId, environment, authorizationRevision: 0, lifecycleRevision: 0 }, firstOwner: { kind: "user", id: "user:contender" } })
    ]);
    assert.equal(bootstrap.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(bootstrap.find(({ status }) => status === "rejected")?.reason?.code, "REVISION_CONFLICT");
    const bootstrapped = await store.readState(applicationId, environment);
    assert.deepEqual(bootstrapped && [bootstrapped.authorizationRevision, bootstrapped.lifecycleRevision], [1, 0]);
    assert.deepEqual((await pool.query("select role_id, protected_role_id from k_nex_roles where application_id=$1 order by role_id", [applicationId])).rows,
      protectedPlatformRoleBaselines.map(({ id }) => ({ role_id: id, protected_role_id: id })).sort((left, right) => compare(left.role_id, right.role_id)));
    const grants = await pool.query("select role_id, array_agg(permission_id order by permission_id) as permission_ids from k_nex_role_permission_grants where application_id=$1 group by role_id order by role_id", [applicationId]);
    assert.deepEqual(grants.rows, protectedPlatformRoleBaselines.map(({ id, permissionIds }) => ({ role_id: id, permission_ids: canonical(permissionIds) })).sort((left, right) => compare(left.role_id, right.role_id)));
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_assignments where application_id=$1 and role_id='system.role.owner' and state='active'", [applicationId])).rows[0].count, 1);
    assert.deepEqual((await pool.query("select owner_role_id, authorization_revision, state from k_nex_authorization_bootstrap_receipts where application_id=$1", [applicationId])).rows, [{ owner_role_id: "system.role.owner", authorization_revision: 1, state: "committed" }]);

    await assert.rejects(bootstrapFirstOwner({ store, expected: expected(bootstrapped), firstOwner: { kind: "user", id: "user:owner" } }), { code: "REVISION_CONFLICT" });
    assert.equal((await pool.query("select count(*)::int as count from k_nex_roles where application_id=$1", [applicationId])).rows[0].count, 5);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_assignments where application_id=$1 and role_id='system.role.owner' and state='active'", [applicationId])).rows[0].count, 1);

    const protectedOwner = (await pool.query("select assignment_id, subject_id from k_nex_role_assignments where application_id=$1 and role_id='system.role.owner' and state='active'", [applicationId])).rows[0];
    const editable = await store.transaction(expected(bootstrapped), async (transaction) => {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.immutability-probe", applicationId, label: "Immutability probe", revision: bootstrapped.authorizationRevision + 1 } });
    });
    const protectedGrant = (await pool.query("select grant_id, permission_id from k_nex_role_permission_grants where application_id=$1 and role_id='system.role.owner' order by grant_id limit 1", [applicationId])).rows[0];
    const protectedBefore = await Promise.all([
      pool.query("select role_id, label, description, protected_role_id, revision from k_nex_roles where application_id=$1 and protected_role_id is not null order by role_id", [applicationId]),
      pool.query("select grant_id, role_id, permission_id, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, revision from k_nex_role_permission_grants where application_id=$1 and role_id like 'system.role.%' order by grant_id", [applicationId]),
      pool.query("select receipt_id, owner_role_id, owner_assignment_id, owner_principal_kind, owner_principal_id, authorization_revision, state from k_nex_authorization_bootstrap_receipts where application_id=$1", [applicationId])
    ]);
    const authority = ownerAuthority(store, protectedOwner.subject_id);
    const authorityBefore = await authority.resolver.authorize(authority.session, authority.request);
    assert.deepEqual([authorityBefore.outcome, authorityBefore.reason], ["allow", "granted"]);
    const protectedState = await store.readState(applicationId, environment);
    await assert.rejects(store.transaction(expected(protectedState), async (transaction) => {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "system.role.owner", applicationId, label: "Compromised owner", protectedRoleId: "system.role.owner", revision: protectedState.authorizationRevision + 1 } });
    }), { code: "MUTATION_INVALID" }, "Regular transactions cannot upsert protected role metadata.");
    await assert.rejects(store.transaction(expected(protectedState), async (transaction) => {
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "protected-added-grant", applicationId, roleId: "system.role.owner", permissionId: "system.roles.read", owner: platform, revision: protectedState.authorizationRevision + 1 } });
    }), { code: "MUTATION_INVALID" }, "Regular transactions cannot add protected role grants.");
    await assert.rejects(store.transaction(expected(protectedState), async (transaction) => {
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: protectedGrant.grant_id, applicationId, roleId: "system.role.owner", permissionId: protectedGrant.permission_id, owner: platform, revision: protectedState.authorizationRevision + 1 } });
    }), { code: "MUTATION_INVALID" }, "Regular transactions cannot update protected role grants.");
    await assert.rejects(store.transaction(expected(protectedState), async (transaction) => {
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: protectedGrant.grant_id, applicationId, roleId: "customer.immutability-probe", permissionId: protectedGrant.permission_id, owner: platform, revision: protectedState.authorizationRevision + 1 } });
    }), { code: "MUTATION_INVALID" }, "A protected grant ID cannot be moved to an editable role.");
    await assert.rejects(store.transaction(expected(protectedState), async (transaction) => {
      await transaction.write({ kind: "bootstrap-receipt", receipt: { schemaVersion: 1, id: "regular-bootstrap-receipt", applicationId, ownerRoleId: "system.role.owner", ownerAssignmentId: protectedOwner.assignment_id, ownerPrincipal: { kind: "user", id: protectedOwner.subject_id }, authorizationRevision: protectedState.authorizationRevision, state: "committed" } });
    }), { code: "MUTATION_INVALID" }, "Regular transactions cannot write bootstrap receipts.");
    const protectedAfter = await Promise.all([
      pool.query("select role_id, label, description, protected_role_id, revision from k_nex_roles where application_id=$1 and protected_role_id is not null order by role_id", [applicationId]),
      pool.query("select grant_id, role_id, permission_id, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, revision from k_nex_role_permission_grants where application_id=$1 and role_id like 'system.role.%' order by grant_id", [applicationId]),
      pool.query("select receipt_id, owner_role_id, owner_assignment_id, owner_principal_kind, owner_principal_id, authorization_revision, state from k_nex_authorization_bootstrap_receipts where application_id=$1", [applicationId])
    ]);
    assert.deepEqual(protectedAfter.map(({ rows }) => rows), protectedBefore.map(({ rows }) => rows), "Rejected regular writes leave protected records and receipt unchanged.");
    const protectedAfterState = await store.readState(applicationId, environment);
    assert.deepEqual(protectedAfterState, protectedState, "Rejected protected mutations must not advance authorization state.");
    const authorityAfter = await authority.resolver.authorize(authority.session, authority.request);
    assert.deepEqual([authorityAfter.outcome, authorityAfter.reason, authorityAfter.authorizationRevision], ["allow", "granted", authorityBefore.authorizationRevision]);

    const seeded = await store.transaction(expected(protectedAfterState), async (transaction) => {
      await transaction.write({ kind: "extension-generation", generation: {
        schemaVersion: 1, applicationId, owner, runtimeGenerationIds: ["sales-template-generation"], state: "current", authorizationRevision: protectedAfterState.authorizationRevision, lifecycleRevision: protectedAfterState.lifecycleRevision
      } });
    });
    const manual = salesCatalog().roleTemplates.find(({ template }) => template.id === "sales.template.viewer");
    assert.ok(manual, "The actual Sales registration must publish its Viewer template.");
    const automatic = testSalesTemplate({
      schemaVersion: 1, id: "sales.template.postgres-auto", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
      version: 1, instantiation: "automatic", title: "Sales PostgreSQL automatic", permissionIds: ["sales.tasks.read"]
    }, ["sales.tasks.read"]);
    const automaticV2 = testSalesTemplate({
      schemaVersion: 1, id: "sales.template.postgres-auto", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
      version: 2, instantiation: "automatic", title: "Sales PostgreSQL automatic v2", permissionIds: ["sales.tasks.read", "sales.tasks.status.read"]
    }, ["sales.tasks.read", "sales.tasks.status.read"]);
    const automaticNewGeneration = testSalesTemplate({
      schemaVersion: 1, id: "sales.template.postgres-auto", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
      version: 3, instantiation: "automatic", title: "Sales PostgreSQL automatic generation two", permissionIds: ["sales.tasks.read", "sales.tasks.status.read"]
    }, ["sales.tasks.read", "sales.tasks.status.read"], { ...owner, generation: 2 });
    const copyBeforeReconcile = testSalesTemplate({
      schemaVersion: 1, id: "sales.template.postgres-copy-auto", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
      version: 1, instantiation: "automatic", title: "Sales PostgreSQL copy automatic", permissionIds: ["sales.tasks.read"]
    }, ["sales.tasks.read"]);
    const copyBeforeReconcileV2 = testSalesTemplate({
      schemaVersion: 1, id: "sales.template.postgres-copy-auto", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
      version: 2, instantiation: "automatic", title: "Sales PostgreSQL copy automatic v2", permissionIds: ["sales.tasks.read", "sales.tasks.revenue.read"]
    }, ["sales.tasks.read", "sales.tasks.revenue.read"]);
    const viewerV2 = testSalesTemplate({
      schemaVersion: 1, id: "sales.template.viewer", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
      version: 2, instantiation: "manual", title: "Sales Viewer v2", permissionIds: ["sales.opportunities.name.read", "sales.opportunities.read", "sales.opportunities.stage.read", "sales.tasks.read", "sales.tasks.revenue.read", "sales.tasks.status.read", "sales.tasks.title.read"]
    }, ["sales.opportunities.name.read", "sales.opportunities.read", "sales.opportunities.stage.read", "sales.tasks.read", "sales.tasks.revenue.read", "sales.tasks.status.read", "sales.tasks.title.read"]);
    assert.ok(automatic && automaticV2 && automaticNewGeneration && copyBeforeReconcile && copyBeforeReconcileV2 && viewerV2);

    const manualResult = await instantiateRoleTemplate({ store, expected: expected(seeded.state), effectiveTemplate: manual, role: { id: "sales.customer-viewer", label: "Customer Sales Viewer" } });
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_assignments where application_id=$1", [applicationId])).rows[0].count, 1, "Template instantiation never assigns users.");
    const edited = await store.transaction(expected(manualResult.state), async (transaction) => {
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "sales.customer-viewer.write", applicationId, roleId: "sales.customer-viewer", permissionId: "sales.tasks.write", owner, revision: manualResult.state.authorizationRevision + 1 } });
    });
    const comparisonState = await store.readState(applicationId, environment);
    const comparison = await compareInstantiatedRoleTemplate({ store, expected: expected(comparisonState), effectiveTemplate: viewerV2, roleId: "sales.customer-viewer" });
    assert.deepEqual(comparison.value.customerAddedPermissionIds, ["sales.tasks.write"]);
    assert.deepEqual(comparison.value.templateAddedPermissionIds, ["sales.tasks.revenue.read"]);
    assert.deepEqual(comparison.state, comparisonState, "Comparison is read-only.");

    const automaticBeforeTombstone = await Promise.all([
      pool.query("select role_id from k_nex_roles where application_id=$1 order by role_id", [applicationId]),
      pool.query("select grant_id from k_nex_role_permission_grants where application_id=$1 order by grant_id", [applicationId]),
      pool.query("select assignment_id from k_nex_role_assignments where application_id=$1 order by assignment_id", [applicationId])
    ]);
    await assert.rejects(tombstoneAutomaticRoleTemplate({ store, expected: expected(edited.state), effectiveTemplate: { template: { ...automatic.template }, owner: { ...automatic.owner } } }), { code: "MUTATION_INVALID" }, "A copied template shape is not an authentic catalog entry.");
    const tombstoned = await tombstoneAutomaticRoleTemplate({ store, expected: expected(edited.state), effectiveTemplate: automatic });
    assert.deepEqual([tombstoned.value.kind, tombstoned.value.state, tombstoned.value.roleId], ["instantiated-role", "tombstoned", undefined]);
    const automaticAfterTombstone = await Promise.all([
      pool.query("select role_id from k_nex_roles where application_id=$1 order by role_id", [applicationId]),
      pool.query("select grant_id from k_nex_role_permission_grants where application_id=$1 order by grant_id", [applicationId]),
      pool.query("select assignment_id from k_nex_role_assignments where application_id=$1 order by assignment_id", [applicationId])
    ]);
    assert.deepEqual(automaticAfterTombstone.map(({ rows }) => rows), automaticBeforeTombstone.map(({ rows }) => rows), "An independent tombstone creates no role, grants, or assignments.");
    const tombstoneReplay = await tombstoneAutomaticRoleTemplate({ store, expected: expected(tombstoned.state), effectiveTemplate: automatic });
    assert.deepEqual(tombstoneReplay.value, tombstoned.value);
    assert.deepEqual(tombstoneReplay.state, tombstoned.state, "Tombstone replay is idempotent.");
    for (const effectiveTemplate of [automatic, automaticV2, automaticNewGeneration]) {
      const reconciliation = await reconcileAutomaticRoleTemplates({ store, expected: expected(tombstoned.state), effectiveTemplates: [effectiveTemplate] });
      assert.deepEqual(reconciliation.value, []);
      assert.deepEqual(reconciliation.state, tombstoned.state, "The same automatic publisher/template identity stays suppressed across versions and generations.");
    }

    let state = await store.readState(applicationId, environment);
    state = (await store.transaction(expected(state), async (transaction) => {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.mixed", applicationId, label: "Mixed", revision: state.authorizationRevision + 1 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "customer.mixed.platform", applicationId, roleId: "customer.mixed", permissionId: "system.roles.read", owner: platform, revision: state.authorizationRevision + 1 } });
    })).state;
    const copied = await copyTemplatePermissionsToRole({ store, expected: expected(state), effectiveTemplate: copyBeforeReconcile, roleId: "customer.mixed", permissionIds: ["sales.tasks.read"] });
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_permission_grants where application_id=$1 and role_id='customer.mixed' and permission_id='system.roles.read'", [applicationId])).rows[0].count, 1, "One-time copy preserves an unrelated platform grant.");
    const copyReconciliation = await reconcileAutomaticRoleTemplates({ store, expected: expected(copied.state), effectiveTemplates: [copyBeforeReconcile] });
    assert.deepEqual(copyReconciliation.value, [], "Copying an automatic template suppresses its default role before reconciliation.");
    assert.deepEqual(copyReconciliation.state, copied.state);
    const beforeV2Copy = await pool.query("select permission_id from k_nex_role_permission_grants where application_id=$1 and role_id='customer.mixed' order by permission_id", [applicationId]);
    await assert.rejects(copyTemplatePermissionsToRole({ store, expected: expected(copied.state), effectiveTemplate: copyBeforeReconcileV2, roleId: "customer.mixed", permissionIds: ["sales.tasks.revenue.read"] }), { code: "REVISION_CONFLICT" });
    assert.deepEqual((await pool.query("select permission_id from k_nex_role_permission_grants where application_id=$1 and role_id='customer.mixed' order by permission_id", [applicationId])).rows, beforeV2Copy.rows);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_permission_grants where application_id=$1 and role_id='customer.mixed' and permission_id='sales.tasks.revenue.read'", [applicationId])).rows[0].count, 0, "Copied roles do not subscribe to later template versions.");
    const copyV2Reconciliation = await reconcileAutomaticRoleTemplates({ store, expected: expected(copied.state), effectiveTemplates: [copyBeforeReconcileV2] });
    assert.deepEqual(copyV2Reconciliation.value, [], "A future copied automatic template version creates no default role.");

    const persisted = await pool.query("select role_id, old_baseline_permission_ids, digest_algorithm, old_baseline_digest, kind, state from k_nex_role_template_adoptions where application_id=$1 order by role_id, kind", [applicationId]);
    for (const row of persisted.rows) {
      assert.deepEqual(row.old_baseline_permission_ids, canonical(row.old_baseline_permission_ids));
      assert.equal(row.digest_algorithm, "sha256-canonical-json-v1");
      assert.equal(row.old_baseline_digest, digestTemplateBaseline(row.old_baseline_permission_ids));
    }
    await pool.query("update k_nex_role_template_adoptions set old_baseline_digest=$2 where application_id=$1 and role_id='sales.customer-viewer'", [applicationId, `sha256:${"0".repeat(64)}`]);
    const beforeBadDigestCompare = await pool.query("select role_id, permission_id from k_nex_role_permission_grants where application_id=$1 and role_id='sales.customer-viewer' order by permission_id", [applicationId]);
    await assert.rejects(compareInstantiatedRoleTemplate({ store, expected: expected(await store.readState(applicationId, environment)), effectiveTemplate: viewerV2, roleId: "sales.customer-viewer" }), { code: "DIGEST_MISMATCH" });
    assert.deepEqual((await pool.query("select role_id, permission_id from k_nex_role_permission_grants where application_id=$1 and role_id='sales.customer-viewer' order by permission_id", [applicationId])).rows, beforeBadDigestCompare.rows, "Bad stored digests fail closed without changing grants.");
  } finally {
    try {
      await pool.end();
    } finally {
      await container.stop();
    }
  }
});
