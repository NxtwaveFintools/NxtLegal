export const permissionRegistry = {
  viewDashboard: 'view:dashboard',
  manageDocuments: 'manage:documents',
  manageCases: 'manage:cases',
  manageSettings: 'manage:settings',
  viewContractAll: 'view:contracts:all',
  viewContractAssigned: 'view:contracts:assigned',
  approveContractHod: 'approve:contracts:hod',
  approveContractLegal: 'approve:contracts:legal',
  addContractNote: 'contracts:notes:add',
  mentionContractUser: 'contracts:mentions:add',
  reassignContract: 'contracts:reassign',
} as const

export type PermissionKey = keyof typeof permissionRegistry
export type PermissionName = (typeof permissionRegistry)[PermissionKey]
