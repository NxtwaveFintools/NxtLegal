'use client'

import { useEffect, useRef, useState } from 'react'
import Spinner from '@/components/ui/Spinner'

type DocxPreviewProps = {
  url: string
  className?: string
}

/**
 * Renders a Word (.docx) document client-side with high visual fidelity using
 * docx-preview. Unlike the server-side mammoth conversion, this preserves the
 * document's original fonts, alignment, spacing, tables and images.
 */
export default function DocxPreview({ url, className }: DocxPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    setIsLoading(true)
    setError(null)

    const render = async () => {
      try {
        const response = await fetch(url, { credentials: 'include' })
        if (!response.ok) {
          throw new Error('Failed to load document')
        }

        const blob = await response.blob()
        if (cancelled) {
          return
        }

        const container = containerRef.current
        if (!container) {
          return
        }

        container.innerHTML = ''

        const { renderAsync } = await import('docx-preview')
        if (cancelled || !containerRef.current) {
          return
        }

        await renderAsync(blob, containerRef.current, undefined, {
          className: 'docx',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        })
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : 'Failed to render document')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void render()

    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <div
      className={className}
      style={{ position: 'relative', overflow: 'auto', height: '100%', background: '#9ca3af' }}
    >
      {isLoading ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: '#374151',
          }}
        >
          <Spinner size={16} />
          Rendering document…
        </div>
      ) : null}
      {error ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
            color: '#374151',
          }}
        >
          {error}. Try “Open in New Tab” instead.
        </div>
      ) : null}
      <div ref={containerRef} />
    </div>
  )
}
