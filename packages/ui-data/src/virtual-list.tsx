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
  const focusKey = useRef<string | undefined>(undefined);
  const keyedItems = items.map((item) => getKey(item));
  if (keyedItems.some((key) => typeof key !== "string" || key.length === 0 || key.length > 512) || new Set(keyedItems).size !== keyedItems.length) {
    throw new TypeError("VirtualList item keys must be unique non-empty stable strings.");
  }
  const [active, setActive] = useState(() => ({ index: 0, key: keyedItems[0] }));
  const rememberedIndex = active.key === undefined ? -1 : keyedItems.indexOf(active.key);
  const activeIndex = items.length === 0 ? -1 : rememberedIndex === -1 ? Math.max(0, Math.min(active.index, items.length - 1)) : rememberedIndex;
  const activeKey = activeIndex === -1 ? undefined : keyedItems[activeIndex]!;
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current, estimateSize: () => estimateSize, getItemKey: (index) => getKey(items[index]!), overscan, initialRect: { width: 0, height }, useFlushSync: false });
  useEffect(() => {
    if (active.index !== activeIndex || active.key !== activeKey) {
      if (focusKey.current === active.key) focusKey.current = activeKey;
      setActive({ index: activeIndex, key: activeKey });
    }
  }, [active.index, active.key, activeIndex, activeKey]);
  useEffect(() => {
    if (focusKey.current === undefined || activeKey !== focusKey.current) return;
    let cancelled = false;
    const focusActive = (attempt: number): void => {
      if (cancelled) return;
      const item = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? []).find((element) => element.dataset.key === activeKey);
      if (item !== undefined && item !== null) item.focus();
      else if (attempt < 10) requestAnimationFrame(() => focusActive(attempt + 1));
      else focusKey.current = undefined;
    };
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(activeIndex, { align: "auto" });
      requestAnimationFrame(() => focusActive(0));
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [activeIndex, activeKey, virtualizer]);
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const page = Math.max(1, Math.floor(height / estimateSize));
    const next = event.key === "ArrowDown" ? activeIndex + 1 : event.key === "ArrowUp" ? activeIndex - 1 : event.key === "PageDown" ? activeIndex + page : event.key === "PageUp" ? activeIndex - page : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : undefined;
    if (next === undefined || items.length === 0) return;
    event.preventDefault();
    const index = Math.max(0, Math.min(items.length - 1, next));
    focusKey.current = keyedItems[index];
    setActive({ index, key: keyedItems[index] });
  };
  return <div
    ref={scrollRef}
    role="list"
    aria-label={label}
    aria-rowcount={items.length}
    tabIndex={items.length === 0 ? 0 : -1}
    onKeyDown={move}
    onBlurCapture={(event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !event.currentTarget.contains(next)) focusKey.current = undefined;
    }}
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
      data-key={keyedItems[virtualItem.index]}
      onFocus={() => {
        focusKey.current = keyedItems[virtualItem.index];
        setActive({ index: virtualItem.index, key: keyedItems[virtualItem.index] });
      }}
      data-slot="item"
      style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualItem.start}px)` }}
    >{renderItem(items[virtualItem.index]!)}</div>)}
  </div></div>;
}
