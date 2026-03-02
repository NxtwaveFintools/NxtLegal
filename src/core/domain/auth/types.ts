export type AuthenticatedEmployee = {
  id: string
  employeeId: string
  tenantId: string
  email: string
  fullName?: string
  role?: string
  team?: string | null
}

export type LoginRequest = {
  email: string
  password: string
}

export type OAuthProfile = {
  email: string
  name?: string
}

export type AuthResult = {
  user: AuthenticatedEmployee
}
