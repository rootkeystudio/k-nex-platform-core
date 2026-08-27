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

export function createFormController<TValues extends object, TOutput>(options: FormControllerOptions<TValues, TOutput>) {
  const initialValues = freeze(structuredClone(options.initialValues));
  const initial = (): FormSnapshot<TValues> => freeze({ values: structuredClone(initialValues), initialValues, fieldErrors: emptyErrors<TValues>(), dirty: false, submitting: false });
  return Object.freeze({
    initial,
    change<TKey extends keyof TValues>(snapshot: FormSnapshot<TValues>, field: TKey, value: TValues[TKey]): FormSnapshot<TValues> {
      const values = freeze({ ...snapshot.values, [field]: value }) as Readonly<TValues>;
      const fieldErrors = Object.fromEntries(Object.entries(snapshot.fieldErrors).filter(([key]) => key !== String(field))) as FormFieldErrors<TValues>;
      return freeze({ ...withoutFormError(snapshot), values, fieldErrors, dirty: JSON.stringify(values) !== JSON.stringify(initialValues) });
    },
    async submit(snapshot: FormSnapshot<TValues>, signal: AbortSignal): Promise<FormSnapshot<TValues>> {
      const fieldErrors = freeze({ ...options.validate(snapshot.values) });
      if (Object.keys(fieldErrors).length > 0) return freeze({ ...withoutFormError(snapshot), fieldErrors, submitting: false });
      const result = await options.submit(snapshot.values, signal);
      if (result.state === "success") return freeze({ values: structuredClone(snapshot.values), initialValues: structuredClone(snapshot.values), fieldErrors: emptyErrors<TValues>(), dirty: false, submitting: false });
      if (result.state === "cancelled") return freeze({ ...snapshot, submitting: false });
      if ("problem" in result) return freeze({ ...snapshot, fieldErrors: problemErrors<TValues>(result.problem, snapshot.values), formError: result.problem.code, submitting: false });
      return freeze({ ...snapshot, fieldErrors: emptyErrors<TValues>(), formError: result.state === "invalid-contract" ? "FORM_INVALID_CONTRACT" : "FORM_SUBMISSION_FAILED", submitting: false });
    }
  });
}

export const formEngineDecision = Object.freeze({
  engine: "native-react-state" as const,
  reason: "The bounded Sales create/edit spike needs one-level values, synchronous contract validation, action submission, dirty state, and RFC 9457 mapping; an additional form engine would add no required capability.",
  reconsiderWhen: Object.freeze(["nested repeatable values", "cross-field async validation graph", "measured render bottleneck"])
});
