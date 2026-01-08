// src/contracts/FileScannerPort.ts
//
// Contract-only "port" that describes how the app finds local PDF + image files
// that are ready to be uploaded (direct-to-blob pipeline).
//
// This repo is intentionally non-runnable. This file defines the interface that
// the real RN/Expo implementation must satisfy.

import type { BlobUploadType } from "../domain/BlobUploadType";

/**
 * A single local file discovered on-device and eligible for upload.
 *
 * NOTE: `path` is intentionally generic. In a real RN implementation you may use:
 * - Expo FileSystem paths (often absolute-ish)
 * - file:// URIs
 * - platform-specific paths used by background upload modules
 */
export type LocalFileRef = {
  /** Absolute-ish local path or URI */
  path: string;

  /** Filename only (e.g. "WO_1234.pdf", "PU_88_20240101.jpg") */
  name: string;

  /** Upload classification for the pipeline */
  type: BlobUploadType;

  /** Optional metadata used for batching, metrics, or content-type decisions */
  sizeBytes?: number;
  contentType?: string;
  lastModifiedMs?: number;

  /**
   * Optional "logical grouping" field if you want to preserve folder intent
   * without exposing the real folder semantics.
   *
   * Example values: "pdfFolder", "partsImages"
   */
  bucket?: string;
};

export type ScanOptions = {
  /**
   * Include PDFs found in the configured PDF directory.
   * Default: true
   */
  includePdfs?: boolean;

  /**
   * Include part/receipt images found in the configured image directory.
   * Default: true
   */
  includeImages?: boolean;

  /**
   * Allowed image extensions (lowercase, without dot).
   * Default: ["jpg","jpeg","png","heic","webp"]
   */
  imageExtensions?: string[];

  /**
   * If true, return results in a stable, deterministic order (name/path sort).
   * Default: true
   */
  stableSort?: boolean;

  /**
   * If true, scanner should attempt to return sizeBytes for each file.
   * Default: true
   */
  includeSizes?: boolean;
};

export type WorkOrderScanTarget = {
  /**
   * Local work order identifier (device-side sheet id, etc).
   * Used to derive the local folder paths.
   */
  localSheetId: number;

  /**
   * Optional override paths. If omitted, the implementation derives them
   * from localSheetId using app conventions.
   */
  pdfFolderPath?: string;
  imageFolderPath?: string;

  /**
   * If present, allows the implementation to correlate scan results with
   * server-side naming requirements (optional).
   */
  remoteWorkOrderNumber?: number;
};

export type ScanResult = {
  /** All discovered eligible files (pdfs first is fine; the orchestrator can reorder) */
  files: LocalFileRef[];

  /** Simple counts for logging / UI */
  counts: {
    pdf: number;
    partImage: number;
    total: number;
  };

  /** Optional warnings that should not necessarily fail the upload */
  warnings?: string[];
};

export interface FileScannerPort {
  /**
   * Scans the local device storage for PDFs + part images belonging to a work order.
   *
   * The implementation may:
   * - walk directories recursively for images
   * - flat-scan a pdf directory
   * - filter by extension
   * - optionally collect file sizes
   */
  scanWorkOrderFiles(
    target: WorkOrderScanTarget,
    options?: ScanOptions
  ): Promise<ScanResult>;
}

/**
 * Recommended defaults (handy for callers).
 * Implementations may ignore these, but it keeps the app consistent.
 */
export const DEFAULT_SCAN_OPTIONS: Required<
  Pick<
    ScanOptions,
    "includePdfs" | "includeImages" | "imageExtensions" | "stableSort" | "includeSizes"
  >
> = {
  includePdfs: true,
  includeImages: true,
  imageExtensions: ["jpg", "jpeg", "png", "heic", "webp"],
  stableSort: true,
  includeSizes: true,
};
