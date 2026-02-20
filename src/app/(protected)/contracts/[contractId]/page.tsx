import { getAuthenticatedEmployeeView } from '@/core/presenters/auth-presenter'
import ContractsWorkspace from '@/modules/contracts/ui/ContractsWorkspace'

type ContractDetailPageProps = {
  params: Promise<{ contractId: string }>
}

export default async function ContractDetailPage({ params }: ContractDetailPageProps) {
  const session = await getAuthenticatedEmployeeView()
  const resolvedParams = await params

  return (
    <ContractsWorkspace
      session={{
        employeeId: session.employeeId,
        role: session.role,
      }}
      initialContractId={resolvedParams.contractId}
    />
  )
}
