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

export const GET = withAuth(async (_request, { session }) => {
  if (!isGoogleDriveEnabled()) {
    return driveFeatureDisabledResponse()
  }

  try {
    const { tenantId, userId } = requireSessionScope(session)
    const status = await getDriveService().getStatus({ tenantId, userId })
    return NextResponse.json(okResponse(status))
  } catch (error) {
    return driveErrorResponse(error, { route: 'drive/status', userId: session.employeeId })
  }
})
