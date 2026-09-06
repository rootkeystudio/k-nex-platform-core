// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { salesAccountArchiveDescriptor, salesAccountDetailDescriptor, salesAccountUpdateDescriptor, salesAccountsDescriptor, salesActivityCreateDescriptor, salesContactArchiveDescriptor, salesContactDetailDescriptor, salesContactUpdateDescriptor, salesLeadArchiveDescriptor, salesLeadDetailDescriptor, salesLeadQualifyDescriptor, salesNoteCreateDescriptor, salesOpportunityArchiveDescriptor, salesOpportunityCloseDescriptor, salesOpportunityDetailDescriptor, salesOpportunityStageUpdateDescriptor, salesOpportunityUpdateDescriptor, salesOwnershipAssignDescriptor } from "../src/contracts.js";
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

  it("dispatches the single legal opportunity stage progression with CAS values", async () => {
    const definition = salesUiBlockDefinitions.find(({ id }) => id === "sales.opportunity-detail")!;
    const calls: Array<{ input: Record<string, unknown> }> = [];
    const element = definition.render({
      node: { id: "opportunity-stage", type: definition.id, version: definition.version, props: { title: "Advance stage" }, bindings: { source: { source: { id: salesOpportunityDetailDescriptor.id, version: salesOpportunityDetailDescriptor.version }, input: { id: "71" }, structuralCompatibilityHash: salesOpportunityDetailDescriptor.structuralCompatibilityHash, selectedFields: ["name", "owner-id", "team-id", "account-id", "pipeline-id", "stage-id", "archive-status", "revision"] }, action: { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version } } },
      props: { title: "Advance stage" }, surface: "workspace", actor: { authenticated: true, permissions: new Set(["sales.opportunities.read", "sales.opportunities.stage.update"]) },
      sourceResult: { state: "success", data: { fields: ["name", "owner-id", "team-id", "account-id", "pipeline-id", "stage-id", "archive-status", "revision"], rows: [{ key: "71", values: { name: { kind: "text", value: "Expansion" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": null, "account-id": { kind: "integer", value: 1 }, "pipeline-id": { kind: "integer", value: 2 }, "stage-id": { kind: "status", value: "discovery" }, "archive-status": { kind: "status", value: "active" }, revision: { kind: "integer", value: 5 } } }], page: { number: 1, pageSize: 1, hasNext: false } } },
      action: { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }, dispatchAction: async (request) => { calls.push(request as { input: Record<string, unknown> }); }
    });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(element.element as ReactNode); });
    const stage = host.querySelector('[name="stage"]') as HTMLSelectElement;
    expect(stage.value).toBe("proposal");
    expect(Array.from(stage.options).map(({ value }) => value)).toEqual(["proposal"]);
    await act(async () => { host.querySelector("form")!.requestSubmit(); });
    expect(calls[0]?.input).toEqual({ id: "71", expectedStage: "discovery", expectedRevision: 5, stage: "proposal" });
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
