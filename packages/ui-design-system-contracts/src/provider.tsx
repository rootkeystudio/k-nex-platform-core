"use client";

import { createContext, useContext, type ReactElement, type ReactNode } from "react";

import { Button, Checkbox, Dialog, IconButton, Input, Link, Pagination, Popover, Select, Textarea, Tooltip } from "./aria.js";
import { Badge, Box, Card, Container, EmptyState, ErrorState, FormField, Grid, Heading, Inline, Skeleton, Stack, Status, Table, Text, Toast } from "./semantic.js";
import type { SemanticPrimitives } from "./types.js";

export const reactAriaPrimitives: SemanticPrimitives = Object.freeze({
  Box, Stack, Inline, Grid, Container,
  Text, Heading, Link,
  Button, IconButton,
  Card, Badge, Status,
  Input, Textarea, Select, Checkbox, FormField,
  Dialog, Popover, Tooltip,
  Toast, Skeleton, EmptyState, ErrorState,
  Table, Pagination
});

export function createSemanticPrimitives(overrides: Partial<SemanticPrimitives> = {}): SemanticPrimitives {
  return Object.freeze({ ...reactAriaPrimitives, ...overrides });
}

const DesignSystemContext = createContext<SemanticPrimitives | undefined>(undefined);

export interface KNeXDesignSystemProviderProps {
  readonly children: ReactNode;
  readonly primitives: SemanticPrimitives;
}

export function KNeXDesignSystemProvider({ children, primitives }: KNeXDesignSystemProviderProps): ReactElement {
  return <DesignSystemContext.Provider value={primitives}>{children}</DesignSystemContext.Provider>;
}

export function useDesignSystem(): SemanticPrimitives {
  const primitives = useContext(DesignSystemContext);
  if (primitives === undefined) throw new Error("KNeXDesignSystemProvider is required.");
  return primitives;
}
