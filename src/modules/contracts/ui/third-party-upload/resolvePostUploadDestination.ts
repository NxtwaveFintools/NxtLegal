import { contractWorkflowRoles } from '@/core/constants/contracts'

/**
 * Legal team members are taken straight to the contract they just uploaded.
 * Everyone else returns to the dashboard, as before.
 *
 * Deliberately narrower than the `isLegalActor` check in the sidebar, which
 * also matches ADMIN.
 */
export function resolvePostUploadDestination(params: { actorRole?: string; contractId: string }): string {
  return params.actorRole === contractWorkflowRoles.legalTeam ? `/contracts/${params.contractId}` : '/dashboard'
}
