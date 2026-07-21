# Repository Row Hover Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering a contract row in the Repository section opens a card showing the contract's description, POC, HOD, additional approvers, signers, and latest activity, without navigating away.

**Architecture:** A new `GET /api/contracts/:contractId/summary` endpoint composes five existing repository reads behind an access check and returns a card-shaped payload. On the client, a hook owns the 400ms dwell timer, fetching, caching, and request abortion; a purely presentational card component renders the result; the table wires row handlers and portals the card to `document.body`.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Jest + React Testing Library, Playwright, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-07-20-repository-row-hover-preview-design.md`

---

## Committing

This repository's owner runs all git commands manually. **Do not run `git add` or `git commit`.** Where a task ends with a commit step, instead stop, list the files you changed, and report that the task is ready to commit. Wait for the go-ahead before starting the next task.

## Background For Someone New To This Codebase

**Layering.** Domain interfaces live in `src/core/domain/`, Supabase implementations in `src/core/infra/repositories/`, HTTP routes in `src/app/api/`, browser-side fetch wrappers in `src/core/client/`, and React in `src/modules/`. A route never talks to Supabase directly — it calls a service, which calls a repository interface.

**Why no new repository methods.** Access control (`canAccessContract`) needs the full contract entity, so `getById` must be called anyway — and it already returns `backgroundOfRequest`, `signatoryName`, `signatoryDesignation`, `signatoryEmail`, and `departmentHodName`. The other four reads (`getCounterparties`, `getAdditionalApprovers`, `getSignatories`, `getTimeline`) already exist on `ContractQueryRepository`. This feature is composition only.

**Why not reuse `GET /api/contracts/:contractId`.** That path runs `getContractDetail` (`contract-query-service.ts:199`), which issues eight queries including `getAvailableActions` — action-permission computation the card never uses. See the spec's Rejected Alternatives.

**Test environment gotcha.** `jest.config.js` sets `testEnvironment: 'jest-environment-node'` globally. Any test rendering React **must** start with the docblock `/** @jest-environment jsdom */` on line 1, as `ContractDocumentsPanel.test.tsx` does. Omitting it produces confusing "document is not defined" failures.

**Commands:**
- Single Jest file: `npx jest <path> --verbose`
- Single Jest test: `npx jest <path> -t "<test name>" --verbose`
- Types: `npm run type-check`
- Lint: `npm run lint`
- E2E: `npm run test:e2e`

## File Structure

| File | Responsibility |
|---|---|
| `src/core/domain/contracts/contract-query-repository.ts` | **Modify.** Add `ContractRowPreview` types. No new interface methods. |
| `src/core/domain/contracts/contract-query-service.ts` | **Modify.** Add `getContractRowPreview()`. |
| `src/core/domain/contracts/contract-query-service.test.ts` | **Modify.** Add service tests. |
| `src/core/config/route-registry.ts` | **Modify.** Add `contracts.summary`. |
| `src/app/api/contracts/[contractId]/summary/route.ts` | **Create.** GET handler. |
| `src/core/client/contracts-client.ts` | **Modify.** Add `summary()` with abort support. |
| `src/modules/contracts/ui/useContractRowPreview.ts` | **Create.** Dwell timer, fetch, cache, abort. |
| `src/modules/contracts/ui/useContractRowPreview.test.tsx` | **Create.** Hook tests. |
| `src/modules/contracts/ui/ContractRowPreviewCard.tsx` | **Create.** Presentational card. |
| `src/modules/contracts/ui/ContractRowPreviewCard.test.tsx` | **Create.** Card tests. |
| `src/modules/contracts/ui/RepositoryWorkspaceTable.tsx` | **Modify.** Wire handlers, portal card. |
| `src/modules/contracts/ui/RepositoryWorkspace.module.css` | **Modify.** Card styles. |
| `tests/e2e/repository-and-export.spec.ts` | **Modify.** Hover E2E. |

Behavior lives in the hook and presentation in the card so the card can be tested with fixture data and no network, and the hook tested with no DOM rendering of card internals.

---

## Task 1: Add ContractRowPreview Types

**Files:**
- Modify: `src/core/domain/contracts/contract-query-repository.ts`

No test task — these are type declarations, verified by `npm run type-check` in Task 2.

- [ ] **Step 1: Add the types**

Insert immediately after the `ContractDetailView` type (around line 297), before `ContractActionMutationResult`:

```typescript
export type ContractRowPreviewApprover = {
  email: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'BYPASSED'
  approvedAt: string | null
  sequenceOrder: number
}

export type ContractRowPreviewSigner = {
  email: string
  status: ContractSignatoryStatus
  signedAt: string | null
  routingOrder: number
  recipientType: ContractSignatoryRecipientType
}

export type ContractRowPreviewActivity = {
  action: string
  actorEmail: string | null
  createdAt: string
}

export type ContractRowPreview = {
  contractId: string
  description: string | null
  signatoryPoc: { name: string; designation: string; email: string } | null
  counterparties: string[]
  hod: { name: string | null; approvedAt: string | null }
  additionalApprovers: ContractRowPreviewApprover[]
  signatories: ContractRowPreviewSigner[]
  approvedCount: number
  totalApprovers: number
  signedCount: number
  totalSigners: number
  latestActivity: ContractRowPreviewActivity | null
}
```

`ContractSignatoryStatus` and `ContractSignatoryRecipientType` are already imported at the top of this file — do not add duplicate imports.

- [ ] **Step 2: Verify types compile**

Run: `npm run type-check`
Expected: exit code 0, no errors.

- [ ] **Step 3: Ready to commit**

Report changed file: `src/core/domain/contracts/contract-query-repository.ts`. Do not run git.

---

## Task 2: Service Method `getContractRowPreview`

**Files:**
- Modify: `src/core/domain/contracts/contract-query-service.ts`
- Test: `src/core/domain/contracts/contract-query-service.test.ts`

The existing test file already has `baseContract` and `createRepositoryMock()` at the top. Reuse both.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/domain/contracts/contract-query-service.test.ts`:

```typescript
describe('getContractRowPreview', () => {
  const buildService = () => {
    const repository = createRepositoryMock()
    repository.getById.mockResolvedValue(baseContract)
    repository.canAccessContract.mockResolvedValue(true)
    repository.getCounterparties.mockResolvedValue([])
    repository.getAdditionalApprovers.mockResolvedValue([])
    repository.getSignatories.mockResolvedValue([])
    repository.getTimeline.mockResolvedValue([])
    const service = new ContractQueryService(repository)
    return { repository, service }
  }

  const params = {
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    employeeId: 'employee-1',
    role: 'LEGAL_TEAM',
  }

  it('throws AuthorizationError when the actor cannot access the contract', async () => {
    const { repository, service } = buildService()
    repository.canAccessContract.mockResolvedValue(false)

    await expect(service.getContractRowPreview(params)).rejects.toThrow(AuthorizationError)
  })

  it('does not query approvers or signers when access is denied', async () => {
    const { repository, service } = buildService()
    repository.canAccessContract.mockResolvedValue(false)

    await expect(service.getContractRowPreview(params)).rejects.toThrow(AuthorizationError)
    expect(repository.getAdditionalApprovers).not.toHaveBeenCalled()
    expect(repository.getSignatories).not.toHaveBeenCalled()
  })

  it('requests only the single most recent timeline event', async () => {
    const { repository, service } = buildService()

    await service.getContractRowPreview(params)

    expect(repository.getTimeline).toHaveBeenCalledWith('tenant-1', 'contract-1', 1)
  })

  it('maps description, POC and HOD from the contract entity', async () => {
    const { service } = buildService()

    const preview = await service.getContractRowPreview(params)

    expect(preview.description).toBe('Office fitout contract')
    expect(preview.signatoryPoc).toEqual({
      name: 'John Doe',
      designation: 'Manager',
      email: 'john.doe@nxtwave.co.in',
    })
    expect(preview.hod.name).toBe('Bala Bhaskar')
  })

  it('returns null signatoryPoc when every POC field is blank', async () => {
    const { repository, service } = buildService()
    repository.getById.mockResolvedValue({
      ...baseContract,
      signatoryName: '  ',
      signatoryDesignation: '',
      signatoryEmail: '',
    })

    const preview = await service.getContractRowPreview(params)

    expect(preview.signatoryPoc).toBeNull()
  })

  it('returns empty collections and zero counts when nothing is attached', async () => {
    const { service } = buildService()

    const preview = await service.getContractRowPreview(params)

    expect(preview.additionalApprovers).toEqual([])
    expect(preview.signatories).toEqual([])
    expect(preview.totalApprovers).toBe(0)
    expect(preview.totalSigners).toBe(0)
    expect(preview.latestActivity).toBeNull()
  })

  it('counts approved approvers and excludes SKIPPED from the total', async () => {
    const { repository, service } = buildService()
    repository.getAdditionalApprovers.mockResolvedValue([
      {
        id: 'a1',
        approverEmployeeId: 'e1',
        approverEmail: 'anil@nxtwave.co.in',
        sequenceOrder: 1,
        status: 'APPROVED',
        approvedAt: '2026-07-08T00:00:00.000Z',
      },
      {
        id: 'a2',
        approverEmployeeId: 'e2',
        approverEmail: 'meera@nxtwave.co.in',
        sequenceOrder: 2,
        status: 'PENDING',
        approvedAt: null,
      },
      {
        id: 'a3',
        approverEmployeeId: 'e3',
        approverEmail: 'skipped@nxtwave.co.in',
        sequenceOrder: 3,
        status: 'SKIPPED',
        approvedAt: null,
      },
    ])

    const preview = await service.getContractRowPreview(params)

    expect(preview.approvedCount).toBe(1)
    expect(preview.totalApprovers).toBe(2)
    expect(preview.additionalApprovers).toHaveLength(3)
  })

  it('counts signed signatories', async () => {
    const { repository, service } = buildService()
    repository.getSignatories.mockResolvedValue([
      {
        id: 's1',
        signatoryEmail: 'priya@nxtwave.co.in',
        recipientType: 'INTERNAL',
        routingOrder: 1,
        fieldConfig: [],
        status: 'SIGNED',
        signedAt: '2026-07-14T00:00:00.000Z',
        zohoSignEnvelopeId: 'env-1',
        zohoSignRecipientId: 'rec-1',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 's2',
        signatoryEmail: 'cfo@acme.com',
        recipientType: 'EXTERNAL',
        routingOrder: 2,
        fieldConfig: [],
        status: 'PENDING',
        signedAt: null,
        zohoSignEnvelopeId: 'env-1',
        zohoSignRecipientId: 'rec-2',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
    ])

    const preview = await service.getContractRowPreview(params)

    expect(preview.signedCount).toBe(1)
    expect(preview.totalSigners).toBe(2)
    expect(preview.signatories[0].email).toBe('priya@nxtwave.co.in')
  })

  it('maps counterparty names in sequence order', async () => {
    const { repository, service } = buildService()
    repository.getCounterparties.mockResolvedValue([
      { id: 'c1', counterpartyName: 'Acme Corp', sequenceOrder: 1 },
      { id: 'c2', counterpartyName: 'Beta Ltd', sequenceOrder: 2 },
    ])

    const preview = await service.getContractRowPreview(params)

    expect(preview.counterparties).toEqual(['Acme Corp', 'Beta Ltd'])
  })

  it('maps the latest timeline event', async () => {
    const { repository, service } = buildService()
    repository.getTimeline.mockResolvedValue([
      {
        id: 't1',
        eventType: 'NOTIFICATION',
        action: 'Reminder sent',
        userId: 'user-1',
        actorEmail: 'system@nxtwave.co.in',
        createdAt: '2026-07-20T10:00:00.000Z',
      },
    ])

    const preview = await service.getContractRowPreview(params)

    expect(preview.latestActivity).toEqual({
      action: 'Reminder sent',
      actorEmail: 'system@nxtwave.co.in',
      createdAt: '2026-07-20T10:00:00.000Z',
    })
  })
})
```

`NotFoundError` coverage for a missing contract is intentionally omitted here — it is identical to the existing `getContractDetail` behavior and covered by the shared `getById` guard added in Step 3.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/core/domain/contracts/contract-query-service.test.ts -t "getContractRowPreview" --verbose`
Expected: FAIL — `service.getContractRowPreview is not a function`.

- [ ] **Step 3: Implement the service method**

In `src/core/domain/contracts/contract-query-service.ts`, add these imports to the existing type import from `./contract-query-repository`:

```typescript
ContractRowPreview,
ContractRowPreviewApprover,
ContractRowPreviewSigner,
```

Then add this method to `ContractQueryService`, immediately after `getContractDetail` (which ends around line 260):

```typescript
async getContractRowPreview(params: {
  tenantId: string
  contractId: string
  employeeId: string
  role?: string
}): Promise<ContractRowPreview> {
  const contract = await this.contractRepository.getById(params.tenantId, params.contractId)

  if (!contract) {
    throw new NotFoundError('Contract', params.contractId)
  }

  if (
    !(await this.contractRepository.canAccessContract({
      tenantId: params.tenantId,
      actorEmployeeId: params.employeeId,
      actorRole: params.role,
      contract,
    }))
  ) {
    throw new AuthorizationError('CONTRACT_READ_FORBIDDEN', 'You do not have access to this contract')
  }

  const [counterparties, additionalApprovers, signatories, timeline] = await Promise.all([
    this.contractRepository.getCounterparties(params.tenantId, params.contractId),
    this.contractRepository.getAdditionalApprovers(params.tenantId, params.contractId),
    this.contractRepository.getSignatories(params.tenantId, params.contractId),
    this.contractRepository.getTimeline(params.tenantId, params.contractId, 1),
  ])

  const poc = {
    name: contract.signatoryName?.trim() ?? '',
    designation: contract.signatoryDesignation?.trim() ?? '',
    email: contract.signatoryEmail?.trim() ?? '',
  }
  const hasPoc = poc.name.length > 0 || poc.designation.length > 0 || poc.email.length > 0

  const mappedApprovers: ContractRowPreviewApprover[] = additionalApprovers.map((approver) => ({
    email: approver.approverEmail,
    status: approver.status,
    approvedAt: approver.approvedAt,
    sequenceOrder: approver.sequenceOrder,
  }))

  const mappedSigners: ContractRowPreviewSigner[] = signatories.map((signatory) => ({
    email: signatory.signatoryEmail,
    status: signatory.status,
    signedAt: signatory.signedAt,
    routingOrder: signatory.routingOrder,
    recipientType: signatory.recipientType,
  }))

  const latestEvent = timeline.at(0) ?? null

  return {
    contractId: params.contractId,
    description: contract.backgroundOfRequest?.trim() || null,
    signatoryPoc: hasPoc ? poc : null,
    counterparties: [...counterparties]
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
      .map((counterparty) => counterparty.counterpartyName),
    hod: {
      name: contract.departmentHodName ?? null,
      approvedAt: contract.hodApprovedAt ?? null,
    },
    additionalApprovers: mappedApprovers,
    signatories: mappedSigners,
    approvedCount: mappedApprovers.filter((approver) => approver.status === 'APPROVED').length,
    totalApprovers: mappedApprovers.filter((approver) => approver.status !== 'SKIPPED').length,
    signedCount: mappedSigners.filter((signer) => signer.status === 'SIGNED').length,
    totalSigners: mappedSigners.length,
    latestActivity: latestEvent
      ? {
          action: latestEvent.action,
          actorEmail: latestEvent.actorEmail ?? null,
          createdAt: latestEvent.createdAt,
        }
      : null,
  }
}
```

`NotFoundError` and `AuthorizationError` are already imported in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/core/domain/contracts/contract-query-service.test.ts -t "getContractRowPreview" --verbose`
Expected: PASS, 10 tests.

Then run the whole file to confirm nothing regressed:
Run: `npx jest src/core/domain/contracts/contract-query-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Ready to commit**

Report changed files. Do not run git.

---

## Task 3: API Route

**Files:**
- Modify: `src/core/config/route-registry.ts:59`
- Create: `src/app/api/contracts/[contractId]/summary/route.ts`

- [ ] **Step 1: Register the route**

In `src/core/config/route-registry.ts`, add directly below the `preview` entry (line 59):

```typescript
      summary: '/api/contracts/:contractId/summary',
```

Named `summary` because `preview` is already taken by document preview.

- [ ] **Step 2: Create the handler**

Create `src/app/api/contracts/[contractId]/summary/route.ts`. This mirrors `src/app/api/contracts/[contractId]/route.ts` exactly, differing only in the service call:

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractQueryService } from '@/core/registry/service-registry'

const GETHandler = withAuth(async (_request: NextRequest, { session, params }) => {
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    const tenantId = session.tenantId
    const contractId = params?.contractId

    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    const contractQueryService = getContractQueryService()
    const preview = await contractQueryService.getContractRowPreview({
      tenantId,
      contractId,
      employeeId: session.employeeId,
      role: session.role,
    })

    return NextResponse.json(okResponse({ preview }))
  } catch (error) {
    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to fetch contract summary'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
```

- [ ] **Step 3: Verify types and lint**

Run: `npm run type-check`
Expected: exit code 0.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Ready to commit**

Report changed files. Do not run git.

---

## Task 4: Client Method With Abort Support

**Files:**
- Modify: `src/core/client/contracts-client.ts`

**Why this does not use `fetchGetJson`.** That helper (line 499) accepts no `AbortSignal` and dedupes in-flight GETs in a shared `Map` keyed by URL. Aborting a shared promise would cancel it for every caller. `summary()` therefore issues its own `fetch` and skips the dedupe cache. Hover requests are already deduped by the hook's own cache, so nothing is lost.

- [ ] **Step 1: Export the preview types**

Near the top of `src/core/client/contracts-client.ts`, add to the existing type imports from `@/core/domain/contracts/contract-query-repository`:

```typescript
import type { ContractRowPreview } from '@/core/domain/contracts/contract-query-repository'
```

If that module is not yet imported in this file, add the import statement above. Then add `ContractRowPreview` to the type re-export list at the bottom of the file (the block starting around line 1627 that already re-exports `ContractRecord`).

- [ ] **Step 2: Add the client method**

Add to the `contractsClient` object, directly after the existing `timeline` method (around line 883):

```typescript
  async summary(
    contractId: string,
    options?: { signal?: AbortSignal }
  ): Promise<ApiResponse<{ preview: ContractRowPreview }>> {
    const url = resolveContractPath(routeRegistry.api.contracts.summary, contractId)

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: options?.signal,
      })

      return (await response.json()) as ApiResponse<{ preview: ContractRowPreview }>
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      return networkErrorResponse<{ preview: ContractRowPreview }>()
    }
  },
```

The `AbortError` rethrow is essential. Without it, an aborted hover would be swallowed into `networkErrorResponse` and the card would flash a false "Couldn't load details" every time the pointer leaves a row early.

- [ ] **Step 3: Verify types**

Run: `npm run type-check`
Expected: exit code 0.

- [ ] **Step 4: Ready to commit**

Report changed file. Do not run git.

---

## Task 5: `useContractRowPreview` Hook

**Files:**
- Create: `src/modules/contracts/ui/useContractRowPreview.ts`
- Test: `src/modules/contracts/ui/useContractRowPreview.test.tsx`

The hook owns the dwell timer, fetch, cache, and abort. It knows nothing about rendering.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/contracts/ui/useContractRowPreview.test.tsx`:

```tsx
/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { useContractRowPreview } from '@/modules/contracts/ui/useContractRowPreview'
import { contractsClient, type ContractRowPreview } from '@/core/client/contracts-client'

jest.mock('@/core/client/contracts-client', () => ({
  contractsClient: { summary: jest.fn() },
}))

const summaryMock = contractsClient.summary as jest.Mock

const makePreview = (overrides: Partial<ContractRowPreview> = {}): ContractRowPreview => ({
  contractId: 'contract-1',
  description: 'Office fitout contract',
  signatoryPoc: { name: 'John Doe', designation: 'Manager', email: 'john@nxtwave.co.in' },
  counterparties: ['Acme Corp'],
  hod: { name: 'Bala Bhaskar', approvedAt: '2026-07-05T00:00:00.000Z' },
  additionalApprovers: [],
  signatories: [],
  approvedCount: 0,
  totalApprovers: 0,
  signedCount: 0,
  totalSigners: 0,
  latestActivity: null,
  ...overrides,
})

beforeEach(() => {
  jest.useFakeTimers()
  summaryMock.mockReset()
  summaryMock.mockResolvedValue({ ok: true, data: { preview: makePreview() } })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('useContractRowPreview', () => {
  it('does not fetch when the pointer leaves before the dwell delay', () => {
    const { result } = renderHook(() => useContractRowPreview())

    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
    })
    act(() => {
      jest.advanceTimersByTime(200)
    })
    act(() => {
      result.current.onRowLeave()
    })
    act(() => {
      jest.advanceTimersByTime(1000)
    })

    expect(summaryMock).not.toHaveBeenCalled()
    expect(result.current.activeContractId).toBeNull()
  })

  it('fetches once the dwell delay elapses', async () => {
    const { result } = renderHook(() => useContractRowPreview())

    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
    })
    act(() => {
      jest.advanceTimersByTime(400)
    })

    expect(summaryMock).toHaveBeenCalledWith('contract-1', expect.anything())
    await waitFor(() => expect(result.current.state).toBe('ready'))
  })

  it('reuses the cache and does not refetch for the same contract and updatedAt', async () => {
    const { result } = renderHook(() => useContractRowPreview())

    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
    })
    act(() => {
      jest.advanceTimersByTime(400)
    })
    await waitFor(() => expect(result.current.state).toBe('ready'))

    act(() => {
      result.current.onRowLeave()
      jest.advanceTimersByTime(200)
    })
    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })

    expect(summaryMock).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('ready')
  })

  it('refetches when updatedAt changes for the same contract', async () => {
    const { result } = renderHook(() => useContractRowPreview())

    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })
    await waitFor(() => expect(result.current.state).toBe('ready'))

    act(() => {
      result.current.onRowLeave()
      jest.advanceTimersByTime(200)
    })
    act(() => {
      result.current.onRowEnter('contract-1', 'updated-2', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })

    expect(summaryMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache errors, so re-hovering retries', async () => {
    summaryMock.mockResolvedValue({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } })
    const { result } = renderHook(() => useContractRowPreview())

    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })
    await waitFor(() => expect(result.current.state).toBe('error'))

    act(() => {
      result.current.onRowLeave()
      jest.advanceTimersByTime(200)
    })
    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })

    expect(summaryMock).toHaveBeenCalledTimes(2)
  })

  it('maps a 403 response to the forbidden state', async () => {
    summaryMock.mockResolvedValue({
      ok: false,
      error: { code: 'CONTRACT_READ_FORBIDDEN', message: 'no access' },
    })
    const { result } = renderHook(() => useContractRowPreview())

    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })

    await waitFor(() => expect(result.current.state).toBe('forbidden'))
  })

  it('closes on the grace delay after the pointer leaves', async () => {
    const { result } = renderHook(() => useContractRowPreview())

    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })
    await waitFor(() => expect(result.current.state).toBe('ready'))

    act(() => {
      result.current.onRowLeave()
    })
    expect(result.current.activeContractId).toBe('contract-1')

    act(() => {
      jest.advanceTimersByTime(150)
    })
    expect(result.current.activeContractId).toBeNull()
  })

  it('ignores an aborted request instead of surfacing an error', async () => {
    summaryMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    const { result } = renderHook(() => useContractRowPreview())

    act(() => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })

    await waitFor(() => expect(summaryMock).toHaveBeenCalled())
    expect(result.current.state).not.toBe('error')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/contracts/ui/useContractRowPreview.test.tsx --verbose`
Expected: FAIL — cannot resolve `@/modules/contracts/ui/useContractRowPreview`.

- [ ] **Step 3: Implement the hook**

Create `src/modules/contracts/ui/useContractRowPreview.ts`:

```typescript
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { contractsClient, type ContractRowPreview } from '@/core/client/contracts-client'

export const HOVER_DWELL_MS = 400
export const HOVER_GRACE_MS = 150

export type ContractRowPreviewState = 'loading' | 'ready' | 'error' | 'forbidden'

export type RowPreviewAnchor = { clientX: number; clientY: number }

export function useContractRowPreview() {
  const [activeContractId, setActiveContractId] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<RowPreviewAnchor | null>(null)
  const [state, setState] = useState<ContractRowPreviewState>('loading')
  const [preview, setPreview] = useState<ContractRowPreview | null>(null)

  const cacheRef = useRef(new Map<string, ContractRowPreview>())
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const clearTimers = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current)
      dwellTimerRef.current = null
    }
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
    }
  }, [])

  const close = useCallback(() => {
    clearTimers()
    abortRef.current?.abort()
    abortRef.current = null
    setActiveContractId(null)
    setAnchor(null)
    setPreview(null)
    setState('loading')
  }, [clearTimers])

  const load = useCallback(async (contractId: string, cacheKey: string) => {
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setPreview(cached)
      setState('ready')
      return
    }

    setPreview(null)
    setState('loading')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await contractsClient.summary(contractId, { signal: controller.signal })

      if (controller.signal.aborted) return

      if (response.ok && response.data) {
        cacheRef.current.set(cacheKey, response.data.preview)
        setPreview(response.data.preview)
        setState('ready')
        return
      }

      setState(response.error?.code === 'CONTRACT_READ_FORBIDDEN' ? 'forbidden' : 'error')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setState('error')
    }
  }, [])

  const onRowEnter = useCallback(
    (contractId: string, updatedAt: string, nextAnchor: RowPreviewAnchor) => {
      clearTimers()

      dwellTimerRef.current = setTimeout(() => {
        setActiveContractId(contractId)
        setAnchor(nextAnchor)
        void load(contractId, `${contractId}:${updatedAt}`)
      }, HOVER_DWELL_MS)
    },
    [clearTimers, load]
  )

  const onRowLeave = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current)
      dwellTimerRef.current = null
    }

    graceTimerRef.current = setTimeout(close, HOVER_GRACE_MS)
  }, [close])

  const onCardEnter = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!activeContractId) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeContractId, close])

  useEffect(() => close, [close])

  return { activeContractId, anchor, state, preview, onRowEnter, onRowLeave, onCardEnter, close }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/contracts/ui/useContractRowPreview.test.tsx --verbose`
Expected: PASS, 8 tests.

- [ ] **Step 5: Ready to commit**

Report changed files. Do not run git.

---

## Task 6: `ContractRowPreviewCard` Component

**Files:**
- Create: `src/modules/contracts/ui/ContractRowPreviewCard.tsx`
- Test: `src/modules/contracts/ui/ContractRowPreviewCard.test.tsx`

Presentational only — no fetching. Signer display state ("signed" / "pending" / "queued") is derived here, because it is a display convention, not a stored value: `ContractSignatoryStatus` is only `PENDING | SIGNED`.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/contracts/ui/ContractRowPreviewCard.test.tsx`:

```tsx
/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import ContractRowPreviewCard from '@/modules/contracts/ui/ContractRowPreviewCard'
import type { ContractRowPreview } from '@/core/client/contracts-client'

const makePreview = (overrides: Partial<ContractRowPreview> = {}): ContractRowPreview => ({
  contractId: 'contract-1',
  description: 'Office fitout contract',
  signatoryPoc: { name: 'John Doe', designation: 'Manager', email: 'john@nxtwave.co.in' },
  counterparties: ['Acme Corp'],
  hod: { name: 'Bala Bhaskar', approvedAt: '2026-07-05T00:00:00.000Z' },
  additionalApprovers: [],
  signatories: [],
  approvedCount: 0,
  totalApprovers: 0,
  signedCount: 0,
  totalSigners: 0,
  latestActivity: null,
  ...overrides,
})

const baseProps = {
  id: 'row-preview-contract-1',
  title: 'Master Service Agreement',
  statusLabel: 'In Signature',
  tatLabel: '3d left',
  dateLine: 'Requested 02 Jul · Effective 01 Aug',
  anchor: { clientX: 100, clientY: 100 },
  state: 'ready' as const,
  onMouseEnter: jest.fn(),
  onMouseLeave: jest.fn(),
}

const makeSigner = (overrides: Partial<ContractRowPreview['signatories'][number]>) => ({
  email: 'signer@acme.com',
  status: 'PENDING' as const,
  signedAt: null,
  routingOrder: 1,
  recipientType: 'EXTERNAL' as const,
  ...overrides,
})

describe('ContractRowPreviewCard', () => {
  it('omits the approvers section when there are no approvers', () => {
    render(<ContractRowPreviewCard {...baseProps} preview={makePreview()} canSeeTat />)

    expect(screen.queryByText('APPROVERS')).not.toBeInTheDocument()
  })

  it('renders the approvers section with a count when approvers exist', () => {
    const preview = makePreview({
      additionalApprovers: [
        { email: 'anil@nxtwave.co.in', status: 'APPROVED', approvedAt: '2026-07-08T00:00:00.000Z', sequenceOrder: 1 },
        { email: 'meera@nxtwave.co.in', status: 'PENDING', approvedAt: null, sequenceOrder: 2 },
      ],
      approvedCount: 1,
      totalApprovers: 2,
    })

    render(<ContractRowPreviewCard {...baseProps} preview={preview} canSeeTat />)

    expect(screen.getByText('APPROVERS')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByText('anil@nxtwave.co.in')).toBeInTheDocument()
  })

  it('hides TAT when the viewer lacks permission', () => {
    render(<ContractRowPreviewCard {...baseProps} preview={makePreview()} canSeeTat={false} />)

    expect(screen.queryByText(/3d left/)).not.toBeInTheDocument()
  })

  it('shows TAT when the viewer has permission', () => {
    render(<ContractRowPreviewCard {...baseProps} preview={makePreview()} canSeeTat />)

    expect(screen.getByText(/3d left/)).toBeInTheDocument()
  })

  it('caps the signer list at five and shows a remainder count', () => {
    const signatories = Array.from({ length: 8 }, (_unused, index) =>
      makeSigner({ email: `signer${index}@acme.com`, routingOrder: index + 1 })
    )

    render(
      <ContractRowPreviewCard
        {...baseProps}
        preview={makePreview({ signatories, signedCount: 0, totalSigners: 8 })}
        canSeeTat
      />
    )

    expect(screen.getByText('signer0@acme.com')).toBeInTheDocument()
    expect(screen.queryByText('signer5@acme.com')).not.toBeInTheDocument()
    expect(screen.getByText('+3 more')).toBeInTheDocument()
  })

  it('labels the lowest-routing unsigned signer as pending and later ones as queued', () => {
    const signatories = [
      makeSigner({ email: 'signed@acme.com', status: 'SIGNED', signedAt: '2026-07-14T00:00:00.000Z', routingOrder: 1 }),
      makeSigner({ email: 'current@acme.com', routingOrder: 2 }),
      makeSigner({ email: 'later@acme.com', routingOrder: 3 }),
    ]

    render(
      <ContractRowPreviewCard
        {...baseProps}
        preview={makePreview({ signatories, signedCount: 1, totalSigners: 3 })}
        canSeeTat
      />
    )

    expect(screen.getByTestId('signer-status-current@acme.com')).toHaveTextContent('pending')
    expect(screen.getByTestId('signer-status-later@acme.com')).toHaveTextContent('queued')
  })

  it('renders skeletons while loading', () => {
    render(<ContractRowPreviewCard {...baseProps} state="loading" preview={null} canSeeTat />)

    expect(screen.getByTestId('row-preview-skeleton')).toBeInTheDocument()
    expect(screen.getByText('Master Service Agreement')).toBeInTheDocument()
  })

  it('renders an error message in the error state', () => {
    render(<ContractRowPreviewCard {...baseProps} state="error" preview={null} canSeeTat />)

    expect(screen.getByText("Couldn't load details")).toBeInTheDocument()
  })

  it('renders an access message in the forbidden state', () => {
    render(<ContractRowPreviewCard {...baseProps} state="forbidden" preview={null} canSeeTat />)

    expect(screen.getByText("You don't have access to this contract's details")).toBeInTheDocument()
  })

  it('omits the description block when there is no description', () => {
    render(<ContractRowPreviewCard {...baseProps} preview={makePreview({ description: null })} canSeeTat />)

    expect(screen.queryByTestId('row-preview-description')).not.toBeInTheDocument()
  })

  it('renders the compact date line and omits it when absent', () => {
    const { rerender } = render(<ContractRowPreviewCard {...baseProps} preview={makePreview()} canSeeTat />)
    expect(screen.getByTestId('row-preview-dates')).toHaveTextContent('Requested 02 Jul · Effective 01 Aug')

    rerender(<ContractRowPreviewCard {...baseProps} dateLine={null} preview={makePreview()} canSeeTat />)
    expect(screen.queryByTestId('row-preview-dates')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/contracts/ui/ContractRowPreviewCard.test.tsx --verbose`
Expected: FAIL — cannot resolve `@/modules/contracts/ui/ContractRowPreviewCard`.

- [ ] **Step 3: Implement the card**

Create `src/modules/contracts/ui/ContractRowPreviewCard.tsx`:

```tsx
'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import type { ContractRowPreview } from '@/core/client/contracts-client'
import type { ContractRowPreviewState, RowPreviewAnchor } from './useContractRowPreview'
import styles from './RepositoryWorkspace.module.css'

const CARD_WIDTH = 360
const EDGE_GAP = 20
const MAX_LIST_ITEMS = 5

export type ContractRowPreviewCardProps = {
  id: string
  title: string
  statusLabel: string
  tatLabel: string | null
  dateLine: string | null
  canSeeTat: boolean
  anchor: RowPreviewAnchor
  state: ContractRowPreviewState
  preview: ContractRowPreview | null
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' })

function formatDate(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : dateFormatter.format(parsed)
}

function resolveSignerLabel(
  signer: ContractRowPreview['signatories'][number],
  activeRoutingOrder: number | null
): string {
  if (signer.status === 'SIGNED') {
    const signedOn = formatDate(signer.signedAt)
    return signedOn ? `signed ${signedOn}` : 'signed'
  }

  if (activeRoutingOrder !== null && signer.routingOrder > activeRoutingOrder) return 'queued'
  return 'pending'
}

function resolveApproverLabel(approver: ContractRowPreview['additionalApprovers'][number]): string {
  if (approver.status === 'APPROVED') {
    const approvedOn = formatDate(approver.approvedAt)
    return approvedOn ? `approved ${approvedOn}` : 'approved'
  }
  return approver.status.toLowerCase()
}

export default function ContractRowPreviewCard({
  id,
  title,
  statusLabel,
  tatLabel,
  dateLine,
  canSeeTat,
  anchor,
  state,
  preview,
  onMouseEnter,
  onMouseLeave,
}: ContractRowPreviewCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: anchor.clientX + EDGE_GAP, top: anchor.clientY })

  useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight ?? 0
    const flipsLeft = anchor.clientX + CARD_WIDTH + EDGE_GAP > window.innerWidth
    const left = flipsLeft ? Math.max(EDGE_GAP, anchor.clientX - CARD_WIDTH - EDGE_GAP) : anchor.clientX + EDGE_GAP
    const maxTop = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP)
    const top = Math.min(Math.max(EDGE_GAP, anchor.clientY - 40), maxTop)

    setPosition({ left, top })
  }, [anchor, state, preview])

  const unsignedOrders = (preview?.signatories ?? [])
    .filter((signer) => signer.status !== 'SIGNED')
    .map((signer) => signer.routingOrder)
  const activeRoutingOrder = unsignedOrders.length > 0 ? Math.min(...unsignedOrders) : null

  const visibleSigners = (preview?.signatories ?? []).slice(0, MAX_LIST_ITEMS)
  const hiddenSignerCount = (preview?.signatories.length ?? 0) - visibleSigners.length
  const visibleApprovers = (preview?.additionalApprovers ?? []).slice(0, MAX_LIST_ITEMS)
  const hiddenApproverCount = (preview?.additionalApprovers.length ?? 0) - visibleApprovers.length

  return (
    <div
      ref={cardRef}
      id={id}
      role="tooltip"
      className={styles.rowPreviewCard}
      style={{ left: position.left, top: position.top, width: CARD_WIDTH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.rowPreviewHeader}>
        <p className={styles.rowPreviewTitle}>{title}</p>
        {preview && preview.counterparties.length > 0 ? (
          <p className={styles.rowPreviewCounterparties}>{preview.counterparties.join(', ')}</p>
        ) : null}
        <div className={styles.rowPreviewHeaderMeta}>
          <span>{statusLabel}</span>
          {canSeeTat && tatLabel ? <span className={styles.rowPreviewTat}>{tatLabel}</span> : null}
        </div>
      </div>

      {state === 'loading' ? (
        <div className={styles.rowPreviewSkeletonGroup} data-testid="row-preview-skeleton">
          <span className={styles.rowPreviewSkeletonLine} />
          <span className={styles.rowPreviewSkeletonLine} />
          <span className={styles.rowPreviewSkeletonLine} />
        </div>
      ) : null}

      {state === 'error' ? <p className={styles.rowPreviewMessage}>Couldn&apos;t load details</p> : null}

      {state === 'forbidden' ? (
        <p className={styles.rowPreviewMessage}>You don&apos;t have access to this contract&apos;s details</p>
      ) : null}

      {state === 'ready' && preview ? (
        <>
          {preview.description ? (
            <p className={styles.rowPreviewDescription} data-testid="row-preview-description">
              {preview.description}
            </p>
          ) : null}

          {preview.signatoryPoc || preview.hod.name ? (
            <div className={styles.rowPreviewPeople}>
              {preview.signatoryPoc ? (
                <div className={styles.rowPreviewPersonRow}>
                  <span className={styles.rowPreviewPersonLabel}>POC</span>
                  <span>
                    {[preview.signatoryPoc.name, preview.signatoryPoc.designation].filter(Boolean).join(' · ')}
                    {preview.signatoryPoc.email ? (
                      <span className={styles.rowPreviewPersonEmail}>{preview.signatoryPoc.email}</span>
                    ) : null}
                  </span>
                </div>
              ) : null}
              {preview.hod.name ? (
                <div className={styles.rowPreviewPersonRow}>
                  <span className={styles.rowPreviewPersonLabel}>HOD</span>
                  <span>
                    {preview.hod.name}
                    {preview.hod.approvedAt ? (
                      <span className={styles.rowPreviewPersonMeta}>approved {formatDate(preview.hod.approvedAt)}</span>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {preview.additionalApprovers.length > 0 ? (
            <div className={styles.rowPreviewSection}>
              <div className={styles.rowPreviewSectionHead}>
                <span>APPROVERS</span>
                <span>{`${preview.approvedCount} of ${preview.totalApprovers}`}</span>
              </div>
              {visibleApprovers.map((approver) => (
                <div key={approver.email} className={styles.rowPreviewListRow}>
                  <span>{approver.email}</span>
                  <span className={styles.rowPreviewListMeta}>{resolveApproverLabel(approver)}</span>
                </div>
              ))}
              {hiddenApproverCount > 0 ? (
                <p className={styles.rowPreviewMore}>{`+${hiddenApproverCount} more`}</p>
              ) : null}
            </div>
          ) : null}

          {preview.signatories.length > 0 ? (
            <div className={styles.rowPreviewSection}>
              <div className={styles.rowPreviewSectionHead}>
                <span>SIGNERS</span>
                <span>{`${preview.signedCount} of ${preview.totalSigners}`}</span>
              </div>
              {visibleSigners.map((signer) => (
                <div key={signer.email} className={styles.rowPreviewListRow}>
                  <span>{signer.email}</span>
                  <span className={styles.rowPreviewListMeta} data-testid={`signer-status-${signer.email}`}>
                    {resolveSignerLabel(signer, activeRoutingOrder)}
                  </span>
                </div>
              ))}
              {hiddenSignerCount > 0 ? <p className={styles.rowPreviewMore}>{`+${hiddenSignerCount} more`}</p> : null}
            </div>
          ) : null}

          {dateLine || preview.latestActivity ? (
            <div className={styles.rowPreviewActivity}>
              {dateLine ? <p className={styles.rowPreviewDateLine} data-testid="row-preview-dates">{dateLine}</p> : null}
              {preview.latestActivity ? (
                <p className={styles.rowPreviewDateLine}>
                  {preview.latestActivity.action}
                  {preview.latestActivity.actorEmail ? ` · ${preview.latestActivity.actorEmail}` : ''}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/contracts/ui/ContractRowPreviewCard.test.tsx --verbose`
Expected: PASS, 11 tests.

- [ ] **Step 5: Ready to commit**

Report changed files. Do not run git.

---

## Task 7: Wire Into The Table

**Files:**
- Modify: `src/modules/contracts/ui/RepositoryWorkspaceTable.tsx`
- Modify: `src/modules/contracts/ui/RepositoryWorkspace.module.css`
- Modify: `src/modules/contracts/ui/RepositoryWorkspace.tsx:1618-1623`

- [ ] **Step 1: Add card styles**

Append to `src/modules/contracts/ui/RepositoryWorkspace.module.css`:

```css
.rowPreviewCard {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border-subtle, #e2e8f0);
  border-radius: 10px;
  background: var(--surface-elevated, #ffffff);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary, #0f172a);
  pointer-events: auto;
  animation: rowPreviewFade 120ms ease-out;
}

@keyframes rowPreviewFade {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .rowPreviewCard {
    animation: none;
  }
}

.rowPreviewHeader {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle, #e2e8f0);
}

.rowPreviewTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.rowPreviewCounterparties {
  margin: 0;
  color: var(--text-secondary, #64748b);
}

.rowPreviewHeaderMeta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  font-weight: 500;
}

.rowPreviewTat {
  color: var(--text-secondary, #64748b);
}

.rowPreviewDescription {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-secondary, #475569);
}

.rowPreviewPeople,
.rowPreviewSection {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle, #e2e8f0);
}

.rowPreviewPersonRow {
  display: flex;
  gap: 10px;
}

.rowPreviewPersonLabel {
  min-width: 34px;
  color: var(--text-secondary, #94a3b8);
  font-weight: 600;
}

.rowPreviewPersonEmail,
.rowPreviewPersonMeta {
  display: block;
  color: var(--text-secondary, #64748b);
}

.rowPreviewSectionHead {
  display: flex;
  justify-content: space-between;
  color: var(--text-secondary, #94a3b8);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.rowPreviewListRow {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.rowPreviewListMeta {
  flex-shrink: 0;
  color: var(--text-secondary, #64748b);
}

.rowPreviewMore,
.rowPreviewActivity,
.rowPreviewMessage {
  margin: 0;
  color: var(--text-secondary, #64748b);
}

.rowPreviewActivity {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle, #e2e8f0);
}

.rowPreviewDateLine {
  margin: 0;
  color: var(--text-secondary, #64748b);
}

.rowPreviewSkeletonGroup {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rowPreviewSkeletonLine {
  height: 10px;
  border-radius: 4px;
  background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  animation: rowPreviewShimmer 1.2s infinite;
}

.rowPreviewSkeletonLine:nth-child(2) {
  width: 80%;
}

.rowPreviewSkeletonLine:nth-child(3) {
  width: 60%;
}

@keyframes rowPreviewShimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rowPreviewSkeletonLine {
    animation: none;
  }
}
```

If this stylesheet already defines matching design tokens for surfaces and borders, prefer those over the fallback literals above.

- [ ] **Step 2: Wire the table**

In `src/modules/contracts/ui/RepositoryWorkspaceTable.tsx`:

Add imports at the top:

```typescript
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import ContractRowPreviewCard from './ContractRowPreviewCard'
import { useContractRowPreview } from './useContractRowPreview'
```

Add two props to `RepositoryWorkspaceTableProps`:

```typescript
  suppressRowPreview?: boolean
  resolveTatLabel?: (contract: ContractRecord) => string | null
```

Inside the component, after the `useReactTable` call:

```typescript
  const rowPreview = useContractRowPreview()
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => setIsMounted(true), [])

  const activeRow = rowPreview.activeContractId
    ? contracts.find((contract) => contract.id === rowPreview.activeContractId)
    : undefined
```

`isMounted` gates the portal so server rendering never touches `document`.

Add a helper above the component, so hovering a button or the assignment control inside a row does not open the card over the affordance the user is reaching for:

```typescript
const PREVIEW_SUPPRESSING_SELECTOR = 'button, a, input, select, textarea, [role="button"]'

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PREVIEW_SUPPRESSING_SELECTOR) !== null
}
```

Add handlers to the `<tr>` (keeping the existing `onClick` exactly as it is):

```tsx
              tabIndex={0}
              aria-describedby={
                rowPreview.activeContractId === row.original.id ? `row-preview-${row.original.id}` : undefined
              }
              onMouseEnter={(event) => {
                if (suppressRowPreview || isInteractiveTarget(event.target)) return
                rowPreview.onRowEnter(row.original.id, row.original.updatedAt, {
                  clientX: event.clientX,
                  clientY: event.clientY,
                })
              }}
              onMouseLeave={() => rowPreview.onRowLeave()}
              onFocus={(event) => {
                if (suppressRowPreview) return
                const bounds = event.currentTarget.getBoundingClientRect()
                rowPreview.onRowEnter(row.original.id, row.original.updatedAt, {
                  clientX: bounds.right,
                  clientY: bounds.top,
                })
              }}
              onBlur={() => rowPreview.onRowLeave()}
```

`tabIndex={0}` makes rows reachable by keyboard, which is what allows `onFocus` to open the card. Focus anchors the card to the row's right edge rather than a pointer position, since there is no cursor in a keyboard flow.

Render the portal just before the closing `</table>`'s parent return — wrap the returned `<table>` in a fragment:

```tsx
      {isMounted && rowPreview.activeContractId && activeRow && rowPreview.anchor
        ? createPortal(
            <ContractRowPreviewCard
              id={`row-preview-${activeRow.id}`}
              title={activeRow.title}
              statusLabel={activeRow.repositoryStatusLabel ?? activeRow.displayStatusLabel ?? activeRow.status}
              tatLabel={resolveTatLabel?.(activeRow) ?? null}
              dateLine={buildDateLine(activeRow)}
              canSeeTat={canSeeTatAndAging}
              anchor={rowPreview.anchor}
              state={rowPreview.state}
              preview={rowPreview.preview}
              onMouseEnter={rowPreview.onCardEnter}
              onMouseLeave={rowPreview.onRowLeave}
            />,
            document.body
          )
        : null}
```

Add `buildDateLine` above the component. It uses only data already present in the row, so no extra fetch is involved:

```typescript
const rowDateFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' })

function formatRowDate(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : rowDateFormatter.format(parsed)
}

function buildDateLine(contract: ContractRecord): string | null {
  const requested = formatRowDate(contract.requestCreatedAt ?? contract.createdAt)
  const effective = formatRowDate(contract.legalEffectiveDate)
  const ends = formatRowDate(contract.legalTerminationDate)

  const parts = [
    requested === null ? null : `Requested ${requested}`,
    effective === null ? null : `Effective ${effective}`,
    ends === null ? null : `Ends ${ends}`,
  ].filter((part): part is string => part !== null)

  return parts.length > 0 ? parts.join(' · ') : null
}
```

The existing `isLoading` early-return already prevents cards over shimmer rows, since the handlers are never rendered in that branch.

- [ ] **Step 3: Pass suppression from the workspace**

In `src/modules/contracts/ui/RepositoryWorkspace.tsx`, on the `<RepositoryWorkspaceTable ...>` element (line ~1618), add:

```tsx
              suppressRowPreview={openAssignmentDropdownContractId !== null}
```

This stops the card from covering the assignment dropdown the user is actively operating. Confirm the exact variable name and its "closed" value by reading its `useState` declaration in this file first; if it is `undefined` rather than `null` when closed, use `Boolean(openAssignmentDropdownContractId)`.

- [ ] **Step 4: Verify the suite**

Run: `npm run type-check`
Expected: exit code 0.

Run: `npx jest src/modules/contracts/ui --verbose`
Expected: PASS, including the pre-existing `assignment-workflow.integration.test.tsx` and `contract-actions.integration.test.tsx`.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Ready to commit**

Report changed files. Do not run git.

---

## Task 8: End-To-End Coverage

**Files:**
- Modify: `tests/e2e/repository-and-export.spec.ts`

- [ ] **Step 1: Read the existing spec**

Open `tests/e2e/repository-and-export.spec.ts` and identify the existing login/navigation helper and the selector used for repository rows. Reuse them rather than writing new setup.

- [ ] **Step 2: Add the hover test**

Append inside the existing top-level `describe`, adapting `page.goto` and login to match the helpers found in Step 1:

```typescript
test('shows a preview card when hovering a contract row', async ({ page }) => {
  await page.goto('/repository')

  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toBeVisible()

  await firstRow.hover()

  const card = page.getByRole('tooltip')
  await expect(card).toBeVisible({ timeout: 5000 })

  await page.mouse.move(0, 0)
  await expect(card).toBeHidden()
})
```

- [ ] **Step 3: Run the E2E test**

Run: `npx playwright test tests/e2e/repository-and-export.spec.ts --grep "preview card"`
Expected: PASS.

If the environment lacks E2E credentials, record that this test is written but unverified — do not claim it passes.

- [ ] **Step 4: Full verification**

Run: `npm test`
Expected: PASS, coverage thresholds (70% branches/functions/lines/statements) still met.

Run: `npm run type-check`
Expected: exit code 0.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Ready to commit**

Report all changed files across every task. Do not run git.

---

## Verification Checklist

Confirm by running commands, not by inspection:

- [ ] `npm test` passes
- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` reports no new errors
- [ ] Hovering a row for under 400ms fires no network request (Network tab, filter `summary`)
- [ ] Hovering a row for over 400ms opens the card and fires exactly one request
- [ ] Re-hovering the same row fires no second request
- [ ] Card flips to the left of the pointer near the right viewport edge
- [ ] TAT is absent from the card for a non-legal role
- [ ] A contract with no approvers shows no APPROVERS section
- [ ] `Esc` closes the card
- [ ] Tabbing to a row opens the card; tabbing away closes it
- [ ] The card does not appear while an assignment dropdown is open
- [ ] Hovering the contract-title button or assignment control does not open the card
- [ ] The compact date line renders (Requested / Effective / Ends)
- [ ] Clicking a row still opens the contract; ctrl/cmd-click still opens a new tab
