import type { ContractStatus } from '@/core/constants/contracts'

export type ContractRecord = {
  id: string
  tenantId: string
  title: string
  contractTypeId: string
  contractTypeName?: string
  signatoryName: string
  signatoryDesignation: string
  signatoryEmail: string
  backgroundOfRequest: string
  departmentId: string
  budgetApproved: boolean
  requestCreatedAt: string
  uploadedByEmployeeId: string
  uploadedByEmail: string
  currentAssigneeEmployeeId: string
  currentAssigneeEmail: string
  status: ContractStatus
  filePath: string
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
  createdAt?: string
}

export type CreateContractUploadInput = {
  contractId: string
  tenantId: string
  title: string
  contractTypeId: string
  signatoryName: string
  signatoryDesignation: string
  signatoryEmail: string
  backgroundOfRequest: string
  departmentId: string
  budgetApproved: boolean
  uploadedByEmployeeId: string
  uploadedByEmail: string
  uploadedByRole: string
  filePath: string
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
}

export type ContractAccessRecord = {
  id: string
  tenantId: string
  uploadedByEmployeeId: string
  currentAssigneeEmployeeId: string
  status: ContractStatus
  filePath: string
  fileName: string
}

export type ContractDocumentKind = 'PRIMARY' | 'COUNTERPARTY_SUPPORTING'

export type ContractDocumentRecord = {
  id: string
  tenantId: string
  contractId: string
  documentKind: ContractDocumentKind
  displayName: string
  fileName: string
  filePath: string
  fileSizeBytes: number
  fileMimeType: string
  createdAt: string
}

export type ContractDocumentAccessRecord = {
  id: string
  tenantId: string
  contractId: string
  filePath: string
  fileName: string
}

export type CreateContractDocumentInput = {
  tenantId: string
  contractId: string
  documentKind: ContractDocumentKind
  displayName: string
  fileName: string
  filePath: string
  fileSizeBytes: number
  fileMimeType: string
  uploadedByEmployeeId: string
  uploadedByEmail: string
}
