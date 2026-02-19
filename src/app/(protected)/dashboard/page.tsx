import { getAuthenticatedEmployeeView } from '@/core/presenters/auth-presenter'
import DashboardClient from '@/modules/dashboard/ui/DashboardClient'

export default async function DashboardPage() {
  const session = await getAuthenticatedEmployeeView()
  return <DashboardClient session={session} />
}
