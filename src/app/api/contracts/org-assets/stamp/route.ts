import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { supabaseOrgAssetRepository } from '@/core/infra/repositories/supabase-org-asset-repository'

const GETHandler = withAuth(async (_request: NextRequest, { session }) => {
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    const signedUrl = await supabaseOrgAssetRepository.findStampSignedUrl(session.tenantId)

    return NextResponse.json(
      okResponse({
        configured: signedUrl !== undefined,
        signedUrl: signedUrl ?? null,
      }),
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      }
    )
  } catch (error) {
    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to fetch org stamp preview'
    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
