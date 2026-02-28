import { formatContractLogEvent } from '@/modules/contracts/ui/formatContractLogEvent'

describe('formatContractLogEvent legal send-for-signing semantics', () => {
  it('renders custom legal send-for-signing initiation message', () => {
    const result = formatContractLogEvent({
      id: 'event-1',
      eventType: 'CONTRACT_SIGNATORY_SENT',
      action: 'contract.legal.send_for_signing.initiated',
      userId: 'user-1',
      actorEmail: 'legal@nxtwave.co.in',
      actorRole: 'LEGAL_TEAM',
      targetEmail: 'hod.legal@nxtwave.co.in',
      noteText: 'Initiated Send for Signing workflow. Pending Legal HOD review.',
      metadata: {
        upload_mode: 'LEGAL_SEND_FOR_SIGNING',
        status: 'HOD_PENDING',
        workflow_label: 'Pending Legal HOD review',
      },
      createdAt: '2026-02-28T12:00:00.000Z',
    })

    expect(result.message).toBe('legal@nxtwave.co.in initiated Send for Signing workflow. Pending Legal HOD review.')
    expect(result.remark).toBe('Reason: Initiated Send for Signing workflow. Pending Legal HOD review.')
  })
})
