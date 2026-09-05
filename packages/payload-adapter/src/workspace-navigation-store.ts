import { randomUUID } from "node:crypto";

import {
  AuthorizationSubjectSchema,
  canonicalJson,
  WorkspaceNavigationNodeSchema,
  WorkspaceNavigationTreeSchema,
  WorkspacePageSchema,
  type AuthorizationSubject,
  type WorkspaceNavigationNode,
  type WorkspacePage
} from "@k-nex/contracts";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";
import { writeWorkspaceNavigationInvalidationOutbox } from "./workspace-navigation-outbox.js";
import { WorkspacePageStoreError, type WorkspacePageScope } from "./workspace-page-store.js";

interface FolderRow {
  readonly revision: number;
  readonly node_json: unknown;
}

interface AuthorityRow {
  readonly authorization_revision: number;
  readonly lifecycle_revision: number;
}

interface PageRow {
  readonly page_json: unknown;
}

export interface WorkspaceNavigationFolderSnapshot {
  readonly node: WorkspaceNavigationNode;
  readonly revision: number;
}

/** A server-derived authority fence for one navigation mutation. */
export interface WorkspaceNavigationMutationFence {
  readonly applicationId: string;
  readonly environment: string;
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
}

/** Static nodes and accepted roots from the generated application's current registry. */
export interface WorkspaceNavigationMutationCatalog {
  readonly staticNodes: readonly WorkspaceNavigationNode[];
  readonly staticParentIds: readonly string[];
}

const applicationPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;

function fail(code: "INVALID_INPUT" | "AUTHORITY_CONFLICT" | "REVISION_CONFLICT", message: string): never {
  throw new WorkspacePageStoreError(code, message);
}

function scope(value: WorkspacePageScope): WorkspacePageScope {
  if (!applicationPattern.test(value.applicationId) || !environmentPattern.test(value.environment)) fail("INVALID_INPUT", "Workspace navigation scope is invalid.");
  return value;
}

function folder(value: unknown): WorkspaceNavigationNode {
  const parsed = WorkspaceNavigationNodeSchema.safeParse(value);
  if (!parsed.success || parsed.data.kind !== "folder" || parsed.data.owner.kind !== "customer" || parsed.data.target !== undefined) {
    fail("INVALID_INPUT", "Workspace navigation folder is invalid.");
  }
  return parsed.data;
}

function actor(value: unknown): AuthorizationSubject {
  const parsed = AuthorizationSubjectSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_INPUT", "Workspace navigation actor is invalid.");
  return parsed.data;
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000_000) fail("INVALID_INPUT", "Workspace navigation revision is invalid.");
  return value as number;
}

function fence(value: WorkspaceNavigationMutationFence, owner: WorkspacePageScope): WorkspaceNavigationMutationFence {
  if (value.applicationId !== owner.applicationId || value.environment !== owner.environment ||
    !Number.isSafeInteger(value.authorizationRevision) || value.authorizationRevision < 0 ||
    !Number.isSafeInteger(value.lifecycleRevision) || value.lifecycleRevision < 0) {
    fail("INVALID_INPUT", "Workspace navigation mutation fence is invalid.");
  }
  return value;
}

function catalog(value: WorkspaceNavigationMutationCatalog): WorkspaceNavigationMutationCatalog {
  if (!Array.isArray(value.staticNodes) || !Array.isArray(value.staticParentIds) ||
    value.staticParentIds.some((id) => typeof id !== "string")) {
    fail("INVALID_INPUT", "Workspace navigation catalog is invalid.");
  }
  for (const node of value.staticNodes) {
    if (!WorkspaceNavigationNodeSchema.safeParse(node).success || node.owner.kind === "customer") {
      fail("INVALID_INPUT", "Workspace navigation static catalog is invalid.");
    }
  }
  const nodes = new Map(value.staticNodes.map((node) => [node.id, node]));
  if (nodes.size !== value.staticNodes.length || value.staticParentIds.some((id) => {
    const node = nodes.get(id);
    return node?.kind !== "folder" || node.owner.kind !== "platform-plugin";
  })) fail("INVALID_INPUT", "Workspace navigation static parents are invalid.");
  return value;
}

function page(value: unknown, owner: WorkspacePageScope): WorkspacePage {
  const parsed = WorkspacePageSchema.safeParse(value);
  if (!parsed.success || parsed.data.identity.applicationId !== owner.applicationId || parsed.data.identity.environment !== owner.environment) {
    fail("INVALID_INPUT", "Workspace navigation page catalog is invalid.");
  }
  return parsed.data;
}

function snapshot(row: FolderRow): WorkspaceNavigationFolderSnapshot {
  return Object.freeze({ node: Object.freeze(folder(row.node_json)), revision: revision(row.revision) });
}

/** PostgreSQL storage with a server-derived authority fence and locked navigation graph validation. */
export class PostgresWorkspaceNavigationStore {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly now: () => Date = () => new Date()) {}

  async list(scopeValue: WorkspacePageScope): Promise<readonly WorkspaceNavigationFolderSnapshot[]> {
    const owner = scope(scopeValue);
    const result = await this.pool.query<FolderRow>(
      `select revision, node_json from k_nex_workspace_navigation_folders where application_id=$1 and environment=$2 order by folder_id`,
      [owner.applicationId, owner.environment]
    );
    return Object.freeze(result.rows.map(snapshot));
  }

  async read(scopeValue: WorkspacePageScope, folderId: string): Promise<WorkspaceNavigationFolderSnapshot | undefined> {
    const owner = scope(scopeValue);
    if (typeof folderId !== "string") fail("INVALID_INPUT", "Workspace navigation folder ID is invalid.");
    const result = await this.pool.query<FolderRow>(
      `select revision, node_json from k_nex_workspace_navigation_folders where application_id=$1 and environment=$2 and folder_id=$3`,
      [owner.applicationId, owner.environment, folderId]
    );
    return result.rows[0] ? snapshot(result.rows[0]) : undefined;
  }

  async create(scopeValue: WorkspacePageScope, nodeValue: unknown, actorValue: unknown, fenceValue: WorkspaceNavigationMutationFence, catalogValue: WorkspaceNavigationMutationCatalog): Promise<WorkspaceNavigationFolderSnapshot> {
    const owner = scope(scopeValue);
    const node = folder(nodeValue);
    const updatedBy = actor(actorValue);
    const mutationFence = fence(fenceValue, owner);
    const mutationCatalog = catalog(catalogValue);
    return this.mutate(owner, node, updatedBy, mutationFence, mutationCatalog, "create", async (session, updatedAt) => {
      const result = await session.query<FolderRow>(
        `insert into k_nex_workspace_navigation_folders (application_id, environment, folder_id, revision, node_json, updated_by_json, updated_at)
         values ($1,$2,$3,1,$4::jsonb,$5::jsonb,$6) returning revision, node_json`,
        [owner.applicationId, owner.environment, node.id, JSON.stringify(node), JSON.stringify(updatedBy), updatedAt]
      );
      if (!result.rows[0]) fail("INVALID_INPUT", "Workspace navigation folder was not created.");
      return snapshot(result.rows[0]);
    });
  }

  async update(scopeValue: WorkspacePageScope, nodeValue: unknown, expectedRevisionValue: unknown, actorValue: unknown, fenceValue: WorkspaceNavigationMutationFence, catalogValue: WorkspaceNavigationMutationCatalog): Promise<WorkspaceNavigationFolderSnapshot> {
    const owner = scope(scopeValue);
    const node = folder(nodeValue);
    const expectedRevision = revision(expectedRevisionValue);
    const updatedBy = actor(actorValue);
    const mutationFence = fence(fenceValue, owner);
    const mutationCatalog = catalog(catalogValue);
    return this.mutate(owner, node, updatedBy, mutationFence, mutationCatalog, "update", async (session, updatedAt) => {
      const result = await session.query<FolderRow>(
        `update k_nex_workspace_navigation_folders set revision=revision+1, node_json=$4::jsonb, updated_by_json=$5::jsonb, updated_at=$6
         where application_id=$1 and environment=$2 and folder_id=$3 and revision=$7 returning revision, node_json`,
        [owner.applicationId, owner.environment, node.id, JSON.stringify(node), JSON.stringify(updatedBy), updatedAt, expectedRevision]
      );
      if (!result.rows[0]) fail("REVISION_CONFLICT", "Workspace navigation folder changed or is unavailable.");
      return snapshot(result.rows[0]);
    });
  }

  private async mutate(owner: WorkspacePageScope, node: WorkspaceNavigationNode, updatedBy: AuthorizationSubject, mutationFence: WorkspaceNavigationMutationFence, mutationCatalog: WorkspaceNavigationMutationCatalog, operation: "create" | "update", write: (session: RuntimeExtensionSession, updatedAt: string) => Promise<WorkspaceNavigationFolderSnapshot>): Promise<WorkspaceNavigationFolderSnapshot> {
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([owner.applicationId, owner.environment, "workspace-navigation"])]);
      const authority = await session.query<AuthorityRow>(
        `select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1 for share`,
        [owner.applicationId]
      );
      if (!authority.rows[0] || authority.rows[0].authorization_revision !== mutationFence.authorizationRevision || authority.rows[0].lifecycle_revision !== mutationFence.lifecycleRevision) {
        fail("AUTHORITY_CONFLICT", "Workspace navigation mutation authority is stale.");
      }
      const [folders, pages] = await Promise.all([
        session.query<FolderRow>(`select revision, node_json from k_nex_workspace_navigation_folders where application_id=$1 and environment=$2 for share`, [owner.applicationId, owner.environment]),
        session.query<PageRow>(`select page_json from k_nex_workspace_pages where application_id=$1 and environment=$2 for share`, [owner.applicationId, owner.environment])
      ]);
      this.validateGraph(owner, node, mutationCatalog, folders.rows, pages.rows);
      const updatedAt = this.timestamp();
      const result = await write(session, updatedAt);
      await writeWorkspaceNavigationInvalidationOutbox(session, {
        schemaVersion: 1,
        eventId: randomUUID(),
        eventType: "workspace-navigation.changed",
        operation,
        applicationId: owner.applicationId,
        environment: owner.environment,
        folderId: result.node.id,
        folderRevision: result.revision,
        authorizationRevision: mutationFence.authorizationRevision,
        lifecycleRevision: mutationFence.lifecycleRevision,
        occurredAt: updatedAt
      });
      await session.query("commit");
      return result;
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }

  private validateGraph(owner: WorkspacePageScope, node: WorkspaceNavigationNode, mutationCatalog: WorkspaceNavigationMutationCatalog, folderRows: readonly FolderRow[], pageRows: readonly PageRow[]): void {
    const folders = folderRows.map((row) => folder(row.node_json)).filter((candidate) => candidate.id !== node.id);
    const nodes = [...mutationCatalog.staticNodes, ...folders, node];
    const parentIds = new Set([...mutationCatalog.staticParentIds, ...folders.map(({ id }) => id)]);
    if (node.parentId === undefined || !parentIds.has(node.parentId)) fail("INVALID_INPUT", "Workspace navigation folder parent is unavailable.");
    const parents = new Map(nodes.map((candidate) => [candidate.id, candidate]));
    if (parents.get(node.parentId)?.kind !== "folder") fail("INVALID_INPUT", "Workspace navigation folder parent is invalid.");
    const pages = pageRows.map(({ page_json }) => page(page_json, owner)).flatMap((candidate) => candidate.state === "archived" || candidate.navigation.state === "unplaced" ? [] : [{
      id: candidate.identity.pageId,
      owner: { kind: "customer" as const },
      kind: "link" as const,
      parentId: candidate.navigation.parentNavigationId,
      label: candidate.title,
      order: candidate.navigation.order,
      target: { class: "workspace-page" as const, pageId: candidate.identity.pageId, mode: "view" as const }
    }]);
    const parsed = WorkspaceNavigationTreeSchema.safeParse({ schemaVersion: 1, applicationId: owner.applicationId, environment: owner.environment, revision: 1, nodes: [...nodes, ...pages] });
    if (!parsed.success) fail("INVALID_INPUT", "Workspace navigation candidate graph is invalid.");
  }

  private timestamp(): string {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.valueOf())) fail("INVALID_INPUT", "Workspace navigation clock is invalid.");
    return value.toISOString();
  }
}
