"use client";

import { useEffect, useId, type FormEvent, type ReactElement, type ReactNode } from "react";

export interface FieldMessages {
  readonly label: string;
  readonly name: string;
  readonly description?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
}

interface FieldIds { readonly input: string; readonly description: string; readonly error: string; }
function useFieldIds(name: string): FieldIds {
  const id = useId().replaceAll(":", "");
  return { input: `${name}-${id}`, description: `${name}-${id}-description`, error: `${name}-${id}-error` };
}

function describedBy(ids: FieldIds, description?: string, error?: string): string | undefined {
  return [description === undefined ? undefined : ids.description, error === undefined ? undefined : ids.error].filter(Boolean).join(" ") || undefined;
}

interface FieldShellProps extends FieldMessages { readonly children: (ids: FieldIds) => ReactNode; readonly component?: string; }
function FieldShell({ children, component = "form-field", ...props }: FieldShellProps): ReactElement {
  const ids = useFieldIds(props.name);
  return <div data-k-nex-component={component} data-slot="root" data-state={props.error === undefined ? props.disabled ? "disabled" : props.readOnly ? "read-only" : "default" : "invalid"}>
    <Label htmlFor={ids.input}>{props.label}</Label>
    {children(ids)}
    {props.description === undefined ? null : <FieldDescription id={ids.description}>{props.description}</FieldDescription>}
    {props.error === undefined ? null : <FieldError id={ids.error}>{props.error}</FieldError>}
  </div>;
}

export interface LabelProps { readonly children: ReactNode; readonly htmlFor?: string; }
export function Label({ children, htmlFor }: LabelProps): ReactElement { return <label htmlFor={htmlFor} data-k-nex-component="label" data-slot="root">{children}</label>; }
export interface MessageProps { readonly children: ReactNode; readonly id?: string; }
export function FieldDescription({ children, id }: MessageProps): ReactElement { return <div id={id} data-k-nex-component="field-description" data-slot="root">{children}</div>; }
export function FieldError({ children, id }: MessageProps): ReactElement { return <div id={id} role="alert" data-k-nex-component="field-error" data-slot="root" data-state="invalid">{children}</div>; }

export interface FormProps { readonly children: ReactNode; readonly label: string; readonly onSubmit: () => void | Promise<void>; readonly pending?: boolean; }
export function Form({ children, label, onSubmit, pending = false }: FormProps): ReactElement {
  const submit = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); void onSubmit(); };
  return <form aria-label={label} aria-busy={pending} onSubmit={submit} data-k-nex-component="form" data-slot="root" data-state={pending ? "pending" : "default"}>{children}</form>;
}

export interface FieldsetProps { readonly children: ReactNode; readonly legend: string; readonly description?: string; readonly disabled?: boolean; }
export function Fieldset({ children, legend, description, disabled = false }: FieldsetProps): ReactElement {
  return <fieldset disabled={disabled} data-k-nex-component="fieldset" data-slot="root" data-state={disabled ? "disabled" : "default"}><legend data-slot="legend">{legend}</legend>{description === undefined ? null : <FieldDescription>{description}</FieldDescription>}{children}</fieldset>;
}

export interface FormFieldProps extends FieldMessages { readonly children: ReactNode; }
export function FormField({ children, ...props }: FormFieldProps): ReactElement { return <FieldShell {...props}>{() => children}</FieldShell>; }

interface StringInputProps extends FieldMessages { readonly value: string; readonly placeholder?: string; readonly autoComplete?: string; readonly onChange: (value: string) => void; }
function StringInput({ type, component, ...props }: StringInputProps & { readonly type: "text" | "password" | "search" | "tel" | "url"; readonly component: string }): ReactElement {
  return <FieldShell {...props} component={component}>{(ids) => <input id={ids.input} name={props.name} type={type} value={props.value} placeholder={props.placeholder} autoComplete={props.autoComplete} required={props.required} disabled={props.disabled} readOnly={props.readOnly} aria-invalid={props.error === undefined ? undefined : true} aria-describedby={describedBy(ids, props.description, props.error)} onChange={(event) => props.onChange(event.currentTarget.value)} data-slot="control" />}</FieldShell>;
}
export function TextInput(props: StringInputProps): ReactElement { return <StringInput {...props} type="text" component="text-input" />; }
export function PasswordInput(props: StringInputProps): ReactElement { return <StringInput {...props} type="password" component="password-input" />; }
export function SearchInput(props: StringInputProps): ReactElement { return <StringInput {...props} type="search" component="search-input" />; }
export function CurrencyInput(props: StringInputProps): ReactElement { return <StringInput {...props} type="text" component="currency-input" />; }
export function PhoneInput(props: StringInputProps): ReactElement { return <StringInput {...props} type="tel" component="phone-input" />; }
export function URLInput(props: StringInputProps): ReactElement { return <StringInput {...props} type="url" component="url-input" />; }

export interface TextareaProps extends StringInputProps { readonly rows?: number; }
export function Textarea(props: TextareaProps): ReactElement {
  return <FieldShell {...props} component="textarea">{(ids) => <textarea id={ids.input} name={props.name} value={props.value} rows={props.rows} placeholder={props.placeholder} required={props.required} disabled={props.disabled} readOnly={props.readOnly} aria-invalid={props.error === undefined ? undefined : true} aria-describedby={describedBy(ids, props.description, props.error)} onChange={(event) => props.onChange(event.currentTarget.value)} data-slot="control" />}</FieldShell>;
}

export interface NumberInputProps extends FieldMessages { readonly value?: number; readonly min?: number; readonly max?: number; readonly step?: number; readonly onChange: (value: number | undefined) => void; }
export function NumberInput(props: NumberInputProps): ReactElement {
  return <FieldShell {...props} component="number-input">{(ids) => <input id={ids.input} name={props.name} type="number" value={props.value ?? ""} min={props.min} max={props.max} step={props.step} required={props.required} disabled={props.disabled} readOnly={props.readOnly} aria-describedby={describedBy(ids, props.description, props.error)} aria-invalid={props.error === undefined ? undefined : true} onChange={(event) => props.onChange(event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber)} data-slot="control" />}</FieldShell>;
}

export interface ChoiceOption { readonly id: string; readonly label: string; readonly disabled?: boolean; }
export interface SelectProps extends FieldMessages { readonly value: string; readonly options: readonly ChoiceOption[]; readonly placeholder?: string; readonly onChange: (value: string) => void; }
export function Select(props: SelectProps): ReactElement {
  return <FieldShell {...props} component="select">{(ids) => <select id={ids.input} name={props.name} value={props.value} required={props.required} disabled={props.disabled} aria-describedby={describedBy(ids, props.description, props.error)} aria-invalid={props.error === undefined ? undefined : true} onChange={(event) => props.onChange(event.currentTarget.value)} data-slot="control">{props.placeholder === undefined ? null : <option value="">{props.placeholder}</option>}{props.options.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.label}</option>)}</select>}</FieldShell>;
}

export interface MultiSelectProps extends Omit<SelectProps, "value" | "onChange" | "placeholder"> { readonly value: readonly string[]; readonly onChange: (value: readonly string[]) => void; }
export function MultiSelect(props: MultiSelectProps): ReactElement {
  return <FieldShell {...props} component="multi-select">{(ids) => <select id={ids.input} name={props.name} value={[...props.value]} multiple required={props.required} disabled={props.disabled} aria-describedby={describedBy(ids, props.description, props.error)} aria-invalid={props.error === undefined ? undefined : true} onChange={(event) => props.onChange([...event.currentTarget.selectedOptions].map(({ value }) => value))} data-slot="control">{props.options.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.label}</option>)}</select>}</FieldShell>;
}

export interface CheckboxProps extends Omit<FieldMessages, "label"> { readonly label: ReactNode; readonly checked: boolean; readonly onChange: (checked: boolean) => void; }
export function Checkbox(props: CheckboxProps): ReactElement {
  const ids = useFieldIds(props.name);
  return <div data-k-nex-component="checkbox" data-slot="root" data-state={props.error === undefined ? props.checked ? "selected" : props.disabled ? "disabled" : "default" : "invalid"}><label htmlFor={ids.input}><input id={ids.input} name={props.name} type="checkbox" checked={props.checked} required={props.required} disabled={props.disabled} aria-invalid={props.error === undefined ? undefined : true} aria-describedby={describedBy(ids, props.description, props.error)} onChange={(event) => props.onChange(event.currentTarget.checked)} data-slot="control" />{props.label}</label>{props.description === undefined ? null : <FieldDescription id={ids.description}>{props.description}</FieldDescription>}{props.error === undefined ? null : <FieldError id={ids.error}>{props.error}</FieldError>}</div>;
}

export interface RadioGroupProps extends FieldMessages { readonly value: string; readonly options: readonly ChoiceOption[]; readonly onChange: (value: string) => void; }
export function RadioGroup(props: RadioGroupProps): ReactElement {
  return <fieldset disabled={props.disabled} data-k-nex-component="radio-group" data-slot="root" data-state={props.error === undefined ? "default" : "invalid"}><legend>{props.label}</legend>{props.options.map((option) => <label key={option.id}><input type="radio" name={props.name} value={option.id} checked={props.value === option.id} disabled={option.disabled} onChange={() => props.onChange(option.id)} data-slot="control" />{option.label}</label>)}{props.description === undefined ? null : <FieldDescription>{props.description}</FieldDescription>}{props.error === undefined ? null : <FieldError>{props.error}</FieldError>}</fieldset>;
}

export interface RadioButtonProps extends Omit<CheckboxProps, "checked" | "onChange"> { readonly value: string; readonly checked: boolean; readonly onChange: (value: string) => void; }
export function RadioButton(props: RadioButtonProps): ReactElement {
  const ids = useFieldIds(props.name);
  return <label htmlFor={ids.input} data-k-nex-component="radio-button" data-slot="root" data-state={props.checked ? "selected" : props.disabled ? "disabled" : "default"}><input id={ids.input} type="radio" name={props.name} value={props.value} checked={props.checked} disabled={props.disabled} onChange={() => props.onChange(props.value)} data-slot="control" />{props.label}</label>;
}

export type ToggleProps = CheckboxProps;
export function Toggle(props: ToggleProps): ReactElement {
  const ids = useFieldIds(props.name);
  return <label htmlFor={ids.input} data-k-nex-component="toggle" data-slot="root" data-state={props.checked ? "selected" : props.disabled ? "disabled" : "default"}><input id={ids.input} name={props.name} type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.checked)} data-slot="control" />{props.label}</label>;
}

export interface ComboboxProps extends StringInputProps { readonly options: readonly ChoiceOption[]; }
export function Combobox(props: ComboboxProps): ReactElement {
  const ids = useFieldIds(props.name);
  const listId = `${ids.input}-options`;
  return <div data-k-nex-component="combobox" data-slot="root" data-state={props.error === undefined ? "default" : "invalid"}><Label htmlFor={ids.input}>{props.label}</Label><input id={ids.input} name={props.name} role="combobox" list={listId} value={props.value} required={props.required} disabled={props.disabled} readOnly={props.readOnly} aria-describedby={describedBy(ids, props.description, props.error)} aria-invalid={props.error === undefined ? undefined : true} onChange={(event) => props.onChange(event.currentTarget.value)} data-slot="control" /><datalist id={listId} data-slot="options">{props.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</datalist>{props.description === undefined ? null : <FieldDescription id={ids.description}>{props.description}</FieldDescription>}{props.error === undefined ? null : <FieldError id={ids.error}>{props.error}</FieldError>}</div>;
}
export function Autocomplete(props: ComboboxProps): ReactElement { return <div data-k-nex-component="autocomplete" data-slot="root"><Combobox {...props} /></div>; }

export interface TagInputProps extends Omit<StringInputProps, "value" | "onChange"> { readonly value: readonly string[]; readonly onChange: (value: readonly string[]) => void; }
export function TagInput(props: TagInputProps): ReactElement {
  const value = props.value.join(", ");
  return <div data-k-nex-component="tag-input" data-slot="root"><TextInput {...props} value={value} onChange={(next) => props.onChange(next.split(",").map((tag) => tag.trim()).filter(Boolean))} /></div>;
}

export interface SliderProps extends Omit<NumberInputProps, "value" | "onChange"> { readonly value: number; readonly onChange: (value: number) => void; }
export function Slider(props: SliderProps): ReactElement {
  return <FieldShell {...props} component="slider">{(ids) => <input id={ids.input} name={props.name} type="range" value={props.value} min={props.min} max={props.max} step={props.step} disabled={props.disabled} aria-describedby={describedBy(ids, props.description, props.error)} onChange={(event) => props.onChange(event.currentTarget.valueAsNumber)} data-slot="control" />}</FieldShell>;
}

export function Stepper(props: NumberInputProps): ReactElement {
  const step = props.step ?? 1;
  return <div data-k-nex-component="stepper" data-slot="root"><NumberInput {...props} /><button type="button" disabled={props.disabled || props.value !== undefined && props.min !== undefined && props.value <= props.min} onClick={() => props.onChange((props.value ?? 0) - step)} data-slot="decrement">−</button><button type="button" disabled={props.disabled || props.value !== undefined && props.max !== undefined && props.value >= props.max} onClick={() => props.onChange((props.value ?? 0) + step)} data-slot="increment">+</button></div>;
}

export interface RatingProps extends Omit<RadioGroupProps, "options" | "value" | "onChange"> { readonly value: number; readonly max?: number; readonly onChange: (value: number) => void; }
export function Rating({ max = 5, value, onChange, ...props }: RatingProps): ReactElement {
  return <div data-k-nex-component="rating" data-slot="root"><RadioGroup {...props} value={String(value)} onChange={(next) => onChange(Number(next))} options={Array.from({ length: max }, (_, index) => ({ id: String(index + 1), label: `${index + 1}` }))} /></div>;
}

interface NativeValueProps extends FieldMessages { readonly value: string; readonly onChange: (value: string) => void; }
function NativeValueInput({ type, component, ...props }: NativeValueProps & { readonly type: "color" | "date" | "time"; readonly component: string }): ReactElement {
  return <FieldShell {...props} component={component}>{(ids) => <input id={ids.input} name={props.name} type={type} value={props.value} required={props.required} disabled={props.disabled} readOnly={props.readOnly} aria-describedby={describedBy(ids, props.description, props.error)} aria-invalid={props.error === undefined ? undefined : true} onChange={(event) => props.onChange(event.currentTarget.value)} data-slot="control" />}</FieldShell>;
}
export function ColorPicker(props: NativeValueProps): ReactElement { return <NativeValueInput {...props} type="color" component="color-picker" />; }
export function DateInput(props: NativeValueProps): ReactElement { return <NativeValueInput {...props} type="date" component="date-input" />; }
export function DatePicker(props: NativeValueProps): ReactElement { return <NativeValueInput {...props} type="date" component="date-picker" />; }
export function TimeInput(props: NativeValueProps): ReactElement { return <NativeValueInput {...props} type="time" component="time-input" />; }

export interface DateRangePickerProps extends Omit<FieldMessages, "name"> { readonly name: string; readonly start: string; readonly end: string; readonly onChange: (range: { readonly start: string; readonly end: string }) => void; }
export function DateRangePicker(props: DateRangePickerProps): ReactElement {
  const ids = useFieldIds(props.name);
  const messages = describedBy(ids, props.description, props.error);
  return <fieldset disabled={props.disabled} data-k-nex-component="date-range-picker" data-slot="root" data-state={props.error === undefined ? props.disabled ? "disabled" : "default" : "invalid"}><legend>{props.label}</legend><input id={`${ids.input}-start`} name={`${props.name}-start`} type="date" value={props.start} disabled={props.disabled} readOnly={props.readOnly} aria-invalid={props.error === undefined ? undefined : true} aria-describedby={messages} onChange={(event) => props.onChange({ start: event.currentTarget.value, end: props.end })} aria-label="Start date" data-slot="start" /><input id={`${ids.input}-end`} name={`${props.name}-end`} type="date" value={props.end} disabled={props.disabled} readOnly={props.readOnly} aria-invalid={props.error === undefined ? undefined : true} aria-describedby={messages} onChange={(event) => props.onChange({ start: props.start, end: event.currentTarget.value })} aria-label="End date" data-slot="end" />{props.description === undefined ? null : <FieldDescription id={ids.description}>{props.description}</FieldDescription>}{props.error === undefined ? null : <FieldError id={ids.error}>{props.error}</FieldError>}</fieldset>;
}

export interface FileUploadProps extends Omit<FieldMessages, "readOnly"> { readonly accept?: string; readonly multiple?: boolean; readonly onChange: (files: readonly File[]) => void; }
export function FileUpload(props: FileUploadProps): ReactElement {
  return <FieldShell {...props} component="file-upload">{(ids) => <input id={ids.input} name={props.name} type="file" accept={props.accept} multiple={props.multiple} required={props.required} disabled={props.disabled} aria-describedby={describedBy(ids, props.description, props.error)} aria-invalid={props.error === undefined ? undefined : true} onChange={(event) => props.onChange([...(event.currentTarget.files ?? [])])} data-slot="control" />}</FieldShell>;
}

export interface InputGroupProps { readonly children: ReactNode; readonly label: string; }
export function InputGroup({ children, label }: InputGroupProps): ReactElement { return <div role="group" aria-label={label} data-k-nex-component="input-group" data-slot="root">{children}</div>; }
export interface FormActionsProps { readonly children: ReactNode; }
export function FormActions({ children }: FormActionsProps): ReactElement { return <div data-k-nex-component="form-actions" data-slot="root">{children}</div>; }

export interface UnsavedChangesGuardProps { readonly dirty: boolean; readonly message?: string; }
export function UnsavedChangesGuard({ dirty, message = "You have unsaved changes." }: UnsavedChangesGuardProps): null {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = message; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, message]);
  return null;
}
