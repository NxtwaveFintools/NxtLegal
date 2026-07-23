import { NextResponse } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse } from '@/core/http/response'
import { AuthorizationError } from '@/core/http/errors'
import { googleDriveErrorCodes } from '@/core/constants/google-drive'
import { driveImportQuerySchema } from '@/core/domain/drive/schemas'
import { getDriveService } from '@/core/registry/service-registry'
import {
  driveErrorResponse,
  driveFeatureDisabledResponse,
  isDriveImportRole,
  isGoogleDriveEnabled,
  requireSessionScope,
} from '@/core/infra/integrations/google-drive/drive-http'

export const maxDuration = 300

/**
 * Streams a Drive file's bytes back to the browser so the client can wrap them in
 * a File and feed the existing upload pipeline. LEGAL_TEAM/ADMIN only.
 * Returns raw bytes (not the JSON envelope); filename is in the X-Drive-File-Name header.
 */
export const GET = withAuth(async (request, { session }) => {
  if (!isGoogleDriveEnabled()) {
    return driveFeatureDisabledResponse()
  }

  try {
    const { tenantId, userId, role } = requireSessionScope(session)
    if (!isDriveImportRole(role)) {
      throw new AuthorizationError(
        googleDriveErrorCodes.importForbidden,
        'Only legal team members can import files from Google Drive.'
      )
    }

    const fileIdParam = new URL(request.url).searchParams.get('fileId') ?? undefined
    const parsed = driveImportQuerySchema.safeParse({ fileId: fileIdParam })
    if (!parsed.success) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'Invalid fileId'), { status: 400 })
    }

    const file = await getDriveService().importFile({ tenantId, userId, fileId: parsed.data.fileId })
    const bodyBuffer = Buffer.from(file.bytes)

    return new NextResponse(bodyBuffer, {
      status: 200,
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Length': String(bodyBuffer.byteLength),
        'X-Drive-File-Name': encodeURIComponent(file.fileName),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return driveErrorResponse(error, { route: 'drive/import', userId: session.employeeId })
  }
})
