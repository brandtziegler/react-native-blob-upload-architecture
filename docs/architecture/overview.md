# Upload Pipeline Architecture Overview (RN → Azure Blob via SAS Plan)

This repository documents a **non-runnable** but production-shaped upload pipeline used in a React Native app to move PDFs + images to cloud storage reliably and quickly.

The runnable implementation is private; this repo shows **contracts, DTOs, and orchestration flow**.

---

## Goals

- **Direct-to-Blob uploads** (avoid proxying large binaries through the API server)
- **Server-issued upload plan** (SAS URLs + blob paths) to keep credentials off-device
- **Bounded parallelism** for speed without melting mobile devices/networks
- **Finalize step** to verify uploads server-side and produce a single source of truth
- **Async post-processing** (enqueue) so slow work doesn’t block the user

Non-goals:
- Providing a runnable sample
- Publishing customer folder conventions, blob path rules, or operational secrets

---

## High-level flow

### 0) Preflight
- Confirm internet connectivity (fail fast with clear error)
- Establish identifiers for idempotency / correlation:
  - `workOrderId` (or equivalent business identifier)
  - `batchId` (stable per device/session, used for tracing)

### 1) Start / Plan (API)
Client sends **metadata only**:
- file names (and optionally sizes/content types)
- target grouping hints (pdf/images buckets)
- a client parallelism hint (server may clamp)

Server returns an **UploadPlan**:
- per-file SAS URL
- container + blob path
- recommended parallelism (optional)

### 2) Upload (Direct-to-Blob)
Client uploads each file **directly to Azure Blob Storage** using the SAS URL:
- HTTP `PUT`
- `x-ms-blob-type: BlockBlob`
- set `Content-Type` / `x-ms-blob-content-type`

Uploads are executed with:
- bounded concurrency (pool)
- batch sizing (optional)
- retries with backoff (optional)

### 3) Finalize (API)
Client calls Finalize with:
- batchId
- the planned blob targets (container + blobPath + filename)

Server verifies:
- expected count uploaded
- missing or failed items
- returns a definitive success/failure response

Finalize is treated as the **source of truth**.

### 4) Enqueue Post-Processing (API)
Client requests async work after success:
- indexing/sync, parsing, notifications, etc.

This is intentionally **out of band** so the UI can complete quickly.

---

## Module boundaries (repo mapping)

- `src/domain/`
  - Stable DTOs/types: upload plan, results, errors, stage tracking
- `src/contracts/`
  - Ports/interfaces for boundaries:
    - API boundary (Start/Finalize/Enqueue)
    - Blob uploader boundary (PUT with headers)
    - File discovery / prep (scan + normalize metadata)
    - Cross-cutting concerns (Clock, Logger)
- `src/application/`
  - Orchestration / controller flow:
    - stages: Init → Plan → Upload → Finalize → Enqueue
    - failure handling + status reporting
- `docs/architecture/sequence-rn-to-api.md`
  - Sequence diagram-style narrative of requests/responses

---

## Idempotency and reliability notes

- `batchId` is used to correlate Start/Finalize/Enqueue for the same operation.
- Finalize should be safe to retry (idempotent from the client perspective).
- Any per-file failures should surface as:
  - a structured error list (failed names / reasons)
  - a single “upload ok” gate before enqueue

---

## Security & redaction policy

This repo omits:
- production URLs/domains, customer identifiers, blob path semantics
- credentials/tokens/SAS generation logic
- device filesystem specifics and background uploader setup details
- business rules for naming, mapping, or post-processing

See `REDACTED.md` for the full list.

---

## (Optional) Demo asset idea

A 15–25 second clip is optional:
- tap “Send”
- show a neutral “Upload stages” UI (or a sanitized storage view)
- no customer identifiers or document contents

Assets live under `docs/media/` if used.
