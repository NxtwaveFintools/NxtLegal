import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/service'
import { logger } from '@/core/infra/logging/logger'
import type {
  EmployeeByEmail,
  EmployeeLookup,
  EmployeeRecord,
  EmployeeRepository,
  EmployeeFilters,
} from '@/core/domain/users/employee-repository'

class SupabaseEmployeeRepository implements EmployeeRepository {
  private resolveTeamName(
    team: { name: string | null } | Array<{ name: string | null }> | null | undefined
  ): string | null {
    if (!team) {
      return null
    }

    if (Array.isArray(team)) {
      return team[0]?.name ?? null
    }

    return team.name ?? null
  }

  private mapEmployee(data: {
    id: string
    tenant_id: string
    email: string
    full_name: string | null
    team_id: string | null
    team_name?: { name: string | null } | Array<{ name: string | null }> | null
    is_active: boolean
    password_hash?: string | null
    role: string
    created_at: string
    updated_at: string
    deleted_at: string | null
  }): EmployeeRecord {
    return {
      id: data.id,
      employeeId: data.id,
      tenantId: data.tenant_id,
      email: data.email,
      fullName: data.full_name,
      teamId: data.team_id,
      teamName: this.resolveTeamName(data.team_name),
      isActive: data.is_active,
      passwordHash: data.password_hash,
      role: data.role,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      deletedAt: data.deleted_at,
    }
  }

  async findByEmployeeId({ employeeId, tenantId }: EmployeeLookup): Promise<EmployeeRecord | null> {
    try {
      logger.debug('Looking up user by ID', { employeeId, tenantId })

      const supabase = createServiceSupabase()
      const { data, error } = await supabase
        .from('users')
        .select(
          'id, tenant_id, password_hash, email, full_name, team_id, team_name:teams(name), is_active, role, created_at, updated_at, deleted_at'
        )
        .eq('id', employeeId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          logger.debug('User not found in tenant', { employeeId, tenantId })
          return null
        }
        logger.error('User lookup by ID failed', {
          employeeId,
          tenantId,
          error: error.message,
          errorCode: error.code,
        })
        return null
      }

      logger.debug('User found', {
        employeeId,
        tenantId,
        hasPassword: !!data.password_hash,
        isActive: data.is_active,
      })
      return data ? this.mapEmployee(data) : null
    } catch (error) {
      logger.error('User lookup by ID threw error', { employeeId, tenantId, error: String(error) })
      return null
    }
  }

  async findByEmail({ email, tenantId }: EmployeeByEmail): Promise<EmployeeRecord | null> {
    try {
      const supabase = createServiceSupabase()
      const { data, error } = await supabase
        .from('users')
        .select(
          'id, tenant_id, email, full_name, team_id, team_name:teams(name), is_active, password_hash, role, created_at, updated_at, deleted_at'
        )
        .eq('email', email)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return null
        }
        logger.error('Employee lookup by email failed', { email, tenantId, error: error.message })
        return null
      }

      return data ? this.mapEmployee(data) : null
    } catch (error) {
      logger.error('Employee lookup by email threw error', { email, tenantId, error: String(error) })
      return null
    }
  }

  async create(employee: Omit<EmployeeRecord, 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<EmployeeRecord> {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          id: employee.id,
          tenant_id: employee.tenantId,
          email: employee.email,
          full_name: employee.fullName,
          team_id: employee.teamId ?? null,
          is_active: employee.isActive,
          password_hash: employee.passwordHash,
          role: employee.role,
        },
      ])
      .select(
        'id, tenant_id, email, full_name, team_id, team_name:teams(name), is_active, password_hash, role, created_at, updated_at, deleted_at'
      )
      .single()

    if (error) throw error
    return this.mapEmployee(data)
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    const supabase = createServiceSupabase()
    const { error } = await supabase
      .from('users')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)

    if (error) throw error
  }

  async restore(id: string, tenantId: string): Promise<void> {
    const supabase = createServiceSupabase()
    const { error } = await supabase.from('users').update({ deleted_at: null }).eq('id', id).eq('tenant_id', tenantId)

    if (error) throw error
  }

  async listByTenant(tenantId: string, filters?: EmployeeFilters): Promise<EmployeeRecord[]> {
    try {
      const supabase = createServiceSupabase()
      let query = supabase
        .from('users')
        .select(
          'id, tenant_id, email, full_name, team_id, team_name:teams(name), is_active, password_hash, role, created_at, updated_at, deleted_at'
        )
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)

      if (filters?.role) {
        query = query.eq('role', filters.role)
      }

      if (filters?.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive)
      }

      const { data, error } = await query

      if (error) {
        logger.error('Failed to list employees by tenant', { tenantId, error: error.message })
        return []
      }

      return (data || []).map((emp) => this.mapEmployee(emp))
    } catch (error) {
      logger.error('List employees by tenant threw error', { tenantId, error: String(error) })
      return []
    }
  }
}

export const supabaseEmployeeRepository = new SupabaseEmployeeRepository()
