import { z } from 'zod'
import { limits } from '@/core/constants/limits'

export const LoginSchema = z.object({
  email: z
    .string()
    .email('Valid email is required')
    .trim()
    .toLowerCase()
    .refine((value) => value.endsWith('@nxtwave.co.in'), {
      message: 'Only @nxtwave.co.in email addresses are allowed',
    }),
  password: z
    .string()
    .min(limits.passwordMinLength, `Password must be at least ${limits.passwordMinLength} characters`)
    .max(limits.passwordMaxLength, `Password must not exceed ${limits.passwordMaxLength} characters`)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, {
      message: 'Password must include uppercase, lowercase, number, and special character',
    }),
})

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token required'),
})

// SessionDataSchema: employeeId is TEXT in DB (e.g., 'NW1007247'), NOT UUID
// employees.employee_id column is TEXT, not UUID (employees.id is the UUID primary key)
export const SessionDataSchema = z.object({
  employeeId: z.string().min(1, 'Session identifier required'),
  email: z.string().email('Invalid email'),
  fullName: z.string(),
  role: z.string().default('POC'),
  tenantId: z.string().uuid('Invalid tenant ID').optional(),
})

export type LoginRequest = z.infer<typeof LoginSchema>
export type RefreshTokenRequest = z.infer<typeof RefreshTokenSchema>
export type SessionData = z.infer<typeof SessionDataSchema>
