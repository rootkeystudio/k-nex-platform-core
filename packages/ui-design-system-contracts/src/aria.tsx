"use client";

import type { ReactElement } from "react";
import {
  Button as AriaButton,
  Checkbox as AriaCheckbox,
  Dialog as AriaDialog,
  DialogTrigger,
  FieldError,
  Heading as AriaHeading,
  Input as AriaInput,
  Label,
  Link as AriaLink,
  ListBox,
  ListBoxItem,
  Modal,
  Popover as AriaPopover,
  Select as AriaSelect,
  SelectValue,
  Text as AriaText,
  TextArea as AriaTextArea,
  TextField,
  Tooltip as AriaTooltip,
  TooltipTrigger
} from "react-aria-components";

import type {
  ButtonProps, CheckboxProps, DialogProps, IconButtonProps, InputProps, LinkProps,
  PaginationProps, PopoverProps, SelectProps, TextareaProps, TooltipProps
} from "./types.js";

function fieldMessages(description: string | undefined, error: string | undefined): ReactElement[] {
  const messages: ReactElement[] = [];
  if (description !== undefined) messages.push(<AriaText key="description" slot="description">{description}</AriaText>);
  if (error !== undefined) messages.push(<FieldError key="error">{error}</FieldError>);
  return messages;
}

export function Link({ children, href, isExternal = false }: LinkProps): ReactElement {
  return <AriaLink href={href} {...(isExternal ? { target: "_blank", rel: "noreferrer" } : {})} data-k-nex-primitive="link" data-k-nex-component="link" data-slot="root">{children}</AriaLink>;
}

export function Button({ children, type = "button", variant = "primary", isDisabled = false, onPress }: ButtonProps): ReactElement {
  return <AriaButton type={type} isDisabled={isDisabled} {...(onPress === undefined ? {} : { onPress })} data-k-nex-primitive="button" data-variant={variant}>{children}</AriaButton>;
}

export function IconButton({ icon, label, type = "button", variant = "quiet", isDisabled = false, onPress }: IconButtonProps): ReactElement {
  return <AriaButton type={type} aria-label={label} isDisabled={isDisabled} {...(onPress === undefined ? {} : { onPress })} data-k-nex-primitive="icon-button" data-variant={variant}>{icon}</AriaButton>;
}

export function Input({ label, description, error, ...props }: InputProps): ReactElement {
  return <TextField
    {...(props.name === undefined ? {} : { name: props.name })}
    type={props.type ?? "text"}
    {...(props.value === undefined ? props.defaultValue === undefined ? {} : { defaultValue: props.defaultValue } : { value: props.value })}
    isRequired={props.isRequired ?? false}
    isDisabled={props.isDisabled ?? false}
    isInvalid={error !== undefined}
    {...(props.onChange === undefined ? {} : { onChange: props.onChange })}
    data-k-nex-primitive="input"
  >
    <Label>{label}</Label>
    <AriaInput {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })} {...(props.autoComplete === undefined ? {} : { autoComplete: props.autoComplete })} />
    {fieldMessages(description, error)}
  </TextField>;
}

export function Textarea({ label, description, error, ...props }: TextareaProps): ReactElement {
  return <TextField
    {...(props.name === undefined ? {} : { name: props.name })}
    {...(props.value === undefined ? props.defaultValue === undefined ? {} : { defaultValue: props.defaultValue } : { value: props.value })}
    isRequired={props.isRequired ?? false}
    isDisabled={props.isDisabled ?? false}
    isInvalid={error !== undefined}
    {...(props.onChange === undefined ? {} : { onChange: props.onChange })}
    data-k-nex-primitive="textarea"
  >
    <Label>{label}</Label>
    <AriaTextArea {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })} {...(props.rows === undefined ? {} : { rows: props.rows })} />
    {fieldMessages(description, error)}
  </TextField>;
}

export function Select({ label, description, error, options, ...props }: SelectProps): ReactElement {
  return <AriaSelect
    {...(props.name === undefined ? {} : { name: props.name })}
    {...(props.selectedKey === undefined ? props.defaultSelectedKey === undefined ? {} : { defaultSelectedKey: props.defaultSelectedKey } : { selectedKey: props.selectedKey })}
    {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
    isRequired={props.isRequired ?? false}
    isDisabled={props.isDisabled ?? false}
    isInvalid={error !== undefined}
    onSelectionChange={(key) => props.onChange?.(String(key))}
    data-k-nex-primitive="select"
  >
    <Label>{label}</Label>
    <AriaButton><SelectValue /></AriaButton>
    {fieldMessages(description, error)}
    <AriaPopover><ListBox items={options}>{(option) => <ListBoxItem id={option.id} {...(option.isDisabled === undefined ? {} : { isDisabled: option.isDisabled })}>{option.label}</ListBoxItem>}</ListBox></AriaPopover>
  </AriaSelect>;
}

export function Checkbox({ children, name, value, isSelected, defaultSelected, isRequired, isDisabled, onChange }: CheckboxProps): ReactElement {
  return <AriaCheckbox {...(name === undefined ? {} : { name })} {...(value === undefined ? {} : { value })} {...(isSelected === undefined ? defaultSelected === undefined ? {} : { defaultSelected } : { isSelected })} isRequired={isRequired ?? false} isDisabled={isDisabled ?? false} {...(onChange === undefined ? {} : { onChange })} data-k-nex-primitive="checkbox">
    <span aria-hidden="true" data-slot="indicator" />{children}
  </AriaCheckbox>;
}

export function Dialog({ children, title, triggerLabel, closeLabel = "Close", isDismissable = true }: DialogProps): ReactElement {
  return <DialogTrigger>
    <AriaButton data-k-nex-primitive="dialog-trigger">{triggerLabel}</AriaButton>
    <Modal isDismissable={isDismissable} data-k-nex-primitive="dialog-modal">
      <AriaDialog>{({ close }) => <><AriaHeading slot="title">{title}</AriaHeading>{children}<AriaButton onPress={close}>{closeLabel}</AriaButton></>}</AriaDialog>
    </Modal>
  </DialogTrigger>;
}

export function Popover({ children, label, triggerLabel }: PopoverProps): ReactElement {
  return <DialogTrigger>
    <AriaButton data-k-nex-primitive="popover-trigger">{triggerLabel}</AriaButton>
    <AriaPopover data-k-nex-primitive="popover"><AriaDialog aria-label={label}>{children}</AriaDialog></AriaPopover>
  </DialogTrigger>;
}

export function Tooltip({ children, triggerLabel, delay = 500 }: TooltipProps): ReactElement {
  return <TooltipTrigger delay={delay} closeDelay={0}>
    <AriaButton data-k-nex-primitive="tooltip-trigger">{triggerLabel}</AriaButton>
    <AriaTooltip data-k-nex-primitive="tooltip">{children}</AriaTooltip>
  </TooltipTrigger>;
}

export function Pagination({ label, currentPage, totalPages, onChange }: PaginationProps): ReactElement {
  const previous = Math.max(1, currentPage - 1);
  const next = Math.min(totalPages, currentPage + 1);
  return <nav aria-label={label} data-k-nex-primitive="pagination">
    <AriaButton aria-label="Previous page" isDisabled={currentPage <= 1} onPress={() => onChange(previous)}>Previous</AriaButton>
    <span aria-live="polite">Page {currentPage} of {totalPages}</span>
    <AriaButton aria-label="Next page" isDisabled={currentPage >= totalPages} onPress={() => onChange(next)}>Next</AriaButton>
  </nav>;
}
