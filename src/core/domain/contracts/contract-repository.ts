import type {
  ContractAccessRecord,
  ContractCounterpartyRecord,
  ContractDocumentAccessRecord,
  ContractRecord,
  CreateContractCounterpartyInput,
  CreateContractDocumentInput,
  CreateContractUploadInput,
} from '@/core/domain/contracts/types'

export interface ContractRepository {
  createWithAudit(input: CreateContractUploadInput): Promise<ContractRecord>
  createCounterparties(input: CreateContractCounterpartyInput[]): Promise<ContractCounterpartyRecord[]>
  listCounterparties(params: { tenantId: string; contractId: string }): Promise<ContractCounterpartyRecord[]>
  setCounterpartyName(params: { tenantId: string; contractId: string; counterpartyName: string }): Promise<void>
  createDocument(input: CreateContractDocumentInput): Promise<void>
  getForAccess(contractId: string, tenantId: string): Promise<ContractAccessRecord | null>
  getDocumentForAccess(params: {
    tenantId: string
    contractId: string
    documentId: string
  }): Promise<ContractDocumentAccessRecord | null>
  isUploaderInActorTeam(params: {
    tenantId: string
    actorEmployeeId: string
    uploaderEmployeeId: string
  }): Promise<boolean>
}
