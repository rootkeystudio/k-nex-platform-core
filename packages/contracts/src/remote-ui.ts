import * as z from "zod";

import type { JsonValue } from "./canonical-json.js";
import { HotApplicationConcreteRouteSchema } from "./extension-runtime.js";
import { HotApplicationIdSchema, ResourceIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

export const remoteUiCeilings = Object.freeze({
  canonicalBytes: 262_144,
  jsonDepth: 24,
  nodeDepth: 16,
  totalNodes: 512,
  childrenPerNode: 64,
  propsPerNode: 64,
  eventsPerNode: 8,
  stringBytes: 4_096,
  callsPerMinute: 240
} as const);

const recordId = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const nodeId = z.string().regex(/^[a-z][a-z0-9_-]{0,127}$/u);
const componentId = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u).max(128);
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string().max(remoteUiCeilings.stringBytes), z.number().finite(), z.boolean(), z.null(),
  z.array(jsonValue).max(128), z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u), jsonValue)
]));
const props = z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/u).max(64), jsonValue).check((context) => {
  if (Object.keys(context.value).length > remoteUiCeilings.propsPerNode) context.issues.push({ code: "custom", input: context.value, message: "Remote UI props exceed their key limit." });
}).meta({ maxProperties: remoteUiCeilings.propsPerNode });

export type RemoteUiNode = Readonly<{
  nodeId: string;
  component: string;
  props: Readonly<Record<string, JsonValue>>;
  events: readonly Readonly<{ event: "press" | "change" | "submit" | "selection-change"; handlerId: string }>[];
  children: readonly RemoteUiNode[];
}>;

export const RemoteUiNodeSchema: z.ZodType<RemoteUiNode> = z.lazy(() => z.strictObject({
  nodeId,
  component: componentId,
  props,
  events: uniqueArray(z.strictObject({ event: z.enum(["press", "change", "submit", "selection-change"]), handlerId: ResourceIdSchema })).max(remoteUiCeilings.eventsPerNode),
  children: z.array(RemoteUiNodeSchema).max(remoteUiCeilings.childrenPerNode)
}));

const common = {
  schemaVersion: z.literal(1),
  sessionId: recordId,
  appId: HotApplicationIdSchema,
  generationId: recordId,
  sequence: z.number().int().positive().max(1_000_000_000)
} as const;

export const RemoteUiFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...common, direction: z.literal("realm-to-host"), type: z.literal("ready") }),
  z.strictObject({ ...common, direction: z.literal("realm-to-host"), type: z.literal("render"), root: RemoteUiNodeSchema }),
  z.strictObject({ ...common, direction: z.literal("realm-to-host"), type: z.literal("request"), operation: z.enum(["source", "action"]), requestId: recordId, targetId: ResourceIdSchema, input: jsonValue }),
  z.strictObject({ ...common, direction: z.literal("realm-to-host"), type: z.literal("navigate"), route: HotApplicationConcreteRouteSchema }),
  z.strictObject({ ...common, direction: z.literal("realm-to-host"), type: z.literal("focus"), nodeId }),
  z.strictObject({ ...common, direction: z.literal("realm-to-host"), type: z.literal("failure"), code: z.enum(["APP_BOOT_FAILED", "APP_RENDER_FAILED", "APP_EVENT_FAILED"]) }),
  z.strictObject({ ...common, direction: z.literal("host-to-realm"), type: z.literal("bootstrap"), route: HotApplicationConcreteRouteSchema, surface: ResourceIdSchema }),
  z.strictObject({ ...common, direction: z.literal("host-to-realm"), type: z.literal("event"), nodeId, event: z.enum(["press", "change", "submit", "selection-change"]), handlerId: ResourceIdSchema, payload: jsonValue }),
  z.strictObject({ ...common, direction: z.literal("host-to-realm"), type: z.literal("response-ok"), requestId: recordId, output: jsonValue }),
  z.strictObject({ ...common, direction: z.literal("host-to-realm"), type: z.literal("response-error"), requestId: recordId, code: z.enum(["UNAUTHORIZED", "TARGET_UNAVAILABLE", "REQUEST_INVALID", "REQUEST_FAILED"]) }),
  z.strictObject({ ...common, direction: z.literal("host-to-realm"), type: z.literal("dispose"), reason: z.enum(["authorization-revoked", "generation-retired", "session-ended", "protocol-failure"]) })
]).meta({ $id: "https://schemas.k-nex.dev/remote-ui-frame/v1.json", title: "K-Nex Remote UI Frame v1" });

export type RemoteUiFrame = z.output<typeof RemoteUiFrameSchema>;
