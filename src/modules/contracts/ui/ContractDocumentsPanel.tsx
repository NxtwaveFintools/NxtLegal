'use client'

import { useMemo, useState } from 'react'
import { contractsClient, type ContractAdditionalApprover, type ContractDocument } from '@/core/client/contracts-client'
import { contractDocumentKinds, contractStatuses } from '@/core/constants/contracts'
import Spinner from '@/components/ui/Spinner'
import { toast } from 'sonner'
import workspaceStyles from '@/modules/contracts/ui/contracts-workspace.module.css'

type ContractDocumentsPanelProps = {
  contractId: string
  contractStatus: string
  userRole?: string
  actorEmployeeId?: string
  additionalApprovers?: ContractAdditionalApprover[]
  counterparties?: Array<{ id: string; counterpartyName: string }>
  uploadedByEmployeeId?: string
  currentDocumentId?: string | null
  documents: ContractDocument[]
  defaultUploaderEmail?: string
  onPreviewDocument: (document: ContractDocument) => Promise<void> | void
  onDownloadDocument: (document: ContractDocument) => void
  onRefreshDocuments: () => Promise<void>
  isPreparingPreview?: boolean
  previewingDocumentId?: string | null
}

type ExtendedDocument = ContractDocument & {
  uploadedByRole?: string
  uploadedByName?: string
  uploadedByEmail?: string
}

const toExtendedDocument = (document: ContractDocument): ExtendedDocument => {
  const value = document as unknown as Record<string, unknown>

  return {
    ...document,
    uploadedByRole:
      typeof value.uploadedByRole === 'string'
        ? value.uploadedByRole
        : typeof value.uploaded_role === 'string'
          ? value.uploaded_role
          : undefined,
    uploadedByName:
      typeof value.uploadedByName === 'string'
        ? value.uploadedByName
        : typeof value.uploaded_by_name === 'string'
          ? value.uploaded_by_name
          : undefined,
    uploadedByEmail:
      typeof value.uploadedByEmail === 'string'
        ? value.uploadedByEmail
        : typeof value.uploaded_by_email === 'string'
          ? value.uploaded_by_email
          : undefined,
  }
}

const formatDate = (isoDate: string): string => {
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) {
    return '—'
  }

  return parsed.toLocaleString()
}

const formatType = (mimeType: string): string => {
  if (mimeType.includes('wordprocessingml')) {
    return 'DOCX'
  }

  if (mimeType.includes('msword')) {
    return 'DOC'
  }

  if (mimeType.includes('pdf')) {
    return 'PDF'
  }

  return mimeType
}

const getVersionLabel = (document: ContractDocument): string => {
  return typeof document.versionNumber === 'number' ? `v${document.versionNumber}` : 'v—'
}

const ActiveVersionCard = (props: {
  document: ExtendedDocument
  canReplace: boolean
  onPreview: () => void
  isPreviewLoading: boolean
  isPreviewDisabled: boolean
  onDownload: () => void
  onReplace: () => void
  replaceDisabledMessage?: string
  defaultUploaderEmail?: string
}) => {
  const uploaderRole = props.document.uploadedByRole ?? '—'
  const uploaderNameOrEmail =
    props.document.uploadedByName ?? props.document.uploadedByEmail ?? props.defaultUploaderEmail ?? '—'

  return (
    <div className={workspaceStyles.card}>
      <div className={workspaceStyles.sectionTitle}>{`Active Version ${getVersionLabel(props.document)}`}</div>
      <div className={workspaceStyles.row}>
        <span>File name</span>
        <span>{props.document.fileName}</span>
      </div>
      <div className={workspaceStyles.row}>
        <span>File type</span>
        <span>{formatType(props.document.fileMimeType)}</span>
      </div>
      <div className={workspaceStyles.row}>
        <span>Uploaded by</span>
        <span>{`${uploaderRole} · ${uploaderNameOrEmail}`}</span>
      </div>
      <div className={workspaceStyles.row}>
        <span>Uploaded date</span>
        <span>{formatDate(props.document.createdAt)}</span>
      </div>
      <div className={workspaceStyles.actions}>
        <button
          type="button"
          className={workspaceStyles.button}
          onClick={props.onPreview}
          disabled={props.isPreviewDisabled}
        >
          {props.isPreviewLoading ? (
            <span className={workspaceStyles.buttonContent}>
              <Spinner size={14} />
              Opening...
            </span>
          ) : (
            'Preview'
          )}
        </button>
        <button
          type="button"
          className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
          onClick={props.onDownload}
        >
          Download
        </button>
        {props.canReplace ? (
          <button
            type="button"
            className={`${workspaceStyles.button} ${workspaceStyles.buttonPrimary}`}
            onClick={props.onReplace}
          >
            Replace Document
          </button>
        ) : null}
      </div>
      {!props.canReplace && props.replaceDisabledMessage ? (
        <div className={workspaceStyles.eventMeta}>{props.replaceDisabledMessage}</div>
      ) : null}
    </div>
  )
}

const VersionHistoryTable = (props: {
  documents: ExtendedDocument[]
  currentDocumentId?: string | null
  fallbackCurrentId?: string
  defaultUploaderEmail?: string
  onDownload: (document: ExtendedDocument) => void
  onPreview: (document: ExtendedDocument) => void
  isPreparingPreview: boolean
  previewingDocumentId?: string | null
}) => {
  return (
    <div className={workspaceStyles.card}>
      <div className={workspaceStyles.sectionTitle}>Version History</div>
      <div className={workspaceStyles.timeline}>
        {props.documents.map((document) => {
          const isCurrent =
            (props.currentDocumentId && document.id === props.currentDocumentId) ||
            (!props.currentDocumentId && props.fallbackCurrentId === document.id)
          const uploaderRole = document.uploadedByRole ?? '—'
          const uploaderNameOrEmail =
            document.uploadedByName ?? document.uploadedByEmail ?? props.defaultUploaderEmail ?? '—'
          const isPreviewLoading = props.isPreparingPreview && props.previewingDocumentId === document.id

          return (
            <div key={document.id} className={workspaceStyles.documentRow}>
              <div className={workspaceStyles.documentMeta}>
                <div className={workspaceStyles.eventActor}>
                  {getVersionLabel(document)} {isCurrent ? '· Current' : ''}
                </div>
                <div className={workspaceStyles.itemMeta}>{document.fileName}</div>
                <div className={workspaceStyles.itemMeta}>{formatType(document.fileMimeType)}</div>
                <div className={workspaceStyles.itemMeta}>{`${uploaderRole} · ${uploaderNameOrEmail}`}</div>
                <div className={workspaceStyles.itemMeta}>{formatDate(document.createdAt)}</div>
              </div>
              <div className={workspaceStyles.actions}>
                <button
                  type="button"
                  className={workspaceStyles.button}
                  onClick={() => props.onPreview(document)}
                  disabled={props.isPreparingPreview}
                >
                  {isPreviewLoading ? (
                    <span className={workspaceStyles.buttonContent}>
                      <Spinner size={14} />
                      Opening...
                    </span>
                  ) : (
                    'Preview'
                  )}
                </button>
                <button
                  type="button"
                  className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                  onClick={() => props.onDownload(document)}
                >
                  Download
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ContractDocumentsPanel(props: ContractDocumentsPanelProps) {
  const {
    contractId,
    contractStatus,
    userRole,
    actorEmployeeId,
    additionalApprovers = [],
    counterparties = [],
    currentDocumentId,
    documents,
    defaultUploaderEmail,
    onPreviewDocument,
    onDownloadDocument,
    onRefreshDocuments,
    isPreparingPreview = false,
    previewingDocumentId,
  } = props

  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false)
  const [replacementFile, setReplacementFile] = useState<File | null>(null)
  const [isFinalExecuted, setIsFinalExecuted] = useState(false)
  const [isSupportingReplaceModalOpen, setIsSupportingReplaceModalOpen] = useState(false)
  const [supportingReplacementFile, setSupportingReplacementFile] = useState<File | null>(null)
  const [selectedSupportingDocument, setSelectedSupportingDocument] = useState<ExtendedDocument | null>(null)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTarget, setUploadTarget] = useState<{
    category: 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY'
    counterpartyId?: string
    label: string
  } | null>(null)

  const primaryDocuments = useMemo(() => {
    return documents
      .filter((document) => document.documentKind === contractDocumentKinds.primary)
      .sort((a, b) => {
        const aVersion = typeof a.versionNumber === 'number' ? a.versionNumber : 0
        const bVersion = typeof b.versionNumber === 'number' ? b.versionNumber : 0

        if (aVersion !== bVersion) {
          return bVersion - aVersion
        }

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      .map(toExtendedDocument)
  }, [documents])

  const completionArtifacts = useMemo(() => {
    return documents
      .filter(
        (document) =>
          document.documentKind === contractDocumentKinds.executedContract ||
          document.documentKind === contractDocumentKinds.auditCertificate
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(toExtendedDocument)
  }, [documents])

  const supportingDocumentsByCounterparty = useMemo(() => {
    const supportingDocuments = documents
      .filter((document) => document.documentKind === contractDocumentKinds.counterpartySupporting)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(toExtendedDocument)

    const groupedDocuments = new Map<string, { key: string; label: string; documents: ExtendedDocument[] }>()

    for (const document of supportingDocuments) {
      const normalizedCounterpartyName = document.counterpartyName?.trim() || ''
      let label: string
      let key: string

      if (document.counterpartyId?.trim()) {
        key = document.counterpartyId.trim()
        label = normalizedCounterpartyName || 'Supporting Documents'
      } else {
        const isAdditional = (document.displayName ?? '').toLowerCase().startsWith('additional')
        key = isAdditional ? 'additional-supporting' : 'budget-supporting'
        label = isAdditional ? 'Additional Supporting Documents' : 'Founder Approval Supporting Documents'
      }

      const existingGroup = groupedDocuments.get(key)
      if (existingGroup) {
        existingGroup.documents.push(document)
        continue
      }

      groupedDocuments.set(key, {
        key,
        label,
        documents: [document],
      })
    }

    return Array.from(groupedDocuments.values())
  }, [documents])

  const activeDocument = useMemo(() => {
    if (!primaryDocuments.length) {
      return null
    }

    if (currentDocumentId) {
      return primaryDocuments.find((document) => document.id === currentDocumentId) ?? null
    }

    return primaryDocuments[0]
  }, [currentDocumentId, primaryDocuments])

  const actorAdditionalApproverAssignments = useMemo(() => {
    const normalizedActorEmployeeId = actorEmployeeId?.trim()
    if (!normalizedActorEmployeeId) {
      return []
    }

    return additionalApprovers.filter((approver) => approver.approverEmployeeId === normalizedActorEmployeeId)
  }, [actorEmployeeId, additionalApprovers])

  const isAdditionalApproverParticipant = actorAdditionalApproverAssignments.length > 0
  const hasPendingAdditionalApproverAssignment = actorAdditionalApproverAssignments.some(
    (approver) => approver.status === 'PENDING'
  )
  const isPrivilegedReplacementRole = userRole === 'LEGAL_TEAM' || userRole === 'ADMIN'
  const isBlockedAdditionalApproverReplacement =
    !isPrivilegedReplacementRole && isAdditionalApproverParticipant && !hasPendingAdditionalApproverAssignment

  const replacementStatusesForLegal = new Set<string>([
    contractStatuses.pendingInternal,
    contractStatuses.pendingExternal,
    contractStatuses.offlineExecution,
    contractStatuses.onHold,
    contractStatuses.completed,
  ])
  const adminOnlyReplacementStatuses = new Set<string>([contractStatuses.rejected, contractStatuses.void])
  const canLegalReplaceInCurrentStatus = replacementStatusesForLegal.has(contractStatus)
  const canAdminReplaceInCurrentStatus =
    canLegalReplaceInCurrentStatus || adminOnlyReplacementStatuses.has(contractStatus)
  const canMarkFinalExecuted = userRole === 'LEGAL_TEAM' || userRole === 'ADMIN'
  const canReplaceInUnderReview = contractStatus === contractStatuses.underReview
  const canReplaceByRoleAndStatus =
    canReplaceInUnderReview ||
    (userRole === 'LEGAL_TEAM' && canLegalReplaceInCurrentStatus) ||
    (userRole === 'ADMIN' && canAdminReplaceInCurrentStatus)
  const canReplace = canReplaceByRoleAndStatus && !isBlockedAdditionalApproverReplacement
  const canReplaceSupporting = canReplace

  const supportingUploadAllowedStatuses = new Set<string>([
    contractStatuses.draft,
    contractStatuses.uploaded,
    contractStatuses.hodPending,
    contractStatuses.underReview,
    contractStatuses.pendingInternal,
    contractStatuses.pendingExternal,
    contractStatuses.offlineExecution,
    contractStatuses.onHold,
  ])
  const isUploaderActor = Boolean(
    actorEmployeeId && props.uploadedByEmployeeId && actorEmployeeId === props.uploadedByEmployeeId
  )
  const canUploadSupporting =
    supportingUploadAllowedStatuses.has(contractStatus) &&
    (userRole === 'LEGAL_TEAM' || userRole === 'ADMIN' || userRole === 'HOD' || isUploaderActor)

  const replaceDisabledMessage = isBlockedAdditionalApproverReplacement
    ? 'Replacement is available for additional approvers only while their approval is pending.'
    : contractStatus === contractStatuses.signing
      ? 'Replacement is unavailable while contract is in signing.'
      : contractStatus === contractStatuses.rejected || contractStatus === contractStatuses.void
        ? 'Replacement is restricted to Admin for rejected/void contracts.'
        : 'Replacement is unavailable for this contract status.'
  const supportingReplaceDisabledMessage = isBlockedAdditionalApproverReplacement
    ? 'Supporting replacement is available for additional approvers only while their approval is pending.'
    : contractStatus === contractStatuses.signing
      ? 'Supporting document replacement is unavailable while contract is in signing.'
      : contractStatus === contractStatuses.rejected || contractStatus === contractStatuses.void
        ? 'Supporting document replacement is restricted to Admin for rejected/void contracts.'
        : 'Supporting document replacement is unavailable for this contract status.'

  const openReplaceModal = () => {
    setIsReplaceModalOpen(true)
  }

  const closeReplaceModal = () => {
    setIsReplaceModalOpen(false)
    setReplacementFile(null)
    setIsFinalExecuted(false)
  }

  const openSupportingReplaceModal = (document: ExtendedDocument) => {
    setSelectedSupportingDocument(document)
    setIsSupportingReplaceModalOpen(true)
  }

  const closeSupportingReplaceModal = () => {
    setIsSupportingReplaceModalOpen(false)
    setSupportingReplacementFile(null)
    setSelectedSupportingDocument(null)
  }

  const handleReplaceSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!replacementFile) {
      toast.error('Please select a file to replace the active document')
      return
    }

    const selectedFile = replacementFile
    const shouldMarkExecuted = isFinalExecuted

    // Close immediately so upload runs in the background without blocking the workspace.
    closeReplaceModal()

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    const uploadPromise = contractsClient
      .replaceMainDocument({
        contractId,
        file: selectedFile,
        idempotencyKey,
        isFinalExecuted: shouldMarkExecuted,
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.error?.message ?? 'Failed to replace document')
        }

        await onRefreshDocuments()
        return response
      })

    toast.promise(uploadPromise, {
      loading: 'Uploading replacement document...',
      success: shouldMarkExecuted
        ? 'Document replaced and contract marked as Executed'
        : 'Document replaced successfully',
      error: (error) => (error instanceof Error ? error.message : 'Failed to replace document'),
    })

    void uploadPromise
  }

  const handleSupportingReplaceSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedSupportingDocument) {
      toast.error('Supporting document context is missing')
      return
    }

    if (!supportingReplacementFile) {
      toast.error('Please select a file to replace this supporting document')
      return
    }

    const selectedFile = supportingReplacementFile
    const sourceDocumentId = selectedSupportingDocument.id

    closeSupportingReplaceModal()

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    const uploadPromise = contractsClient
      .replaceSupportingDocument({
        contractId,
        documentId: sourceDocumentId,
        file: selectedFile,
        idempotencyKey,
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.error?.message ?? 'Failed to replace supporting document')
        }

        await onRefreshDocuments()
        return response
      })

    toast.promise(uploadPromise, {
      loading: 'Uploading supporting replacement document...',
      success: 'Supporting document replaced successfully',
      error: (error) => (error instanceof Error ? error.message : 'Failed to replace supporting document'),
    })

    void uploadPromise
  }

  const openUploadModal = (target: {
    category: 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY'
    counterpartyId?: string
    label: string
  }) => {
    setUploadTarget(target)
    setIsUploadModalOpen(true)
  }

  const closeUploadModal = () => {
    setIsUploadModalOpen(false)
    setUploadFile(null)
    setUploadTarget(null)
  }

  const handleUploadSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!uploadTarget) {
      toast.error('Upload section context is missing')
      return
    }

    if (!uploadFile) {
      toast.error('Please select a file to upload')
      return
    }

    const selectedFile = uploadFile
    const target = uploadTarget

    closeUploadModal()

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    const uploadPromise = contractsClient
      .addSupportingDocument({
        contractId,
        sectionCategory: target.category,
        counterpartyId: target.counterpartyId,
        file: selectedFile,
        idempotencyKey,
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.error?.message ?? 'Failed to upload document')
        }

        await onRefreshDocuments()
        return response
      })

    toast.promise(uploadPromise, {
      loading: `Uploading to ${target.label}...`,
      success: 'Document uploaded successfully',
      error: (error) => (error instanceof Error ? error.message : 'Failed to upload document'),
    })

    void uploadPromise
  }

  if (!activeDocument) {
    return (
      <div className={workspaceStyles.card}>
        <div className={workspaceStyles.sectionTitle}>Documents</div>
        <div className={workspaceStyles.placeholderRow}>No primary contract versions found.</div>
      </div>
    )
  }

  return (
    <div className={workspaceStyles.tabSection}>
      <ActiveVersionCard
        document={activeDocument}
        canReplace={canReplace}
        onPreview={() => {
          void props.onPreviewDocument(activeDocument)
        }}
        isPreviewLoading={isPreparingPreview && previewingDocumentId === activeDocument.id}
        isPreviewDisabled={isPreparingPreview}
        onDownload={() => props.onDownloadDocument(activeDocument)}
        onReplace={openReplaceModal}
        replaceDisabledMessage={replaceDisabledMessage}
        defaultUploaderEmail={defaultUploaderEmail}
      />

      <VersionHistoryTable
        documents={primaryDocuments}
        currentDocumentId={currentDocumentId}
        fallbackCurrentId={primaryDocuments[0]?.id}
        onDownload={(document) => onDownloadDocument(document)}
        onPreview={(document) => onPreviewDocument(document)}
        defaultUploaderEmail={defaultUploaderEmail}
        isPreparingPreview={isPreparingPreview}
        previewingDocumentId={previewingDocumentId}
      />

      {completionArtifacts.length > 0 ? (
        <div className={workspaceStyles.card}>
          <div className={workspaceStyles.sectionTitle}>Execution Artifacts</div>
          <div className={workspaceStyles.timeline}>
            {completionArtifacts.map((document) => {
              const artifactLabel =
                document.documentKind === 'EXECUTED_CONTRACT' ? 'Executed Contract' : 'Completion Certificate'
              const isPreviewLoading = isPreparingPreview && previewingDocumentId === document.id

              return (
                <div key={document.id} className={workspaceStyles.documentRow}>
                  <div className={workspaceStyles.documentMeta}>
                    <div className={workspaceStyles.eventActor}>{artifactLabel}</div>
                    <div className={workspaceStyles.itemMeta}>{document.fileName}</div>
                    <div className={workspaceStyles.itemMeta}>{formatDate(document.createdAt)}</div>
                  </div>
                  <div className={workspaceStyles.actions}>
                    <button
                      type="button"
                      className={workspaceStyles.button}
                      onClick={() => {
                        void onPreviewDocument(document)
                      }}
                      disabled={isPreparingPreview}
                    >
                      {isPreviewLoading ? (
                        <span className={workspaceStyles.buttonContent}>
                          <Spinner size={14} />
                          Opening...
                        </span>
                      ) : (
                        'Preview'
                      )}
                    </button>
                    <button
                      type="button"
                      className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                      onClick={() => onDownloadDocument(document)}
                    >
                      Download
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {(() => {
        const groupsByKey = new Map(supportingDocumentsByCounterparty.map((group) => [group.key, group]))

        const sections: Array<{
          key: string
          label: string
          category: 'BUDGET' | 'ADDITIONAL' | 'COUNTERPARTY'
          counterpartyId?: string
          documents: ExtendedDocument[]
        }> = [
          {
            key: 'budget-supporting',
            label: 'Founder Approval Supporting Documents',
            category: 'BUDGET',
            documents: groupsByKey.get('budget-supporting')?.documents ?? [],
          },
          {
            key: 'additional-supporting',
            label: 'Additional Supporting Documents',
            category: 'ADDITIONAL',
            documents: groupsByKey.get('additional-supporting')?.documents ?? [],
          },
          ...counterparties.map((counterparty) => ({
            key: counterparty.id,
            label: counterparty.counterpartyName,
            category: 'COUNTERPARTY' as const,
            counterpartyId: counterparty.id,
            documents: groupsByKey.get(counterparty.id)?.documents ?? [],
          })),
        ]

        // Include any grouped counterparty documents whose counterparty is not in the
        // provided counterparties list (e.g. removed counterparties) so existing docs are not orphaned.
        const knownKeys = new Set(sections.map((section) => section.key))
        for (const group of supportingDocumentsByCounterparty) {
          if (knownKeys.has(group.key)) {
            continue
          }
          sections.push({
            key: group.key,
            label: group.label,
            category: 'COUNTERPARTY',
            counterpartyId: group.key,
            documents: group.documents,
          })
        }

        return (
          <div className={workspaceStyles.card}>
            <div className={workspaceStyles.sectionTitle}>Counterparty Supporting Documents</div>
            <div className={workspaceStyles.timeline}>
              {sections.map((section) => (
                <div key={section.key} data-section={section.key} className={workspaceStyles.event}>
                  <div className={workspaceStyles.sectionHeaderRow}>
                    <div className={workspaceStyles.eventActor}>{section.label}</div>
                    <div className={workspaceStyles.actions}>
                      {canUploadSupporting ? (
                        <button
                          type="button"
                          className={`${workspaceStyles.button} ${workspaceStyles.buttonPrimary}`}
                          onClick={() =>
                            openUploadModal({
                              category: section.category,
                              counterpartyId: section.counterpartyId,
                              label: section.label,
                            })
                          }
                        >
                          Upload
                        </button>
                      ) : null}
                      {canReplaceSupporting && section.documents[0] ? (
                        <button
                          type="button"
                          className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                          onClick={() => openSupportingReplaceModal(section.documents[0])}
                        >
                          Replace Document
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {section.documents.length === 0 ? (
                    <div className={workspaceStyles.placeholderRow}>No documents uploaded yet.</div>
                  ) : (
                    <div className={workspaceStyles.timeline}>
                      {section.documents.map((document) => {
                        const isPreviewLoading = isPreparingPreview && previewingDocumentId === document.id

                        return (
                          <div key={document.id} className={workspaceStyles.documentRow}>
                            <div className={workspaceStyles.documentMeta}>
                              <div className={workspaceStyles.itemMeta}>{document.fileName}</div>
                              <div className={workspaceStyles.itemMeta}>{formatDate(document.createdAt)}</div>
                            </div>
                            <div className={workspaceStyles.actions}>
                              <button
                                type="button"
                                className={workspaceStyles.button}
                                onClick={() => {
                                  void onPreviewDocument(document)
                                }}
                                disabled={isPreparingPreview}
                              >
                                {isPreviewLoading ? (
                                  <span className={workspaceStyles.buttonContent}>
                                    <Spinner size={14} />
                                    Opening...
                                  </span>
                                ) : (
                                  'Preview'
                                )}
                              </button>
                              <button
                                type="button"
                                className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                                onClick={() => onDownloadDocument(document)}
                              >
                                Download
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!canReplaceSupporting &&
            supportingReplaceDisabledMessage &&
            sections.some((section) => section.documents.length > 0) ? (
              <div className={workspaceStyles.eventMeta}>{supportingReplaceDisabledMessage}</div>
            ) : null}
          </div>
        )
      })()}

      {isReplaceModalOpen ? (
        <div
          className={workspaceStyles.actionRemarkOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Replace document"
        >
          <form className={workspaceStyles.actionRemarkModal} onSubmit={handleReplaceSubmit}>
            <div className={workspaceStyles.replacementModalTitle}>Replace Document</div>
            <label className={workspaceStyles.replacementModalField}>
              <span>Replacement file</span>
              <input
                type="file"
                className={workspaceStyles.input}
                accept=".doc,.docx,.pdf"
                onChange={(event) => setReplacementFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {canMarkFinalExecuted ? (
              <label className={workspaceStyles.replacementCheckboxRow}>
                <input
                  type="checkbox"
                  name="isFinalExecuted"
                  checked={isFinalExecuted}
                  onChange={(event) => setIsFinalExecuted(event.target.checked)}
                />
                <span>Is this the final executed document?</span>
              </label>
            ) : null}
            <div className={workspaceStyles.actionRemarkActions}>
              <button
                type="button"
                className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                onClick={closeReplaceModal}
              >
                Cancel
              </button>
              <button type="submit" className={`${workspaceStyles.button} ${workspaceStyles.buttonPrimary}`}>
                Upload
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isSupportingReplaceModalOpen ? (
        <div
          className={workspaceStyles.actionRemarkOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Replace supporting document"
        >
          <form className={workspaceStyles.actionRemarkModal} onSubmit={handleSupportingReplaceSubmit}>
            <div className={workspaceStyles.replacementModalTitle}>Replace Supporting Document</div>
            <label className={workspaceStyles.replacementModalField}>
              <span>Replacement file</span>
              <input
                type="file"
                className={workspaceStyles.input}
                accept=".doc,.docx,.pdf"
                onChange={(event) => setSupportingReplacementFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className={workspaceStyles.actionRemarkActions}>
              <button
                type="button"
                className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                onClick={closeSupportingReplaceModal}
              >
                Cancel
              </button>
              <button type="submit" className={`${workspaceStyles.button} ${workspaceStyles.buttonPrimary}`}>
                Upload
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isUploadModalOpen ? (
        <div
          className={workspaceStyles.actionRemarkOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Upload supporting document"
        >
          <form className={workspaceStyles.actionRemarkModal} onSubmit={handleUploadSubmit}>
            <div className={workspaceStyles.replacementModalTitle}>
              {uploadTarget ? `Upload to ${uploadTarget.label}` : 'Upload Supporting Document'}
            </div>
            <label className={workspaceStyles.replacementModalField}>
              <span>File</span>
              <input
                type="file"
                className={workspaceStyles.input}
                accept=".doc,.docx,.pdf,.png,.jpg,.jpeg"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className={workspaceStyles.actionRemarkActions}>
              <button
                type="button"
                className={`${workspaceStyles.button} ${workspaceStyles.buttonGhost}`}
                onClick={closeUploadModal}
              >
                Cancel
              </button>
              <button type="submit" className={`${workspaceStyles.button} ${workspaceStyles.buttonPrimary}`}>
                Upload
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
