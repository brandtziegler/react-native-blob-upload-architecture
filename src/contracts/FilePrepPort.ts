// src/contracts/FilePrepPort.ts
//
// Takes the raw file paths found by FileScannerPort and turns them into
// “upload-ready” descriptors (name/type/size/content-type/etc.).
//
// This stays pure + testable: no network, no DB, no Azure. Just prep.

import { BlobUploadType } from "../domain/BlobUploadType";

export type PreparedUploadFile = {
  /** Absolute local path (Expo FileSystem path, or file:// path — your adapter decides) */
  path: string;

  /** Original filename from disk (best-effort) */
  originalName: string;

  /** Final name that should be used remotely (normalized, extension fixed, etc.) */
  uploadName: string;

  /** What bucket/type it maps to in the pipeline */
  uploadType: BlobUploadType;

  /** Bytes (0 if unknown) */
  sizeBytes: number;

  /** MIME (application/pdf, image/jpeg, etc.) */
  contentType: string;
};

export type FilePrepInput = {
  /** Local sheet id (handy for logging / name rules) */
  localSheetId: number;

  /** Paths returned by FileScannerPort */
  pdfPaths: string[];
  imagePaths: string[];

  /**
   * Optional hook to normalize names (e.g., enforce .jpg, sanitize, etc.)
   * If not provided, we use a conservative default.
   */
  normalizeName?: (args: {
    originalName: string;
    uploadType: BlobUploadType;
    path: string;
  }) => Promise<string> | string;

  /**
   * Optional hook to resolve MIME types.
   * If not provided, we use a minimal default.
   */
  resolveContentType?: (args: {
    path: string;
    uploadType: BlobUploadType;
    name: string;
  }) => string;

  /**
   * Optional hook to resolve file sizes.
   * If not provided, sizeBytes will be 0 (caller can enrich later).
   */
  resolveSizeBytes?: (path: string) => Promise<number> | number;
};

export type FilePrepOk = {
  ok: true;
  files: PreparedUploadFile[];
  warnings: string[];
};

export type FilePrepFail = {
  ok: false;
  error: {
    code:
      | "NO_FILES"
      | "BAD_INPUT"
      | "NAME_NORMALIZATION_FAILED"
      | "SIZE_RESOLUTION_FAILED"
      | "UNKNOWN";
    message: string;
    cause?: unknown;
  };
};

export type FilePrepResult = FilePrepOk | FilePrepFail;

export interface FilePrepPort {
  prepare(input: FilePrepInput): Promise<FilePrepResult>;
}

/**
 * Small default helpers (kept here so the port can be used without extra deps).
 */
export function defaultNormalizeName(args: {
  originalName: string;
  uploadType: BlobUploadType;
}): string {
  const name = (args.originalName || "Unknown").trim();

  // Keep it conservative: don’t invent semantics here.
  // Just ensure PDFs end with .pdf and images end with .jpg (if they already look like images).
  if (args.uploadType === "pdf") {
    return name.toLowerCase().endsWith(".pdf") ? name : `${stripExt(name)}.pdf`;
  }

  // For images: prefer .jpg for upload compatibility.
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return ensureJpegExt(name);
  if (lower.endsWith(".png") || lower.endsWith(".heic") || lower.endsWith(".webp")) {
    return `${stripExt(name)}.jpg`;
  }
  // Unknown extension? Don’t append garbage — leave it as-is.
  return name;
}

export function defaultResolveContentType(args: {
  uploadType: BlobUploadType;
  name: string;
}): string {
  if (args.uploadType === "pdf") return "application/pdf";

  const lower = (args.name || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";

  return "application/octet-stream";
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function ensureJpegExt(name: string): string {
  const base = stripExt(name);
  return `${base}.jpg`;
}
