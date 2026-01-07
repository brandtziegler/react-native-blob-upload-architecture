# React Native Blob Upload Architecture (SAS Batch + Finalize + Enqueue)

This repository is a **non-runnable architecture showcase** of a production-grade mobile upload pipeline:

- **Client (React Native):** builds upload batches, requests a server-issued plan (SAS URLs), uploads directly to Azure Blob Storage with controlled parallelism, then finalizes.
- **Server (represented as contracts only):** mints per-file SAS URLs, verifies uploads, and enqueues async post-processing.

> This repo is meant for **code review / hiring / contract conversations**, not “clone and run”.

---

## Why this exists

Uploading binaries through an API server is slow and fragile on mobile. The scalable pattern is:

1) Client asks server for an **upload plan** (SAS URLs + blob paths)  
2) Client uploads **direct-to-Blob** with bounded parallelism and retries  
3) Client calls **Finalize** (server verifies presence/properties)  
4) Client calls **Enqueue** (server does slow work asynchronously: indexing, sync, parsing, emails, etc.)

This repo publishes the **contracts, types/DTOs, orchestration flow, and sequencing**, while intentionally omitting private implementation details and customer-specific semantics.

---

## What’s included

✅ **Architecture & contracts**
- DTOs and stable types under `src/domain/`
- Ports/interfaces under `src/contracts/`
- Orchestration flow under `src/application/`

✅ **Docs**
- `docs/architecture/overview.md` — module map + flow narrative
- `docs/architecture/sequence-rn-to-api.md` — request/response sequence & responsibilities

✅ **Placeholders**
- `docs/media/screenshots/` and `docs/media/video/` for demo assets (optional)

---

## What’s intentionally omitted

This repository is intentionally **non-runnable**.

Redacted/omitted items include:
- production URLs, tenant/customer identifiers, folder semantics
- storage account details, secrets, tokens, live endpoints
- real filesystem / device-specific code (Expo FS, background uploader wiring)
- proprietary business rules (naming conventions, post-processing details)
- any customer data or PDFs/images

See **`REDACTED.md`** for the full red list.

---

## Repository layout

```text
docs/
  architecture/
    overview.md
    sequence-rn-to-api.md
  media/
    screenshots/
      placeholder.png
    video/
      placeholder.mp4

src/
  domain/
  contracts/
  application/
  reference/

REDACTED.md
```
---

## Demo assets (optional)

- Screenshot placeholder: `docs/media/screenshots/placeholder.png`
- Video placeholder: `docs/media/video/placeholder.mp4`

(Do not include any customer info.)

---

## How to evaluate this repo

Look for:
- clear **stage tracking** (Init → Folder/Plan → Upload → Finalize → Enqueue)
- clean boundary design via **ports** (API, uploader, file prep, logging)
- idempotency & retry safety (`batchId`, finalize as source of truth)
- parallelism control (client hint, server clamp, bounded pool)

---

## License

This is a **portfolio architecture artifact**. If you want a permissive license, add MIT.
If you prefer “view-only,” omit a license (GitHub defaults to “all rights reserved”).

