import { useState, type ReactElement } from "react";

import { Button, KNeXDesignSystemProvider, type ThemePresentationSnapshot } from "@k-nex/ui-design-system-contracts";
import { Card, Dialog, SegmentedControl } from "@k-nex/ui-components";
import { DataGrid, DataTable, VirtualList, createDataTableState, resolveDataTableActionAuthorization } from "@k-nex/ui-data";
import { Form, TextInput } from "@k-nex/ui-forms";
import { resolveMinimalThemeProfile } from "@k-nex/theme-minimal";
import { resolveNeobrutalismThemeProfile } from "@k-nex/theme-neobrutalism";
import { SalesTasksPage, createSalesTaskQuickCreateController, salesTasksTableDefinition } from "@k-nex/module-sales/pages";
import type { BrowserDataTransport } from "@k-nex/ui-runtime";

const profile = (themeId: "theme.minimal" | "theme.neobrutalism", palette: string, revision: string) => ({
  schemaVersion: 1, id: `theme-profile.${revision}`, surface: "public", themeId, themeVersion: "1.0.0", palette, mode: "light", values: {},
  revision: { id: `theme-revision.${revision}`, number: 1, state: "published", createdAt: "2026-08-27T00:00:00.000Z", publishedAt: "2026-08-27T00:01:00.000Z" }
});
export const minimalPresentation = resolveMinimalThemeProfile(profile("theme.minimal", "light", "p7-minimal"));
export const neobrutalismPresentation = resolveNeobrutalismThemeProfile(profile("theme.neobrutalism", "primary", "p7-neobrutalism"));

export const taskRecords = {
  fields: ["title", "status", "potential-revenue"],
  rows: [{ key: "task-1", values: { title: { kind: "text" as const, value: "Long localized customer follow-up task" }, status: { kind: "status" as const, value: "open" }, "potential-revenue": { kind: "money" as const, value: "1200", currency: "USD", scale: 2 } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};
const transport = { query: async () => ({ ok: false as const, problem: { code: "UNUSED", status: 500 } }), mutate: async () => ({ ok: false as const, problem: { code: "UNUSED", status: 500 } }) } as BrowserDataTransport;
const createTask = createSalesTaskQuickCreateController(transport, "matrix").initial();
const virtualRows = Array.from({ length: 10_000 }, (_, index) => `Virtual row ${index}`);
const taskActorFingerprint = `sha256:${"a".repeat(64)}`;
const taskAuthorization = resolveDataTableActionAuthorization(salesTasksTableDefinition, taskActorFingerprint, {
  resolve: (request) => ({
    actorFingerprint: request.actorFingerprint,
    catalogRevision: `sha256:${"b".repeat(64)}`,
    capabilities: request.actions.map((action) => ({ state: "allowed" as const, action }))
  })
});

function Surface({ label, presentation }: { readonly label: string; readonly presentation: ThemePresentationSnapshot }): ReactElement {
  const [viewState, setViewState] = useState(createDataTableState(salesTasksTableDefinition));
  const selectedState = { ...viewState, selectedRows: ["task-1"] };
  return <KNeXDesignSystemProvider primitives={presentation.primitives}><section data-testid={`surface-${label}`} data-theme-id={presentation.themeId} data-k-nex-theme-profile={presentation.profileRevisionId}>
    <div data-matrix-state="default"><Card>Default surface</Card></div>
    <div data-matrix-state="hover"><Button>{label} hover probe</Button></div>
    <div data-matrix-state="focus"><Button>{label} focus probe</Button></div>
    <div data-matrix-state="pressed"><Button>{label} pressed probe</Button></div>
    <div data-matrix-state="selected"><SegmentedControl label={`${label} selected view`} items={[{ id: "list", label: "List" }, { id: "board", label: "Board" }]} value="list" onChange={() => undefined} /></div>
    <div data-matrix-state="disabled"><Button isDisabled>{label} disabled probe</Button></div>
    <div data-matrix-state="read-only"><TextInput name={`${label}-readonly`} label={`${label} read only`} value="Fixed" readOnly onChange={() => undefined} /></div>
    <div data-matrix-state="pending"><Form label={`${label} pending form`} pending onSubmit={() => undefined}><Button type="submit">Submit</Button></Form></div>
    <div data-matrix-state="invalid"><TextInput name={`${label}-invalid`} label={`${label} invalid field`} value="Bad" error="Invalid value" onChange={() => undefined} /></div>
    <div data-matrix-state="empty"><DataTable definition={salesTasksTableDefinition} viewState={viewState} requestState={{ state: "empty" }} label={`${label} empty tasks`} /></div>
    <div data-matrix-state="error"><DataTable definition={salesTasksTableDefinition} viewState={viewState} requestState={{ state: "error", problem: { code: "FAILED", status: 500 } }} label={`${label} failed tasks`} /></div>
    <div data-matrix-state="high-contrast"><Button>{label} high contrast probe</Button></div>
    <div data-matrix-state="reduced-motion"><Button>{label} reduced motion probe</Button></div>
    <div data-matrix-state="rtl" dir="rtl">مرحبا بالمبيعات</div>
    <div data-matrix-state="long-text">Long localized customer follow-up task with intentionally extended content for bounded layout evidence</div>
    <div data-matrix-state="localization" lang="tr">Satış görevleri yerelleştirme kontrolü</div>
    <SalesTasksPage requestState={{ state: "success", data: taskRecords }} viewState={viewState} actionAuthorization={taskAuthorization} actionActorFingerprint={taskActorFingerprint} createTask={createTask} onViewStateChange={setViewState} onCreateTaskChange={() => undefined} onCreateTask={() => undefined} />
    <Dialog triggerLabel={`Open ${label} matrix dialog`} title={`${label} matrix dialog`}>Overlay performance probe</Dialog>
    <DataGrid definition={salesTasksTableDefinition} actionAuthorization={taskAuthorization} actionActorFingerprint={taskActorFingerprint} viewState={selectedState} requestState={{ state: "success", data: taskRecords }} label="Task grid" />
    <VirtualList label={`${label} virtual tasks`} items={virtualRows} getKey={(item) => item} renderItem={(item) => item} height={180} />
  </section></KNeXDesignSystemProvider>;
}

export function MatrixFixture(): ReactElement {
  const [first, setFirst] = useState<ThemePresentationSnapshot>(minimalPresentation);
  const [mounted, setMounted] = useState(true);
  return <><style>{minimalPresentation.cssText + neobrutalismPresentation.cssText}</style><Button onPress={() => setFirst(neobrutalismPresentation)}>Switch matrix theme</Button><Button onPress={() => setMounted((value) => !value)}>Toggle matrix surfaces</Button>{mounted ? <main><Surface label="Minimal" presentation={first} /><Surface label="Neobrutalism" presentation={neobrutalismPresentation} /></main> : null}</>;
}

export function HydrationProbe(): ReactElement {
  const viewState = createDataTableState(salesTasksTableDefinition);
  return <KNeXDesignSystemProvider primitives={minimalPresentation.primitives}><section data-k-nex-theme-profile={minimalPresentation.profileRevisionId}><DataTable definition={salesTasksTableDefinition} viewState={viewState} requestState={{ state: "success", data: taskRecords }} label="Hydration tasks" /><Dialog triggerLabel="Open hydration portal" title="Hydration portal">Hydrated overlay</Dialog></section></KNeXDesignSystemProvider>;
}
