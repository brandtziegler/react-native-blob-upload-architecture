// src/application/SendToCloudController.ts
//
// Purpose:
// - UI-facing controller that runs the staged upload flow via UploadOrchestrator
// - Emits stage + status updates (mirrors your "controller.step('Init') / fail() / complete()" vibe)
// - Supports cancellation (AbortSignal) and single-flight safety
//
// Non-runnable by design. This repo is an architecture artifact, not your full app.

import { UploadStage } from "../domain/UploadStage";
import { UploadError } from "../domain/Errors";
import type { UploadOrchestrator } from "./UploadOrchestrator";

export type UploadStatus = "idle" | "running" | "success" | "failure" | "cancelled";

export type SendToCloudRequest = {
  // Keep this intentionally light — in your real app this would be WorkOrd + auth context.
  localSheetId: number;
  remoteSheetId?: number | null;

  // Work order metadata used for folder paths / blob paths / emails in the real system
  remoteWorkOrderNumber?: number | null;
  customerPathToRoot?: string | null;

  // Optional “knobs” (in real code this maps to your toggles like exportInvoice, etc.)
  flags?: {
    exportInvoice?: boolean;
    sendEmails?: boolean;
  };
};

export type SendToCloudResult = {
  status: UploadStatus;
  finalStage: UploadStage;
  remoteSheetId?: number | null;
  message?: string;
  error?: UploadError | null;
};

type Unsubscribe = () => void;

type Listener<T> = (value: T) => void;

function asUploadError(err: unknown): UploadError {
  if (err instanceof UploadError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new UploadError("UNEXPECTED", msg);
}

/**
 * SendToCloudController
 * - “owns” one upload at a time
 * - emits stage + status updates
 * - delegates real work to UploadOrchestrator
 */
export class SendToCloudController {
  private readonly orchestrator: UploadOrchestrator;

  private status: UploadStatus = "idle";
  private stage: UploadStage = UploadStage.PreInit;

  private statusListeners = new Set<Listener<UploadStatus>>();
  private stageListeners = new Set<Listener<UploadStage>>();
  private messageListeners = new Set<Listener<string>>();

  private inflight: Promise<SendToCloudResult> | null = null;
  private aborter: AbortController | null = null;

  constructor(orchestrator: UploadOrchestrator) {
    this.orchestrator = orchestrator;
  }

  // --- subscriptions ---------------------------------------------------------

  onStatus(fn: Listener<UploadStatus>): Unsubscribe {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  onStage(fn: Listener<UploadStage>): Unsubscribe {
    this.stageListeners.add(fn);
    fn(this.stage);
    return () => this.stageListeners.delete(fn);
  }

  onMessage(fn: Listener<string>): Unsubscribe {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  // --- state helpers ---------------------------------------------------------

  getStatus(): UploadStatus {
    return this.status;
  }

  getStage(): UploadStage {
    return this.stage;
  }

  private setStatus(next: UploadStatus) {
    this.status = next;
    for (const fn of this.statusListeners) fn(next);
  }

  private setStage(next: UploadStage) {
    this.stage = next;
    for (const fn of this.stageListeners) fn(next);
  }

  private say(msg: string) {
    for (const fn of this.messageListeners) fn(msg);
  }

  // --- public API ------------------------------------------------------------

  /**
   * Starts the staged upload flow.
   * Single-flight: if one is running, you get the same promise back.
   */
  send(req: SendToCloudRequest): Promise<SendToCloudResult> {
    if (this.inflight) return this.inflight;

    this.aborter = new AbortController();
    const signal = this.aborter.signal;

    this.setStatus("running");
    this.setStage(UploadStage.PreInit);
    this.say("Starting upload…");

    this.inflight = (async (): Promise<SendToCloudResult> => {
      try {
        const result = await this.orchestrator.run(req, {
          signal,
          onStage: (s) => {
            this.setStage(s);
            this.say(`Stage: ${String(s)}`);
          },
          onNote: (m) => this.say(m),
        });

        // Orchestrator decides whether "Done" means success.
        this.setStage(result.finalStage);
        this.setStatus(result.status);

        if (result.status === "success") this.say("Upload complete.");
        if (result.status === "cancelled") this.say("Upload cancelled.");
        if (result.status === "failure") this.say("Upload failed.");

        return result;
      } catch (err: unknown) {
        // Cancellation is treated as cancelled if abort was requested
        if (signal.aborted) {
          const out: SendToCloudResult = {
            status: "cancelled",
            finalStage: this.stage,
            remoteSheetId: req.remoteSheetId ?? null,
            message: "Cancelled",
            error: null,
          };
          this.setStatus("cancelled");
          return out;
        }

        const upErr = asUploadError(err);
        const out: SendToCloudResult = {
          status: "failure",
          finalStage: this.stage,
          remoteSheetId: req.remoteSheetId ?? null,
          message: upErr.message,
          error: upErr,
        };
        this.setStatus("failure");
        return out;
      } finally {
        // reset single-flight latch
        this.inflight = null;
        this.aborter = null;
      }
    })();

    return this.inflight;
  }

  /**
   * Cancels the current upload if one is running.
   */
  cancel(reason = "User cancelled") {
    if (!this.aborter) return;
    this.say(reason);
    this.aborter.abort();
    // status will be resolved by the promise catch/finally path
  }

  /**
   * Convenience helpers if you want a “step/fail/complete” vibe like your existing controller.
   * These are NOT used by orchestrator; they’re here to match the mental model.
   */
  step(label: "Init" | "Folder" | "Upload" | "Finalize") {
    // map your labels to UploadStage
    const map: Record<typeof label, UploadStage> = {
      Init: UploadStage.Init,
      Folder: UploadStage.Folder,
      Upload: UploadStage.Upload,
      Finalize: UploadStage.Finalize,
    };
    this.setStage(map[label]);
    this.say(`Step: ${label}`);
  }

  fail(message: string) {
    this.setStatus("failure");
    this.say(message);
  }

  complete() {
    this.setStatus("success");
    this.setStage(UploadStage.Done);
    this.say("Complete.");
  }
}
