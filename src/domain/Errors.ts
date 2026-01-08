// src/domain/Errors.ts
/**
 * Error model for the non-runnable upload architecture repo.
 * Keep it boring, typed, and easy to map to UI messages.
 */

import type { UploadStage } from "./UploadStage";

export type ErrorCode =
  | "NO_INTERNET"
  | "START_BATCH_FAILED"
  | "UPLOAD_PUT_FAILED"
  | "FINALIZE_FAILED"
  | "ENQUEUE_FAILED"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "CANCELLED"
  | "UNKNOWN";

/** A safe, serializable error shape (good for logs + persistence). */
export type UploadError = {
  code: ErrorCode;
  stage: UploadStage;
  message: string;

  /** Optional machine-friendly details (never secrets). */
  details?: Record<string, unknown>;

  /** Optional file name involved (no full paths). */
  fileName?: string;

  /** Useful for retry decisions. */
  retryable?: boolean;

  /** Optional HTTP-ish info when errors come from network calls. */
  http?: {
    status?: number;
    endpoint?: string; // keep generic; do not store real domains
  };

  /** Timestamp for local tracker rows. */
  atMs?: number;
};

export function nowMs(): number {
  return Date.now();
}

export function makeError(
  code: ErrorCode,
  stage: UploadStage,
  message: string,
  extras?: Partial<Omit<UploadError, "code" | "stage" | "message">>
): UploadError {
  return {
    code,
    stage,
    message,
    atMs: nowMs(),
    ...extras,
  };
}

/** Converts unknown thrown values into a safe UploadError. */
export function fromUnknown(
  stage: UploadStage,
  err: unknown,
  fallbackCode: ErrorCode = "UNKNOWN"
): UploadError {
  if (err && typeof err === "object") {
    const anyErr = err as any;
    const msg =
      typeof anyErr.message === "string"
        ? anyErr.message
        : typeof anyErr.toString === "function"
          ? String(anyErr.toString())
          : "Unexpected error";
    return makeError(fallbackCode, stage, msg);
  }
  return makeError(fallbackCode, stage, String(err ?? "Unexpected error"));
}

/**
 * Simple retry policy helper used by stubs.
 * Keep the logic generic; real production tuning is redacted.
 */
export function isRetryable(e: UploadError): boolean {
  if (e.retryable === true) return true;
  if (e.code === "NO_INTERNET") return false;
  if (e.code === "INVALID_INPUT") return false;
  if (e.code === "CANCELLED") return false;

  const status = e.http?.status;
  if (typeof status === "number") {
    // Typical transient statuses
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    // Otherwise: assume not retryable unless explicitly marked
    return false;
  }

  // Default conservative choice for unknown failures
  return e.code !== "FINALIZE_FAILED";
}

/** Backoff helper (publishable). */
export function backoffMs(attempt: number, baseMs = 500, maxMs = 8_000): number {
  const pow = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  // small jitter
  const jitter = Math.floor(Math.random() * 150);
  return Math.min(maxMs, pow + jitter);
}

