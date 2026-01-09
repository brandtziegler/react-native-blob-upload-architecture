# React Native → Azure Blob (SAS) Upload Architecture (Non-Runnable)

This repository is a **public architecture showcase** extracted from a private production codebase.

It demonstrates a staged “direct-to-Blob” batch upload flow from a React Native client:

**Scan → Prep → StartBatch → Upload → Finalize → EnqueuePostProcessing**

This repo is intentionally **non-runnable**:
- no real endpoints / production URLs
- no secrets / keys / tokens
- no proprietary folder semantics or customer identifiers
- no device-specific wiring (Expo FS, RN Background Upload, etc.)
- no real PDFs/images included

See **`REDACTED.md`** for the full “red list” of what is intentionally omitted.

---

## What this repo is showing

### The pipeline (conceptual)
1. **Scan local device** for PDFs + part images (client-side file enumeration)
2. **Prep files** (naming/normalization/compression in the real app; abstracted here)
3. **StartBlobBatch** (client asks API for an upload plan; API returns SAS URLs + recommended parallelism)
4. **Upload** (client uploads bytes directly to Azure Blob via SAS URLs; bounded concurrency)
5. **FinalizeBlobBatch** (client asks API to verify planned blobs exist; server returns counts + any failures)
6. **EnqueueBlobPostProcessing** (API enqueues async work: Drive sync / receipts parse / email / etc.)

### Where to look first
- `docs/architecture/overview.md` — narrative overview + boundaries
- `docs/architecture/sequence-rn-to-api.md` — sequence-style walk-through (RN ↔ API)
- `src/application/UploadOrchestrator.ts` — the “story” of the pipeline in code form
- `src/contracts/*` — ports/interfaces (clean boundaries)
- `src/domain/*` — stable DTOs + enums + error model

---

## Repository layout

```text
docs/
  architecture/
    overview.md
    sequence-rn-to-api.md
  media/
    screenshots/
      .gitkeep
    video/
      .gitkeep

src/
  domain/
    BlobUploadTypes.ts
    UploadStage.ts
    Errors.ts

  contracts/
    BlobBatchApiPort.ts
    BlobUploaderPort.ts
    FileScannerPort.ts
    FilePrepPort.ts
    ClockPort.ts
    LoggerPort.ts

  application/
    UploadOrchestrator.ts
    SendToCloudController.ts

README.md
REDACTED.md
```
