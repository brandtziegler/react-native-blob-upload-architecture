/**
 * UploadOrchestrator.ts
 *
 * NON-RUNNABLE ARCHITECTURE ARTIFACT
 * ---------------------------------
 * Mirrors the high-level flow:
 *
 *   1) Scan local device for PDFs + part images
 *   2) Prep files (normalize/compress/rename in the real app)
 *   3) StartBlobBatch (server returns SAS URLs + recommended parallelism)
 *   4) Upload to Azure Blob via SAS (bounded parallelism)
 *   5) FinalizeBlobBatch (server verifies presence)
 *   6) EnqueueBlobPostProcessing (Drive sync + receipts parse/email)
 *
 * Clean-room + intentionally non-runnable:
 * - no Expo FS
 * - no RN background upload
 * - no secrets / real endpoints
 *
 * The goal is to make boundaries obvious and auditable.
 */

import { UploadStage } from "../domain/UploadStage";
import { UploadError, UploadErrorCode } from "../domain/Errors";

import type { UploadFileType } from "../domain/BlobUploadTypes";

import type { BlobBatchApiPort, ApiResult } from "../contracts/BlobBatchApiPort";
import type { BlobUploaderPort } from "../contracts/BlobUploaderPort";
import type { FileScannerPort } from "../contracts/FileScannerPort";
import type { FilePrepPort } from "../contracts/FilePrepPort";
import type { ClockPort } from "../contracts/ClockPort";
import type { LoggerPort } from "../contracts/LoggerPort";

import type { UploadStage as UploadStageT } from "../domain/UploadStage";
import type { SendToCloudResult, SendToCloudRequest } from "./SendToCloudController";

/**
 * Minimal “file record” that flows through the pipeline.
 * Concrete impls can carry more fields (hashes, local IDs, etc).
 */
export type UploadFile = {
  path: string; // device path (or placeholder in this repo)
  name: string; // filename only
  type: UploadFileType; // "pdf" | "partImage"
  sizeBytes?: number;
  contentType?: string;
};

export type UploadOrchestratorOptions = {
  signal?: AbortSignal;
  onStage?: (stage: UploadStageT) => void;
  onNote?: (note: string) => void;
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
   * “Retry policy” beyond bounded per-file upload retries should live above this
   * (controller/UI), so this stays deterministic and auditable.
   */
  async run(
    req: SendToCloudRequest,
    opts: UploadOrchestratorOptions = {}
  ): Promise<SendToCloudResult> {
    const { clock, logger } = this.deps;

    const signal = opts.signal;
    const notes: string[] = [];

    const note = (msg: string) => {
      notes.push(msg);
      opts.onNote?.(msg);
    };

    const setStage = (s: UploadStageT) => {
      opts.onStage?.(s);
    };

    const startedAtMs = clock.nowMs();
    let stage: UploadStageT = UploadStage.PreInit;

    const logBase = {
      workOrderId: req.workOrderId,
      batchId: req.batchId,
      remoteSheetId: req.remoteSheetId ?? undefined,
      testPrefix: req.testPrefix ?? undefined,
      custPath: req.custPath,
    };

    try {
      // ----------------------
      // 0) Validate
      // ----------------------
      assertNotAborted(signal);

      stage = UploadStage.Init;
      setStage(stage);

      if (!req.workOrderId?.trim()) {
        throw new UploadError(UploadErrorCode.ValidationFailed, "Missing workOrderId.");
      }
      if (!req.batchId?.trim()) {
        throw new UploadError(UploadErrorCode.ValidationFailed, "Missing batchId.");
      }
      if (!req.custPath?.trim()) {
        throw new UploadError(UploadErrorCode.ValidationFailed, "Missing custPath.");
      }

      // This repo assumes folder semantics are already known (created upstream).
      // We still call out when IDs are missing, because the server-side post-processor will care.
      stage = UploadStage.Folder;
      setStage(stage);

      if (!req.workOrderFolderId) note("workOrderFolderId not provided (ok for artifact; server may require in real flow).");
      if (!req.pdfFolderId) note("pdfFolderId not provided (ok for artifact; server may require in real flow).");
      if (!req.imagesFolderId) note("imagesFolderId not provided (ok for artifact; server may require in real flow).");

      // ----------------------
      // 1) Scan
      // ----------------------
      assertNotAborted(signal);

      stage = UploadStage.Scan;
      setStage(stage);

      const tScan0 = clock.nowMs();
      const scanned = await this.deps.fileScanner.scan({
        pdfFolderPath: req.pdfFolderPath,
        imageFolderPath: req.imageFolderPath,
      });
      note(`Scan: found ${scanned.length} file(s) in ${clock.nowMs() - tScan0}ms.`);

      if (!scanned.length) {
        // Matches your real flow: early exit with “nothing to upload”
        return {
          status: "success",
          finalStage: UploadStage.Done,
          notes,
          message: "No files found to upload.",
          remoteSheetId: req.remoteSheetId ?? null,
        };
      }

      // ----------------------
      // 2) Prep
      // ----------------------
      assertNotAborted(signal);

      stage = UploadStage.Prep;
      setStage(stage);

      const tPrep0 = clock.nowMs();
      const prepared: UploadFile[] = await this.deps.filePrep.prepare(scanned, {
        workOrderId: req.workOrderId,
        custPath: req.custPath,
      });
      note(`Prep: prepared ${prepared.length} file(s) in ${clock.nowMs() - tPrep0}ms.`);

      if (!prepared.length) {
        return {
          status: "success",
          finalStage: UploadStage.Done,
          notes,
          message: "No files to upload after prep (nothing planned).",
          remoteSheetId: req.remoteSheetId ?? null,
        };
      }

      // Optional batching (mirrors your real “batching” capability, but still minimal)
      const batchSize = clampInt(req.batchSizeHint ?? prepared.length, 1, prepared.length);
      const batches = chunk(prepared, batchSize);
      if (batches.length > 1) {
        note(`Batching: ${prepared.length} file(s) split into ${batches.length} batch(es) of ~${batchSize}.`);
      }

      // ----------------------
      // 3-6) For each batch: Start -> Upload -> Finalize -> Enqueue
      // ----------------------
      for (let i = 0; i < batches.length; i++) {
        assertNotAborted(signal);

        const batchFiles = batches[i];
        note(`Batch ${i + 1}/${batches.length}: ${batchFiles.length} file(s).`);

        // 3) StartBlobBatch
        stage = UploadStage.StartBatch;
        setStage(stage);

        const startRes = unwrapApi(
          await this.deps.api.startBlobBatch({
            workOrderId: req.workOrderId,
            batchId: req.batchId,
            testPrefix: req.testPrefix,
            custPath: req.custPath,

            workOrderFolderId: req.workOrderFolderId,
            pdfFolderId: req.pdfFolderId,
            imagesFolderId: req.imagesFolderId,

            clientParallelism: req.clientParallelismHint ?? 8,
            files: batchFiles.map(f => ({
              name: f.name,
              type: f.type,
              sizeBytes: f.sizeBytes,
              contentType: f.contentType,
            })),
          }),
          UploadErrorCode.StartFailed,
          "StartBlobBatch"
        );

        if (!startRes.files?.length) {
          throw new UploadError(UploadErrorCode.StartFailed, "StartBlobBatch returned zero planned files.");
        }

        const recommended = startRes.recommendedParallelism ?? (req.clientParallelismHint ?? 8);
        const parallelism = clampInt(recommended, 1, 16);
        note(`StartBlobBatch: planned ${startRes.files.length} file(s), parallelism=${parallelism}.`);

        // 4) Upload via SAS
        stage = UploadStage.Upload;
        setStage(stage);

        const planByName = new Map(startRes.files.map(p => [p.name, p]));

        const tUp0 = clock.nowMs();
        await runLimited(
          batchFiles.map(file => async () => {
            assertNotAborted(signal);

            const plan = planByName.get(file.name);
            if (!plan) {
              throw new UploadError(
                UploadErrorCode.MissingUploadPlan,
                `Missing SAS plan for file: ${file.name}`
              );
            }

            await uploadWithRetry(
              () =>
                this.deps.uploader.uploadToSasUrl(
                  {
                    localPath: file.path,
                    fileName: file.name,
                    sasUrl: plan.sasUrl,
                    contentType: plan.contentType ?? file.contentType ?? "application/octet-stream",
                  },
                  { signal }
                ),
              {
                attempts: 3,
                baseDelayMs: 350,
                clock: this.deps.clock,
                onRetry: (attempt, err) =>
                  note(`Retry ${attempt}/3 for ${file.name} (${err?.message ?? "unknown error"})`),
              }
            );
          }),
          parallelism,
          signal
        );
        note(`Upload: completed in ${clock.nowMs() - tUp0}ms.`);

        // 5) FinalizeBlobBatch
        stage = UploadStage.Finalize;
        setStage(stage);

        const finRes = unwrapApi(
          await this.deps.api.finalizeBlobBatch({
            workOrderId: req.workOrderId,
            batchId: startRes.batchId,
            files: startRes.files.map(f => ({
              name: f.name,
              container: f.container,
              blobPath: f.blobPath,
            })),
          }),
          UploadErrorCode.FinalizeFailed,
          "FinalizeBlobBatch"
        );

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

        // 6) Enqueue post-processing
        stage = UploadStage.EnqueuePostProcessing;
        setStage(stage);

        unwrapApi(
          await this.deps.api.enqueueBlobPostProcessing({
            workOrderId: req.workOrderId,
            batchId: startRes.batchId,
            testPrefix: req.testPrefix,

            workOrderFolderId: req.workOrderFolderId,
            pdfFolderId: req.pdfFolderId,
            imagesFolderId: req.imagesFolderId,

            files: startRes.files.map(f => ({
              name: f.name,
              container: f.container,
              blobPath: f.blobPath,
              contentType: f.contentType,
            })),
          }),
          UploadErrorCode.EnqueueFailed,
          "EnqueueBlobPostProcessing"
        );

        note(`Batch ${i + 1}/${batches.length}: complete.`);
      }

      stage = UploadStage.Done;
      setStage(stage);

      return {
        status: "success",
        finalStage: stage,
        notes,
        message: `Upload complete (${clock.nowMs() - startedAtMs}ms).`,
        remoteSheetId: req.remoteSheetId ?? null,
      };
    } catch (err: any) {
      const finishedAtMs = clock.nowMs();

      if (signal?.aborted) {
        return {
          status: "cancelled",
          finalStage: UploadStage.Error,
          notes,
          message: `Cancelled (${finishedAtMs - startedAtMs}ms).`,
          remoteSheetId: req.remoteSheetId ?? null,
        };
      }

      const e =
        err instanceof UploadError
          ? err
          : new UploadError(
              UploadErrorCode.Unexpected,
              err?.message ?? "Unexpected upload error.",
              { cause: err }
            );

      logger.error("[UploadOrchestrator] Failed", {
        ...logBase,
        stage,
        code: e.code,
        message: e.message,
        meta: e.meta,
      });

      return {
        status: "failure",
        finalStage: UploadStage.Error,
        error: e,
        notes,
        message: `Upload failed at stage=${String(stage)} (${e.code}).`,
        remoteSheetId: req.remoteSheetId ?? null,
      };
    }
  }
}

/* ---------------------------------- helpers ---------------------------------- */

function unwrapApi<T>(res: ApiResult<T>, code: string, label: string): T {
  if (res.ok) return res.data;
  throw new UploadError(code, `${label} failed: ${res.message}`, { details: res.details });
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new UploadError(UploadErrorCode.Cancelled, "Operation cancelled.");
  }
}

async function uploadWithRetry(
  fn: () => Promise<void>,
  opts: {
    attempts: number;
    baseDelayMs: number;
    clock: ClockPort;
    onRetry?: (attempt: number, err: any) => void;
  }
) {
  let lastErr: any;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      await fn();
      return;
    } catch (e: any) {
      lastErr = e;
      if (attempt >= opts.attempts) break;

      opts.onRetry?.(attempt + 1, e);
      const delay = opts.baseDelayMs * attempt;
      await opts.clock.sleep(delay);
    }
  }
  throw new UploadError(
    UploadErrorCode.UploadFailed,
    lastErr?.message ?? "Upload failed after retries.",
    { cause: lastErr }
  );
}

/** Bounded concurrency runner (no deps) */
async function runLimited(
  tasks: Array<() => Promise<void>>,
  parallelism: number,
  signal?: AbortSignal
): Promise<void> {
  assertNotAborted(signal);

  const limit = clampInt(parallelism, 1, 64);
  let next = 0;
  let firstErr: any = null;

  async function worker() {
    while (true) {
      assertNotAborted(signal);

      const idx = next++;
      if (idx >= tasks.length) return;

      try {
        await tasks[idx]();
      } catch (e: any) {
        firstErr = firstErr ?? e;
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);

  if (signal?.aborted) {
    throw new UploadError(UploadErrorCode.Cancelled, "Operation cancelled.");
  }
  if (firstErr) throw firstErr;
}

/** tiny helper: avoid “parallelism = 9000” from accidental values */
function clampInt(n: number, min: number, max: number): number {
  const x = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.max(min, Math.min(max, x));
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
