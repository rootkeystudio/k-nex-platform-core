import type { ReactElement, ReactNode } from "react";

export { File, Image, Video } from "@k-nex/ui-components";
export { Table } from "@k-nex/ui-components";

export interface DataListItem { readonly id: string; readonly label: ReactNode; readonly value: ReactNode; }
export interface DataListProps { readonly label: string; readonly items: readonly DataListItem[]; }
export function DataList({ label, items }: DataListProps): ReactElement {
  return <section aria-label={label} data-k-nex-component="data-list" data-slot="root"><ul data-slot="list">{items.map((item) => <li key={item.id} data-slot="item"><span data-slot="label">{item.label}</span><span data-slot="value">{item.value}</span></li>)}</ul></section>;
}

export interface KeyValueItem { readonly id: string; readonly key: ReactNode; readonly value: ReactNode; }
export interface KeyValueListProps { readonly items: readonly KeyValueItem[]; readonly label?: string; }
export function KeyValueList({ items, label }: KeyValueListProps): ReactElement {
  return <dl aria-label={label} data-k-nex-component="key-value-list" data-slot="root">{items.map((item) => <div key={item.id} data-slot="item"><dt data-slot="key">{item.key}</dt><dd data-slot="value">{item.value}</dd></div>)}</dl>;
}
export function DescriptionList(props: KeyValueListProps): ReactElement { return <div data-k-nex-component="description-list" data-slot="root"><KeyValueList {...props} /></div>; }
