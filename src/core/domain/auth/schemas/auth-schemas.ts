import { z } from 'zod'

export const LoginSchema = z.object({
  employeeId: z.string().min(1, 'Employee ID required').trim(),
  password: z.string().min(1, 'Password required'),
})

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token required'),
})

export const SessionDataSchema = z.object({
  employeeId: z.string().uuid('Invalid employee ID'),
  email: z.string().email('Invalid email'),
  fullName: z.string(),
  role: z.string().default('viewer'),
  tenantId: z.string().uuid('Invalid tenant ID').optional(),
})

export type LoginRequest = z.infer<typeof LoginSchema>
export type RefreshTokenRequest = z.infer<typeof RefreshTokenSchema>
export type SessionData = z.infer<typeof SessionDataSchema>
