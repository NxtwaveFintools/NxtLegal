import { getAuthenticatedEmployeeViewWithApproverHistoryAccess } from '@/core/presenters/auth-presenter'
import ProtectedAppShell from '@/modules/dashboard/ui/ProtectedAppShell'
import ContractsWorkspace from '@/modules/contracts/ui/ContractsWorkspace'

type ContractDetailPageProps = {
  params: Promise<{ contractId: string }>
  searchParams: Promise<{ from?: string }>
}

export default async function ContractDetailPage({ params, searchParams }: ContractDetailPageProps) {
  const [session, resolvedParams, resolvedSearch] = await Promise.all([
    getAuthenticatedEmployeeViewWithApproverHistoryAccess(),
    params,
    searchParams,
  ])

  const activeNav = resolvedSearch.from === 'dashboard' ? 'home' : 'repository'

  return (
    <ProtectedAppShell
      session={{ fullName: session.fullName, email: session.email, team: session.team, role: session.role }}
      activeNav={activeNav}
      canAccessApproverHistory={session.canAccessApproverHistory}
    >
      <ContractsWorkspace
        session={{
          employeeId: session.employeeId,
          role: session.role,
        }}
        initialContractId={resolvedParams.contractId}
      />
    </ProtectedAppShell>
  )
}
