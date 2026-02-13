export const roleRegistry = {
  employee: 'employee',
  admin: 'admin',
} as const

export type RoleKey = keyof typeof roleRegistry
export type RoleName = (typeof roleRegistry)[RoleKey]
