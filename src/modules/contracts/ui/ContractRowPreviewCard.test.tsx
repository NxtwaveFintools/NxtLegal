/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import ContractRowPreviewCard from '@/modules/contracts/ui/ContractRowPreviewCard'
import type { ContractRowPreview } from '@/core/client/contracts-client'

const makePreview = (overrides: Partial<ContractRowPreview> = {}): ContractRowPreview => ({
  contractId: 'contract-1',
  description: 'Office fitout contract',
  counterparties: ['Acme Corp'],
  hodApprovedAt: '2026-07-05T00:00:00.000Z',
  additionalApprovers: [],
  signatories: [],
  approvedCount: 0,
  totalApprovers: 0,
  signedCount: 0,
  totalSigners: 0,
  ...overrides,
})

const baseProps = {
  id: 'row-preview-contract-1',
  title: 'Master Service Agreement',
  statusLabel: 'In Signature',
  tatLabel: '3d left',
  anchor: { clientX: 100, clientY: 100 },
  state: 'ready' as const,
  onMouseEnter: jest.fn(),
  onMouseLeave: jest.fn(),
}

const makeSigner = (overrides: Partial<ContractRowPreview['signatories'][number]>) => ({
  id: 'signer-1',
  email: 'signer@acme.com',
  status: 'PENDING' as const,
  signedAt: null,
  routingOrder: 1,
  recipientType: 'EXTERNAL' as const,
  ...overrides,
})

describe('ContractRowPreviewCard', () => {
  it('omits the approvers section when there are no approvers', () => {
    render(<ContractRowPreviewCard {...baseProps} preview={makePreview()} canSeeTat />)

    expect(screen.queryByText('APPROVERS')).toBeNull()
  })

  it('renders the approvers section with a count when approvers exist', () => {
    const preview = makePreview({
      additionalApprovers: [
        {
          id: 'a1',
          email: 'anil@nxtwave.co.in',
          status: 'APPROVED',
          approvedAt: '2026-07-08T00:00:00.000Z',
          sequenceOrder: 1,
        },
        { id: 'a2', email: 'meera@nxtwave.co.in', status: 'PENDING', approvedAt: null, sequenceOrder: 2 },
      ],
      approvedCount: 1,
      totalApprovers: 2,
    })

    render(<ContractRowPreviewCard {...baseProps} preview={preview} canSeeTat />)

    expect(screen.getByText('APPROVERS')).toBeTruthy()
    expect(screen.getByText('1 of 2')).toBeTruthy()
    expect(screen.getByText('anil@nxtwave.co.in')).toBeTruthy()
  })

  it('hides TAT when the viewer lacks permission', () => {
    render(<ContractRowPreviewCard {...baseProps} preview={makePreview()} canSeeTat={false} />)

    expect(screen.queryByText(/3d left/)).toBeNull()
  })

  it('shows TAT when the viewer has permission', () => {
    render(<ContractRowPreviewCard {...baseProps} preview={makePreview()} canSeeTat />)

    expect(screen.getByText(/3d left/)).toBeTruthy()
  })

  it('caps the signer list at five and shows a remainder count', () => {
    const signatories = Array.from({ length: 8 }, (_unused, index) =>
      makeSigner({ id: `s${index}`, email: `signer${index}@acme.com`, routingOrder: index + 1 })
    )

    render(
      <ContractRowPreviewCard
        {...baseProps}
        preview={makePreview({ signatories, signedCount: 0, totalSigners: 8 })}
        canSeeTat
      />
    )

    expect(screen.getByText('signer0@acme.com')).toBeTruthy()
    expect(screen.queryByText('signer5@acme.com')).toBeNull()
    expect(screen.getByText('+3 more')).toBeTruthy()
  })

  it('labels the lowest-routing unsigned signer as pending and later ones as queued', () => {
    const signatories = [
      makeSigner({
        id: 's1',
        email: 'signed@acme.com',
        status: 'SIGNED',
        signedAt: '2026-07-14T00:00:00.000Z',
        routingOrder: 1,
      }),
      makeSigner({ id: 's2', email: 'current@acme.com', routingOrder: 2 }),
      makeSigner({ id: 's3', email: 'later@acme.com', routingOrder: 3 }),
    ]

    render(
      <ContractRowPreviewCard
        {...baseProps}
        preview={makePreview({ signatories, signedCount: 1, totalSigners: 3 })}
        canSeeTat
      />
    )

    expect(screen.getByTestId('signer-status-current@acme.com').textContent).toContain('pending')
    expect(screen.getByTestId('signer-status-later@acme.com').textContent).toContain('queued')
  })

  it('renders skeletons while loading', () => {
    render(<ContractRowPreviewCard {...baseProps} state="loading" preview={null} canSeeTat />)

    expect(screen.getByTestId('row-preview-skeleton')).toBeTruthy()
    expect(screen.getByText('Master Service Agreement')).toBeTruthy()
  })

  it('renders an error message in the error state', () => {
    render(<ContractRowPreviewCard {...baseProps} state="error" preview={null} canSeeTat />)

    expect(screen.getByText("Couldn't load details")).toBeTruthy()
  })

  it('renders an access message in the forbidden state', () => {
    render(<ContractRowPreviewCard {...baseProps} state="forbidden" preview={null} canSeeTat />)

    expect(screen.getByText("You don't have access to this contract's details")).toBeTruthy()
  })

  it('omits the description block when there is no description', () => {
    render(<ContractRowPreviewCard {...baseProps} preview={makePreview({ description: null })} canSeeTat />)

    expect(screen.queryByTestId('row-preview-description')).toBeNull()
  })

  it('renders the HOD approval date and omits it when absent', () => {
    const { rerender } = render(<ContractRowPreviewCard {...baseProps} preview={makePreview()} canSeeTat />)
    expect(screen.getByTestId('row-preview-hod-approval').textContent).toContain('HOD approved')

    rerender(<ContractRowPreviewCard {...baseProps} preview={makePreview({ hodApprovedAt: null })} canSeeTat />)
    expect(screen.queryByTestId('row-preview-hod-approval')).toBeNull()
  })

  it('places the HOD approval date above the description and the approver list', () => {
    const preview = makePreview({
      additionalApprovers: [
        { id: 'a1', email: 'anil@nxtwave.co.in', status: 'APPROVED', approvedAt: null, sequenceOrder: 1 },
      ],
      approvedCount: 1,
      totalApprovers: 1,
    })

    render(<ContractRowPreviewCard {...baseProps} preview={preview} canSeeTat />)

    const hodApproval = screen.getByTestId('row-preview-hod-approval')
    const description = screen.getByTestId('row-preview-description')
    const approvers = screen.getByText('APPROVERS')

    // Node.DOCUMENT_POSITION_FOLLOWING === 4 when the argument comes after the node.
    expect(hodApproval.compareDocumentPosition(description) & 4).toBeTruthy()
    expect(hodApproval.compareDocumentPosition(approvers) & 4).toBeTruthy()
  })

  it('renders no POC block', () => {
    render(<ContractRowPreviewCard {...baseProps} preview={makePreview()} canSeeTat />)

    expect(screen.queryByText('POC')).toBeNull()
    expect(screen.queryByText('HOD', { exact: true })).toBeNull()
  })

  it('renders both rows when the same person appears twice in a list', () => {
    const preview = makePreview({
      additionalApprovers: [
        { id: 'a1', email: 'repeat@nxtwave.co.in', status: 'APPROVED', approvedAt: null, sequenceOrder: 1 },
        { id: 'a2', email: 'repeat@nxtwave.co.in', status: 'PENDING', approvedAt: null, sequenceOrder: 2 },
      ],
      approvedCount: 1,
      totalApprovers: 2,
    })

    render(<ContractRowPreviewCard {...baseProps} preview={preview} canSeeTat />)

    expect(screen.getAllByText('repeat@nxtwave.co.in')).toHaveLength(2)
  })
})
