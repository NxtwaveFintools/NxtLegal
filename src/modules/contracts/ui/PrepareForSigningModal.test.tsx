/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import PrepareForSigningModal from '@/modules/contracts/ui/PrepareForSigningModal'
import { contractsClient } from '@/core/client/contracts-client'
import { toast } from 'sonner'

jest.mock('react-pdf', () => {
  return {
    pdfjs: {
      version: '4.10.0',
      GlobalWorkerOptions: { workerSrc: '' },
    },
    Document: ({
      children,
      onLoadSuccess,
    }: {
      children: React.ReactNode
      onLoadSuccess?: (value: { numPages: number }) => void
    }) => {
      React.useEffect(() => {
        onLoadSuccess?.({ numPages: 3 })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      return <div data-testid="pdf-document">{children}</div>
    },
    Page: ({
      onLoadSuccess,
    }: {
      onLoadSuccess?: (value: {
        getViewport: ({ scale }: { scale: number }) => { width: number; height: number }
      }) => void
    }) => {
      React.useEffect(() => {
        onLoadSuccess?.({
          getViewport: ({ scale }) => ({
            width: 612 * scale,
            height: 792 * scale,
          }),
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      return <div data-testid="pdf-page">PDF Page</div>
    },
  }
})

function createContractView() {
  return {
    contract: {
      id: 'contract-1',
      title: 'Master Service Agreement',
      status: 'SIGNING',
      uploadedByEmployeeId: 'employee-1',
      uploadedByEmail: 'legal@nxtwave.co.in',
      currentAssigneeEmployeeId: 'employee-2',
      currentAssigneeEmail: 'owner@nxtwave.co.in',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    documents: [],
    availableActions: [],
    additionalApprovers: [],
    signatories: [],
  }
}

describe('PrepareForSigningModal', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('adds SIGNATURE field on all pages at same position when enabled', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const saveSpy = jest.spyOn(contractsClient, 'saveSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: null,
    } as never)

    const rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const getBoundingClientRectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      width: 720,
      height: 1000,
      top: 0,
      left: 0,
      right: 720,
      bottom: 1000,
      toJSON: () => ({}),
    }))

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '2. Assign Fields' }))
    await waitFor(() => expect(screen.queryByText('Loading draft…')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('pdf-document')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Add on all pages'))
    await waitFor(() => expect(screen.getByTestId('pdf-document')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 360, clientY: 500 })
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(
        'contract-1',
        expect.objectContaining({
          fields: [
            {
              field_type: 'SIGNATURE',
              page_number: 1,
              x_position: 306,
              y_position: 396,
              width: 96,
              height: 22,
              anchor_string: undefined,
              assigned_signer_email: 'vendor@nxtwave.co.in',
            },
            {
              field_type: 'SIGNATURE',
              page_number: 2,
              x_position: 306,
              y_position: 396,
              width: 96,
              height: 22,
              anchor_string: undefined,
              assigned_signer_email: 'vendor@nxtwave.co.in',
            },
            {
              field_type: 'SIGNATURE',
              page_number: 3,
              x_position: 306,
              y_position: 396,
              width: 96,
              height: 22,
              anchor_string: undefined,
              assigned_signer_email: 'vendor@nxtwave.co.in',
            },
          ],
        })
      )
    })

    getBoundingClientRectSpy.mockRestore()
    rafSpy.mockRestore()
  })

  it('removes only the current page signature from an all-pages placement when disabled', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const saveSpy = jest.spyOn(contractsClient, 'saveSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: null,
    } as never)

    const rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const getBoundingClientRectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      width: 720,
      height: 1000,
      top: 0,
      left: 0,
      right: 720,
      bottom: 1000,
      toJSON: () => ({}),
    }))

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '2. Assign Fields' }))
    await waitFor(() => expect(screen.queryByText('Loading draft…')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('pdf-document')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Add on all pages'))
    fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 360, clientY: 500 })
    fireEvent.click(screen.getByLabelText('Add on all pages'))
    // The chip body no longer deletes — it selects and drags — so removal goes
    // through the × handle, matching the delete-all test below.
    fireEvent.click(screen.getByTitle('Remove from this page'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(
        'contract-1',
        expect.objectContaining({
          fields: [
            expect.objectContaining({
              field_type: 'SIGNATURE',
              page_number: 2,
              assigned_signer_email: 'vendor@nxtwave.co.in',
            }),
            expect.objectContaining({
              field_type: 'SIGNATURE',
              page_number: 3,
              assigned_signer_email: 'vendor@nxtwave.co.in',
            }),
          ],
        })
      )
    })

    getBoundingClientRectSpy.mockRestore()
    rafSpy.mockRestore()
  })

  it('removes all mirrored signatures when all-pages placement is enabled', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const saveSpy = jest.spyOn(contractsClient, 'saveSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: null,
    } as never)

    const rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const getBoundingClientRectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      width: 720,
      height: 1000,
      top: 0,
      left: 0,
      right: 720,
      bottom: 1000,
      toJSON: () => ({}),
    }))

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '2. Assign Fields' }))
    await waitFor(() => expect(screen.queryByText('Loading draft…')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('pdf-document')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Add on all pages'))
    fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 360, clientY: 500 })
    fireEvent.click(screen.getByTitle('Remove from all pages'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(
        'contract-1',
        expect.objectContaining({
          fields: [],
        })
      )
    })

    getBoundingClientRectSpy.mockRestore()
    rafSpy.mockRestore()
  })

  it('adds STAMP field on all pages when enabled', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const saveSpy = jest.spyOn(contractsClient, 'saveSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: null,
    } as never)

    const rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const getBoundingClientRectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      width: 720,
      height: 1000,
      top: 0,
      left: 0,
      right: 720,
      bottom: 1000,
      toJSON: () => ({}),
    }))

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '2. Assign Fields' }))
    await waitFor(() => expect(screen.queryByText('Loading draft…')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('pdf-document')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'STAMP' }))
    fireEvent.click(screen.getByLabelText('Add on all pages'))
    fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 360, clientY: 500 })
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(
        'contract-1',
        expect.objectContaining({
          fields: [
            expect.objectContaining({ field_type: 'STAMP', page_number: 1, width: 96, height: 36 }),
            expect.objectContaining({ field_type: 'STAMP', page_number: 2, width: 96, height: 36 }),
            expect.objectContaining({ field_type: 'STAMP', page_number: 3, width: 96, height: 36 }),
          ],
        })
      )
    })

    getBoundingClientRectSpy.mockRestore()
    rafSpy.mockRestore()
  })

  it('resets a resized mirrored field to default size on every page without deleting it', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const saveSpy = jest.spyOn(contractsClient, 'saveSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: null,
    } as never)

    const rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const getBoundingClientRectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      width: 720,
      height: 1000,
      top: 0,
      left: 0,
      right: 720,
      bottom: 1000,
      toJSON: () => ({}),
    }))

    const { container } = render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '2. Assign Fields' }))
    await waitFor(() => expect(screen.queryByText('Loading draft…')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('pdf-document')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'STAMP' }))
    fireEvent.click(screen.getByLabelText('Add on all pages'))
    fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 200, clientY: 300 })

    const resizeHandle = container.querySelector('.resizeHandle')
    expect(resizeHandle).toBeTruthy()
    fireEvent.mouseDown(resizeHandle as Element, { clientX: 300, clientY: 400 })
    fireEvent.mouseMove(window, { clientX: 340, clientY: 400 })
    fireEvent.mouseUp(window)

    // The resize must actually have taken effect, otherwise reset proves nothing.
    await waitFor(() => expect(screen.queryByTitle('Reset to default size')).toBeTruthy())
    expect(container.querySelector('.fieldChip')?.textContent).not.toContain('96x36')

    fireEvent.click(screen.getByTitle('Reset to default size'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(
        'contract-1',
        expect.objectContaining({
          fields: [
            expect.objectContaining({ field_type: 'STAMP', page_number: 1, width: 96, height: 36 }),
            expect.objectContaining({ field_type: 'STAMP', page_number: 2, width: 96, height: 36 }),
            expect.objectContaining({ field_type: 'STAMP', page_number: 3, width: 96, height: 36 }),
          ],
        })
      )
    })

    getBoundingClientRectSpy.mockRestore()
    rafSpy.mockRestore()
  })

  it('pre-populates recipients from initialRecipients when no draft exists', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: null,
    } as never)

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        initialRecipients={[
          {
            name: 'Vendor Signatory',
            email: 'Vendor@Example.com',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ]}
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())

    expect((screen.getByPlaceholderText('Name') as HTMLInputElement).value).toBe('Vendor Signatory')
    expect((screen.getByPlaceholderText('Email') as HTMLInputElement).value).toBe('vendor@example.com')
  })

  it('adds SIGNATURE field only on current page by default', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const saveSpy = jest.spyOn(contractsClient, 'saveSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: null,
    } as never)

    const rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const getBoundingClientRectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      width: 720,
      height: 1000,
      top: 0,
      left: 0,
      right: 720,
      bottom: 1000,
      toJSON: () => ({}),
    }))

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '2. Assign Fields' }))
    await waitFor(() => expect(screen.queryByText('Loading draft…')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('pdf-document')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 360, clientY: 500 })
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(
        'contract-1',
        expect.objectContaining({
          fields: [
            {
              field_type: 'SIGNATURE',
              page_number: 1,
              x_position: 306,
              y_position: 396,
              width: 96,
              height: 22,
              anchor_string: undefined,
              assigned_signer_email: 'vendor@nxtwave.co.in',
            },
          ],
        })
      )
    })

    getBoundingClientRectSpy.mockRestore()
    rafSpy.mockRestore()
  })

  it('disables send when recipient has no SIGNATURE field', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const sendSpy = jest.spyOn(contractsClient, 'sendSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: { envelopeId: 'env-1', contractView: createContractView() },
    } as never)

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())

    expect(screen.getByRole('button', { name: 'Review & Send' }).hasAttribute('disabled')).toBe(true)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('saves loaded draft via save endpoint', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'Vendor@NxtWave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 22.5,
            yPosition: 37.25,
            width: 96,
            height: 22,
            anchorString: null,
            assignedSignerEmail: 'Vendor@NxtWave.co.in',
          },
        ],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const saveSpy = jest.spyOn(contractsClient, 'saveSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: null,
    } as never)

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith('contract-1', {
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipient_type: 'EXTERNAL',
            routing_order: 1,
          },
        ],
        fields: [
          {
            field_type: 'SIGNATURE',
            page_number: 1,
            x_position: 22.5,
            y_position: 37.25,
            width: 96,
            height: 22,
            anchor_string: undefined,
            assigned_signer_email: 'vendor@nxtwave.co.in',
          },
        ],
      })
    })
  })

  it('allows parallel routing when all recipients share same order', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Signer One',
            email: 'one@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
          {
            name: 'Signer Two',
            email: 'two@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 10,
            yPosition: 20,
            width: 96,
            height: 22,
            anchorString: null,
            assignedSignerEmail: 'one@nxtwave.co.in',
          },
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 20,
            yPosition: 30,
            width: 96,
            height: 22,
            anchorString: null,
            assignedSignerEmail: 'two@nxtwave.co.in',
          },
        ],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={jest.fn()}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())

    expect(screen.getByRole('button', { name: 'Review & Send' }).hasAttribute('disabled')).toBe(false)
  })

  it('sends draft and notifies parent callbacks', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 15,
            yPosition: 20,
            width: 96,
            height: 22,
            anchorString: null,
            assignedSignerEmail: 'vendor@nxtwave.co.in',
          },
        ],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const onClose = jest.fn()
    const onReviewSendRequested = jest.fn()

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={onClose}
        onReviewSendRequested={onReviewSendRequested}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Review & Send' }))

    await waitFor(() => {
      expect(onReviewSendRequested).toHaveBeenCalledWith(
        expect.objectContaining({
          recipients: expect.any(Array),
          fields: expect.any(Array),
        })
      )
      expect(onClose).toHaveBeenCalled()
    })
  })

  // An untyped TEXT chip is stripped from the Zoho payload AND rejected by the
  // burn-in renderer, so the clause would disappear from the executed contract
  // entirely. Block it here rather than after the round-trip.
  it('blocks send when a TEXT field was placed but never typed into', async () => {
    jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
      ok: true,
      data: {
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Vendor',
            email: 'vendor@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 15,
            yPosition: 20,
            width: 96,
            height: 22,
            anchorString: null,
            assignedSignerEmail: 'vendor@nxtwave.co.in',
          },
          {
            fieldType: 'TEXT',
            pageNumber: 2,
            xPosition: 40,
            yPosition: 60,
            width: 200,
            height: 24,
            anchorString: null,
            textValue: '   ',
            assignedSignerEmail: 'vendor@nxtwave.co.in',
          },
        ],
        createdByEmployeeId: 'employee-1',
        updatedByEmployeeId: 'employee-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as never)

    const toastErrorSpy = jest.spyOn(toast, 'error').mockImplementation(() => '' as never)
    const onReviewSendRequested = jest.fn()

    render(
      <PrepareForSigningModal
        isOpen
        contractId="contract-1"
        contractStatus="UNDER_REVIEW"
        pdfUrl="/api/contracts/contract-1/preview"
        onClose={jest.fn()}
        onReviewSendRequested={onReviewSendRequested}
      />
    )

    await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Review & Send' }))

    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/empty text field on page 2/i))
    )
    expect(onReviewSendRequested).not.toHaveBeenCalled()
  })

  describe('static field editing', () => {
    const mockPageGeometry = () => {
      const rafSpy = jest
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((callback: FrameRequestCallback) => {
          callback(0)
          return 1
        })
      const rectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
        x: 0,
        y: 0,
        width: 720,
        height: 1000,
        top: 0,
        left: 0,
        right: 720,
        bottom: 1000,
        toJSON: () => ({}),
      }))

      return () => {
        rectSpy.mockRestore()
        rafSpy.mockRestore()
      }
    }

    const mockDraft = (fields: unknown[]) =>
      jest.spyOn(contractsClient, 'getSigningPreparationDraft').mockResolvedValue({
        ok: true,
        data: {
          contractId: 'contract-1',
          recipients: [
            {
              name: 'Vendor',
              email: 'vendor@nxtwave.co.in',
              recipientType: 'EXTERNAL',
              routingOrder: 1,
            },
          ],
          fields,
          createdByEmployeeId: 'employee-1',
          updatedByEmployeeId: 'employee-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      } as never)

    const renderModal = () =>
      render(
        <PrepareForSigningModal
          isOpen
          contractId="contract-1"
          contractStatus="UNDER_REVIEW"
          pdfUrl="/api/contracts/contract-1/preview"
          onClose={jest.fn()}
          onReviewSendRequested={jest.fn()}
        />
      )

    const gotoAssignFields = async () => {
      await waitFor(() => expect(contractsClient.getSigningPreparationDraft).toHaveBeenCalled())
      fireEvent.click(screen.getByRole('button', { name: '2. Assign Fields' }))
      await waitFor(() => expect(screen.queryByText('Loading draft…')).toBeNull())
      await waitFor(() => expect(screen.getByTestId('pdf-document')).toBeTruthy())
    }

    it('sends text_value in the save payload for a newly placed TEXT field', async () => {
      mockDraft([])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      fireEvent.click(screen.getByRole('button', { name: 'TEXT' }))
      fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 360, clientY: 500 })

      const input = await screen.findByPlaceholderText('Type anything…')
      fireEvent.change(input, { target: { value: 'Witnessed by Legal' } })

      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          'contract-1',
          expect.objectContaining({
            fields: [expect.objectContaining({ field_type: 'TEXT', text_value: 'Witnessed by Legal' })],
          })
        )
      })

      restoreGeometry()
    })

    it('reads text_value back from a loaded draft and returns it on the next save', async () => {
      mockDraft([
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 30,
          yPosition: 40,
          width: 200,
          height: 22,
          anchorString: null,
          textValue: 'Loaded from draft',
          assignedSignerEmail: 'vendor@nxtwave.co.in',
        },
      ])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      // Load half of the round trip: the persisted value reaches the input.
      const input = await screen.findByPlaceholderText('Type anything…')
      expect((input as HTMLInputElement).value).toBe('Loaded from draft')

      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      // Save half: it survives back out untouched.
      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          'contract-1',
          expect.objectContaining({
            fields: [expect.objectContaining({ field_type: 'TEXT', text_value: 'Loaded from draft' })],
          })
        )
      })

      restoreGeometry()
    })

    it('keeps the field alive while typing, including spaces', async () => {
      mockDraft([
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 30,
          yPosition: 40,
          width: 200,
          height: 22,
          anchorString: null,
          textValue: '',
          assignedSignerEmail: 'vendor@nxtwave.co.in',
        },
      ])
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      const input = await screen.findByPlaceholderText('Type anything…')

      fireEvent.click(input)
      fireEvent.change(input, { target: { value: 'Still here' } })

      const inputAfterTyping = screen.getByPlaceholderText('Type anything…')
      expect((inputAfterTyping as HTMLTextAreaElement).value).toBe('Still here')

      restoreGeometry()
    })

    // The reported bug: typing a space made the field vanish. The chip was a
    // <button> with the text control nested inside it, so anything the browser
    // resolved as a button activation ran the chip's delete handler. jsdom does
    // not synthesise that activation, so this pins the structural cause instead
    // of the symptom.
    it('does not nest the text control inside a button element', async () => {
      mockDraft([
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 30,
          yPosition: 40,
          width: 200,
          height: 22,
          anchorString: null,
          textValue: 'Signed on behalf of',
          assignedSignerEmail: 'vendor@nxtwave.co.in',
        },
      ])
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      const input = await screen.findByPlaceholderText('Type anything…')

      expect(input.closest('button')).toBeNull()
      expect(input.closest('[role="button"]')).not.toBeNull()

      restoreGeometry()
    })

    it('preserves spaces, newlines and indentation in the saved value', async () => {
      mockDraft([
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 30,
          yPosition: 40,
          width: 200,
          height: 22,
          anchorString: null,
          textValue: '',
          assignedSignerEmail: 'vendor@nxtwave.co.in',
        },
      ])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      const input = await screen.findByPlaceholderText('Type anything…')
      // An address block: trailing space, hard newline, and leading indentation.
      const typed = 'NxtWave \nLegal Team\n    Hyderabad'
      fireEvent.change(input, { target: { value: typed } })

      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          'contract-1',
          expect.objectContaining({
            fields: [expect.objectContaining({ field_type: 'TEXT', text_value: typed })],
          })
        )
      })

      restoreGeometry()
    })

    // Outgrowing the box no longer warrants a warning — the box grows. The only
    // thing left to flag is text with no page left below it to grow into, which
    // is also the sole case the renderer still refuses to send.
    it('flags the chip only when the text cannot fit above the bottom of the page', async () => {
      mockDraft([
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 30,
          // 22pt above the bottom of a 792pt page: one 13.2pt line fits, two do not.
          yPosition: 770,
          width: 40,
          height: 14,
          anchorString: null,
          textValue: 'far more text than forty points of width can possibly hold on one line',
          assignedSignerEmail: 'vendor@nxtwave.co.in',
        },
      ])
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      const input = await screen.findByPlaceholderText('Type anything…')
      expect(input.closest('[role="button"]')?.className).toContain('fieldChipOverflow')

      // Shortening it to a single line clears the warning, so the class tracks
      // the value rather than being permanently stuck on.
      fireEvent.change(input, { target: { value: 'ok' } })
      expect(screen.getByPlaceholderText('Type anything…').closest('[role="button"]')?.className).not.toContain(
        'fieldChipOverflow'
      )

      restoreGeometry()
    })

    // Geometry for these: the page renders at 720x1000px for a 612x792pt page,
    // so a 100px drag right is 100 * 612/720 = 85pt, and 100px down is
    // 100 * 792/1000 = 79.2pt.
    const placedSignature = {
      fieldType: 'SIGNATURE' as const,
      pageNumber: 1,
      xPosition: 306,
      yPosition: 396,
      width: 96,
      height: 22,
      anchorString: null,
      assignedSignerEmail: 'vendor@nxtwave.co.in',
    }

    const dragChip = (chip: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, alt = false) => {
      fireEvent.mouseDown(chip, { clientX: from.x, clientY: from.y, altKey: alt })
      fireEvent.mouseMove(window, { clientX: to.x, clientY: to.y, altKey: alt })
      fireEvent.mouseUp(window)
    }

    const findChip = (page = 1) =>
      screen.getByRole('button', { name: `SIGNATURE field for vendor@nxtwave.co.in on page ${page}` })

    it('moves a placed field when it is dragged across the page', async () => {
      mockDraft([placedSignature])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      dragChip(
        await screen.findByRole('button', { name: /SIGNATURE field for/ }),
        { x: 360, y: 500 },
        { x: 460, y: 600 }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          'contract-1',
          expect.objectContaining({
            fields: [expect.objectContaining({ x_position: 391, y_position: 475.2 })],
          })
        )
      })

      restoreGeometry()
    })

    // Without a movement threshold every click reads as a drag, because no real
    // press has zero travel. A click must leave the position untouched.
    it('does not move the field when the pointer travels less than the drag threshold', async () => {
      mockDraft([placedSignature])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      dragChip(
        await screen.findByRole('button', { name: /SIGNATURE field for/ }),
        { x: 360, y: 500 },
        { x: 361, y: 501 }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          'contract-1',
          expect.objectContaining({
            fields: [expect.objectContaining({ x_position: 306, y_position: 396 })],
          })
        )
      })

      restoreGeometry()
    })

    it('clamps a field dragged past the page edge instead of letting it escape', async () => {
      mockDraft([placedSignature])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      dragChip(
        await screen.findByRole('button', { name: /SIGNATURE field for/ }),
        { x: 360, y: 500 },
        { x: 5000, y: 5000 }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          'contract-1',
          expect.objectContaining({
            // 612 - 96 wide, 792 - 22 tall: flush against the far corner.
            fields: [expect.objectContaining({ x_position: 516, y_position: 770 })],
          })
        )
      })

      restoreGeometry()
    })

    it('moves every page of a mirror group when one copy is dragged', async () => {
      mockDraft([])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      fireEvent.click(screen.getByLabelText('Add on all pages'))
      fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 360, clientY: 500 })

      dragChip(findChip(1), { x: 360, y: 500 }, { x: 460, y: 600 })
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          'contract-1',
          expect.objectContaining({
            fields: [
              expect.objectContaining({ page_number: 1, x_position: 391, y_position: 475.2 }),
              expect.objectContaining({ page_number: 2, x_position: 391, y_position: 475.2 }),
              expect.objectContaining({ page_number: 3, x_position: 391, y_position: 475.2 }),
            ],
          })
        )
      })

      restoreGeometry()
    })

    it('moves only the dragged copy when Alt is held', async () => {
      mockDraft([])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      fireEvent.click(screen.getByLabelText('Add on all pages'))
      fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 360, clientY: 500 })

      dragChip(findChip(1), { x: 360, y: 500 }, { x: 460, y: 600 }, true)
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          'contract-1',
          expect.objectContaining({
            fields: [
              expect.objectContaining({ page_number: 1, x_position: 391, y_position: 475.2 }),
              expect.objectContaining({ page_number: 2, x_position: 306, y_position: 396 }),
              expect.objectContaining({ page_number: 3, x_position: 306, y_position: 396 }),
            ],
          })
        )
      })

      restoreGeometry()
    })

    // Alt detaches the position but must not drop group membership, or the
    // delete-all and reset handles would silently stop covering that copy.
    it('keeps a copy in its mirror group after an Alt drag', async () => {
      mockDraft([])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      fireEvent.click(screen.getByLabelText('Add on all pages'))
      fireEvent.click(screen.getByTestId('pdf-document'), { clientX: 360, clientY: 500 })

      dragChip(findChip(1), { x: 360, y: 500 }, { x: 460, y: 600 }, true)
      fireEvent.click(screen.getByTitle('Remove from all pages'))
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith('contract-1', expect.objectContaining({ fields: [] }))
      })

      restoreGeometry()
    })

    it('nudges a field by one point per arrow key press and ten with Shift', async () => {
      mockDraft([placedSignature])
      const saveSpy = jest
        .spyOn(contractsClient, 'saveSigningPreparationDraft')
        .mockResolvedValue({ ok: true, data: null } as never)
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      const chip = await screen.findByRole('button', { name: /SIGNATURE field for/ })
      fireEvent.keyDown(chip, { key: 'ArrowRight' })
      fireEvent.keyDown(chip, { key: 'ArrowDown', shiftKey: true })
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          'contract-1',
          expect.objectContaining({
            fields: [expect.objectContaining({ x_position: 307, y_position: 406 })],
          })
        )
      })

      restoreGeometry()
    })

    it('disables the STAMP palette item when the organisation has no stamp configured', async () => {
      mockDraft([])
      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, data: { configured: false, signedUrl: null } }),
      })
      const originalFetch = global.fetch
      global.fetch = fetchSpy as never
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'STAMP' }).hasAttribute('disabled')).toBe(true)
      })
      expect(screen.getByRole('button', { name: 'STAMP' }).getAttribute('title')).toBe(
        'No company stamp configured for this organisation'
      )

      global.fetch = originalFetch
      restoreGeometry()
    })

    it('renders the stamp preview image inside stamp chips when one is configured', async () => {
      mockDraft([
        {
          fieldType: 'STAMP',
          pageNumber: 1,
          xPosition: 30,
          yPosition: 40,
          width: 96,
          height: 36,
          anchorString: null,
          assignedSignerEmail: 'vendor@nxtwave.co.in',
        },
      ])
      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          data: { configured: true, signedUrl: 'https://storage.test/stamp.png?token=abc' },
        }),
      })
      const originalFetch = global.fetch
      global.fetch = fetchSpy as never
      const restoreGeometry = mockPageGeometry()

      renderModal()
      await gotoAssignFields()

      const stamp = await screen.findByAltText('Company stamp')
      expect(stamp.getAttribute('src')).toBe('https://storage.test/stamp.png?token=abc')
      expect(screen.getByRole('button', { name: 'STAMP' }).hasAttribute('disabled')).toBe(false)

      global.fetch = originalFetch
      restoreGeometry()
    })
  })
})
