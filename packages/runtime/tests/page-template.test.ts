import { describe, expect, it } from "vitest";

import type { PluginPageTemplateDescriptor, UiDocument } from "@k-nex/contracts";
import {
  PageTemplateError,
  adoptPluginPageTemplate,
  comparePluginPageTemplate,
  instantiatePluginPageTemplate,
  snapshotPageTemplateAuthority,
  type CustomerPageTemplateInstance,
  type PageTemplateInventory,
  type PageTemplateStore
} from "../src/index.js";

const descriptor = (version = 1): PluginPageTemplateDescriptor => ({
  id: "sales.page.tasks",
  version,
  ownerPluginId: "module.sales",
  route: { routeId: "sales.route.tasks", params: {} },
  surface: "workspace",
  profile: "workspace",
  permission: "sales.tasks.read",
  publicationPolicy: { ownership: "customer", adoption: "explicit" },
  requirements: {
    capabilities: [{ id: "records.storage", version: "1.0.0" }],
    sources: [{ id: "sales.tasks", version: 1 }],
    actions: [{ id: "sales.task.create", version: 1 }],
    blocks: [{ id: "sales.task-table", version: 1 }]
  },
  document: {
    id: "sales.page.tasks",
    version,
    schemaVersion: 1,
    profile: "workspace",
    regions: { main: [{ id: "tasks", type: "sales.task-table", version: 1, props: { title: `Tasks v${version}` }, bindings: {
      source: { source: { id: "sales.tasks", version: 1 }, input: {}, structuralCompatibilityHash: `sha256:${"a".repeat(64)}` },
      action: { id: "sales.task.create", version: 1 }
    } }] }
  },
  ...(version === 1 ? {} : { migration: { adoptableFromVersions: [1], notesMessageId: "sales.message.template-v2" } })
});

const inventory: PageTemplateInventory = {
  authorityRevision: 0,
  capabilities: new Map([["records.storage", "1.0.0"]]),
  routes: new Set(["sales.route.tasks"]),
  permissions: new Set(["sales.tasks.read"]),
  sources: new Set(["sales.tasks@1"]),
  actions: new Set(["sales.task.create@1"]),
  blocks: new Set(["sales.task-table@1"])
};

function memoryStore(
  authorityRevision: () => number = () => 0,
  {
    beforeRead = async () => {},
    beforeCreate = async () => {},
    beforeReplace = async () => {}
  }: {
    readonly beforeRead?: () => Promise<void>;
    readonly beforeCreate?: () => Promise<void>;
    readonly beforeReplace?: () => Promise<void>;
  } = {}
): PageTemplateStore & { edit(document: UiDocument): void; snapshot(): CustomerPageTemplateInstance | undefined } {
  let value: CustomerPageTemplateInstance | undefined;
  return {
    read: async () => {
      await beforeRead();
      return value === undefined ? undefined : structuredClone(value);
    },
    createIfAbsent: async (candidate, expectedAuthorityRevision) => {
      await beforeCreate();
      if (authorityRevision() !== expectedAuthorityRevision) return undefined;
      if (value !== undefined) return { created: false, instance: structuredClone(value) };
      value = structuredClone(candidate);
      return { created: true, instance: structuredClone(value) };
    },
    replace: async (candidate, expectedRevision, expectedAuthorityRevision) => {
      await beforeReplace();
      if (value?.revision !== expectedRevision || authorityRevision() !== expectedAuthorityRevision) return undefined;
      value = structuredClone(candidate);
      return structuredClone(value);
    },
    edit(document) {
      if (value === undefined) throw new Error("missing");
      value = { ...value, revision: value.revision + 1, document: structuredClone(document) };
    },
    snapshot: () => value === undefined ? undefined : structuredClone(value)
  };
}

function expectCode(error: unknown, code: PageTemplateError["code"]): void {
  expect(error).toBeInstanceOf(PageTemplateError);
  expect((error as PageTemplateError).code).toBe(code);
}

describe("P6.4 page template seed semantics", () => {
  it("clones immutable authority snapshots and rejects invalid authority revisions", () => {
    const actions = new Set(inventory.actions);
    const snapshot = snapshotPageTemplateAuthority({ ...inventory, actions });
    actions.clear();
    expect(snapshot.actions.has("sales.task.create@1")).toBe(true);
    expect("clear" in snapshot.actions).toBe(false);

    expect(() => snapshotPageTemplateAuthority({ ...inventory, authorityRevision: -1 })).toThrowError(PageTemplateError);
    expect(() => snapshotPageTemplateAuthority({ ...inventory, authorityRevision: Number.MAX_SAFE_INTEGER + 1 })).toThrowError(PageTemplateError);
    try {
      snapshotPageTemplateAuthority({ ...inventory, authorityRevision: -1 });
    } catch (error) {
      expectCode(error, "AUTHORITY_REVISION_INVALID");
    }
  });

  it("creates once and returns the same customer-owned instance on retry", async () => {
    const store = memoryStore();
    expect((await instantiatePluginPageTemplate(descriptor(), inventory, store)).created).toBe(true);
    const retry = await instantiatePluginPageTemplate(descriptor(), inventory, store);
    expect(retry.created).toBe(false);
    expect(retry.instance).toMatchObject({ ownership: "customer", adoptedTemplateVersion: 1, revision: 1 });
  });

  it("does not return a customer-owned instance when its current template authority is unavailable", async () => {
    const store = memoryStore();
    await instantiatePluginPageTemplate(descriptor(), inventory, store);
    const before = store.snapshot();

    await expect(instantiatePluginPageTemplate(descriptor(), { ...inventory, actions: new Set() }, store)).rejects.toSatisfy((error) => {
      expectCode(error, "ACTION_MISSING");
      return true;
    });

    expect(store.snapshot()).toEqual(before);
  });

  it("never overwrites customer edits during package upgrade and requires explicit adoption", async () => {
    const store = memoryStore();
    const first = await instantiatePluginPageTemplate(descriptor(), inventory, store);
    const edited = structuredClone(first.instance.document);
    edited.regions.main![0]!.props.title = "Customer title";
    store.edit(edited);

    const upgradeInstall = await instantiatePluginPageTemplate(descriptor(2), inventory, store);
    expect(upgradeInstall.instance.document.regions.main![0]!.props.title).toBe("Customer title");
    const beforeComparison = store.snapshot();
    const comparison = await comparePluginPageTemplate(descriptor(2), inventory, store, (current) => ({ ...current, version: 2 }));
    expect(comparison.status).toBe("update-available");
    expect(store.snapshot()).toEqual(beforeComparison);

    const adopted = await adoptPluginPageTemplate(descriptor(2), inventory, store, 2, (current) => ({ ...current, version: 2 }));
    expect(adopted).toMatchObject({ adoptedTemplateVersion: 2, revision: 3 });
    expect(adopted.document.regions.main![0]!.props.title).toBe("Customer title");
  });

  it.each([
    ["sources", "SOURCE_MISSING"],
    ["actions", "ACTION_MISSING"],
    ["blocks", "BLOCK_MISSING"]
  ] as const)("fails preflight when %s are absent", async (kind, code) => {
    const unavailable = { ...inventory, [kind]: new Set<string>() };
    await expect(instantiatePluginPageTemplate(descriptor(), unavailable, memoryStore())).rejects.toSatisfy((error) => {
      expectCode(error, code);
      return true;
    });
  });

  it("fails preflight when an exact required capability is absent", async () => {
    await expect(instantiatePluginPageTemplate(descriptor(), { ...inventory, capabilities: new Map() }, memoryStore())).rejects.toSatisfy((error) => {
      expectCode(error, "CAPABILITY_MISSING");
      return true;
    });
  });

  it("preserves the last valid instance when migration fails", async () => {
    const store = memoryStore();
    await instantiatePluginPageTemplate(descriptor(), inventory, store);
    const before = store.snapshot();
    await expect(adoptPluginPageTemplate(descriptor(2), inventory, store, 1, () => { throw new Error("boom"); })).rejects.toSatisfy((error) => {
      expectCode(error, "MIGRATION_FAILED");
      return true;
    });
    expect(store.snapshot()).toEqual(before);
  });

  it("rejects adoption migrations that return a stale document version", async () => {
    const store = memoryStore();
    await instantiatePluginPageTemplate(descriptor(), inventory, store);
    await expect(comparePluginPageTemplate(descriptor(2), inventory, store, (current) => current)).rejects.toSatisfy((error) => {
      expectCode(error, "DOCUMENT_INVALID");
      return true;
    });
    expect(store.snapshot()?.adoptedTemplateVersion).toBe(1);
  });

  it.each(["source", "action", "block"] as const)("rejects a migration that injects an undeclared %s and preserves the customer instance", async (kind) => {
    const store = memoryStore();
    await instantiatePluginPageTemplate(descriptor(), inventory, store);
    const before = store.snapshot();
    await expect(adoptPluginPageTemplate(descriptor(2), inventory, store, 1, (current) => {
      const node = current.regions.main![0]!;
      return {
        ...current,
        version: 2,
        regions: {
          main: [{
            ...node,
            ...(kind === "block" ? { type: "sales.private-table" } : {
              bindings: {
                ...node.bindings,
                [kind]: kind === "source"
                  ? { ...node.bindings!.source!, source: { id: "sales.private-tasks", version: 1 } }
                  : { id: "sales.task.delete", version: 1 }
              }
            })
          }]
        }
      };
    })).rejects.toSatisfy((error) => {
      expectCode(error, "DEFINITION_INVALID");
      return true;
    });
    expect(store.snapshot()).toEqual(before);
  });

  it.each([
    ["capabilities", "CAPABILITY_MISSING"],
    ["sources", "SOURCE_MISSING"],
    ["actions", "ACTION_MISSING"],
    ["blocks", "BLOCK_MISSING"]
  ] as const)("rechecks %s authority after migration before writing", async (kind, code) => {
    const store = memoryStore();
    await instantiatePluginPageTemplate(descriptor(), inventory, store);
    const before = store.snapshot();
    const changedInventory: PageTemplateInventory = {
      ...inventory,
      capabilities: new Map(inventory.capabilities),
      sources: new Set(inventory.sources),
      actions: new Set(inventory.actions),
      blocks: new Set(inventory.blocks)
    };
    await expect(adoptPluginPageTemplate(descriptor(2), changedInventory, store, 1, (current) => {
      if (kind === "capabilities") changedInventory.capabilities.clear();
      else changedInventory[kind].clear();
      return { ...current, version: 2 };
    })).rejects.toSatisfy((error) => {
      expectCode(error, code);
      return true;
    });
    expect(store.snapshot()).toEqual(before);
  });

  it("rejects a queued authority revocation after comparison and preserves storage bytes", async () => {
    let authorityRevision = 0;
    const changingInventory: PageTemplateInventory = {
      ...inventory,
      actions: new Set(inventory.actions),
      get authorityRevision() { return authorityRevision; }
    };
    const store = memoryStore(() => authorityRevision);
    await instantiatePluginPageTemplate(descriptor(), changingInventory, store);
    const before = store.snapshot();

    await expect(adoptPluginPageTemplate(descriptor(2), changingInventory, store, 1, (current) => {
      queueMicrotask(() => {
        changingInventory.actions.clear();
        authorityRevision += 1;
      });
      return { ...current, version: 2 };
    })).rejects.toSatisfy((error) => {
      expectCode(error, "ACTION_MISSING");
      return true;
    });

    expect(store.snapshot()).toEqual(before);
  });

  it("rejects authority changes during the asynchronous replacement CAS", async () => {
    let authorityRevision = 0;
    const changingInventory: PageTemplateInventory = {
      ...inventory,
      get authorityRevision() { return authorityRevision; }
    };
    const store = memoryStore(() => authorityRevision, {
      beforeReplace: async () => {
        await Promise.resolve();
        authorityRevision += 1;
      }
    });
    await instantiatePluginPageTemplate(descriptor(), changingInventory, store);
    const before = store.snapshot();

    await expect(adoptPluginPageTemplate(descriptor(2), changingInventory, store, 1, (current) => ({ ...current, version: 2 }))).rejects.toSatisfy((error) => {
      expectCode(error, "AUTHORITY_CONFLICT");
      return true;
    });

    expect(store.snapshot()).toEqual(before);
  });

  it("rejects authority revocation after the absent read and never creates stale bytes", async () => {
    let authorityRevision = 0;
    const changingInventory: PageTemplateInventory = {
      ...inventory,
      actions: new Set(inventory.actions),
      get authorityRevision() { return authorityRevision; }
    };
    const store = memoryStore(() => authorityRevision, {
      beforeRead: async () => {
        changingInventory.actions.clear();
        authorityRevision += 1;
      }
    });

    await expect(instantiatePluginPageTemplate(descriptor(), changingInventory, store)).rejects.toSatisfy((error) => {
      expectCode(error, "ACTION_MISSING");
      return true;
    });

    expect(store.snapshot()).toBeUndefined();
  });

  it("rejects authority changes during the asynchronous initial-create CAS", async () => {
    let authorityRevision = 0;
    const changingInventory: PageTemplateInventory = {
      ...inventory,
      get authorityRevision() { return authorityRevision; }
    };
    const store = memoryStore(() => authorityRevision, {
      beforeCreate: async () => {
        await Promise.resolve();
        authorityRevision += 1;
      }
    });

    await expect(instantiatePluginPageTemplate(descriptor(), changingInventory, store)).rejects.toSatisfy((error) => {
      expectCode(error, "AUTHORITY_CONFLICT");
      return true;
    });

    expect(store.snapshot()).toBeUndefined();
  });
});
