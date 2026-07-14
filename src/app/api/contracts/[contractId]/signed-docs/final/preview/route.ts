import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractSignatoryService } from '@/core/registry/service-registry'
import { logger } from '@/core/infra/logging/logger'

const GETHandler = withAuth(async (request: NextRequest, { session, params }) => {
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    if (!session.role) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session role is required'), { status: 401 })
    }

    const contractId = params?.contractId
    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    const artifact = request.nextUrl.searchParams.get('artifact')
    if (artifact !== 'signed_document' && artifact !== 'completion_certificate' && artifact !== 'merged_pdf') {
      return NextResponse.json(
        errorResponse('INVALID_ARTIFACT', 'artifact must be signed_document, completion_certificate, or merged_pdf'),
        { status: 400 }
      )
    }

    const contractSignatoryService = getContractSignatoryService()
    const result = await contractSignatoryService.downloadFinalSigningArtifact({
      tenantId: session.tenantId,
      contractId,
      actorEmployeeId: session.employeeId,
      actorRole: session.role,
      artifact,
    })

    // Unlike the /download route, this route always proxies the file bytes from our
    // own origin with Content-Disposition: inline, so it can be embedded in an <iframe>.
    // Handing the browser a raw cross-origin storage signed URL instead causes it to
    // refuse to render the frame ("This content is blocked").
    let buffer: ArrayBuffer
    if ('signedUrl' in result) {
      const upstream = await fetch(result.signedUrl)
      if (!upstream.ok) {
        return NextResponse.json(errorResponse('PREVIEW_FETCH_FAILED', 'Failed to fetch signed document preview'), {
          status: 502,
        })
      }
      buffer = await upstream.arrayBuffer()
    } else {
      buffer = new Uint8Array(result.fileBytes).buffer
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `inline; filename="${result.fileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error) {
    logger.warn('Final signing artifact preview failed', {
      error: String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    })

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to generate signed document preview'
    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
