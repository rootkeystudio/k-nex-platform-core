import {
  AuthorizationPermissionDescriptorSchema,
  ExtensionLifecycleEventSchema,
  canonicalJson,
  type AuthorizationPermissionDescriptor
} from "@k-nex/contracts";
import {
  AuthorizationLifecycleError,
  assertExecutableRegistrationAuthority,
  type ScopedRegistrationResult
} from "@k-nex/runtime";

import type {
  AuthorizationLifecycleCommittedTransition,
  AuthorizationLifecycleDescriptorResolver
} from "./authorization-lifecycle-projector.js";
import type { RuntimeExtensionSession } from "./runtime-extension-store.js";

const maximumRegistrations = 256;
const applicationIdPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const sourceCommitPattern = /^[0-9a-f]{40}$/u;
const generationIdPattern = /^[a-z][a-z0-9-]{2,127}$/u;

export interface StaticPlatformPluginAuthorizationRegistration {
  readonly sourceCommit: string;
  readonly registration: ScopedRegistrationResult;
}

export interface StaticPlatformPluginAuthorizationDescriptorResolverOptions {
  readonly applicationId: string;
  readonly registrations: readonly StaticPlatformPluginAuthorizationRegistration[] | ReadonlyMap<string, ScopedRegistrationResult>;
}

type RetainedGenerationRow = Readonly<{ retained_generation: unknown }>;

/**
 * Resolves Platform Plugin permissions exclusively from trusted static registrations.
 * The registry is copied at construction so later caller mutation cannot alter authority.
 */
export function createStaticPlatformPluginAuthorizationDescriptorResolver(
  options: StaticPlatformPluginAuthorizationDescriptorResolverOptions
): AuthorizationLifecycleDescriptorResolver {
  if (!applicationIdPattern.test(options.applicationId)) fail("INVALID_INPUT", "Platform Plugin authorization resolver application ID is invalid.");
  const registrations = trustedRegistrations(options.registrations);

  return async (session, transition, priorGenerationEvidence) => {
    const event = platformPluginTransition(transition, options.applicationId);
    const sourceCommit = priorGenerationEvidence === undefined ? event.operation === "uninstall"
      ? await retainedSourceCommit(session, event)
      : event.evidence.sourceCommit
      : priorStaticSourceCommit(priorGenerationEvidence, event);
    const registration = registrations.get(sourceCommit);
    if (!registration) fail("IDENTITY_MISMATCH", "Platform Plugin transition source commit has no trusted static registration.");
    if (!registration.inventory.some(({ id }) => id === event.id)) {
      fail("IDENTITY_MISMATCH", "Trusted static registration does not contain the transitioned Platform Plugin.");
    }
    return descriptorsForPlugin(registration, event.id);
  };
}

function priorStaticSourceCommit(value: unknown, transition: Extract<ReturnType<typeof platformPluginTransition>, { readonly deliveryClass: "platform-plugin" }>): string {
  if (!record(value) || value.authority !== "static-build" || typeof value.sourceCommit !== "string" ||
    !sourceCommitPattern.test(value.sourceCommit) || typeof value.generationId !== "string" || !generationIdPattern.test(value.generationId)) {
    fail("IDENTITY_MISMATCH", "Update has no exact prior Platform Plugin generation evidence.");
  }
  return value.sourceCommit;
}

function trustedRegistrations(
  value: StaticPlatformPluginAuthorizationDescriptorResolverOptions["registrations"]
): ReadonlyMap<string, ScopedRegistrationResult> {
  const entries = value instanceof Map
    ? [...value.entries()].map(([sourceCommit, registration]) => ({ sourceCommit, registration }))
    : value;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > maximumRegistrations) {
    fail("INVALID_INPUT", "Trusted static registration registry must be a bounded non-empty list or map.");
  }
  const result = new Map<string, ScopedRegistrationResult>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !sourceCommitPattern.test(entry.sourceCommit)) {
      fail("INVALID_INPUT", "Trusted static registration source commit is invalid.");
    }
    assertExecutableRegistrationAuthority(entry.registration);
    if (result.has(entry.sourceCommit)) fail("INVALID_INPUT", "Trusted static registration source commits must be unique.");
    result.set(entry.sourceCommit, entry.registration);
  }
  return result;
}

function platformPluginTransition(
  value: AuthorizationLifecycleCommittedTransition,
  applicationId: string
) {
  const parsed = ExtensionLifecycleEventSchema.safeParse(value);
  if (!parsed.success || canonicalJson(parsed.data) !== canonicalJson(value) || parsed.data.deliveryClass !== "platform-plugin") {
    fail("INVALID_INPUT", "Authorization descriptor resolution requires a canonical Platform Plugin lifecycle transition.");
  }
  const event = parsed.data;
  if (event.applicationId !== applicationId) fail("IDENTITY_MISMATCH", "Platform Plugin transition belongs to another application.");
  if (!(["install", "update", "rollback", "disable", "uninstall"] as const).includes(event.operation) || event.operationPhase !== "completed") {
    fail("INVALID_INPUT", "Platform Plugin transition is not a committed authorization lifecycle operation.");
  }
  const lifecycleState = event.operation === "disable" ? "disabled" : event.operation === "uninstall" ? "removed" : "active";
  if (event.lifecycleState !== lifecycleState) fail("INVALID_INPUT", "Platform Plugin transition has no terminal lifecycle state.");
  return event;
}

async function retainedSourceCommit(
  session: Pick<RuntimeExtensionSession, "query">,
  transition: Extract<ReturnType<typeof platformPluginTransition>, { readonly deliveryClass: "platform-plugin" }>
): Promise<string> {
  const result = await session.query<RetainedGenerationRow>(
    "select retained_generation from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3 for key share",
    [transition.applicationId, transition.environment, transition.id]
  );
  const retained = result.rows[0]?.retained_generation;
  if (!record(retained) || retained.authority !== "static-build" ||
    typeof retained.sourceCommit !== "string" || !sourceCommitPattern.test(retained.sourceCommit) ||
    typeof retained.generationId !== "string" || !generationIdPattern.test(retained.generationId)) {
    fail("IDENTITY_MISMATCH", "Static uninstall has no exact retained Platform Plugin generation evidence.");
  }
  return retained.sourceCommit;
}

function descriptorsForPlugin(registration: ScopedRegistrationResult, pluginId: string): readonly AuthorizationPermissionDescriptor[] {
  const descriptors = registration.contributions.permissions
    .filter((contribution) => contribution.pluginId === pluginId)
    .map(({ value }) => {
      const parsed = AuthorizationPermissionDescriptorSchema.safeParse(value);
      if (!parsed.success || parsed.data.publisher.kind !== "extension" ||
        parsed.data.publisher.deliveryClass !== "platform-plugin" || parsed.data.publisher.extensionId !== pluginId) {
        fail("IDENTITY_MISMATCH", "Platform Plugin permission descriptor publisher does not match the transitioned plugin.");
      }
      return parsed.data;
    })
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (descriptors.some(({ id }, index) => index > 0 && descriptors[index - 1]!.id === id)) {
    fail("INVALID_INPUT", "Platform Plugin permission descriptors must be unique by ID.");
  }
  return Object.freeze(descriptors.map((descriptor) => Object.freeze(structuredClone(descriptor))));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: "INVALID_INPUT" | "IDENTITY_MISMATCH", message: string): never {
  throw new AuthorizationLifecycleError(code, message);
}
