/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import RepositoryWorkspaceTable from '@/modules/contracts/ui/RepositoryWorkspaceTable'
import type { ContractRecord } from '@/core/client/contracts-client'

const contract = {
  id: 'contract-1',
  title: 'Master Service Agreement',
  updatedAt: '2026-07-20T00:00:00.000Z',
} as ContractRecord

const columns: ColumnDef<ContractRecord>[] = [
  {
    accessorKey: 'title',
    header: 'Contract',
    cell: ({ row }) => <span>{row.original.title}</span>,
  },
]

const renderTable = (onOpenContractInNewTab: jest.Mock) =>
  render(
    <RepositoryWorkspaceTable
      contracts={[contract]}
      columns={columns}
      sorting={[]}
      onSortingChange={jest.fn()}
      isLoading={false}
      onOpenContractInNewTab={onOpenContractInNewTab}
      suppressRowPreview
    />
  )

describe('RepositoryWorkspaceTable', () => {
  it('opens the request in a new tab on a plain row click', () => {
    const onOpenContractInNewTab = jest.fn()
    renderTable(onOpenContractInNewTab)

    fireEvent.click(screen.getByText('Master Service Agreement'))

    expect(onOpenContractInNewTab).toHaveBeenCalledWith('contract-1')
  })

  it('still opens in a new tab on ctrl+click', () => {
    const onOpenContractInNewTab = jest.fn()
    renderTable(onOpenContractInNewTab)

    fireEvent.click(screen.getByText('Master Service Agreement'), { ctrlKey: true })

    expect(onOpenContractInNewTab).toHaveBeenCalledWith('contract-1')
  })
})
