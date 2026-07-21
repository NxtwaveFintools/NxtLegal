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
