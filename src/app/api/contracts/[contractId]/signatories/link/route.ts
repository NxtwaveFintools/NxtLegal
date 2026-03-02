'use server'

import { NextResponse, type NextRequest } from 'next/server'
import { appConfig } from '@/core/config/app-config'
import { errorResponse, okResponse } from '@/core/http/response'
import { getContractQueryService } from '@/core/registry/service-registry'
import { createSignatoryLinkToken } from '@/core/infra/security/signatory-link-token'
import { getSession } from '@/core/infra/session/jwt-session-store'
import { AuthorizationError, BusinessRuleError } from '@/core/http/errors'

export async function GET(request: NextRequest, { params }: { params: Promise<{ contractId: string }> }) {
  try {
    const { contractId } = await params
    const email = request.nextUrl.searchParams.get('email')?.trim().toLowerCase()
    if (!email) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'recipient email is required'), { status: 400 })
    }

    const session = await getSession()
    if (!session?.employeeId || !session.tenantId || !session.email) {
      return NextResponse.json(errorResponse('UNAUTHORIZED', 'Please sign in'), { status: 401 })
    }

    const contractQueryService = getContractQueryService()
    const contractView = await contractQueryService.getContractDetail({
      tenantId: session.tenantId,
      contractId,
      employeeId: session.employeeId,
      role: session.role,
    })

    const signatory = (contractView.signatories ?? []).find(
      (item) => item.signatoryEmail.trim().toLowerCase() === email
    )
    if (!signatory) {
      return NextResponse.json(errorResponse('NOT_FOUND', 'Signatory not found'), { status: 404 })
    }

    if (signatory.recipientType !== 'INTERNAL') {
      return NextResponse.json(
        errorResponse('SIGNATORY_LINK_FORBIDDEN', 'Signing link is available only for internal recipients'),
        {
          status: 403,
        }
      )
    }

    if (!signatory.zohoSignEnvelopeId || !signatory.zohoSignRecipientId) {
      throw new BusinessRuleError('SIGNATORY_LINK_UNAVAILABLE', 'Signing link is not available yet for this recipient')
    }

    const token = await createSignatoryLinkToken({
      envelopeId: signatory.zohoSignEnvelopeId,
      recipientEmail: signatory.signatoryEmail,
      recipientId: signatory.zohoSignRecipientId,
    })

    const redirectUrl = `${appConfig.auth.siteUrl}/api/contracts/signatories/zoho-sign/redirect?token=${encodeURIComponent(
      token
    )}`

    return NextResponse.json(
      okResponse({
        signing_url: redirectUrl,
      })
    )
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(errorResponse(error.code, error.message), { status: 403 })
    }
    if (error instanceof BusinessRuleError) {
      return NextResponse.json(errorResponse(error.code, error.message), { status: 400 })
    }
    return NextResponse.json(errorResponse('SIGNATORY_LINK_ERROR', 'Failed to generate signing link'), {
      status: 500,
    })
  }
}
