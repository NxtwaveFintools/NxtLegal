'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { useFocusHotkey } from '@/lib/hooks/use-focus-hotkey'
import { routeRegistry } from '@/core/config/route-registry'
import styles from './dashboard.module.css'

// The platform never changes for the lifetime of the page, so there is nothing
// to subscribe to.
const neverChanges = () => () => {}

const getShortcutHint = () => (/mac|iphone|ipad|ipod/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K')

// The server cannot know the client platform. Returning an empty server
// snapshot keeps the first paint identical on both sides, then React swaps in
// the real hint after hydration — no mismatch warning.
const getServerShortcutHint = () => ''

export default function GlobalSearchBar() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')
  const shortcutHint = useSyncExternalStore(neverChanges, getShortcutHint, getServerShortcutHint)

  useFocusHotkey(inputRef)

  const submit = () => {
    const trimmed = term.trim()
    router.push(
      trimmed
        ? `${routeRegistry.protected.repository}?q=${encodeURIComponent(trimmed)}`
        : routeRegistry.protected.repository
    )
  }

  return (
    <div className={styles.globalSearch}>
      <svg viewBox="0 0 20 20" className={styles.globalSearchIcon} aria-hidden="true" focusable="false">
        <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="m13.2 13.2 3.3 3.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        className={styles.globalSearchInput}
        placeholder="Search contracts…"
        aria-label="Search contracts"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            submit()
            return
          }

          if (event.key === 'Escape') {
            setTerm('')
            event.currentTarget.blur()
          }
        }}
      />
      <span className={styles.globalSearchHint} aria-hidden="true">
        {shortcutHint}
      </span>
    </div>
  )
}
