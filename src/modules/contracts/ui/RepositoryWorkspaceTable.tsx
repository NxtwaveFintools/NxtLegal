'use client'

'use no memo'

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { type ContractRecord } from '@/core/client/contracts-client'
import styles from './RepositoryWorkspace.module.css'

type SortingUpdater = SortingState | ((current: SortingState) => SortingState)

export type RepositoryWorkspaceTableProps = {
  contracts: ContractRecord[]
  columns: ColumnDef<ContractRecord>[]
  sorting: SortingState
  onSortingChange: (updater: SortingUpdater) => void
  isLoading: boolean
  onOpenContract: (contractId: string) => void
  canSeeTatAndAging?: boolean
}

export default function RepositoryWorkspaceTable({
  contracts,
  columns,
  sorting,
  onSortingChange,
  isLoading,
  onOpenContract,
  canSeeTatAndAging = false,
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
              onClick={() => onOpenContract(row.original.id)}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
