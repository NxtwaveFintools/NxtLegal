/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ContractDocumentsPanel from '@/modules/contracts/ui/ContractDocumentsPanel'
import { contractsClient, type ContractDocument } from '@/core/client/contracts-client'

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    promise: jest.fn((promise: Promise<unknown>) => promise),
  },
}))

const makeDoc = (overrides: Partial<ContractDocument> = {}): ContractDocument => ({
  id: 'doc-1',
  documentKind: 'PRIMARY',
  versionNumber: 1,
  displayName: 'Primary Contract',
  fileName: 'contract-v1.docx',
  fileSizeBytes: 2048,
  fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  createdAt: '2026-02-24T10:00:00.000Z',
  ...overrides,
})

const makeSupportingDoc = (overrides: Partial<ContractDocument> = {}): ContractDocument => ({
  id: 'supporting-doc-1',
  documentKind: 'COUNTERPARTY_SUPPORTING',
  displayName: 'Counterparty Docs - Acme Corp (1)',
  counterpartyId: 'counterparty-1',
  counterpartyName: 'Acme Corp',
  fileName: 'acme-supporting-v1.pdf',
  fileSizeBytes: 1024,
  fileMimeType: 'application/pdf',
  createdAt: '2026-02-24T11:00:00.000Z',
  ...overrides,
})

describe('ContractDocumentsPanel', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('hides Replace button when role is not LEGAL_TEAM', async () => {
    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="POC"
        currentDocumentId="doc-1"
        documents={[makeDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    expect(screen.queryByRole('button', { name: 'Replace Document' })).toBeNull()
  })

  it('hides Replace button for original uploader when role is POC', async () => {
    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="POC"
        actorEmployeeId="poc-1"
        uploadedByEmployeeId="poc-1"
        currentDocumentId="doc-1"
        documents={[makeDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    expect(screen.queryByRole('button', { name: 'Replace Document' })).toBeNull()
  })

  it('hides Replace button for POC when actor is not original uploader', async () => {
    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="POC"
        actorEmployeeId="poc-2"
        uploadedByEmployeeId="poc-1"
        currentDocumentId="doc-1"
        documents={[makeDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    expect(screen.queryByRole('button', { name: 'Replace Document' })).toBeNull()
  })

  it('shows Replace button for non-legal users in UNDER_REVIEW status', async () => {
    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        userRole="POC"
        actorEmployeeId="poc-2"
        uploadedByEmployeeId="poc-1"
        currentDocumentId="doc-1"
        documents={[makeDoc(), makeSupportingDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    const replaceButtons = screen.getAllByRole('button', { name: 'Replace Document' })
    expect(replaceButtons.length).toBe(2)
  })

  it('shows Replace button when status is PENDING_WITH_EXTERNAL_STAKEHOLDERS for legal team', async () => {
    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="PENDING_WITH_EXTERNAL_STAKEHOLDERS"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-1"
        documents={[makeDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    expect(screen.getByRole('button', { name: 'Replace Document' })).toBeTruthy()
  })

  it('shows active version using current document version number', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', versionNumber: 1 }),
      makeDoc({ id: 'doc-2', versionNumber: 2, fileName: 'contract-v2.pdf', fileMimeType: 'application/pdf' }),
    ]

    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-2"
        documents={docs}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    await waitFor(() => expect(screen.getByText('Active Version v2')).toBeTruthy())
  })

  it('renders multiple versions in Version History', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', versionNumber: 1, fileName: 'contract-v1.docx' }),
      makeDoc({ id: 'doc-2', versionNumber: 2, fileName: 'contract-v2.pdf', fileMimeType: 'application/pdf' }),
      makeDoc({ id: 'doc-3', versionNumber: 3, fileName: 'contract-v3.docx' }),
    ]

    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-3"
        documents={docs}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    expect(await screen.findByText('Version History')).toBeTruthy()
    expect(screen.getByText('contract-v1.docx')).toBeTruthy()
    expect(screen.getByText('contract-v2.pdf')).toBeTruthy()
    expect(screen.getAllByText('contract-v3.docx').length).toBeGreaterThan(0)
  })

  it('triggers replace API call with selected file', async () => {
    const replaceSpy = jest.spyOn(contractsClient, 'replaceMainDocument').mockResolvedValue({
      ok: true,
      data: { document: makeDoc({ id: 'doc-2', versionNumber: 2 }) },
    } as never)

    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-1"
        documents={[makeDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Replace Document' }))

    const file = new File(['new version'], 'contract-v2.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Replacement file'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(replaceSpy).toHaveBeenCalled())
    expect(replaceSpy.mock.calls[0][0].contractId).toBe('contract-1')
    expect(replaceSpy.mock.calls[0][0].file.name).toBe('contract-v2.pdf')
    expect(replaceSpy.mock.calls[0][0].isFinalExecuted).toBe(false)
  })

  it('refreshes and shows replaced version as current after replace', async () => {
    jest.spyOn(contractsClient, 'replaceMainDocument').mockResolvedValue({
      ok: true,
      data: { document: makeDoc({ id: 'doc-2', versionNumber: 2 }) },
    } as never)

    const handleRefreshDocuments = jest.fn().mockResolvedValue(undefined)

    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-1"
        documents={[
          makeDoc({ id: 'doc-1', versionNumber: 1, fileName: 'contract-v1.docx' }),
          makeDoc({ id: 'doc-2', versionNumber: 2, fileName: 'contract-v2.pdf', fileMimeType: 'application/pdf' }),
        ]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={handleRefreshDocuments}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Replace Document' }))
    fireEvent.change(screen.getByLabelText('Replacement file'), {
      target: { files: [new File(['new version'], 'contract-v2.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(handleRefreshDocuments).toHaveBeenCalledTimes(1))
    expect(screen.getByText('contract-v2.pdf')).toBeTruthy()
  })

  it('forwards isFinalExecuted when checkbox is selected', async () => {
    const replaceSpy = jest.spyOn(contractsClient, 'replaceMainDocument').mockResolvedValue({
      ok: true,
      data: { document: makeDoc({ id: 'doc-2', versionNumber: 2 }) },
    } as never)

    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-1"
        documents={[makeDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Replace Document' }))
    fireEvent.change(screen.getByLabelText('Replacement file'), {
      target: { files: [new File(['executed'], 'contract-executed.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Is this the final executed document?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(replaceSpy).toHaveBeenCalled())
    expect(replaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isFinalExecuted: true,
      })
    )
  })

  it('does not show final executed checkbox when replace action is unavailable', async () => {
    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="POC"
        actorEmployeeId="poc-1"
        uploadedByEmployeeId="poc-1"
        currentDocumentId="doc-1"
        documents={[makeDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    expect(screen.queryByRole('button', { name: 'Replace Document' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Is this the final executed document?' })).toBeNull()
  })

  it('closes modal immediately after submit while upload continues in background', async () => {
    let resolveUpload!: (value: Awaited<ReturnType<typeof contractsClient.replaceMainDocument>>) => void
    const pendingUpload: ReturnType<typeof contractsClient.replaceMainDocument> = new Promise((resolve) => {
      resolveUpload = resolve
    })

    jest.spyOn(contractsClient, 'replaceMainDocument').mockReturnValue(pendingUpload as never)
    const handleRefreshDocuments = jest.fn().mockResolvedValue(undefined)

    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-1"
        documents={[makeDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={handleRefreshDocuments}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Replace Document' }))
    fireEvent.change(screen.getByLabelText('Replacement file'), {
      target: { files: [new File(['new version'], 'contract-v2.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    expect(screen.queryByRole('dialog', { name: 'Replace document' })).toBeNull()

    resolveUpload({
      ok: true,
      data: { document: makeDoc({ id: 'doc-2', versionNumber: 2 }) },
    })

    await waitFor(() => expect(handleRefreshDocuments).toHaveBeenCalledTimes(1))
  })

  it('keeps preview and download actions available for versions', async () => {
    const onPreview = jest.fn()
    const onDownload = jest.fn()

    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-1"
        documents={[
          makeDoc({ id: 'doc-1', versionNumber: 1 }),
          makeDoc({ id: 'doc-2', versionNumber: 2, fileName: 'contract-v2.pdf', fileMimeType: 'application/pdf' }),
        ]}
        onPreviewDocument={onPreview}
        onDownloadDocument={onDownload}
        onRefreshDocuments={async () => undefined}
      />
    )

    const previewButtons = screen.getAllByRole('button', { name: 'Preview' })
    const downloadButtons = screen.getAllByRole('button', { name: 'Download' })

    fireEvent.click(previewButtons[0])
    fireEvent.click(downloadButtons[0])

    expect(onPreview).toHaveBeenCalled()
    expect(onDownload).toHaveBeenCalled()
  })

  it('shows replace option for counterparty supporting docs for allowed actors', async () => {
    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        actorEmployeeId="legal-1"
        uploadedByEmployeeId="poc-1"
        currentDocumentId="doc-1"
        documents={[
          makeDoc(),
          makeSupportingDoc({ id: 'supporting-doc-1', createdAt: '2026-02-24T11:00:00.000Z' }),
          makeSupportingDoc({ id: 'supporting-doc-2', createdAt: '2026-02-24T10:00:00.000Z' }),
        ]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    const replaceButtons = screen.getAllByRole('button', { name: 'Replace Document' })
    expect(replaceButtons.length).toBe(2)
  })

  it('hides counterparty replace option once contract status is SIGNING', async () => {
    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="SIGNING"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-1"
        documents={[makeDoc(), makeSupportingDoc()]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    expect(screen.queryByRole('dialog', { name: 'Replace supporting document' })).toBeNull()
    expect(
      screen.getByText('Supporting document replacement is unavailable while contract is in signing.')
    ).toBeTruthy()
  })

  it('calls supporting replacement API with selected supporting document id', async () => {
    const replaceSupportingSpy = jest.spyOn(contractsClient, 'replaceSupportingDocument').mockResolvedValue({
      ok: true,
      data: { success: true },
    } as never)

    render(
      <ContractDocumentsPanel
        contractId="contract-1"
        contractStatus="COMPLETED"
        userRole="LEGAL_TEAM"
        currentDocumentId="doc-1"
        documents={[makeDoc(), makeSupportingDoc({ id: 'supporting-doc-42' })]}
        onPreviewDocument={jest.fn()}
        onDownloadDocument={jest.fn()}
        onRefreshDocuments={async () => undefined}
      />
    )

    const replaceButtons = screen.getAllByRole('button', { name: 'Replace Document' })
    fireEvent.click(replaceButtons[1])
    fireEvent.change(screen.getByLabelText('Replacement file'), {
      target: { files: [new File(['updated'], 'acme-supporting-v2.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(replaceSupportingSpy).toHaveBeenCalled())
    expect(replaceSupportingSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        documentId: 'supporting-doc-42',
      })
    )
  })
})
