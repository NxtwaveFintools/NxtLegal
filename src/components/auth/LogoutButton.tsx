'use client'

import { useRouter } from 'next/navigation'
import { authClient } from '@/core/client/auth-client'
import { routeRegistry } from '@/core/config/route-registry'

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
    <button
      onClick={handleLogout}
      className="bg-gray-900 text-white px-4 py-2 rounded hover:bg-gray-800 transition-colors font-medium"
    >
      Logout
    </button>
  )
}
