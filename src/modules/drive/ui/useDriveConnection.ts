'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { driveClient, type DriveConnectionStatus } from '@/core/client/drive-client'

const DISCONNECTED: DriveConnectionStatus = { connected: false, googleAccountEmail: null, lastFolder: null }

/**
 * Manages the per-user Google Drive connection: status fetch, OAuth via popup
 * (postMessage + closed-popup fallback), and disconnect.
 */
export function useDriveConnection() {
  const [status, setStatus] = useState<DriveConnectionStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const refresh = useCallback(async (): Promise<DriveConnectionStatus> => {
    setLoading(true)
    try {
      const res = await driveClient.getStatus()
      const next = res.ok && res.data ? res.data : DISCONNECTED
      setStatus(next)
      return next
    } finally {
      setLoading(false)
    }
  }, [])

  const connect = useCallback(async (): Promise<boolean> => {
    setConnecting(true)
    try {
      const returnPath = window.location.pathname + window.location.search
      const res = await driveClient.getConnectUrl(returnPath)
      if (!res.ok || !res.data) {
        toast.error(res.error?.message ?? 'Could not start Google sign-in')
        return false
      }

      const popup = window.open(res.data.authorizationUrl, 'nxtlegal-drive-oauth', 'width=520,height=660')
      if (!popup) {
        toast.error('Please allow pop-ups to connect Google Drive')
        return false
      }

      return await new Promise<boolean>((resolve) => {
        let settled = false
        const finish = (ok: boolean) => {
          if (settled) return
          settled = true
          window.removeEventListener('message', onMessage)
          window.clearInterval(interval)
          resolve(ok)
        }

        const onMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return
          const data = event.data as { type?: string; ok?: boolean } | null
          if (data && data.type === 'nxtlegal:drive-oauth') {
            if (data.ok) {
              void refresh()
              finish(true)
            } else {
              finish(false)
            }
          }
        }

        // Fallback: if the popup is closed without a message, verify via status.
        const interval = window.setInterval(() => {
          if (popup.closed) {
            void driveClient.getStatus().then((s) => {
              if (s.ok && s.data?.connected) {
                setStatus(s.data)
                finish(true)
              } else {
                finish(false)
              }
            })
          }
        }, 900)

        window.addEventListener('message', onMessage)
      })
    } finally {
      setConnecting(false)
    }
  }, [refresh])

  const disconnect = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    const res = await driveClient.disconnect()
    if (res.ok) {
      setStatus(DISCONNECTED)
      if (!options?.silent) toast.success('Google Drive disconnected')
      return true
    }
    if (!options?.silent) toast.error(res.error?.message ?? 'Failed to disconnect Google Drive')
    return false
  }, [])

  // Disconnect the current account (revoke + delete) then start a fresh OAuth
  // flow. `prompt=select_account` shows Google's account chooser.
  const switchAccount = useCallback(async (): Promise<boolean> => {
    await driveClient.disconnect()
    setStatus(DISCONNECTED)
    return connect()
  }, [connect])

  return { status, loading, connecting, refresh, connect, disconnect, switchAccount, setStatus }
}
