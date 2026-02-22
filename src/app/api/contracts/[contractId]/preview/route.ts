import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractUploadService } from '@/core/registry/service-registry'
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

    const documentId = request.nextUrl.searchParams.get('documentId')?.trim() || undefined

    const contractUploadService = getContractUploadService()
    const { signedUrl, fileName } = await contractUploadService.createSignedDownloadUrl({
      contractId,
      tenantId: session.tenantId,
      requestorEmployeeId: session.employeeId,
      requestorRole: session.role,
      documentId,
    })

    const upstream = await fetch(signedUrl)
    if (!upstream.ok) {
      return NextResponse.json(errorResponse('PREVIEW_FETCH_FAILED', 'Failed to fetch preview document'), {
        status: 502,
      })
    }

    const buffer = await upstream.arrayBuffer()
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
    const renderMode = request.nextUrl.searchParams.get('render')
    const isDocx =
      contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
      fileName.toLowerCase().endsWith('.docx')

    if (renderMode === 'html' && isDocx) {
      const mammoth = await import('mammoth')
      const result = await mammoth.convertToHtml({
        buffer: Buffer.from(buffer),
      })

      const html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>body{font-family:Inter,Segoe UI,Arial,sans-serif;padding:24px;color:#111827;line-height:1.5;}p{margin:0 0 10px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #d1d5db;padding:6px;vertical-align:top;}img{max-width:100%;height:auto;}h1,h2,h3,h4,h5,h6{margin:16px 0 8px;}</style></head><body>${result.value}</body></html>`

      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store, max-age=0',
        },
      })
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error) {
    logger.warn('Contract preview generation failed', {
      error: String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    })

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to generate contract preview'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
