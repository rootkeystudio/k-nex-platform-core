"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import {
  Button as AriaButton, Dialog as AriaDialog, DialogTrigger, Heading as AriaHeading,
  Menu, MenuItem, MenuTrigger, Modal as AriaModal, ModalOverlay, Popover as AriaPopover,
  Tab, TabList, TabPanel, Tabs as AriaTabs, Tooltip as AriaTooltip, TooltipTrigger
} from "react-aria-components";

export { Pagination, Toast } from "@k-nex/ui-design-system-contracts";

export interface NavigationItem { readonly id: string; readonly label: string; readonly href: string; readonly current?: boolean; }
export interface NavigationProps { readonly label: string; readonly items: readonly NavigationItem[]; }
export function Navigation({ label, items }: NavigationProps): ReactElement {
  return <nav aria-label={label} data-k-nex-component="navigation" data-slot="root"><ul data-slot="list">{items.map((item) => <li key={item.id} data-slot="item"><a href={item.href} aria-current={item.current ? "page" : undefined}>{item.label}</a></li>)}</ul></nav>;
}

export type BreadcrumbsProps = NavigationProps;
export function Breadcrumbs({ label, items }: BreadcrumbsProps): ReactElement {
  return <nav aria-label={label} data-k-nex-component="breadcrumbs" data-slot="root"><ol data-slot="list">{items.map((item) => <li key={item.id} data-slot="item"><a href={item.href} aria-current={item.current ? "page" : undefined}>{item.label}</a></li>)}</ol></nav>;
}

export interface TabItem { readonly id: string; readonly label: string; readonly content: ReactNode; readonly disabled?: boolean; }
export interface TabsProps { readonly label: string; readonly items: readonly TabItem[]; readonly selectedId?: string; readonly onChange?: (id: string) => void; }
export function Tabs({ label, items, selectedId, onChange }: TabsProps): ReactElement {
  return <AriaTabs {...(selectedId === undefined ? {} : { selectedKey: selectedId })} onSelectionChange={(key) => onChange?.(String(key))} data-k-nex-component="tabs" data-slot="root"><TabList aria-label={label} items={items} data-slot="list">{(item) => <Tab id={item.id} {...(item.disabled === undefined ? {} : { isDisabled: item.disabled })} data-slot="tab">{item.label}</Tab>}</TabList>{items.map((item) => <TabPanel key={item.id} id={item.id} data-slot="panel">{item.content}</TabPanel>)}</AriaTabs>;
}

export interface SegmentedControlProps { readonly label: string; readonly items: readonly Omit<TabItem, "content">[]; readonly value: string; readonly onChange: (id: string) => void; }
export function SegmentedControl({ label, items, value, onChange }: SegmentedControlProps): ReactElement {
  const name = `segmented-${useId().replaceAll(":", "")}`;
  return <fieldset data-k-nex-component="segmented-control" data-slot="root"><legend>{label}</legend>{items.map((item) => <label key={item.id} data-slot="item" data-state={value === item.id ? "selected" : "default"}><input type="radio" name={name} value={item.id} checked={value === item.id} disabled={item.disabled} onChange={() => onChange(item.id)} />{item.label}</label>)}</fieldset>;
}

export interface ButtonGroupProps { readonly label: string; readonly children: ReactNode; }
export function ButtonGroup({ label, children }: ButtonGroupProps): ReactElement { return <div role="group" aria-label={label} data-k-nex-component="button-group" data-slot="root">{children}</div>; }
export function Toolbar({ label, children }: ButtonGroupProps): ReactElement { return <div role="toolbar" aria-label={label} data-k-nex-component="toolbar" data-slot="root">{children}</div>; }

export interface MenuAction { readonly id: string; readonly label: string; readonly disabled?: boolean; readonly onAction: () => void; }
export interface DropdownMenuProps { readonly label: string; readonly items: readonly MenuAction[]; }
export function DropdownMenu({ label, items }: DropdownMenuProps): ReactElement {
  return <div data-k-nex-component="dropdown-menu" data-slot="root"><MenuTrigger><AriaButton data-slot="trigger">{label}</AriaButton><AriaPopover data-slot="popover"><Menu aria-label={label} items={items} data-slot="menu" onAction={(key) => items.find((item) => item.id === String(key))?.onAction()}>{(item) => <MenuItem id={item.id} {...(item.disabled === undefined ? {} : { isDisabled: item.disabled })} data-slot="item">{item.label}</MenuItem>}</Menu></AriaPopover></MenuTrigger></div>;
}

export interface TreeNode { readonly id: string; readonly label: string; readonly children?: readonly TreeNode[]; }
export interface TreeViewProps {
  readonly label: string;
  readonly items: readonly TreeNode[];
  readonly selectedId?: string;
  readonly defaultSelectedId?: string;
  readonly onSelectionChange?: (id: string) => void;
  readonly expandedIds?: readonly string[];
  readonly defaultExpandedIds?: readonly string[];
  readonly onExpansionChange?: (ids: readonly string[]) => void;
}
interface VisibleTreeNode { readonly node: TreeNode; readonly parentId?: string; readonly level: number; readonly position: number; readonly setSize: number; }
function branchIds(items: readonly TreeNode[]): string[] { return items.flatMap((item) => item.children === undefined ? [] : [item.id, ...branchIds(item.children)]); }
function visibleTree(items: readonly TreeNode[], expanded: ReadonlySet<string>, level = 1, parentId?: string): VisibleTreeNode[] {
  return items.flatMap((node, index) => {
    const entry: VisibleTreeNode = parentId === undefined ? { node, level, position: index + 1, setSize: items.length } : { node, parentId, level, position: index + 1, setSize: items.length };
    return node.children !== undefined && expanded.has(node.id) ? [entry, ...visibleTree(node.children, expanded, level + 1, node.id)] : [entry];
  });
}
export function TreeView({ label, items, selectedId, defaultSelectedId, onSelectionChange, expandedIds, defaultExpandedIds, onExpansionChange }: TreeViewProps): ReactElement {
  const allBranchIds = branchIds(items);
  const [internalSelection, setInternalSelection] = useState(defaultSelectedId);
  const [internalExpansion, setInternalExpansion] = useState(() => new Set(defaultExpandedIds ?? allBranchIds));
  const [focusedId, setFocusedId] = useState(() => items[0]?.id);
  const treeRef = useRef<HTMLDivElement>(null);
  const expansion = new Set(expandedIds ?? internalExpansion);
  const visible = visibleTree(items, expansion);
  const visibleById = new Map(visible.map((item) => [item.node.id, item]));
  const activeId = visible.some((item) => item.node.id === focusedId) ? focusedId : visible[0]?.node.id;
  const activeSelection = selectedId ?? internalSelection;
  const focus = (id: string) => { setFocusedId(id); Array.from(treeRef.current?.querySelectorAll<HTMLLIElement>("[role=treeitem]") ?? []).find((item) => item.dataset.treeNodeId === id)?.focus(); };
  const select = (id: string) => { if (selectedId === undefined) setInternalSelection(id); onSelectionChange?.(id); };
  const setExpanded = (id: string, nextValue: boolean) => {
    const next = new Set(expansion);
    if (nextValue) next.add(id); else next.delete(id);
    if (expandedIds === undefined) setInternalExpansion(next);
    onExpansionChange?.(allBranchIds.filter((branchId) => next.has(branchId)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, entry: VisibleTreeNode) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const index = visible.findIndex((item) => item.node.id === entry.node.id);
    const hasChildren = entry.node.children !== undefined;
    const isExpanded = expansion.has(entry.node.id);
    if (event.key === "ArrowDown") { const next = visible[index + 1]; if (next !== undefined) focus(next.node.id); return; }
    if (event.key === "ArrowUp") { const previous = visible[index - 1]; if (previous !== undefined) focus(previous.node.id); return; }
    if (event.key === "Home") { if (visible[0] !== undefined) focus(visible[0].node.id); return; }
    if (event.key === "End") { const last = visible.at(-1); if (last !== undefined) focus(last.node.id); return; }
    if (event.key === "ArrowRight" && hasChildren) { if (!isExpanded) setExpanded(entry.node.id, true); else if (entry.node.children?.[0] !== undefined) focus(entry.node.children[0].id); return; }
    if (event.key === "ArrowLeft") { if (hasChildren && isExpanded) setExpanded(entry.node.id, false); else if (entry.parentId !== undefined) focus(entry.parentId); return; }
    if (event.key === "Enter" || event.key === " ") select(entry.node.id);
  };
  const renderItems = (nodes: readonly TreeNode[]): ReactElement => <ul role="group" data-slot="group">{nodes.map((node) => {
    const entry = visibleById.get(node.id)!;
    const hasChildren = node.children !== undefined;
    return <li key={node.id} role="treeitem" aria-label={node.label} tabIndex={activeId === node.id ? 0 : -1} aria-level={entry.level} aria-posinset={entry.position} aria-setsize={entry.setSize} aria-selected={activeSelection === node.id} aria-expanded={hasChildren ? expansion.has(node.id) : undefined} onFocus={() => setFocusedId(node.id)} onClick={(event) => { event.stopPropagation(); select(node.id); }} onKeyDown={(event) => onKeyDown(event, entry)} data-tree-node-id={node.id} data-slot="item"><span data-slot="item-trigger">{node.label}</span>{hasChildren && expansion.has(node.id) ? renderItems(node.children) : null}</li>;
  })}</ul>;
  return <div ref={treeRef} role="tree" aria-label={label} aria-multiselectable={false} data-k-nex-component="tree-view" data-slot="root">{renderItems(items)}</div>;
}

export interface SkipLinkProps { readonly href: `#${string}`; readonly children?: ReactNode; }
export function SkipLink({ href, children = "Skip to main content" }: SkipLinkProps): ReactElement { return <a href={href} data-k-nex-component="skip-link" data-slot="root">{children}</a>; }

export interface AccordionItem { readonly id: string; readonly title: string; readonly content: ReactNode; readonly open?: boolean; }
export interface AccordionProps { readonly items: readonly AccordionItem[]; }
export function Accordion({ items }: AccordionProps): ReactElement { return <div data-k-nex-component="accordion" data-slot="root">{items.map((item) => <details key={item.id} open={item.open} data-slot="item"><summary data-slot="trigger">{item.title}</summary><div data-slot="content">{item.content}</div></details>)}</div>; }

export interface DialogProps { readonly triggerLabel: string; readonly title: string; readonly children: ReactNode; readonly closeLabel?: string; readonly dismissable?: boolean; }
export function Dialog({ triggerLabel, title, children, closeLabel = "Close", dismissable = true }: DialogProps): ReactElement {
  return <div data-k-nex-component="dialog" data-slot="root"><DialogTrigger><AriaButton data-slot="trigger">{triggerLabel}</AriaButton><ModalOverlay isDismissable={dismissable} data-slot="backdrop"><AriaModal data-slot="modal"><AriaDialog data-slot="content">{({ close }) => <><AriaHeading slot="title" data-slot="title">{title}</AriaHeading>{children}<AriaButton onPress={close} data-slot="close">{closeLabel}</AriaButton></>}</AriaDialog></AriaModal></ModalOverlay></DialogTrigger></div>;
}

export interface WorkspaceNavigationDrawerProps {
  readonly applicationLabel: string;
  readonly children: (close: () => void) => ReactNode;
}
export function WorkspaceNavigationDrawer({ applicationLabel, children }: WorkspaceNavigationDrawerProps): ReactElement {
  return <DialogTrigger>
    <AriaButton className="workspace-mobile-trigger" aria-label="Open navigation">☰</AriaButton>
    <ModalOverlay className="workspace-drawer-overlay" isDismissable>
      <AriaModal className="workspace-drawer">
        <AriaDialog aria-label="Mobile workspace navigation">{({ close }) => <>
          <div className="workspace-drawer-heading"><AriaHeading slot="title">{applicationLabel}</AriaHeading><AriaButton aria-label="Close navigation" onPress={close}>×</AriaButton></div>
          {children(close)}
        </>}</AriaDialog>
      </AriaModal>
    </ModalOverlay>
  </DialogTrigger>;
}

export type ModalProps = DialogProps;
export function Modal(props: ModalProps): ReactElement { return <div data-k-nex-component="modal" data-slot="root"><Dialog {...props} /></div>; }
export interface DrawerProps extends DialogProps { readonly side?: "start" | "end"; }
export function Drawer({ side = "end", ...props }: DrawerProps): ReactElement { return <div data-k-nex-component="drawer" data-slot="root" data-state={side}><Dialog {...props} /></div>; }

export interface PopoverProps { readonly triggerLabel: string; readonly label: string; readonly children: ReactNode; }
export function Popover({ triggerLabel, label, children }: PopoverProps): ReactElement {
  return <div data-k-nex-component="popover" data-slot="root"><DialogTrigger><AriaButton data-slot="trigger">{triggerLabel}</AriaButton><AriaPopover placement="bottom start" data-slot="content"><AriaDialog aria-label={label}>{children}</AriaDialog></AriaPopover></DialogTrigger></div>;
}

export interface TooltipProps { readonly triggerLabel: string; readonly children: ReactNode; readonly delay?: number; }
export function Tooltip({ triggerLabel, children, delay = 500 }: TooltipProps): ReactElement { return <span data-k-nex-component="tooltip" data-slot="root"><TooltipTrigger delay={delay} closeDelay={0}><AriaButton data-slot="trigger">{triggerLabel}</AriaButton><AriaTooltip data-slot="content">{children}</AriaTooltip></TooltipTrigger></span>; }

export interface CarouselProps { readonly label: string; readonly items: readonly { readonly id: string; readonly content: ReactNode }[]; }
export function Carousel({ label, items }: CarouselProps): ReactElement {
  const [index, setIndex] = useState(0);
  const item = items[index];
  return <section aria-roledescription="carousel" aria-label={label} data-k-nex-component="carousel" data-slot="root"><div aria-live="polite" data-slot="viewport">{item?.content}</div><button type="button" aria-label="Previous slide" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} data-slot="previous">Previous</button><button type="button" aria-label="Next slide" disabled={index >= items.length - 1} onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))} data-slot="next">Next</button><span data-slot="status">{items.length === 0 ? "0 of 0" : `${index + 1} of ${items.length}`}</span></section>;
}
