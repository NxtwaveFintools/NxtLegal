import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { appConfig } from '@/core/config/app-config'
import { featureFlags } from '@/core/config/feature-flags'
import { routeRegistry } from '@/core/config/route-registry'
import { errorResponse } from '@/core/http/response'
import { AuthenticationError, getErrorMessage, isAppError } from '@/core/http/errors'
import { googleDriveErrorCodes, googleDriveImportAllowedRoles } from '@/core/constants/google-drive'
import { logger } from '@/core/infra/logging/logger'
import type { SessionData } from '@/core/infra/session/jwt-session-store'

export const isGoogleDriveEnabled = (): boolean => featureFlags.enableGoogleDrive

/** Absolute OAuth redirect URI — must exactly match the Google console entry. */
export const getDriveRedirectUri = (): string => {
  const base = appConfig.auth.siteUrl.replace(/\/+$/, '')
  return `${base}${routeRegistry.api.drive.callback}`
}

export const driveFeatureDisabledResponse = (): NextResponse =>
  NextResponse.json(errorResponse(googleDriveErrorCodes.featureDisabled, 'Google Drive integration is disabled.'), {
    status: 404,
  })

/** Maps thrown errors to the standard API envelope with the right status code. */
export const driveErrorResponse = (error: unknown, context: Record<string, unknown> = {}): NextResponse => {
  if (isAppError(error)) {
    return NextResponse.json(errorResponse(error.code, error.message), { status: error.statusCode })
  }
  logger.error('Google Drive route error', { ...context, error: getErrorMessage(error) })
  return NextResponse.json(errorResponse('INTERNAL_ERROR', 'Something went wrong. Please try again.'), { status: 500 })
}

/** Narrows the session to a guaranteed tenant scope (withAuth already enforces this). */
export const requireSessionScope = (session: SessionData): { tenantId: string; userId: string; role: string } => {
  if (!session.tenantId) {
    throw new AuthenticationError()
  }
  return { tenantId: session.tenantId, userId: session.employeeId, role: session.role ?? 'viewer' }
}

/** True when the role may import files from Drive into the signing workflow. */
export const isDriveImportRole = (role: string | undefined): boolean =>
  Boolean(role && (googleDriveImportAllowedRoles as readonly string[]).includes(role))

/** Returns a same-origin absolute path from ?returnPath, or null if unsafe. */
export const resolveSafeReturnPath = (request: NextRequest): string | null => {
  const raw = new URL(request.url).searchParams.get('returnPath')
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return null
  }
  return raw
}

export const inferMimeFromFileName = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pdf':
      return 'application/pdf'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'doc':
      return 'application/msword'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    default:
      return 'application/octet-stream'
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * HTML page returned by the OAuth callback. Runs in the OAuth popup: notifies the
 * opener window via postMessage and closes itself.
 */
export const driveConnectedHtml = (params: { ok: boolean; message: string }): NextResponse => {
  const payload = JSON.stringify({ type: 'nxtlegal:drive-oauth', ok: params.ok })
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Google Drive</title></head><body style="font-family:system-ui,'Segoe UI',Arial,sans-serif;padding:32px;color:#0f172a"><p>${escapeHtml(
    params.message
  )}</p><script>try{if(window.opener){window.opener.postMessage(${payload},window.location.origin);}}catch(e){}setTimeout(function(){try{window.close();}catch(e){}},400);</script></body></html>`
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
