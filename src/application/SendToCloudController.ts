// src/application/SendToCloudController.ts
//
// Purpose:
// - UI-facing controller that runs the staged upload flow via UploadOrchestrator
// - Emits stage + status updates (mirrors your "controller.step('Init') / fail() / complete()" vibe)
// - Supports cancellation (best-effort) and single-flight safety
//
// Non-runnable by design. This repo is an architecture artifact, not your full app.

import { UploadStage } from "../domain/UploadStage";
import { UploadError, UploadErrorCode } from "../domain/Errors";
import type {
  UploadOrchestrator,
  UploadOrchestratorInput,
  UploadOrchestratorResult,
} from "./UploadOrchestrator";

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
  finalStage: (typeof UploadStage)[keyof typeof UploadStage];
  remoteSheetId?: number | null;
  message?: string;
  error?: UploadError | null;
};

type Unsubscribe = () => void;
type Listener<T> = (value: T) => void;

function asUploadError(err: unknown): UploadError {
  if (err instanceof UploadError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new UploadError(UploadErrorCode.Unexpected, message);
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
  private stage: (typeof UploadStage)[keyof typeof UploadStage] = UploadStage.Init;

  private statusListeners = new Set<Listener<UploadStatus>>();
  private stageListeners = new Set<Listener<(typeof UploadStage)[keyof typeof UploadStage]>>();
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

  onStage(fn: Listener<(typeof UploadStage)[keyof typeof UploadStage]>): Unsubscribe {
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

  getStage(): (typeof UploadStage)[keyof typeof UploadStage] {
    return this.stage;
  }

  private setStatus(next: UploadStatus) {
    this.status = next;
    for (const fn of this.statusListeners) fn(next);
  }

  private setStage(next: (typeof UploadStage)[keyof typeof UploadStage]) {
    this.stage = next;
    for (const fn of this.stageListeners) fn(next);
  }

  private say(msg: string) {
    for (const fn of this.messageListeners) fn(msg);
  }

  private makeBatchId(req: SendToCloudRequest): string {
    // In your real app: stableDeviceId (or deviceId + workOrderId).
    // For this repo artifact: deterministic, non-secret.
    return `batch_local_${req.localSheetId}`;
  }

  private makeWorkOrderId(req: SendToCloudRequest): string {
    // Prefer true WO# if provided; otherwise fall back to remoteSheetId then localSheetId.
    const wo =
      req.remoteWorkOrderNumber ??
      req.remoteSheetId ??
      req.localSheetId;

    return String(wo);
  }

  private buildOrchestratorInput(req: SendToCloudRequest, signal: AbortSignal): UploadOrchestratorInput {
    const custPath = req.customerPathToRoot ?? "";
    if (!custPath) {
      throw new UploadError(
        UploadErrorCode.InvalidInput,
        "Missing customerPathToRoot (custPath) required for blob/Drive semantics."
      );
    }

    const input: UploadOrchestratorInput = {
      batchId: this.makeBatchId(req),
      testPrefix: "uploadFromArtifact",
      workOrderId: this.makeWorkOrderId(req),

      remoteSheetId: req.remoteSheetId ?? undefined,
      localSheetId: req.localSheetId,

      custPath,

      // Optional: the architecture repo keeps these as optional
      workOrderFolderId: undefined,
      pdfFolderId: undefined,
      imagesFolderId: undefined,

      // Optional scanning hints (the FileScannerPort decides what to do with these)
      pdfFolderPath: undefined,
      imageFolderPath: undefined,

      clientParallelismHint: 8,

      onStage: (s) => {
        // Best-effort cancellation: if UI aborts, throw to unwind the orchestrator.
        if (signal.aborted) {
          throw new Error("Cancelled");
        }
        this.step(s, `Stage: ${String(s)}`);
      },
    };

    return input;
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
    this.setStage(UploadStage.Init);
    this.say("Starting upload…");

    this.inflight = (async (): Promise<SendToCloudResult> => {
      try {
        const orchInput = this.buildOrchestratorInput(req, signal);

        const result: UploadOrchestratorResult = await this.orchestrator.run(orchInput);

        // If the user cancelled, treat it as cancelled regardless of orchestrator outcome.
        if (signal.aborted) {
          const out: SendToCloudResult = {
            status: "cancelled",
            finalStage: this.stage,
            remoteSheetId: req.remoteSheetId ?? null,
            message: "Cancelled",
            error: null,
          };
          this.setStatus("cancelled");
          this.say("Upload cancelled.");
          return out;
        }

        const status: UploadStatus = result.ok ? "success" : "failure";
        const out: SendToCloudResult = {
          status,
          finalStage: result.stage,
          remoteSheetId: req.remoteSheetId ?? null,
          message: result.ok ? "Upload complete." : "Upload failed.",
          error: null,
        };

        this.setStage(result.stage);
        this.setStatus(status);

        if (status === "success") this.say("Upload complete.");
        else this.say("Upload failed.");

        return out;
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
          this.say("Upload cancelled.");
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

        this.fail(`Upload failed — ${upErr.message}`);
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
    this.setStatus("cancelled"); // optimistic UI; promise path will finalize
    this.aborter.abort();
  }

  /**
   * Convenience helpers (matches your controller mental model).
   * These are NOT required by the orchestrator; they're for UI ergonomics.
   */
  step(stage: (typeof UploadStage)[keyof typeof UploadStage], message?: string) {
    this.setStage(stage);
    if (message) this.say(message);
  }

  fail(reason: string) {
    this.setStatus("failure");
    this.setStage(UploadStage.Failure);
    this.say(reason);
  }

  complete() {
    this.setStatus("success");
    this.setStage(UploadStage.Complete);
    this.say("Complete.");
  }

  reset() {
    this.setStage(UploadStage.Init);
    this.setStatus("idle");
  }
}

