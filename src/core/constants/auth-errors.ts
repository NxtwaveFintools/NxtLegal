export const authErrorCodes = {
  oauthFailed: 'oauth_failed',
  noCode: 'no_code',
  unauthorized: 'unauthorized',
  authFailed: 'auth_failed',
  invalidCredentials: 'invalid_credentials',
  accountInactive: 'account_inactive',
  validationError: 'validation_error',
  rateLimitExceeded: 'rate_limit_exceeded',
} as const

export type AuthErrorCode = (typeof authErrorCodes)[keyof typeof authErrorCodes]

export const authErrorMessages: Record<AuthErrorCode, string> = {
  oauth_failed: 'Microsoft sign-in failed. Please try again.',
  no_code: 'Microsoft sign-in was cancelled or failed. Please try again.',
  unauthorized: 'Unauthorized account. Contact your administrator.',
  auth_failed: 'Authentication failed. Please try again.',
  invalid_credentials: 'Invalid Employee ID or Password',
  account_inactive: 'Account is deactivated. Contact administrator.',
  validation_error: 'Input validation failed. Please check your input.',
  rate_limit_exceeded: 'Too many login attempts. Please try again later.',
}
