/**
 * src/domain/Errors.ts
 *
 * A small error model used by the architecture demo.
 * Keep it strict enough for logging + UI, but simple enough to map from your app.
 */

import { UploadStage } from "./UploadStage";

export const UploadErrorCode = {
  // generic / infrastructure
  NoInternet: "NoInternet",
  Cancelled: "Cancelled",
  Timeout: "Timeout",
  InvalidInput: "InvalidInput",

  // pipeline phases
  ScanFailed: "ScanFailed",
  PrepFailed: "PrepFailed",
  StartFailed: "StartFailed",
  MissingUploadPlan: "MissingUploadPlan",
  PutFailed: "PutFailed",
  FinalizeFailed: "FinalizeFailed",
  FinalizeMismatch: "FinalizeMismatch",
  EnqueueFailed: "EnqueueFailed",

  // catch-all
  Unexpected: "Unexpected",
} as const;

export type UploadErrorCode = (typeof UploadErrorCode)[keyof typeof UploadErrorCode];

export type UploadErrorMeta = Record<string, unknown>;

export class UploadError extends Error {
  public readonly code: UploadErrorCode;
  public readonly stage: UploadStage;
  public readonly meta?: UploadErrorMeta;
  public readonly retryable: boolean;
  public readonly nowMs: number;

  constructor(
    code: UploadErrorCode,
    message: string,
    opts?: {
      stage?: UploadStage;
      meta?: UploadErrorMeta;
      retryable?: boolean;
      nowMs?: number;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.stage = opts?.stage ?? UploadStage.Failure;
    this.meta = opts?.meta;
    this.retryable = opts?.retryable ?? isRetryable(code);
    this.nowMs = opts?.nowMs ?? Date.now();

    // Keep the original error available for debugging (Node / RN supported).
    // @ts-expect-error - TS lib differences
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}

export type RetryPolicy = {
  maxAttempts: number; // total attempts (including first)
  baseDelayMs: number; // e.g. 500
  maxDelayMs: number; // e.g. 8000
  jitterMs: number; // e.g. 200
};

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  jitterMs: 200,
};

export function makeError(
  code: UploadErrorCode,
  message: string,
  opts?: {
    stage?: UploadStage;
    meta?: UploadErrorMeta;
    retryable?: boolean;
    cause?: unknown;
  },
): UploadError {
  return new UploadError(code, message, {
    stage: opts?.stage,
    meta: opts?.meta,
    retryable: opts?.retryable,
    cause: opts?.cause,
  });
}

export function fromUnknown(
  err: unknown,
  fallbackCode: UploadErrorCode = UploadErrorCode.Unexpected,
  opts?: { stage?: UploadStage; meta?: UploadErrorMeta },
): UploadError {
  if (err instanceof UploadError) return err;

  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unexpected error";

  return makeError(fallbackCode, message, {
    stage: opts?.stage ?? UploadStage.Failure,
    meta: opts?.meta,
    cause: err,
  });
}

export function isRetryable(code: UploadErrorCode): boolean {
  switch (code) {
    case UploadErrorCode.NoInternet:
    case UploadErrorCode.Timeout:
    case UploadErrorCode.PutFailed:
    case UploadErrorCode.StartFailed:
    case UploadErrorCode.FinalizeFailed:
    case UploadErrorCode.EnqueueFailed:
    case UploadErrorCode.Unexpected:
      return true;

    case UploadErrorCode.Cancelled:
    case UploadErrorCode.InvalidInput:
    case UploadErrorCode.MissingUploadPlan:
    case UploadErrorCode.FinalizeMismatch:
    case UploadErrorCode.ScanFailed:
    case UploadErrorCode.PrepFailed:
    default:
      return false;
  }
}

export function shouldRetry(err: UploadError, attempt: number, policy: RetryPolicy = defaultRetryPolicy): boolean {
  if (!err.retryable) return false;
  return attempt < policy.maxAttempts;
}

export function computeBackoffMs(attempt: number, policy: RetryPolicy = defaultRetryPolicy): number {
  const raw = policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const clamped = Math.min(raw, policy.maxDelayMs);
  const jitter = Math.floor(Math.random() * policy.jitterMs);
  return clamped + jitter;
}
