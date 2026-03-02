import { getAuthenticatedEmployeeViewWithApproverHistoryAccess } from '@/core/presenters/auth-presenter'
import DashboardClient from '@/modules/dashboard/ui/DashboardClient'

export default async function DashboardPage() {
  const session = await getAuthenticatedEmployeeViewWithApproverHistoryAccess()
  return <DashboardClient session={session} />
}
