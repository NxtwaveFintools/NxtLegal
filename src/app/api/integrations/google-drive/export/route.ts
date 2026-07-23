import { NextResponse } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { driveExportSchema } from '@/core/domain/drive/schemas'
import {
  getContractSignatoryService,
  getContractUploadService,
  getDriveService,
} from '@/core/registry/service-registry'
import {
  driveErrorResponse,
  driveFeatureDisabledResponse,
  inferMimeFromFileName,
  isGoogleDriveEnabled,
  requireSessionScope,
} from '@/core/infra/integrations/google-drive/drive-http'

export const maxDuration = 300

type ResolvedSource = { bytes: Uint8Array; fileName: string; mimeType: string }

const fetchBytesFromSignedUrl = async (
  signedUrl: string
): Promise<{ bytes: Uint8Array; contentType: string | null }> => {
  const response = await fetch(signedUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch document bytes (status ${response.status})`)
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type'),
  }
}

const preferMime = (candidate: string | null | undefined, fallbackFileName: string): string => {
  if (candidate && candidate !== 'application/octet-stream') {
    return candidate
  }
  return inferMimeFromFileName(fallbackFileName)
}

/**
 * Exports a contract document (or a final signing artifact) to the user's chosen
 * Drive folder. Document access is authorized by the existing contract services;
 * this route never bypasses those checks.
 */
export const POST = withAuth(async (request, { session }) => {
  if (!isGoogleDriveEnabled()) {
    return driveFeatureDisabledResponse()
  }

  try {
    const { tenantId, userId, role } = requireSessionScope(session)
    const payload = await request.json().catch(() => null)
    const parsed = driveExportSchema.safeParse(payload)
    if (!parsed.success) {
      return NextResponse.json(
        errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid export request'),
        { status: 400 }
      )
    }
    const input = parsed.data

    let source: ResolvedSource
    if (input.artifact) {
      const artifact = await getContractSignatoryService().downloadFinalSigningArtifact({
        tenantId,
        contractId: input.contractId,
        actorEmployeeId: userId,
        actorRole: role,
        artifact: input.artifact,
      })

      if ('fileBytes' in artifact) {
        source = {
          bytes: artifact.fileBytes,
          fileName: artifact.fileName,
          mimeType: artifact.contentType || 'application/pdf',
        }
      } else {
        const fetched = await fetchBytesFromSignedUrl(artifact.signedUrl)
        source = {
          bytes: fetched.bytes,
          fileName: artifact.fileName,
          mimeType: artifact.contentType || fetched.contentType || 'application/pdf',
        }
      }
    } else {
      const download = await getContractUploadService().createSignedDownloadUrl({
        contractId: input.contractId,
        tenantId,
        requestorEmployeeId: userId,
        requestorRole: role,
        documentId: input.documentId,
      })
      const fetched = await fetchBytesFromSignedUrl(download.signedUrl)
      source = {
        bytes: fetched.bytes,
        fileName: download.fileName,
        mimeType: preferMime(fetched.contentType, download.fileName),
      }
    }

    const result = await getDriveService().uploadBytes({
      tenantId,
      userId,
      folderId: input.folderId,
      folderName: input.folderName,
      fileName: source.fileName,
      mimeType: source.mimeType,
      bytes: source.bytes,
    })

    return NextResponse.json(
      okResponse({
        fileId: result.fileId,
        fileName: result.fileName,
        folderId: result.folderId,
        webViewLink: result.webViewLink,
      })
    )
  } catch (error) {
    return driveErrorResponse(error, { route: 'drive/export', userId: session.employeeId })
  }
})
