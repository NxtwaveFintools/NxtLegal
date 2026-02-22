export const limits = {
  passwordMinLength: 8, // Minimum password length for security
  passwordMaxLength: 128, // Increased from 30 to support passphrases
  sessionDays: 2,
  maxLoginAttempts: 5, // Rate limit: 5 attempts per minute
  paginationPageSize: 50,
  dashboardContractsPageSize: 10,
  requestTimeoutMs: 30000,
  maxUploadSizeMb: 100,
} as const
