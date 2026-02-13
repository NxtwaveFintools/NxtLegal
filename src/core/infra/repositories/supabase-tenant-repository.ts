import { createClient } from '@/lib/supabase/client'
import type { TenantRepository, TenantRecord } from '@/core/domain/tenants/tenant-repository'

class SupabaseTenantRepository implements TenantRepository {
  private supabase = createClient()

  async findById(lookup: { id: string }): Promise<TenantRecord | null> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('id, name, region, created_at, updated_at, deleted_at')
      .eq('id', lookup.id)
      .is('deleted_at', null)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return null
      }
      throw error
    }

    return this.mapToRecord(data)
  }

  async create(tenant: Omit<TenantRecord, 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<TenantRecord> {
    const { data, error } = await this.supabase
      .from('tenants')
      .insert([
        {
          id: tenant.id,
          name: tenant.name,
          region: tenant.region,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return this.mapToRecord(data)
  }

  async update(id: string, updates: Partial<TenantRecord>): Promise<TenantRecord> {
    const payload: Record<string, unknown> = {}
    if (updates.name) payload.name = updates.name
    if (updates.region) payload.region = updates.region

    const { data, error } = await this.supabase
      .from('tenants')
      .update(payload)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single()

    if (error) throw error
    return this.mapToRecord(data)
  }

  async softDelete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('tenants')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)

    if (error) throw error
  }

  async restore(id: string): Promise<void> {
    const { error } = await this.supabase.from('tenants').update({ deleted_at: null }).eq('id', id)

    if (error) throw error
  }

  private mapToRecord(data: Record<string, unknown>): TenantRecord {
    return {
      id: String(data.id),
      name: String(data.name),
      region: String(data.region),
      createdAt: String(data.created_at),
      updatedAt: String(data.updated_at),
      deletedAt: data.deleted_at ? String(data.deleted_at) : null,
    }
  }
}

export const supabaseTenantRepository = new SupabaseTenantRepository()
