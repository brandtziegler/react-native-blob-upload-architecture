/**
 * src/domain/UploadStage.ts
 *
 * A tiny, boring stage model for the pipeline:
 *   Scan -> Prep -> Start -> Upload -> Finalize -> Enqueue -> Complete
 *
 * (Keep it generic so you can map your real app's richer stages onto it.)
 */

export const UploadStage = {
  Init: "Init",
  Scan: "Scan",
  Prep: "Prep",
  Start: "Start",
  Upload: "Upload",
  Finalize: "Finalize",
  Enqueue: "Enqueue",
  Complete: "Complete",
  Failure: "Failure",
} as const;

export type UploadStage = (typeof UploadStage)[keyof typeof UploadStage];

export type UploadStatus = "idle" | "running" | "success" | "failure" | "cancelled";

export type UploadStageFlags = {
  initComplete: 0 | 1;
  scanComplete: 0 | 1;
  prepComplete: 0 | 1;
  startComplete: 0 | 1;
  uploadComplete: 0 | 1;
  finalizeComplete: 0 | 1;
  enqueueComplete: 0 | 1;
  complete: 0 | 1;
  failedReason: string;
};

export type UploadProgressEvent = {
  stage: UploadStage;
  status: UploadStatus;
  message?: string;
  nowMs?: number;
};

export interface UploadController {
  /** Move forward one stage. (Pure UI state; real work should already have happened.) */
  step(stage: UploadStage, message?: string): void;

  /** Mark success. */
  complete(message?: string): void;

  /** Mark failure and store a reason. */
  fail(reason: string): void;

  /** Optional event hook for UI/telemetry. */
  emit?(evt: UploadProgressEvent): void;
}

function stageOrder(stage: UploadStage): number {
  switch (stage) {
    case UploadStage.Init:
      return 0;
    case UploadStage.Scan:
      return 1;
    case UploadStage.Prep:
      return 2;
    case UploadStage.Start:
      return 3;
    case UploadStage.Upload:
      return 4;
    case UploadStage.Finalize:
      return 5;
    case UploadStage.Enqueue:
      return 6;
    case UploadStage.Complete:
      return 7;
    case UploadStage.Failure:
    default:
      return -1;
  }
}

/**
 * Converts a stage into "done flags" you can store (SQLite, etc).
 * Flags are cumulative (everything up to the current stage is marked complete).
 */
export function stageToFlags(stage: UploadStage, failedReason = ""): UploadStageFlags {
  const s = stageOrder(stage);

  // Failure is special: keep flags simple and attach the reason.
  if (stage === UploadStage.Failure) {
    return {
      initComplete: 0,
      scanComplete: 0,
      prepComplete: 0,
      startComplete: 0,
      uploadComplete: 0,
      finalizeComplete: 0,
      enqueueComplete: 0,
      complete: 0,
      failedReason: failedReason || "Upload failed.",
    };
  }

  return {
    initComplete: s >= 0 ? 1 : 0,
    scanComplete: s >= 1 ? 1 : 0,
    prepComplete: s >= 2 ? 1 : 0,
    startComplete: s >= 3 ? 1 : 0,
    uploadComplete: s >= 4 ? 1 : 0,
    finalizeComplete: s >= 5 ? 1 : 0,
    enqueueComplete: s >= 6 ? 1 : 0,
    complete: s >= 7 ? 1 : 0,
    failedReason: "",
  };
}
