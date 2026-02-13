export type AuthenticatedEmployee = {
  employeeId: string
  email?: string
  fullName?: string
}

export type LoginRequest = {
  employeeId: string
  password: string
}

export type OAuthProfile = {
  email: string
  name?: string
}

export type AuthResult = {
  employee: AuthenticatedEmployee
}
