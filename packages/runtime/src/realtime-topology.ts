import type { RealtimeProcessTopology, RealtimeTopologyIssue } from "@k-nex/contracts";
import { inspectRealtimeTopology, RealtimeProcessTopologyShapeSchema } from "@k-nex/contracts";

export interface RealtimeTopologyDoctorReport {
  readonly issues: readonly RealtimeTopologyIssue[];
  readonly ok: boolean;
  readonly topology: RealtimeProcessTopology;
}

export class RealtimeTopologyError extends Error {
  readonly code = "INCOMPATIBLE_REALTIME_TOPOLOGY";
  readonly issues: readonly RealtimeTopologyIssue[];

  constructor(issues: readonly RealtimeTopologyIssue[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.publicationPath}. Remedies: ${issue.remedies.join("; ")}.`).join(" "));
    this.name = "RealtimeTopologyError";
    this.issues = issues;
  }
}

export function doctorRealtimeTopology(value: unknown): RealtimeTopologyDoctorReport {
  const topology = RealtimeProcessTopologyShapeSchema.parse(value);
  const issues = inspectRealtimeTopology(topology);
  return Object.freeze({ topology, ok: issues.length === 0, issues });
}

export function assertRealtimeTopologyCompatible(value: unknown): RealtimeProcessTopology {
  const report = doctorRealtimeTopology(value);
  if (!report.ok) throw new RealtimeTopologyError(report.issues);
  return report.topology;
}
