'use client'

import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import LogoutButton from '@/components/auth/LogoutButton'
import ThemeToggle from '@/components/theme/ThemeToggle'
import { routeRegistry } from '@/core/config/route-registry'
import styles from './dashboard.module.css'

type ProtectedAppShellProps = {
  session: {
    fullName?: string | null
  }
  activeNav: 'home' | 'repository'
  children: ReactNode
}

export default function ProtectedAppShell({ session, activeNav, children }: ProtectedAppShellProps) {
  const router = useRouter()

  const displayName = useMemo(() => {
    if (!session.fullName) {
      return 'there'
    }

    return session.fullName.split(' ')[0] || session.fullName
  }, [session.fullName])

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>N</div>
        <div className={styles.navList}>
          <button
            type="button"
            className={`${styles.navItem} ${activeNav === 'home' ? styles.navItemActive : ''}`}
            aria-label="Home"
            onClick={() => router.push(routeRegistry.protected.dashboard)}
          >
            <span className={styles.navIcon}>H</span>
          </button>
          <button
            type="button"
            className={`${styles.navItem} ${activeNav === 'repository' ? styles.navItemActive : ''}`}
            aria-label="Repository"
            onClick={() => router.push(routeRegistry.protected.repository)}
          >
            <span className={styles.navIcon}>R</span>
          </button>
          <button type="button" className={styles.navItem} aria-label="Manage">
            <span className={styles.navIcon}>M</span>
          </button>
          <button type="button" className={styles.navItem} aria-label="Analytics">
            <span className={styles.navIcon}>A</span>
          </button>
        </div>
        <div className={styles.bottomNav}>
          <button type="button" className={styles.navItem} aria-label="Settings">
            <span className={styles.navIcon}>S</span>
          </button>
          <button type="button" className={styles.navItem} aria-label="Chat">
            <span className={styles.navIcon}>C</span>
          </button>
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <div className={styles.searchBar}>
              <span>Search</span>
              <input type="text" className={styles.searchInput} placeholder="Shortcuts" aria-label="Search shortcuts" />
              <span>Ctrl+K</span>
            </div>
          </div>
          <div className={styles.topbarRight}>
            <ThemeToggle />
            <span className={styles.companyBadge}>NxtWave Disruptive Technologies Private Limited</span>
            <div className={styles.profileBadge}>{displayName.slice(0, 1).toUpperCase()}</div>
            <LogoutButton />
          </div>
        </header>

        {children}
      </div>
    </div>
  )
}
