import { canonicalJson } from "@k-nex/contracts";

import { ToolGatewayError, type ToolApprovalEvaluator, type ToolExecutionContext } from "./tool-gateway.js";

export const toolApprovalLimits = Object.freeze({
  maxIdLength: 128,
  maxLifetimeMs: 15 * 60 * 1000,
  maxRecords: 10_000
} as const);

export interface ToolApprovalClock {
  now(): number;
}

export interface ToolApprovalBinding {
  readonly principalId: string;
  readonly agentSessionId: string;
  readonly approvalId?: string;
}

export interface ToolApprovalBindingResolver {
  resolve(context: ToolExecutionContext): ToolApprovalBinding;
}

export interface ToolApprovalSubmission {
  readonly id: string;
  readonly decision: "approve";
  readonly expiresAtEpochMs: number;
}

export interface ToolApprovalIssuer {
  authorize(context: ToolExecutionContext, submission: ToolApprovalSubmission): boolean | Promise<boolean>;
}

interface ApprovalRecord {
  readonly id: string;
  readonly toolId: string;
  readonly toolVersion: number;
  readonly inputDigest: string;
  readonly principalId: string;
  readonly agentSessionId: string;
  readonly expiresAtEpochMs: number;
  used: boolean;
}

function approvalError(code: string, message: string): ToolGatewayError {
  return new ToolGatewayError(code, 403, message);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= toolApprovalLimits.maxIdLength &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function parseSubmission(value: unknown): ToolApprovalSubmission {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw approvalError("APPROVAL_INVALID", "Approval is invalid.");
  }
  if (Object.keys(value).sort().join("\u0000") !== "decision\u0000expiresAtEpochMs\u0000id") {
    throw approvalError("APPROVAL_INVALID", "Approval is invalid.");
  }
  const candidate = value as Partial<ToolApprovalSubmission>;
  if (!validId(candidate.id) || candidate.decision !== "approve" ||
    typeof candidate.expiresAtEpochMs !== "number" || !Number.isSafeInteger(candidate.expiresAtEpochMs)) {
    throw approvalError("APPROVAL_INVALID", "Approval is invalid.");
  }
  return Object.freeze({ id: candidate.id, decision: "approve", expiresAtEpochMs: candidate.expiresAtEpochMs });
}

async function inputDigest(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(input));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function binding(resolver: ToolApprovalBindingResolver, context: ToolExecutionContext): ToolApprovalBinding {
  const value = resolver.resolve(context);
  if (!validId(value.principalId) || !validId(value.agentSessionId) ||
    (value.approvalId !== undefined && !validId(value.approvalId))) {
    throw approvalError("APPROVAL_CONTEXT_INVALID", "Approval context is invalid.");
  }
  return value;
}

export class InMemoryToolApprovalEvaluator implements ToolApprovalEvaluator {
  private readonly records = new Map<string, ApprovalRecord>();

  constructor(
    private readonly clock: ToolApprovalClock,
    private readonly bindings: ToolApprovalBindingResolver,
    private readonly issuer: ToolApprovalIssuer
  ) {}

  async prepare(context: ToolExecutionContext): Promise<unknown> {
    if (context.descriptor.approval === "none") return Object.freeze({ status: "not-required" });
    const subject = binding(this.bindings, context);
    return Object.freeze({
      status: "required",
      tool: Object.freeze({ id: context.descriptor.id, version: context.descriptor.version }),
      inputDigest: await inputDigest(context.input),
      principalId: subject.principalId,
      agentSessionId: subject.agentSessionId
    });
  }

  async submit(context: ToolExecutionContext, value: unknown): Promise<unknown> {
    if (context.descriptor.approval === "none") throw approvalError("APPROVAL_NOT_REQUIRED", "Approval is not required.");
    const submission = parseSubmission(value);
    const now = this.clock.now();
    if (!Number.isSafeInteger(now) || submission.expiresAtEpochMs <= now ||
      submission.expiresAtEpochMs - now > toolApprovalLimits.maxLifetimeMs) {
      throw approvalError("APPROVAL_INVALID", "Approval is invalid.");
    }
    if (this.records.has(submission.id) || this.records.size >= toolApprovalLimits.maxRecords ||
      await this.issuer.authorize(context, submission) !== true) {
      throw approvalError("APPROVAL_DENIED", "Approval was denied.");
    }
    const subject = binding(this.bindings, context);
    this.records.set(submission.id, {
      id: submission.id,
      toolId: context.descriptor.id,
      toolVersion: context.descriptor.version,
      inputDigest: await inputDigest(context.input),
      principalId: subject.principalId,
      agentSessionId: subject.agentSessionId,
      expiresAtEpochMs: submission.expiresAtEpochMs,
      used: false
    });
    return Object.freeze({ status: "approved", id: submission.id, expiresAtEpochMs: submission.expiresAtEpochMs });
  }

  async evaluate(context: ToolExecutionContext): Promise<unknown> {
    if (context.descriptor.approval === "none") return Object.freeze({ status: "not-required" });
    const subject = binding(this.bindings, context);
    const record = subject.approvalId === undefined ? undefined : this.records.get(subject.approvalId);
    const now = this.clock.now();
    if (!Number.isSafeInteger(now)) throw approvalError("APPROVAL_CONTEXT_INVALID", "Approval context is invalid.");
    if (record === undefined || record.used || record.expiresAtEpochMs <= now ||
      record.toolId !== context.descriptor.id || record.toolVersion !== context.descriptor.version ||
      record.principalId !== subject.principalId || record.agentSessionId !== subject.agentSessionId ||
      record.inputDigest !== await inputDigest(context.input)) {
      throw approvalError("APPROVAL_REQUIRED", "A valid per-call approval is required.");
    }
    record.used = true;
    return Object.freeze({ status: "approved", id: record.id });
  }
}
