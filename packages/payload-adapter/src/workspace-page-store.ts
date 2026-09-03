import { createHash, randomUUID } from "node:crypto";

import {
  AuthorizationSubjectSchema,
  canonicalJson,
  WorkspacePageAccessSnapshotSchema,
  WorkspacePageIdentitySchema,
  WorkspacePageSchema,
  WorkspacePublicationPointerSchema,
  WorkspacePublicationReceiptSchema,
  WorkspacePublishedRevisionSchema,
  WorkspaceWorkingCopyChangeInputSchema,
  WorkspaceWorkingCopySchema,
  type AuthorizationSubject,
  type WorkspacePage,
  type WorkspacePageAccessSnapshot,
  type WorkspacePageIdentity,
  type WorkspacePublicationPointer,
  type WorkspacePublicationReceipt,
  type WorkspacePublishedRevision,
  type WorkspaceWorkingCopy,
  type WorkspaceWorkingCopyChangeInput
} from "@k-nex/contracts";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export type WorkspacePageStoreErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "PUBLICATION_CONFLICT"
  | "RESTORE_INVALID";

export class WorkspacePageStoreError extends Error {
  constructor(readonly code: WorkspacePageStoreErrorCode, message: string) {
    super(message);
    this.name = "WorkspacePageStoreError";
  }
}

export interface WorkspacePageScope {
  readonly applicationId: string;
  readonly environment: string;
}

export interface WorkspacePageSnapshot {
  readonly page: WorkspacePage;
  readonly access: WorkspacePageAccessSnapshot;
  readonly workingCopy: WorkspaceWorkingCopy;
  readonly publication?: Readonly<{
    pointer: WorkspacePublicationPointer;
    revision: WorkspacePublishedRevision;
  }>;
}

export type WorkspacePageOperationKind = "create" | "metadata" | "working-copy" | "access" | "publish" | "rollback";

interface PageRow {
  page_json: unknown;
}

interface WorkingCopyRow {
  working_copy_json: unknown;
}

interface AccessRow {
  access_revision: number;
  subject_kind: "role" | "user";
  subject_id: string;
  capability: "view" | "edit";
}

interface PointerRow {
  pointer_json: unknown;
}

interface PublishedRevisionRow {
  revision_json: unknown;
}

interface OperationRow {
  operation_kind: string;
  request_digest: string;
  result_json: unknown;
}

interface MutationResult<T> {
  readonly result: T;
  readonly page: WorkspacePage;
  readonly workingCopyRevision: number;
  readonly accessRevision: number;
  readonly pointerRevision?: number;
}

const applicationPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;

function fail(code: WorkspacePageStoreErrorCode, message: string): never {
  throw new WorkspacePageStoreError(code, message);
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function sameIdentity(left: WorkspacePageIdentity, right: WorkspacePageIdentity): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function parseIdentity(value: unknown): WorkspacePageIdentity {
  const parsed = WorkspacePageIdentitySchema.safeParse(value);
  if (!parsed.success) fail("INVALID_INPUT", "Workspace page identity is invalid.");
  return parsed.data;
}

function parsePage(value: unknown): WorkspacePage {
  const parsed = WorkspacePageSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_INPUT", "Workspace page is invalid.");
  return parsed.data;
}

function parseAccess(value: unknown): WorkspacePageAccessSnapshot {
  const parsed = WorkspacePageAccessSnapshotSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_INPUT", "Workspace page access snapshot is invalid.");
  return parsed.data;
}

function parseWorkingCopy(value: unknown): WorkspaceWorkingCopy {
  const parsed = WorkspaceWorkingCopySchema.safeParse(value);
  if (!parsed.success) fail("INVALID_INPUT", "Workspace page working copy is invalid.");
  return parsed.data;
}

function parsePublishedRevision(value: unknown): WorkspacePublishedRevision {
  const parsed = WorkspacePublishedRevisionSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_INPUT", "Workspace page published revision is invalid.");
  return parsed.data;
}

function parsePointer(value: unknown): WorkspacePublicationPointer {
  const parsed = WorkspacePublicationPointerSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_INPUT", "Workspace page publication pointer is invalid.");
  return parsed.data;
}

function parseReceipt(value: unknown): WorkspacePublicationReceipt {
  const parsed = WorkspacePublicationReceiptSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_INPUT", "Workspace page publication receipt is invalid.");
  return parsed.data;
}

function assertIdempotencyKey(value: string): void {
  if (!idempotencyPattern.test(value)) fail("INVALID_INPUT", "Workspace page idempotency key is invalid.");
}

function assertScope(value: WorkspacePageScope): void {
  if (!applicationPattern.test(value.applicationId) || !environmentPattern.test(value.environment)) fail("INVALID_INPUT", "Workspace page scope is invalid.");
}

function assertActor(value: unknown): AuthorizationSubject {
  const parsed = AuthorizationSubjectSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_INPUT", "Workspace page actor is invalid.");
  return parsed.data;
}

function assertAligned(identity: WorkspacePageIdentity, ...values: readonly { readonly identity: WorkspacePageIdentity }[]): void {
  if (values.some((value) => !sameIdentity(identity, value.identity))) fail("INVALID_INPUT", "Workspace page values use different identities.");
}

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) fail("INVALID_INPUT", "Workspace page clock is invalid.");
  return value.toISOString();
}

function accessFromRows(identity: WorkspacePageIdentity, revision: number, rows: readonly AccessRow[]): WorkspacePageAccessSnapshot {
  return parseAccess({
    schemaVersion: 1,
    identity,
    accessRevision: revision,
    assignments: rows.map((row) => ({
      subject: row.subject_kind === "role" ? { kind: "role", roleId: row.subject_id } : { kind: "user", userId: row.subject_id },
      capability: row.capability
    }))
  });
}

/** PostgreSQL adapter only; current-authority admission belongs to the P12.6 service boundary. */
export class PostgresWorkspacePageStore {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly now: () => Date = () => new Date()) {}

  async list(scope: WorkspacePageScope): Promise<readonly WorkspacePage[]> {
    assertScope(scope);
    const result = await this.pool.query<PageRow>(
      `select page_json from k_nex_workspace_pages where application_id=$1 and environment=$2 order by page_id`,
      [scope.applicationId, scope.environment]
    );
    return Object.freeze(result.rows.map((row) => Object.freeze(parsePage(row.page_json))));
  }

  async read(identityValue: unknown): Promise<WorkspacePageSnapshot | undefined> {
    const identity = parseIdentity(identityValue);
    const session = await this.pool.connect();
    try {
      await session.query("begin isolation level repeatable read read only");
      const pageResult = await session.query<PageRow>(
        `select page_json from k_nex_workspace_pages where application_id=$1 and environment=$2 and page_id=$3`,
        [identity.applicationId, identity.environment, identity.pageId]
      );
      if (!pageResult.rows[0]) {
        await session.query("commit");
        return undefined;
      }
      const page = parsePage(pageResult.rows[0].page_json);
      if (!sameIdentity(page.identity, identity)) fail("INVALID_INPUT", "Stored workspace page identity is invalid.");
      const workingResult = await session.query<WorkingCopyRow>(
        `select working_copy_json from k_nex_workspace_working_copies where application_id=$1 and environment=$2 and page_id=$3`,
        [identity.applicationId, identity.environment, identity.pageId]
      );
      const accessResult = await session.query<AccessRow>(
        `select access_revision, subject_kind, subject_id, capability from k_nex_workspace_page_access where application_id=$1 and environment=$2 and page_id=$3 order by subject_kind, subject_id`,
        [identity.applicationId, identity.environment, identity.pageId]
      );
      const pointerResult = await session.query<PointerRow>(
        `select pointer_json from k_nex_workspace_publication_pointers where application_id=$1 and environment=$2 and page_id=$3`,
        [identity.applicationId, identity.environment, identity.pageId]
      );
      if (!workingResult.rows[0]) fail("INVALID_INPUT", "Stored workspace page has no working copy.");
      const workingCopy = parseWorkingCopy(workingResult.rows[0].working_copy_json);
      const access = accessFromRows(identity, page.accessRevision, accessResult.rows);
      const pointer = pointerResult.rows[0] ? parsePointer(pointerResult.rows[0].pointer_json) : undefined;
      let publication: WorkspacePageSnapshot["publication"];
      if (pointer !== undefined) {
        const revisionResult = await session.query<PublishedRevisionRow>(
          `select revision_json from k_nex_workspace_published_revisions where application_id=$1 and environment=$2 and page_id=$3 and revision_id=$4`,
          [identity.applicationId, identity.environment, identity.pageId, pointer.publishedRevisionId]
        );
        if (!revisionResult.rows[0]) fail("INVALID_INPUT", "Workspace publication pointer has no immutable revision.");
        publication = Object.freeze({ pointer: Object.freeze(pointer), revision: Object.freeze(parsePublishedRevision(revisionResult.rows[0].revision_json)) });
      }
      assertAligned(identity, page, workingCopy, access, ...(publication ? [publication.pointer, publication.revision] : []));
      if (workingCopy.revision !== page.workingCopyRevision || access.accessRevision !== page.accessRevision) fail("INVALID_INPUT", "Stored workspace page revisions diverged.");
      await session.query("commit");
      return Object.freeze({ page: Object.freeze(page), access: Object.freeze(access), workingCopy: Object.freeze(workingCopy), ...(publication ? { publication } : {}) });
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }

  async readByPageId(scope: WorkspacePageScope, pageId: string): Promise<WorkspacePageSnapshot | undefined> {
    assertScope(scope);
    const result = await this.pool.query<PageRow>(
      `select page_json from k_nex_workspace_pages where application_id=$1 and environment=$2 and page_id=$3`,
      [scope.applicationId, scope.environment, pageId]
    );
    if (!result.rows[0]) return undefined;
    return this.read(parsePage(result.rows[0].page_json).identity);
  }

  async create(input: Readonly<{
    page: unknown;
    access: unknown;
    workingCopy: unknown;
    idempotencyKey: string;
  }>): Promise<WorkspacePage> {
    const page = parsePage(input.page);
    const access = parseAccess(input.access);
    const workingCopy = parseWorkingCopy(input.workingCopy);
    assertIdempotencyKey(input.idempotencyKey);
    assertAligned(page.identity, access, workingCopy);
    if (page.revision !== 1 || page.workingCopyRevision !== 1 || workingCopy.revision !== 1 || page.accessRevision !== access.accessRevision || page.publishedRevisionId !== undefined || page.dependencyDigest !== undefined || page.state !== "draft") {
      fail("INVALID_INPUT", "A new workspace page must begin as one unpublished draft revision.");
    }
    return this.mutate(page.identity, "create", input.idempotencyKey, { page, access, workingCopy }, page.createdBy, parsePage, async (session) => {
      await session.query(
        `insert into k_nex_workspace_pages (application_id, environment, page_id, document_id, state, page_revision, working_copy_revision, access_revision, published_revision_id, dependency_digest, page_json, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
        [page.identity.applicationId, page.identity.environment, page.identity.pageId, page.identity.documentId, page.state, page.revision, page.workingCopyRevision, page.accessRevision, null, null, JSON.stringify(page), page.createdAt, page.updatedAt]
      );
      await this.writeAccess(session, access);
      await session.query(
        `insert into k_nex_workspace_working_copies (application_id, environment, page_id, document_id, working_copy_revision, working_copy_json, updated_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [page.identity.applicationId, page.identity.environment, page.identity.pageId, page.identity.documentId, workingCopy.revision, JSON.stringify(workingCopy), workingCopy.updatedAt]
      );
      return { result: page, page, workingCopyRevision: workingCopy.revision, accessRevision: access.accessRevision };
    });
  }

  async saveWorkingCopy(identityValue: unknown, changeValue: unknown, updatedByValue: unknown): Promise<WorkspaceWorkingCopy> {
    const identity = parseIdentity(identityValue);
    const change = WorkspaceWorkingCopyChangeInputSchema.safeParse(changeValue);
    if (!change.success) fail("INVALID_INPUT", "Workspace working-copy change is invalid.");
    const updatedBy = assertActor(updatedByValue);
    if (change.data.document.id !== identity.documentId || change.data.document.version !== change.data.expectedRevision + 1) fail("INVALID_INPUT", "Workspace working-copy document revision is invalid.");
    return this.mutate(identity, "working-copy", change.data.idempotencyKey, change.data, updatedBy, parseWorkingCopy, async (session) => {
      const current = await this.readPageLocked(session, identity);
      if (current.state === "archived" || current.workingCopyRevision !== change.data.expectedRevision) fail("REVISION_CONFLICT", "Workspace working copy changed or is archived.");
      const occurredAt = timestamp(this.now);
      const workingCopy = parseWorkingCopy({ schemaVersion: 1, identity, revision: change.data.document.version, document: change.data.document, editorSessionId: change.data.editorSessionId, idempotencyKey: change.data.idempotencyKey, updatedBy, updatedAt: occurredAt });
      const page = parsePage({ ...current, workingCopyRevision: workingCopy.revision, revision: current.revision + 1, updatedBy, updatedAt: occurredAt });
      const updated = await session.query(
        `update k_nex_workspace_pages set page_revision=$4, working_copy_revision=$5, page_json=$6::jsonb, updated_at=$7 where application_id=$1 and environment=$2 and page_id=$3 and page_revision=$8`,
        [identity.applicationId, identity.environment, identity.pageId, page.revision, workingCopy.revision, JSON.stringify(page), occurredAt, current.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Workspace page changed before autosave committed.");
      const workingUpdated = await session.query(
        `update k_nex_workspace_working_copies set working_copy_revision=$4, working_copy_json=$5::jsonb, updated_at=$6 where application_id=$1 and environment=$2 and page_id=$3 and working_copy_revision=$7`,
        [identity.applicationId, identity.environment, identity.pageId, workingCopy.revision, JSON.stringify(workingCopy), occurredAt, change.data.expectedRevision]
      );
      if (workingUpdated.rowCount !== 1) fail("REVISION_CONFLICT", "Workspace working copy changed before autosave committed.");
      return { result: workingCopy, page, workingCopyRevision: workingCopy.revision, accessRevision: page.accessRevision };
    });
  }

  async updateMetadata(input: Readonly<{ currentRevision: number; page: unknown; idempotencyKey: string }>): Promise<WorkspacePage> {
    const next = parsePage(input.page);
    assertIdempotencyKey(input.idempotencyKey);
    return this.mutate(next.identity, "metadata", input.idempotencyKey, input, next.updatedBy, parsePage, async (session) => {
      const current = await this.readPageLocked(session, next.identity);
      if (current.revision !== input.currentRevision || next.revision !== current.revision + 1) fail("REVISION_CONFLICT", "Workspace page metadata revision changed.");
      const immutable = (value: WorkspacePage) => ({ identity: value.identity, createdBy: value.createdBy, createdAt: value.createdAt, workingCopyRevision: value.workingCopyRevision, accessRevision: value.accessRevision, publishedRevisionId: value.publishedRevisionId, dependencyDigest: value.dependencyDigest });
      if (canonicalJson(immutable(current)) !== canonicalJson(immutable(next)) || ![current.state, "archived"].includes(next.state)) fail("INVALID_INPUT", "Workspace page metadata changed protected publication state.");
      const updated = await session.query(
        `update k_nex_workspace_pages set state=$4, page_revision=$5, page_json=$6::jsonb, updated_at=$7 where application_id=$1 and environment=$2 and page_id=$3 and page_revision=$8`,
        [next.identity.applicationId, next.identity.environment, next.identity.pageId, next.state, next.revision, JSON.stringify(next), next.updatedAt, current.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Workspace page metadata changed before commit.");
      return { result: next, page: next, workingCopyRevision: next.workingCopyRevision, accessRevision: next.accessRevision };
    });
  }

  async replaceAccess(input: Readonly<{
    access: unknown;
    expectedPageRevision: number;
    expectedAccessRevision: number;
    idempotencyKey: string;
    updatedBy: unknown;
  }>): Promise<WorkspacePageAccessSnapshot> {
    const access = parseAccess(input.access);
    const updatedBy = assertActor(input.updatedBy);
    assertIdempotencyKey(input.idempotencyKey);
    if (access.accessRevision !== input.expectedAccessRevision + 1) fail("REVISION_CONFLICT", "Workspace page access revision is not the next revision.");
    return this.mutate(access.identity, "access", input.idempotencyKey, input, updatedBy, parseAccess, async (session) => {
      const current = await this.readPageLocked(session, access.identity);
      if (current.state === "archived" || current.revision !== input.expectedPageRevision || current.accessRevision !== input.expectedAccessRevision) fail("REVISION_CONFLICT", "Workspace page access changed or is archived.");
      const occurredAt = timestamp(this.now);
      const page = parsePage({ ...current, accessRevision: access.accessRevision, revision: current.revision + 1, updatedBy, updatedAt: occurredAt });
      await session.query(`delete from k_nex_workspace_page_access where application_id=$1 and environment=$2 and page_id=$3`, [access.identity.applicationId, access.identity.environment, access.identity.pageId]);
      await this.writeAccess(session, access);
      const updated = await session.query(
        `update k_nex_workspace_pages set page_revision=$4, access_revision=$5, page_json=$6::jsonb, updated_at=$7 where application_id=$1 and environment=$2 and page_id=$3 and page_revision=$8 and access_revision=$9`,
        [access.identity.applicationId, access.identity.environment, access.identity.pageId, page.revision, access.accessRevision, JSON.stringify(page), occurredAt, current.revision, current.accessRevision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Workspace page access changed before commit.");
      return { result: access, page, workingCopyRevision: page.workingCopyRevision, accessRevision: access.accessRevision };
    });
  }

  async publish(input: Readonly<{ page: unknown; revision: unknown; pointer: unknown; receipt: unknown }>): Promise<WorkspacePublicationReceipt> {
    const page = parsePage(input.page);
    const revision = parsePublishedRevision(input.revision);
    const pointer = parsePointer(input.pointer);
    const receipt = parseReceipt(input.receipt);
    assertAligned(page.identity, revision, pointer, receipt);
    if (receipt.operation !== "publish" || receipt.publishedRevisionId !== revision.revisionId || pointer.publishedRevisionId !== revision.revisionId ||
      receipt.pointerRevision !== pointer.pointerRevision || receipt.accessRevision !== revision.accessRevision || receipt.dependencyDigest !== revision.dependencies.digest ||
      page.state !== "published" || page.publishedRevisionId !== revision.revisionId || page.dependencyDigest !== revision.dependencies.digest) fail("INVALID_INPUT", "Workspace publication values diverged.");
    return this.mutate(page.identity, "publish", receipt.idempotencyKey, input, receipt.requestedBy, parseReceipt, async (session) => {
      const current = await this.readPageLocked(session, page.identity);
      const currentPointer = await this.readPointerLocked(session, page.identity);
      const workingCopy = await this.readWorkingCopyLocked(session, page.identity);
      if (current.state === "archived" || page.revision !== current.revision + 1 || page.workingCopyRevision !== current.workingCopyRevision || revision.documentRevision !== workingCopy.revision ||
        canonicalJson(revision.document) !== canonicalJson(workingCopy.document) || revision.accessRevision !== current.accessRevision ||
        pointer.pointerRevision !== (currentPointer?.pointerRevision ?? 0) + 1 || pointer.previousPublishedRevisionId !== currentPointer?.publishedRevisionId ||
        receipt.previousPublishedRevisionId !== currentPointer?.publishedRevisionId || receipt.accessRevision !== current.accessRevision ||
        canonicalJson(this.pagePublicationStable(current)) !== canonicalJson(this.pagePublicationStable(page)) || canonicalJson(current.themeProfile ?? null) !== canonicalJson(page.themeProfile ?? null) ||
        canonicalJson(page.themeProfile ?? null) !== canonicalJson(revision.themeProfile ?? null) || canonicalJson(page.updatedBy) !== canonicalJson(receipt.requestedBy)) fail("REVISION_CONFLICT", "Workspace publication inputs are stale.");
      await session.query(
        `insert into k_nex_workspace_published_revisions (application_id, environment, page_id, revision_id, document_id, document_revision, dependency_digest, revision_json, published_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [page.identity.applicationId, page.identity.environment, page.identity.pageId, revision.revisionId, page.identity.documentId, revision.documentRevision, revision.dependencies.digest, JSON.stringify(revision), revision.publishedAt]
      );
      await this.writePointer(session, pointer, currentPointer === undefined);
      await this.writeReceipt(session, receipt);
      await this.writePage(session, current, page);
      return { result: receipt, page, workingCopyRevision: page.workingCopyRevision, accessRevision: page.accessRevision, pointerRevision: pointer.pointerRevision };
    });
  }

  async rollback(input: Readonly<{ page: unknown; pointer: unknown; receipt: unknown }>): Promise<WorkspacePublicationReceipt> {
    const page = parsePage(input.page);
    const pointer = parsePointer(input.pointer);
    const receipt = parseReceipt(input.receipt);
    assertAligned(page.identity, pointer, receipt);
    if (receipt.operation !== "rollback" || receipt.publishedRevisionId !== pointer.publishedRevisionId || receipt.pointerRevision !== pointer.pointerRevision ||
      receipt.dependencyDigest !== page.dependencyDigest || page.publishedRevisionId !== pointer.publishedRevisionId || page.state !== "published") fail("INVALID_INPUT", "Workspace rollback values diverged.");
    return this.mutate(page.identity, "rollback", receipt.idempotencyKey, input, receipt.requestedBy, parseReceipt, async (session) => {
      const current = await this.readPageLocked(session, page.identity);
      const currentPointer = await this.readPointerLocked(session, page.identity);
      const target = await this.readRevisionLocked(session, page.identity, pointer.publishedRevisionId);
      if (current.state !== "published" || !currentPointer || !target || page.revision !== current.revision + 1 || pointer.pointerRevision !== currentPointer.pointerRevision + 1 ||
        pointer.previousPublishedRevisionId !== currentPointer.publishedRevisionId || receipt.previousPublishedRevisionId !== currentPointer.publishedRevisionId ||
        receipt.accessRevision !== current.accessRevision || page.accessRevision !== current.accessRevision || page.workingCopyRevision !== current.workingCopyRevision ||
        target.dependencies.digest !== receipt.dependencyDigest || canonicalJson(this.pagePublicationStable(current)) !== canonicalJson(this.pagePublicationStable(page)) ||
        canonicalJson(page.themeProfile ?? null) !== canonicalJson(target.themeProfile ?? null) || canonicalJson(page.updatedBy) !== canonicalJson(receipt.requestedBy)) fail("REVISION_CONFLICT", "Workspace rollback inputs are stale or unavailable.");
      await this.writePointer(session, pointer, false);
      await this.writeReceipt(session, receipt);
      await this.writePage(session, current, page);
      return { result: receipt, page, workingCopyRevision: page.workingCopyRevision, accessRevision: page.accessRevision, pointerRevision: pointer.pointerRevision };
    });
  }

  async readPublishedRevision(identityValue: unknown, revisionId: string): Promise<WorkspacePublishedRevision | undefined> {
    const identity = parseIdentity(identityValue);
    const result = await this.pool.query<PublishedRevisionRow>(
      `select revision_json from k_nex_workspace_published_revisions where application_id=$1 and environment=$2 and page_id=$3 and revision_id=$4`,
      [identity.applicationId, identity.environment, identity.pageId, revisionId]
    );
    return result.rows[0] ? parsePublishedRevision(result.rows[0].revision_json) : undefined;
  }

  private async mutate<T>(
    identity: WorkspacePageIdentity,
    kind: WorkspacePageOperationKind,
    idempotencyKey: string,
    request: unknown,
    actorValue: unknown,
    parseResult: (value: unknown) => T,
    work: (session: RuntimeExtensionSession) => Promise<MutationResult<T>>
  ): Promise<T> {
    assertIdempotencyKey(idempotencyKey);
    const actor = assertActor(actorValue);
    const requestDigest = digest(request);
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([identity.applicationId, identity.environment, identity.pageId])]);
      const existing = await session.query<OperationRow>(
        `select operation_kind, request_digest, result_json from k_nex_workspace_page_operations where application_id=$1 and environment=$2 and page_id=$3 and idempotency_key=$4 for update`,
        [identity.applicationId, identity.environment, identity.pageId, idempotencyKey]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].operation_kind !== kind || existing.rows[0].request_digest !== requestDigest) fail("IDEMPOTENCY_CONFLICT", "Workspace page idempotency key was reused for different input.");
        const replay = parseResult(existing.rows[0].result_json);
        await session.query("commit");
        return replay;
      }
      const mutation = await work(session);
      const eventId = randomUUID();
      const occurredAt = timestamp(this.now);
      const safeEvent = Object.freeze({
        schemaVersion: 1,
        eventId,
        eventType: "workspace-page.changed",
        operation: kind,
        applicationId: identity.applicationId,
        environment: identity.environment,
        pageId: identity.pageId,
        pageRevision: mutation.page.revision,
        workingCopyRevision: mutation.workingCopyRevision,
        accessRevision: mutation.accessRevision,
        ...(mutation.pointerRevision === undefined ? {} : { pointerRevision: mutation.pointerRevision }),
        occurredAt
      });
      const safeAudit = Object.freeze({ ...safeEvent, actor });
      await session.query(
        `insert into k_nex_workspace_page_audit (audit_id, application_id, environment, page_id, operation_kind, event_json, created_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [randomUUID(), identity.applicationId, identity.environment, identity.pageId, kind, JSON.stringify(safeAudit), occurredAt]
      );
      await session.query(
        `insert into k_nex_workspace_page_outbox (event_id, application_id, environment, page_id, operation_kind, page_revision, event_json, created_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [eventId, identity.applicationId, identity.environment, identity.pageId, kind, mutation.page.revision, JSON.stringify(safeEvent), occurredAt]
      );
      await session.query(
        `insert into k_nex_workspace_page_operations (application_id, environment, page_id, idempotency_key, operation_kind, request_digest, result_json, created_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [identity.applicationId, identity.environment, identity.pageId, idempotencyKey, kind, requestDigest, JSON.stringify(mutation.result), occurredAt]
      );
      await session.query("commit");
      return mutation.result;
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }

  private async readPageLocked(session: RuntimeExtensionSession, identity: WorkspacePageIdentity): Promise<WorkspacePage> {
    const result = await session.query<PageRow>(
      `select page_json from k_nex_workspace_pages where application_id=$1 and environment=$2 and page_id=$3 for update`,
      [identity.applicationId, identity.environment, identity.pageId]
    );
    if (!result.rows[0]) fail("NOT_FOUND", "Workspace page was not found.");
    const page = parsePage(result.rows[0].page_json);
    if (!sameIdentity(identity, page.identity)) fail("INVALID_INPUT", "Stored workspace page identity is invalid.");
    return page;
  }

  private async readWorkingCopyLocked(session: RuntimeExtensionSession, identity: WorkspacePageIdentity): Promise<WorkspaceWorkingCopy> {
    const result = await session.query<WorkingCopyRow>(
      `select working_copy_json from k_nex_workspace_working_copies where application_id=$1 and environment=$2 and page_id=$3 for update`,
      [identity.applicationId, identity.environment, identity.pageId]
    );
    if (!result.rows[0]) fail("NOT_FOUND", "Workspace working copy was not found.");
    return parseWorkingCopy(result.rows[0].working_copy_json);
  }

  private async readPointerLocked(session: RuntimeExtensionSession, identity: WorkspacePageIdentity): Promise<WorkspacePublicationPointer | undefined> {
    const result = await session.query<PointerRow>(
      `select pointer_json from k_nex_workspace_publication_pointers where application_id=$1 and environment=$2 and page_id=$3 for update`,
      [identity.applicationId, identity.environment, identity.pageId]
    );
    return result.rows[0] ? parsePointer(result.rows[0].pointer_json) : undefined;
  }

  private async readRevisionLocked(session: RuntimeExtensionSession, identity: WorkspacePageIdentity, revisionId: string): Promise<WorkspacePublishedRevision | undefined> {
    const result = await session.query<PublishedRevisionRow>(
      `select revision_json from k_nex_workspace_published_revisions where application_id=$1 and environment=$2 and page_id=$3 and revision_id=$4 for share`,
      [identity.applicationId, identity.environment, identity.pageId, revisionId]
    );
    return result.rows[0] ? parsePublishedRevision(result.rows[0].revision_json) : undefined;
  }

  private async writeAccess(session: RuntimeExtensionSession, access: WorkspacePageAccessSnapshot): Promise<void> {
    for (const assignment of access.assignments) {
      const subjectKind = assignment.subject.kind;
      const subjectId = subjectKind === "role" ? assignment.subject.roleId : assignment.subject.userId;
      await session.query(
        `insert into k_nex_workspace_page_access (application_id, environment, page_id, access_revision, subject_kind, subject_id, capability) values ($1,$2,$3,$4,$5,$6,$7)`,
        [access.identity.applicationId, access.identity.environment, access.identity.pageId, access.accessRevision, subjectKind, subjectId, assignment.capability]
      );
    }
  }

  private async writePointer(session: RuntimeExtensionSession, pointer: WorkspacePublicationPointer, create: boolean): Promise<void> {
    const values = [pointer.identity.applicationId, pointer.identity.environment, pointer.identity.pageId, pointer.pointerRevision, pointer.publishedRevisionId, JSON.stringify(pointer), pointer.updatedAt];
    const result = create
      ? await session.query(`insert into k_nex_workspace_publication_pointers (application_id, environment, page_id, pointer_revision, published_revision_id, pointer_json, updated_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7)`, values)
      : await session.query(`update k_nex_workspace_publication_pointers set pointer_revision=$4, published_revision_id=$5, pointer_json=$6::jsonb, updated_at=$7 where application_id=$1 and environment=$2 and page_id=$3 and pointer_revision=$8`, [...values, pointer.pointerRevision - 1]);
    if (!create && result.rowCount !== 1) fail("REVISION_CONFLICT", "Workspace publication pointer changed before commit.");
  }

  private async writeReceipt(session: RuntimeExtensionSession, receipt: WorkspacePublicationReceipt): Promise<void> {
    await session.query(
      `insert into k_nex_workspace_publication_receipts (application_id, environment, page_id, receipt_id, idempotency_key, pointer_revision, receipt_json, occurred_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [receipt.identity.applicationId, receipt.identity.environment, receipt.identity.pageId, receipt.receiptId, receipt.idempotencyKey, receipt.pointerRevision, JSON.stringify(receipt), receipt.occurredAt]
    );
  }

  private async writePage(session: RuntimeExtensionSession, current: WorkspacePage, page: WorkspacePage): Promise<void> {
    const result = await session.query(
      `update k_nex_workspace_pages set state=$4, page_revision=$5, working_copy_revision=$6, access_revision=$7, published_revision_id=$8, dependency_digest=$9, page_json=$10::jsonb, updated_at=$11 where application_id=$1 and environment=$2 and page_id=$3 and page_revision=$12`,
      [page.identity.applicationId, page.identity.environment, page.identity.pageId, page.state, page.revision, page.workingCopyRevision, page.accessRevision, page.publishedRevisionId ?? null, page.dependencyDigest ?? null, JSON.stringify(page), page.updatedAt, current.revision]
    );
    if (result.rowCount !== 1) fail("REVISION_CONFLICT", "Workspace page changed before publication committed.");
  }

  private pagePublicationStable(page: WorkspacePage): unknown {
    return {
      identity: page.identity,
      title: page.title,
      description: page.description ?? null,
      navigation: page.navigation,
      workingCopyRevision: page.workingCopyRevision,
      accessRevision: page.accessRevision,
      createdBy: page.createdBy,
      createdAt: page.createdAt
    };
  }
}
