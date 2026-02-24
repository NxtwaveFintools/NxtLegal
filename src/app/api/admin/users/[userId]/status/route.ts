import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { appConfig } from '@/core/config/app-config'
import { getAdminQueryService } from '@/core/registry/service-registry'
import { updateUserStatusRequestSchema, userStatusPathSchema } from '@/core/domain/admin/schemas'

const PATCHHandler = withAuth(async (request: NextRequest, { session, params }) => {
  try {
    if (!appConfig.features.enableAdminGovernance) {
      return NextResponse.json(errorResponse('FEATURE_DISABLED', 'Admin governance module is disabled'), {
        status: 404,
      })
    }

    const parsedParams = userStatusPathSchema.parse({
      userId: params?.userId,
    })

    const payload = updateUserStatusRequestSchema.parse(await request.json())
    const adminQueryService = getAdminQueryService()
    const user = await adminQueryService.setUserStatus({
      session,
      userId: parsedParams.userId,
      isActive: payload.isActive,
    })

    return NextResponse.json(okResponse({ user }))
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'Invalid user status payload'), { status: 400 })
    }

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to update user status'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const PATCH = PATCHHandler
