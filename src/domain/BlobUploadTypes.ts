// src/domain/BlobUploadTypes.ts
/**
 * Stable DTOs for a direct-to-Blob upload pipeline.
 * Intentionally non-runnable: no real endpoints, no secrets, no blob-path conventions.
 */

/** Brand types (keeps contracts readable without leaking semantics). */
export type WorkOrderId = string;
export type BatchId = string;

/** File categories the pipeline understands. */
export type UploadFileType = "pdf" | "partImage";

/** Minimal file metadata the client can send to request an upload plan. */
export type UploadFileDescriptor = {
  /** Client-chosen name (often a filename). Must match what will be uploaded. */
  name: string;
  type: UploadFileType;

  /** Optional metadata for planning/telemetry. */
  sizeBytes?: number;
  contentType?: string; // e.g. "application/pdf", "image/jpeg"
};

/** Returned per file from StartBlobBatch. */
export type UploadPlanFile = {
  name: string;
  container: string; // redacted semantics; treat as opaque
  blobPath: string;  // redacted semantics; treat as opaque
  sasUrl: string;    // pre-signed URL for direct PUT
  contentType?: string;
};

/** Start/Plan request (RN -> API). */
export type StartBlobBatchRequest = {
  workOrderId: WorkOrderId;
  batchId: BatchId;

  /** Redacted business context: keep optional + opaque. */
  custPath?: string;
  workOrderFolderId?: string;
  pdfFolderId?: string;
  imagesFolderId?: string;
  expensesFolderId?: string;

  /** Client hint; server may clamp. */
  clientParallelism?: number;

  /** Metadata only; bytes are uploaded direct-to-Blob. */
  files: UploadFileDescriptor[];
};

/** Start/Plan response (API -> RN). */
export type StartBlobBatchResponse = {
  workOrderId: WorkOrderId;
  batchId: BatchId;
  files: UploadPlanFile[];
  recommendedParallelism?: number;
};

/** Finalize request (RN -> API): "verify these targets exist". */
export type FinalizeBlobBatchRequest = {
  workOrderId: WorkOrderId;
  batchId: BatchId;
  files: Array<Pick<UploadPlanFile, "name" | "container" | "blobPath">>;
};

/** Finalize response (API -> RN). */
export type FinalizeBlobBatchResponse = {
  finalizeOk: boolean;
  plannedCount: number;
  uploadedOk: number;
  uploadedFailed?: string[]; // names (or opaque identifiers)
  message?: string;
};

/** Enqueue post-processing request (RN -> API). */
export type EnqueueBlobPostProcessingRequest = {
  workOrderId: WorkOrderId;
  batchId: BatchId;

  /** Optional, redacted context (opaque). */
  custPath?: string;
  workOrderFolderId?: string;
  pdfFolderId?: string;
  imagesFolderId?: string;
  expensesFolderId?: string;
  testPrefix?: string;

  files: Array<Pick<UploadPlanFile, "name" | "container" | "blobPath" | "contentType">>;
};

/** Enqueue response (API -> RN). Keep generic. */
export type EnqueueBlobPostProcessingResponse = {
  enqueued: boolean;
  jobId?: string;      // opaque
  message?: string;
};

/** Convenience union for “what the RN upload call returns”. */
export type UploadAzureResult = FinalizeBlobBatchResponse & {
  // optional: include enqueue acknowledgement if your UI wants it
  enqueue?: EnqueueBlobPostProcessingResponse;
};

/** Optional per-file timing metrics (safe to publish). */
export type UploadFileMetric = {
  name: string;
  bytes: number;
  ms: number;
};

/** Optional wall-clock metrics summary. */
export type UploadWallMetrics = {
  pool: number;
  fileCount: number;
  totalBytes: number;
  wallMs: number;
};
