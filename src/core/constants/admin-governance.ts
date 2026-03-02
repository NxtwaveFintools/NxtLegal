export const adminGovernance = {
  adminActorRoles: ['SUPER_ADMIN', 'LEGAL_ADMIN', 'ADMIN'] as const,
  departmentRoleTypes: ['POC', 'HOD'] as const,
  userRoleTypes: ['USER', 'LEGAL_TEAM'] as const,
  developmentDefaultPassword: 'Password@123',
  operations: {
    grant: 'grant',
    revoke: 'revoke',
  },
  sessionReauthMessage: 'Your access permissions have been updated. Please login again.',
} as const

export type AdminActorRole = (typeof adminGovernance.adminActorRoles)[number]
export type DepartmentRoleType = (typeof adminGovernance.departmentRoleTypes)[number]
export type UserRoleType = (typeof adminGovernance.userRoleTypes)[number]
export type RoleOperation = (typeof adminGovernance.operations)[keyof typeof adminGovernance.operations]
