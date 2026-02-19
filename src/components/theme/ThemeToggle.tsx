'use client'

import { useEffect, useMemo, useState } from 'react'
import styles from './ThemeToggle.module.css'

const THEME_STORAGE_KEY = 'nxt-legal-theme'

type ThemeMode = 'light' | 'dark'

function getSystemTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'light'
    }

    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : getSystemTheme()
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const label = useMemo(() => (theme === 'dark' ? 'Dark' : 'Light'), [theme])

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      aria-pressed={theme === 'dark'}
    >
      <span className={styles.toggleLabel}>{label} Mode</span>
      <span className={styles.toggleTrack}>
        <span className={theme === 'dark' ? styles.toggleThumbDark : styles.toggleThumbLight} />
      </span>
    </button>
  )
}
