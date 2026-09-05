import type { RuntimeExtensionPool } from "./runtime-extension-store.js";

export type WorkspaceSidebarPreference = "expanded" | "collapsed";

export interface WorkspaceSidebarPreferenceScope {
  readonly applicationId: string;
  readonly environment: string;
  readonly userId: string;
}

interface PreferenceRow {
  readonly sidebar: WorkspaceSidebarPreference;
}

const applicationPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const userPattern = /^[^\u0000-\u001f\u007f]{1,160}$/u;

function fail(message: string): never { throw new TypeError(message); }

function scope(value: WorkspaceSidebarPreferenceScope): WorkspaceSidebarPreferenceScope {
  if (!applicationPattern.test(value.applicationId) || !environmentPattern.test(value.environment) || !userPattern.test(value.userId)) {
    fail("Workspace sidebar preference scope is invalid.");
  }
  return value;
}

function preference(value: unknown): WorkspaceSidebarPreference {
  if (value !== "expanded" && value !== "collapsed") fail("Workspace sidebar preference is invalid.");
  return value;
}

/** PostgreSQL-backed presentation state; caller derives the scope from the current session. */
export class PostgresWorkspaceSidebarPreferenceStore {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly now: () => Date = () => new Date()) {}

  async read(scopeValue: WorkspaceSidebarPreferenceScope): Promise<WorkspaceSidebarPreference> {
    const owner = scope(scopeValue);
    const result = await this.pool.query<PreferenceRow>(
      "select sidebar from k_nex_workspace_sidebar_preferences where application_id=$1 and environment=$2 and user_id=$3",
      [owner.applicationId, owner.environment, owner.userId]
    );
    return result.rows[0] === undefined ? "expanded" : preference(result.rows[0].sidebar);
  }

  async upsert(scopeValue: WorkspaceSidebarPreferenceScope, value: unknown): Promise<WorkspaceSidebarPreference> {
    const owner = scope(scopeValue);
    const sidebar = preference(value);
    const now = this.now();
    if (!(now instanceof Date) || Number.isNaN(now.valueOf())) fail("Workspace sidebar preference clock is invalid.");
    const result = await this.pool.query<PreferenceRow>(
      `insert into k_nex_workspace_sidebar_preferences (application_id, environment, user_id, sidebar, updated_at)
       values ($1,$2,$3,$4,$5)
       on conflict (application_id, environment, user_id) do update set sidebar=excluded.sidebar, updated_at=excluded.updated_at
       returning sidebar`,
      [owner.applicationId, owner.environment, owner.userId, sidebar, now.toISOString()]
    );
    if (result.rows[0] === undefined) fail("Workspace sidebar preference was not saved.");
    return preference(result.rows[0].sidebar);
  }
}
