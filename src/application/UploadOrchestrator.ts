/**
 * UploadOrchestrator.ts
 *
 * NON-RUNNABLE ARCHITECTURE ARTIFACT
 * ---------------------------------
 * This orchestrator mirrors the real-world flow you described:
 *
 *   1) Scan local device for PDFs + part images
 *   2) Prep files (normalization/compression naming in real app)
 *   3) StartBlobBatch (server returns SAS URLs + recommended parallelism)
 *   4) Upload to Azure Blob via SAS (bounded parallelism)
 *   5) FinalizeBlobBatch (server verifies presence)
 *   6) EnqueueBlobPostProcessing (Drive sync + receipts parse/email)
 *
 * This is intentionally "clean-room" and non-runnable:
 * - no Expo FS
 * - no RN Background Upload
 * - no secrets / real endpoints
 *
 * The goal: make the boundaries obvious and auditable.
 */

import { UploadStage } from "../domain/UploadStage";
import { UploadError, UploadErrorCode } from "../domain/Errors";

import type { UploadFileType } from "../domain/BlobUploadTypes";

import type { BlobBatchApiPort } from "../contracts/BlobBatchApiPort";
import type { BlobUploaderPort } from "../contracts/BlobUploaderPort";
import type { FileScannerPort } from "../contracts/FileScannerPort";
import type { FilePrepPort } from "../contracts/FilePrepPort";
import type { ClockPort } from "../contracts/ClockPort";
import type { LoggerPort } from "../contracts/LoggerPort";

/**
 * Minimal “file record” that flows through the pipeline.
 * Your concrete impls can carry more fields (hashes, local IDs, etc).
 */
export type UploadFile = {
  path: string;          // device path (or placeholder in this repo)
  name: string;          // filename only
  type: UploadFileType;  // "pdf" | "partImage"
  sizeBytes?: number;
  contentType?: string;
};

export type UploadOrchestratorInput = {
  // identity / audit
  batchId: string;                 // in your real flow: stableDeviceId
  testPrefix?: string;             // e.g. "uploadFromApp"
  workOrderId: string;             // stringified WO#
  remoteSheetId?: number;          // optional for logging
  localSheetId?: number;           // optional for logging

  // folder semantics (Drive metadata that server will use downstream)
  custPath: string;
  workOrderFolderId?: string;
  pdfFolderId?: string;
  imagesFolderId?: string;

  // scanning locations (placeholders here; real impl decides)
  pdfFolderPath?: string;
  imageFolderPath?: string;

  // tuning knobs
  clientParallelismHint?: number;  // you send 8; server clamps and returns recommendedParallelism
  batchSizeHint?: number;          // if you want deterministic chunking for docs/tests

  // hooks
  onStage?: (stage: UploadStage) => void;
};

export type UploadOrchestratorResult = {
  ok: boolean;
  stage: UploadStage;
  startedAtMs: number;
  finishedAtMs: number;
  timingsMs: Record<string, number>;
  counts: {
    scanned: number;
    planned: number;
    uploaded: number;
  };
  warnings: string[];
};

type Deps = {
  fileScanner: FileScannerPort;
  filePrep: FilePrepPort;
  api: BlobBatchApiPort;
  uploader: BlobUploaderPort;
  clock: ClockPort;
  logger: LoggerPort;
};

export class UploadOrchestrator {
  constructor(private readonly deps: Deps) {}

  /**
   * Run the pipeline once.
   * Any “retry policy” beyond bounded upload retries should live *above* this
   * (e.g., controller/UI), so the orchestrator stays deterministic.
   */
  async run(input: UploadOrchestratorInput): Promise<UploadOrchestratorResult> {
    const { clock, logger } = this.deps;

    const startedAtMs = clock.nowMs();
    const timingsMs: Record<string, number> = {};
    const warnings: string[] = [];

    let stage: UploadStage = UploadStage.Init;
    input.onStage?.(stage);

    let scanned: UploadFile[] = [];
    let plannedCount = 0;
    let uploadedCount = 0;

    try {
      // ----------------------
      // 1) Scan
      // ----------------------
      stage = UploadStage.Scan;
      input.onStage?.(stage);

      const tScan0 = clock.nowMs();
      scanned = await this.deps.fileScanner.scan({
        pdfFolderPath: input.pdfFolderPath,
        imageFolderPath: input.imageFolderPath,
      });
      timingsMs.scan = clock.nowMs() - tScan0;

      if (!scanned.length) {
        // This matches your real flow: early exit with “nothing to upload”
        logger.info("[UploadOrchestrator] No files found to upload.");
        return {
          ok: true,
          stage,
          startedAtMs,
          finishedAtMs: clock.nowMs(),
          timingsMs,
          counts: { scanned: 0, planned: 0, uploaded: 0 },
          warnings,
        };
      }

      // ----------------------
      // 2) Prep (normalize/compress/etc in real impl)
      // ----------------------
      stage = UploadStage.Prep;
      input.onStage?.(stage);

      const tPrep0 = clock.nowMs();
      const prepared = await this.deps.filePrep.prepare(scanned, {
        // optional contextual knobs
        workOrderId: input.workOrderId,
        custPath: input.custPath,
      });
      timingsMs.prep = clock.nowMs() - tPrep0;

      // ----------------------
      // 3) Start batch (server returns SAS URLs and recommended parallelism)
      // ----------------------
      stage = UploadStage.Start;
      input.onStage?.(stage);

      const tStart0 = clock.nowMs();
      const startRes = await this.deps.api.startBlobBatch({
        workOrderId: input.workOrderId,
        batchId: input.batchId,
        testPrefix: input.testPrefix,
        custPath: input.custPath,

        workOrderFolderId: input.workOrderFolderId,
        pdfFolderId: input.pdfFolderId,
        imagesFolderId: input.imagesFolderId,

        clientParallelism: input.clientParallelismHint ?? 8,
        files: prepared.map(f => ({
          name: f.name,
          type: f.type,
          sizeBytes: f.sizeBytes,
          contentType: f.contentType,
        })),
      });
      timingsMs.start = clock.nowMs() - tStart0;

      plannedCount = startRes.files.length;

      // quick sanity check
      if (!plannedCount) {
        throw new UploadError(
          UploadErrorCode.StartFailed,
          "StartBlobBatch returned zero planned files."
        );
      }

      // ----------------------
      // 4) Upload (bounded parallelism)
      // ----------------------
      stage = UploadStage.Upload;
      input.onStage?.(stage);

      const tUp0 = clock.nowMs();

      const recommended = startRes.recommendedParallelism ?? (input.clientParallelismHint ?? 8);
      const parallelism = clampInt(recommended, 1, 16); // keep it sane in the “architecture doc” world

      // Build plan lookup by filename
      const planByName = new Map(startRes.files.map(p => [p.name, p]));

      // Upload all prepared files that the server planned for
      // If your real system allows “server filters”, you’d align on the intersection set here.
      await this.deps.uploader.uploadMany({
        parallelism,
        files: prepared.map(f => {
          const plan = planByName.get(f.name);
          if (!plan) {
            // Not fatal in theory, but you probably want it fatal in practice.
            // We’ll be strict here to keep the artifact honest.
            throw new UploadError(
              UploadErrorCode.MissingUploadPlan,
              `Missing SAS plan for file: ${f.name}`
            );
          }
          return {
            file: f,
            sasUrl: plan.sasUrl,
            blobPath: plan.blobPath,
            container: plan.container,
            contentType: plan.contentType ?? f.contentType,
          };
        }),
      });

      timingsMs.upload = clock.nowMs() - tUp0;
      uploadedCount = plannedCount;

      // ----------------------
      // 5) Finalize (server verifies presence/casing)
      // ----------------------
      stage = UploadStage.Finalize;
      input.onStage?.(stage);

      const tFin0 = clock.nowMs();
      const finRes = await this.deps.api.finalizeBlobBatch({
        workOrderId: input.workOrderId,
        batchId: startRes.batchId,
        files: startRes.files.map(f => ({
          name: f.name,
          container: f.container,
          blobPath: f.blobPath,
        })),
      });
      timingsMs.finalize = clock.nowMs() - tFin0;

      if (!finRes.finalizeOk) {
        throw new UploadError(
          UploadErrorCode.FinalizeFailed,
          `Finalize failed: uploadedOk=${finRes.uploadedOk}/${finRes.plannedCount}`
        );
      }
      if (finRes.uploadedFailed?.length) {
        throw new UploadError(
          UploadErrorCode.FinalizeMismatch,
          `Finalize mismatch: failed=${JSON.stringify(finRes.uploadedFailed)}`
        );
      }

      // ----------------------
      // 6) Enqueue post-processing (Drive sync, receipts parse, email)
      // ----------------------
      stage = UploadStage.Enqueue;
      input.onStage?.(stage);

      const tEq0 = clock.nowMs();
      await this.deps.api.enqueueBlobPostProcessing({
        workOrderId: input.workOrderId,
        batchId: startRes.batchId,
        testPrefix: input.testPrefix,

        workOrderFolderId: input.workOrderFolderId,
        pdfFolderId: input.pdfFolderId,
        imagesFolderId: input.imagesFolderId,

        files: startRes.files.map(f => ({
          name: f.name,
          container: f.container,
          blobPath: f.blobPath,
          contentType: f.contentType,
        })),
      });
      timingsMs.enqueue = clock.nowMs() - tEq0;

      stage = UploadStage.Complete;
      input.onStage?.(stage);

      return {
        ok: true,
        stage,
        startedAtMs,
        finishedAtMs: clock.nowMs(),
        timingsMs,
        counts: { scanned: scanned.length, planned: plannedCount, uploaded: uploadedCount },
        warnings,
      };
    } catch (err: any) {
      const finishedAtMs = clock.nowMs();

      // Normalize error into our domain model.
      const e =
        err instanceof UploadError
          ? err
          : new UploadError(
              UploadErrorCode.Unexpected,
              err?.message ?? "Unexpected upload error.",
              { cause: err }
            );

      this.deps.logger.error("[UploadOrchestrator] Failed", {
        stage,
        code: e.code,
        message: e.message,
        meta: e.meta,
        workOrderId: input.workOrderId,
        batchId: input.batchId,
        remoteSheetId: input.remoteSheetId,
        localSheetId: input.localSheetId,
      });

      return {
        ok: false,
        stage,
        startedAtMs,
        finishedAtMs,
        timingsMs,
        counts: { scanned: scanned.length, planned: plannedCount, uploaded: uploadedCount },
        warnings,
      };
    }
  }
}

/** tiny helper: avoid “parallelism = 9000” from accidental values */
function clampInt(n: number, min: number, max: number): number {
  const x = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.max(min, Math.min(max, x));
}
