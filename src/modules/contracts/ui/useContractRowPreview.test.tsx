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
  counterparties: ['Acme Corp'],
  hodApprovedAt: '2026-07-05T00:00:00.000Z',
  additionalApprovers: [],
  signatories: [],
  approvedCount: 0,
  totalApprovers: 0,
  signedCount: 0,
  totalSigners: 0,
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
    await act(async () => {
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
    await act(async () => {
      jest.advanceTimersByTime(400)
    })
    await waitFor(() => expect(result.current.state).toBe('ready'))

    act(() => {
      result.current.onRowLeave()
      jest.advanceTimersByTime(200)
    })
    await act(async () => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })

    expect(summaryMock).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('ready')
  })

  it('refetches when updatedAt changes for the same contract', async () => {
    const { result } = renderHook(() => useContractRowPreview())

    await act(async () => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })
    await waitFor(() => expect(result.current.state).toBe('ready'))

    act(() => {
      result.current.onRowLeave()
      jest.advanceTimersByTime(200)
    })
    await act(async () => {
      result.current.onRowEnter('contract-1', 'updated-2', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })

    expect(summaryMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache errors, so re-hovering retries', async () => {
    summaryMock.mockResolvedValue({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } })
    const { result } = renderHook(() => useContractRowPreview())

    await act(async () => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })
    await waitFor(() => expect(result.current.state).toBe('error'))

    act(() => {
      result.current.onRowLeave()
      jest.advanceTimersByTime(200)
    })
    await act(async () => {
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

    await act(async () => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })

    await waitFor(() => expect(result.current.state).toBe('forbidden'))
  })

  it('closes on the grace delay after the pointer leaves', async () => {
    const { result } = renderHook(() => useContractRowPreview())

    await act(async () => {
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

    await act(async () => {
      result.current.onRowEnter('contract-1', 'updated-1', { clientX: 100, clientY: 100 })
      jest.advanceTimersByTime(400)
    })

    await waitFor(() => expect(summaryMock).toHaveBeenCalled())
    expect(result.current.state).not.toBe('error')
  })
})
