import { randomUUID } from "node:crypto";

import { canonicalJson, type AdministrationActorEnvelope, type AuthorizationState, type CatalogRefreshReceipt, type ResumableCatalogRefreshOperation, type RuntimeExtensionInventory } from "@k-nex/contracts";
import { type ActiveReleaseIdentity, type ArtifactVerifier, type CatalogCheckpointStore, type CatalogClient, type OfficialGithubCatalogReader, sha256, type VerifiedCatalogSnapshot } from "@k-nex/extension-bundler";
import type { RuntimeExtensionStore } from "@k-nex/runtime";

import { ActiveExtensionSecurityReconciler } from "./active-extension-security-reconciler.js";
import { CatalogMirrorStoreError, type CatalogMirrorOwner, type CatalogMirrorRefresh, type CatalogReconciliationRequirement, type PostgresCatalogMirrorStore } from "./catalog-mirror-store.js";

type RefreshResult = ResumableCatalogRefreshOperation | CatalogRefreshReceipt;
type ActiveExtension = Readonly<{
  extension: { readonly deliveryClass: "hot-application" | "theme-skin"; readonly id: string };
  generationId: string;
  revision: number;
  release: ActiveReleaseIdentity;
}>;

export interface CatalogRefreshCoordinatorIds {
  snapshot(): string;
  receipt(): string;
  audit(): string;
  event(): string;
}

export interface CatalogRefreshCoordinatorOptions {
  readonly owner: CatalogMirrorOwner;
  readonly reader: Pick<OfficialGithubCatalogReader, "read">;
  readonly catalog: Pick<CatalogClient, "verifySnapshot" | "verifyStagedSnapshot">;
  readonly checkpoints: Pick<CatalogCheckpointStore, "read">;
  readonly verifier: Pick<ArtifactVerifier, "currentSecurityDecisionFromSnapshot">;
  readonly mirror: Pick<PostgresCatalogMirrorStore, "begin" | "readRefresh" | "readRefreshAuthority" | "stageVerified" | "readStaged" | "readRequirements" | "rebaseRequirements" | "markReconciliationTerminal" | "readObservation" | "acceptAfterTerminalReconciliation" | "reject">;
  readonly currentAuthority: Readonly<{ reauthorize(input: Readonly<{ authority: AdministrationActorEnvelope; refreshId: string; phase: "begin" | "resume" | "accept" }>): Promise<AuthorizationState | undefined> }>;
  readonly extensions: Pick<RuntimeExtensionStore, "inventory">;
  readonly reconciler: Pick<ActiveExtensionSecurityReconciler, "reconcileSnapshot">;
  readonly now?: () => Date;
  readonly ids?: CatalogRefreshCoordinatorIds;
}

function ids(): CatalogRefreshCoordinatorIds {
  const next = (prefix: string) => `${prefix}-${randomUUID()}`;
  return Object.freeze({ snapshot: () => next("catalog-snapshot"), receipt: () => next("catalog-receipt"), audit: () => next("catalog-audit"), event: () => next("catalog-event") });
}

function activeExtensions(inventory: RuntimeExtensionInventory): readonly ActiveExtension[] {
  type ActiveEntries = RuntimeExtensionInventory["extensions"]["hotApplications"] | RuntimeExtensionInventory["extensions"]["themeSkins"];
  const values = (deliveryClass: "hot-application" | "theme-skin", entries: ActiveEntries) => Object.entries(entries)
    .flatMap(([id, value]) => {
      if (value.disposition !== "active" || value.activeGeneration === undefined) return [];
      const generation = value.activeGeneration!;
      return [Object.freeze({
        extension: Object.freeze({ deliveryClass, id }),
        generationId: generation.generationId,
        revision: value.revision,
        release: Object.freeze({ deliveryClass, id, version: generation.version, sourceCommit: generation.sourceCommit, artifactDigest: generation.artifactDigest, manifestDigest: generation.manifestDigest, provenanceDigest: generation.provenanceDigest, sbomDigest: generation.sbomDigest })
      })];
    });
  return Object.freeze([
    ...values("hot-application", inventory.extensions.hotApplications),
    ...values("theme-skin", inventory.extensions.themeSkins)
  ].sort((left, right) => `${left.extension.deliveryClass}:${left.extension.id}`.localeCompare(`${right.extension.deliveryClass}:${right.extension.id}`)));
}

function sameSnapshot(left: VerifiedCatalogSnapshot, right: Readonly<{ signerIdentity: string; sequence: number; digest: string; releaseCount: number }>): boolean {
  return left.catalog.signer.identity === right.signerIdentity
    && left.catalog.payload.sequence === right.sequence
    && left.entries.length === right.releaseCount
    && sha256(Buffer.from(canonicalJson(left.catalog.payload))) === right.digest;
}

function rejectionReason(error: unknown): "snapshot-invalid" | "snapshot-replayed" {
  const message = error instanceof Error ? error.message : "";
  return /stale|replay|downgrade/i.test(message) ? "snapshot-replayed" : "snapshot-invalid";
}

/** Durable catalog refresh: fetch once, stage policy, reconcile, then accept. */
export class CatalogRefreshCoordinator {
  readonly #now: () => Date;
  readonly #ids: CatalogRefreshCoordinatorIds;

  constructor(private readonly options: CatalogRefreshCoordinatorOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#ids = options.ids ?? ids();
  }

  async refresh(refresh: CatalogMirrorRefresh): Promise<RefreshResult> {
    if (!await this.reauthorize(refresh, "begin")) throw new Error("Catalog refresh current authority is unavailable.");
    const current = await this.options.mirror.begin(refresh);
    if ("outcome" in current) return current;
    const persisted = await this.options.mirror.readRefreshAuthority(current.refreshId);
    if (!persisted) throw new Error("Catalog refresh authority disappeared after its durable transition.");
    if (!await this.reauthorize(persisted, "resume")) return this.reject(persisted, current.revision, "permission-revoked");
    if (current.state === "fetching") return this.fetchAndStage(persisted, current);
    return this.reconcile(persisted, current.refreshId);
  }

  async read(refreshId: string): Promise<RefreshResult | undefined> { return this.options.mirror.readRefresh(refreshId); }

  private async fetchAndStage(refresh: CatalogMirrorRefresh, operation: ResumableCatalogRefreshOperation): Promise<RefreshResult> {
    let input: unknown;
    try {
      input = await this.options.reader.read();
    } catch {
      return this.options.mirror.reject({ refresh, expectedOperationRevision: operation.revision, receiptId: this.#ids.receipt(), reason: "fetch-failed", occurredAt: this.#now().toISOString() });
    }
    let unsigned: VerifiedCatalogSnapshot;
    try {
      unsigned = await this.options.catalog.verifySnapshot(input);
    } catch (error) {
      return this.options.mirror.reject({ refresh, expectedOperationRevision: operation.revision, receiptId: this.#ids.receipt(), reason: rejectionReason(error), occurredAt: this.#now().toISOString() });
    }
    const previous = await this.options.checkpoints.read(unsigned.catalog.signer.identity);
    let snapshot: VerifiedCatalogSnapshot;
    try {
      snapshot = await this.options.catalog.verifySnapshot(input, previous);
    } catch (error) {
      return this.options.mirror.reject({ refresh, expectedOperationRevision: operation.revision, receiptId: this.#ids.receipt(), reason: rejectionReason(error), occurredAt: this.#now().toISOString() });
    }
    if (previous?.sequence === snapshot.checkpoint.sequence && previous.payloadDigest === snapshot.checkpoint.payloadDigest) {
      return this.options.mirror.reject({ refresh, expectedOperationRevision: operation.revision, receiptId: this.#ids.receipt(), reason: "snapshot-replayed", occurredAt: this.#now().toISOString() });
    }
    const requirements = this.requirements(snapshot, await this.options.extensions.inventory(this.options.owner.applicationId, this.options.owner.environment));
    let staged: RefreshResult;
    try {
      staged = await this.options.mirror.stageVerified({
        refresh,
        snapshot: { snapshotId: this.#ids.snapshot(), signedCatalog: snapshot.catalog, signerIdentity: snapshot.catalog.signer.identity, sequence: snapshot.catalog.payload.sequence, digest: sha256(Buffer.from(canonicalJson(snapshot.catalog.payload))), releaseCount: snapshot.entries.length, observedAt: this.#now().toISOString() },
        expectedCheckpoint: previous,
        checkpoint: snapshot.checkpoint,
        requirements
      });
    } catch (error) {
      if (error instanceof CatalogMirrorStoreError && (error.code === "REVISION" || error.code === "CHECKPOINT" || (error.code === "STATE" && error.message === "A catalog reconciliation is already staged."))) {
        return this.options.mirror.reject({ refresh, expectedOperationRevision: operation.revision, receiptId: this.#ids.receipt(), reason: error.code === "CHECKPOINT" ? "snapshot-replayed" : "stale-revision", occurredAt: this.#now().toISOString() });
      }
      throw error;
    }
    return "outcome" in staged ? staged : this.reconcile(refresh, staged.refreshId);
  }

  private async reconcile(refresh: CatalogMirrorRefresh, refreshId: string): Promise<RefreshResult> {
    let staged = await this.options.mirror.readStaged(refreshId);
    if (!staged) {
      const replay = await this.options.mirror.begin(refresh);
      if ("outcome" in replay) return replay;
      throw new Error("Catalog staged refresh disappeared before reconciliation.");
    }
    const checkpoint = await this.options.checkpoints.read(staged.snapshot.signerIdentity);
    if (!checkpoint) throw new Error("Catalog staged checkpoint is unavailable.");
    const snapshot = await this.options.catalog.verifyStagedSnapshot(staged.snapshot.signedCatalog, checkpoint);
    if (!sameSnapshot(snapshot, staged.snapshot)) throw new Error("Persisted staged catalog does not match its verified bytes.");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const inventory = await this.options.extensions.inventory(this.options.owner.applicationId, this.options.owner.environment);
      const observation = await this.options.mirror.readObservation();
      if (observation.state !== "staged-reconciliation") throw new Error("Catalog staged refresh changed before reconciliation.");
      try {
        staged = { ...staged, operation: await this.options.mirror.rebaseRequirements({ refreshId, expectedOperationRevision: staged.operation.revision, expectedCatalogRevision: observation.catalogRevision, requirements: this.requirements(snapshot, inventory) }) };
      } catch (error) {
        if (!(error instanceof CatalogMirrorStoreError) || error.code !== "REVISION" || attempt === 2) throw error;
        staged = await this.options.mirror.readStaged(refreshId);
        if (!staged) break;
        continue;
      }
      const requirements = await this.options.mirror.readRequirements(refreshId);
      let changed = false;
      for (const requirement of requirements) {
        if (requirement.terminalState !== "pending") continue;
        if (!(await this.exactRequirement(snapshot, requirement))) { changed = true; break; }
        const result = await this.options.reconciler.reconcileSnapshot({ applicationId: this.options.owner.applicationId, environment: this.options.owner.environment, extension: { deliveryClass: requirement.deliveryClass, id: requirement.extensionId }, snapshot });
        if (result.status === "not-active") { changed = true; break; }
        if (result.status === "clear" && !(await this.exactRequirement(snapshot, requirement))) { changed = true; break; }
        await this.options.mirror.markReconciliationTerminal({ refreshId, requirement, state: result.status === "quarantined" ? "quarantined" : "clear", ...(result.status === "quarantined" ? { securityReceiptId: result.receipt.receiptId } : {}) });
      }
      if (changed) continue;
      const currentInventory = await this.options.extensions.inventory(this.options.owner.applicationId, this.options.owner.environment);
      const terminalRequirements = await this.options.mirror.readRequirements(refreshId);
      if (canonicalJson(terminalRequirements.filter((requirement) => requirement.terminalState !== "quarantined").map(({ terminalState: _terminalState, securityReceiptId: _securityReceiptId, ...requirement }) => requirement)) !== canonicalJson(this.requirements(snapshot, currentInventory))) continue;
      const authority = await this.reauthorize(refresh, "accept");
      if (!authority) return this.reject(refresh, staged.operation.revision, "permission-revoked");
      try {
        return await this.options.mirror.acceptAfterTerminalReconciliation({ refresh, authority, expectedOperationRevision: staged.operation.revision, expectedCatalogRevision: observation.catalogRevision, expectedInventoryRevision: currentInventory.revision, receiptId: this.#ids.receipt(), auditId: this.#ids.audit(), eventId: this.#ids.event(), reconciledReleaseCount: terminalRequirements.length, occurredAt: this.#now().toISOString() });
      } catch (error) {
        if (!(error instanceof CatalogMirrorStoreError) || error.code !== "REVISION" || attempt === 2) throw error;
      }
    }
    throw new Error("Catalog reconciliation did not stabilize.");
  }

  private reject(refresh: CatalogMirrorRefresh, expectedOperationRevision: number, reason: "permission-revoked"): Promise<CatalogRefreshReceipt> {
    return this.options.mirror.reject({ refresh, expectedOperationRevision, receiptId: this.#ids.receipt(), reason, occurredAt: this.#now().toISOString() });
  }

  private async reauthorize(refresh: CatalogMirrorRefresh, phase: "begin" | "resume" | "accept"): Promise<AuthorizationState | undefined> {
    try {
      const authority = await this.options.currentAuthority.reauthorize({ authority: refresh.authorityEnvelope, refreshId: refresh.refreshId, phase });
      return authority?.applicationId === this.options.owner.applicationId && authority.environment === this.options.owner.environment ? authority : undefined;
    } catch { return undefined; }
  }

  private requirements(snapshot: VerifiedCatalogSnapshot, inventory: RuntimeExtensionInventory): readonly CatalogReconciliationRequirement[] {
    return activeExtensions(inventory).map(({ extension, generationId, revision, release }) => {
      const decision = this.options.verifier.currentSecurityDecisionFromSnapshot(snapshot, release);
      return Object.freeze({ deliveryClass: extension.deliveryClass, extensionId: extension.id, generationId, decisionDigest: sha256(Buffer.from(canonicalJson({ applicationId: this.options.owner.applicationId, environment: this.options.owner.environment, extension, expectedRevision: revision, generationId, decision }))) });
    });
  }

  private async exactRequirement(snapshot: VerifiedCatalogSnapshot, requirement: CatalogReconciliationRequirement): Promise<boolean> {
    const current = activeExtensions(await this.options.extensions.inventory(this.options.owner.applicationId, this.options.owner.environment));
    const active = current.find(({ extension, generationId }) => extension.deliveryClass === requirement.deliveryClass && extension.id === requirement.extensionId && generationId === requirement.generationId);
    if (!active) return false;
    const decision = this.options.verifier.currentSecurityDecisionFromSnapshot(snapshot, active.release);
    return sha256(Buffer.from(canonicalJson({ applicationId: this.options.owner.applicationId, environment: this.options.owner.environment, extension: active.extension, expectedRevision: active.revision, generationId: active.generationId, decision }))) === requirement.decisionDigest;
  }
}
