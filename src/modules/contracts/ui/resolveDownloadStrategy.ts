import type { ContractDocumentKind } from '@/core/domain/contracts/signed-document-filename'

export type DownloadStrategy = 'final_signed_document' | 'final_completion_certificate' | 'generic'

/**
 * Signing artifacts are served by the final-artifact endpoint, which applies
 * the friendly filename. Everything else uses the generic download route,
 * where the stored filename is already the uploader's own.
 */
export function resolveDownloadStrategy(documentKind: ContractDocumentKind): DownloadStrategy {
  if (documentKind === 'EXECUTED_CONTRACT') {
    return 'final_signed_document'
  }

  if (documentKind === 'AUDIT_CERTIFICATE') {
    return 'final_completion_certificate'
  }

  return 'generic'
}
