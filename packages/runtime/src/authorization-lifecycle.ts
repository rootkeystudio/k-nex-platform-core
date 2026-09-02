import { createHash } from "node:crypto";

import {
  AuthorizationPermissionDescriptorSchema,
  ExtensionAuthorizationGenerationSchema,
  ExtensionLifecycleEventSchema,
  ExtensionSecurityQuarantineEventSchema,
  PermissionCatalogSnapshotSchema,
  canonicalJson,
  type AuthorizationPermissionDescriptor,
  type ExtensionAuthorizationGeneration,
  type PermissionCatalogSnapshot
} from "@k-nex/contracts";

import {
  parseAuthorizationExpectedRevision,
  type AuthorizationExpectedRevision,
  type AuthorizationStoreMutation
} from "./authorization-store.js";

export type AuthorizationLifecycleErrorCode =
  | "INVALID_INPUT"
  | "IDENTITY_MISMATCH"
  | "REVISION_CONFLICT"
  | "AMBIGUOUS_GENERATION"
  | "UNSUPPORTED_TRANSITION";

export class AuthorizationLifecycleError extends Error {
  constructor(readonly code: AuthorizationLifecycleErrorCode, message: string) {
    super(message);
    this.name = "AuthorizationLifecycleError";
  }
}

export interface AuthorizationLifecyclePlanInput {
  /** The authorization-store revision immediately before this committed lifecycle event. */
  readonly expected: AuthorizationExpectedRevision;
  /** One committed Phase 9 lifecycle or security-quarantine event. */
  readonly transition: unknown;
  /** Existing rows for exactly the transitioned extension identity. */
  readonly existingGenerations: readonly unknown[];
  /** Verified descriptors from the transitioned extension release/registration. */
  readonly descriptors: readonly unknown[];
  /** Verified descriptors from the exact prior active release. Required for every update. */
  readonly priorGenerationDescriptors?: readonly unknown[];
  /** Verified runtime generation IDs associated with the committed target generation. */
  readonly runtimeGenerationIds: readonly string[];
  /** Required only for an update, because Phase 9's event intentionally has no authorization-compatibility field. */
  readonly updateCompatibility?: "compatible" | "incompatible";
}

export interface AuthorizationLifecyclePlan {
  readonly applicationId: string;
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
  readonly generations: readonly ExtensionAuthorizationGeneration[];
  readonly snapshots: readonly PermissionCatalogSnapshot[];
  readonly mutations: readonly AuthorizationStoreMutation[];
  readonly replayed: boolean;
}

export interface PendingAuthorizationGenerationPlanInput {
  readonly expected: AuthorizationExpectedRevision;
  readonly extensionId: string;
  readonly runtimeGenerationId: string;
  readonly existingGenerations: readonly unknown[];
}

type Transition = Readonly<{
  applicationId: string;
  deliveryClass: "platform-plugin" | "hot-application";
  extensionId: string;
  operation: "install" | "update" | "rollback" | "disable" | "uninstall" | "quarantine";
  lifecycleState: "active" | "disabled" | "removed" | "quarantined";
  expectedRevision: number;
  revision: number;
  runtimeGenerationId: string;
}>;

/**
 * Plans only authorization rows for an already committed extension transition.
 * It never writes a store, changes grants, roles, or assignments, or creates a
 * Phase 9 operation. The caller commits `mutations` atomically with its own
 * expected-revision check.
 */
export function planAuthorizationLifecycle(input: AuthorizationLifecyclePlanInput): AuthorizationLifecyclePlan {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  const transition = parseTransition(input.transition);
  if (transition.applicationId !== expected.applicationId) fail("IDENTITY_MISMATCH", "Lifecycle transition belongs to another application.");
  if (transition.revision !== transition.expectedRevision + 1) {
    fail("REVISION_CONFLICT", "Committed Phase 9 lifecycle transition does not advance its extension revision exactly once.");
  }
  if (transition.operation === "update" ? input.updateCompatibility === undefined : input.updateCompatibility !== undefined) {
    fail("INVALID_INPUT", "Update compatibility is required only for update transitions.");
  }

  const runtimeGenerationIds = parseRuntimeGenerationIds(input.runtimeGenerationIds, transition);
  const existing = parseExistingGenerations(input.existingGenerations, transition, expected);
  const current = currentGeneration(existing);
  const pending = pendingGeneration(existing);
  const descriptors = parseDescriptors(input.descriptors, transition);
  const update = transition.operation === "update";
  const incompatible = update && input.updateCompatibility === "incompatible";
  if (update !== (input.priorGenerationDescriptors !== undefined)) {
    fail("INVALID_INPUT", "Prior-generation descriptors are required only for update transitions.");
  }
  const priorGenerationDescriptors = update
    ? parseDescriptors(input.priorGenerationDescriptors!, transition)
    : undefined;
  const targetRevision = nextLifecycleRevision(expected);

  let nextRows: readonly ExtensionAuthorizationGeneration[];
  let snapshots: readonly PermissionCatalogSnapshot[] = [];

  if (transition.operation === "disable") {
    assertState(transition, "disabled");
    if (!current) fail("REVISION_CONFLICT", "Disable requires one current authorization generation.");
    assertExactRuntimeGeneration(current, runtimeGenerationIds);
    const next = generation(current.owner.generation, "current", current.runtimeGenerationIds, expected.authorizationRevision, targetRevision, transition);
    nextRows = replaceGeneration(existing, next);
    snapshots = createSnapshots(descriptors, next.owner, transition.applicationId, "inactive-extension-disabled", targetRevision);
  } else if (transition.operation === "uninstall" || transition.operation === "quarantine") {
    assertState(transition, transition.operation === "uninstall" ? "removed" : "quarantined");
    const retiredMatch = current === undefined ? existing.find((row) => row.state === "retired" &&
      sameRuntimeGenerationIds(row.runtimeGenerationIds, runtimeGenerationIds)) : undefined;
    const retiredReplay = retiredMatch?.lifecycleRevision === targetRevision ? retiredMatch : undefined;
    if (!current && !retiredMatch) fail("REVISION_CONFLICT", `${transition.operation} requires one current authorization generation.`);
    if (!current && transition.operation !== "uninstall") fail("REVISION_CONFLICT", "Only uninstall can advance an already retired authorization generation.");
    const retired = retiredReplay ?? generation((current ?? retiredMatch)!.owner.generation, "retired", (current ?? retiredMatch)!.runtimeGenerationIds, expected.authorizationRevision, targetRevision, transition);
    if (current) assertExactRuntimeGeneration(current, runtimeGenerationIds);
    nextRows = retiredReplay ? existing : replaceGeneration(existing, retired);
    snapshots = createSnapshots(
      descriptors,
      retired.owner,
      transition.applicationId,
      transition.operation === "uninstall" ? "orphaned-after-removal" : "inactive-generation-retired",
      targetRevision
    );
  } else {
    assertState(transition, "active");
    if (pending !== undefined) {
      if (transition.deliveryClass !== "hot-application" || !sameRuntimeGenerationIds(pending.runtimeGenerationIds, runtimeGenerationIds)) {
        fail("IDENTITY_MISMATCH", "Activation must promote the exact reserved Hot Application runtime generation.");
      }
      const promoted = generation(pending.owner.generation, "current", pending.runtimeGenerationIds, expected.authorizationRevision, targetRevision, transition);
      const retired = current === undefined ? [] : [generation(current.owner.generation, "retired", current.runtimeGenerationIds, expected.authorizationRevision, targetRevision, transition)];
      nextRows = canonicalRows([
        ...existing.filter((row) => row.owner.generation !== pending.owner.generation && row.owner.generation !== current?.owner.generation),
        ...retired,
        promoted
      ]);
      if (current !== undefined && update) snapshots = createSnapshots(priorGenerationDescriptors!, current.owner, transition.applicationId, "inactive-generation-retired", targetRevision);
    } else if (incompatible && current && sameRuntimeGenerationIds(current.runtimeGenerationIds, runtimeGenerationIds) && current.lifecycleRevision === targetRevision) {
      nextRows = existing;
    } else if (current && !incompatible) {
      const next = generation(current.owner.generation, "current", runtimeGenerationIds, expected.authorizationRevision, targetRevision, transition);
      nextRows = replaceGeneration(existing, next);
      if (update) {
        snapshots = createSnapshots(
          removedDescriptors(priorGenerationDescriptors!, descriptors),
          current.owner,
          transition.applicationId,
          "deprecated",
          targetRevision
        );
      }
    } else {
      if (transition.operation === "update" && input.updateCompatibility === "compatible") {
        fail("REVISION_CONFLICT", "A compatible update requires the current authorization generation it preserves.");
      }
      const freshGeneration = nextGenerationNumber(existing);
      const fresh = generation(freshGeneration, "current", runtimeGenerationIds, expected.authorizationRevision, targetRevision, transition);
      const retired = current === undefined ? [] : [generation(current.owner.generation, "retired", current.runtimeGenerationIds, expected.authorizationRevision, targetRevision, transition)];
      nextRows = canonicalRows([...existing.filter((row) => row.owner.generation !== current?.owner.generation), ...retired, fresh]);
      if (current !== undefined) snapshots = createSnapshots(priorGenerationDescriptors!, current.owner, transition.applicationId, "inactive-generation-retired", targetRevision);
    }
  }

  const replayed = isReplay(existing, nextRows);
  if (!replayed && existing.some((row) => row.lifecycleRevision === targetRevision)) {
    fail("REVISION_CONFLICT", "A different lifecycle transition already occupies this target revision.");
  }
  const mutations = replayed
    ? []
    : Object.freeze([
      ...changedRows(existing, nextRows).map((generation) => Object.freeze({ kind: "extension-generation" as const, generation })),
      ...snapshots.map((snapshot) => Object.freeze({ kind: "catalog-snapshot" as const, snapshot }))
    ]);
  return Object.freeze({
    applicationId: expected.applicationId,
    authorizationRevision: expected.authorizationRevision,
    lifecycleRevision: targetRevision,
    generations: nextRows,
    snapshots: Object.freeze(snapshots),
    mutations,
    replayed
  });
}

/** Reserves an inert final owner fence for pre-activation Hot Application settings. */
export function planPendingAuthorizationGeneration(input: PendingAuthorizationGenerationPlanInput): AuthorizationLifecyclePlan {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  const identity = { deliveryClass: "hot-application" as const, extensionId: input.extensionId };
  const transition = {
    applicationId: expected.applicationId,
    ...identity,
    operation: "install" as const,
    lifecycleState: "active" as const,
    expectedRevision: 0,
    revision: 1,
    runtimeGenerationId: input.runtimeGenerationId
  };
  const runtimeGenerationIds = parseRuntimeGenerationIds([input.runtimeGenerationId], transition);
  const existing = parseExistingGenerations(input.existingGenerations, transition, expected);
  const matching = existing.find((row) => row.state === "pending-configuration" && sameRuntimeGenerationIds(row.runtimeGenerationIds, runtimeGenerationIds));
  if (matching !== undefined) {
    return Object.freeze({
      applicationId: expected.applicationId,
      authorizationRevision: expected.authorizationRevision,
      lifecycleRevision: expected.lifecycleRevision,
      generations: existing,
      snapshots: Object.freeze([]),
      mutations: Object.freeze([]),
      replayed: true
    });
  }
  if (pendingGeneration(existing) !== undefined) fail("REVISION_CONFLICT", "Another runtime generation already owns the pending configuration fence.");
  const lifecycleRevision = nextLifecycleRevision(expected);
  const reserved = generation(nextGenerationNumber(existing), "pending-configuration", runtimeGenerationIds, expected.authorizationRevision, lifecycleRevision, transition);
  const generations = canonicalRows([...existing, reserved]);
  return Object.freeze({
    applicationId: expected.applicationId,
    authorizationRevision: expected.authorizationRevision,
    lifecycleRevision,
    generations,
    snapshots: Object.freeze([]),
    mutations: Object.freeze([{ kind: "extension-generation" as const, generation: reserved }]),
    replayed: false
  });
}

function parseTransition(value: unknown): Transition {
  const lifecycle = ExtensionLifecycleEventSchema.safeParse(value);
  if (lifecycle.success) {
    const event = lifecycle.data;
    if (event.deliveryClass === "theme-skin") fail("UNSUPPORTED_TRANSITION", "Theme Skins cannot own authorization generations.");
    if (event.operationPhase === "failed" && event.lifecycleState === "quarantined") {
      return Object.freeze({
        applicationId: event.applicationId,
        deliveryClass: event.deliveryClass,
        extensionId: event.id,
        operation: "quarantine",
        lifecycleState: "quarantined",
        expectedRevision: event.expectedRevision,
        revision: event.revision,
        runtimeGenerationId: event.evidence.generationId
      });
    }
    if (!["install", "update", "rollback", "disable", "uninstall"].includes(event.operation)) {
      fail("UNSUPPORTED_TRANSITION", "Lifecycle transition operation is not an authorization lifecycle input.");
    }
    const expectedState = event.operation === "disable" ? "disabled" : event.operation === "uninstall" ? "removed" : "active";
    if (event.lifecycleState !== expectedState) fail("UNSUPPORTED_TRANSITION", "Lifecycle transition does not have a committed terminal state.");
    return Object.freeze({
      applicationId: event.applicationId,
      deliveryClass: event.deliveryClass,
      extensionId: event.id,
      operation: event.operation,
      lifecycleState: event.lifecycleState,
      expectedRevision: event.expectedRevision,
      revision: event.revision,
      runtimeGenerationId: event.evidence.generationId
    });
  }
  const quarantine = ExtensionSecurityQuarantineEventSchema.safeParse(value);
  if (!quarantine.success) fail("INVALID_INPUT", "Lifecycle transition is not a canonical committed Phase 9 event.");
  if (quarantine.data.deliveryClass === "theme-skin") fail("UNSUPPORTED_TRANSITION", "Theme Skins cannot own authorization generations.");
  return Object.freeze({
    applicationId: quarantine.data.applicationId,
    deliveryClass: quarantine.data.deliveryClass,
    extensionId: quarantine.data.id,
    operation: "quarantine",
    lifecycleState: "quarantined",
    expectedRevision: quarantine.data.expectedRevision,
    revision: quarantine.data.revision,
    runtimeGenerationId: quarantine.data.evidence.generationId
  });
}

function parseRuntimeGenerationIds(value: readonly string[], transition: Transition): readonly string[] {
  const staticUninstall = transition.deliveryClass === "platform-plugin" && transition.operation === "uninstall";
  if (!Array.isArray(value) || value.length === 0 || value.length > 16 || !strictlySorted(value) || !staticUninstall && !value.includes(transition.runtimeGenerationId)) {
    fail("INVALID_INPUT", "Runtime generation IDs must be sorted, unique, bounded, and include the committed generation.");
  }
  const parsed = ExtensionAuthorizationGenerationSchema.safeParse({
    schemaVersion: 1,
    applicationId: transition.applicationId,
    owner: { kind: "extension", deliveryClass: transition.deliveryClass, extensionId: transition.extensionId, generation: 1 },
    runtimeGenerationIds: value,
    state: "current",
    authorizationRevision: 0,
    lifecycleRevision: 0
  });
  if (!parsed.success) fail("INVALID_INPUT", "Runtime generation IDs are not canonical.");
  return Object.freeze([...parsed.data.runtimeGenerationIds]);
}

function parseDescriptors(value: readonly unknown[], transition: Transition): readonly AuthorizationPermissionDescriptor[] {
  if (!Array.isArray(value) || value.length > 256) fail("INVALID_INPUT", "Authorization descriptors must be a bounded array.");
  const descriptors = value.map((descriptor) => {
    const parsed = AuthorizationPermissionDescriptorSchema.safeParse(descriptor);
    if (!parsed.success || parsed.data.publisher.kind !== "extension" || parsed.data.publisher.deliveryClass !== transition.deliveryClass || parsed.data.publisher.extensionId !== transition.extensionId) {
      fail("IDENTITY_MISMATCH", "Authorization descriptor publisher must exactly match the transitioned extension namespace.");
    }
    return parsed.data;
  });
  if (!strictlySorted(descriptors.map(({ id }) => id))) fail("INVALID_INPUT", "Authorization descriptors must be sorted and unique by ID.");
  return Object.freeze(descriptors.map((descriptor) => Object.freeze(structuredClone(descriptor))));
}

function parseExistingGenerations(value: readonly unknown[], transition: Transition, expected: AuthorizationExpectedRevision): readonly ExtensionAuthorizationGeneration[] {
  if (!Array.isArray(value)) fail("INVALID_INPUT", "Existing authorization generations must be an array.");
  const rows = value.map((row) => {
    const parsed = ExtensionAuthorizationGenerationSchema.safeParse(row);
    if (!parsed.success) fail("INVALID_INPUT", "Existing authorization generation is not canonical.");
    if (parsed.data.applicationId !== transition.applicationId || parsed.data.owner.deliveryClass !== transition.deliveryClass || parsed.data.owner.extensionId !== transition.extensionId) {
      fail("IDENTITY_MISMATCH", "Existing authorization generation belongs to another extension identity.");
    }
    if (!strictlySorted(parsed.data.runtimeGenerationIds)) fail("INVALID_INPUT", "Existing authorization generation runtime IDs must be sorted and unique.");
    if (parsed.data.authorizationRevision > expected.authorizationRevision || parsed.data.lifecycleRevision > nextLifecycleRevision(expected)) {
      fail("REVISION_CONFLICT", "Existing authorization generation is newer than the committed transition.");
    }
    return parsed.data;
  });
  if (new Set(rows.map((row) => row.owner.generation)).size !== rows.length || new Set(rows.flatMap((row) => row.runtimeGenerationIds)).size !== rows.flatMap((row) => row.runtimeGenerationIds).length) {
    fail("AMBIGUOUS_GENERATION", "Authorization generations cannot duplicate a numeric or runtime generation fence.");
  }
  return canonicalRows(rows);
}

function currentGeneration(rows: readonly ExtensionAuthorizationGeneration[]): ExtensionAuthorizationGeneration | undefined {
  const current = rows.filter((row) => row.state === "current");
  if (current.length > 1) fail("AMBIGUOUS_GENERATION", "An extension may have only one current authorization generation.");
  return current[0];
}

function pendingGeneration(rows: readonly ExtensionAuthorizationGeneration[]): ExtensionAuthorizationGeneration | undefined {
  const pending = rows.filter((row) => row.state === "pending-configuration");
  if (pending.length > 1) fail("AMBIGUOUS_GENERATION", "An extension may have only one pending configuration generation.");
  return pending[0];
}

function generation(
  number: number,
  state: ExtensionAuthorizationGeneration["state"],
  runtimeGenerationIds: readonly string[],
  authorizationRevision: number,
  lifecycleRevision: number,
  transition: Transition
): ExtensionAuthorizationGeneration {
  const parsed = ExtensionAuthorizationGenerationSchema.safeParse({
    schemaVersion: 1,
    applicationId: transition.applicationId,
    owner: { kind: "extension", deliveryClass: transition.deliveryClass, extensionId: transition.extensionId, generation: number },
    runtimeGenerationIds,
    state,
    authorizationRevision,
    lifecycleRevision
  });
  if (!parsed.success) fail("INVALID_INPUT", "Authorization generation is not canonical.");
  return Object.freeze(parsed.data);
}

function createSnapshots(
  descriptors: readonly AuthorizationPermissionDescriptor[],
  owner: ExtensionAuthorizationGeneration["owner"],
  applicationId: string,
  state: "inactive-extension-disabled" | "inactive-generation-retired" | "deprecated" | "orphaned-after-removal",
  revision: number
): readonly PermissionCatalogSnapshot[] {
  return Object.freeze(descriptors.map((permission) => {
    const snapshot = PermissionCatalogSnapshotSchema.safeParse({
      schemaVersion: 1,
      id: deterministicId("authorization-snapshot", owner.deliveryClass, owner.extensionId, String(owner.generation), permission.id, state),
      applicationId,
      source: "administrative-non-authoritative",
      permission,
      state,
      owner,
      revision
    });
    if (!snapshot.success) fail("INVALID_INPUT", "Administrative permission snapshot is not canonical.");
    return Object.freeze(snapshot.data);
  }));
}

function removedDescriptors(
  prior: readonly AuthorizationPermissionDescriptor[],
  target: readonly AuthorizationPermissionDescriptor[]
): readonly AuthorizationPermissionDescriptor[] {
  const targetIds = new Set(target.map(({ id }) => id));
  return Object.freeze(prior.filter(({ id }) => !targetIds.has(id)));
}

function replaceGeneration(rows: readonly ExtensionAuthorizationGeneration[], next: ExtensionAuthorizationGeneration): readonly ExtensionAuthorizationGeneration[] {
  return canonicalRows([...rows.filter((row) => row.owner.generation !== next.owner.generation), next]);
}

function canonicalRows(rows: readonly ExtensionAuthorizationGeneration[]): readonly ExtensionAuthorizationGeneration[] {
  return Object.freeze([...rows].sort((left, right) => left.owner.generation - right.owner.generation).map((row) => Object.freeze(structuredClone(row))));
}

function assertExactRuntimeGeneration(current: ExtensionAuthorizationGeneration, runtimeGenerationIds: readonly string[]): void {
  if (!sameRuntimeGenerationIds(current.runtimeGenerationIds, runtimeGenerationIds)) {
    fail("IDENTITY_MISMATCH", "Disable, uninstall, and quarantine must retain the current runtime generation IDs exactly.");
  }
}

function sameRuntimeGenerationIds(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertState(transition: Transition, expected: Transition["lifecycleState"]): void {
  if (transition.lifecycleState !== expected) fail("UNSUPPORTED_TRANSITION", "Lifecycle transition state is not valid for this authorization operation.");
}

function changedRows(before: readonly ExtensionAuthorizationGeneration[], after: readonly ExtensionAuthorizationGeneration[]): readonly ExtensionAuthorizationGeneration[] {
  const previous = new Map(before.map((row) => [row.owner.generation, row]));
  return Object.freeze(after.filter((row) => {
    const prior = previous.get(row.owner.generation);
    return prior === undefined || canonicalJson(prior) !== canonicalJson(row);
  }));
}

function isReplay(before: readonly ExtensionAuthorizationGeneration[], after: readonly ExtensionAuthorizationGeneration[]): boolean {
  return before.length === after.length && before.every((row, index) => canonicalJson(row) === canonicalJson(after[index]));
}

function nextGenerationNumber(rows: readonly ExtensionAuthorizationGeneration[]): number {
  const maximum = rows.reduce((value, row) => Math.max(value, row.owner.generation), 0);
  if (maximum >= Number.MAX_SAFE_INTEGER) fail("REVISION_CONFLICT", "Authorization generation cannot advance further.");
  return maximum + 1;
}

function nextLifecycleRevision(expected: AuthorizationExpectedRevision): number {
  if (expected.lifecycleRevision >= 1_000_000_000) fail("REVISION_CONFLICT", "Lifecycle revision cannot advance further.");
  return expected.lifecycleRevision + 1;
}

function strictlySorted(values: readonly string[]): boolean {
  return values.every((value, index) => typeof value === "string" && (index === 0 || values[index - 1]! < value));
}

function deterministicId(kind: string, ...parts: readonly string[]): string {
  return `authorization.${kind}.${createHash("sha256").update(canonicalJson(parts)).digest("hex")}`;
}

function fail(code: AuthorizationLifecycleErrorCode, message: string): never {
  throw new AuthorizationLifecycleError(code, message);
}
