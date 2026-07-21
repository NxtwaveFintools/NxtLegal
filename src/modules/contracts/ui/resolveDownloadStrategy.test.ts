import { resolveDownloadStrategy } from '@/modules/contracts/ui/resolveDownloadStrategy'

describe('resolveDownloadStrategy', () => {
  it('routes the executed contract to the final signed document endpoint', () => {
    expect(resolveDownloadStrategy('EXECUTED_CONTRACT')).toBe('final_signed_document')
  })

  it('routes the audit certificate to the completion certificate endpoint', () => {
    expect(resolveDownloadStrategy('AUDIT_CERTIFICATE')).toBe('final_completion_certificate')
  })

  it('routes primary documents to the generic endpoint', () => {
    expect(resolveDownloadStrategy('PRIMARY')).toBe('generic')
  })

  it('routes counterparty supporting documents to the generic endpoint', () => {
    expect(resolveDownloadStrategy('COUNTERPARTY_SUPPORTING')).toBe('generic')
  })
})
