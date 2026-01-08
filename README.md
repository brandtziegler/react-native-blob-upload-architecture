# React Native → Azure Blob (SAS) Upload Architecture (Non-Runnable)

This repository is a **public architecture showcase** extracted from a private production codebase.

It is **intentionally non-runnable**.

The goal is to demonstrate:
- clear **module boundaries**
- clean **contracts (ports/interfaces)**
- stable **domain DTOs/types**
- a practical staged upload flow: **Scan → Prep → StartBatch → Upload → Finalize → PostProcess**
- how the app keeps a simple **UploadStage** state machine while the heavy lifting is offloaded

✅ You get the *shape* of the system (interfaces, orchestration, types).  
🚫 You do NOT get production secrets (real endpoints, auth, customer folder semantics, proprietary rules).

See `REDACTED.md` for what was intentionally omitted.

---

## Repository layout

> “Fenced block” just means a code block wrapped in triple backticks.

```txt
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
    BlobUploadType.ts
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

REDACTED.md
README.md
```
