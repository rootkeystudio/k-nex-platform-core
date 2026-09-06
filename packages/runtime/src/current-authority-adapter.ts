import { AuthorizationDecisionSchema, canonicalJson, type AuthorizationDecision } from "@k-nex/contracts";

import {
  createEffectiveAuthorizationRequest,
  isTrustedAuthorizationSession,
  type EffectiveAuthorityResolver,
  type TrustedAuthorizationSession
} from "./effective-authority.js";

export interface CurrentAuthoritySessionProvider<TContext> {
  current(context: TContext, signal: AbortSignal): TrustedAuthorizationSession | undefined | Promise<TrustedAuthorizationSession | undefined>;
}

export interface CurrentAuthorityTarget {
  readonly permissionId: string;
  readonly scope: unknown;
  readonly facts: unknown;
}

const targets = new WeakSet<object>();

function exactTarget(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== "facts\0permissionId\0scope") {
    throw new TypeError("Current authority targets contain only server-selected permission, scope, and facts.");
  }
  return value as Readonly<Record<string, unknown>>;
}

async function digest(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function same(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left) === canonicalJson(right); } catch { return false; }
}

function sameOptional(left: unknown, right: unknown): boolean {
  return left === undefined || right === undefined ? left === right : same(left, right);
}

async function untilAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return undefined;
  return new Promise((resolve) => {
    const abort = () => finish(undefined);
    const finish = (value: T | undefined) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then((value) => finish(value), () => finish(undefined));
  });
}

/** Mints a closed, host-selected permission target; clients cannot supply actor or delegation data. */
export function createCurrentAuthorityTarget(value: unknown): CurrentAuthorityTarget {
  const input = exactTarget(value);
  const request = createEffectiveAuthorizationRequest({
    schemaVersion: 1,
    decisionId: "current-authority-target",
    permissionId: input.permissionId,
    scope: input.scope,
    facts: input.facts
  });
  const target = Object.freeze({ permissionId: request.permissionId, scope: request.scope, facts: request.facts });
  targets.add(target);
  return target;
}

export function isCurrentAuthorityTarget(value: unknown): value is CurrentAuthorityTarget {
  return typeof value === "object" && value !== null && targets.has(value);
}

/**
 * Small common adapter for boundary-specific policy ports.  It owns no
 * gateway semantics: callers choose a branded, server-derived target and use
 * `allows` before admitting work.
 */
export class CurrentAuthorityAdapter<TContext> {
  private closed = false;
  private readonly deadlines = new Set<AbortController>();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly sessions: CurrentAuthoritySessionProvider<TContext>,
    private readonly authority: Pick<EffectiveAuthorityResolver, "authorize">,
    private readonly deadlineMs = 1_000
  ) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 5_000) throw new TypeError("Current authority deadline is invalid.");
  }

  /** Stops new policy admission, aborts adapter-owned waits, then joins raw dependency work. */
  async drain(): Promise<void> {
    this.closed = true;
    for (const deadline of this.deadlines) deadline.abort();
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation.then(
      () => { this.pending.delete(operation); },
      () => { this.pending.delete(operation); }
    );
    return operation;
  }

  async authorize(context: TContext, target: CurrentAuthorityTarget, signal: AbortSignal = new AbortController().signal): Promise<AuthorizationDecision | undefined> {
    if (!isCurrentAuthorityTarget(target) || signal.aborted || this.closed) return undefined;
    const deadline = new AbortController();
    const abort = () => deadline.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, this.deadlineMs);
    this.deadlines.add(deadline);
    try {
      const session = await untilAbort(this.track(Promise.resolve().then(() => this.sessions.current(context, deadline.signal))), deadline.signal);
      if (!session || !isTrustedAuthorizationSession(session) || deadline.signal.aborted || this.closed) return undefined;
      const request = createEffectiveAuthorizationRequest({
        schemaVersion: 1,
        decisionId: await digest({
          applicationId: session.applicationId,
          environment: session.environment,
          correlationId: session.correlationId,
          principal: session.principal,
          effectiveActor: session.effectiveActor,
          delegationId: session.delegation?.delegationId ?? null,
          permissionId: target.permissionId,
          scope: target.scope,
          facts: target.facts
        }),
        permissionId: target.permissionId,
        scope: target.scope,
        facts: target.facts
      });
      if (deadline.signal.aborted || this.closed) return undefined;
      const decision = await untilAbort(this.track(Promise.resolve().then(() => this.authority.authorize(session, request, deadline.signal))), deadline.signal);
      const parsed = AuthorizationDecisionSchema.safeParse(decision);
      if (!parsed.success || deadline.signal.aborted || this.closed || parsed.data.decisionId !== request.decisionId ||
        parsed.data.applicationId !== session.applicationId || parsed.data.environment !== session.environment ||
        parsed.data.correlationId !== session.correlationId || parsed.data.permissionId !== target.permissionId ||
        !same(parsed.data.scope, target.scope) || !same(parsed.data.principal, session.principal) ||
        !same(parsed.data.effectiveActor, session.effectiveActor) || !sameOptional(parsed.data.delegation, session.delegation)) return undefined;
      return parsed.data;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      this.deadlines.delete(deadline);
    }
  }

  async allows(context: TContext, target: CurrentAuthorityTarget, signal?: AbortSignal): Promise<boolean> {
    return (await this.authorize(context, target, signal))?.outcome === "allow";
  }
}
