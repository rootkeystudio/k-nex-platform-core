"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface VirtualListProps<T> {
  readonly label: string;
  readonly items: readonly T[];
  readonly getKey: (item: T) => string;
  readonly renderItem: (item: T) => ReactNode;
  readonly height?: number;
  readonly estimateSize?: number;
  readonly overscan?: number;
}

export function VirtualList<T>({ label, items, getKey, renderItem, height = 400, estimateSize = 36, overscan = 5 }: VirtualListProps<T>): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current, estimateSize: () => estimateSize, getItemKey: (index) => getKey(items[index]!), overscan, initialRect: { width: 0, height }, useFlushSync: false });
  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const focusActive = (attempt: number): void => {
      if (cancelled) return;
      const item = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
      if (item !== undefined && item !== null) item.focus();
      else if (attempt < 10) requestAnimationFrame(() => focusActive(attempt + 1));
    };
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(activeIndex, { align: "auto" });
      requestAnimationFrame(() => focusActive(0));
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [activeIndex, items.length, virtualizer]);
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const page = Math.max(1, Math.floor(height / estimateSize));
    const next = event.key === "ArrowDown" ? activeIndex + 1 : event.key === "ArrowUp" ? activeIndex - 1 : event.key === "PageDown" ? activeIndex + page : event.key === "PageUp" ? activeIndex - page : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : undefined;
    if (next === undefined || items.length === 0) return;
    event.preventDefault();
    setActiveIndex(Math.max(0, Math.min(items.length - 1, next)));
  };
  return <div
    ref={scrollRef}
    role="list"
    aria-label={label}
    aria-rowcount={items.length}
    tabIndex={items.length === 0 ? 0 : -1}
    onKeyDown={move}
    style={{ height, overflow: "auto", contain: "strict" }}
    data-k-nex-component="virtual-list"
    data-slot="root"
    data-state="virtualized"
  ><div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }} data-slot="viewport">
    {virtualizer.getVirtualItems().map((virtualItem) => <div
      key={virtualItem.key}
      ref={virtualizer.measureElement}
      role="listitem"
      aria-setsize={items.length}
      aria-posinset={virtualItem.index + 1}
      tabIndex={virtualItem.index === activeIndex ? 0 : -1}
      data-index={virtualItem.index}
      data-slot="item"
      style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualItem.start}px)` }}
    >{renderItem(items[virtualItem.index]!)}</div>)}
  </div></div>;
}
