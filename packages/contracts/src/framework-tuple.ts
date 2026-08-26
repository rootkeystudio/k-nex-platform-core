import * as z from "zod";

export const supportedFrameworkTuple = Object.freeze({
  core: "1.0.0",
  payload: "3.88.0",
  node: "24.19.0",
  pnpm: "11.9.0",
  payloadDatabaseAdapter: "postgres"
} as const);

export const SupportedFrameworkTupleSchema = z.strictObject({
  core: z.literal(supportedFrameworkTuple.core),
  payload: z.literal(supportedFrameworkTuple.payload),
  node: z.literal(supportedFrameworkTuple.node),
  pnpm: z.literal(supportedFrameworkTuple.pnpm),
  payloadDatabaseAdapter: z.literal(supportedFrameworkTuple.payloadDatabaseAdapter)
});

export type SupportedFrameworkTuple = z.infer<typeof SupportedFrameworkTupleSchema>;
export type PluginFrameworkTuple = Pick<SupportedFrameworkTuple, "core" | "payload" | "node" | "payloadDatabaseAdapter">;
