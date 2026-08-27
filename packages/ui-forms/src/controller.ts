import type { BrowserProblem, BrowserRequestState } from "@k-nex/ui-runtime";

export type FormFieldErrors<TValues extends object> = Readonly<Partial<Record<keyof TValues, string>>>;

export interface FormSnapshot<TValues extends object> {
  readonly values: Readonly<TValues>;
  readonly initialValues: Readonly<TValues>;
  readonly fieldErrors: FormFieldErrors<TValues>;
  readonly formError?: string;
  readonly dirty: boolean;
  readonly submitting: boolean;
}

export interface FormControllerOptions<TValues extends object, TOutput> {
  readonly initialValues: TValues;
  readonly validate: (values: Readonly<TValues>) => FormFieldErrors<TValues>;
  readonly submit: (values: Readonly<TValues>, signal: AbortSignal) => Promise<BrowserRequestState<TOutput>>;
}

export interface FormController<TValues extends object, TOutput> {
  initial(): FormSnapshot<TValues>;
  snapshot(): FormSnapshot<TValues>;
  subscribe(listener: (snapshot: FormSnapshot<TValues>) => void): () => void;
  change<TKey extends keyof TValues>(snapshot: FormSnapshot<TValues>, field: TKey, value: TValues[TKey]): FormSnapshot<TValues>;
  submit(snapshot: FormSnapshot<TValues>, signal: AbortSignal): Promise<FormSnapshot<TValues>>;
}

function emptyErrors<TValues extends object>(): FormFieldErrors<TValues> {
  return Object.freeze({}) as FormFieldErrors<TValues>;
}

function withoutFormError<TValues extends object>(snapshot: FormSnapshot<TValues>): Omit<FormSnapshot<TValues>, "formError"> {
  const { formError: _formError, ...rest } = snapshot;
  return rest;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function problemErrors<TValues extends object>(problem: BrowserProblem, values: Readonly<TValues>): FormFieldErrors<TValues> {
  const errors: Record<string, string> = {};
  for (const { field, message } of problem.fieldErrors ?? []) {
    if (Object.hasOwn(values, field) && message.length > 0 && message.length <= 512) errors[field] = message;
  }
  return freeze(errors) as FormFieldErrors<TValues>;
}

export function createFormController<TValues extends object, TOutput>(options: FormControllerOptions<TValues, TOutput>): FormController<TValues, TOutput> {
  const initialValues = freeze(structuredClone(options.initialValues));
  const initial = (): FormSnapshot<TValues> => freeze({ values: structuredClone(initialValues), initialValues, fieldErrors: emptyErrors<TValues>(), dirty: false, submitting: false });
  let current = initial();
  let inFlight: Promise<FormSnapshot<TValues>> | undefined;
  const listeners = new Set<(snapshot: FormSnapshot<TValues>) => void>();
  const publish = (snapshot: FormSnapshot<TValues>): FormSnapshot<TValues> => {
    current = snapshot;
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };
  return Object.freeze({
    initial,
    snapshot: () => current,
    subscribe(listener: (snapshot: FormSnapshot<TValues>) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change<TKey extends keyof TValues>(snapshot: FormSnapshot<TValues>, field: TKey, value: TValues[TKey]): FormSnapshot<TValues> {
      const values = freeze({ ...snapshot.values, [field]: value }) as Readonly<TValues>;
      const fieldErrors = Object.fromEntries(Object.entries(snapshot.fieldErrors).filter(([key]) => key !== String(field))) as FormFieldErrors<TValues>;
      return publish(freeze({ ...withoutFormError(snapshot), values, fieldErrors, dirty: JSON.stringify(values) !== JSON.stringify(initialValues) }));
    },
    submit(snapshot: FormSnapshot<TValues>, signal: AbortSignal): Promise<FormSnapshot<TValues>> {
      if (inFlight !== undefined) return inFlight;
      const fieldErrors = freeze({ ...options.validate(snapshot.values) });
      if (Object.keys(fieldErrors).length > 0) return Promise.resolve(publish(freeze({ ...withoutFormError(snapshot), fieldErrors, submitting: false })));
      publish(freeze({ ...withoutFormError(snapshot), fieldErrors, submitting: true }));
      let submission: Promise<FormSnapshot<TValues>> | undefined;
      submission = (async (): Promise<FormSnapshot<TValues>> => {
        try {
          const result = await options.submit(snapshot.values, signal);
          if (result.state === "success") return publish(freeze({ values: structuredClone(snapshot.values), initialValues: structuredClone(snapshot.values), fieldErrors: emptyErrors<TValues>(), dirty: false, submitting: false }));
          if (result.state === "cancelled") return publish(freeze({ ...snapshot, submitting: false }));
          if ("problem" in result) return publish(freeze({ ...snapshot, fieldErrors: problemErrors<TValues>(result.problem, snapshot.values), formError: result.problem.code, submitting: false }));
          return publish(freeze({ ...snapshot, fieldErrors: emptyErrors<TValues>(), formError: result.state === "invalid-contract" ? "FORM_INVALID_CONTRACT" : "FORM_SUBMISSION_FAILED", submitting: false }));
        } catch {
          return publish(freeze({ ...snapshot, fieldErrors: emptyErrors<TValues>(), formError: "FORM_SUBMISSION_FAILED", submitting: false }));
        } finally {
          if (inFlight === submission) inFlight = undefined;
        }
      })();
      inFlight = submission;
      return submission;
    }
  });
}

export const formEngineDecision = Object.freeze({
  engine: "native-react-state" as const,
  reason: "The bounded Sales create/edit spike needs one-level values, synchronous contract validation, action submission, dirty state, and RFC 9457 mapping; an additional form engine would add no required capability.",
  reconsiderWhen: Object.freeze(["nested repeatable values", "cross-field async validation graph", "measured render bottleneck"])
});
