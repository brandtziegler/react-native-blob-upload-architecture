# Sequence: RN → API (Plan) → Azure Blob (PUT) → API (Finalize/Enqueue)

This document describes the **request/response sequence** for a production-shaped upload pipeline.

It is intentionally **non-runnable** and focuses on responsibilities, contracts, and failure handling.

---

## Actors

- **RN Client**: React Native app orchestrator
- **API**: Server that issues SAS upload plans and verifies uploads
- **Blob Storage**: Azure Blob Storage (direct-to-storage PUT)
- **Post-Processor**: Async workers/jobs started by the API (details redacted)

---

## Happy-path sequence (high level)

1) **Preflight**
- RN checks connectivity
- RN selects files (PDFs + images) and builds metadata

2) **Start / Plan**
- RN → API: `POST /StartBlobBatch`
  - sends: `workOrderId`, `batchId`, file list `{ name, type, sizeBytes?, contentType? }`
  - optional hints: `clientParallelism`, grouping IDs (redacted semantics)
- API → RN: `StartBlobBatchResponse`
  - returns: `files[]` with `{ name, container, blobPath, sasUrl, contentType? }`
  - optional: `recommendedParallelism`

3) **Direct uploads**
- RN uploads each file using `PUT {sasUrl}`
  - headers:
    - `x-ms-blob-type: BlockBlob`
    - `Content-Type: <contentType>`
    - `x-ms-blob-content-type: <contentType>`
- RN uses bounded concurrency:
  - `pool = max(clientMin, recommendedParallelism ?? clientDefault)`
  - retries/backoff are allowed for transient failures

4) **Finalize**
- RN → API: `POST /FinalizeBlobBatch`
  - sends: `workOrderId`, `batchId`, `files[]` with `{ name, container, blobPath }`
- API verifies blobs exist / are readable (implementation redacted)
- API → RN: `FinalizeBlobBatchResponse`
  - `finalizeOk: boolean`
  - `plannedCount: number`
  - `uploadedOk: number`
  - `uploadedFailed?: string[]` (names or identifiers)

5) **Enqueue post-processing**
- RN → API: `POST /EnqueueBlobPostProcessing`
  - sends: same correlation (`workOrderId`, `batchId`) + file targets
- API enqueues async work and responds with an acknowledgment payload
- RN marks the upload as complete and returns control to the UI

---

## Text sequence diagram (copy-friendly)

```text
RN Client
  |
  | (1) POST StartBlobBatch  [metadata only]
  |------------------------------->  API
  |                                  |
  |                                  | create upload plan + SAS per file
  |                                  |
  | (2) StartBlobBatchResponse (files + sasUrl + recommendedParallelism)
  |<-------------------------------  |
  |
  | (3) PUT sasUrl (file bytes)  [bounded concurrency]
  |------------------------------->  Azure Blob Storage
  |------------------------------->  Azure Blob Storage
  |------------------------------->  Azure Blob Storage
  |
  | (4) POST FinalizeBlobBatch (targets)
  |------------------------------->  API
  |                                  |
  |                                  | verify presence/properties
  |                                  |
  | (5) FinalizeBlobBatchResponse (ok/counts/failed)
  |<-------------------------------  |
  |
  | (6) POST EnqueueBlobPostProcessing
  |------------------------------->  API
  |                                  |
  |                                  | enqueue async work (redacted)
  |                                  v
  |                               Post-Processor
  |
  | (7) 200 OK (enqueued)
  |<-------------------------------  |
  |
 RN marks UI complete
