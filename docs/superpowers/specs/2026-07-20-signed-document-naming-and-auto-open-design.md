# Signed Document Naming & Post-Upload Auto-Open — Design

**Date:** 2026-07-20
**Status:** Approved, not yet implemented
**Requested by:** Legal team

## Problem

Two unrelated friction points raised together by Legal:

1. **Downloaded signed documents have unusable filenames.** The executed
   contract and completion certificate are stored under machine-generated names
   (`executed-<envelopeId>.pdf`, `audit-certificate-<envelopeId>.pdf`,
   `completion-certificate-and-signed-<envelopeId>.pdf`). These names reach the
   user in two places: the file that lands in their Downloads folder, and the
   Signed Docs list in the contract detail page
   (`ContractDocumentsPanel.tsx:635`). Neither identifies the contract.

2. **Uploading a document drops you back on the dashboard.** After upload the
   sidebar navigates to `/dashboard`
   (`ThirdPartyUploadSidebar.tsx:437`), so the uploader must search for the
   contract they just created to do anything with it.

## Goals

- Signed artifacts download and display as `<Title> - <Suffix> - <DD-MM-YYYY>`.
- Users never see an internal storage filename anywhere in the UI.
- Legal team members land on the new contract's detail page after uploading.

## Non-Goals

- No change to storage keys, storage layout, or the `file_name` column.
- No renaming of already-stored objects; nothing is migrated or backfilled.
- No change to which roles may download signed artifacts.
- Not unifying the two duplicated `ContractDocument` type declarations
  (`contract-query-repository.ts:169`, `contracts-client.ts:86`). They are
  already hand-kept in sync; that refactor is out of scope.

## Invariants

These hold for the whole change and are the acceptance criteria for review:

1. `downloadFileName` is the single user-facing filename, used by the Documents
   panel, Signed Docs, Version History, and all downloads.
2. `fileName` is the internal/storage filename only and is never rendered.
3. Storage keys and the `contract_documents.file_name` column are unchanged.
4. The filename builder is the only code that produces friendly names. No
   consumer composes or patches a filename itself.

---

## Part 1 — Filename

### Approach

The name is **derived per request, never persisted**. Rejected alternatives:

- *Rename at artifact-persist time.* Only affects contracts signed after the
  change, and puts arbitrary user text (titles may contain `/`, `:`, emoji)
  into storage keys.
- *Rename client-side via `anchor.download`.* Does not work for the
  signed-URL-in-a-new-tab path (`ContractsWorkspace.tsx:862`), which is the
  common case once an artifact is cached in storage.

Deriving per request also means the name applies retroactively to every
already-executed contract, and stays correct if a contract title is later
edited.

### Builder

New module `src/core/domain/contracts/signed-document-filename.ts`. Pure, no I/O.

```
buildSignedArtifactFileName({ title, artifact, executedAt }): string
```

**Suffix per artifact:**

| `artifact` | Suffix | Triggering button |
|---|---|---|
| `signed_document` | `Signed` | "Download Signed Document" (`ContractsWorkspace.tsx:3088`) |
| `completion_certificate` | `Completion Certificate` | "Download Completion Certificate" (`:3106`) |
| `merged_pdf` | `Signed with Certificate` | "Download Combined PDF" (`:3122`) |

The first two suffixes match their button labels. The third deliberately does
not: "Combined PDF" describes the action but reads poorly in a filename and
does not say what was combined. `Signed with Certificate` keeps the `Signed`
stem shared with the other artifacts, so all three sort together in a folder.

**Date** — the execution date, defined as the app already defines it at
`supabase-contract-query-repository.ts:6564-6570`: the latest `signedAt` across
all signatories, and only when every signatory has signed. Formatted
`DD-MM-YYYY`.

**Sanitisation** — strip characters illegal in filenames on Windows and POSIX
(`\ / : * ? " < > |`) plus control characters, collapse runs of whitespace,
trim. Truncate the title segment so the assembled name stays under 200
characters, leaving room for suffix, date, and extension.

**Fallbacks**

| Condition | Result |
|---|---|
| Title empty after trim | Use `contractSigningSubject.missingDocumentFallbackTitle` (`"Contract"`) |
| `executedAt` null/absent | Omit the date segment entirely — `<Title> - Signed.pdf`. Never emit `Invalid Date`. |
| Title sanitises to empty | Same as empty title |

Extension is always `.pdf`; all three artifacts are PDFs.

### Where it is computed

**`contract-query-service.ts:254-262`, in `getContractDetail`.** This is the
single computation site. It already holds both inputs — `contract.title` and
`signatories` — so no additional query is needed.

Each document in the returned view gains:

```
downloadFileName: string   // added to ContractDocument
```

- `EXECUTED_CONTRACT` / `AUDIT_CERTIFICATE` → built friendly name.
- `PRIMARY` / `COUNTERPARTY_SUPPORTING` → falls back to existing `fileName`.

The fallback is deliberate. Primary and supporting documents already carry the
user's own uploaded filename, sanitised at `contract-upload-service.ts:323`
(e.g. `MSA_Acme.docx`). Those are not internal names and must not be rewritten.
The `executed-<id>.pdf` pattern only ever appears on the two signing artifacts.
Populating the field for every kind lets the UI render one field uniformly and
prevents a regression if new document kinds are added later.

`ContractDocument` must gain the field in both declarations:
`contract-query-repository.ts:169` and `contracts-client.ts:86`. No presenter
sits between the service and the API response for documents, so the field
passes through without further plumbing.

### Consumers

**1. Documents panel.** Replace `document.fileName` with
`document.downloadFileName` at `ContractDocumentsPanel.tsx:109`, `:192`,
`:635`, `:763`. Line `:635` is the Signed Docs section — the only one leaking
an internal name today. The other three are no-op swaps that satisfy invariant
2 and keep the component consistent.

**2. Download, storage-hit path.** `downloadFinalSigningArtifact` already calls
`getContractDetail` at `contract-signatory-service.ts:652` and resolves
`localDocument` at `:689`. The return at `:731` reads
`localDocument.downloadFileName` instead of `localDownload.fileName`. No
separate computation.

**3. Download, Zoho-fallback path.** No local document exists yet, so the return
at `:833` calls the builder directly with the same title and signatories from
`contractView`. Same function, same output.

**4. Merged artifact.** `downloadMergedSigningArtifact` has several return
points that each set `fileName` (`:900`, `:972`, `:1028`). The computed name is
passed in as a parameter so every return path uses it.

**5. The Execution Artifacts Download button.** The Signed Docs list renders its
own Download button at `ContractDocumentsPanel.tsx:659`, which calls
`onDownloadDocument` → `handleDownload` (`ContractsWorkspace.tsx:806`) →
`/api/contracts/:contractId/download?documentId=…`. That generic route resolves
the name via `contract-upload-service.ts:1101` `createSignedDownloadUrl`, which
returns `document.fileName` — the internal name. Left alone, this button
violates invariant 1.

**Resolution: route it through the final-artifact endpoint instead.** In
`handleDownload`, branch on document kind before falling through to the generic
client call:

| `documentKind` | Handler |
|---|---|
| `EXECUTED_CONTRACT` | `handleDownloadFinalSignedDocument()` |
| `AUDIT_CERTIFICATE` | `handleDownloadCompletionCertificate()` |
| anything else | existing generic path, unchanged |

Rejected alternative: teach the generic path to build friendly names. It would
need the contract title *and* the execution date, but the upload service's
repository exposes `getForAccess` and no `getSignatories`, so this means a new
repository dependency plus a second site that composes filenames — violating
invariant 4. Delegating instead reuses the endpoint already built for these two
artifacts and keeps naming in one place.

Consequence: the generic route's **behaviour** is unchanged. After this it only
ever serves `PRIMARY` and `COUNTERPARTY_SUPPORTING` documents, whose `fileName`
is already the user's own sanitised upload name. Its underlying service method
`createSignedDownloadUrl` does still gain an optional `downloadFileName`
parameter (see *Signed-URL plumbing* below) — but only the signatory service
passes it, and the generic route continues to call the method without it.

### Signed-URL plumbing

Two of the three download paths return a Supabase signed URL that the client
opens in a new tab (`ContractsWorkspace.tsx:862`, `:898`, `:934`). The
browser takes the filename from `Content-Disposition`, which for a bare signed
URL reflects the storage key. Supabase supports overriding this:

```
createSignedUrl(path, expiresIn, { download: friendlyName })
```

Changes required:

- `supabase-contract-storage-repository.ts:33` — accept an optional
  `downloadFileName` and forward it as `{ download }`.
- `contract-storage-repository.ts` — widen the interface signature.
- `contract-upload-service.ts:1101` `createSignedDownloadUrl` — accept and
  forward the option, so the call at `contract-signatory-service.ts:710` can
  supply it.

The parameter is optional throughout; existing callers are unaffected.

The blob path needs no change — the route already sets `Content-Disposition`
from `result.fileName` (`signed-docs/final/download/route.ts:79`), which will
now carry the friendly name.

`@supabase/supabase-js` is `^2.95.3`; the `download` option is supported.

---

## Part 2 — Auto-open after upload

### Scope

Both upload types — "send for signing" and third-party — flow through the same
`handleSubmit` in `ThirdPartyUploadSidebar.tsx`, so the `mode` prop does not
participate in this change. One edit covers both.

### Change

At `ThirdPartyUploadSidebar.tsx:431-438`, the post-success block currently runs
unconditionally:

```
onClose(); resetAll(); router.push('/dashboard'); router.refresh()
```

Make the destination conditional:

| Actor role | Destination |
|---|---|
| `LEGAL_TEAM` | `/contracts/${response.data.contract.id}` |
| anything else | `/dashboard` (unchanged) |

`actorRole` is already a prop and is passed by all four call sites:
`DashboardClient.tsx:1510`, `RepositoryWorkspace.tsx:1677`,
`AdditionalApproverHistoryWorkspace.tsx:294`, `AdminConsoleClient.tsx:851`.
`upload()` returns a `ContractRecord`, so `.id` is available at `:420`.

Introduce a separate, narrowly-named constant rather than reusing the existing
`isLegalActor` flag at `:106` — that one also matches `ADMIN`, and this
behaviour is `LEGAL_TEAM` only. Keeping them distinct avoids widening a flag
other logic depends on.

### Ordering

`onUploaded()` is awaited before navigation (`:431-433`). Those callbacks
refresh the list on the page being navigated away from, which is redundant but
harmless. The await is kept: several call sites also `router.refresh()`, and
skipping it risks a stale list on back-navigation.

### Access

Safe. `canAccessContract` grants the uploader access via
`uploadedByEmployeeId`, so a legal user can always open a contract they just
uploaded.

---

## Testing

**Builder (unit, pure).**
- All three artifact suffixes.
- Sanitisation: illegal characters, collapsed whitespace, over-length titles.
- Fallbacks: empty title, title that sanitises to empty, null `executedAt`.
- Date formatting is `DD-MM-YYYY`, including single-digit day and month.

**Query service.**
- `downloadFileName` is the friendly name for `EXECUTED_CONTRACT` and
  `AUDIT_CERTIFICATE`.
- `downloadFileName` equals `fileName` for `PRIMARY` and
  `COUNTERPARTY_SUPPORTING`.
- Date omitted when signatories are only partially signed.

**Signatory service.**
- Storage-hit path returns `downloadFileName`.
- Zoho-fallback path returns the built name.
- Merged path returns the built name from every return point.
- `createSignedDownloadUrl` receives the `downloadFileName` option.

**Documents panel (RTL).**
- Signed Docs renders the friendly name.
- Guard assertion: no rendered text matches `/^executed-|^audit-certificate-|^completion-certificate-and-signed-/`.
- The Execution Artifacts Download button dispatches to the final-artifact
  handler for `EXECUTED_CONTRACT` and `AUDIT_CERTIFICATE`, and to the generic
  path for `PRIMARY` and `COUNTERPARTY_SUPPORTING`.

**Upload sidebar (RTL).**
- `router.push` target for `LEGAL_TEAM`, `USER`, and `ADMIN`, across both
  upload modes.
- `DashboardClient.test.tsx:34` mocks this component, so existing dashboard
  tests are unaffected.

## Risks

| Risk | Mitigation |
|---|---|
| A rendering site for `fileName` is missed, leaking an internal name | The panel guard assertion catches the known kinds regardless of which line renders them |
| Long or unusual titles produce an invalid filename | Sanitisation and truncation are unit-tested against the builder directly |
| Duplicate downloads collide in the Downloads folder | Accepted. The browser de-duplicates with `(1)` suffixes; the date makes collisions unlikely in practice |
