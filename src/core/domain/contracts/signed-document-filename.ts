import {
  contractSignatoryRecipientTypes,
  contractSignatoryStatuses,
  contractSigningSubject,
} from '@/core/constants/contracts'

export type SignedArtifactType = 'signed_document' | 'completion_certificate' | 'merged_pdf'

export type ContractDocumentKind = 'PRIMARY' | 'COUNTERPARTY_SUPPORTING' | 'EXECUTED_CONTRACT' | 'AUDIT_CERTIFICATE'

const artifactSuffixes: Record<SignedArtifactType, string> = {
  signed_document: 'Signed',
  completion_certificate: 'Completion Certificate',
  merged_pdf: 'Signed with Certificate',
}

const maxTitleLength = 120

// Characters illegal in filenames on Windows and/or POSIX, listed explicitly.
// Space and hyphen are deliberately absent: spaces are handled by the
// whitespace collapse below, and hyphens are required by the " - " separator.
const illegalFileNameCharacters = /["*/:<>?\\|]/g

// C0 control characters, written as \x escapes so no literal control byte
// ever appears in this source file.
const controlCharacters = /[\x00-\x1f]/g

// Built server-side, where the process timezone is typically UTC. Pinned to
// India so the date in the filename matches the date the user considers the
// contract executed.
const executionDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export function sanitizeTitleForFileName(title: string): string {
  const cleaned = (title ?? '')
    .replace(illegalFileNameCharacters, ' ')
    .replace(controlCharacters, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned.length === 0) {
    return contractSigningSubject.missingDocumentFallbackTitle
  }

  return cleaned.length > maxTitleLength ? cleaned.slice(0, maxTitleLength).trim() : cleaned
}

export function formatExecutionDate(executedAt: string | null | undefined): string | null {
  if (!executedAt) {
    return null
  }

  const parsed = new Date(executedAt)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return executionDateFormatter.format(parsed).replace(/\//g, '-')
}

/**
 * The execution date is the latest signature timestamp, and only once every
 * signatory has signed.
 *
 * Viewers are copied on the envelope for visibility and never sign, so they
 * must not hold the date back. Mirrors `allSignatoriesSigned` in
 * ContractsWorkspace, which filters the same way.
 */
export function resolveExecutedAt(
  signatories: Array<{ status: string; signedAt: string | null; recipientType?: string }>
): string | null {
  const signers = signatories.filter((signatory) => signatory.recipientType !== contractSignatoryRecipientTypes.viewer)

  if (signers.length === 0) {
    return null
  }

  let latestSignedAt: string | null = null

  for (const signatory of signers) {
    if (signatory.status !== contractSignatoryStatuses.signed || !signatory.signedAt) {
      return null
    }

    if (!latestSignedAt || signatory.signedAt > latestSignedAt) {
      latestSignedAt = signatory.signedAt
    }
  }

  return latestSignedAt
}

export function buildSignedArtifactFileName(params: {
  title: string
  artifact: SignedArtifactType
  executedAt?: string | null
}): string {
  const safeTitle = sanitizeTitleForFileName(params.title)
  const formattedDate = formatExecutionDate(params.executedAt)
  const suffix = artifactSuffixes[params.artifact]

  const segments = formattedDate ? [safeTitle, suffix, formattedDate] : [safeTitle, suffix]

  return `${segments.join(' - ')}.pdf`
}

/**
 * The user-facing filename for a document. Signing artifacts get a friendly
 * generated name; primary and supporting documents keep the uploader's own
 * filename, which is already human-readable.
 */
export function resolveDocumentDownloadFileName(params: {
  documentKind: ContractDocumentKind
  fileName: string
  contractTitle: string
  executedAt: string | null
}): string {
  if (params.documentKind === 'EXECUTED_CONTRACT') {
    return buildSignedArtifactFileName({
      title: params.contractTitle,
      artifact: 'signed_document',
      executedAt: params.executedAt,
    })
  }

  if (params.documentKind === 'AUDIT_CERTIFICATE') {
    return buildSignedArtifactFileName({
      title: params.contractTitle,
      artifact: 'completion_certificate',
      executedAt: params.executedAt,
    })
  }

  return params.fileName
}
