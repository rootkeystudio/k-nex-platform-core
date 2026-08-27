import {
  ResourceIdSchema,
  TableFieldIdSchema,
  assertJsonValue,
  canonicalJson,
  createDataSourceQueryIdentity,
  DataSourceQueryControlsSchema,
  type DataSourceAuthorizationBoundary,
  type DataSourceQueryIdentity,
  type DataSourceSurface,
  type DataSourceQueryControls,
  type JsonValue,
  type RuntimeSchema
} from "@k-nex/contracts";

const VIEW_STATE_MAX_BYTES = 16_384;
const forbiddenViewStateKeys = new Set([
  "actor", "actorid", "authorizationboundary", "effectiveactor", "principal", "principalid", "recordscope"
]);

export interface BrowserResourceReference {
  readonly id: string;
  readonly version: number;
}

export interface BrowserProblem {
  readonly code: string;
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly fieldErrors?: readonly { readonly field: string; readonly message: string; readonly code?: string }[];
}

export type BrowserTransportResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly problem: BrowserProblem };

export interface BrowserDataTransport {
  query(request: {
    readonly source: BrowserResourceReference;
    readonly input: unknown;
    readonly selectedFields: readonly string[];
    readonly controls?: DataSourceQueryControls;
    readonly surface: DataSourceSurface;
    readonly signal: AbortSignal;
  }): Promise<BrowserTransportResult>;
  mutate(request: {
    readonly action: BrowserResourceReference;
    readonly input: unknown;
    readonly idempotencyKey?: string;
    readonly signal: AbortSignal;
  }): Promise<BrowserTransportResult>;
}

export type BrowserRequestState<T> =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "success"; readonly data: T }
  | { readonly state: "empty" }
  | { readonly state: "forbidden"; readonly problem: BrowserProblem }
  | { readonly state: "rate-limited"; readonly problem: BrowserProblem }
  | { readonly state: "invalid-contract" }
  | { readonly state: "cancelled" }
  | { readonly state: "error"; readonly problem: BrowserProblem };

export interface BrowserQueryContext {
  readonly surface: DataSourceSurface;
  readonly locale?: string | null;
  readonly timezone?: string | null;
  readonly publicationRevision?: string | null;
  readonly authorizationBoundary: DataSourceAuthorizationBoundary;
  readonly signal: AbortSignal;
}

export interface BrowserMutationContext {
  readonly signal: AbortSignal;
  readonly idempotencyKey?: string;
}

export interface SourceQueryOptions<TInput, TOutput> {
  readonly source: BrowserResourceReference;
  readonly input: RuntimeSchema<TInput>;
  readonly output: RuntimeSchema<TOutput>;
  readonly defaults: TInput;
  readonly selectedFields?: readonly string[];
  readonly isEmpty?: (value: TOutput) => boolean;
}

export interface SourceQueryDefinition<TInput, TOutput> {
  readonly kind: "source-query";
  readonly source: BrowserResourceReference;
  readonly defaults: TInput;
  readonly selectedFields: readonly string[];
  readonly invalidation: { readonly sources: readonly string[] };
  identity(input: TInput, context: Omit<BrowserQueryContext, "signal">): Promise<DataSourceQueryIdentity>;
  identityWithControls(input: TInput, controls: DataSourceQueryControls, context: Omit<BrowserQueryContext, "signal">): Promise<DataSourceQueryIdentity>;
  execute(transport: BrowserDataTransport, input: TInput, context: BrowserQueryContext): Promise<BrowserRequestState<TOutput>>;
  executeWithControls(transport: BrowserDataTransport, input: TInput, controls: DataSourceQueryControls, context: BrowserQueryContext): Promise<BrowserRequestState<TOutput>>;
}

export interface ActionMutationOptions<TInput, TOutput> {
  readonly action: BrowserResourceReference;
  readonly input: RuntimeSchema<TInput>;
  readonly output: RuntimeSchema<TOutput>;
  readonly invalidates: readonly string[];
}

export interface ActionMutationDefinition<TInput, TOutput> {
  readonly kind: "action-mutation";
  readonly action: BrowserResourceReference;
  readonly invalidation: { readonly sources: readonly string[] };
  execute(transport: BrowserDataTransport, input: TInput, context: BrowserMutationContext): Promise<BrowserRequestState<TOutput>>;
}

function validReference(value: BrowserResourceReference): boolean {
  return ResourceIdSchema.safeParse(value.id).success && Number.isSafeInteger(value.version) && value.version > 0;
}

function validSchema(value: unknown): value is RuntimeSchema {
  return typeof value === "object" && value !== null && typeof (value as RuntimeSchema).safeParse === "function";
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

async function request(transportCall: () => Promise<BrowserTransportResult>, signal: AbortSignal): Promise<BrowserTransportResult | undefined> {
  if (signal.aborted) return undefined;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: BrowserTransportResult | undefined): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      transportCall().then((result) => finish(result), () => finish(signal.aborted ? undefined : { ok: false, problem: { code: "BROWSER_TRANSPORT_FAILED", status: 503 } }));
    } catch {
      finish(signal.aborted ? undefined : { ok: false, problem: { code: "BROWSER_TRANSPORT_FAILED", status: 503 } });
    }
  });
}

function resultState<T>(result: BrowserTransportResult | undefined, output: RuntimeSchema<T>, isEmpty?: (value: T) => boolean): BrowserRequestState<T> {
  if (result === undefined) return freeze({ state: "cancelled" });
  if (!result.ok) {
    if (result.problem.status === 403) return freeze({ state: "forbidden", problem: result.problem });
    if (result.problem.status === 429) return freeze({ state: "rate-limited", problem: result.problem });
    return freeze({ state: "error", problem: result.problem });
  }
  const parsed = output.safeParse(result.data);
  if (!parsed.success) return freeze({ state: "invalid-contract" });
  if (isEmpty?.(parsed.data)) return freeze({ state: "empty" });
  return freeze({ state: "success", data: parsed.data });
}

export function defineSourceQuery<TInput, TOutput>(options: SourceQueryOptions<TInput, TOutput>): SourceQueryDefinition<TInput, TOutput> {
  if (!validReference(options.source) || !validSchema(options.input) || !validSchema(options.output)) throw new TypeError("Source query definition is invalid.");
  const defaults = options.input.safeParse(options.defaults);
  if (!defaults.success) throw new TypeError("Source query defaults do not satisfy the input contract.");
  assertJsonValue(defaults.data);
  inspectViewState(defaults.data);
  const selectedFields = [...(options.selectedFields ?? [])];
  if (new Set(selectedFields).size !== selectedFields.length || selectedFields.some((field) => !TableFieldIdSchema.safeParse(field).success)) {
    throw new TypeError("Source query selected fields are invalid.");
  }
  const source = freeze({ ...options.source });
  const identity = (input: TInput, controls: DataSourceQueryControls | undefined, context: Omit<BrowserQueryContext, "signal">): Promise<DataSourceQueryIdentity> => {
    const parsed = options.input.safeParse(input);
    const parsedControls = controls === undefined ? undefined : DataSourceQueryControlsSchema.safeParse(controls);
    if (!parsed.success || parsedControls !== undefined && !parsedControls.success) return Promise.reject(new TypeError("Source query identity is invalid."));
    try {
      assertJsonValue(parsed.data);
      inspectViewState(parsed.data);
    } catch (error) {
      return Promise.reject(error);
    }
    const identityInput = parsedControls === undefined ? parsed.data : { input: parsed.data, controls: parsedControls.data };
    return createDataSourceQueryIdentity({
      source,
      input: identityInput as JsonValue,
      selectedFields,
      surface: context.surface,
      locale: context.locale ?? null,
      timezone: context.timezone ?? null,
      publicationRevision: context.publicationRevision ?? null,
      authorizationBoundary: context.authorizationBoundary
    });
  };
  const execute = async (transport: BrowserDataTransport, input: TInput, controls: DataSourceQueryControls | undefined, context: BrowserQueryContext): Promise<BrowserRequestState<TOutput>> => {
    const parsed = options.input.safeParse(input);
    if (!parsed.success) return freeze({ state: "invalid-contract" as const });
    const parsedControls = controls === undefined ? undefined : DataSourceQueryControlsSchema.safeParse(controls);
    if (parsedControls !== undefined && !parsedControls.success) return freeze({ state: "invalid-contract" as const });
    try {
      assertJsonValue(parsed.data);
      inspectViewState(parsed.data);
    } catch {
      return freeze({ state: "invalid-contract" as const });
    }
    const response = await request(() => transport.query({
      source,
      input: parsed.data,
      selectedFields,
      ...(parsedControls === undefined ? {} : { controls: parsedControls.data }),
      surface: context.surface,
      signal: context.signal
    }), context.signal);
    return resultState(response, options.output, options.isEmpty);
  };
  return freeze({
    kind: "source-query" as const,
    source,
    defaults: structuredClone(defaults.data),
    selectedFields: freeze(selectedFields),
    invalidation: freeze({ sources: [source.id] }),
    identity(input: TInput, context: Omit<BrowserQueryContext, "signal">) { return identity(input, undefined, context); },
    identityWithControls(input: TInput, controls: DataSourceQueryControls, context: Omit<BrowserQueryContext, "signal">) { return identity(input, controls, context); },
    execute(transport: BrowserDataTransport, input: TInput, context: BrowserQueryContext) { return execute(transport, input, undefined, context); },
    executeWithControls(transport: BrowserDataTransport, input: TInput, controls: DataSourceQueryControls, context: BrowserQueryContext) { return execute(transport, input, controls, context); }
  });
}

export function defineActionMutation<TInput, TOutput>(options: ActionMutationOptions<TInput, TOutput>): ActionMutationDefinition<TInput, TOutput> {
  if (!validReference(options.action) || !validSchema(options.input) || !validSchema(options.output) ||
    new Set(options.invalidates).size !== options.invalidates.length || options.invalidates.some((id) => !ResourceIdSchema.safeParse(id).success)) {
    throw new TypeError("Action mutation definition is invalid.");
  }
  const action = freeze({ ...options.action });
  const invalidates = freeze([...options.invalidates].sort());
  return freeze({
    kind: "action-mutation" as const,
    action,
    invalidation: freeze({ sources: invalidates }),
    async execute(transport: BrowserDataTransport, input: TInput, context: BrowserMutationContext) {
      const parsed = options.input.safeParse(input);
      if (!parsed.success) return freeze({ state: "invalid-contract" as const });
      const response = await request(() => transport.mutate({
        action,
        input: parsed.data,
        ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }),
        signal: context.signal
      }), context.signal);
      return resultState(response, options.output);
    }
  });
}

function inspectViewState(value: JsonValue): void {
  if (Array.isArray(value)) {
    for (const item of value) inspectViewState(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenViewStateKeys.has(key.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase())) {
      throw new TypeError("View state cannot contain actor or record authorization scope.");
    }
    inspectViewState(child);
  }
}

export function serializeBrowserViewState(value: unknown): string {
  assertJsonValue(value);
  inspectViewState(value);
  const bytes = new TextEncoder().encode(canonicalJson(value));
  if (bytes.byteLength > VIEW_STATE_MAX_BYTES) throw new RangeError("Browser view state exceeds the platform limit.");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `v1.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

export function deserializeBrowserViewState(value: string): JsonValue {
  if (!/^v1\.[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("Browser view state encoding is invalid.");
  const encoded = value.slice(3).replaceAll("-", "+").replaceAll("_", "/");
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new TypeError("Browser view state encoding is invalid.");
  }
  if (binary.length > VIEW_STATE_MAX_BYTES) throw new RangeError("Browser view state exceeds the platform limit.");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    assertJsonValue(parsed);
    inspectViewState(parsed);
  } catch {
    throw new TypeError("Browser view state payload is invalid.");
  }
  return freeze(parsed);
}
