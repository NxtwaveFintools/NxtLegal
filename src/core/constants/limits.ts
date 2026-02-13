export const limits = {
  passwordMaxLength: 30,
  sessionDays: 2,
  maxLoginAttempts: 5, // Rate limit: 5 attempts per minute
} as const
