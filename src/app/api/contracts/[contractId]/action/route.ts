import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import {
  getContractApprovalNotificationService,
  getContractQueryService,
  getIdempotencyService,
  getContractSignatoryService,
} from '@/core/registry/service-registry'
import { contractActionCommandSchema, bypassApprovalActionName } from '@/core/domain/contracts/schemas'
import { contractStatuses, contractWorkflowRoles } from '@/core/constants/contracts'
import { dispatchNotificationSafely } from '@/core/infra/notifications/dispatch-notification-safely'

const POSTHandler = withAuth(async (request: NextRequest, { session, params }) => {
  let shouldReleaseClaim = false
  const shouldLogPerformance = process.env.NODE_ENV !== 'production'
  const requestTimerLabel = `contract-action.total.${Date.now()}`
  if (shouldLogPerformance) {
    console.time(requestTimerLabel)
  }

  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    const tenantId = session.tenantId

    const contractId = params?.contractId

    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    const payload = contractActionCommandSchema.parse(await request.json())

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
    if (idempotencyKey) {
      const idempotencyClaimTimerLabel = `contract-action.idempotency-claim.${contractId}`
      if (shouldLogPerformance) {
        console.time(idempotencyClaimTimerLabel)
      }
      const idempotencyService = getIdempotencyService()
      const claimResult = await idempotencyService.claimOrGet(idempotencyKey, tenantId)
      if (shouldLogPerformance) {
        console.timeEnd(idempotencyClaimTimerLabel)
      }

      if (claimResult.status === 'cached') {
        return NextResponse.json(claimResult.record.responseData, { status: claimResult.record.statusCode })
      }

      if (claimResult.status === 'in-progress') {
        return NextResponse.json(
          errorResponse('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is already in progress'),
          { status: 409 }
        )
      }

      shouldReleaseClaim = true
    }

    const contractQueryService = getContractQueryService()

    let previousStatus: string | null = null
    const shouldCheckPreviousStatusForSigningExit =
      payload.action !== bypassApprovalActionName &&
      (session.role === contractWorkflowRoles.legalTeam || session.role === contractWorkflowRoles.admin)

    if (shouldCheckPreviousStatusForSigningExit) {
      const previousStatusTimerLabel = `contract-action.previous-status.${contractId}`
      if (shouldLogPerformance) {
        console.time(previousStatusTimerLabel)
      }
      const previousContractView = await contractQueryService.getContractDetail({
        tenantId,
        contractId,
        employeeId: session.employeeId,
        role: session.role,
      })
      previousStatus = previousContractView.contract.status
      if (shouldLogPerformance) {
        console.timeEnd(previousStatusTimerLabel)
      }
    }

    const applyActionTimerLabel = `contract-action.apply.${contractId}`
    if (shouldLogPerformance) {
      console.time(applyActionTimerLabel)
    }
    const contractView =
      payload.action === bypassApprovalActionName
        ? await (() => {
            if (session.role !== contractWorkflowRoles.legalTeam && session.role !== contractWorkflowRoles.admin) {
              return NextResponse.json(
                errorResponse('CONTRACT_ACTION_FORBIDDEN', 'Only LEGAL_TEAM or ADMIN can skip approvals'),
                { status: 403 }
              )
            }

            return contractQueryService.bypassAdditionalApprover({
              tenantId,
              contractId,
              approverId: payload.approverId,
              actorEmployeeId: session.employeeId,
              actorRole: session.role,
              actorEmail: session.email ?? '',
              reason: payload.reason,
            })
          })()
        : await contractQueryService.applyContractAction({
            tenantId,
            contractId,
            action: payload.action,
            actorEmployeeId: session.employeeId,
            actorRole: session.role,
            actorEmail: session.email ?? '',
            noteText: payload.noteText,
          })
    if (shouldLogPerformance) {
      console.timeEnd(applyActionTimerLabel)
    }

    if (contractView instanceof NextResponse) {
      return contractView
    }

    const contractApprovalNotificationService = getContractApprovalNotificationService()

    if (
      payload.action !== bypassApprovalActionName &&
      (payload.action === 'hod.approve' || payload.action === 'hod.bypass')
    ) {
      void dispatchNotificationSafely({
        dispatch: () =>
          contractApprovalNotificationService.notifyInternalAssignment({
            tenantId,
            contractId,
            actorEmployeeId: session.employeeId,
            actorRole: session.role,
            assignedEmail: contractView.contract.currentAssigneeEmail,
            contractTitle: contractView.contract.title,
          }),
        event: payload.action === 'hod.approve' ? 'HOD_APPROVED_ASSIGNMENT' : 'HOD_BYPASS_ASSIGNMENT',
        contractId,
      })

      if (payload.action === 'hod.approve') {
        void dispatchNotificationSafely({
          dispatch: () =>
            contractApprovalNotificationService.notifyPocOnHodDecision({
              tenantId,
              contractId,
              actorEmployeeId: session.employeeId,
              actorRole: session.role,
              pocEmail: contractView.contract.uploadedByEmail,
              decision: 'APPROVED',
              contractTitle: contractView.contract.title,
            }),
          event: 'HOD_APPROVED_POC',
          contractId,
        })
      }
    }

    if (payload.action !== bypassApprovalActionName && payload.action === 'approver.approve') {
      void dispatchNotificationSafely({
        dispatch: () =>
          contractApprovalNotificationService.notifyApprovalReceived({
            tenantId,
            contractId,
            actorEmployeeId: session.employeeId,
            actorRole: session.role,
            event: 'ADDITIONAL_APPROVED',
            legalOwnerEmail: contractView.contract.currentAssigneeEmail,
            contractTitle: contractView.contract.title,
          }),
        event: 'ADDITIONAL_APPROVED',
        contractId,
      })
    }

    if (payload.action !== bypassApprovalActionName && payload.action === 'legal.query.reroute') {
      void dispatchNotificationSafely({
        dispatch: () =>
          contractApprovalNotificationService.notifyReturnedToHod({
            tenantId,
            contractId,
            actorEmployeeId: session.employeeId,
            actorRole: session.role,
            hodEmail: contractView.contract.currentAssigneeEmail,
          }),
        event: 'REROUTED_TO_HOD',
        contractId,
      })
    }

    if (payload.action !== bypassApprovalActionName && payload.action === 'legal.reject') {
      void dispatchNotificationSafely({
        dispatch: () =>
          contractApprovalNotificationService.notifyContractRejected({
            tenantId,
            contractId,
            actorEmployeeId: session.employeeId,
            actorRole: session.role,
            recipientEmails: [
              contractView.contract.uploadedByEmail,
              contractView.contract.currentAssigneeEmail || contractView.contract.departmentHodEmail || '',
            ],
            trigger: 'LEGAL_REJECTION',
          }),
        event: 'LEGAL_REJECTION',
        contractId,
      })
    }

    if (payload.action !== bypassApprovalActionName && payload.action === 'hod.reject') {
      void dispatchNotificationSafely({
        dispatch: () =>
          contractApprovalNotificationService.notifyPocOnHodDecision({
            tenantId,
            contractId,
            actorEmployeeId: session.employeeId,
            actorRole: session.role,
            pocEmail: contractView.contract.uploadedByEmail,
            decision: 'REJECTED',
            contractTitle: contractView.contract.title,
          }),
        event: 'HOD_REJECTED_POC',
        contractId,
      })
    }

    const isLegalOrAdminActor =
      session.role === contractWorkflowRoles.legalTeam || session.role === contractWorkflowRoles.admin
    const hasExitedSigningStatus =
      payload.action !== bypassApprovalActionName &&
      isLegalOrAdminActor &&
      previousStatus === contractStatuses.signing &&
      contractView.contract.status !== contractStatuses.signing

    if (hasExitedSigningStatus) {
      const envelopeIds = Array.from(
        new Set(contractView.signatories.map((item) => item.zohoSignEnvelopeId?.trim()).filter(Boolean) as string[])
      )

      if (envelopeIds.length > 0) {
        const contractSignatoryService = getContractSignatoryService()
        void dispatchNotificationSafely({
          dispatch: () =>
            contractSignatoryService.recallSigningEnvelopes({
              tenantId,
              contractId,
              envelopeIds,
              actorEmployeeId: session.employeeId,
              actorRole: session.role,
              actorEmail: session.email ?? '',
              reason: payload.noteText,
            }),
          event: 'LEGAL_SIGNING_EXIT_ZOHO_RECALL',
          contractId,
        })
      }

      void dispatchNotificationSafely({
        dispatch: () =>
          contractQueryService.softResetActiveSigningCycle({
            tenantId,
            contractId,
            actorEmployeeId: session.employeeId,
            actorRole: session.role,
            actorEmail: session.email ?? '',
            reason: payload.noteText,
          }),
        event: 'SIGNING_SOFT_RESET',
        contractId,
      })
    }

    const responseData = okResponse(contractView)

    if (idempotencyKey) {
      const idempotencyStoreTimerLabel = `contract-action.idempotency-store.${contractId}`
      if (shouldLogPerformance) {
        console.time(idempotencyStoreTimerLabel)
      }
      const idempotencyService = getIdempotencyService()
      await idempotencyService.store(idempotencyKey, tenantId, responseData, 200)
      shouldReleaseClaim = false
      if (shouldLogPerformance) {
        console.timeEnd(idempotencyStoreTimerLabel)
      }
    }

    return NextResponse.json(responseData)
  } catch (error) {
    const tenantId = session.tenantId
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
    if (tenantId && idempotencyKey && shouldReleaseClaim) {
      try {
        const idempotencyService = getIdempotencyService()
        await idempotencyService.releaseClaim(idempotencyKey, tenantId)
      } catch {
        // noop - keep original failure path
      }
    }

    if (error instanceof ZodError) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'Invalid contract action payload'), { status: 400 })
    }

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to apply contract action'

    return NextResponse.json(errorResponse(code, message), { status })
  } finally {
    if (shouldLogPerformance) {
      console.timeEnd(requestTimerLabel)
    }
  }
})

export const POST = POSTHandler
