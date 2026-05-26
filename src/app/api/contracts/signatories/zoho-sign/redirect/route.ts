import { NextResponse, type NextRequest } from 'next/server'
import { getContractQueryService } from '@/core/registry/service-registry'
import { verifySignatoryLinkToken } from '@/core/infra/security/signatory-link-token'
import { appConfig } from '@/core/config/app-config'
import { ZohoSignClient } from '@/core/infra/integrations/zoho-sign/zoho-sign-client'
import { logger } from '@/core/infra/logging/logger'
import { getSession } from '@/core/infra/session/jwt-session-store'
import { contractStatuses } from '@/core/constants/contracts'
import { authErrorCodes } from '@/core/constants/auth-errors'

const redirectToLogin = (request: NextRequest) => {
  const loginUrl = new URL(appConfig.routes.public.login, request.nextUrl.origin)
  loginUrl.searchParams.set('error', authErrorCodes.unauthorized)
  loginUrl.searchParams.set('redirectTo', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(loginUrl, { status: 302 })
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')?.trim()
    if (!token) {
      return redirectToLogin(request)
    }

    const tokenPayload = await verifySignatoryLinkToken(token)
    const contractQueryService = getContractQueryService()

    // Resolve exact recipient context and ensure token recipient still exists.
    const context = await contractQueryService.resolveEnvelopeContext({
      envelopeId: tokenPayload.envelopeId,
      recipientEmail: tokenPayload.recipientEmail,
    })

    if (!context) {
      return redirectToLogin(request)
    }

    const normalizedContextEmail = context.signatoryEmail.trim().toLowerCase()
    const normalizedTokenEmail = tokenPayload.recipientEmail.trim().toLowerCase()
    if (normalizedContextEmail !== normalizedTokenEmail) {
      return redirectToLogin(request)
    }

    if (context.contractStatus === contractStatuses.void) {
      return redirectToLogin(request)
    }

    // Internal recipients must be signed in as the intended account.
    if (context.recipientType === 'INTERNAL') {
      const session = await getSession()
      if (!session?.employeeId || !session.email || !session.tenantId) {
        return redirectToLogin(request)
      }

      const normalizedSessionEmail = session.email.trim().toLowerCase()
      if (normalizedSessionEmail !== normalizedTokenEmail) {
        return redirectToLogin(request)
      }

      if (context.tenantId !== session.tenantId) {
        return redirectToLogin(request)
      }
    }

    const zohoConfig = appConfig.zohoSign
    if (
      !zohoConfig.apiBaseUrl ||
      !zohoConfig.oauthBaseUrl ||
      !zohoConfig.clientId ||
      !zohoConfig.clientSecret ||
      !zohoConfig.refreshToken
    ) {
      return redirectToLogin(request)
    }

    const zohoClient = new ZohoSignClient({
      apiBaseUrl: zohoConfig.apiBaseUrl,
      oauthBaseUrl: zohoConfig.oauthBaseUrl,
      clientId: zohoConfig.clientId,
      clientSecret: zohoConfig.clientSecret,
      refreshToken: zohoConfig.refreshToken,
    })

    const signingUrl = await zohoClient.createEmbeddedSigningUrl({
      envelopeId: tokenPayload.envelopeId,
      recipientId: tokenPayload.recipientId,
      returnUrl: `${appConfig.auth.siteUrl}/contracts/${context.contractId}`,
    })

    return NextResponse.redirect(signingUrl, { status: 302 })
  } catch (error) {
    logger.error('Failed to resolve signatory redirect link', {
      error: error instanceof Error ? error.message : String(error),
    })
    return redirectToLogin(request)
  }
}
