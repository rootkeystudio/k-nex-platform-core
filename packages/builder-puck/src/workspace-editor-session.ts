import { UiDocumentSchema, canonicalJson, type UiDocument } from "@k-nex/contracts";

import type { ResolvedPuckBuilderProfile } from "./profile.js";

export interface WorkspaceEditorWorkingCopy {
  readonly revision: number;
  readonly document: UiDocument;
}

export type WorkspaceEditorSaveResult =
  | { readonly status: "saved"; readonly workingCopy: WorkspaceEditorWorkingCopy }
  | { readonly status: "conflict"; readonly workingCopy: WorkspaceEditorWorkingCopy };

export interface WorkspaceEditorPersistence {
  autosave(input: Readonly<{
    expectedRevision: number;
    editorSessionId: string;
    idempotencyKey: string;
    document: UiDocument;
  }>, signal: AbortSignal): Promise<WorkspaceEditorSaveResult>;
  publish(input: Readonly<{ workingCopyRevision: number; idempotencyKey: string }>, signal: AbortSignal): Promise<void>;
  rollback(input: Readonly<{ revisionId: string; idempotencyKey: string }>, signal: AbortSignal): Promise<void>;
}

export type WorkspaceEditorStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "publishing" | "published" | "rolling-back" | "rolled-back" | "error";

export interface WorkspaceEditorState {
  readonly status: WorkspaceEditorStatus;
  readonly document: UiDocument;
  readonly workingCopyRevision: number;
  readonly message: string;
  readonly conflict: WorkspaceEditorWorkingCopy | undefined;
}

interface PendingSave {
  readonly generation: number;
  readonly input: Parameters<WorkspaceEditorPersistence["autosave"]>[0];
  attempts: number;
}

export interface WorkspaceEditorSessionOptions {
  readonly profile: ResolvedPuckBuilderProfile;
  readonly persistence: WorkspaceEditorPersistence;
  readonly workingCopy: WorkspaceEditorWorkingCopy;
  readonly editorSessionId: string;
  readonly issueIdempotencyKey: (operation: "autosave" | "publish" | "rollback", sequence: number) => string;
  readonly debounceMs?: number;
  readonly lostResponseRetryMs?: number;
}

function exactDocument(profile: ResolvedPuckBuilderProfile, value: unknown, revision: number): UiDocument {
  const parsed = UiDocumentSchema.parse(value);
  const document = UiDocumentSchema.parse({ ...parsed, version: revision });
  profile.adapter.toPuckData(document);
  return document;
}

/** Serializes editor writes and never resolves a stale-tab conflict by overwriting it. */
export class WorkspaceEditorSession {
  private readonly listeners = new Set<() => void>();
  private readonly controller = new AbortController();
  private readonly debounceMs: number;
  private readonly lostResponseRetryMs: number;
  private state: WorkspaceEditorState;
  private generation = 0;
  private sequence = 0;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: PendingSave | undefined;
  private saving: Promise<void> | undefined;

  constructor(private readonly options: WorkspaceEditorSessionOptions) {
    this.debounceMs = options.debounceMs ?? 500;
    this.lostResponseRetryMs = options.lostResponseRetryMs ?? 250;
    if (!Number.isSafeInteger(this.debounceMs) || this.debounceMs < 0 || !Number.isSafeInteger(this.lostResponseRetryMs) || this.lostResponseRetryMs < 0) {
      throw new TypeError("Workspace editor timing must use non-negative integer milliseconds.");
    }
    const document = exactDocument(options.profile, options.workingCopy.document, options.workingCopy.revision);
    this.state = Object.freeze({ status: "idle", document, workingCopyRevision: options.workingCopy.revision, conflict: undefined, message: "No unsaved changes." });
  }

  snapshot = (): WorkspaceEditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  change(value: unknown): UiDocument {
    this.assertOpen();
    if (this.state.conflict !== undefined) throw new TypeError("Resolve the workspace editor conflict before editing again.");
    const next = exactDocument(this.options.profile, value, this.state.workingCopyRevision);
    const document = this.options.profile.validateChange(this.state.document, next);
    this.generation += 1;
    this.dirty = true;
    this.setState({ status: "dirty", document, message: "Unsaved changes." });
    this.schedule(this.debounceMs);
    return document;
  }

  async flush(): Promise<void> {
    this.assertOpen();
    this.clearTimer();
    if (this.state.conflict !== undefined || !this.dirty && this.pending === undefined) return;
    if (this.saving !== undefined) {
      await this.saving;
      if (this.dirty && this.state.conflict === undefined && this.state.status !== "error") await this.flush();
      return;
    }
    if (this.pending === undefined) {
      const expectedRevision = this.state.workingCopyRevision;
      const document = exactDocument(this.options.profile, this.state.document, expectedRevision + 1);
      this.pending = {
        generation: this.generation,
        attempts: 0,
        input: {
          expectedRevision,
          editorSessionId: this.options.editorSessionId,
          idempotencyKey: this.options.issueIdempotencyKey("autosave", ++this.sequence),
          document
        }
      };
    }
    const pending = this.pending;
    pending.attempts += 1;
    this.setState({ status: "saving", message: "Saving changes…" });
    this.saving = this.performSave(pending);
    await this.saving;
  }

  private async performSave(pending: PendingSave): Promise<void> {
    try {
      const result = await this.options.persistence.autosave(pending.input, this.controller.signal);
      if (result.status === "conflict") {
        const conflict = this.validateWorkingCopy(result.workingCopy);
        if (conflict.revision <= pending.input.expectedRevision) throw new TypeError("Workspace editor conflict response is not newer than the attempted write.");
        this.setState({ status: "conflict", conflict, message: "A newer version exists. Reload it before continuing." });
        return;
      }
      const saved = this.validateWorkingCopy(result.workingCopy);
      if (saved.revision !== pending.input.expectedRevision + 1 || canonicalJson(saved.document) !== canonicalJson(pending.input.document)) {
        throw new TypeError("Workspace editor autosave response does not match the accepted write.");
      }
      this.pending = undefined;
      const hasNewerChange = this.generation !== pending.generation;
      const document = hasNewerChange ? exactDocument(this.options.profile, this.state.document, saved.revision) : saved.document;
      this.dirty = hasNewerChange;
      this.setState({ status: hasNewerChange ? "dirty" : "saved", document, workingCopyRevision: saved.revision, conflict: undefined, message: hasNewerChange ? "New changes are waiting to save." : "All changes saved." });
      if (hasNewerChange) this.schedule(this.debounceMs);
    } catch (error) {
      if (this.controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Workspace editor autosave failed.";
      this.setState({ status: "error", message });
      if (pending.attempts === 1) this.schedule(this.lostResponseRetryMs);
    } finally {
      this.saving = undefined;
    }
  }

  reloadConflict(): UiDocument {
    this.assertOpen();
    const conflict = this.state.conflict;
    if (conflict === undefined) throw new TypeError("Workspace editor has no conflict to reload.");
    this.pending = undefined;
    this.dirty = false;
    this.generation += 1;
    this.setState({ status: "saved", document: conflict.document, workingCopyRevision: conflict.revision, conflict: undefined, message: "Reloaded the newer server version." });
    return conflict.document;
  }

  retryAutosave(): void {
    this.assertOpen();
    if (this.pending === undefined || this.state.conflict !== undefined) throw new TypeError("Workspace editor has no retryable autosave.");
    this.schedule(0);
  }

  canRetryAutosave(): boolean {
    return this.pending !== undefined && this.state.conflict === undefined && !this.controller.signal.aborted;
  }

  async publish(): Promise<void> {
    await this.flush();
    this.assertReadyForPublication();
    this.options.profile.validateDocument(this.state.document);
    this.setState({ status: "publishing", message: "Publishing page…" });
    try {
      await this.options.persistence.publish({ workingCopyRevision: this.state.workingCopyRevision, idempotencyKey: this.options.issueIdempotencyKey("publish", ++this.sequence) }, this.controller.signal);
      this.setState({ status: "published", message: "Page published." });
    } catch (error) {
      if (!this.controller.signal.aborted) this.setState({ status: "error", message: error instanceof Error ? error.message : "Workspace page publication failed." });
      throw error;
    }
  }

  async rollback(revisionId: string): Promise<void> {
    this.assertReadyForPublication();
    if (revisionId.length === 0) throw new TypeError("Workspace rollback requires a revision ID.");
    this.setState({ status: "rolling-back", message: "Rolling back page…" });
    try {
      await this.options.persistence.rollback({ revisionId, idempotencyKey: this.options.issueIdempotencyKey("rollback", ++this.sequence) }, this.controller.signal);
      this.setState({ status: "rolled-back", message: "Published page rolled back." });
    } catch (error) {
      if (!this.controller.signal.aborted) this.setState({ status: "error", message: error instanceof Error ? error.message : "Workspace page rollback failed." });
      throw error;
    }
  }

  dispose(): void {
    this.clearTimer();
    this.controller.abort();
    this.listeners.clear();
  }

  private validateWorkingCopy(value: WorkspaceEditorWorkingCopy): WorkspaceEditorWorkingCopy {
    if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new TypeError("Workspace editor response revision is invalid.");
    return Object.freeze({ revision: value.revision, document: exactDocument(this.options.profile, value.document, value.revision) });
  }

  private assertReadyForPublication(): void {
    this.assertOpen();
    if (this.state.conflict !== undefined || this.dirty || this.pending !== undefined || this.saving !== undefined) {
      throw new TypeError("Workspace editor must save or resolve its conflict before publication changes.");
    }
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private assertOpen(): void {
    if (this.controller.signal.aborted) throw new TypeError("Workspace editor session is closed.");
  }

  private setState(change: Partial<WorkspaceEditorState>): void {
    this.state = Object.freeze({ ...this.state, ...change });
    for (const listener of this.listeners) listener();
  }
}
