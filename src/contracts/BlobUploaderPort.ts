/**
 * BlobUploaderPort.ts
 *
 * A small “port” (interface) that abstracts the actual file-upload mechanism
 * used by the React Native client to PUT bytes to an Azure Blob SAS URL.
 *
 * Why this exists:
 * - Your orchestration should not care whether upload is done via
 *   react-native-background-upload, Expo FileSystem.uploadAsync, fetch, etc.
 * - This isolates platform quirks (file:// handling, headers, retries, progress).
 *
 * NOTE: This repo is intentionally non-runnable — provide your real adapter in the app.
 */

// If you already created these in your repo, feel free to swap these inline types
// for imports from your own files (BlobUploadType.ts, Errors.ts, etc).
export type BlobUploadType = "pdf" | "partImage";

export type BlobUploadProgress = {
  /** Bytes sent so far (best-effort, depends on adapter). */
  sentBytes?: number;
  /** Total bytes (if known). */
  totalBytes?: number;
  /** 0..1 if calculable. */
  progress01?: number;
};

export type BlobUploadRequest = {
  /** SAS URL returned from StartBlobBatch for this file. */
  sasUrl: string;

  /**
   * Local file path.
   * - Some adapters need "file:///..." (Expo)
   * - Some need plain path without scheme (RN Background Upload)
   */
  localPath: string;

  /** e.g. "image/jpeg", "application/pdf" */
  contentType: string;

  /** For logs/errors only (optional) */
  fileName?: string;

  /** For logs/errors only (optional) */
  fileType?: BlobUploadType;

  /** Extra headers if needed (rare). */
  headers?: Record<string, string>;

  /** Optional progress callback. */
  onProgress?: (p: BlobUploadProgress) => void;
};

export type BlobUploadResult = {
  ok: true;
  /** Milliseconds (optional, if adapter provides it). */
  ms?: number;
};

export class BlobUploadError extends Error {
  readonly code:
    | "BLOB_UPLOAD_FAILED"
    | "BLOB_UPLOAD_ABORTED"
    | "BLOB_UPLOAD_INVALID_PATH"
    | "BLOB_UPLOAD_BAD_RESPONSE";

  readonly meta?: Record<string, any>;

  constructor(
    code: BlobUploadError["code"],
    message: string,
    meta?: Record<string, any>
  ) {
    super(message);
    this.name = "BlobUploadError";
    this.code = code;
    this.meta = meta;
  }
}

export interface BlobUploaderPort {
  /**
   * Uploads a single file to the provided SAS URL using PUT.
   * Must throw BlobUploadError on failure.
   */
  uploadToSasUrl(req: BlobUploadRequest): Promise<BlobUploadResult>;
}

/**
 * Adapter shape for react-native-background-upload (or your wrapper).
 * This matches the style you already use: uploadWithRNBU({ url, path, method:'PUT', type:'raw', headers })
 */
export type RNBackgroundUploadFn = (args: {
  url: string;
  path: string; // typically plain path (no "file://")
  method: "PUT";
  type: "raw";
  headers: Record<string, string>;
  // You can add notification/progress fields here if your wrapper supports it.
}) => Promise<void>;

/**
 * Create a BlobUploaderPort using RN Background Upload.
 *
 * IMPORTANT: RNBU usually expects a plain filesystem path (no "file://").
 * This factory normalizes that by stripping "file://" if present.
 */
export function createBlobUploaderPortFromRNBU(deps: {
  uploadWithRNBU: RNBackgroundUploadFn;
}): BlobUploaderPort {
  return {
    async uploadToSasUrl(req: BlobUploadRequest): Promise<BlobUploadResult> {
      if (!req?.sasUrl) {
        throw new BlobUploadError("BLOB_UPLOAD_BAD_RESPONSE", "Missing sasUrl.", {
          fileName: req?.fileName,
        });
      }
      if (!req?.localPath) {
        throw new BlobUploadError(
          "BLOB_UPLOAD_INVALID_PATH",
          "Missing localPath.",
          { fileName: req?.fileName }
        );
      }

      // RNBU path normalization: strip file:// if present
      const rnPath = req.localPath.startsWith("file://")
        ? req.localPath.slice("file://".length)
        : req.localPath;

      const headers: Record<string, string> = {
        // Azure Blob upload requirements:
        "x-ms-blob-type": "BlockBlob",
        "x-ms-blob-content-type": req.contentType,
        "Content-Type": req.contentType,
        ...(req.headers ?? {}),
      };

      const t0 = Date.now();
      try {
        await deps.uploadWithRNBU({
          url: req.sasUrl,
          path: rnPath,
          method: "PUT",
          type: "raw",
          headers,
        });

        return { ok: true, ms: Date.now() - t0 };
      } catch (err: any) {
        // Keep message safe + useful
        const msg = err?.message ?? String(err);
        throw new BlobUploadError("BLOB_UPLOAD_FAILED", `SAS upload failed: ${msg}`, {
          fileName: req.fileName,
          fileType: req.fileType,
          contentType: req.contentType,
        });
      }
    },
  };
}

/**
 * Optional helper: normalize a path for whichever adapter you use.
 * - For RNBU: prefers plain path (no scheme)
 * - For Expo FileSystem: often prefers file://
 */
export function normalizeLocalPath(
  input: string,
  mode: "rnbu" | "expo"
): string {
  if (!input) return input;
  if (mode === "rnbu") {
    return input.startsWith("file://") ? input.slice("file://".length) : input;
  }
  // expo
  return input.startsWith("file://") ? input : `file://${input}`;
}
