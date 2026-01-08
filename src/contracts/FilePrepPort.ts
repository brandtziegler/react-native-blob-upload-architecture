// src/contracts/FilePrepPort.ts
//
// Port: turns "discovered files" into "upload-ready files".
// In your real app this is where you:
// - classify pdf vs image
// - compute sizeBytes + contentType
// - normalize names / enforce .jpg for images
// - optionally compress images (different profiles for receipts vs part images)
// - (optionally) consult local DB to decide "receipt vs partImageCompact"
//
// In this portfolio repo, this stays as a contract (interface) + types.

import { BlobUploadType } from "../domain/BlobUploadType";
import { AppError } from "../domain/Errors";

export type FileSourceHint = "pdfFolder" | "partsFolder" | "unknown";

/**
 * Output of FileScannerPort (or anything that "discovers" local files).
 * Keep this minimal: FilePrepPort can enrich it.
 */
export interface DiscoveredFile {
  /** Absolute/local device path (Expo FS path or file:// URI). */
  path: string;

  /** Leaf filename as found on disk (may be messy, mixed case, etc.). */
  originalName: string;

  /** Best-known type at scan time (can be refined during prep). */
  typeHint?: BlobUploadType;

  /** Where we found it (helps debugging + any special rules). */
  source?: FileSourceHint;

  /**
   * Optional parsed IDs from naming convention (e.g., PartUsedID, SheetID).
   * Real implementation may fill these in during scanning or during prep.
   */
  ids?: Record<string, number>;
}

/**
 * Upload-ready file:
 * - name is final (normalized)
 * - path may change (after compression)
 * - sizeBytes and contentType are known
 */
export interface PreparedUploadFile {
  /** Path to upload from (may be new path after compression). */
  path: string;

  /** Final blob filename (normalized, extension enforced). */
  name: string;

  /** 'pdf' | 'partImage' */
  type: BlobUploadType;

  /** For StartBlobBatch payload + metrics. */
  sizeBytes?: number;

  /** For blob headers and StartBlobBatch payload. */
  contentType?: string;

  /** Optional breadcrumbs for debugging / metrics. */
  meta?: {
    originalName: string;
    source?: FileSourceHint;
    wasCompressed?: boolean;
    compressionProfile?: string;
  };
}

export interface FilePrepContext {
  /** Useful for logging and error correlation. */
  localSheetId?: number;

  /** Optional correlation ID (your batchId/deviceId pattern). */
  batchId?: string;

  /** Optional logging hook (keep it simple here). */
  log?: (msg: string, extra?: Record<string, any>) => void;
}

export interface FilePrepOptions {
  /**
   * If true, implementers may compress images.
   * (In your real code you cap concurrency and use different profiles.)
   */
  allowCompression?: boolean;

  /**
   * If true, implementers may force all images to .jpg for upload compatibility.
   */
  forceJpegExtension?: boolean;

  /**
   * Optional hint for how aggressive prep should be.
   * - "safe": minimal changes (best for portfolio)
   * - "production": closer to your real behavior
   */
  mode?: "safe" | "production";
}

export interface FilePrepResult {
  files: PreparedUploadFile[];
  warnings?: string[];
}

export interface FilePrepPort {
  /**
   * Prepare a set of discovered files for upload.
   * Should be deterministic given the same inputs.
   */
  prepare(
    discovered: DiscoveredFile[],
    ctx?: FilePrepContext,
    opts?: FilePrepOptions
  ): Promise<FilePrepResult>;

  /**
   * Optional single-file API (handy for unit tests and debugging).
   */
  prepareOne?(
    file: DiscoveredFile,
    ctx?: FilePrepContext,
    opts?: FilePrepOptions
  ): Promise<PreparedUploadFile>;
}

/**
 * Typed error wrapper for prep stage.
 * Keep errors boring and actionable.
 */
export class FilePrepError extends Error implements AppError {
  readonly kind = "FilePrepError" as const;

  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly details?: Record<string, any>
  ) {
    super(message);
  }
}
