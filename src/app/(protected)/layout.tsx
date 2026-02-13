import { requireAuthenticatedUser } from '@/core/domain/auth/guards/route-guard'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  await requireAuthenticatedUser()

  return <>{children}</>
}
