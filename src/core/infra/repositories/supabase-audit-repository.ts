import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/service'
import type { IAuditRepository, AuditEntry, AuditAction } from '@/core/domain/audit/audit-logger'

class SupabaseAuditRepository implements IAuditRepository {
  private supabase = createServiceSupabase()

  async log(entry: AuditEntry): Promise<void> {
    const { error } = await this.supabase.from('audit_logs').insert([
      {
        tenant_id: entry.tenantId,
        user_id: entry.userId,
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId,
        changes: entry.changes ?? null,
        metadata: entry.metadata ?? null,
      },
    ])

    if (error) throw error
  }

  async listByTenant(
    tenantId: string,
    filters?: { resourceType?: string; userId?: string; action?: AuditAction }
  ): Promise<AuditEntry[]> {
    let query = this.supabase
      .from('audit_logs')
      .select('id, tenant_id, user_id, action, resource_type, resource_id, changes, metadata, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (filters?.resourceType) {
      query = query.eq('resource_type', filters.resourceType)
    }

    if (filters?.userId) {
      query = query.eq('user_id', filters.userId)
    }

    if (filters?.action) {
      query = query.eq('action', filters.action)
    }

    const { data, error } = await query

    if (error) throw error
    return (data ?? []).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      changes: row.changes,
      metadata: row.metadata,
      createdAt: row.created_at,
    }))
  }
}

export const supabaseAuditRepository = new SupabaseAuditRepository()
