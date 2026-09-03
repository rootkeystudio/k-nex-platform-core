import {
  AuthorizationSubjectSchema,
  WorkspaceNavigationNodeSchema,
  type AuthorizationSubject,
  type WorkspaceNavigationNode
} from "@k-nex/contracts";

import type { RuntimeExtensionPool } from "./runtime-extension-store.js";
import { WorkspacePageStoreError, type WorkspacePageScope } from "./workspace-page-store.js";

interface FolderRow {
  readonly revision: number;
  readonly node_json: unknown;
}

export interface WorkspaceNavigationFolderSnapshot {
  readonly node: WorkspaceNavigationNode;
  readonly revision: number;
}

const applicationPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;

function fail(code: "INVALID_INPUT" | "REVISION_CONFLICT", message: string): never {
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

function snapshot(row: FolderRow): WorkspaceNavigationFolderSnapshot {
  return Object.freeze({ node: Object.freeze(folder(row.node_json)), revision: revision(row.revision) });
}

/** PostgreSQL storage only. Callers must derive nodes through current-authority catalog validation. */
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

  async create(scopeValue: WorkspacePageScope, nodeValue: unknown, actorValue: unknown): Promise<WorkspaceNavigationFolderSnapshot> {
    const owner = scope(scopeValue);
    const node = folder(nodeValue);
    const updatedBy = actor(actorValue);
    const updatedAt = this.timestamp();
    const result = await this.pool.query<FolderRow>(
      `insert into k_nex_workspace_navigation_folders (application_id, environment, folder_id, revision, node_json, updated_by_json, updated_at)
       values ($1,$2,$3,1,$4::jsonb,$5::jsonb,$6) returning revision, node_json`,
      [owner.applicationId, owner.environment, node.id, JSON.stringify(node), JSON.stringify(updatedBy), updatedAt]
    );
    if (!result.rows[0]) fail("INVALID_INPUT", "Workspace navigation folder was not created.");
    return snapshot(result.rows[0]);
  }

  async update(scopeValue: WorkspacePageScope, nodeValue: unknown, expectedRevisionValue: unknown, actorValue: unknown): Promise<WorkspaceNavigationFolderSnapshot> {
    const owner = scope(scopeValue);
    const node = folder(nodeValue);
    const expectedRevision = revision(expectedRevisionValue);
    const updatedBy = actor(actorValue);
    const updatedAt = this.timestamp();
    const result = await this.pool.query<FolderRow>(
      `update k_nex_workspace_navigation_folders set revision=revision+1, node_json=$4::jsonb, updated_by_json=$5::jsonb, updated_at=$6
       where application_id=$1 and environment=$2 and folder_id=$3 and revision=$7 returning revision, node_json`,
      [owner.applicationId, owner.environment, node.id, JSON.stringify(node), JSON.stringify(updatedBy), updatedAt, expectedRevision]
    );
    if (!result.rows[0]) fail("REVISION_CONFLICT", "Workspace navigation folder changed or is unavailable.");
    return snapshot(result.rows[0]);
  }

  private timestamp(): string {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.valueOf())) fail("INVALID_INPUT", "Workspace navigation clock is invalid.");
    return value.toISOString();
  }
}
