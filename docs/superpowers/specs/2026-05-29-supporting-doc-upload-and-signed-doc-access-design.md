# Supporting-Document Upload & Signed-Doc Access — Design

**Date:** 2026-05-29
**Branch:** general-improvements
**Status:** Draft for review

## Problem

Two gaps in the contract Documents experience:

1. **No way to add supporting documents after raise.** When a contract is raised
   without a Budget Approval document or any supporting documents, the
   "Counterparty Supporting Documents" area is hidden entirely (it only renders
   when supporting docs already exist). Even when it is shown, the only action is
   **Replace** — there is no **Upload (add new)** action. So a POC/HOD who forgot
   to attach the budget approval cannot add it later.

2. **POC and HOD cannot see signed/executed documents.** The "Signed Docs" tab is
   gated to LEGAL_TEAM/ADMIN only (`canViewSignedDocsTab`), and the final
   signed-artifact download endpoint hard-blocks all other roles. The creator and
   their HOD have no way to view or download the executed contract / completion
   certificate.

## Goals (FINAL — revised 2026-06-01)

- Add an **Upload (add-new)** action for supporting documents in the Documents
  tab, **per section** (Budget Approval, Additional, and one per counterparty).
- All three sections are **append-only lists**: **each Upload adds a NEW distinct
  document** to that section. Uploading **never replaces or deletes** an existing
  doc. (Versioning of an individual item is still handled by that item's existing
  **Replace** button — unchanged.)
- A **Budget Approval** upload additionally **flips the contract's
  `budget_approved` flag to `true`** (display flag only — no status change, no
  approvals re-triggered, no notifications). The flag flip is shown everywhere
  `budget_approved` is read.
- Make those sections **always visible** (even when empty) so docs can be added
  post-raise.
- Allow the **creator (POC)**, their **HOD**, and **LEGAL_TEAM/ADMIN** to upload
  supporting docs, but only in **pre-completion** statuses.
- **No contract status change** on upload; instead **log every upload to the
  activity timeline** ("{actor} uploaded {file} to {section}"), plus a second line
  when a Budget upload flips the flag.
- Let **POC and HOD view & download** signed/executed documents. Department
  scoping is **implicit**: anyone who can already read the contract can download
  (no extra department guard).
- **Leave the main contract document Replace flow completely untouched.**

## Non-Goals

- Changing the existing **Replace** flow (kept as-is, including its move to
  Under Review — see "Replace coexistence" below).
- Deleting supporting documents.
- Any change to the signing workflow itself.
- A schema/migration change for versioning (version order is derived; see below).

---

## Decisions (confirmed)

| Question | Decision (FINAL) |
|---|---|
| Who can upload new supporting docs | Creator (POC) + their HOD + LEGAL_TEAM/ADMIN |
| Sections shown when empty | Budget Approval + Additional + one per counterparty — **always rendered** |
| Upload semantics | **Append-only LIST**: each Upload adds a NEW distinct document. No replacement/deletion. |
| Section model | All three sections are flat lists of documents. (No version-chain logic for new uploads.) |
| Budget upload side-effect | Flips `contract.budget_approved` → `true` (display flag only). Logged when it actually flips. |
| Counterparty docs | One Upload per **existing** counterparty (no new-counterparty creation here). |
| Replace button | Existing per-item Replace **unchanged**; main-doc Replace **untouched**. |
| Signed-doc access for POC/HOD | Allowed; relies on existing contract read-access (department implicit). |
| Statuses allowing upload | Pre-completion only |
| Status change on upload | None — log to activity timeline instead (every upload). |
| File types | DOC / DOCX / PDF / **PNG / JPG** |

**Allowed upload statuses (pre-completion):** `DRAFT`, `UPLOADED`,
`HOD_PENDING`, `UNDER_REVIEW`, `PENDING_WITH_INTERNAL_STAKEHOLDERS`,
`PENDING_WITH_EXTERNAL_STAKEHOLDERS`, `OFFLINE_EXECUTION`, `ON_HOLD`.
**Blocked:** `SIGNING`, `COMPLETED`, `EXECUTED`, `VOID`, `REJECTED`.

---

## Feature A — Versioned Upload of supporting documents

### Versioning model

Each **section** (Budget Approval, Additional, or a specific counterparty) is a
single **version chain**:

- Every upload **appends** a new `contract_documents` row to that section.
  Nothing is overwritten or deleted.
- The **most recent** row in the section (by `created_at`) is the **Current**
  version; all earlier rows are that section's **Version History**.
- **Version labels are derived chronologically per section** (oldest = v1 …
  newest = highest, shown as "Current"). We do **not** rely on a stored
  `version_number` for supporting docs — today raise-time docs are all `v1` and
  replaced docs have `null`, so a stored number is unreliable. Deriving from
  `created_at` order is robust and needs no migration.

This is largely a **presentation** change: the backend already appends rows
(both raise and the existing Replace insert new rows and never delete), and the
UI currently lists them flat. We add an append-only Upload endpoint and
re-render each section as **Current + Version History**.

### Architecture

Reuse the existing two-phase signed-upload pattern that `replace-supporting-document`
uses: an `init` route returns a signed storage upload URL, the client PUTs the
file directly to storage, then a `finalize` route persists metadata. Both routes
are idempotent via the `Idempotency-Key` header.

The difference from *replace*: the versioned *upload* does not target a
`sourceDocumentId` and sets **no** `replaced_document_id`. Instead it takes a
**section descriptor** that determines the new version's grouping:

- `category: 'BUDGET'` → `displayName = "Budget Approval Supporting Docs"`, no `counterpartyId`
- `category: 'ADDITIONAL'` → `displayName = "Additional Supporting Docs"`, no `counterpartyId`
- `category: 'COUNTERPARTY'` → `displayName = "Counterparty Docs - <name>"`, `counterpartyId = <id>`

These displayName/counterpartyId values match the existing grouping logic in
`ContractDocumentsPanel.supportingDocumentsByCounterparty` so new uploads land in
the correct section/chain. All remain `documentKind = COUNTERPARTY_SUPPORTING`.

### Replace coexistence

The existing **Replace** action is **kept** (Legal/Admin, in its existing
statuses) and is unchanged: it inserts a new row with `replaced_document_id` set
and moves the contract to Under Review. Both Replace and the new Upload simply
append a newer row to the section chain, so the newest becomes Current either
way. The two actions differ only in their side effects (Replace → Under Review +
`contract.supporting_document.replaced` log; Upload → no status change +
`contract.supporting_document.added` log).

### Backend changes

**1. Service — `ContractUploadService` (`src/core/domain/contracts/contract-upload-service.ts`)**

New types:
- `AddSupportingDocumentMetadataInput` — `{ tenantId, contractId, category, counterpartyId?, fileName, fileSizeBytes, fileMimeType, uploadedByEmployeeId, uploadedByEmail, uploadedByRole }`

New methods (mirror `initiateReplaceSupportingDocument` / `finalizeReplaceSupportingDocument`):
- `initiateAddSupportingDocument(input)`:
  - validate file type (`isAllowedReplacementUpload`)
  - load contract via `getForAccess`; 404 if missing
  - `assertSupportingUploadPermissions(contract, input)` (new — see below)
  - if `category === 'COUNTERPARTY'`, require a non-empty `counterpartyId`
  - create a signed upload URL at
    `${tenantId}/${contractId}/counterparty-additions/${uuid}-${safeFileName}`
  - return `{ upload: { fileName, fileSizeBytes, fileMimeType, ...signedUpload } }`
- `finalizeAddSupportingDocument(input & { path })`:
  - re-validate file type and permissions
  - assert the uploaded object exists in storage
  - resolve `displayName` + `counterpartyId` from `category`
  - resolve counterparty **name** (for the audit log) — for `COUNTERPARTY`, look
    it up from the contract's counterparties by id
  - call a new repo method `addSupportingDocument(...)` (persists the document
    **and** writes the activity-log row in one place — see repo changes)
  - **No status change.**

New permission helper `assertSupportingUploadPermissions(contract, input)`:
- allow if `input.uploadedByRole ∈ {LEGAL_TEAM, ADMIN}`
- allow if `contract.uploadedByEmployeeId === input.uploadedByEmployeeId` (creator)
- allow if `input.uploadedByRole === 'HOD'` **and**
  `contractRepository.isUploaderInActorTeam({ actorEmployeeId, uploaderEmployeeId: contract.uploadedByEmployeeId })`
- otherwise throw `AuthorizationError('CONTRACT_SUPPORTING_UPLOAD_FORBIDDEN', …)`
- throw `BusinessRuleError('CONTRACT_SUPPORTING_UPLOAD_STATUS_FORBIDDEN', …)` if
  `contract.status` is not in the allowed pre-completion set.

Define `private readonly supportingUploadAllowedStatuses = new Set<ContractStatus>([...])`
with the eight pre-completion statuses listed above.

**2. Repository — `ContractRepository` interface + Supabase impl**

New method `addSupportingDocument(input)` (write repo,
`src/core/infra/repositories/supabase-contract-repository.ts`):
- insert into `contract_documents` (same columns as `createDocument`,
  `document_kind = 'COUNTERPARTY_SUPPORTING'`, **`replaced_document_id = null`**,
  `version_number` left unset — display order is derived chronologically)
- capture the new `document_id`
- insert an `audit_logs` row (mirrors `replaceSupportingDocument`'s audit write):
  ```
  action:      'contract.supporting_document.added'
  event_type:  'CONTRACT_SUPPORTING_DOCUMENT_ADDED'
  actor_email / actor_role / user_id: from input
  resource_type: 'contract', resource_id: contractId
  metadata: {
    document_id,
    section_category: 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY',
    counterparty_name?: string,
    file_name, file_mime_type, file_size_bytes
  }
  ```
- Add to the `ContractRepository` interface in
  `src/core/domain/contracts/contract-repository.ts` and the `CreateContractDocumentInput`-style
  input type in `types.ts` (or a dedicated `AddSupportingDocumentInput`).

**3. Routes**

- `POST /api/contracts/:contractId/supporting-document/init`
- `POST /api/contracts/:contractId/supporting-document/finalize`

Both copied from the `replace-supporting-document` routes, with the request schema
changed from `{ documentId, file }` to `{ category, counterpartyId?, file }`
(finalize also carries `file.path`). Same idempotency handling.

Add route keys to `src/core/config/route-registry.ts`:
`addSupportingDocumentInit`, `addSupportingDocumentFinalize`.

**4. Client — `contractsClient` (`src/core/client/contracts-client.ts`)**

New `addSupportingDocument({ contractId, category, counterpartyId?, file, idempotencyKey })`,
modeled on `replaceSupportingDocument` (init → `xhrSignedUpload` → finalize).

### Frontend changes — `ContractDocumentsPanel.tsx`

- New prop `counterparties: Array<{ id: string; counterpartyName: string }>`
  (the workspace already holds this in state and passes it down).
- New prop / computed `canUploadSupporting`, plus uploader identity already
  available via `userRole`, `actorEmployeeId`, `uploadedByEmployeeId`:
  - `canUploadSupporting = isPreCompletionStatus(contractStatus) && (role ∈ {LEGAL_TEAM, ADMIN} || actorEmployeeId === uploadedByEmployeeId || role === 'HOD')`
  - (HOD team-membership is enforced server-side; the UI optimistically shows it
    for HOD and surfaces a toast if the server rejects.)
- **Always render the supporting-docs area.** Build the section list by merging:
  1. a fixed **Budget Approval Supporting Documents** section,
  2. a fixed **Additional Supporting Documents** section,
  3. one section per entry in `counterparties`,
  with any already-grouped documents from
  `supportingDocumentsByCounterparty` keyed in. Empty sections render with no rows
  but still show their **Upload** button.
- **Each section renders as a version chain** (mirrors the primary doc's
  Active + History layout, scoped to the section):
  - sort the section's docs by `createdAt` desc;
  - the newest is shown as the **Current version** (with a derived label such as
    `vN · Current`), with Preview / Download;
  - the remaining docs render under a per-section **Version History** sub-list
    (Preview / Download each), labeled `v1 … v(N-1)` in chronological order.
- Section header actions:
  - **Upload** button (shown when `canUploadSupporting`) — adds a new version.
  - **Replace** button (existing gating, `canReplaceSupporting`, Legal/Admin) —
    shown only when the section has ≥1 document; unchanged behavior.
- New **Upload modal** (parallel to the replace modal): file input
  (`.doc,.docx,.pdf`) + the target section descriptor (`category`,
  `counterpartyId`) captured from which section's Upload was clicked. On submit,
  call `contractsClient.addSupportingDocument(...)`, then `onRefreshDocuments()`,
  with `toast.promise` feedback. After refresh, the just-uploaded file appears as
  the new Current version and the previous Current moves into Version History.

### Activity-log lines (Feature A)

Add a canonical event type `SUPPORTING_DOCUMENT_ADDED` to
`src/modules/contracts/ui/formatContractLogEvent.ts`:

- Register `'SUPPORTING_DOCUMENT_ADDED'` in `CanonicalContractLogEventType`,
  `knownCanonicalEventTypes`, and the `resolveCategory` switch → category
  `GENERAL` (📝).
- Map both the event_type and the action in `normalizeEventType` /
  `normalizeFromAction`:
  - `'CONTRACT_SUPPORTING_DOCUMENT_ADDED'` → `SUPPORTING_DOCUMENT_ADDED`
  - `'contract.supporting_document.added'` → `SUPPORTING_DOCUMENT_ADDED`
- Message text in `resolveLogMessage` (reads `metadata.section_category`,
  `metadata.counterparty_name`, `metadata.file_name`):

  | Section | Log line |
  |---|---|
  | Budget Approval | `Added "{fileName}" to Budget Approval Supporting Documents.` |
  | Additional | `Added "{fileName}" to Additional Supporting Documents.` |
  | Counterparty | `Added "{fileName}" to Counterparty Documents for {counterpartyName}.` |
  | Fallback (no metadata) | `Added a supporting document.` |

  When `fileName` is missing, drop the quoted name: e.g. `Added a document to
  Budget Approval Supporting Documents.`

---

## Feature B — POC & HOD view + download signed/executed docs

### Frontend — `ContractsWorkspace.tsx`

- Currently `canViewSignedDocsTab = role === 'LEGAL_TEAM' || role === 'ADMIN'`.
  This both shows the tab **and** triggers signed-docs data fetching.
- Widen tab **visibility** to also include the creator (POC) and HOD. Introduce a
  separate read-only flag so we don't accidentally grant management powers:
  - `canViewSignedDocsTab` (existing name) → true for LEGAL_TEAM, ADMIN, the
    contract creator (`session.employeeId === contract.uploadedByEmployeeId`), and
    HOD. The Signed Docs tab body (signatory status list + the three download
    buttons) is already entirely read-only, so no extra gating is needed for those
    elements.
- The tab's download handlers (`handleDownloadFinalSignedDocument`,
  `handleDownloadCompletionCertificate`, `handleDownloadMergedSigningArtifact`)
  are unchanged on the client; they rely on the backend gate below.

### Backend — `downloadFinalSigningArtifact` (`contract-signatory-service.ts:644`)

Currently throws unless `actorRole ∈ {LEGAL_TEAM, ADMIN}`. Replace that hard gate
with a **read-access check** consistent with
`ContractUploadService.createSignedDownloadUrl`'s `canRead`:

- privileged roles (LEGAL_TEAM, ADMIN), **or**
- contract creator (`uploadedByEmployeeId === actorEmployeeId`), **or**
- current assignee, **or**
- additional approver, **or**
- HOD whose team contains the uploader (`isUploaderInActorTeam`).

The method already calls `getContractDetail` with the actor's id/role immediately
after, which itself enforces read access, so this change only relaxes the role
allow-list to match who can already read the contract. Keep the
`SIGNATORY_DOCUMENT_NOT_AVAILABLE` envelope check.

### Documents tab

No change required — the "Execution Artifacts" section in
`ContractDocumentsPanel` already shows Preview/Download for `EXECUTED_CONTRACT`
and `AUDIT_CERTIFICATE` to every viewer, and the `download` route authorizes the
creator/HOD. This satisfies the "Documents-tab download" half of "Both".

---

## Testing

- **Service:** `assertSupportingUploadPermissions` — allow creator / HOD-in-team /
  legal / admin; reject others; reject blocked statuses. `initiate`/`finalize`
  happy paths and storage-missing error.
- **Repository:** `addSupportingDocument` writes the document row and the
  `contract.supporting_document.added` audit row with correct metadata. (Extend
  existing repo tests / mocks.)
- **Log formatting:** extend `formatContractLogEvent.test.ts` for the three
  section variants and the fallback.
- **Signatory service:** `downloadFinalSigningArtifact` now allows creator/HOD;
  still rejects unrelated users.
- **UI:** `ContractDocumentsPanel.test.tsx` — sections always render (incl.
  empty); newest doc shown as Current and older ones under Version History,
  ordered by `createdAt`; Upload button visible only when `canUploadSupporting`;
  Replace still gated as before; upload modal submits the right section
  descriptor.
- **Workspace:** Signed Docs tab visible to POC/HOD, read-only.
- Run the full `jest` suite and `tsc` / lint before completion.

## Rollout / risk notes

- Storage path prefix `counterparty-additions/` is new but lives under the same
  private bucket and tenant/contract scoping as existing uploads.
- No DB migration required — reuses `contract_documents` and `audit_logs`.
- The relaxed `downloadFinalSigningArtifact` gate is the only authorization
  broadening; it is bounded by the existing `getContractDetail` read-access
  enforcement.
