import { NextResponse } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { okResponse } from '@/core/http/response'
import { getDriveService } from '@/core/registry/service-registry'
import {
  driveErrorResponse,
  driveFeatureDisabledResponse,
  isGoogleDriveEnabled,
  requireSessionScope,
} from '@/core/infra/integrations/google-drive/drive-http'

export const POST = withAuth(async (_request, { session }) => {
  if (!isGoogleDriveEnabled()) {
    return driveFeatureDisabledResponse()
  }

  try {
    const { tenantId, userId } = requireSessionScope(session)
    await getDriveService().disconnect({ tenantId, userId })
    return NextResponse.json(okResponse({ disconnected: true }))
  } catch (error) {
    return driveErrorResponse(error, { route: 'drive/disconnect', userId: session.employeeId })
  }
})
