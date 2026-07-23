import { NextResponse } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { googleDriveLimits } from '@/core/constants/google-drive'
import { driveFoldersQuerySchema } from '@/core/domain/drive/schemas'
import { getDriveService } from '@/core/registry/service-registry'
import {
  driveErrorResponse,
  driveFeatureDisabledResponse,
  isGoogleDriveEnabled,
  requireSessionScope,
} from '@/core/infra/integrations/google-drive/drive-http'

export const GET = withAuth(async (request, { session }) => {
  if (!isGoogleDriveEnabled()) {
    return driveFeatureDisabledResponse()
  }

  try {
    const { tenantId, userId } = requireSessionScope(session)
    const parentIdParam = new URL(request.url).searchParams.get('parentId') ?? undefined
    const parsed = driveFoldersQuerySchema.safeParse({ parentId: parentIdParam })
    if (!parsed.success) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'Invalid parentId'), { status: 400 })
    }

    const parentId = parsed.data.parentId ?? googleDriveLimits.rootFolderId
    const withFiles = new URL(request.url).searchParams.get('withFiles') === '1'
    const service = getDriveService()
    const folders = await service.listFolders({ tenantId, userId, parentId })
    const files = withFiles ? await service.listFiles({ tenantId, userId, parentId }) : undefined
    return NextResponse.json(okResponse({ parentId, folders, files }))
  } catch (error) {
    return driveErrorResponse(error, { route: 'drive/folders', userId: session.employeeId })
  }
})
