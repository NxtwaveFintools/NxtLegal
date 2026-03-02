import { readFileSync } from 'fs'
import { resolve } from 'path'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260228123000_polish_legal_send_for_signing_audit_semantics.sql'
)

const readMigrationSql = (): string => readFileSync(migrationPath, 'utf8')

describe('Contract upload routing SQL regression', () => {
  it('routes LEGAL_SEND_FOR_SIGNING uploads to Legal HOD while preserving selected department metadata', () => {
    const sql = readMigrationSql()

    expect(sql).toContain("IF normalized_upload_mode = 'LEGAL_SEND_FOR_SIGNING' THEN")
    expect(sql).toContain("lower(t.name) = lower('Legal and Compliance')")
    expect(sql).toContain('routing_team_id := p_department_id;')
    expect(sql).toContain('trm.team_id = routing_team_id')
    expect(sql).toContain("'department_id', p_department_id")
    expect(sql).toContain("'routing_team_id', routing_team_id")
  })

  it('keeps standard department routing unchanged for non-legal uploads', () => {
    const sql = readMigrationSql()

    expect(sql).toContain("IF normalized_upload_mode = 'LEGAL_SEND_FOR_SIGNING' AND bypass_hod_approval THEN")
    expect(sql).toMatch(/ELSE\s+routing_team_id := p_department_id;/)
    expect(sql).toContain("AND trm.role_type = 'HOD'")
    expect(sql).toContain("RAISE EXCEPTION 'No active HOD configured for routing department';")
    expect(sql).toContain('    p_department_id,')
  })

  it('collapses legal send-for-signing init audit logs into a single semantic event', () => {
    const sql = readMigrationSql()

    expect(sql).toContain("IF normalized_upload_mode = 'LEGAL_SEND_FOR_SIGNING' AND NOT bypass_hod_approval THEN")
    expect(sql).toContain("'CONTRACT_SIGNATORY_SENT'::public.audit_event_type")
    expect(sql).toContain("'contract.legal.send_for_signing.initiated'")
    expect(sql).toContain("'Initiated Send for Signing workflow. Pending Legal HOD review.'")
    expect(sql).toContain("'workflow_label', 'Pending Legal HOD review'")
  })
})
