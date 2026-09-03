import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { canonicalJson } from "@k-nex/contracts";
import { createPuckBuilderProfileRegistry } from "@k-nex/builder-puck";
import { createUiDocumentRuntime, createUiRuntimeRegistry, type BrowserDataTransport } from "@k-nex/ui-runtime";
import { createGenericPuckBlockBridges } from "@k-nex/ui-builder-blocks";
import { salesCreateTaskMutation } from "../src/browser.js";
import { salesPageTemplates, salesOpportunitiesDescriptor, salesOpportunityStageUpdateDescriptor, salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor } from "../src/contracts.js";
import { salesPuckBlockBridges } from "../src/puck.js";

const sources = [salesTasksDescriptor, salesOpportunitiesDescriptor, salesTotalPotentialRevenueDescriptor];
const profile = {
  id: "workspace" as const,
  blocks: salesPuckBlockBridges.map(({ definition }) => ({ id: definition.id, version: definition.version })),
  sources: sources.map(({ id, version }) => ({ id, version })),
  actions: [salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesOpportunityStageUpdateDescriptor].map(({ id, version }) => ({ id, version })),
  publication: "save-layout" as const
};

describe("Sales Puck block library", () => {
  it("round-trips every default page under the workspace profile policy", () => {
    const resolved = createPuckBuilderProfileRegistry({ blocks: salesPuckBlockBridges, sources, profiles: [profile] }).resolve("workspace")!;
    for (const template of salesPageTemplates) {
      expect(resolved.validateDocument(template.document).id).toBe(template.id);
      expect(canonicalJson(resolved.adapter.fromPuckData(resolved.adapter.toPuckData(template.document)))).toBe(canonicalJson(template.document));
    }
  });

  it("rejects missing blocks and unauthorized action replacement", () => {
    expect(() => createPuckBuilderProfileRegistry({ blocks: salesPuckBlockBridges.slice(1), sources, profiles: [profile] })).toThrow(/unknown block/);
    const resolved = createPuckBuilderProfileRegistry({ blocks: salesPuckBlockBridges, sources, profiles: [profile] }).resolve("workspace")!;
    const taskTemplate = salesPageTemplates.find(({ id }) => id === "sales.page.tasks")!;
    const changed = structuredClone(taskTemplate.document);
    changed.regions.main[1]!.bindings!.action = { id: "sales.task.update", version: 1 };
    expect(() => resolved.validateDocument(changed)).toThrow(/forbids action/);
  });

  it("inserts the Kanban with its trusted existing source and action bindings", () => {
    const resolved = createPuckBuilderProfileRegistry({ blocks: salesPuckBlockBridges, sources, profiles: [profile] }).resolve("workspace")!;
    const data = resolved.adapter.toPuckData({ id: "workspace.custom", version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [] } });
    const component = resolved.adapter.config.components["sales.opportunity-kanban__v1"]!;
    const inserted = { ...data, content: [{ type: "sales.opportunity-kanban__v1", props: { id: "kanban", ...component.defaultProps } }] };
    const document = resolved.adapter.fromPuckData(inserted);
    expect(document.regions.main[0]?.bindings).toEqual({
      source: { source: { id: salesOpportunitiesDescriptor.id, version: 1 }, input: {}, structuralCompatibilityHash: salesOpportunitiesDescriptor.structuralCompatibilityHash, selectedFields: ["name", "stage", "revision", "value"] },
      action: { id: salesOpportunityStageUpdateDescriptor.id, version: 1 }
    });
    expect(resolved.validateDocument(document).regions.main[0]?.type).toBe("sales.opportunity-kanban");
  });

  it("composes the generic form with the registered Sales action and standard browser gateway", async () => {
    const bridges = createGenericPuckBlockBridges({ form: {
      action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version },
      fields: [{ name: "title", label: "Title", kind: "text", required: true }, { name: "status", label: "Status", kind: "select", options: [{ id: "open", label: "Open" }, { id: "done", label: "Done" }] }],
      initialValues: { title: "", status: "open" },
      submitLabel: "Create task"
    } });
    const form = bridges.find(({ definition }) => definition.id === "content.form")!;
    const node = { id: "generic-sales-form", type: form.definition.id, version: 1, props: form.defaultProps, bindings: { action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version } } };
    let mutationRequest: Parameters<BrowserDataTransport["mutate"]>[0] | undefined;
    const transport: BrowserDataTransport = {
      query: async () => ({ ok: false, problem: { code: "UNUSED", status: 500 } }),
      mutate: async (request) => {
        mutationRequest = request;
        return { ok: true, data: { id: "task-1", title: "Follow up", status: "open" } };
      }
    };
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [form.definition], sources: [] }));
    const result = runtime.render({
      document: { id: "sales.generic-form", version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [node] } },
      surface: "workspace",
      actor: { authenticated: true, permissions: new Set() },
      dispatchAction: (request) => salesCreateTaskMutation.execute(transport, request.input as { title: string; status?: "open" | "done" }, { signal: new AbortController().signal, idempotencyKey: "generic-form-1" })
    });
    if (!result.success) throw new Error("Expected the composed generic Sales form to render.");
    const rendered = result.regions.main?.[0];
    expect(rendered?.status).toBe("rendered");
    const element = (rendered as { output: { element: { props: { onSubmit: (values: Readonly<Record<string, string>>) => Promise<void> } } } }).output.element;
    expect(renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0])).toContain('data-k-nex-component="form"');
    await element.props.onSubmit({ title: "Follow up", status: "open" });
    expect(mutationRequest).toMatchObject({ action: salesCreateTaskMutation.action, input: { title: "Follow up", status: "open" }, idempotencyKey: "generic-form-1" });
  });
});
