'use client'

import { useRouter } from 'next/navigation'
import { authClient } from '@/core/client/auth-client'
import { routeRegistry } from '@/core/config/route-registry'
import styles from './LogoutButton.module.css'

export default function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    try {
      const response = await authClient.logout()

      if (response.ok) {
        router.push(routeRegistry.public.login)
        router.refresh()
      }
    } catch {
      // Logout error handled silently - user will see they're not logged out
    }
  }

  return (
    <button onClick={handleLogout} className={styles.button}>
      Logout
    </button>
  )
}
