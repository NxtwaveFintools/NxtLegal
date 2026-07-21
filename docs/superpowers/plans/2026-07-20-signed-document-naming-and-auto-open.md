# Signed Document Naming & Post-Upload Auto-Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **GIT POLICY FOR THIS REPO — READ FIRST:** The user handles all git operations
> manually. **Never run `git add`, `git commit`, or `git push`.** Where other
> plans would commit, this plan has a **Checkpoint** step: stop, report what
> changed, and let the user commit. This overrides the usual "frequent commits"
> guidance.

**Goal:** Signed contract artifacts download and display as `<Title> - <Suffix> - <DD-MM-YYYY>.pdf` everywhere in the UI, and LEGAL_TEAM members land on the new contract's detail page after uploading instead of the dashboard.

**Architecture:** A single pure builder module derives user-facing filenames. `getContractDetail` decorates every document with a `downloadFileName` field, which becomes the only name rendered or downloaded. Storage keys and the `file_name` column are never touched — the name is derived per request, so it applies retroactively to already-executed contracts and survives title edits.

**Tech Stack:** TypeScript, Next.js App Router, Supabase (Postgres + Storage), Jest + ts-jest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-20-signed-document-naming-and-auto-open-design.md`

---

## Invariants (acceptance criteria for every task)

1. `downloadFileName` is the single user-facing filename — Documents panel, Signed Docs, Version History, and all downloads.
2. `fileName` is the internal/storage filename only and is **never rendered**.
3. Storage keys and the `contract_documents.file_name` column are unchanged.
4. `signed-document-filename.ts` is the **only** code that composes friendly names. No consumer builds or patches a filename itself.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/core/domain/contracts/signed-document-filename.ts` | Pure filename derivation: sanitisation, date formatting, execution-date resolution, per-kind name selection. No I/O. |
| `src/core/domain/contracts/signed-document-filename.test.ts` | Unit tests for the builder. |
| `src/modules/contracts/ui/resolveDownloadStrategy.ts` | Pure mapping from document kind to which download endpoint serves it. |
| `src/modules/contracts/ui/resolveDownloadStrategy.test.ts` | Unit tests for the mapping. |
| `src/modules/contracts/ui/third-party-upload/resolvePostUploadDestination.ts` | Pure mapping from actor role to post-upload route. |
| `src/modules/contracts/ui/third-party-upload/resolvePostUploadDestination.test.ts` | Unit tests for the mapping. |

**Modified:**

| File | Change |
|---|---|
| `src/core/domain/contracts/contract-query-repository.ts:169` | Add `downloadFileName` to `ContractDocument`. |
| `src/core/client/contracts-client.ts:86` | Add `downloadFileName` to the client-side `ContractDocument` twin. |
| `src/core/domain/contracts/contract-query-service.ts:254` | Decorate documents in `getContractDetail`. |
| `src/core/domain/contracts/contract-storage-repository.ts:4` | Optional `downloadFileName` on `createSignedDownloadUrl`. |
| `src/core/infra/repositories/supabase-contract-storage-repository.ts:33` | Forward it as Supabase's `{ download }` option. |
| `src/core/domain/contracts/contract-upload-service.ts:1101` | Accept and forward the option. |
| `src/core/domain/contracts/contract-signatory-service.ts` | Use `downloadFileName` on all artifact return paths. |
| `src/core/domain/contracts/contract-signatory-service.test.ts:98` | **Existing assertion breaks** — update to the new merged name. |
| `src/modules/contracts/ui/ContractDocumentsPanel.tsx` | Render `downloadFileName`; lines 109, 192, 635, 763. |
| `src/modules/contracts/ui/ContractsWorkspace.tsx:806` | Dispatch execution artifacts to the final-artifact handlers. |
| `src/modules/contracts/ui/third-party-upload/ThirdPartyUploadSidebar.tsx:431` | Route LEGAL_TEAM to the contract detail page. |

**Dependency order:** Task 1 → Task 2 → Task 3 → (Tasks 4, 5 independent) → Task 6 (needs 1 and 5) → Task 7 (independent of all) → Task 8.

---

## Task 1: Filename builder module

**Files:**
- Create: `src/core/domain/contracts/signed-document-filename.ts`
- Test: `src/core/domain/contracts/signed-document-filename.test.ts`

**Timezone decision:** the builder runs server-side, where the process TZ is typically UTC. Formatting with the default locale would shift the date for IST users — a contract signed `2026-07-20T20:00:00Z` is 21 July in India. The formatter is therefore pinned to `Asia/Kolkata`.

**Regex warning:** write the two character classes exactly as shown. Do not "tidy" them by adding space or hyphen to the illegal-character class — hyphens are required by the `" - "` separator, and adding one silently produces `MSA Acme Corp` from `MSA - Acme Corp`. Use the `\x` escape form for control characters; never paste literal control bytes into the source.

- [ ] **Step 1: Write the failing tests**

Create `src/core/domain/contracts/signed-document-filename.test.ts`:

```typescript
import {
  buildSignedArtifactFileName,
  formatExecutionDate,
  resolveDocumentDownloadFileName,
  resolveExecutedAt,
  sanitizeTitleForFileName,
} from '@/core/domain/contracts/signed-document-filename'

describe('sanitizeTitleForFileName', () => {
  it('strips characters that are illegal in filenames', () => {
    expect(sanitizeTitleForFileName('MSA / Acme: Q3 *draft?')).toBe('MSA Acme Q3 draft')
  })

  it('preserves hyphens and single spaces', () => {
    expect(sanitizeTitleForFileName('MSA - Acme Corp')).toBe('MSA - Acme Corp')
  })

  it('collapses runs of whitespace and trims', () => {
    expect(sanitizeTitleForFileName('  Master   Agreement  ')).toBe('Master Agreement')
  })

  it('strips control characters', () => {
    expect(sanitizeTitleForFileName('Tab\there')).toBe('Tab here')
  })

  it('falls back to "Contract" when the title is empty', () => {
    expect(sanitizeTitleForFileName('   ')).toBe('Contract')
  })

  it('falls back to "Contract" when the title sanitises to empty', () => {
    expect(sanitizeTitleForFileName('///:::')).toBe('Contract')
  })

  it('truncates over-long titles to 120 characters', () => {
    expect(sanitizeTitleForFileName('A'.repeat(300))).toHaveLength(120)
  })
})

describe('formatExecutionDate', () => {
  it('formats an ISO timestamp as DD-MM-YYYY', () => {
    expect(formatExecutionDate('2026-07-20T09:30:00.000Z')).toBe('20-07-2026')
  })

  it('pads single-digit days and months', () => {
    expect(formatExecutionDate('2026-01-05T09:30:00.000Z')).toBe('05-01-2026')
  })

  it('uses the India timezone rather than the server timezone', () => {
    // 20:00 UTC on 20 July is 01:30 on 21 July in Asia/Kolkata.
    expect(formatExecutionDate('2026-07-20T20:00:00.000Z')).toBe('21-07-2026')
  })

  it('returns null for null, undefined, and unparseable input', () => {
    expect(formatExecutionDate(null)).toBeNull()
    expect(formatExecutionDate(undefined)).toBeNull()
    expect(formatExecutionDate('not-a-date')).toBeNull()
  })
})

describe('resolveExecutedAt', () => {
  it('returns the latest signedAt when every signatory has signed', () => {
    const result = resolveExecutedAt([
      { status: 'SIGNED', signedAt: '2026-07-18T10:00:00.000Z' },
      { status: 'SIGNED', signedAt: '2026-07-20T10:00:00.000Z' },
    ])

    expect(result).toBe('2026-07-20T10:00:00.000Z')
  })

  it('returns null when any signatory is still pending', () => {
    const result = resolveExecutedAt([
      { status: 'SIGNED', signedAt: '2026-07-18T10:00:00.000Z' },
      { status: 'PENDING', signedAt: null },
    ])

    expect(result).toBeNull()
  })

  it('returns null when a signatory is marked signed but has no timestamp', () => {
    expect(resolveExecutedAt([{ status: 'SIGNED', signedAt: null }])).toBeNull()
  })

  it('returns null when there are no signatories', () => {
    expect(resolveExecutedAt([])).toBeNull()
  })
})

describe('buildSignedArtifactFileName', () => {
  const title = 'MSA - Acme Corp'
  const executedAt = '2026-07-20T09:30:00.000Z'

  it('names the executed contract with the "Signed" suffix', () => {
    expect(buildSignedArtifactFileName({ title, artifact: 'signed_document', executedAt })).toBe(
      'MSA - Acme Corp - Signed - 20-07-2026.pdf'
    )
  })

  it('names the completion certificate with its own suffix', () => {
    expect(
      buildSignedArtifactFileName({ title, artifact: 'completion_certificate', executedAt })
    ).toBe('MSA - Acme Corp - Completion Certificate - 20-07-2026.pdf')
  })

  it('names the merged artifact with the "Signed with Certificate" suffix', () => {
    expect(buildSignedArtifactFileName({ title, artifact: 'merged_pdf', executedAt })).toBe(
      'MSA - Acme Corp - Signed with Certificate - 20-07-2026.pdf'
    )
  })

  it('omits the date segment entirely when the execution date is unknown', () => {
    const result = buildSignedArtifactFileName({ title, artifact: 'signed_document', executedAt: null })

    expect(result).toBe('MSA - Acme Corp - Signed.pdf')
    expect(result).not.toContain('Invalid Date')
  })

  it('uses the fallback title when the contract title is empty', () => {
    expect(buildSignedArtifactFileName({ title: '', artifact: 'signed_document', executedAt })).toBe(
      'Contract - Signed - 20-07-2026.pdf'
    )
  })

  it('keeps the assembled name under 200 characters for a very long title', () => {
    const result = buildSignedArtifactFileName({
      title: 'B'.repeat(400),
      artifact: 'merged_pdf',
      executedAt,
    })

    expect(result.length).toBeLessThan(200)
  })
})

describe('resolveDocumentDownloadFileName', () => {
  const contractTitle = 'MSA - Acme Corp'
  const executedAt = '2026-07-20T09:30:00.000Z'

  it('renames the executed contract', () => {
    const result = resolveDocumentDownloadFileName({
      documentKind: 'EXECUTED_CONTRACT',
      fileName: 'executed-envelope-123.pdf',
      contractTitle,
      executedAt,
    })

    expect(result).toBe('MSA - Acme Corp - Signed - 20-07-2026.pdf')
  })

  it('renames the audit certificate', () => {
    const result = resolveDocumentDownloadFileName({
      documentKind: 'AUDIT_CERTIFICATE',
      fileName: 'audit-certificate-envelope-123.pdf',
      contractTitle,
      executedAt,
    })

    expect(result).toBe('MSA - Acme Corp - Completion Certificate - 20-07-2026.pdf')
  })

  it('leaves primary documents on their uploaded filename', () => {
    const result = resolveDocumentDownloadFileName({
      documentKind: 'PRIMARY',
      fileName: 'MSA_Acme.docx',
      contractTitle,
      executedAt,
    })

    expect(result).toBe('MSA_Acme.docx')
  })

  it('leaves counterparty supporting documents on their uploaded filename', () => {
    const result = resolveDocumentDownloadFileName({
      documentKind: 'COUNTERPARTY_SUPPORTING',
      fileName: 'board-resolution.pdf',
      contractTitle,
      executedAt,
    })

    expect(result).toBe('board-resolution.pdf')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- signed-document-filename`
Expected: FAIL — `Cannot find module '@/core/domain/contracts/signed-document-filename'`

- [ ] **Step 3: Write the implementation**

Create `src/core/domain/contracts/signed-document-filename.ts`:

```typescript
import { contractSignatoryStatuses, contractSigningSubject } from '@/core/constants/contracts'

export type SignedArtifactType = 'signed_document' | 'completion_certificate' | 'merged_pdf'

export type ContractDocumentKind =
  | 'PRIMARY'
  | 'COUNTERPARTY_SUPPORTING'
  | 'EXECUTED_CONTRACT'
  | 'AUDIT_CERTIFICATE'

const artifactSuffixes: Record<SignedArtifactType, string> = {
  signed_document: 'Signed',
  completion_certificate: 'Completion Certificate',
  merged_pdf: 'Signed with Certificate',
}

const maxTitleLength = 120

// Characters illegal in filenames on Windows and/or POSIX, listed explicitly.
// Space and hyphen are deliberately absent: spaces are handled by the
// whitespace collapse below, and hyphens are required by the " - " separator.
const illegalFileNameCharacters = /["*/:<>?\\|]/g

// C0 control characters, written as \x escapes so no literal control byte
// ever appears in this source file.
const controlCharacters = /[\x00-\x1f]/g

// Built server-side, where the process timezone is typically UTC. Pinned to
// India so the date in the filename matches the date the user considers the
// contract executed.
const executionDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export function sanitizeTitleForFileName(title: string): string {
  const cleaned = (title ?? '')
    .replace(illegalFileNameCharacters, ' ')
    .replace(controlCharacters, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned.length === 0) {
    return contractSigningSubject.missingDocumentFallbackTitle
  }

  return cleaned.length > maxTitleLength ? cleaned.slice(0, maxTitleLength).trim() : cleaned
}

export function formatExecutionDate(executedAt: string | null | undefined): string | null {
  if (!executedAt) {
    return null
  }

  const parsed = new Date(executedAt)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return executionDateFormatter.format(parsed).replace(/\//g, '-')
}

/**
 * The execution date is the latest signature timestamp, and only once every
 * signatory has signed. Mirrors the definition already used for the repository
 * `executedAt` column in supabase-contract-query-repository.ts.
 */
export function resolveExecutedAt(
  signatories: Array<{ status: string; signedAt: string | null }>
): string | null {
  if (signatories.length === 0) {
    return null
  }

  let latestSignedAt: string | null = null

  for (const signatory of signatories) {
    if (signatory.status !== contractSignatoryStatuses.signed || !signatory.signedAt) {
      return null
    }

    if (!latestSignedAt || signatory.signedAt > latestSignedAt) {
      latestSignedAt = signatory.signedAt
    }
  }

  return latestSignedAt
}

export function buildSignedArtifactFileName(params: {
  title: string
  artifact: SignedArtifactType
  executedAt?: string | null
}): string {
  const safeTitle = sanitizeTitleForFileName(params.title)
  const formattedDate = formatExecutionDate(params.executedAt)
  const suffix = artifactSuffixes[params.artifact]

  const segments = formattedDate ? [safeTitle, suffix, formattedDate] : [safeTitle, suffix]

  return `${segments.join(' - ')}.pdf`
}

/**
 * The user-facing filename for a document. Signing artifacts get a friendly
 * generated name; primary and supporting documents keep the uploader's own
 * filename, which is already human-readable.
 */
export function resolveDocumentDownloadFileName(params: {
  documentKind: ContractDocumentKind
  fileName: string
  contractTitle: string
  executedAt: string | null
}): string {
  if (params.documentKind === 'EXECUTED_CONTRACT') {
    return buildSignedArtifactFileName({
      title: params.contractTitle,
      artifact: 'signed_document',
      executedAt: params.executedAt,
    })
  }

  if (params.documentKind === 'AUDIT_CERTIFICATE') {
    return buildSignedArtifactFileName({
      title: params.contractTitle,
      artifact: 'completion_certificate',
      executedAt: params.executedAt,
    })
  }

  return params.fileName
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- signed-document-filename`
Expected: PASS — 24 tests green.

- [ ] **Step 5: Checkpoint**

Do not commit. Report: new module + tests added, all passing.

---

## Task 2: Add `downloadFileName` to the document types and populate it

**Files:**
- Modify: `src/core/domain/contracts/contract-query-repository.ts:169-180`
- Modify: `src/core/client/contracts-client.ts:86-97`
- Modify: `src/core/domain/contracts/contract-query-service.ts:254-262`
- Test: `src/core/domain/contracts/contract-query-service.test.ts`

- [ ] **Step 1: Add the field to both type declarations**

In `src/core/domain/contracts/contract-query-repository.ts`, add to `ContractDocument` directly after `fileName` (line 176):

```typescript
  fileName: string
  /** User-facing filename. Derived per request; never persisted. */
  downloadFileName: string
```

In `src/core/client/contracts-client.ts`, add the identical field after `fileName` (line 93):

```typescript
  fileName: string
  /** User-facing filename. Derived per request; never persisted. */
  downloadFileName: string
```

- [ ] **Step 2: Run the typecheck to see every construction site**

Run: `npx tsc --noEmit`
Expected: FAIL, listing each place a `ContractDocument` is built without the new field. These are the test fixtures you will fix in Step 5. Note the list before continuing.

If a **non-test** file appears in that list, stop and report it: it is constructing documents outside `getContractDetail`, which may be a second naming site that would violate invariant 4.

- [ ] **Step 3: Write the failing test**

Append to `src/core/domain/contracts/contract-query-service.test.ts`. Build the service exactly the way the existing `getContractDetail` tests in that file do; only the repository stubs below differ.

```typescript
describe('getContractDetail downloadFileName', () => {
  const documents = [
    {
      id: 'doc-primary',
      documentKind: 'PRIMARY' as const,
      displayName: 'Contract',
      fileName: 'MSA_Acme.docx',
      fileSizeBytes: 1024,
      fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      createdAt: '2026-07-01T10:00:00.000Z',
    },
    {
      id: 'doc-executed',
      documentKind: 'EXECUTED_CONTRACT' as const,
      displayName: 'Executed Contract',
      fileName: 'executed-envelope-123.pdf',
      fileSizeBytes: 2048,
      fileMimeType: 'application/pdf',
      createdAt: '2026-07-20T10:00:00.000Z',
    },
    {
      id: 'doc-certificate',
      documentKind: 'AUDIT_CERTIFICATE' as const,
      displayName: 'Zoho Sign Completion Certificate',
      fileName: 'audit-certificate-envelope-123.pdf',
      fileSizeBytes: 512,
      fileMimeType: 'application/pdf',
      createdAt: '2026-07-20T10:00:00.000Z',
    },
  ]

  const allSigned = [
    { status: 'SIGNED', signedAt: '2026-07-19T10:00:00.000Z' },
    { status: 'SIGNED', signedAt: '2026-07-20T09:30:00.000Z' },
  ]

  const partiallySigned = [
    { status: 'SIGNED', signedAt: '2026-07-19T10:00:00.000Z' },
    { status: 'PENDING', signedAt: null },
  ]

  // Returns the decorated documents from getContractDetail, with the contract
  // titled 'MSA - Acme Corp' and the given signatory set.
  const loadDocuments = async (signatories: Array<{ status: string; signedAt: string | null }>) => {
    const service = buildServiceForDetail({
      contract: { id: 'contract-1', title: 'MSA - Acme Corp' },
      documents,
      signatories,
    })

    const view = await service.getContractDetail({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      employeeId: 'emp-1',
      role: 'LEGAL_TEAM',
    })

    return view.documents
  }

  it('gives signing artifacts a friendly download filename', async () => {
    const result = await loadDocuments(allSigned)

    expect(result.find((d) => d.id === 'doc-executed')?.downloadFileName).toBe(
      'MSA - Acme Corp - Signed - 20-07-2026.pdf'
    )
    expect(result.find((d) => d.id === 'doc-certificate')?.downloadFileName).toBe(
      'MSA - Acme Corp - Completion Certificate - 20-07-2026.pdf'
    )
  })

  it('leaves the storage fileName untouched', async () => {
    const result = await loadDocuments(allSigned)

    expect(result.find((d) => d.id === 'doc-executed')?.fileName).toBe('executed-envelope-123.pdf')
  })

  it('falls back to the uploaded filename for primary documents', async () => {
    const result = await loadDocuments(allSigned)

    expect(result.find((d) => d.id === 'doc-primary')?.downloadFileName).toBe('MSA_Acme.docx')
  })

  it('omits the date while signatures are still outstanding', async () => {
    const result = await loadDocuments(partiallySigned)

    expect(result.find((d) => d.id === 'doc-executed')?.downloadFileName).toBe(
      'MSA - Acme Corp - Signed.pdf'
    )
  })
})
```

Define `buildServiceForDetail` at the top of this `describe` block by copying the service construction already used by the neighbouring `getContractDetail` tests, parameterised so `getById` resolves the given `contract`, `getDocuments` resolves `documents`, and `getSignatories` resolves `signatories`. `canAccessContract` must resolve `true`. All other repository methods resolve `[]`.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- contract-query-service`
Expected: FAIL — `downloadFileName` is `undefined`.

- [ ] **Step 5: Populate it in `getContractDetail`**

In `src/core/domain/contracts/contract-query-service.ts`, add the import at the top of the file:

```typescript
import {
  resolveDocumentDownloadFileName,
  resolveExecutedAt,
} from '@/core/domain/contracts/signed-document-filename'
```

Replace the return block at lines 254-262 with:

```typescript
    const executedAt = resolveExecutedAt(signatories)
    const documentsWithDownloadNames = documents.map((document) => ({
      ...document,
      downloadFileName: resolveDocumentDownloadFileName({
        documentKind: document.documentKind,
        fileName: document.fileName,
        contractTitle: contract.title,
        executedAt,
      }),
    }))

    return {
      contract: contractWithAssignedUsers,
      counterparties,
      documents: documentsWithDownloadNames,
      availableActions,
      additionalApprovers,
      legalCollaborators,
      signatories,
    }
```

- [ ] **Step 6: Fix the fixtures listed in Step 2**

For each test fixture that constructs a `ContractDocument`, add `downloadFileName`. For fixtures representing primary or supporting documents, set it equal to the existing `fileName`. Known site: the `makeDoc` and `makeSupportingDoc` factories in `src/modules/contracts/ui/ContractDocumentsPanel.test.tsx:15` and `:27` — add `downloadFileName: 'contract-v1.docx'` and `downloadFileName: 'acme-supporting-v1.pdf'` respectively, above the `...overrides` spread so callers can still override.

- [ ] **Step 7: Run the tests and typecheck**

Run: `npm test -- contract-query-service && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Checkpoint**

Do not commit. Report the field addition and every fixture updated.

---

## Task 3: Render `downloadFileName` in the Documents panel

**Files:**
- Modify: `src/modules/contracts/ui/ContractDocumentsPanel.tsx:109`, `:192`, `:635`, `:763`
- Test: `src/modules/contracts/ui/ContractDocumentsPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/modules/contracts/ui/ContractDocumentsPanel.test.tsx`, using the `makeDoc` factory already defined at the top of that file:

```typescript
describe('ContractDocumentsPanel filenames', () => {
  const executedDoc = makeDoc({
    id: 'doc-executed',
    documentKind: 'EXECUTED_CONTRACT',
    displayName: 'Executed Contract',
    fileName: 'executed-envelope-123.pdf',
    downloadFileName: 'MSA - Acme Corp - Signed - 20-07-2026.pdf',
    fileMimeType: 'application/pdf',
  })

  const renderWithExecutedDoc = () =>
    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-1"
        documents={[makeDoc(), executedDoc]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

  it('renders the friendly filename for execution artifacts', () => {
    renderWithExecutedDoc()

    expect(screen.getByText('MSA - Acme Corp - Signed - 20-07-2026.pdf')).toBeInTheDocument()
  })

  it('never renders an internal storage filename', () => {
    const { container } = renderWithExecutedDoc()

    expect(container.textContent).not.toMatch(
      /executed-|audit-certificate-|completion-certificate-and-signed-/
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ContractDocumentsPanel`
Expected: FAIL — the internal name is rendered, so the friendly name is not found.

- [ ] **Step 3: Swap the rendered field at all four sites**

In `src/modules/contracts/ui/ContractDocumentsPanel.tsx`:

Line 109 (active version card — note this one reads `props.document`):
```tsx
        <span>{props.document.downloadFileName}</span>
```

Line 192 (version history row):
```tsx
                <div className={workspaceStyles.itemMeta}>{document.downloadFileName}</div>
```

Line 635 (execution artifacts row):
```tsx
                    <div className={workspaceStyles.itemMeta}>{document.downloadFileName}</div>
```

Line 763 (counterparty supporting row):
```tsx
                              <div className={workspaceStyles.itemMeta}>{document.downloadFileName}</div>
```

Only line 635 changes visible output today. The other three are no-op swaps that satisfy invariant 2 and keep the component consistent.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- ContractDocumentsPanel`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not commit. Report the four swaps.

---

## Task 4: Route execution artifacts to the final-artifact download handlers

**Files:**
- Create: `src/modules/contracts/ui/resolveDownloadStrategy.ts`
- Create: `src/modules/contracts/ui/resolveDownloadStrategy.test.ts`
- Modify: `src/modules/contracts/ui/ContractsWorkspace.tsx:806-825`

**Why:** the Download button in the Execution Artifacts list (`ContractDocumentsPanel.tsx:659`) currently calls the generic `/api/contracts/:id/download` route, which returns `document.fileName` — the internal name. Delegating to the endpoint already built for these artifacts keeps naming in one place (invariant 4).

- [ ] **Step 1: Write the failing test**

Create `src/modules/contracts/ui/resolveDownloadStrategy.test.ts`:

```typescript
import { resolveDownloadStrategy } from '@/modules/contracts/ui/resolveDownloadStrategy'

describe('resolveDownloadStrategy', () => {
  it('routes the executed contract to the final signed document endpoint', () => {
    expect(resolveDownloadStrategy('EXECUTED_CONTRACT')).toBe('final_signed_document')
  })

  it('routes the audit certificate to the completion certificate endpoint', () => {
    expect(resolveDownloadStrategy('AUDIT_CERTIFICATE')).toBe('final_completion_certificate')
  })

  it('routes primary documents to the generic endpoint', () => {
    expect(resolveDownloadStrategy('PRIMARY')).toBe('generic')
  })

  it('routes counterparty supporting documents to the generic endpoint', () => {
    expect(resolveDownloadStrategy('COUNTERPARTY_SUPPORTING')).toBe('generic')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- resolveDownloadStrategy`
Expected: FAIL — `Cannot find module '@/modules/contracts/ui/resolveDownloadStrategy'`

- [ ] **Step 3: Write the implementation**

Create `src/modules/contracts/ui/resolveDownloadStrategy.ts`:

```typescript
import type { ContractDocumentKind } from '@/core/domain/contracts/signed-document-filename'

export type DownloadStrategy = 'final_signed_document' | 'final_completion_certificate' | 'generic'

/**
 * Signing artifacts are served by the final-artifact endpoint, which applies
 * the friendly filename. Everything else uses the generic download route,
 * where the stored filename is already the uploader's own.
 */
export function resolveDownloadStrategy(documentKind: ContractDocumentKind): DownloadStrategy {
  if (documentKind === 'EXECUTED_CONTRACT') {
    return 'final_signed_document'
  }

  if (documentKind === 'AUDIT_CERTIFICATE') {
    return 'final_completion_certificate'
  }

  return 'generic'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- resolveDownloadStrategy`
Expected: PASS.

- [ ] **Step 5: Wire it into `handleDownload`**

In `src/modules/contracts/ui/ContractsWorkspace.tsx`, add the import:

```typescript
import { resolveDownloadStrategy } from '@/modules/contracts/ui/resolveDownloadStrategy'
```

`handleDownload` begins at line 806 and receives the document. Add these as the first statements of the callback body, before the existing `contractsClient.download(...)` call:

```typescript
      const strategy = resolveDownloadStrategy(document.documentKind)

      if (strategy === 'final_signed_document') {
        await handleDownloadFinalSignedDocument()
        return
      }

      if (strategy === 'final_completion_certificate') {
        await handleDownloadCompletionCertificate()
        return
      }
```

**Ordering and dependency hazard — read carefully.** `handleDownloadFinalSignedDocument` (line 844) and `handleDownloadCompletionCertificate` (line 880) are plain `const` arrow functions declared *after* `handleDownload`, which is a `useCallback`. Two problems follow, and fixing only the first introduces a stale-closure bug:

1. **Ordering.** Being `const`, referencing them from an earlier position throws `Cannot access before initialization` at call time. Both declarations must move above `handleDownload`.

2. **Dependencies.** They are recreated on every render, so adding them to `handleDownload`'s dependency array as-is would recreate `handleDownload` on every render too — defeating its memoisation. Omitting them instead leaves `handleDownload` closing over the *first* render's copies, which read stale state.

Fix both together: wrap each handler in its own `useCallback` with the state it actually reads (`selectedContractId` and the relevant `isDownloading*` flags and setters), move them above `handleDownload`, then add both to `handleDownload`'s dependency array. Now they are stable references and the memoisation holds.

There is no `merged_pdf` document kind — the combined PDF is generated on demand and never stored as a document row — so it needs no branch.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Do not commit. Report the new module, the dispatch, and the function reordering.

---

## Task 5: Thread `downloadFileName` through the signed-URL layer

**Files:**
- Modify: `src/core/domain/contracts/contract-storage-repository.ts:4`
- Modify: `src/core/infra/repositories/supabase-contract-storage-repository.ts:33-45`
- Modify: `src/core/domain/contracts/contract-upload-service.ts:27-32`, `:1101-1181`
- Modify: `src/core/domain/contracts/contract-signatory-service.ts:27-32`

**Why:** two of the three download paths return a Supabase signed URL that the client opens in a new tab (`ContractsWorkspace.tsx:862`, `:898`, `:934`). The browser takes the filename from `Content-Disposition`, which for a bare signed URL reflects the storage key. Supabase's `{ download }` option overrides it.

- [ ] **Step 1: Widen the storage repository interface**

Replace `src/core/domain/contracts/contract-storage-repository.ts`:

```typescript
export interface ContractStorageRepository {
  upload(params: { path: string; fileBody: Blob | Uint8Array; contentType: string }): Promise<void>
  remove(path: string): Promise<void>
  createSignedDownloadUrl(
    path: string,
    expiresInSeconds: number,
    downloadFileName?: string
  ): Promise<string>
  createSignedUploadUrl(path: string): Promise<{ path: string; token: string; signedUrl: string }>
  exists(path: string): Promise<boolean>
}
```

- [ ] **Step 2: Forward it in the Supabase implementation**

Replace lines 33-45 of `src/core/infra/repositories/supabase-contract-storage-repository.ts`:

```typescript
  async createSignedDownloadUrl(
    path: string,
    expiresInSeconds: number,
    downloadFileName?: string
  ): Promise<string> {
    const supabase = createServiceSupabase()

    const { data, error } = await supabase.storage
      .from(contractStorage.privateBucketName)
      .createSignedUrl(
        path,
        expiresInSeconds,
        downloadFileName ? { download: downloadFileName } : undefined
      )

    if (error || !data?.signedUrl) {
      throw new ExternalServiceError('supabase-storage', error?.message ?? 'Failed to create signed download URL')
    }

    return data.signedUrl
  }
```

- [ ] **Step 3: Accept and forward the option in the upload service**

In `src/core/domain/contracts/contract-upload-service.ts`, add `downloadFileName?: string` to the params of `createSignedDownloadUrl` at line 1101:

```typescript
  async createSignedDownloadUrl(params: {
    contractId: string
    tenantId: string
    requestorEmployeeId: string
    requestorRole: string
    documentId?: string
    downloadFileName?: string
  }): Promise<{ signedUrl: string; fileName: string }> {
```

Pass it at both storage call sites — line 1147 (explicit `documentId` branch) and line 1172 (active-document branch):

```typescript
      const signedUrl = await this.contractStorageRepository.createSignedDownloadUrl(
        document.filePath,
        contractStorage.signedUrlExpirySeconds,
        params.downloadFileName
      )
```

```typescript
    const signedUrl = await this.contractStorageRepository.createSignedDownloadUrl(
      activeDocument.filePath,
      contractStorage.signedUrlExpirySeconds,
      params.downloadFileName
    )
```

- [ ] **Step 4: Mirror the optional param on the consuming interface**

`contract-signatory-service.ts` declares its own structural type for this collaborator at lines 27-32. Add the field there too, or Task 6 will not typecheck:

```typescript
    documentId?: string
    downloadFileName?: string
  }): Promise<{ signedUrl: string; fileName: string }>
```

The parameter is optional throughout. The generic download route continues to call the method without it, so its behaviour is unchanged.

- [ ] **Step 5: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. If a test double implements `ContractStorageRepository`, widen its signature to match.

- [ ] **Step 6: Checkpoint**

Do not commit. Report the four signature changes.

---

## Task 6: Use the friendly name on every artifact download path

**Files:**
- Modify: `src/core/domain/contracts/contract-signatory-service.ts:663`, `:666`, `:710`, `:731`, `:833`, `:863-1035`
- Modify: `src/core/domain/contracts/contract-signatory-service.test.ts:98` (existing assertion breaks)
- Test: `src/core/domain/contracts/contract-signatory-service.test.ts`

**Depends on:** Task 1 (builder) and Task 5 (the `downloadFileName` param).

- [ ] **Step 1: Update the existing merged-artifact assertion**

`src/core/domain/contracts/contract-signatory-service.test.ts:98` currently asserts the old internal name and **will fail** after this task:

```typescript
    expect(result.fileName).toBe('completion-certificate-and-signed-env-merged-1.pdf')
```

That test's `mockContractView` has `title: 'Master Service Agreement'` and `signatories: [{ zohoSignEnvelopeId: 'env-merged-1' }]` — no `status` or `signedAt`, so `resolveExecutedAt` returns `null` and the date segment is omitted. Change it to:

```typescript
    expect(result.fileName).toBe('Master Service Agreement - Signed with Certificate.pdf')
```

- [ ] **Step 2: Write the failing tests**

Append to `src/core/domain/contracts/contract-signatory-service.test.ts`. This follows the exact construction used by the existing test at line 63.

```typescript
describe('downloadFinalSigningArtifact naming', () => {
  const signedSignatories = [
    {
      zohoSignEnvelopeId: 'env-1',
      status: 'SIGNED',
      signedAt: '2026-07-19T10:00:00.000Z',
    },
    {
      zohoSignEnvelopeId: 'env-1',
      status: 'SIGNED',
      signedAt: '2026-07-20T09:30:00.000Z',
    },
  ]

  const executedDocument = {
    id: 'doc-executed',
    documentKind: 'EXECUTED_CONTRACT',
    fileName: 'executed-env-1.pdf',
    downloadFileName: 'MSA - Acme Corp - Signed - 20-07-2026.pdf',
    createdAt: '2026-07-20T10:00:00.000Z',
  }

  const buildService = (overrides: {
    documents?: unknown[]
    createSignedDownloadUrl?: jest.Mock
  }) => {
    const contractQueryService = {
      getContractDetail: jest.fn().mockResolvedValue({
        contract: { id: 'contract-1', title: 'MSA - Acme Corp', status: 'COMPLETED' },
        documents: overrides.documents ?? [],
        availableActions: [],
        additionalApprovers: [],
        signatories: signedSignatories,
      }),
    }

    const contractDocumentDownloadService = {
      createSignedDownloadUrl:
        overrides.createSignedDownloadUrl ??
        jest.fn().mockResolvedValue({
          signedUrl: 'https://storage.example.com/signed',
          fileName: 'executed-env-1.pdf',
        }),
    }

    const contractStorageRepository = { upload: jest.fn() }
    const contractRepository = { createDocument: jest.fn() }

    const signatureProvider = {
      createSigningEnvelope: jest.fn(),
      downloadEnvelopePdf: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      downloadCompletionCertificate: jest.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      contractDocumentDownloadService as never,
      contractRepository as never,
      contractStorageRepository as never,
      signatureProvider as never,
      { sendTemplateEmail: jest.fn() },
      { signatoryLinkTemplateId: 101, signingCompletedTemplateId: 102 },
      'https://app.example.com',
      createLogger()
    )

    return { service, contractDocumentDownloadService, contractStorageRepository }
  }

  it('returns the friendly filename when served from storage', async () => {
    const { service } = buildService({ documents: [executedDocument] })

    const result = await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'signed_document',
    })

    expect(result.fileName).toBe('MSA - Acme Corp - Signed - 20-07-2026.pdf')
  })

  it('passes the friendly filename to the signed URL so Content-Disposition carries it', async () => {
    const { service, contractDocumentDownloadService } = buildService({
      documents: [executedDocument],
    })

    await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'signed_document',
    })

    expect(contractDocumentDownloadService.createSignedDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadFileName: 'MSA - Acme Corp - Signed - 20-07-2026.pdf',
      })
    )
  })

  it('returns the friendly filename when falling back to Zoho', async () => {
    const { service } = buildService({ documents: [] })

    const result = await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'signed_document',
    })

    expect(result.fileName).toBe('MSA - Acme Corp - Signed - 20-07-2026.pdf')
  })

  it('still stores the artifact under its internal path', async () => {
    const { service, contractStorageRepository } = buildService({ documents: [] })

    await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'signed_document',
    })

    expect(contractStorageRepository.upload).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/executed/') })
    )
  })

  it('names the completion certificate with its own suffix', async () => {
    const { service } = buildService({ documents: [] })

    const result = await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'completion_certificate',
    })

    expect(result.fileName).toBe('MSA - Acme Corp - Completion Certificate - 20-07-2026.pdf')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- contract-signatory-service`
Expected: FAIL — returns `executed-env-1.pdf`, and `downloadFileName` is not passed to the signed URL.

- [ ] **Step 4: Compute the name once, after the contract view loads**

In `src/core/domain/contracts/contract-signatory-service.ts`, add the import:

```typescript
import {
  buildSignedArtifactFileName,
  resolveExecutedAt,
} from '@/core/domain/contracts/signed-document-filename'
```

Immediately after the `envelopeId` guard (line 663) and before the `merged_pdf` branch:

```typescript
    const downloadFileName = buildSignedArtifactFileName({
      title: contractView.contract.title,
      artifact: params.artifact,
      executedAt: resolveExecutedAt(contractView.signatories),
    })
```

- [ ] **Step 5: Pass it into the merged branch**

Change the `merged_pdf` call at line 666:

```typescript
    if (params.artifact === 'merged_pdf') {
      return this.downloadMergedSigningArtifact({
        tenantId: params.tenantId,
        contractId: params.contractId,
        actorEmployeeId: params.actorEmployeeId,
        actorRole: params.actorRole,
        envelopeId,
        contractView,
        downloadFileName,
        elapsedMs,
      })
    }
```

Add `downloadFileName: string` to the `downloadMergedSigningArtifact` params type at line 863, then replace `fileName: mergedFileName` with `fileName: params.downloadFileName` at each of its three return points — lines 900, 972, and 1028.

Leave the `mergedFileName` constant itself in place: it still builds `mergedFilePath` and must keep its internal form (invariant 3).

- [ ] **Step 6: Use it on the storage-hit path**

Pass it to the signed-URL call (line 710) and return it (line 731):

```typescript
        const localDownload = await this.contractDocumentDownloadService.createSignedDownloadUrl({
          contractId: params.contractId,
          tenantId: params.tenantId,
          requestorEmployeeId: params.actorEmployeeId,
          requestorRole: params.actorRole,
          documentId: localDocument.id,
          downloadFileName,
        })
```

```typescript
        return {
          fileName: downloadFileName,
          contentType: 'application/pdf',
          signedUrl: localDownload.signedUrl,
        }
```

- [ ] **Step 7: Use it on the Zoho-fallback path**

Replace the return at line 833:

```typescript
      return {
        fileName: downloadFileName,
        contentType: 'application/pdf',
        fileBytes,
      }
```

Leave `targetFileName` (line 682) and `targetFilePath` (line 685) untouched — they are the storage key and the persisted `file_name`, which invariant 3 freezes.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- contract-signatory-service`
Expected: PASS, including the updated assertion from Step 1.

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Checkpoint**

Do not commit. Report which return paths changed and confirm storage paths did not.

---

## Task 7: Auto-open the contract after upload for LEGAL_TEAM

**Files:**
- Create: `src/modules/contracts/ui/third-party-upload/resolvePostUploadDestination.ts`
- Create: `src/modules/contracts/ui/third-party-upload/resolvePostUploadDestination.test.ts`
- Modify: `src/modules/contracts/ui/third-party-upload/ThirdPartyUploadSidebar.tsx:435-438`

Independent of Tasks 1-6; can be done in any order relative to them.

The destination decision is extracted into a pure function rather than tested by driving the four-step upload wizard through RTL. This matches the existing `composeContractTitle.ts` / `composeContractTitle.test.ts` pair already in this folder, and keeps the test fast and non-brittle.

- [ ] **Step 1: Write the failing test**

Create `src/modules/contracts/ui/third-party-upload/resolvePostUploadDestination.test.ts`:

```typescript
import { resolvePostUploadDestination } from '@/modules/contracts/ui/third-party-upload/resolvePostUploadDestination'

describe('resolvePostUploadDestination', () => {
  it('opens the new contract for a legal team member', () => {
    const result = resolvePostUploadDestination({ actorRole: 'LEGAL_TEAM', contractId: 'contract-42' })

    expect(result).toBe('/contracts/contract-42')
  })

  it('sends a regular user to the dashboard', () => {
    const result = resolvePostUploadDestination({ actorRole: 'USER', contractId: 'contract-42' })

    expect(result).toBe('/dashboard')
  })

  it('sends an admin to the dashboard', () => {
    const result = resolvePostUploadDestination({ actorRole: 'ADMIN', contractId: 'contract-42' })

    expect(result).toBe('/dashboard')
  })

  it('sends an HOD to the dashboard', () => {
    const result = resolvePostUploadDestination({ actorRole: 'HOD', contractId: 'contract-42' })

    expect(result).toBe('/dashboard')
  })

  it('sends an unknown role to the dashboard', () => {
    const result = resolvePostUploadDestination({ actorRole: undefined, contractId: 'contract-42' })

    expect(result).toBe('/dashboard')
  })
})
```

The ADMIN case is the point of this task: `ADMIN` must **not** auto-open, which is why the existing `isLegalActor` flag at `ThirdPartyUploadSidebar.tsx:106` cannot be reused — it matches ADMIN too.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- resolvePostUploadDestination`
Expected: FAIL — `Cannot find module '.../resolvePostUploadDestination'`

- [ ] **Step 3: Write the implementation**

Create `src/modules/contracts/ui/third-party-upload/resolvePostUploadDestination.ts`:

```typescript
import { contractWorkflowRoles } from '@/core/constants/contracts'

/**
 * Legal team members are taken straight to the contract they just uploaded.
 * Everyone else returns to the dashboard, as before.
 *
 * Deliberately narrower than the `isLegalActor` check in the sidebar, which
 * also matches ADMIN.
 */
export function resolvePostUploadDestination(params: {
  actorRole?: string
  contractId: string
}): string {
  return params.actorRole === contractWorkflowRoles.legalTeam
    ? `/contracts/${params.contractId}`
    : '/dashboard'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- resolvePostUploadDestination`
Expected: PASS.

- [ ] **Step 5: Wire it into the sidebar**

In `src/modules/contracts/ui/third-party-upload/ThirdPartyUploadSidebar.tsx`, add the import:

```typescript
import { resolvePostUploadDestination } from './resolvePostUploadDestination'
```

Replace lines 435-438:

```typescript
      onClose()
      resetAll()
      router.push(
        resolvePostUploadDestination({
          actorRole,
          contractId: response.data.contract.id,
        })
      )
      router.refresh()
```

Leave the `await onUploaded()` above it in place — several call sites also call `router.refresh()`, and skipping it risks a stale list on back-navigation.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Do not commit. Report the new module and the navigation change.

---

## Task 8: Full verification

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS, no skipped suites.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new warnings in the touched files.

- [ ] **Step 4: Confirm no internal filename can reach the UI**

Search the UI layer for renders of the internal field:

Run: `npx rg -n "\.fileName" src/modules/`

Expected: no match renders `.fileName` into JSX. Matches in non-rendering positions — building an upload payload, passing a value to the API client — are fine; confirm each one individually.

- [ ] **Step 5: Manual verification against a real executed contract**

1. Open a contract that has completed signing.
2. The Execution Artifacts list shows `<Title> - Signed - <DD-MM-YYYY>.pdf`, not `executed-<id>.pdf`.
3. Click **Download** in that list — the saved file carries the friendly name.
4. Click **Download Signed Document**, **Download Completion Certificate**, and **Download Combined PDF** — all three save with friendly names and the correct suffix.
5. The date matches the date the last signatory signed, read in IST.
6. Open a contract still awaiting signatures — artifact names show no date rather than `Invalid Date`.
7. As a LEGAL_TEAM user, upload a document — you land on the contract detail page.
8. As a non-legal user, upload a document — you land on the dashboard.

- [ ] **Step 6: Final checkpoint**

Do not commit. Summarise every file changed and hand back to the user for commit.
