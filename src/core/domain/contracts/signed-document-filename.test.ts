import {
  buildSignedArtifactFileName,
  formatExecutionDate,
  resolveDocumentDownloadFileName,
  resolveExecutedAt,
  sanitizeTitleForFileName,
} from '@/core/domain/contracts/signed-document-filename'

describe('sanitizeTitleForFileName', () => {
  it('strips characters that are illegal in filenames', () => {
    expect(sanitizeTitleForFileName('MSA / Acme: Q3 *draft?')).toBe('MSA Acme Q3 draft')
  })

  it('preserves hyphens and single spaces', () => {
    expect(sanitizeTitleForFileName('MSA - Acme Corp')).toBe('MSA - Acme Corp')
  })

  it('collapses runs of whitespace and trims', () => {
    expect(sanitizeTitleForFileName('  Master   Agreement  ')).toBe('Master Agreement')
  })

  it('strips control characters', () => {
    expect(sanitizeTitleForFileName('Tab\there')).toBe('Tab here')
  })

  it('falls back to "Contract" when the title is empty', () => {
    expect(sanitizeTitleForFileName('   ')).toBe('Contract')
  })

  it('falls back to "Contract" when the title sanitises to empty', () => {
    expect(sanitizeTitleForFileName('///:::')).toBe('Contract')
  })

  it('truncates over-long titles to 120 characters', () => {
    expect(sanitizeTitleForFileName('A'.repeat(300))).toHaveLength(120)
  })
})

describe('formatExecutionDate', () => {
  it('formats an ISO timestamp as DD-MM-YYYY', () => {
    expect(formatExecutionDate('2026-07-20T09:30:00.000Z')).toBe('20-07-2026')
  })

  it('pads single-digit days and months', () => {
    expect(formatExecutionDate('2026-01-05T09:30:00.000Z')).toBe('05-01-2026')
  })

  it('uses the India timezone rather than the server timezone', () => {
    // 20:00 UTC on 20 July is 01:30 on 21 July in Asia/Kolkata.
    expect(formatExecutionDate('2026-07-20T20:00:00.000Z')).toBe('21-07-2026')
  })

  it('returns null for null, undefined, and unparseable input', () => {
    expect(formatExecutionDate(null)).toBeNull()
    expect(formatExecutionDate(undefined)).toBeNull()
    expect(formatExecutionDate('not-a-date')).toBeNull()
  })
})

describe('resolveExecutedAt', () => {
  it('returns the latest signedAt when every signatory has signed', () => {
    const result = resolveExecutedAt([
      { status: 'SIGNED', signedAt: '2026-07-18T10:00:00.000Z' },
      { status: 'SIGNED', signedAt: '2026-07-20T10:00:00.000Z' },
    ])

    expect(result).toBe('2026-07-20T10:00:00.000Z')
  })

  it('returns null when any signatory is still pending', () => {
    const result = resolveExecutedAt([
      { status: 'SIGNED', signedAt: '2026-07-18T10:00:00.000Z' },
      { status: 'PENDING', signedAt: null },
    ])

    expect(result).toBeNull()
  })

  it('returns null when a signatory is marked signed but has no timestamp', () => {
    expect(resolveExecutedAt([{ status: 'SIGNED', signedAt: null }])).toBeNull()
  })

  it('returns null when there are no signatories', () => {
    expect(resolveExecutedAt([])).toBeNull()
  })

  it('ignores viewer recipients, who are copied on the envelope but never sign', () => {
    const result = resolveExecutedAt([
      { status: 'SIGNED', signedAt: '2026-05-20T15:43:36.000Z', recipientType: 'INTERNAL' },
      { status: 'SIGNED', signedAt: '2026-05-20T15:44:53.000Z', recipientType: 'EXTERNAL' },
      { status: 'PENDING', signedAt: null, recipientType: 'VIEWER' },
    ])

    expect(result).toBe('2026-05-20T15:44:53.000Z')
  })

  it('returns null when the envelope has viewers but no signers', () => {
    expect(resolveExecutedAt([{ status: 'PENDING', signedAt: null, recipientType: 'VIEWER' }])).toBeNull()
  })
})

describe('buildSignedArtifactFileName', () => {
  const title = 'MSA - Acme Corp'
  const executedAt = '2026-07-20T09:30:00.000Z'

  it('names the executed contract with the "Signed" suffix', () => {
    expect(buildSignedArtifactFileName({ title, artifact: 'signed_document', executedAt })).toBe(
      'MSA - Acme Corp - Signed - 20-07-2026.pdf'
    )
  })

  it('names the completion certificate with its own suffix', () => {
    expect(buildSignedArtifactFileName({ title, artifact: 'completion_certificate', executedAt })).toBe(
      'MSA - Acme Corp - Completion Certificate - 20-07-2026.pdf'
    )
  })

  it('names the merged artifact with the "Signed with Certificate" suffix', () => {
    expect(buildSignedArtifactFileName({ title, artifact: 'merged_pdf', executedAt })).toBe(
      'MSA - Acme Corp - Signed with Certificate - 20-07-2026.pdf'
    )
  })

  it('omits the date segment entirely when the execution date is unknown', () => {
    const result = buildSignedArtifactFileName({ title, artifact: 'signed_document', executedAt: null })

    expect(result).toBe('MSA - Acme Corp - Signed.pdf')
    expect(result).not.toContain('Invalid Date')
  })

  it('uses the fallback title when the contract title is empty', () => {
    expect(buildSignedArtifactFileName({ title: '', artifact: 'signed_document', executedAt })).toBe(
      'Contract - Signed - 20-07-2026.pdf'
    )
  })

  it('keeps the assembled name under 200 characters for a very long title', () => {
    const result = buildSignedArtifactFileName({
      title: 'B'.repeat(400),
      artifact: 'merged_pdf',
      executedAt,
    })

    expect(result.length).toBeLessThan(200)
  })
})

describe('resolveDocumentDownloadFileName', () => {
  const contractTitle = 'MSA - Acme Corp'
  const executedAt = '2026-07-20T09:30:00.000Z'

  it('renames the executed contract', () => {
    const result = resolveDocumentDownloadFileName({
      documentKind: 'EXECUTED_CONTRACT',
      fileName: 'executed-envelope-123.pdf',
      contractTitle,
      executedAt,
    })

    expect(result).toBe('MSA - Acme Corp - Signed - 20-07-2026.pdf')
  })

  it('renames the audit certificate', () => {
    const result = resolveDocumentDownloadFileName({
      documentKind: 'AUDIT_CERTIFICATE',
      fileName: 'audit-certificate-envelope-123.pdf',
      contractTitle,
      executedAt,
    })

    expect(result).toBe('MSA - Acme Corp - Completion Certificate - 20-07-2026.pdf')
  })

  it('leaves primary documents on their uploaded filename', () => {
    const result = resolveDocumentDownloadFileName({
      documentKind: 'PRIMARY',
      fileName: 'MSA_Acme.docx',
      contractTitle,
      executedAt,
    })

    expect(result).toBe('MSA_Acme.docx')
  })

  it('leaves counterparty supporting documents on their uploaded filename', () => {
    const result = resolveDocumentDownloadFileName({
      documentKind: 'COUNTERPARTY_SUPPORTING',
      fileName: 'board-resolution.pdf',
      contractTitle,
      executedAt,
    })

    expect(result).toBe('board-resolution.pdf')
  })
})
