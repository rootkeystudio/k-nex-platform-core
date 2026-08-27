import type { ComponentType, ReactNode } from "react";

export type SemanticSpace = "none" | "tight" | "content" | "section";
export type SemanticTone = "neutral" | "accent" | "positive" | "warning" | "critical";

export interface BoxProps {
  readonly children?: ReactNode;
  readonly element?: "div" | "section" | "article" | "aside" | "main" | "nav";
}

export interface StackProps {
  readonly children?: ReactNode;
  readonly gap?: SemanticSpace;
  readonly align?: "start" | "center" | "end" | "stretch";
}

export interface InlineProps extends StackProps {
  readonly wrap?: boolean;
}

export interface GridProps {
  readonly children?: ReactNode;
  readonly columns?: 1 | 2 | 3 | 4 | 6 | 12;
  readonly gap?: SemanticSpace;
}

export interface ContainerProps {
  readonly children?: ReactNode;
  readonly size?: "narrow" | "content" | "wide";
}

export interface TextProps {
  readonly children?: ReactNode;
  readonly element?: "span" | "p";
  readonly size?: "small" | "body" | "large";
  readonly tone?: SemanticTone;
  readonly weight?: "regular" | "medium" | "strong";
}

export interface HeadingProps {
  readonly children: ReactNode;
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface LinkProps {
  readonly children: ReactNode;
  readonly href: string;
  readonly isExternal?: boolean;
}

export interface ButtonProps {
  readonly children: ReactNode;
  readonly type?: "button" | "submit" | "reset";
  readonly variant?: "primary" | "secondary" | "quiet" | "danger";
  readonly isDisabled?: boolean;
  readonly onPress?: () => void;
}

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  readonly icon: ReactNode;
  readonly label: string;
}

export interface CardProps {
  readonly children?: ReactNode;
  readonly variant?: "default" | "summary" | "interactive";
}

export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: SemanticTone;
}

export interface StatusProps extends BadgeProps {
  readonly live?: "off" | "polite" | "assertive";
}

export interface FieldMessages {
  readonly label: string;
  readonly description?: string;
  readonly error?: string;
}

export interface InputProps extends FieldMessages {
  readonly name?: string;
  readonly type?: "text" | "email" | "password" | "search" | "tel" | "url";
  readonly value?: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly onChange?: (value: string) => void;
}

export interface TextareaProps extends FieldMessages {
  readonly name?: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly onChange?: (value: string) => void;
}

export interface SelectOption {
  readonly id: string;
  readonly label: string;
  readonly isDisabled?: boolean;
}

export interface SelectProps extends FieldMessages {
  readonly name?: string;
  readonly options: readonly SelectOption[];
  readonly selectedKey?: string;
  readonly defaultSelectedKey?: string;
  readonly placeholder?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly onChange?: (key: string) => void;
}

export interface CheckboxProps {
  readonly children: ReactNode;
  readonly name?: string;
  readonly value?: string;
  readonly isSelected?: boolean;
  readonly defaultSelected?: boolean;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly onChange?: (selected: boolean) => void;
}

export interface FormFieldProps {
  readonly children: ReactNode;
  readonly legend: string;
  readonly description?: string;
  readonly error?: string;
}

export interface DialogProps {
  readonly children: ReactNode;
  readonly title: string;
  readonly triggerLabel: string;
  readonly closeLabel?: string;
  readonly isDismissable?: boolean;
}

export interface PopoverProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly triggerLabel: string;
}

export interface TooltipProps {
  readonly children: ReactNode;
  readonly triggerLabel: string;
  readonly delay?: number;
}

export interface ToastProps {
  readonly children: ReactNode;
  readonly tone?: SemanticTone;
  readonly priority?: "polite" | "assertive";
}

export interface SkeletonProps {
  readonly label: string;
}

export interface EmptyStateProps {
  readonly title: string;
  readonly message?: ReactNode;
  readonly action?: ReactNode;
}

export interface ErrorStateProps extends EmptyStateProps {
  readonly code?: string;
}

export interface TableColumn {
  readonly id: string;
  readonly label: string;
  readonly isRowHeader?: boolean;
}

export interface TableRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, ReactNode>>;
}

export interface TableProps {
  readonly label: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  readonly emptyMessage?: string;
}

export interface PaginationProps {
  readonly label: string;
  readonly currentPage: number;
  readonly totalPages: number;
  readonly onChange: (page: number) => void;
}

export const semanticPrimitiveNames = [
  "Box", "Stack", "Inline", "Grid", "Container",
  "Text", "Heading", "Link",
  "Button", "IconButton",
  "Card", "Badge", "Status",
  "Input", "Textarea", "Select", "Checkbox", "FormField",
  "Dialog", "Popover", "Tooltip",
  "Toast", "Skeleton", "EmptyState", "ErrorState",
  "Table", "Pagination"
] as const;

export interface SemanticPrimitives {
  readonly Box: ComponentType<BoxProps>;
  readonly Stack: ComponentType<StackProps>;
  readonly Inline: ComponentType<InlineProps>;
  readonly Grid: ComponentType<GridProps>;
  readonly Container: ComponentType<ContainerProps>;
  readonly Text: ComponentType<TextProps>;
  readonly Heading: ComponentType<HeadingProps>;
  readonly Link: ComponentType<LinkProps>;
  readonly Button: ComponentType<ButtonProps>;
  readonly IconButton: ComponentType<IconButtonProps>;
  readonly Card: ComponentType<CardProps>;
  readonly Badge: ComponentType<BadgeProps>;
  readonly Status: ComponentType<StatusProps>;
  readonly Input: ComponentType<InputProps>;
  readonly Textarea: ComponentType<TextareaProps>;
  readonly Select: ComponentType<SelectProps>;
  readonly Checkbox: ComponentType<CheckboxProps>;
  readonly FormField: ComponentType<FormFieldProps>;
  readonly Dialog: ComponentType<DialogProps>;
  readonly Popover: ComponentType<PopoverProps>;
  readonly Tooltip: ComponentType<TooltipProps>;
  readonly Toast: ComponentType<ToastProps>;
  readonly Skeleton: ComponentType<SkeletonProps>;
  readonly EmptyState: ComponentType<EmptyStateProps>;
  readonly ErrorState: ComponentType<ErrorStateProps>;
  readonly Table: ComponentType<TableProps>;
  readonly Pagination: ComponentType<PaginationProps>;
}
