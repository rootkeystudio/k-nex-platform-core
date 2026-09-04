import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const integer = (name) => {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}.`);
  return value;
};
const digest = (value) => `sha256:${createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex")}`;
const applicationPath = required("P12_OPERATOR_APPLICATION_PATH");
const packedModule = (name) => import(pathToFileURL(join(applicationPath, "node_modules", "@k-nex", name, "dist/index.js")).href);
const {
  canonicalJson
} = await packedModule("contracts");
const {
  AdministrationExtensionCommandHandler,
  AuthorizationLifecycleProjector,
  NodeHttpsAdministrationOperatorServer,
  PostgresAuthorizationStore,
  PostgresRuntimeExtensionStore,
  PostgresStaticDeploymentStore,
  SharedStaticPlatformPluginGenerationRebinder,
  createStaticPlatformPluginAuthorizationDescriptorResolver
} = await packedModule("payload-adapter");
const {
  CurrentAuthorityOperationAuthorizer,
  EffectiveAuthorityResolver,
  ExtensionOperatorApi,
  PluginManager,
  createAuthorizationCatalogProvider,
  createEffectiveAuthorizationCatalog,
  createPlatformPluginPolicyExecutable,
  createPlatformPluginRegistrationAuthorizationContribution,
  createTrustedAuthorizationSession,
  extensionInventoryState
} = await packedModule("runtime");
const applicationId = required("P12_OPERATOR_APPLICATION_ID");
const environment = required("P12_OPERATOR_ENVIRONMENT");
const expectedUriSan = required("P12_OPERATOR_CLIENT_URI_SAN");
const operatorIdentity = required("P12_OPERATOR_IDENTITY");
const sourceCommit = required("P12_OPERATOR_SOURCE_COMMIT");
const hostInventoryDigest = required("P12_OPERATOR_HOST_INVENTORY_DIGEST");
const port = integer("P12_OPERATOR_PORT");
const bodyLimit = 65_536;
const registry = await import(pathToFileURL(required("P12_OPERATOR_REGISTRY_PATH")).href);
const sales = registry.kNexSalesRegistry;
const extension = Object.freeze({ deliveryClass: "platform-plugin", id: "module.sales" });
const version = sales.staticRelease.package.version;
const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), max: 4 });
const clock = Object.freeze({ now: () => new Date() });

const authorizationStore = new PostgresAuthorizationStore(pool, {
  validate: (candidateApplicationId, subject) => candidateApplicationId === applicationId && subject.kind === "user" ? "accepted" : "rejected"
});
const currentSalesAuthority = async () => {
  const state = await authorizationStore.readState(applicationId, environment);
  if (!state) return undefined;
  const expected = { applicationId, environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
  return authorizationStore.readTransaction(expected, async (transaction) => {
    const generation = (await transaction.listExtensionGenerations(applicationId)).find((candidate) =>
      candidate.state === "current" && candidate.owner.deliveryClass === "platform-plugin" && candidate.owner.extensionId === extension.id);
    if (!generation) return undefined;
    const unavailable = (await transaction.listCatalogSnapshots(applicationId)).some((entry) =>
      entry.owner?.kind === "extension" && entry.owner.deliveryClass === "platform-plugin" && entry.owner.extensionId === extension.id &&
      entry.owner.generation === generation.owner.generation && ["inactive-extension-disabled", "inactive-extension-not-ready"].includes(entry.state));
    return Object.freeze({ state, generation, enabled: !unavailable });
  }).then(({ value }) => value);
};
const salesExecutables = sales.policyBindings.map((binding) => createPlatformPluginPolicyExecutable({
  kind: "platform-plugin",
  publisher: binding.publisher,
  bindingId: binding.id,
  policyReference: binding.policyReference,
  executor: sales.policyExecutors[binding.policyReference]
}));
const catalogProvider = createAuthorizationCatalogProvider(async ({ applicationId: candidate, lifecycleRevision }) => {
  if (candidate !== applicationId) return undefined;
  const current = await currentSalesAuthority();
  if (!current || current.state.lifecycleRevision !== lifecycleRevision) return undefined;
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({
    registration: sales.scopedRegistration,
    generation: current.generation,
    lifecycleOverride: { enabled: current.enabled, ready: current.enabled }
  });
  return { applicationId, lifecycleRevision, catalog: createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision, extensions: [contribution], executables: salesExecutables }) };
});
const resolver = new EffectiveAuthorityResolver({ store: authorizationStore, catalogProvider });
const lifecycleProjector = new AuthorizationLifecycleProjector(createStaticPlatformPluginAuthorizationDescriptorResolver({
  applicationId,
  registrations: [{ sourceCommit, registration: sales.scopedRegistration }]
}));
const store = new PostgresRuntimeExtensionStore(pool, clock, hostInventoryDigest, {
  authorizationLifecycleProjector: lifecycleProjector,
  sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder()
});
const imageDigest = digest({ applicationId, environment, generation: "generated-application-generation-1", subject: "image" });
const generation = Object.freeze({
  generationId: "generated-application-generation-1",
  sourceCommit,
  compositionChangePlanDigest: digest({ applicationId, environment, subject: "composition" }),
  buildEvidenceDigest: digest({ applicationId, environment, subject: "build" }),
  applicationDigest: digest({ applicationId, environment, subject: "application" }),
  imageDigest,
  imageReference: `knex/generated-application@${imageDigest}`,
  migrationRevision: 28
});
const workerFencingToken = 1;
await new PostgresStaticDeploymentStore(pool, clock, { read: () => { throw new Error("Fixture bootstrap never reads a build token."); } }).initialize({
  applicationId,
  environment,
  generation,
  workerOwner: "worker:phase-12-generated-application",
  workerFencingToken,
  workerLeaseExpiresAt: new Date(clock.now().valueOf() + 240_000).toISOString()
});
await store.reconcileStaticHostInventory({
  applicationId,
  environment,
  platformPlugins: [{ id: extension.id, package: sales.staticRelease.package, runtimeGenerationId: sales.staticRelease.runtimeGenerationId }],
  deployment: { kind: "initial", generation, workerFencingToken }
});
function createOperator(actor) {
  const correlationId = `operator:${digest(actor).slice("sha256:".length)}`;
  const sessionProvider = {
    current: async () => Object.freeze({
      session: createTrustedAuthorizationSession({
        schemaVersion: 1,
        applicationId,
        environment,
        correlationId,
        principal: actor.principal,
        effectiveActor: actor.effectiveActor,
        ...(actor.delegation === undefined ? {} : { delegation: actor.delegation })
      }),
      actor: Object.freeze({ kind: "actor", id: actor.effectiveActor.id, approvalId: `approval:${actor.effectiveActor.id}` })
    })
  };
  const authorizer = new CurrentAuthorityOperationAuthorizer(sessionProvider, resolver);
  const manager = new PluginManager(
  "phase-12-administration-operator",
  authorizer,
  {
    validate: async (request) => {
      if (request.applicationId !== applicationId || request.environment !== environment || canonicalJson(request.extension) !== canonicalJson(extension) || request.targetVersion !== version) throw new Error("Operator planner owner mismatch.");
    },
    plan: async (request) => {
      const current = extensionInventoryState(await store.inventory(applicationId, environment), extension);
      const generationId = current.disposition === "disabled" && request.operation === "install"
        ? current.currentGenerationId
        : request.operation === "disable" ? current.currentGenerationId : sales.staticRelease.runtimeGenerationId;
      if (!generationId) throw new Error("Operator planner generation unavailable.");
      return {
        sourceCommit,
        generationId,
        plan: {
          schemaVersion: 1,
          planId: `plan-${request.operation}-${request.operationId.slice(-16)}`,
          operationId: request.operationId,
          operation: request.operation,
          version: request.targetVersion,
          artifactDigest: digest({ extension, version }),
          expectedRevision: request.expectedRevision,
          ...(current.currentGenerationId ? { currentGenerationId: current.currentGenerationId } : {}),
          targetGenerationId: generationId,
          approvalRequired: false,
          rollback: { available: true, windowSeconds: 86_400 },
          deliveryClass: "platform-plugin",
          id: extension.id,
          availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } }
        }
      };
    }
  },
  store,
  { stage: async () => { throw new Error("Platform Plugin code is already in host image."); }, reverify: async () => false },
  { request: async () => { throw new Error("Restartless installed-code lifecycle cannot change source."); } },
  { request: async () => { throw new Error("Restartless installed-code lifecycle cannot request deployment."); }, reverify: async () => false },
  undefined,
  clock
  );
  return Object.freeze({ manager, operator: new ExtensionOperatorApi(
    manager,
    { list: async () => [] },
    { validate: async () => { throw new Error("Static release unavailable."); }, execute: async () => { throw new Error("Static release unavailable."); }, rollback: async () => { throw new Error("Static rollback unavailable."); }, finalize: async () => {} },
    { observe: async () => { throw new Error("Runtime observation unavailable."); } }
  ) });
}

const commandHandler = new AdministrationExtensionCommandHandler({
  applicationId,
  environment,
  operatorIdentity,
  clock: () => clock.now(),
  authorizationState: authorizationStore,
  store,
  operatorForActor: async (actor) => createOperator(actor).operator
});
const server = new NodeHttpsAdministrationOperatorServer({
  certificate: await readFile(required("P12_OPERATOR_SERVER_CERT")),
  privateKey: await readFile(required("P12_OPERATOR_SERVER_KEY")),
  certificateAuthority: await readFile(required("P12_OPERATOR_CA_CERT")),
  verifiedMtlsIdentity: { schemaVersion: 1, uriSan: expectedUriSan, applicationId, environment, allowedCommandFamilies: ["extension-lifecycle"] },
  operatorIdentity,
  maxBodyBytes: bodyLimit,
  clock: () => clock.now(),
  handler: (command) => commandHandler.handle(command)
});

let closePromise;
const close = () => closePromise ??= (async () => {
  await server.close();
  await pool.end();
})();
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
await server.start(port, "127.0.0.1");
process.stdout.write(`P12_ADMINISTRATION_OPERATOR_READY=${port}\n`);
