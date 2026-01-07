# REDACTED.md (Intentional Omissions / “Red List”)

This repository is a **public architecture & interfaces showcase** extracted from a private production codebase.

It is intentionally **non-runnable**. The goal is to publish the *shape* of the system (contracts, DTOs, orchestration flow, sequencing) while withholding proprietary implementation, customer-confidential material, and operational details.

If you want a runnable demo, it can be shown privately with customer data removed and under appropriate permissions/NDA.

---

## What is included

✅ **Architecture-level assets**
- Clear module boundaries and “ports/interfaces” under `src/contracts/`
- Stable DTOs/types under `src/domain/`
- Orchestration/controller flow under `src/application/` (redacted stubs)
- Narrative and sequence docs under `docs/architecture/`

✅ **Safe placeholders**
- Screenshot/video placeholders under `docs/media/` (no customer assets)

---

## What is intentionally omitted (the red list)

### 🚫 Secrets / live endpoints / operational wiring
- Production domains, internal routes, IPs, storage account names
- Keys, tokens, SAS secrets, connection strings, auth headers
- Tenant/customer identifiers, device identifiers used for real ops
- Real retry policies tied to production telemetry and thresholds

### 🚫 Storage & blob-path semantics
- Real container names, blob path conventions, naming schemes
- Customer folder semantics (“custPath” meanings), shop-specific structure
- Rules for blob metadata tags, indexing conventions, or retention policies
- Any “magic naming” that encodes business meaning

### 🚫 Mobile filesystem & device-specific integrations
- Expo FileSystem / native path quirks and device storage layout
- Background uploader wiring details (platform-specific configuration)
- Platform workarounds for iOS/Android upload reliability
- Any performance tuning based on device models / OS versions

### 🚫 Post-processing / back-office workflows
- Private job queue names, worker orchestration, scheduling heuristics
- Drive sync implementations, email generation, PDF parsing routines
- Receipt parsing rules, invoice composition rules, and any business logic
- Exact DB schema, SQL/EF models, migrations, and stored procedures

### 🚫 Customer data and customer artifacts
- PDFs, templates, example work orders, images, receipts
- Screenshots/videos that could expose customer information
- Real identifiers, names, emails, phone numbers, addresses

### 🚫 Competitive implementation details
- Any optimization that represents “how we make it fast/reliable” in production
- Heuristics for batching, adaptive sizing, compression profiles, or throttling
- Any hard-won edge-case handling (kept as high-level notes only)

---

## Redaction rules used in this repo

When you see these patterns, they are **intentional placeholders**:

- `REDACTED_*` constants (paths, IDs, domains, identifiers)
- `/* intentionally omitted */` blocks inside stubs
- “Ports” that show the **interface** but not the implementation
- Example flows that show sequencing but do not include working IO

---

## How to review this repo

This repo should be evaluated like a system design artifact:

- Is the **client ↔ server contract** explicit and stable?
- Is the flow **idempotent** and retry-safe (e.g., `batchId`, finalize as source of truth)?
- Are boundaries clean (uploader vs API vs orchestration vs DTOs)?
- Does the sequence explain responsibilities and failure handling?

---

## Private demo note

A runnable demo can be provided privately **with customer data removed** and under appropriate NDA/permissioning.
