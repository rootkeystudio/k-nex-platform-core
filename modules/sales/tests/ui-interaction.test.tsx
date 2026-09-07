// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { salesAccountArchiveDescriptor, salesAccountDetailDescriptor, salesAccountUpdateDescriptor, salesAccountsDescriptor, salesActivityCreateDescriptor, salesContactArchiveDescriptor, salesContactDetailDescriptor, salesContactUpdateDescriptor, salesLeadArchiveDescriptor, salesLeadDetailDescriptor, salesLeadQualifyDescriptor, salesNoteCreateDescriptor, salesOpportunityArchiveDescriptor, salesOpportunityCloseDescriptor, salesOpportunityDetailDescriptor, salesOpportunityStageUpdateDescriptor, salesOpportunityUpdateDescriptor, salesOwnershipAssignDescriptor, salesPipelineSnapshotDescriptor, salesPipelineUpdateDescriptor, salesSavedViewCalendarDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewListDescriptor, salesSavedViewTableDescriptor } from "../src/contracts.js";
import { SalesFixedDetailRouteProvider, SalesTimeline } from "../src/pages.js";
import { salesUiBlockDefinitions } from "../src/ui.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); });

function change(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function select(input: HTMLSelectElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Sales fixed detail form interaction", () => {
  it("keeps nullable channels and team identity absent without inventing the string null", async () => {
    const renderForm = async (definitionId: string, source: typeof salesAccountDetailDescriptor, action: { readonly id: string; readonly version: number }, values: Record<string, unknown>) => {
      const definition = salesUiBlockDefinitions.find(({ id }) => id === definitionId)!;
      const element = definition.render({
        node: { id: action.id, type: definition.id, version: definition.version, props: { title: action.id }, bindings: { source: { source: { id: source.id, version: source.version }, input: { id: "1" }, structuralCompatibilityHash: source.structuralCompatibilityHash, selectedFields: Object.keys(values) }, action } },
        props: { title: action.id }, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.contacts.read", "sales.contacts.write", "sales.contacts.channels.read", "sales.accounts.read", "sales.ownership.write"]) },
        sourceResult: { state: "success", data: { fields: Object.keys(values), rows: [{ key: "1", values }], page: { number: 1, pageSize: 1, hasNext: false } } }, action, dispatchAction: async () => undefined
      }).element as ReactNode;
      const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
      await act(async () => { root.render(element); });
      return { host, root };
    };
    const contact = await renderForm("sales.contact-detail", salesContactDetailDescriptor, salesContactUpdateDescriptor, { "display-name": { kind: "text", value: "Ada" }, email: null, phone: { kind: "text", value: null }, revision: { kind: "integer", value: 1 } });
    expect((contact.host.querySelector('[name="emailMode"]') as HTMLSelectElement).value).toBe("retain");
    expect((contact.host.querySelector('[name="phoneMode"]') as HTMLSelectElement).value).toBe("retain");
    expect(contact.host.querySelector('[name="email"]')).toBeNull();
    expect(contact.host.querySelector('[name="phone"]')).toBeNull();
    contact.root.unmount();
    const ownership = await renderForm("sales.account-detail", salesAccountDetailDescriptor, salesOwnershipAssignDescriptor, { name: { kind: "text", value: "Acme" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": null, status: { kind: "status", value: "active" }, revision: { kind: "integer", value: 1 } });
    expect((ownership.host.querySelector('[name="teamId"]') as HTMLInputElement).value).toBe("");
    expect(ownership.host.textContent).not.toContain("null");
    ownership.root.unmount();
  });

  it("refreshes action values when the authorized record revision advances", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.account-detail")!;
    const render = (revision: number, name: string) => definition.render({
      node: { id: "account-update", type: definition.id, version: definition.version, props: { title: "sales.account.update" }, bindings: { source: { source: { id: salesAccountDetailDescriptor.id, version: salesAccountDetailDescriptor.version }, input: { id: "1" }, structuralCompatibilityHash: salesAccountDetailDescriptor.structuralCompatibilityHash, selectedFields: ["name", "owner-id", "team-id", "status", "revision"] }, action: { id: salesAccountUpdateDescriptor.id, version: salesAccountUpdateDescriptor.version } } },
      props: { title: "sales.account.update" }, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.accounts.read", "sales.accounts.write"]) },
      sourceResult: { state: "success", data: { fields: ["name", "owner-id", "team-id", "status", "revision"], rows: [{ key: "1", values: { name: { kind: "text", value: name }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": null, status: { kind: "status", value: "active" }, revision: { kind: "integer", value: revision } } }], page: { number: 1, pageSize: 25, hasNext: false } } },
      action: { id: salesAccountUpdateDescriptor.id, version: salesAccountUpdateDescriptor.version }, dispatchAction: async () => undefined
    }).element as ReactNode;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(render(1, "Before")); });
    change(host.querySelector('[name="name"]') as HTMLInputElement, "Unsaved local edit");
    await act(async () => { root.render(render(2, "After")); });
    expect((host.querySelector('[name="expectedRevision"]') as HTMLInputElement).value).toBe("2");
    expect((host.querySelector('[name="name"]') as HTMLInputElement).value).toBe("After");
    root.unmount();
  });

  it("requires a canonical scheduled UTC instant, focuses errors, and dispatches the exact value", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.account-detail")!;
    const calls: unknown[] = [];
    const element = definition.render({
      node: { id: "activity-create", type: definition.id, version: definition.version, props: { title: "Create activity" }, bindings: { source: { source: { id: salesAccountDetailDescriptor.id, version: salesAccountDetailDescriptor.version }, input: { id: "1" }, structuralCompatibilityHash: salesAccountDetailDescriptor.structuralCompatibilityHash, selectedFields: ["name", "owner-id", "team-id", "status", "revision"] }, action: { id: salesActivityCreateDescriptor.id, version: salesActivityCreateDescriptor.version } } },
      props: { title: "Create activity" }, surface: "workspace",
      actor: { authenticated: true, permissions: new Set(["sales.accounts.read", "sales.activities.write"]) },
      sourceResult: { state: "success", data: { fields: ["name", "owner-id", "team-id", "status", "revision"], rows: [{ key: "1", values: { name: { kind: "text", value: "Acme" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": null, status: { kind: "status", value: "active" }, revision: { kind: "integer", value: 2 } } }], page: { number: 1, pageSize: 25, hasNext: false } } },
      action: { id: salesActivityCreateDescriptor.id, version: salesActivityCreateDescriptor.version },
      dispatchAction: async (request) => { calls.push(request); }
    });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(element.element as ReactNode); });
    const form = host.querySelector("form")!;
    const type = form.elements.namedItem("type") as HTMLInputElement;
    const subject = form.elements.namedItem("subject") as HTMLInputElement;
    const scheduledAt = form.elements.namedItem("scheduledAt") as HTMLInputElement;
    expect(host.querySelector(`label[for="${type.id}"]`)?.textContent).toBe("Activity type");
    await act(async () => { change(type, "call"); change(subject, "Follow up"); });
    form.requestSubmit();
    expect(calls).toHaveLength(0);
    expect(scheduledAt.required).toBe(true);

    await act(async () => { change(scheduledAt, "tomorrow"); form.requestSubmit(); });
    expect(calls).toHaveLength(0);
    expect(document.activeElement).toBe(scheduledAt);
    expect(scheduledAt.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("Scheduled at is invalid.");

    await act(async () => { change(scheduledAt, "2026-09-06T12:30:00.000Z"); form.requestSubmit(); });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ input: { relatedRecordType: "sales.account", relatedRecordId: "1", type: "call", subject: "Follow up", scheduledAt: "2026-09-06T12:30:00.000Z" } });
    root.unmount();
  });

  it("renders only valid lead qualification link-or-create fields and hides actions for archived leads", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.lead-detail")!;
    const calls: Array<{ input: Record<string, unknown> }> = [];
    const render = (archiveStatus: "active" | "archived") => definition.render({
      node: { id: "lead-action-qualify", type: definition.id, version: definition.version, props: { title: "Qualify lead" }, bindings: { source: { source: { id: salesLeadDetailDescriptor.id, version: salesLeadDetailDescriptor.version }, input: { id: "41" }, structuralCompatibilityHash: salesLeadDetailDescriptor.structuralCompatibilityHash, selectedFields: ["display-name", "owner-id", "team-id", "status", "archive-status", "revision"] }, action: { id: salesLeadQualifyDescriptor.id, version: salesLeadQualifyDescriptor.version } } },
      props: { title: "Qualify lead" }, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.leads.read", "sales.leads.qualify"]) },
      sourceResult: { state: "success", data: { fields: ["display-name", "owner-id", "team-id", "status", "archive-status", "revision"], rows: [{ key: "41", values: { "display-name": { kind: "text", value: "Lead" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": { kind: "text", value: "team-1" }, status: { kind: "status", value: "working" }, "archive-status": { kind: "status", value: archiveStatus }, revision: { kind: "integer", value: 2 } } }], page: { number: 1, pageSize: 1, hasNext: false } } },
      action: { id: salesLeadQualifyDescriptor.id, version: salesLeadQualifyDescriptor.version }, dispatchAction: async (request) => { calls.push(request as { input: Record<string, unknown> }); }
    }).element as ReactNode;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(render("active")); });
    expect((host.querySelector('[name="accountMode"]') as HTMLSelectElement).value).toBe("create");
    expect(host.querySelector('[name="accountName"]')).not.toBeNull();
    expect(host.querySelector('[name="accountId"]')).toBeNull();
    await act(async () => { select(host.querySelector('[name="accountMode"]') as HTMLSelectElement, "link"); });
    expect(host.querySelector('[name="accountId"]')).not.toBeNull();
    const contactMode = host.querySelector('[name="contactMode"]') as HTMLSelectElement;
    expect(Array.from(contactMode.options).map(({ value }) => value)).toContain("link");
    await act(async () => { select(contactMode, "link"); });
    expect(host.querySelector('[name="accountName"]')).toBeNull();
    expect(host.querySelector('[name="contactName"]')).toBeNull();
    const contactId = host.querySelector('[name="contactId"]') as HTMLInputElement;
    expect(contactId).not.toBeNull();
    expect(host.querySelector(`label[for="${contactId.id}"]`)?.textContent).toBe("Contact ID");
    for (const [name, value] of [["accountId", "51"], ["contactId", "61"], ["opportunityName", "Expansion"], ["pipelineId", "11"]] as const) await act(async () => { change(host.querySelector(`[name="${name}"]`) as HTMLInputElement, value); });
    await act(async () => { host.querySelector("form")!.requestSubmit(); });
    expect(calls[0]?.input).toEqual({ id: "41", expectedRevision: 2, accountMode: "link", accountId: "51", contactMode: "link", contactId: "61", opportunityName: "Expansion", pipelineId: "11" });
    await act(async () => { root.render(render("archived")); });
    expect(host.querySelector("form")).toBeNull();
    root.unmount();
  });

  it("dispatches the opaque eight-field Kanban move from its authorized stage rows", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.opportunity-kanban")!;
    const calls: Array<{ input: Record<string, unknown> }> = [];
    const element = definition.render({
      node: { id: "opportunity-stage", type: definition.id, version: definition.version, props: { title: "Advance stage" }, bindings: { source: { source: { id: salesSavedViewKanbanDescriptor.id, version: salesSavedViewKanbanDescriptor.version }, input: {}, structuralCompatibilityHash: salesSavedViewKanbanDescriptor.structuralCompatibilityHash, selectedFields: ["row-kind", "name", "stage-id", "stage-metadata", "revision"] }, action: { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version } } },
      props: { title: "Advance stage" }, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.opportunities.read", "sales.opportunities.stage.update"]) },
      sourceResult: { state: "success", data: { fields: ["row-kind", "name", "stage-id", "stage-metadata", "revision"], rows: [
        { key: "stage:00000000-0000-5000-8000-000000000000", values: { "row-kind": { kind: "enum", value: "stage" }, name: { kind: "text", value: "Qualification" }, "stage-id": { kind: "enum", value: "00000000-0000-5000-8000-000000000000" }, "stage-metadata": { kind: "text", value: '{"pipelineId":2,"pipelineRevision":3,"stageName":"Qualification","stageRevision":4,"stageSemantic":"qualification"}' }, revision: null } },
        { key: "stage:00000000-0000-5100-8000-000000000001", values: { "row-kind": { kind: "enum", value: "stage" }, name: { kind: "text", value: "Discovery" }, "stage-id": { kind: "enum", value: "00000000-0000-5100-8000-000000000001" }, "stage-metadata": { kind: "text", value: '{"pipelineId":2,"pipelineRevision":3,"stageName":"Discovery","stageRevision":5,"stageSemantic":"discovery"}' }, revision: null } },
        ...["proposal", "negotiation", "won", "lost"].map((stage, index) => ({ key: `stage:00000000-0000-5${index + 2}00-8000-00000000000${index + 2}`, values: { "row-kind": { kind: "enum" as const, value: "stage" }, name: { kind: "text" as const, value: stage }, "stage-id": { kind: "enum" as const, value: `00000000-0000-5${index + 2}00-8000-00000000000${index + 2}` }, "stage-metadata": { kind: "text" as const, value: JSON.stringify({ pipelineId: 2, pipelineRevision: 3, stageName: stage, stageRevision: index + 6, stageSemantic: stage }) }, revision: null } })),
        { key: "opportunity:71", values: { "row-kind": { kind: "enum", value: "opportunity" }, name: { kind: "text", value: "Expansion" }, "stage-id": { kind: "enum", value: "00000000-0000-5000-8000-000000000000" }, "stage-metadata": null, revision: { kind: "integer", value: 5 } } }
      ], page: { number: 1, pageSize: 7, hasNext: false } } },
      action: { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }, dispatchAction: async (request) => { calls.push(request as { input: Record<string, unknown> }); }
    });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(element.element as ReactNode); });
    await act(async () => { (Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Move to Discovery") as HTMLButtonElement).click(); });
    expect(calls[0]?.input).toEqual({ id: "71", expectedRevision: 5, expectedPipelineId: "2", expectedPipelineRevision: 3, expectedSourceStageId: "00000000-0000-5000-8000-000000000000", expectedSourceStageRevision: 4, destinationStageId: "00000000-0000-5100-8000-000000000001", expectedDestinationStageRevision: 5 });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { getData: () => "opportunity:71" } });
    await act(async () => { host.querySelector('[aria-label="Discovery opportunities"]')!.dispatchEvent(drop); });
    expect(calls[1]?.input).toEqual(calls[0]?.input);
    root.unmount();
  });

  it("keeps six stage rows on saved-Kanban page two and uses the platform paginator", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.opportunity-kanban")!; const pages: number[] = [];
    const semantics = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] as const; const ids = semantics.map((_, index) => `00000000-0000-5${index}00-8000-00000000000${index}`);
    const data = { fields: ["row-kind", "name", "stage-id", "stage-metadata", "revision"], rows: [
      ...semantics.map((semantic, index) => ({ key: `stage:${ids[index]}`, values: { "row-kind": { kind: "enum" as const, value: "stage" }, name: { kind: "text" as const, value: semantic }, "stage-id": { kind: "enum" as const, value: ids[index] }, "stage-metadata": { kind: "text" as const, value: JSON.stringify({ pipelineId: 2, pipelineRevision: 3, stageName: semantic, stageRevision: index + 1, stageSemantic: semantic }) }, revision: null } })),
      { key: "opportunity:72", values: { "row-kind": { kind: "enum" as const, value: "opportunity" }, name: { kind: "text" as const, value: "Second page" }, "stage-id": { kind: "enum" as const, value: ids[0] }, "stage-metadata": null, revision: { kind: "integer" as const, value: 6 } } }
    ], page: { number: 2, pageSize: 7, hasNext: true } };
    const element = definition.render({ node: { id: "kanban-page-two", type: definition.id, version: definition.version, props: { title: "Pipeline" }, presentation: { density: "compact" }, bindings: { source: { source: { id: salesSavedViewKanbanDescriptor.id, version: salesSavedViewKanbanDescriptor.version }, input: {}, structuralCompatibilityHash: salesSavedViewKanbanDescriptor.structuralCompatibilityHash, selectedFields: data.fields } } }, props: { title: "Pipeline" }, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.opportunities.read"]) }, sourceResult: { state: "success", data } }).element as ReactNode;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<SalesFixedDetailRouteProvider pagination={{ listPage: 2, timelinePage: 1, onListPageChange: (page) => pages.push(page), onTimelinePageChange: () => undefined }}><>{element}</></SalesFixedDetailRouteProvider>); });
    expect(host.querySelectorAll('[data-slot="kanban-columns"] > section')).toHaveLength(6); expect(host.textContent).toContain("Second page"); expect(host.querySelector('[data-slot="kanban-card-stage"]')).toBeNull();
    await act(async () => { (Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Next") as HTMLButtonElement).click(); }); expect(pages).toEqual([3]); root.unmount();
  });

  it("uses persisted result page size and emits a refetchable embedded table page event", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.saved-view-table")!; const events: unknown[] = []; const listener = (event: Event) => events.push((event as CustomEvent<unknown>).detail); window.addEventListener("k-nex:sales-page-change", listener);
    const element = definition.render({ node: { id: "saved-table", type: definition.id, version: definition.version, props: {}, bindings: { source: { source: { id: salesSavedViewTableDescriptor.id, version: salesSavedViewTableDescriptor.version }, input: {}, structuralCompatibilityHash: salesSavedViewTableDescriptor.structuralCompatibilityHash, selectedFields: ["name"] } } }, props: {}, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.saved-views.read"]) }, sourceResult: { state: "success", data: { fields: ["name"], rows: [{ key: "record:8", values: { name: { kind: "text", value: "Persisted page size" } } }], page: { number: 2, pageSize: 7, hasNext: true } } } }).element as ReactNode;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); await act(async () => { root.render(element); });
    expect(host.textContent).toContain("Page 2"); await act(async () => { (Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Next") as HTMLButtonElement).click(); }); expect(events).toEqual([{ nodeId: "saved-table", page: 3 }]);
    window.removeEventListener("k-nex:sales-page-change", listener); root.unmount();
  });

  it("gives the calendar renderer a presentation-specific heading distinct from the route H1", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.calendar")!;
    const element = definition.render({ node: { id: "calendar", type: definition.id, version: definition.version, props: { title: "Sales calendar" }, presentation: { mode: "agenda" }, bindings: { source: { source: { id: salesSavedViewCalendarDescriptor.id, version: salesSavedViewCalendarDescriptor.version }, input: {}, structuralCompatibilityHash: salesSavedViewCalendarDescriptor.structuralCompatibilityHash, selectedFields: ["subject", "scheduled-at", "occurred-at"] } } }, props: { title: "Sales calendar" }, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.activities.read"]) }, sourceResult: { state: "success", data: { fields: ["subject", "scheduled-at", "occurred-at"], rows: [], page: { number: 1, pageSize: 25, hasNext: false } } } }).element as ReactNode;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(element); });
    expect(host.querySelector('[data-k-nex-component="sales-calendar"] h2')?.textContent).toBe("Sales calendar agenda");
    expect(Array.from(host.querySelectorAll("h2")).map(({ textContent }) => textContent)).not.toContain("Sales calendar");
    root.unmount();
  });

  it("emits the exact saved-view selection pair from a native keyboard-reachable list button", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.saved-views")!;
    const selected: unknown[] = []; const listener = (event: Event) => selected.push((event as CustomEvent<unknown>).detail); window.addEventListener("k-nex:saved-view-select", listener);
    const element = definition.render({
      node: { id: "saved-view-list", type: definition.id, version: definition.version, props: {}, bindings: { source: { source: { id: salesSavedViewListDescriptor.id, version: salesSavedViewListDescriptor.version }, input: {}, structuralCompatibilityHash: salesSavedViewListDescriptor.structuralCompatibilityHash, selectedFields: ["id", "name", "visibility", "team-id", "target-object-id", "view-kind", "revision", "status"] } } },
      props: {}, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.saved-views.read"]) }, sourceResult: { state: "success", data: { fields: ["id", "name", "visibility", "team-id", "target-object-id", "view-kind", "revision", "status"], rows: [{ key: "saved-view:7", values: { id: { kind: "integer", value: 7 }, name: { kind: "text", value: "My pipeline" }, visibility: { kind: "enum", value: "personal" }, "team-id": null, "target-object-id": { kind: "enum", value: "sales.object.opportunity" }, "view-kind": { kind: "enum", value: "kanban" }, revision: { kind: "integer", value: 3 }, status: { kind: "status", value: "active" } } }], page: { number: 1, pageSize: 25, hasNext: false } } }
    }).element as ReactNode;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(element); }); const button = host.querySelector("button") as HTMLButtonElement;
    expect(button.type).toBe("button"); expect(button.tabIndex).toBe(0); expect(button.getAttribute("aria-label")).toBe("Select saved view My pipeline");
    await act(async () => { button.focus(); button.click(); });
    expect(selected).toEqual([{ savedViewId: 7, expectedRevision: 3 }]);
    window.removeEventListener("k-nex:saved-view-select", listener); root.unmount();
  });

  it("edits only a strict six-stage pipeline snapshot and never dispatches malformed arrays", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.pipeline-settings")!;
    const fields = ["pipeline-id", "pipeline-revision", "pipeline-name", "stage-id", "stage-revision", "semantic", "stage-name", "position", "probability-basis-points", "allowed-transition-stage-ids", "required-field-ids", "status"];
    const ids = ["55b9eec8-712a-59d0-be53-e856122ffa67", "b46c62bd-76a5-5cc3-b231-7827e54a3e3f", "f4054c74-4a9e-5e86-b92d-4e6ccc213804", "51780fcd-81bb-540a-a5cd-51b6b38b819a", "4939a04c-86bd-5ca1-bf92-c85a5f18b3cb", "c3f81ed3-4808-55fe-b2d0-c38644335be5"];
    const semantics = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"];
    const snapshot = { fields, rows: semantics.map((semantic, index) => ({ key: `stage:${ids[index]}`, values: { "pipeline-id": { kind: "integer", value: 2 }, "pipeline-revision": { kind: "integer", value: 3 }, "pipeline-name": { kind: "text", value: "Revenue" }, "stage-id": { kind: "text", value: ids[index] }, "stage-revision": { kind: "integer", value: index + 1 }, semantic: { kind: "enum", value: semantic }, "stage-name": { kind: "text", value: semantic }, position: { kind: "integer", value: index }, "probability-basis-points": { kind: "integer", value: index * 2000 }, "allowed-transition-stage-ids": { kind: "text", value: JSON.stringify(index < 4 ? [ids[index + 1], ids[5]] : []) }, "required-field-ids": { kind: "text", value: JSON.stringify(index === 5 ? ["lossReason"] : []) }, status: { kind: "status", value: "active" } } })), page: { number: 1, pageSize: 6, hasNext: false } };
    const calls: Array<{ input: Record<string, unknown> }> = [];
    const render = (data: typeof snapshot) => definition.render({ node: { id: "pipeline", type: definition.id, version: definition.version, props: {}, pipelineIdentity: { applicationId: "customer-gate-1", environment: "production" }, bindings: { source: { source: { id: salesPipelineSnapshotDescriptor.id, version: salesPipelineSnapshotDescriptor.version }, input: {}, structuralCompatibilityHash: salesPipelineSnapshotDescriptor.structuralCompatibilityHash, selectedFields: fields }, action: { id: salesPipelineUpdateDescriptor.id, version: salesPipelineUpdateDescriptor.version } } }, props: {}, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.pipelines.configure"]) }, sourceResult: { state: "success", data }, action: { id: salesPipelineUpdateDescriptor.id, version: salesPipelineUpdateDescriptor.version }, dispatchAction: async (request) => { calls.push(request as { input: Record<string, unknown> }); } }).element as ReactNode;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(render(snapshot)); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { change(host.querySelector('[name="stage-name-0"]') as HTMLInputElement, "Qualify"); host.querySelector("form")!.requestSubmit(); });
    expect(calls[0]?.input).toMatchObject({ id: 2, expectedRevision: 3, orderedStageIds: ids, stages: [{ name: "Qualify", requiredFieldIds: [] }, {}, {}, {}, {}, { requiredFieldIds: ["lossReason"] }] });
    const alternate = structuredClone(snapshot);
    alternate.rows = [alternate.rows[1]!, alternate.rows[0]!, ...alternate.rows.slice(2)];
    alternate.rows.forEach((row, index) => { row.values.position = { kind: "integer", value: index }; });
    await act(async () => { root.render(render(alternate)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { host.querySelector("form")!.requestSubmit(); });
    expect(calls[1]?.input).toMatchObject({ orderedStageIds: [ids[1], ids[0], ...ids.slice(2)], stages: [{ semantic: "discovery" }, { semantic: "qualification" }, {}, {}, {}, {}] });
    const terminalShuffle = structuredClone(alternate); [terminalShuffle.rows[4], terminalShuffle.rows[5]] = [terminalShuffle.rows[5]!, terminalShuffle.rows[4]!]; terminalShuffle.rows.forEach((row, index) => { row.values.position = { kind: "integer", value: index }; });
    await act(async () => { root.render(render(terminalShuffle)); });
    expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true); expect(host.textContent).toContain("Pipeline data is invalid");
    const malformed = structuredClone(snapshot); malformed.rows[0]!.values["allowed-transition-stage-ids"] = { kind: "text", value: "not-json" };
    await act(async () => { root.render(render(malformed)); });
    expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true); expect(host.textContent).toContain("Pipeline data is invalid");
    root.unmount();
  });

  it.each([
    ["sales.account-detail", salesAccountDetailDescriptor, { name: { kind: "text", value: "Merged" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": null, status: { kind: "status", value: "merged" }, revision: { kind: "integer", value: 2 } }, [salesAccountUpdateDescriptor, salesAccountArchiveDescriptor, salesOwnershipAssignDescriptor]],
    ["sales.contact-detail", salesContactDetailDescriptor, { "display-name": { kind: "text", value: "Archived" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": null, "account-id": { kind: "integer", value: 1 }, status: { kind: "status", value: "archived" }, revision: { kind: "integer", value: 2 } }, [salesContactUpdateDescriptor, salesContactArchiveDescriptor, salesOwnershipAssignDescriptor]],
    ["sales.lead-detail", salesLeadDetailDescriptor, { "display-name": { kind: "text", value: "Qualified" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": null, status: { kind: "status", value: "qualified" }, "archive-status": { kind: "status", value: "active" }, revision: { kind: "integer", value: 2 } }, [salesLeadQualifyDescriptor, salesOwnershipAssignDescriptor]],
    ["sales.opportunity-detail", salesOpportunityDetailDescriptor, { name: { kind: "text", value: "Won" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": null, "account-id": { kind: "integer", value: 1 }, "primary-contact-id": null, "pipeline-id": { kind: "integer", value: 2 }, "stage-id": { kind: "status", value: "won" }, "archive-status": { kind: "status", value: "active" }, revision: { kind: "integer", value: 2 } }, [salesOpportunityUpdateDescriptor, salesOpportunityStageUpdateDescriptor, salesOpportunityCloseDescriptor, salesOwnershipAssignDescriptor]]
  ])("hides rejected terminal mutations but preserves permitted interactions for %s", async (definitionId, source, values, hiddenActions) => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === definitionId)!;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    for (const action of [...hiddenActions, salesNoteCreateDescriptor]) {
      const element = definition.render({ node: { id: action.id, type: definition.id, version: definition.version, props: { title: action.id }, bindings: { source: { source: { id: source.id, version: source.version }, input: { id: "1" }, structuralCompatibilityHash: source.structuralCompatibilityHash, selectedFields: Object.keys(values) }, action: { id: action.id, version: action.version } } }, props: { title: action.id }, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.accounts.read", "sales.contacts.read", "sales.leads.read", "sales.opportunities.read", "sales.ownership.write", "sales.notes.write"]) }, sourceResult: { state: "success", data: { fields: Object.keys(values), rows: [{ key: "1", values }], page: { number: 1, pageSize: 1, hasNext: false } } }, action: { id: action.id, version: action.version }, dispatchAction: async () => undefined }).element as ReactNode;
      await act(async () => { root.render(element); });
      expect(host.querySelector("form") === null).toBe(action.id !== salesNoteCreateDescriptor.id);
    }
    root.unmount();
  });

  it("dispatches complete, cancel, and remove against selected timeline children", async () => {
    const calls: Array<{ action: { id: string }; input: unknown }> = [];
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<SalesTimeline permissions={["sales.activities.write", "sales.attachments.write", "sales.tasks.read"]} dispatchAction={async (request) => { calls.push(request); }} requestState={{ state: "success", data: {
      fields: ["kind", "subject", "status", "occurred-at", "revision"],
      rows: [
        { key: "activity:12", values: { kind: { kind: "text", value: "activity:call" }, subject: { kind: "text", value: "Call Ada" }, status: { kind: "status", value: "scheduled" }, "occurred-at": { kind: "text", value: "2026-09-06T12:30:00.000Z" }, revision: { kind: "integer", value: 4 } } },
        { key: "attachment:13", values: { kind: { kind: "text", value: "attachment" }, subject: { kind: "text", value: "brief.pdf" }, status: { kind: "status", value: "active" }, "occurred-at": { kind: "text", value: "2026-09-06T12:31:00.000Z" }, revision: { kind: "integer", value: 2 } } }
      ], page: { number: 1, pageSize: 25, hasNext: false }
    } }} />); });
    for (const label of ["Complete Call Ada", "Cancel Call Ada", "Remove brief.pdf"]) {
      await act(async () => { (Array.from(host.querySelectorAll("button")).find((button) => button.textContent === label) as HTMLButtonElement).click(); });
    }
    expect(calls.map(({ action, input }) => [action.id, input])).toEqual([
      ["sales.activity.complete", { id: "12", expectedRevision: 4 }],
      ["sales.activity.cancel", { id: "12", expectedRevision: 4 }],
      ["sales.attachment.remove", { id: "13", expectedRevision: 2 }]
    ]);
    expect(JSON.stringify(calls)).not.toContain("relatedRecordId");
    root.unmount();
  });

  it("uses native keyboard-reachable controls for generated list and timeline pagination", async () => {
    const listPages: number[] = []; const timelinePages: number[] = [];
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.account-list")!;
    const list = definition.render({
      node: { id: "accounts", type: definition.id, version: definition.version, props: { title: "Accounts" }, bindings: { source: { source: { id: salesAccountsDescriptor.id, version: salesAccountsDescriptor.version }, structuralCompatibilityHash: salesAccountsDescriptor.structuralCompatibilityHash, selectedFields: ["name", "owner-id", "status", "revision"] } } },
      props: { title: "Accounts" }, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.accounts.read"]) },
      sourceResult: { state: "success", data: { fields: ["name", "owner-id", "status", "revision"], rows: Array.from({ length: 25 }, (_, index) => ({ key: String(index + 1), values: { name: { kind: "text" as const, value: `Account ${index + 1}` }, "owner-id": { kind: "text" as const, value: "owner-1" }, status: { kind: "status" as const, value: "active" }, revision: { kind: "integer" as const, value: 1 } } })), page: { number: 1, pageSize: 25, hasNext: true } } }
    }).element as ReactNode;
    const timeline = <SalesTimeline requestState={{ state: "success", data: { fields: ["kind", "subject", "status", "occurred-at", "revision"], rows: Array.from({ length: 25 }, (_, index) => ({ key: `note:${index + 1}`, values: { kind: { kind: "text" as const, value: "note" }, subject: { kind: "text" as const, value: `Note ${index + 1}` }, status: { kind: "status" as const, value: "recorded" }, "occurred-at": { kind: "text" as const, value: "2026-09-06T12:30:00.000Z" }, revision: { kind: "integer" as const, value: 1 } } })), page: { number: 1, pageSize: 25, hasNext: true } } }} />;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<SalesFixedDetailRouteProvider timeline={timeline} pagination={{ listPage: 1, timelinePage: 1, onListPageChange: (page) => listPages.push(page), onTimelinePageChange: (page) => timelinePages.push(page) }}><>{list}{timeline}</></SalesFixedDetailRouteProvider>); });
    const next = Array.from(host.querySelectorAll("button")).filter((button) => button.textContent === "Next");
    expect(next).toHaveLength(2);
    for (const button of next) { expect(button.type).toBe("button"); expect(button.tabIndex).toBe(0); await act(async () => { button.focus(); button.click(); }); }
    expect(listPages).toEqual([2]);
    expect(timelinePages).toEqual([2]);
    root.unmount();
  });
});
