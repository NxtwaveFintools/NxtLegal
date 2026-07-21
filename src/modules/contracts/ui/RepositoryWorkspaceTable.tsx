'use client'

'use no memo'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { type ContractRecord } from '@/core/client/contracts-client'
import ContractRowPreviewCard from './ContractRowPreviewCard'
import { useContractRowPreview } from './useContractRowPreview'
import styles from './RepositoryWorkspace.module.css'

type SortingUpdater = SortingState | ((current: SortingState) => SortingState)

export type RepositoryWorkspaceTableProps = {
  contracts: ContractRecord[]
  columns: ColumnDef<ContractRecord>[]
  sorting: SortingState
  onSortingChange: (updater: SortingUpdater) => void
  isLoading: boolean
  onOpenContractInNewTab: (contractId: string) => void
  canSeeTatAndAging?: boolean
  suppressRowPreview?: boolean
  resolveTatLabel?: (contract: ContractRecord) => string | null
}

const PREVIEW_SUPPRESSING_SELECTOR = 'button, a, input, select, textarea, [role="button"]'

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PREVIEW_SUPPRESSING_SELECTOR) !== null
}

export default function RepositoryWorkspaceTable({
  contracts,
  columns,
  sorting,
  onSortingChange,
  isLoading,
  onOpenContractInNewTab,
  canSeeTatAndAging = false,
  suppressRowPreview = false,
  resolveTatLabel,
}: RepositoryWorkspaceTableProps) {
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: contracts,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const rowPreview = useContractRowPreview()
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => setIsMounted(true), [])

  const activeRow = rowPreview.activeContractId
    ? contracts.find((contract) => contract.id === rowPreview.activeContractId)
    : undefined

  if (isLoading) {
    return (
      <div>
        {[1, 2, 3, 4, 5].map((item) => (
          <div key={item} className={styles.shimmerTableRow}>
            <div className={styles.shimmerCell} style={{ width: `${50 + item * 8}%` }} />
            <div className={styles.shimmerCell} style={{ width: '70%' }} />
            <div className={styles.shimmerCell} style={{ width: '65%' }} />
            <div className={styles.shimmerCell} style={{ width: '50%' }} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <table className={styles.table}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const sortedState = header.column.getIsSorted()

                return (
                  <th key={header.id}>
                    {canSort ? (
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortedState === 'asc' ? ' ↑' : sortedState === 'desc' ? ' ↓' : ''}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                No contracts found.
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={`${styles.row} ${canSeeTatAndAging && row.original.isTatBreached ? styles.rowBreached : ''}`}
                tabIndex={0}
                aria-describedby={
                  rowPreview.activeContractId === row.original.id ? `row-preview-${row.original.id}` : undefined
                }
                // Requests always open in a new tab so the list view stays put behind them.
                onClick={() => onOpenContractInNewTab(row.original.id)}
                onMouseEnter={(event) => {
                  if (suppressRowPreview || isInteractiveTarget(event.target)) return
                  rowPreview.onRowEnter(row.original.id, row.original.updatedAt, {
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }}
                onMouseLeave={() => rowPreview.onRowLeave()}
                onFocus={(event) => {
                  if (suppressRowPreview) return
                  const bounds = event.currentTarget.getBoundingClientRect()
                  rowPreview.onRowEnter(row.original.id, row.original.updatedAt, {
                    clientX: bounds.right,
                    clientY: bounds.top,
                  })
                }}
                onBlur={() => rowPreview.onRowLeave()}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {isMounted && rowPreview.activeContractId && activeRow && rowPreview.anchor
        ? createPortal(
            <ContractRowPreviewCard
              id={`row-preview-${activeRow.id}`}
              title={activeRow.title}
              statusLabel={activeRow.repositoryStatusLabel ?? activeRow.displayStatusLabel ?? activeRow.status}
              tatLabel={resolveTatLabel?.(activeRow) ?? null}
              canSeeTat={canSeeTatAndAging}
              anchor={rowPreview.anchor}
              state={rowPreview.state}
              preview={rowPreview.preview}
              onMouseEnter={rowPreview.onCardEnter}
              onMouseLeave={rowPreview.onRowLeave}
            />,
            document.body
          )
        : null}
    </>
  )
}
