export type TenantRecord = {
  id: string
  name: string
  region: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type TenantLookup = {
  id: string
}

export interface TenantRepository {
  findById: (lookup: TenantLookup) => Promise<TenantRecord | null>
  create: (tenant: Omit<TenantRecord, 'createdAt' | 'updatedAt' | 'deletedAt'>) => Promise<TenantRecord>
  update: (id: string, updates: Partial<TenantRecord>) => Promise<TenantRecord>
  softDelete: (id: string) => Promise<void>
  restore: (id: string) => Promise<void>
}
