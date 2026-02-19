export const roleRegistry = {
  poc: 'POC',
  hod: 'HOD',
  legalTeam: 'LEGAL_TEAM',
  admin: 'ADMIN',
} as const

export type RoleKey = keyof typeof roleRegistry
export type RoleName = (typeof roleRegistry)[RoleKey]
