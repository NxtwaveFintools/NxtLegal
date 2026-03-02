import { getAuthenticatedEmployeeView } from '@/core/presenters/auth-presenter'
import ContractsWorkspace from '@/modules/contracts/ui/ContractsWorkspace'

export default async function ContractsPage() {
  const session = await getAuthenticatedEmployeeView()

  return <ContractsWorkspace session={{ employeeId: session.employeeId, role: session.role }} />
}
