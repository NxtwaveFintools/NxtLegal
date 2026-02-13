export const permissionRegistry = {
  viewDashboard: 'view:dashboard',
  manageDocuments: 'manage:documents',
  manageCases: 'manage:cases',
  manageSettings: 'manage:settings',
} as const

export type PermissionKey = keyof typeof permissionRegistry
export type PermissionName = (typeof permissionRegistry)[PermissionKey]
