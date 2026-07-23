import 'server-only'

import { SignJWT, jwtVerify } from 'jose'
import { appConfig } from '@/core/config/app-config'
import { googleDriveOauth } from '@/core/constants/google-drive'

const secret = new TextEncoder().encode(appConfig.security.jwtSecretKey)
const STATE_KIND = 'drive_oauth_state'

export type DriveOAuthStatePayload = {
  userId: string
  tenantId: string
  nonce: string
  returnPath: string
}

/** Signs a short-lived OAuth `state` value binding the handshake to the user + a nonce. */
export async function createDriveOAuthState(payload: DriveOAuthStatePayload): Promise<string> {
  return new SignJWT({ ...payload, kind: STATE_KIND })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${googleDriveOauth.stateTtlSeconds}s`)
    .sign(secret)
}

export async function verifyDriveOAuthState(token: string): Promise<DriveOAuthStatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.kind !== STATE_KIND) {
      return null
    }
    const { userId, tenantId, nonce, returnPath } = payload as Record<string, unknown>
    if (
      typeof userId !== 'string' ||
      typeof tenantId !== 'string' ||
      typeof nonce !== 'string' ||
      typeof returnPath !== 'string'
    ) {
      return null
    }
    return { userId, tenantId, nonce, returnPath }
  } catch {
    return null
  }
}
