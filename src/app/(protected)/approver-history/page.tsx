import { redirect } from 'next/navigation'
import { getAuthenticatedEmployeeViewWithApproverHistoryAccess } from '@/core/presenters/auth-presenter'
import { routeRegistry } from '@/core/config/route-registry'
import AdditionalApproverHistoryWorkspace from '@/modules/contracts/ui/AdditionalApproverHistoryWorkspace'

export default async function AdditionalApproverHistoryPage() {
  const session = await getAuthenticatedEmployeeViewWithApproverHistoryAccess()

  if (!session.canAccessApproverHistory) {
    redirect(routeRegistry.protected.dashboard)
  }

  return (
    <AdditionalApproverHistoryWorkspace
      session={{
        employeeId: session.employeeId,
        fullName: session.fullName,
        email: session.email,
        team: session.team,
        role: session.role,
        canAccessApproverHistory: session.canAccessApproverHistory,
      }}
    />
  )
}
