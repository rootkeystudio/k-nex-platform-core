import * as z from "zod";

export const RealtimeProcessTopologyShapeSchema = z.strictObject({
  adapter: z.enum(["memory", "distributed"]),
  webInstances: z.number().int().min(1).max(1_024),
  worker: z.enum(["embedded", "separate"]),
  workerInvalidationPath: z.enum(["none", "direct", "postgres-outbox-relay"]),
  realtimeGateway: z.enum(["embedded", "separate"]),
  rollingDeployment: z.enum(["stop-before-start", "overlap"])
});

export type RealtimeProcessTopology = z.infer<typeof RealtimeProcessTopologyShapeSchema>;

export type RealtimeTopologyIssueCode =
  | "MEMORY_MULTIPLE_WEB_INSTANCES"
  | "MEMORY_SEPARATE_WORKER_PUBLISHER"
  | "MEMORY_SEPARATE_GATEWAY"
  | "MEMORY_ROLLING_OVERLAP";

export interface RealtimeTopologyIssue {
  readonly code: RealtimeTopologyIssueCode;
  readonly publicationPath: string;
  readonly remedies: readonly string[];
}

const distributedRemedy = "select a distributed Socket.IO adapter/backplane";

export function inspectRealtimeTopology(topology: RealtimeProcessTopology): readonly RealtimeTopologyIssue[] {
  const issues: RealtimeTopologyIssue[] = [];
  const add = (code: RealtimeTopologyIssueCode, publicationPath: string, remedy: string): void => {
    issues.push(Object.freeze({ code, publicationPath, remedies: Object.freeze([remedy, distributedRemedy]) }));
  };

  if (topology.adapter === "memory") {
    if (topology.webInstances > 1) {
      add("MEMORY_MULTIPLE_WEB_INSTANCES", `${topology.webInstances} web instances -> process-local socket rooms`, "set webInstances to 1");
    }
    if (topology.worker === "separate" && topology.workerInvalidationPath === "direct") {
      add("MEMORY_SEPARATE_WORKER_PUBLISHER", "separate worker -> direct invalidation -> web-owned socket rooms", "embed the worker publication path in the socket-owning web process");
    }
    if (topology.realtimeGateway === "separate") {
      add("MEMORY_SEPARATE_GATEWAY", "web/worker publication -> separate realtime gateway -> process-local socket rooms", "embed the realtime gateway and every direct publisher in one web process");
    }
    if (topology.rollingDeployment === "overlap") {
      add("MEMORY_ROLLING_OVERLAP", "old and new web revisions overlap -> disjoint process-local socket rooms", "use stop-before-start deployment with one socket owner");
    }
  }

  return Object.freeze(issues);
}

export const RealtimeProcessTopologySchema = RealtimeProcessTopologyShapeSchema.superRefine((topology, context) => {
  for (const issue of inspectRealtimeTopology(topology)) {
    context.addIssue({
      code: "custom",
      message: `${issue.code}: ${issue.publicationPath}. Remedies: ${issue.remedies.join("; ")}.`
    });
  }
});
