// src/contracts/blob/BlobBatchApiPort.ts
/**
 * Port: RN (or any client orchestrator) → API that issues SAS upload plans,
 * verifies uploads (Finalize), and enqueues post-processing.
 *
 * Intentionally NON-runnable:
 * - no real base URLs
 * - no auth/session wiring
 * - no storage naming conventions
 */

import type {
  StartBlobBatchRequest,
  StartBlobBatchResponse,
  FinalizeBlobBatchRequest,
  FinalizeBlobBatchResponse,
  EnqueueBlobPostProcessingRequest,
  EnqueueBlobPostProcessingResponse,
} from "../../domain/BlobUploadTypes";
import type { UploadError } from "../../domain/Errors";
import type { UploadStage } from "../../domain/UploadStage";

/** Minimal shape for a network response (safe + generic). */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: UploadError };

/**
 * Optional config the implementation could accept.
 * Keep it generic and publish-safe (no real domains).
 */
export type BlobBatchApiConfig = {
  /** Example: "/api/WorkOrd" (NO hostnames in public repo). */
  basePath: string;

  /** Allows client hinting; server may clamp. */
  defaultClientParallelism?: number;

  /** Timeout policy is private; keep as optional knobs only. */
  timeoutMs?: number;
};

/**
 * Port interface used by your orchestrator (sendToGoogleDrive / uploadBatchDirectToBlob style flow).
 * The *implementation* lives in private code; this repo keeps the contract.
 */
export interface BlobBatchApiPort {
  /** Request an upload plan (SAS URLs) for a batch. */
  startBlobBatch(req: StartBlobBatchRequest): Promise<ApiResult<StartBlobBatchResponse>>;

  /** Ask server to verify the uploaded blobs exist / match expectations. */
  finalizeBlobBatch(req: FinalizeBlobBatchRequest): Promise<ApiResult<FinalizeBlobBatchResponse>>;

  /** Enqueue downstream work (Drive sync / parse / emails / etc). */
  enqueueBlobPostProcessing(
    req: EnqueueBlobPostProcessingRequest
  ): Promise<ApiResult<EnqueueBlobPostProcessingResponse>>;
}

/**
 * Helper used by adapters to map network failures into your domain error model.
 * (Keep it generic; real mapping rules are private.)
 */
export function apiError(
  stage: UploadStage,
  message: string,
  extras?: Partial<UploadError>
): UploadError {
  return {
    code: "UNKNOWN",
    stage,
    message,
    retryable: true,
    atMs: Date.now(),
    ...extras,
  };
}

/**
 * Redacted placeholder implementation.
 * You can keep this in the public repo to show how the orchestrator would depend on the port
 * without providing a runnable client.
 */
export class RedactedBlobBatchApi implements BlobBatchApiPort {
  constructor(private readonly _config: BlobBatchApiConfig) {}

  async startBlobBatch(_req: StartBlobBatchRequest): Promise<ApiResult<StartBlobBatchResponse>> {
    return {
      ok: false,
      error: apiError("Plan", "Redacted: network implementation omitted."),
    };
  }

  async finalizeBlobBatch(_req: FinalizeBlobBatchRequest): Promise<ApiResult<FinalizeBlobBatchResponse>> {
    return {
      ok: false,
      error: apiError("Finalize", "Redacted: network implementation omitted."),
    };
  }

  async enqueueBlobPostProcessing(
    _req: EnqueueBlobPostProcessingRequest
  ): Promise<ApiResult<EnqueueBlobPostProcessingResponse>> {
    return {
      ok: false,
      error: apiError("Enqueue", "Redacted: network implementation omitted."),
    };
  }
}

