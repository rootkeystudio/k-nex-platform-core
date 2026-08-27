import type { ReactElement, ReactNode } from "react";

export interface VirtualListProps<T> {
  readonly label: string;
  readonly items: readonly T[];
  readonly getKey: (item: T) => string;
  readonly renderItem: (item: T) => ReactNode;
  readonly window?: { readonly start: number; readonly size: number };
}

export function VirtualList<T>({ label, items, getKey, renderItem, window }: VirtualListProps<T>): ReactElement {
  const start = Math.max(0, Math.min(items.length, window?.start ?? 0));
  const size = Math.max(0, window?.size ?? items.length);
  const visible = items.slice(start, start + size);
  return <div
    role="list"
    aria-label={label}
    aria-rowcount={items.length}
    data-k-nex-component="virtual-list"
    data-slot="root"
    data-state={window === undefined ? "complete" : "virtualized"}
  >
    {visible.map((item, index) => <div
      key={getKey(item)}
      role="listitem"
      aria-setsize={items.length}
      aria-posinset={start + index + 1}
      data-slot="item"
    >{renderItem(item)}</div>)}
  </div>;
}
