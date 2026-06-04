# Supporting-Document Upload & Signed-Doc Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized users add (append) supporting documents per section (Budget Approval, Additional, per-counterparty) after a contract is raised — where a Budget upload also flips the contract's `budget_approved` flag to Yes — and let POC/HOD view & download signed/executed documents.

**Architecture:** Reuse the existing two-phase signed-upload pattern (`init` route returns a signed storage URL → client PUTs the file → `finalize` route persists metadata, both idempotent via `Idempotency-Key`). The new "add supporting document" path mirrors the existing `replace-supporting-document` path but sets **no** `replaced_document_id` (append-only / new list item), takes a **section descriptor** instead of a `sourceDocumentId`, applies a relaxed permission set (creator + HOD-in-team + Legal/Admin, pre-completion statuses), logs each upload to `audit_logs`, and — for the Budget section only — flips `contracts.budget_approved` to `true` (logging the flip when it actually changes). Feature B relaxes the hard Legal/Admin gate on `downloadFinalSigningArtifact` and relies on the existing contract read-access check that already encodes department/ownership scoping.

**Tech Stack:** Next.js (App Router) + TypeScript + React, Supabase (Postgres), Jest, CSS modules. Clean/hexagonal layers: `core/domain` (services), `core/infra/repositories` (Supabase impl), `app/api` (routes), `core/client` (browser client), `modules/contracts/ui` (React).

**Source of truth for decisions:** `docs/superpowers/specs/2026-05-29-supporting-doc-upload-and-signed-doc-access-design.md` (Goals + Decisions sections, revised 2026-06-01).

**Hard constraints:**
- The **main contract document** Active Version / Replace flow is **untouched**.
- The existing per-item supporting **Replace** flow is **untouched**.
- The repo owner commits manually — **do NOT run `git add` / `git commit`**. Where steps below show a commit, **stop and tell the user the task is ready to commit** instead of committing.

---

## File Structure

**Modify:**
- `src/core/constants/contracts.ts` — add PNG/JPG mime types + a supporting-upload allow-list constant.
- `src/core/domain/contracts/types.ts` — add `AddSupportingDocumentInput`, `SetBudgetApprovedInput`, `SupportingDocumentSectionCategory`.
- `src/core/domain/contracts/contract-repository.ts` — extend the `ContractRepository` interface with `addSupportingDocument` + `setBudgetApproved`.
- `src/core/infra/repositories/supabase-contract-repository.ts` — implement both new repo methods.
- `src/core/domain/contracts/contract-upload-service.ts` — file-type validator, permission helper, allowed-status set, `initiateAddSupportingDocument`, `finalizeAddSupportingDocument`.
- `src/core/domain/contracts/contract-signatory-service.ts` — relax `downloadFinalSigningArtifact` role gate.
- `src/core/client/contracts-client.ts` — add `addSupportingDocument`.
- `src/core/config/route-registry.ts` — add `addSupportingDocumentInit` / `addSupportingDocumentFinalize`.
- `src/modules/contracts/ui/formatContractLogEvent.ts` — add `SUPPORTING_DOCUMENT_ADDED` + `BUDGET_APPROVED_SET` canonical types/messages.
- `src/modules/contracts/ui/ContractsWorkspace.tsx` — widen `canViewSignedDocsTab`; pass `counterparties` to the documents panel.
- `src/modules/contracts/ui/ContractDocumentsPanel.tsx` — always render the three section types; add Upload buttons + Upload modal.

**Create:**
- `src/app/api/contracts/[contractId]/supporting-document/init/route.ts`
- `src/app/api/contracts/[contractId]/supporting-document/finalize/route.ts`

**Test files (modify/extend):**
- `src/core/domain/contracts/contract-upload-service.test.ts`
- `src/modules/contracts/ui/formatContractLogEvent.test.ts`
- `src/modules/contracts/ui/ContractDocumentsPanel.test.tsx`
- Signatory-service test (locate the existing one for `downloadFinalSigningArtifact`).

**Conventions to follow (verified in this codebase):**
- Test runner: `npx jest <path>` (Jest). Type-check: `npx tsc --noEmit`. Lint: `npm run lint`.
- Repo methods get a client via `const supabase = createServiceSupabase()` and throw `DatabaseError('msg', new Error(error.message), { code: error.code })` on failure.
- Audit rows are inserted into `audit_logs` with columns `tenant_id, user_id, event_type, action, actor_email, actor_role, resource_type, resource_id, metadata` (see `replaceSupportingDocument` at `supabase-contract-repository.ts:728`).
- Section grouping in the UI keys off `counterpartyId` (counterparty section) or `displayName` starting with `"additional"` (Additional section) else the Budget section — see `ContractDocumentsPanel.tsx:285-312`. New uploads must set `displayName` / `counterpartyId` to land in the right group.

---

## Task 1: Constants — PNG/JPG mime types + supporting-upload allow-list

**Files:**
- Modify: `src/core/constants/contracts.ts:119-140`

- [ ] **Step 1: Add PNG/JPG mime types and a supporting-upload allow-list**

In `src/core/constants/contracts.ts`, replace the `contractDocumentMimeTypes` block (currently lines 119-123) with:

```ts
export const contractDocumentMimeTypes = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
} as const
```

Then, immediately after the `contractDocumentUploadRules` block (currently ends line 140), add:

```ts
export const contractSupportingUploadAllowedExtensions = ['.doc', '.docx', '.pdf', '.png', '.jpg', '.jpeg'] as const

export const contractSupportingUploadAllowedMimeTypes = [
  contractDocumentMimeTypes.doc,
  contractDocumentMimeTypes.docx,
  contractDocumentMimeTypes.pdf,
  contractDocumentMimeTypes.png,
  contractDocumentMimeTypes.jpeg,
] as const
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors introduced by the constant additions).

- [ ] **Step 3: Commit**

```bash
git add src/core/constants/contracts.ts
git commit -m "feat(contracts): add image mime types and supporting-upload allow-list"
```
(Per repo policy: do NOT run this — report the task as ready to commit.)

---

## Task 2: Domain types + repository interface

**Files:**
- Modify: `src/core/domain/contracts/types.ts:117` (after `CreateContractDocumentInput`)
- Modify: `src/core/domain/contracts/contract-repository.ts:62-63` (inside the `ContractRepository` interface)

- [ ] **Step 1: Add the section-category type and repo input types**

In `src/core/domain/contracts/types.ts`, directly after the `CreateContractDocumentInput` type (ends line 117), add:

```ts
export type SupportingDocumentSectionCategory = 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY'

export type AddSupportingDocumentInput = {
  tenantId: string
  contractId: string
  sectionCategory: SupportingDocumentSectionCategory
  counterpartyId?: string | null
  counterpartyName?: string | null
  displayName: string
  fileName: string
  filePath: string
  fileSizeBytes: number
  fileMimeType: string
  uploadedByEmployeeId: string
  uploadedByEmail: string
  uploadedByRole: string
}

export type SetBudgetApprovedInput = {
  tenantId: string
  contractId: string
  actorEmployeeId: string
  actorEmail: string
  actorRole: string
}
```

- [ ] **Step 2: Extend the `ContractRepository` interface**

In `src/core/domain/contracts/contract-repository.ts`, add the two new imports to the existing type import block (lines 1-12):

```ts
import type {
  AddSupportingDocumentInput,
  ContractAccessRecord,
  ContractCounterpartyRecord,
  ContractDocumentAccessRecord,
  ContractDocumentRecord,
  ContractRecord,
  CreateContractCounterpartyInput,
  CreateContractDocumentInput,
  CreateContractUploadInput,
  ReplacePrimaryContractDocumentInput,
  SetBudgetApprovedInput,
  UpdateContractStatusInput,
} from '@/core/domain/contracts/types'
```

Then, immediately after the `replaceSupportingDocument(...)` method declaration (ends line 62, just before `updateContractStatus`), add:

```ts
  addSupportingDocument(input: AddSupportingDocumentInput): Promise<void>
  setBudgetApproved(input: SetBudgetApprovedInput): Promise<{ changed: boolean }>
```

- [ ] **Step 3: Type-check (expected to FAIL until Task 3)**

Run: `npx tsc --noEmit`
Expected: FAIL — the Supabase repo class no longer satisfies `ContractRepository` (missing `addSupportingDocument` / `setBudgetApproved`). This confirms the interface is wired; Task 3 implements the methods.

- [ ] **Step 4: Do NOT commit yet** — commit together with Task 3 (interface + impl land as one compilable unit).

---

## Task 3: Supabase repository — `addSupportingDocument` + `setBudgetApproved`

**Files:**
- Modify: `src/core/infra/repositories/supabase-contract-repository.ts` (add imports; add two methods after `replaceSupportingDocument`, which ends line 756)
- Test: `src/core/infra/repositories/supabase-contract-repository.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/extend `src/core/infra/repositories/supabase-contract-repository.test.ts`. This codebase mocks `createServiceSupabase`; follow the pattern already used by other repo tests (search the repo for `jest.mock('@/core/infra/supabase` or `createServiceSupabase` in existing `*.test.ts` to copy the exact mock shape). The test must assert:

```ts
import { SupabaseContractRepository } from '@/core/infra/repositories/supabase-contract-repository'

// Build a chainable supabase mock where:
//  - from('contract_documents').insert(...).select('id').single() resolves { data: { id: 'doc-1' }, error: null }
//  - from('audit_logs').insert(...) resolves { error: null }
//  - from('contracts').update(...).eq(...).eq(...).eq(...).is(...).select('id') resolves { data: [{ id: 'c-1' }], error: null }
// (capture the insert/update payloads for assertions)

describe('SupabaseContractRepository.addSupportingDocument', () => {
  it('inserts a COUNTERPARTY_SUPPORTING row with no replaced_document_id and writes an added audit log', async () => {
    const repo = new SupabaseContractRepository()
    await repo.addSupportingDocument({
      tenantId: 't1',
      contractId: 'c-1',
      sectionCategory: 'COUNTERPARTY',
      counterpartyId: 'cp-1',
      counterpartyName: 'Acme Corp',
      displayName: 'Counterparty Document',
      fileName: 'nda.pdf',
      filePath: 't1/c-1/counterparty-additions/x-nda.pdf',
      fileSizeBytes: 1234,
      fileMimeType: 'application/pdf',
      uploadedByEmployeeId: 'emp-1',
      uploadedByEmail: 'poc@x.co',
      uploadedByRole: 'POC',
    })

    expect(capturedDocumentInsert).toMatchObject({
      tenant_id: 't1',
      contract_id: 'c-1',
      document_kind: 'COUNTERPARTY_SUPPORTING',
      counterparty_id: 'cp-1',
      display_name: 'Counterparty Document',
      replaced_document_id: null,
    })
    expect(capturedAuditInsert[0]).toMatchObject({
      action: 'contract.supporting_document.added',
      event_type: 'CONTRACT_SUPPORTING_DOCUMENT_ADDED',
      resource_id: 'c-1',
      metadata: expect.objectContaining({
        document_id: 'doc-1',
        section_category: 'COUNTERPARTY',
        counterparty_name: 'Acme Corp',
        file_name: 'nda.pdf',
      }),
    })
  })
})

describe('SupabaseContractRepository.setBudgetApproved', () => {
  it('flips budget_approved and logs when a row changes', async () => {
    // update(...).eq('budget_approved', false) returns data:[{id:'c-1'}]
    const repo = new SupabaseContractRepository()
    const result = await repo.setBudgetApproved({
      tenantId: 't1',
      contractId: 'c-1',
      actorEmployeeId: 'emp-1',
      actorEmail: 'poc@x.co',
      actorRole: 'POC',
    })
    expect(result.changed).toBe(true)
    expect(capturedAuditInsert[0]).toMatchObject({ action: 'contract.budget_approved.set' })
  })

  it('does not log when budget_approved was already true', async () => {
    // update(...).eq('budget_approved', false) returns data:[]
    const repo = new SupabaseContractRepository()
    const result = await repo.setBudgetApproved({
      tenantId: 't1', contractId: 'c-1', actorEmployeeId: 'emp-1', actorEmail: 'poc@x.co', actorRole: 'POC',
    })
    expect(result.changed).toBe(false)
    expect(auditInsertCallCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/infra/repositories/supabase-contract-repository.test.ts`
Expected: FAIL — `repo.addSupportingDocument is not a function` (and `setBudgetApproved`).

- [ ] **Step 3: Implement the two repository methods**

In `src/core/infra/repositories/supabase-contract-repository.ts`, ensure `AddSupportingDocumentInput` and `SetBudgetApprovedInput` are imported from `@/core/domain/contracts/types` (add to the existing type-import block). Then insert these two methods immediately after `replaceSupportingDocument` (after the closing brace on line 756, before `updateContractStatus`):

```ts
  async addSupportingDocument(input: AddSupportingDocumentInput): Promise<void> {
    const supabase = createServiceSupabase()

    const { data: insertedDocument, error: insertError } = await supabase
      .from('contract_documents')
      .insert({
        tenant_id: input.tenantId,
        contract_id: input.contractId,
        document_kind: 'COUNTERPARTY_SUPPORTING',
        counterparty_id: input.counterpartyId ?? null,
        display_name: input.displayName,
        file_name: input.fileName,
        file_path: input.filePath,
        file_size_bytes: input.fileSizeBytes,
        file_mime_type: input.fileMimeType,
        uploaded_by_employee_id: input.uploadedByEmployeeId,
        uploaded_by_email: input.uploadedByEmail,
        uploaded_role: input.uploadedByRole,
        replaced_document_id: null,
      })
      .select('id')
      .single<{ id: string }>()

    if (insertError) {
      throw new DatabaseError('Failed to add supporting contract document', new Error(insertError.message), {
        code: insertError.code,
        details: insertError.details,
      })
    }

    const { error: auditError } = await supabase.from('audit_logs').insert([
      {
        tenant_id: input.tenantId,
        user_id: input.uploadedByEmployeeId,
        event_type: 'CONTRACT_SUPPORTING_DOCUMENT_ADDED',
        action: 'contract.supporting_document.added',
        actor_email: input.uploadedByEmail,
        actor_role: input.uploadedByRole,
        resource_type: 'contract',
        resource_id: input.contractId,
        metadata: {
          document_id: insertedDocument?.id ?? null,
          section_category: input.sectionCategory,
          counterparty_name: input.counterpartyName ?? null,
          file_name: input.fileName,
          file_mime_type: input.fileMimeType,
          file_size_bytes: input.fileSizeBytes,
        },
      },
    ])

    if (auditError) {
      throw new DatabaseError('Failed to write supporting document added audit event', new Error(auditError.message), {
        code: auditError.code,
      })
    }
  }

  async setBudgetApproved(input: SetBudgetApprovedInput): Promise<{ changed: boolean }> {
    const supabase = createServiceSupabase()

    const { data, error } = await supabase
      .from('contracts')
      .update({ budget_approved: true, updated_at: new Date().toISOString() })
      .eq('tenant_id', input.tenantId)
      .eq('id', input.contractId)
      .eq('budget_approved', false)
      .is('deleted_at', null)
      .select('id')

    if (error) {
      throw new DatabaseError('Failed to update budget approved flag', new Error(error.message), {
        code: error.code,
        details: error.details,
      })
    }

    const changed = Array.isArray(data) && data.length > 0
    if (!changed) {
      return { changed: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert([
      {
        tenant_id: input.tenantId,
        user_id: input.actorEmployeeId,
        event_type: 'CONTRACT_BUDGET_APPROVED_SET',
        action: 'contract.budget_approved.set',
        actor_email: input.actorEmail,
        actor_role: input.actorRole,
        resource_type: 'contract',
        resource_id: input.contractId,
        metadata: { source: 'supporting_document_upload' },
      },
    ])

    if (auditError) {
      throw new DatabaseError('Failed to write budget approved audit event', new Error(auditError.message), {
        code: auditError.code,
      })
    }

    return { changed: true }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/core/infra/repositories/supabase-contract-repository.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — the repo class now satisfies `ContractRepository`.

- [ ] **Step 6: Commit (Tasks 2 + 3 together)**

```bash
git add src/core/domain/contracts/types.ts src/core/domain/contracts/contract-repository.ts src/core/infra/repositories/supabase-contract-repository.ts src/core/infra/repositories/supabase-contract-repository.test.ts
git commit -m "feat(contracts): repo addSupportingDocument + setBudgetApproved with audit logs"
```
(Do NOT run — report ready to commit.)

---

## Task 4: Upload service — validation, permissions, initiate + finalize

**Files:**
- Modify: `src/core/domain/contracts/contract-upload-service.ts`
- Test: `src/core/domain/contracts/contract-upload-service.test.ts`

Context: the service constructor already holds `contractRepository`, `contractStorageRepository`, `logger`. It already has `sanitizeFileName`, `legalReplacementStatuses`, `adminOnlyReplacementStatuses`, `privilegedReadRoles`, and `assertAdditionalApproverCanReplace`. Mirror `initiateReplaceSupportingDocument` / `finalizeReplaceSupportingDocument` (lines 743-830).

- [ ] **Step 1: Write the failing tests**

In `src/core/domain/contracts/contract-upload-service.test.ts`, add a describe block (reuse the file's existing service-construction harness/mocks — copy how it builds the service + `contractRepository` mock for the replace tests):

```ts
describe('ContractUploadService.finalizeAddSupportingDocument', () => {
  it('persists a budget supporting doc and flips budget_approved', async () => {
    // contractRepository.getForAccess -> { status: 'HOD_PENDING', uploadedByEmployeeId: 'emp-1', ... }
    // contractStorageRepository.exists -> true
    // contractRepository.addSupportingDocument -> resolves
    // contractRepository.setBudgetApproved -> { changed: true }
    await service.finalizeAddSupportingDocument({
      tenantId: 't1',
      contractId: 'c-1',
      sectionCategory: 'BUDGET',
      fileName: 'budget.pdf',
      fileSizeBytes: 10,
      fileMimeType: 'application/pdf',
      uploadedByEmployeeId: 'emp-1',
      uploadedByEmail: 'poc@x.co',
      uploadedByRole: 'POC',
      path: 't1/c-1/counterparty-additions/x-budget.pdf',
    })
    expect(contractRepository.addSupportingDocument).toHaveBeenCalledWith(
      expect.objectContaining({ sectionCategory: 'BUDGET', displayName: 'Budget Approval Supporting Document', counterpartyId: null })
    )
    expect(contractRepository.setBudgetApproved).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: 'c-1', actorEmployeeId: 'emp-1' })
    )
    expect(contractRepository.updateContractStatus).not.toHaveBeenCalled()
  })

  it('does NOT flip budget_approved for non-budget sections', async () => {
    await service.finalizeAddSupportingDocument({
      tenantId: 't1', contractId: 'c-1', sectionCategory: 'ADDITIONAL',
      fileName: 'extra.png', fileSizeBytes: 10, fileMimeType: 'image/png',
      uploadedByEmployeeId: 'emp-1', uploadedByEmail: 'poc@x.co', uploadedByRole: 'POC',
      path: 't1/c-1/counterparty-additions/x-extra.png',
    })
    expect(contractRepository.setBudgetApproved).not.toHaveBeenCalled()
    expect(contractRepository.addSupportingDocument).toHaveBeenCalledWith(
      expect.objectContaining({ sectionCategory: 'ADDITIONAL', displayName: 'Additional Supporting Document' })
    )
  })

  it('rejects an unrelated non-privileged actor', async () => {
    // getForAccess -> uploadedByEmployeeId: 'someone-else'; role 'POC'; actor 'emp-99'
    await expect(
      service.finalizeAddSupportingDocument({
        tenantId: 't1', contractId: 'c-1', sectionCategory: 'ADDITIONAL',
        fileName: 'x.pdf', fileSizeBytes: 10, fileMimeType: 'application/pdf',
        uploadedByEmployeeId: 'emp-99', uploadedByEmail: 'other@x.co', uploadedByRole: 'POC',
        path: 't1/c-1/counterparty-additions/x.pdf',
      })
    ).rejects.toMatchObject({ code: 'CONTRACT_SUPPORTING_UPLOAD_FORBIDDEN' })
  })

  it('rejects a blocked (post-completion) status', async () => {
    // getForAccess -> { status: 'EXECUTED', uploadedByEmployeeId: 'emp-1' }
    await expect(
      service.finalizeAddSupportingDocument({
        tenantId: 't1', contractId: 'c-1', sectionCategory: 'BUDGET',
        fileName: 'x.pdf', fileSizeBytes: 10, fileMimeType: 'application/pdf',
        uploadedByEmployeeId: 'emp-1', uploadedByEmail: 'poc@x.co', uploadedByRole: 'POC',
        path: 't1/c-1/counterparty-additions/x.pdf',
      })
    ).rejects.toMatchObject({ code: 'CONTRACT_SUPPORTING_UPLOAD_STATUS_FORBIDDEN' })
  })

  it('requires counterpartyId for COUNTERPARTY uploads', async () => {
    await expect(
      service.initiateAddSupportingDocument({
        tenantId: 't1', contractId: 'c-1', sectionCategory: 'COUNTERPARTY',
        fileName: 'x.pdf', fileSizeBytes: 10, fileMimeType: 'application/pdf',
        uploadedByEmployeeId: 'emp-1', uploadedByEmail: 'poc@x.co', uploadedByRole: 'POC',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})
```

Note: when `setBudgetApproved` is added to the test's `contractRepository` mock, also add it to any other test in the file that uses a shared mock object so the type still satisfies the interface (add `setBudgetApproved: jest.fn().mockResolvedValue({ changed: false })` and `addSupportingDocument: jest.fn().mockResolvedValue(undefined)` to the shared mock factory).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/core/domain/contracts/contract-upload-service.test.ts`
Expected: FAIL — `service.finalizeAddSupportingDocument is not a function`.

- [ ] **Step 3: Add the allowed-status set + validators + permission helper**

In `src/core/domain/contracts/contract-upload-service.ts`:

(a) Add the input types to the existing import from `@/core/domain/contracts/types` (e.g. add `AddSupportingDocumentInput`).

(b) Add the supporting-upload mime constant import to the existing import from `@/core/constants/contracts`:
add `contractSupportingUploadAllowedMimeTypes` (and keep `contractDocumentMimeTypes`).

(c) Near the other private status sets (e.g. where `legalReplacementStatuses` is defined), add:

```ts
  private readonly supportingUploadAllowedStatuses = new Set<ContractStatus>([
    contractStatuses.draft,
    contractStatuses.uploaded,
    contractStatuses.hodPending,
    contractStatuses.underReview,
    contractStatuses.pendingInternal,
    contractStatuses.pendingExternal,
    contractStatuses.offlineExecution,
    contractStatuses.onHold,
  ])
```

(d) Add a file-type validator method (next to `isAllowedReplacementUpload`):

```ts
  private isAllowedSupportingUpload(fileName: string, mimeType: string): boolean {
    const normalizedMimeType = mimeType.trim().toLowerCase()
    const normalizedFileName = fileName.trim().toLowerCase()
    const allowedExtensions = ['.doc', '.docx', '.pdf', '.png', '.jpg', '.jpeg']

    if ((contractSupportingUploadAllowedMimeTypes as readonly string[]).includes(normalizedMimeType)) {
      return true
    }

    return allowedExtensions.some((extension) => normalizedFileName.endsWith(extension))
  }
```

(e) Add a permission helper (next to `assertSupportingReplacementPermissions`):

```ts
  private async assertSupportingUploadPermissions(
    contract: ContractAccessRecord,
    input: { uploadedByEmployeeId: string; uploadedByRole: string }
  ): Promise<void> {
    if (!this.supportingUploadAllowedStatuses.has(contract.status)) {
      throw new BusinessRuleError(
        'CONTRACT_SUPPORTING_UPLOAD_STATUS_FORBIDDEN',
        'Supporting documents can only be uploaded before the contract is completed'
      )
    }

    const isPrivileged =
      input.uploadedByRole === contractWorkflowRoles.legalTeam ||
      input.uploadedByRole === contractWorkflowRoles.admin
    if (isPrivileged) {
      return
    }

    if (contract.uploadedByEmployeeId === input.uploadedByEmployeeId) {
      return
    }

    if (input.uploadedByRole === contractWorkflowRoles.hod) {
      const isUploaderInTeam = await this.contractRepository.isUploaderInActorTeam({
        tenantId: contract.tenantId,
        actorEmployeeId: input.uploadedByEmployeeId,
        uploaderEmployeeId: contract.uploadedByEmployeeId,
      })
      if (isUploaderInTeam) {
        return
      }
    }

    throw new AuthorizationError(
      'CONTRACT_SUPPORTING_UPLOAD_FORBIDDEN',
      'You do not have permission to upload supporting documents for this contract'
    )
  }
```

Confirm `contractWorkflowRoles`, `BusinessRuleError`, `AuthorizationError`, `ContractStatus`, `ContractAccessRecord` are already imported in this file (they are used elsewhere in it). Add any that are missing.

(f) Add a section-descriptor resolver (private helper):

```ts
  private resolveSupportingSection(input: {
    sectionCategory: 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY'
    counterpartyId?: string | null
  }): { displayName: string; counterpartyId: string | null } {
    if (input.sectionCategory === 'COUNTERPARTY') {
      return { displayName: 'Counterparty Document', counterpartyId: input.counterpartyId ?? null }
    }
    if (input.sectionCategory === 'ADDITIONAL') {
      return { displayName: 'Additional Supporting Document', counterpartyId: null }
    }
    return { displayName: 'Budget Approval Supporting Document', counterpartyId: null }
  }
```

(Note: "Additional Supporting Document" begins with "Additional", "Budget Approval Supporting Document" does not — this matches the UI grouping at `ContractDocumentsPanel.tsx:296-298`.)

- [ ] **Step 4: Add `initiateAddSupportingDocument` and `finalizeAddSupportingDocument`**

Insert after `finalizeReplaceSupportingDocument` (ends line 830):

```ts
  async initiateAddSupportingDocument(
    input: Omit<AddSupportingDocumentInput, 'displayName' | 'filePath' | 'counterpartyName'>
  ): Promise<InitializeReplaceSupportingDocumentResult> {
    if (!this.isAllowedSupportingUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError(
        'CONTRACT_SUPPORTING_UPLOAD_FILE_FORMAT_INVALID',
        'Supporting document must be DOC, DOCX, PDF, PNG, or JPG'
      )
    }

    if (input.sectionCategory === 'COUNTERPARTY' && !input.counterpartyId?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'counterpartyId is required for counterparty documents')
    }

    const contract = await this.contractRepository.getForAccess(input.contractId, input.tenantId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found for tenant')
    }

    await this.assertSupportingUploadPermissions(contract, input)

    const safeFileName = this.sanitizeFileName(input.fileName)
    const path = `${input.tenantId}/${input.contractId}/counterparty-additions/${randomUUID()}-${safeFileName}`
    const signedUpload = await this.contractStorageRepository.createSignedUploadUrl(path)

    return {
      upload: {
        fileName: safeFileName,
        fileSizeBytes: input.fileSizeBytes,
        fileMimeType: input.fileMimeType,
        ...signedUpload,
      },
    }
  }

  async finalizeAddSupportingDocument(
    input: Omit<AddSupportingDocumentInput, 'displayName' | 'filePath' | 'counterpartyName'> & { path: string }
  ): Promise<void> {
    if (!this.isAllowedSupportingUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError(
        'CONTRACT_SUPPORTING_UPLOAD_FILE_FORMAT_INVALID',
        'Supporting document must be DOC, DOCX, PDF, PNG, or JPG'
      )
    }

    if (input.sectionCategory === 'COUNTERPARTY' && !input.counterpartyId?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'counterpartyId is required for counterparty documents')
    }

    const contract = await this.contractRepository.getForAccess(input.contractId, input.tenantId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found for tenant')
    }

    await this.assertSupportingUploadPermissions(contract, input)

    const exists = await this.contractStorageRepository.exists(input.path)
    if (!exists) {
      throw new BusinessRuleError(
        'CONTRACT_UPLOAD_INCOMPLETE',
        'Uploaded supporting document file is missing from storage'
      )
    }

    const section = this.resolveSupportingSection(input)

    let counterpartyName: string | null = null
    if (input.sectionCategory === 'COUNTERPARTY' && input.counterpartyId) {
      const counterparties = await this.contractRepository.listCounterparties({
        tenantId: input.tenantId,
        contractId: input.contractId,
      })
      counterpartyName =
        counterparties.find((counterparty) => counterparty.id === input.counterpartyId)?.counterpartyName ?? null
    }

    await this.contractRepository.addSupportingDocument({
      tenantId: input.tenantId,
      contractId: input.contractId,
      sectionCategory: input.sectionCategory,
      counterpartyId: section.counterpartyId,
      counterpartyName,
      displayName: section.displayName,
      fileName: input.fileName,
      filePath: input.path,
      fileSizeBytes: input.fileSizeBytes,
      fileMimeType: input.fileMimeType,
      uploadedByEmployeeId: input.uploadedByEmployeeId,
      uploadedByEmail: input.uploadedByEmail,
      uploadedByRole: input.uploadedByRole,
    })

    if (input.sectionCategory === 'BUDGET') {
      await this.contractRepository.setBudgetApproved({
        tenantId: input.tenantId,
        contractId: input.contractId,
        actorEmployeeId: input.uploadedByEmployeeId,
        actorEmail: input.uploadedByEmail,
        actorRole: input.uploadedByRole,
      })
    }
  }
```

Notes:
- `InitializeReplaceSupportingDocumentResult`, `randomUUID`, and `ValidationError` are already used/imported in this file — verify and add `ValidationError` to the imports from the http errors module if missing (search the file for `ValidationError`; if the codebase uses a different validation error class, use that one and update the test's expected `code`).
- `ContractAccessRecord` includes `tenantId` and `status` (see `types.ts:53-62`), which `assertSupportingUploadPermissions` relies on.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/core/domain/contracts/contract-upload-service.test.ts`
Expected: PASS (all five new cases) and existing tests still green.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/domain/contracts/contract-upload-service.ts src/core/domain/contracts/contract-upload-service.test.ts
git commit -m "feat(contracts): add supporting-document upload service with budget-flag flip"
```
(Do NOT run — report ready to commit.)

---

## Task 5: API routes — `supporting-document/init` and `/finalize` + registry

**Files:**
- Create: `src/app/api/contracts/[contractId]/supporting-document/init/route.ts`
- Create: `src/app/api/contracts/[contractId]/supporting-document/finalize/route.ts`
- Modify: `src/core/config/route-registry.ts:55` (after `replaceSupportingDocumentFinalize`)

- [ ] **Step 1: Add route-registry keys**

In `src/core/config/route-registry.ts`, after line 55 (`replaceSupportingDocumentFinalize: ...`), add:

```ts
      addSupportingDocumentInit: '/api/contracts/:contractId/supporting-document/init',
      addSupportingDocumentFinalize: '/api/contracts/:contractId/supporting-document/finalize',
```

- [ ] **Step 2: Create the init route**

Create `src/app/api/contracts/[contractId]/supporting-document/init/route.ts` (mirrors `replace-supporting-document/init/route.ts`, schema changed to a section descriptor):

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { getContractUploadService, getIdempotencyService } from '@/core/registry/service-registry'
import { isAppError } from '@/core/http/errors'
import { logger } from '@/core/infra/logging/logger'

export const maxDuration = 300

const requestSchema = z.object({
  sectionCategory: z.enum(['BUDGET', 'ADDITIONAL', 'COUNTERPARTY']),
  counterpartyId: z.string().trim().uuid('Valid counterpartyId is required').optional(),
  file: z.object({
    fileName: z.string().trim().min(1, 'File name is required'),
    fileSizeBytes: z.number().int().positive('File size must be greater than zero'),
    fileMimeType: z.string().trim().min(1, 'File MIME type is required'),
  }),
})

const POSTHandler = withAuth(async (request: NextRequest, { session, params }) => {
  let shouldReleaseClaim = false
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }
    if (!session.email || !session.role) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session is missing required user details'), {
        status: 401,
      })
    }

    const contractId = params?.contractId
    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
    if (!idempotencyKey) {
      return NextResponse.json(errorResponse('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required'), {
        status: 400,
      })
    }

    const payload = await request.json()
    const parsedPayload = requestSchema.safeParse(payload)
    if (!parsedPayload.success) {
      return NextResponse.json(
        errorResponse('VALIDATION_ERROR', parsedPayload.error.issues[0]?.message ?? 'Invalid input'),
        { status: 400 }
      )
    }

    const idempotencyService = getIdempotencyService()
    const claimResult = await idempotencyService.claimOrGet(idempotencyKey, session.tenantId)
    if (claimResult.status === 'cached') {
      return NextResponse.json(claimResult.record.responseData, { status: claimResult.record.statusCode })
    }
    if (claimResult.status === 'in-progress') {
      return NextResponse.json(
        errorResponse('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is already in progress'),
        { status: 409 }
      )
    }

    shouldReleaseClaim = true

    const contractUploadService = getContractUploadService()
    const plan = await contractUploadService.initiateAddSupportingDocument({
      tenantId: session.tenantId,
      contractId,
      sectionCategory: parsedPayload.data.sectionCategory,
      counterpartyId: parsedPayload.data.counterpartyId ?? null,
      uploadedByEmployeeId: session.employeeId,
      uploadedByEmail: session.email,
      uploadedByRole: session.role,
      fileName: parsedPayload.data.file.fileName,
      fileSizeBytes: parsedPayload.data.file.fileSizeBytes,
      fileMimeType: parsedPayload.data.file.fileMimeType,
    })

    const responseData = okResponse(plan)
    await idempotencyService.store(idempotencyKey, session.tenantId, responseData, 200)
    shouldReleaseClaim = false
    return NextResponse.json(responseData)
  } catch (error) {
    const tenantId = session.tenantId
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
    if (tenantId && idempotencyKey && shouldReleaseClaim) {
      try {
        const idempotencyService = getIdempotencyService()
        await idempotencyService.releaseClaim(idempotencyKey, tenantId)
      } catch {
        // noop
      }
    }
    logger.warn('Supporting document add init failed', {
      error: String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    })
    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to initialize supporting document upload'
    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const POST = POSTHandler
```

- [ ] **Step 3: Create the finalize route**

Create `src/app/api/contracts/[contractId]/supporting-document/finalize/route.ts`. Same skeleton as init, but the schema includes `file.path`, it calls `finalizeAddSupportingDocument`, and it returns `okResponse({ success: true })`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { getContractUploadService, getIdempotencyService } from '@/core/registry/service-registry'
import { isAppError } from '@/core/http/errors'
import { logger } from '@/core/infra/logging/logger'

export const maxDuration = 300

const requestSchema = z.object({
  sectionCategory: z.enum(['BUDGET', 'ADDITIONAL', 'COUNTERPARTY']),
  counterpartyId: z.string().trim().uuid('Valid counterpartyId is required').optional(),
  file: z.object({
    fileName: z.string().trim().min(1, 'File name is required'),
    fileSizeBytes: z.number().int().positive('File size must be greater than zero'),
    fileMimeType: z.string().trim().min(1, 'File MIME type is required'),
    path: z.string().trim().min(1, 'File path is required'),
  }),
})

const POSTHandler = withAuth(async (request: NextRequest, { session, params }) => {
  let shouldReleaseClaim = false
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }
    if (!session.email || !session.role) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session is missing required user details'), {
        status: 401,
      })
    }

    const contractId = params?.contractId
    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
    if (!idempotencyKey) {
      return NextResponse.json(errorResponse('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required'), {
        status: 400,
      })
    }

    const payload = await request.json()
    const parsedPayload = requestSchema.safeParse(payload)
    if (!parsedPayload.success) {
      return NextResponse.json(
        errorResponse('VALIDATION_ERROR', parsedPayload.error.issues[0]?.message ?? 'Invalid input'),
        { status: 400 }
      )
    }

    const idempotencyService = getIdempotencyService()
    const claimResult = await idempotencyService.claimOrGet(idempotencyKey, session.tenantId)
    if (claimResult.status === 'cached') {
      return NextResponse.json(claimResult.record.responseData, { status: claimResult.record.statusCode })
    }
    if (claimResult.status === 'in-progress') {
      return NextResponse.json(
        errorResponse('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is already in progress'),
        { status: 409 }
      )
    }

    shouldReleaseClaim = true

    const contractUploadService = getContractUploadService()
    await contractUploadService.finalizeAddSupportingDocument({
      tenantId: session.tenantId,
      contractId,
      sectionCategory: parsedPayload.data.sectionCategory,
      counterpartyId: parsedPayload.data.counterpartyId ?? null,
      uploadedByEmployeeId: session.employeeId,
      uploadedByEmail: session.email,
      uploadedByRole: session.role,
      fileName: parsedPayload.data.file.fileName,
      fileSizeBytes: parsedPayload.data.file.fileSizeBytes,
      fileMimeType: parsedPayload.data.file.fileMimeType,
      path: parsedPayload.data.file.path,
    })

    const responseData = okResponse({ success: true })
    await idempotencyService.store(idempotencyKey, session.tenantId, responseData, 200)
    shouldReleaseClaim = false
    return NextResponse.json(responseData)
  } catch (error) {
    const tenantId = session.tenantId
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
    if (tenantId && idempotencyKey && shouldReleaseClaim) {
      try {
        const idempotencyService = getIdempotencyService()
        await idempotencyService.releaseClaim(idempotencyKey, tenantId)
      } catch {
        // noop
      }
    }
    logger.warn('Supporting document add finalize failed', {
      error: String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    })
    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to finalize supporting document upload'
    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const POST = POSTHandler
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (Confirm `getIdempotencyService`, `claimOrGet`, `store`, `releaseClaim` signatures match the replace route — they are copied verbatim.)

- [ ] **Step 5: Commit**

```bash
git add src/core/config/route-registry.ts "src/app/api/contracts/[contractId]/supporting-document"
git commit -m "feat(contracts): add supporting-document upload init/finalize routes"
```
(Do NOT run — report ready to commit.)

---

## Task 6: Browser client — `addSupportingDocument`

**Files:**
- Modify: `src/core/client/contracts-client.ts` (add a method after `replaceSupportingDocument`, which ends line 1209)

- [ ] **Step 1: Add the client method**

Insert after the `replaceSupportingDocument` method (after line 1209):

```ts
  async addSupportingDocument(params: {
    contractId: string
    sectionCategory: 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY'
    counterpartyId?: string
    file: File
    idempotencyKey: string
  }): Promise<ApiResponse<{ success: true }>> {
    const initResponse = await safeFetch<{ upload: { signedUrl: string; path: string; fileName: string } }>(
      resolveContractPath(routeRegistry.api.contracts.addSupportingDocumentInit, params.contractId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${params.idempotencyKey}:init`,
        },
        body: JSON.stringify({
          sectionCategory: params.sectionCategory,
          counterpartyId: params.counterpartyId,
          file: {
            fileName: params.file.name,
            fileSizeBytes: params.file.size,
            fileMimeType: params.file.type || 'application/octet-stream',
          },
        }),
      }
    )

    if (!initResponse.ok || !initResponse.data) {
      return initResponse as unknown as ApiResponse<{ success: true }>
    }

    try {
      await xhrSignedUpload(initResponse.data.upload.signedUrl, params.file)
    } catch (error) {
      if (String(error).toLowerCase().includes('cancel')) {
        return { ok: false, error: { code: 'upload_cancelled', message: 'Upload was cancelled.' } }
      }
      return { ok: false, error: { code: 'signed_upload_failed', message: 'File upload to storage failed.' } }
    }

    return safeFetch<{ success: true }>(
      resolveContractPath(routeRegistry.api.contracts.addSupportingDocumentFinalize, params.contractId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${params.idempotencyKey}:finalize`,
        },
        body: JSON.stringify({
          sectionCategory: params.sectionCategory,
          counterpartyId: params.counterpartyId,
          file: {
            fileName: initResponse.data.upload.fileName,
            fileSizeBytes: params.file.size,
            fileMimeType: params.file.type || 'application/octet-stream',
            path: initResponse.data.upload.path,
          },
        }),
      }
    )
  },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (`safeFetch`, `resolveContractPath`, `xhrSignedUpload`, `ApiResponse` are already used by `replaceSupportingDocument` in the same file).

- [ ] **Step 3: Commit**

```bash
git add src/core/client/contracts-client.ts
git commit -m "feat(contracts): client addSupportingDocument upload helper"
```
(Do NOT run — report ready to commit.)

---

## Task 7: Activity-log formatting — added-document + budget-flip lines

**Files:**
- Modify: `src/modules/contracts/ui/formatContractLogEvent.ts`
- Test: `src/modules/contracts/ui/formatContractLogEvent.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/modules/contracts/ui/formatContractLogEvent.test.ts`, add (match the file's existing event-fixture builder; events carry `action`, `eventType`, `metadata`, `actorEmail`, `createdAt`, `id`):

```ts
describe('supporting document added events', () => {
  const base = { id: 'e1', actorEmail: 'poc@x.co', actorRole: 'POC', createdAt: new Date().toISOString(), eventType: 'CONTRACT_SUPPORTING_DOCUMENT_ADDED', action: 'contract.supporting_document.added', noteText: null, targetEmail: null }

  it('formats a budget upload', () => {
    const result = formatContractLogEvent({ ...base, metadata: { section_category: 'BUDGET', file_name: 'budget.pdf' } } as never)
    expect(result.message).toBe('Uploaded "budget.pdf" to Budget Approval Supporting Documents.')
    expect(result.category).toBe('GENERAL')
  })

  it('formats an additional upload', () => {
    const result = formatContractLogEvent({ ...base, metadata: { section_category: 'ADDITIONAL', file_name: 'extra.png' } } as never)
    expect(result.message).toBe('Uploaded "extra.png" to Additional Supporting Documents.')
  })

  it('formats a counterparty upload', () => {
    const result = formatContractLogEvent({ ...base, metadata: { section_category: 'COUNTERPARTY', file_name: 'nda.pdf', counterparty_name: 'Acme Corp' } } as never)
    expect(result.message).toBe('Uploaded "nda.pdf" to Counterparty Documents for Acme Corp.')
  })

  it('falls back when metadata is missing', () => {
    const result = formatContractLogEvent({ ...base, metadata: {} } as never)
    expect(result.message).toBe('Uploaded a supporting document.')
  })

  it('formats the budget-approved flip', () => {
    const result = formatContractLogEvent({ ...base, eventType: 'CONTRACT_BUDGET_APPROVED_SET', action: 'contract.budget_approved.set', metadata: {} } as never)
    expect(result.message).toBe('Marked Budget Approved as Yes via document upload.')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/modules/contracts/ui/formatContractLogEvent.test.ts`
Expected: FAIL — messages currently fall through to `Recorded: …`.

- [ ] **Step 3: Register the two canonical types**

In `src/modules/contracts/ui/formatContractLogEvent.ts`:

(a) Add to the `CanonicalContractLogEventType` union (after `'SIGNING_PREPARATION_DRAFT_SAVED'`, line 39):

```ts
  | 'SUPPORTING_DOCUMENT_ADDED'
  | 'BUDGET_APPROVED_SET'
```

(b) Add both to `knownCanonicalEventTypes` (after line 103):

```ts
  'SUPPORTING_DOCUMENT_ADDED',
  'BUDGET_APPROVED_SET',
```

(c) In `normalizeEventType` switch (before `default:` at line 165), add:

```ts
    case 'CONTRACT_SUPPORTING_DOCUMENT_ADDED':
      return 'SUPPORTING_DOCUMENT_ADDED'
    case 'CONTRACT_BUDGET_APPROVED_SET':
      return 'BUDGET_APPROVED_SET'
```

(d) In `normalizeFromAction` switch (before `default:` at line 235), add:

```ts
    case 'contract.supporting_document.added':
      return 'SUPPORTING_DOCUMENT_ADDED'
    case 'contract.budget_approved.set':
      return 'BUDGET_APPROVED_SET'
```

(e) `resolveCategory` (line 429) — both fall through to the `default` returning `'GENERAL'`, so no change is required there. (Leave as-is.)

- [ ] **Step 4: Add the message text**

In `resolveLogMessage` (line 542), add these cases inside the `switch (canonicalType)` block (before `default: break`, around line 645):

```ts
    case 'SUPPORTING_DOCUMENT_ADDED': {
      const sectionCategory = getMetadataString(event.metadata, ['section_category'])
      const fileName = getMetadataString(event.metadata, ['file_name'])
      const counterpartyName = getMetadataString(event.metadata, ['counterparty_name'])
      const fileLabel = fileName ? `"${fileName}"` : 'a document'

      if (sectionCategory === 'BUDGET') {
        return `Uploaded ${fileLabel} to Budget Approval Supporting Documents.`
      }
      if (sectionCategory === 'ADDITIONAL') {
        return `Uploaded ${fileLabel} to Additional Supporting Documents.`
      }
      if (sectionCategory === 'COUNTERPARTY') {
        return `Uploaded ${fileLabel} to Counterparty Documents for ${counterpartyName ?? 'a counterparty'}.`
      }
      return 'Uploaded a supporting document.'
    }
    case 'BUDGET_APPROVED_SET':
      return 'Marked Budget Approved as Yes via document upload.'
```

Note: the "fallback when metadata is missing" test expects `'Uploaded a supporting document.'` — with empty metadata `sectionCategory` is `null`, so none of the branches match and the final `return` produces exactly that. ✓

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/modules/contracts/ui/formatContractLogEvent.test.ts`
Expected: PASS (all five new cases + existing).

- [ ] **Step 6: Commit**

```bash
git add src/modules/contracts/ui/formatContractLogEvent.ts src/modules/contracts/ui/formatContractLogEvent.test.ts
git commit -m "feat(contracts): timeline messages for supporting upload and budget flip"
```
(Do NOT run — report ready to commit.)

---

## Task 8: Feature B — relax `downloadFinalSigningArtifact` role gate

**Files:**
- Modify: `src/core/domain/contracts/contract-signatory-service.ts:644-653`
- Test: the existing signatory-service test (locate via `grep -rl downloadFinalSigningArtifact src --include=*.test.ts`)

Rationale: the method already calls `getContractDetail(...)` (line 656), which enforces read access via `canAccessContract` (see `contract-query-service.ts:207-216`). That check already encodes department/ownership/HOD scoping ("if you can see the contract, it's your department"). The only blocker is the hard Legal/Admin role allow-list at lines 648-653.

- [ ] **Step 1: Write/extend the failing test**

In the signatory-service test, add a case proving a non-Legal/Admin role no longer hits the early role gate. Use the existing harness/mocks in that file (it already constructs the service with a `contractQueryService` mock). Make `getContractDetail` resolve a contract view with a signatory that has a `zohoSignEnvelopeId`, and assert that calling with `actorRole: 'POC'` proceeds past the role check (e.g. it calls `contractQueryService.getContractDetail`, rather than throwing `CONTRACT_SIGNATORY_FORBIDDEN`):

```ts
it('allows a POC who can read the contract to download (no hard role gate)', async () => {
  contractQueryService.getContractDetail.mockResolvedValue({
    signatories: [{ zohoSignEnvelopeId: 'env-1' }],
    documents: [],
  } as never)
  // stub whatever downstream storage/zoho calls the method makes for 'merged_pdf' or 'signed_document'
  await expect(
    service.downloadFinalSigningArtifact({
      tenantId: 't1', contractId: 'c-1', actorEmployeeId: 'emp-1', actorRole: 'POC', artifact: 'signed_document',
    })
  ).resolves.toBeDefined()
  expect(contractQueryService.getContractDetail).toHaveBeenCalled()
})

it('still rejects when role is missing', async () => {
  await expect(
    service.downloadFinalSigningArtifact({
      tenantId: 't1', contractId: 'c-1', actorEmployeeId: 'emp-1', artifact: 'signed_document',
    } as never)
  ).rejects.toMatchObject({ code: 'CONTRACT_SIGNATORY_FORBIDDEN' })
})
```

(If stubbing the full download path is heavy, instead assert that the call does NOT reject with `CONTRACT_SIGNATORY_FORBIDDEN` when `getContractDetail` is mocked to throw `CONTRACT_READ_FORBIDDEN` — i.e. access is now decided by `getContractDetail`, not the role gate.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest <signatory-service test path>`
Expected: FAIL — the POC call currently throws `CONTRACT_SIGNATORY_FORBIDDEN` at the role gate.

- [ ] **Step 3: Remove the hard role allow-list**

In `src/core/domain/contracts/contract-signatory-service.ts`, replace the block at lines 644-653:

```ts
    if (!params.actorRole) {
      throw new AuthorizationError('CONTRACT_SIGNATORY_FORBIDDEN', 'User role is required for final artifact download')
    }

    if (params.actorRole !== contractWorkflowRoles.legalTeam && params.actorRole !== contractWorkflowRoles.admin) {
      throw new AuthorizationError(
        'CONTRACT_SIGNATORY_FORBIDDEN',
        'Only LEGAL_TEAM or ADMIN can download final signing artifacts'
      )
    }
```

with (keep the role-required guard; drop the Legal/Admin-only restriction and let `getContractDetail` enforce read access):

```ts
    if (!params.actorRole) {
      throw new AuthorizationError('CONTRACT_SIGNATORY_FORBIDDEN', 'User role is required for final artifact download')
    }

    // Access is enforced below by getContractDetail's canAccessContract check, which already
    // scopes by ownership / assignment / HOD-team / department. Any role that can read the
    // contract (POC creator, HOD of the department, Legal, Admin) may download its signed docs.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest <signatory-service test path>`
Expected: PASS. Run the full signatory test file to confirm no regressions.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (`contractWorkflowRoles` may now be unused in this file — if `tsc`/lint flags it, remove it from the imports.)

- [ ] **Step 6: Commit**

```bash
git add src/core/domain/contracts/contract-signatory-service.ts <signatory-service test path>
git commit -m "feat(contracts): allow POC/HOD to download signed docs via read-access check"
```
(Do NOT run — report ready to commit.)

---

## Task 9: Workspace — widen Signed Docs tab visibility + pass counterparties

**Files:**
- Modify: `src/modules/contracts/ui/ContractsWorkspace.tsx:254` (canViewSignedDocsTab)
- Modify: `src/modules/contracts/ui/ContractsWorkspace.tsx:2970-2985` (panel props)

- [ ] **Step 1: Widen `canViewSignedDocsTab`**

In `ContractsWorkspace.tsx`, replace line 254:

```ts
  const canViewSignedDocsTab = session.role === 'LEGAL_TEAM' || session.role === 'ADMIN'
```

with:

```ts
  const canViewSignedDocsTab =
    session.role === 'LEGAL_TEAM' ||
    session.role === 'ADMIN' ||
    session.role === contractWorkflowRoles.hod ||
    (Boolean(selectedContract) && session.employeeId === selectedContract?.uploadedByEmployeeId)
```

Notes:
- `contractWorkflowRoles` and `selectedContract` are already in scope in this component (used elsewhere, e.g. `isHodSession` on line 255 and `selectedContract` throughout). Verify `selectedContract` is declared before line 254; if it is declared later, move this computation to just after `selectedContract` is defined (keep the same variable name so the existing `useMemo` deps `[canViewSignedDocsTab]` at line 270 and references at 467/955/1034/3014 keep working).
- The Signed Docs tab body and its three download buttons are already read-only; backend download is gated by Task 8. No element-level gating changes needed.

- [ ] **Step 2: Pass `counterparties` to the documents panel**

In the `<ContractDocumentsPanel ... />` props (lines 2970-2985), add (the `counterparties` state already exists at line 187 and is populated at line 394):

```tsx
                      counterparties={counterparties}
```

- [ ] **Step 3: Type-check (expected to FAIL until Task 10 adds the prop)**

Run: `npx tsc --noEmit`
Expected: FAIL — `ContractDocumentsPanel` does not yet accept a `counterparties` prop. Task 10 adds it. (If you prefer a always-green sequence, do Task 10 Step 3's prop-type addition before this step.)

- [ ] **Step 4: Do NOT commit yet** — commit with Task 10 (panel prop + workspace wiring land together).

---

## Task 10: Documents panel — always-rendered sections + Upload button + modal

**Files:**
- Modify: `src/modules/contracts/ui/ContractDocumentsPanel.tsx`
- Test: `src/modules/contracts/ui/ContractDocumentsPanel.test.tsx`

Goal: always render the three section types (Budget Approval, Additional, one per counterparty) — each as a flat list with its own **Upload** button (gated by `canUploadSupporting`) — plus a single Upload modal. Keep the existing per-item Replace button untouched. The main-doc Active Version + Version History blocks stay exactly as they are.

- [ ] **Step 1: Write the failing tests**

In `src/modules/contracts/ui/ContractDocumentsPanel.test.tsx`, add (reuse the file's existing render helper + `contractsClient` mock):

```tsx
it('always renders Budget and Additional sections with an Upload button when empty', () => {
  renderPanel({
    contractStatus: 'HOD_PENDING',
    userRole: 'POC',
    actorEmployeeId: 'emp-1',
    uploadedByEmployeeId: 'emp-1',
    counterparties: [],
    documents: [primaryDocumentFixture], // only a primary doc, no supporting docs
  })
  expect(screen.getByText('Budget Approval Supporting Documents')).toBeInTheDocument()
  expect(screen.getByText('Additional Supporting Documents')).toBeInTheDocument()
  // Two Upload buttons (one per fixed section)
  expect(screen.getAllByRole('button', { name: /upload/i }).length).toBeGreaterThanOrEqual(2)
})

it('renders one section per counterparty', () => {
  renderPanel({
    contractStatus: 'HOD_PENDING', userRole: 'POC', actorEmployeeId: 'emp-1', uploadedByEmployeeId: 'emp-1',
    counterparties: [{ id: 'cp-1', counterpartyName: 'Acme Corp' }],
    documents: [primaryDocumentFixture],
  })
  expect(screen.getByText('Acme Corp')).toBeInTheDocument()
})

it('hides Upload buttons when the user cannot upload (post-completion)', () => {
  renderPanel({
    contractStatus: 'COMPLETED', userRole: 'POC', actorEmployeeId: 'emp-1', uploadedByEmployeeId: 'emp-1',
    counterparties: [], documents: [primaryDocumentFixture],
  })
  expect(screen.queryByRole('button', { name: /^upload$/i })).not.toBeInTheDocument()
})

it('submits the correct section descriptor on upload', async () => {
  const addSupportingDocument = jest.spyOn(contractsClient, 'addSupportingDocument').mockResolvedValue({ ok: true, data: { success: true } } as never)
  renderPanel({
    contractStatus: 'HOD_PENDING', userRole: 'POC', actorEmployeeId: 'emp-1', uploadedByEmployeeId: 'emp-1',
    counterparties: [], documents: [primaryDocumentFixture],
  })
  // open the Budget section Upload modal, choose a file, submit
  fireEvent.click(within(screen.getByText('Budget Approval Supporting Documents').closest('[data-section]')!).getByRole('button', { name: /upload/i }))
  const file = new File(['x'], 'budget.pdf', { type: 'application/pdf' })
  fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: /^upload$/i })) // modal submit
  await waitFor(() => expect(addSupportingDocument).toHaveBeenCalledWith(expect.objectContaining({ sectionCategory: 'BUDGET' })))
})
```

(Adjust selectors to the file's existing query conventions; the key assertions are: sections always present, Upload visibility gating, and the `sectionCategory` passed to the client. Add a `data-section="<key>"` attribute on each section wrapper in Step 4 to make scoping queries reliable.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/modules/contracts/ui/ContractDocumentsPanel.test.tsx`
Expected: FAIL — sections aren't rendered when empty; no Upload button; `counterparties` prop unknown.

- [ ] **Step 3: Add the `counterparties` prop and the upload-capability flag**

In `ContractDocumentsPanel.tsx`:

(a) Extend `ContractDocumentsPanelProps` (line 10-25) with:

```ts
  counterparties?: Array<{ id: string; counterpartyName: string }>
```

(b) Destructure it in the component (line 229-243) with a default: `counterparties = [],`.

(c) Add a pre-completion capability flag near the other `can*` flags (after line 364). Reuse the existing `contractStatuses` import:

```ts
  const supportingUploadAllowedStatuses = new Set<string>([
    contractStatuses.draft,
    contractStatuses.uploaded,
    contractStatuses.hodPending,
    contractStatuses.underReview,
    contractStatuses.pendingInternal,
    contractStatuses.pendingExternal,
    contractStatuses.offlineExecution,
    contractStatuses.onHold,
  ])
  const isUploaderActor = Boolean(actorEmployeeId && props.uploadedByEmployeeId && actorEmployeeId === props.uploadedByEmployeeId)
  const canUploadSupporting =
    supportingUploadAllowedStatuses.has(contractStatus) &&
    (userRole === 'LEGAL_TEAM' || userRole === 'ADMIN' || userRole === 'HOD' || isUploaderActor)
```

(`uploadedByEmployeeId` is already a prop; it's currently not destructured — either destructure it or reference `props.uploadedByEmployeeId` as shown.)

- [ ] **Step 4: Build an always-present section model and render it**

Replace the supporting-docs rendering block (currently lines 581-649, the `supportingDocumentsByCounterparty.length > 0 ? (...) : null` plus the trailing disabled-message block) with a section model that always includes the two fixed sections and one per counterparty, merging in any existing grouped documents:

```tsx
      {(() => {
        const groupsByKey = new Map(supportingDocumentsByCounterparty.map((group) => [group.key, group]))

        const sections: Array<{
          key: string
          label: string
          category: 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY'
          counterpartyId?: string
          documents: ExtendedDocument[]
        }> = [
          {
            key: 'budget-supporting',
            label: 'Budget Approval Supporting Documents',
            category: 'BUDGET',
            documents: groupsByKey.get('budget-supporting')?.documents ?? [],
          },
          {
            key: 'additional-supporting',
            label: 'Additional Supporting Documents',
            category: 'ADDITIONAL',
            documents: groupsByKey.get('additional-supporting')?.documents ?? [],
          },
          ...counterparties.map((counterparty) => ({
            key: counterparty.id,
            label: counterparty.counterpartyName,
            category: 'COUNTERPARTY' as const,
            counterpartyId: counterparty.id,
            documents: groupsByKey.get(counterparty.id)?.documents ?? [],
          })),
        ]

        return (
          <div className={workspaceStyles.card}>
            <div className={workspaceStyles.sectionTitle}>Counterparty Supporting Documents</div>
            <div className={workspaceStyles.timeline}>
              {sections.map((section) => (
                <div key={section.key} data-section={section.key} className={workspaceStyles.event}>
                  <div className={workspaceStyles.sectionHeaderRow}>
                    <div className={workspaceStyles.eventActor}>{section.label}</div>
                    <div className={workspaceStyles.actions}>
                      {canUploadSupporting ? (
                        <button
                          type="button"
                          className={`${workspaceStyles.button} ${workspaceStyles.buttonPrimary}`}
                          onClick={() =>
                            openUploadModal({
                              category: section.category,
                              counterpartyId: section.counterpartyId,
                              label: section.label,
                            })
                          }
                        >
                          Upload
                        </button>
                      ) : null}
                      {canReplaceSupporting && section.documents[0] ? (
                        <button
                          type="button"
                          className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                          onClick={() => openSupportingReplaceModal(section.documents[0])}
                        >
                          Replace Document
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {section.documents.length === 0 ? (
                    <div className={workspaceStyles.placeholderRow}>No documents uploaded yet.</div>
                  ) : (
                    <div className={workspaceStyles.timeline}>
                      {section.documents.map((document) => {
                        const isPreviewLoading = isPreparingPreview && previewingDocumentId === document.id
                        return (
                          <div key={document.id} className={workspaceStyles.documentRow}>
                            <div className={workspaceStyles.documentMeta}>
                              <div className={workspaceStyles.itemMeta}>{document.fileName}</div>
                              <div className={workspaceStyles.itemMeta}>{formatDate(document.createdAt)}</div>
                            </div>
                            <div className={workspaceStyles.actions}>
                              <button
                                type="button"
                                className={workspaceStyles.button}
                                onClick={() => {
                                  void onPreviewDocument(document)
                                }}
                                disabled={isPreparingPreview}
                              >
                                {isPreviewLoading ? (
                                  <span className={workspaceStyles.buttonContent}>
                                    <Spinner size={14} />
                                    Opening...
                                  </span>
                                ) : (
                                  'Preview'
                                )}
                              </button>
                              <button
                                type="button"
                                className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                                onClick={() => onDownloadDocument(document)}
                              >
                                Download
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!canReplaceSupporting && supportingReplaceDisabledMessage ? (
              <div className={workspaceStyles.eventMeta}>{supportingReplaceDisabledMessage}</div>
            ) : null}
          </div>
        )
      })()}
```

- [ ] **Step 5: Add upload modal state + handler**

Add state near the other `useState` declarations (after line 250):

```ts
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTarget, setUploadTarget] = useState<{
    category: 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY'
    counterpartyId?: string
    label: string
  } | null>(null)
```

Add handlers (near the replace handlers, after line 400):

```ts
  const openUploadModal = (target: {
    category: 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY'
    counterpartyId?: string
    label: string
  }) => {
    setUploadTarget(target)
    setIsUploadModalOpen(true)
  }

  const closeUploadModal = () => {
    setIsUploadModalOpen(false)
    setUploadFile(null)
    setUploadTarget(null)
  }

  const handleUploadSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!uploadTarget) {
      toast.error('Upload section context is missing')
      return
    }
    if (!uploadFile) {
      toast.error('Please select a file to upload')
      return
    }

    const selectedFile = uploadFile
    const target = uploadTarget
    closeUploadModal()

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    const uploadPromise = contractsClient
      .addSupportingDocument({
        contractId,
        sectionCategory: target.category,
        counterpartyId: target.counterpartyId,
        file: selectedFile,
        idempotencyKey,
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.error?.message ?? 'Failed to upload document')
        }
        await onRefreshDocuments()
        return response
      })

    toast.promise(uploadPromise, {
      loading: `Uploading to ${target.label}...`,
      success: 'Document uploaded successfully',
      error: (error) => (error instanceof Error ? error.message : 'Failed to upload document'),
    })

    void uploadPromise
  }
```

- [ ] **Step 6: Render the upload modal**

Add alongside the existing modals (after the supporting-replace modal block, before the component's closing `</div>` at line 729):

```tsx
      {isUploadModalOpen ? (
        <div
          className={workspaceStyles.actionRemarkOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Upload supporting document"
        >
          <form className={workspaceStyles.actionRemarkModal} onSubmit={handleUploadSubmit}>
            <div className={workspaceStyles.replacementModalTitle}>
              {uploadTarget ? `Upload to ${uploadTarget.label}` : 'Upload Supporting Document'}
            </div>
            <label className={workspaceStyles.replacementModalField}>
              <span>File</span>
              <input
                type="file"
                className={workspaceStyles.input}
                accept=".doc,.docx,.pdf,.png,.jpg,.jpeg"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className={workspaceStyles.actionRemarkActions}>
              <button
                type="button"
                className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                onClick={closeUploadModal}
              >
                Cancel
              </button>
              <button type="submit" className={`${workspaceStyles.button} ${workspaceStyles.buttonPrimary}`}>
                Upload
              </button>
            </div>
          </form>
        </div>
      ) : null}
```

- [ ] **Step 7: Run the panel tests to verify they pass**

Run: `npx jest src/modules/contracts/ui/ContractDocumentsPanel.test.tsx`
Expected: PASS (new cases + existing). If pre-existing tests asserted the old "section hidden when empty" behavior, update them to the new always-rendered model.

- [ ] **Step 8: Type-check + lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit (Tasks 9 + 10 together)**

```bash
git add src/modules/contracts/ui/ContractsWorkspace.tsx src/modules/contracts/ui/ContractDocumentsPanel.tsx src/modules/contracts/ui/ContractDocumentsPanel.test.tsx
git commit -m "feat(contracts): per-section supporting upload UI + widen signed-docs tab to POC/HOD"
```
(Do NOT run — report ready to commit.)

---

## Task 11: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: PASS (no regressions). Investigate and fix any failure before proceeding.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (no new errors).

- [ ] **Step 4: Manual smoke test (dev server)**

Run the app and verify against `src/modules/contracts/ui/ContractsWorkspace.tsx` → Documents tab:
- A contract raised with **Budget Approved = No** and no supporting docs shows **Budget Approval / Additional** sections, each with an **Upload** button.
- Uploading a budget doc: the doc appears in the Budget section, **Budget Approved flips to Yes** in the left sidebar, and the Activity tab shows two lines (upload + budget flip).
- Uploading to Additional / a counterparty appends a new list item and logs one line.
- A **POC** and a **HOD** of the contract's department can open the **Signed Docs** tab and download the executed contract + completion certificate.
- The **main document** Active Version / Replace area is visually and behaviorally unchanged.

- [ ] **Step 5: Report completion** — summarize what was changed and that everything is staged-ready (do NOT commit; the user commits manually).

---

## Self-Review (completed during planning)

- **Spec coverage:** Upload per section (Tasks 4/5/6/10) ✓; append-only list semantics — `replaced_document_id = null` + flat list render (Tasks 3/10) ✓; Budget flip + log (Tasks 3/4/7) ✓; always-visible sections (Task 10) ✓; permissions creator+HOD+Legal/Admin & pre-completion (Task 4) ✓; images allowed (Tasks 1/4/10) ✓; every-upload activity log (Tasks 3/7) ✓; POC/HOD signed-doc view+download (Tasks 8/9) ✓; main-doc Replace untouched (no task modifies it) ✓.
- **Type consistency:** `sectionCategory: 'BUDGET'|'ADDITIONAL'|'COUNTERPARTY'` is identical across types.ts, service, routes, client, panel, and log metadata; `addSupportingDocument` / `setBudgetApproved` signatures match between interface (Task 2), impl (Task 3), and callers (Task 4); audit `action`/`event_type` strings (`contract.supporting_document.added` / `CONTRACT_SUPPORTING_DOCUMENT_ADDED`, `contract.budget_approved.set` / `CONTRACT_BUDGET_APPROVED_SET`) match between repo (Task 3) and formatter (Task 7); displayName values (`Additional Supporting Document`, `Budget Approval Supporting Document`) align with the UI grouping keys (Task 10).
- **Open verifications for the implementer (flagged inline):** exact name of the validation error class in the upload service (Task 4 Step 4); the existing signatory-service test path/harness (Task 8); the `ContractDocumentsPanel.test.tsx` render-helper conventions (Task 10); whether `selectedContract` is declared before line 254 in the workspace (Task 9).
