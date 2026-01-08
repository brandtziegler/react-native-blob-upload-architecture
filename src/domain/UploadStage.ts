// src/domain/UploadStage.ts
/**
 * Upload stage tracking for the RN → API → Blob → API pipeline.
 * This is intentionally generic (non-runnable) and safe to publish.
 */

export type UploadStage =
  | "Preflight"
  | "Init"
  | "Plan"
  | "Upload"
  | "Finalize"
  | "Enqueue"
  | "Complete"
  | "Failure";

/**
 * A simple status snapshot that can be persisted locally (SQLite) or held in memory.
 * Mirrors the “4 icon” style trackers (Init/Folder/Files/Finalize) while staying generic.
 */
export type UploadStageFlags = {
  uploadInitComplete: 0 | 1;
  uploadPlanComplete: 0 | 1;
  uploadFilesUploaded: 0 | 1;
  uploadDbFinalized: 0 | 1;
  /** Optional: enqueue/post-processing acknowledgement */
  uploadEnqueued?: 0 | 1;
};

/** High-level status string (fits UI + logs). */
export type UploadStatus = "idle" | "running" | "success" | "failure";

/**
 * Event emitted by the orchestrator so UI can update progress.
 * Keep it small and stable: stage + optional message + optional counts.
 */
export type UploadProgressEvent = {
  status: UploadStatus;
  stage: UploadStage;
  message?: string;

  /** Optional progress numbers for uploads */
  plannedCount?: number;
  uploadedCount?: number;
  failedCount?: number;
};

/**
 * Minimal controller interface the orchestrator can call.
 * (In the private codebase this may connect to UI, toasts, and/or persistence.)
 */
export interface UploadController {
  /** Sets the current step/stage. */
  step(stage: Exclude<UploadStage, "Complete" | "Failure">, message?: string): void;

  /** Marks completion. */
  complete(message?: string): void;

  /** Marks failure with a user-facing reason. */
  fail(reason: string): void;

  /** Optional: emit detailed progress events. */
  emit?(evt: UploadProgressEvent): void;
}

/**
 * Helper: convert a stage to flags (useful when writing a local tracker row).
 * Adjust to match your UI icon set without leaking private semantics.
 */
export function stageToFlags(stage: UploadStage): UploadStageFlags {
  return {
    uploadInitComplete: stageRank(stage) >= stageRank("Init") ? 1 : 0,
    uploadPlanComplete: stageRank(stage) >= stageRank("Plan") ? 1 : 0,
    uploadFilesUploaded: stageRank(stage) >= stageRank("Upload") ? 1 : 0,
    uploadDbFinalized: stageRank(stage) >= stageRank("Finalize") ? 1 : 0,
    uploadEnqueued: stageRank(stage) >= stageRank("Enqueue") ? 1 : 0,
  };
}

function stageRank(stage: UploadStage): number {
  switch (stage) {
    case "Preflight":
      return 0;
    case "Init":
      return 1;
    case "Plan":
      return 2;
    case "Upload":
      return 3;
    case "Finalize":
      return 4;
    case "Enqueue":
      return 5;
    case "Complete":
      return 6;
    case "Failure":
      return -1;
    default:
      // exhaustive guard
      return -1;
  }
}
