jest.mock('@/lib/supabase/service', () => ({
  createServiceSupabase: jest.fn(),
}))

import { createServiceSupabase } from '@/lib/supabase/service'
import { supabaseContractRepository } from './supabase-contract-repository'

describe('SupabaseContractRepository.addSupportingDocument', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('inserts a COUNTERPARTY_SUPPORTING row with no replaced_document_id and writes an added audit log', async () => {
    let capturedDocumentInsert: unknown = null
    let capturedAuditInsert: unknown = null

    const single = jest.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null })
    const select = jest.fn().mockReturnValue({ single })
    const documentInsert = jest.fn().mockImplementation((payload: unknown) => {
      capturedDocumentInsert = payload
      return { select }
    })

    const auditInsert = jest.fn().mockImplementation((payload: unknown) => {
      capturedAuditInsert = payload
      return Promise.resolve({ error: null })
    })

    const from = jest.fn((table: string) => {
      if (table === 'contract_documents') {
        return { insert: documentInsert }
      }
      if (table === 'audit_logs') {
        return { insert: auditInsert }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    ;(createServiceSupabase as jest.Mock).mockReturnValue({ from })

    await supabaseContractRepository.addSupportingDocument({
      tenantId: 'tenant-1',
      contractId: 'c-1',
      sectionCategory: 'COUNTERPARTY',
      counterpartyId: 'cp-1',
      counterpartyName: 'Acme Corp',
      displayName: 'Counterparty Document',
      fileName: 'nda.pdf',
      filePath: 'tenant-1/c-1/nda.pdf',
      fileSizeBytes: 1234,
      fileMimeType: 'application/pdf',
      uploadedByEmployeeId: 'emp-1',
      uploadedByEmail: 'poc@x.co',
      uploadedByRole: 'POC',
    })

    expect(capturedDocumentInsert).toMatchObject({
      document_kind: 'COUNTERPARTY_SUPPORTING',
      counterparty_id: 'cp-1',
      display_name: 'Counterparty Document',
      replaced_document_id: null,
    })

    expect(capturedAuditInsert).toEqual([
      expect.objectContaining({
        action: 'contract.supporting_document.added',
        event_type: null,
        resource_id: 'c-1',
        metadata: expect.objectContaining({
          document_id: 'doc-1',
          section_category: 'COUNTERPARTY',
          counterparty_name: 'Acme Corp',
          file_name: 'nda.pdf',
        }),
      }),
    ])
  })
})

describe('SupabaseContractRepository.setBudgetApproved', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('flips budget_approved and logs when a row changes', async () => {
    let capturedAuditInsert: unknown = null

    const selectChain = jest.fn().mockResolvedValue({ data: [{ id: 'c-1' }], error: null })
    const isChain = jest.fn().mockReturnValue({ select: selectChain })
    const eq3Chain = jest.fn().mockReturnValue({ is: isChain })
    const eq2Chain = jest.fn().mockReturnValue({ eq: eq3Chain })
    const eq1Chain = jest.fn().mockReturnValue({ eq: eq2Chain })
    const updateChain = jest.fn().mockReturnValue({ eq: eq1Chain })

    const auditInsert = jest.fn().mockImplementation((payload: unknown) => {
      capturedAuditInsert = payload
      return Promise.resolve({ error: null })
    })

    const from = jest.fn((table: string) => {
      if (table === 'contracts') {
        return { update: updateChain }
      }
      if (table === 'audit_logs') {
        return { insert: auditInsert }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    ;(createServiceSupabase as jest.Mock).mockReturnValue({ from })

    const result = await supabaseContractRepository.setBudgetApproved({
      tenantId: 'tenant-1',
      contractId: 'c-1',
      actorEmployeeId: 'emp-1',
      actorEmail: 'poc@x.co',
      actorRole: 'POC',
    })

    expect(result.changed).toBe(true)
    expect(capturedAuditInsert).toEqual([
      expect.objectContaining({
        action: 'contract.budget_approved.set',
        event_type: null,
      }),
    ])
  })

  it('does not log when budget_approved was already true', async () => {
    const selectChain = jest.fn().mockResolvedValue({ data: [], error: null })
    const isChain = jest.fn().mockReturnValue({ select: selectChain })
    const eq3Chain = jest.fn().mockReturnValue({ is: isChain })
    const eq2Chain = jest.fn().mockReturnValue({ eq: eq3Chain })
    const eq1Chain = jest.fn().mockReturnValue({ eq: eq2Chain })
    const updateChain = jest.fn().mockReturnValue({ eq: eq1Chain })

    const auditInsert = jest.fn()

    const from = jest.fn((table: string) => {
      if (table === 'contracts') {
        return { update: updateChain }
      }
      if (table === 'audit_logs') {
        return { insert: auditInsert }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    ;(createServiceSupabase as jest.Mock).mockReturnValue({ from })

    const result = await supabaseContractRepository.setBudgetApproved({
      tenantId: 'tenant-1',
      contractId: 'c-1',
      actorEmployeeId: 'emp-1',
      actorEmail: 'poc@x.co',
      actorRole: 'POC',
    })

    expect(result.changed).toBe(false)
    expect(auditInsert).not.toHaveBeenCalled()
  })
})
