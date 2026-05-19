'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { contractUploadModes } from '@/core/constants/contracts'
import ProtectedAppShell from '@/modules/dashboard/ui/ProtectedAppShell'
import ThirdPartyUploadSidebar from '@/modules/contracts/ui/third-party-upload/ThirdPartyUploadSidebar'
import {
  contractsClient,
  type AdditionalApproverDecisionHistoryRecord,
  type DepartmentOption,
} from '@/core/client/contracts-client'
import { limits } from '@/core/constants/limits'
import styles from './additional-approver-history.module.css'

type AdditionalApproverHistoryWorkspaceProps = {
  session: {
    employeeId: string
    fullName?: string | null
    email?: string | null
    team?: string | null
    role?: string | null
    canAccessApproverHistory?: boolean
  }
}

const adminHistoryRoles = new Set(['ADMIN', 'LEGAL_ADMIN', 'SUPER_ADMIN'])

const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

export default function AdditionalApproverHistoryWorkspace({ session }: AdditionalApproverHistoryWorkspaceProps) {
  const normalizedRole = (session.role ?? '').toUpperCase()
  const [historyItems, setHistoryItems] = useState<AdditionalApproverDecisionHistoryRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('')
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [isUploadOpen, setIsUploadOpen] = useState(false)

  const isAdminRole = useMemo(() => adminHistoryRoles.has((session.role ?? '').toUpperCase()), [session.role])
  const activeCursor = cursorHistory[cursorHistory.length - 1]
  const approvedCountOnPage = useMemo(
    () => historyItems.filter((item) => item.decision === 'APPROVED').length,
    [historyItems]
  )
  const rejectedCountOnPage = useMemo(
    () => historyItems.filter((item) => item.decision === 'REJECTED').length,
    [historyItems]
  )
  const lastDecisionLabel = useMemo(() => {
    const decidedAt = historyItems[0]?.decidedAt
    if (!decidedAt) {
      return null
    }

    return timestampFormatter.format(new Date(decidedAt))
  }, [historyItems])
  const selectedDepartmentName = useMemo(() => {
    if (!selectedDepartmentId) {
      return 'All departments'
    }

    return departments.find((department) => department.id === selectedDepartmentId)?.name ?? 'All departments'
  }, [departments, selectedDepartmentId])

  const loadHistory = useCallback(async () => {
    setIsLoading(true)

    const response = await contractsClient.additionalApproverHistory({
      cursor: activeCursor,
      limit: limits.dashboardContractsPageSize,
      departmentId: isAdminRole && selectedDepartmentId ? selectedDepartmentId : undefined,
    })

    if (!response.ok || !response.data) {
      setHistoryItems([])
      setNextCursor(null)
      setTotal(0)
      toast.error(response.error?.message ?? 'Failed to load additional approver history')
      setIsLoading(false)
      return
    }

    setHistoryItems(response.data.history)
    setNextCursor(response.data.pagination.cursor)
    setTotal(response.data.pagination.total)
    setIsLoading(false)
  }, [activeCursor, isAdminRole, selectedDepartmentId])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadHistory()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadHistory])

  useEffect(() => {
    if (!isAdminRole) {
      return
    }

    const loadDepartments = async () => {
      const response = await contractsClient.departments()
      if (!response.ok || !response.data) {
        setDepartments([])
        return
      }

      setDepartments(response.data.departments)
    }

    void loadDepartments()
  }, [isAdminRole])

  return (
    <ProtectedAppShell
      session={{ fullName: session.fullName, email: session.email, team: session.team, role: session.role }}
      activeNav="approver-history"
      canAccessApproverHistory={session.canAccessApproverHistory}
      quickAction={
        normalizedRole === 'HOD'
          ? {
              ariaLabel: 'Upload third-party contract',
              onClick: () => setIsUploadOpen(true),
              isActive: isUploadOpen,
            }
          : undefined
      }
    >
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <p className={styles.heroEyebrow}>Decision Audit Trail</p>
            <h1 className={styles.title}>Additional Approver History</h1>
            <p className={styles.subtitle}>Decision logs with latest activity first and quick contract drill-down.</p>
            <div className={styles.heroMetaRow}>
              <span className={styles.heroMetaChip}>{`Total records: ${total}`}</span>
              <span className={styles.heroMetaChip}>{`Scope: ${selectedDepartmentName}`}</span>
              {lastDecisionLabel ? (
                <span className={styles.heroMetaChip}>{`Latest decision: ${lastDecisionLabel}`}</span>
              ) : null}
            </div>
          </div>

          {isAdminRole ? (
            <div className={styles.departmentSelectWrap}>
              <label htmlFor="history-department-filter" className={styles.departmentSelectLabel}>
                Department
              </label>
              <select
                id="history-department-filter"
                className={styles.departmentSelect}
                value={selectedDepartmentId}
                onChange={(event) => {
                  setSelectedDepartmentId(event.target.value)
                  setCursorHistory([undefined])
                }}
              >
                <option value="">All departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </section>

        <section className={styles.metricsGrid}>
          <article className={styles.metricCard}>
            <div className={styles.metricLabel}>Approved on this page</div>
            <div className={styles.metricValue}>{approvedCountOnPage}</div>
            <div className={styles.metricHint}>Decisions with approved outcome</div>
          </article>
          <article className={styles.metricCard}>
            <div className={styles.metricLabel}>Rejected on this page</div>
            <div className={styles.metricValue}>{rejectedCountOnPage}</div>
            <div className={styles.metricHint}>Decisions with rejected outcome</div>
          </article>
          <article className={styles.metricCard}>
            <div className={styles.metricLabel}>Page size</div>
            <div className={styles.metricValue}>{limits.dashboardContractsPageSize}</div>
            <div className={styles.metricHint}>Records fetched per request</div>
          </article>
        </section>

        <section className={styles.historySection}>
          <div className={styles.historyHeader}>
            <h2 className={styles.historyTitle}>Decision Timeline</h2>
            <span className={styles.historyCount}>{`${historyItems.length} shown`}</span>
          </div>

          {isLoading ? (
            <div className={styles.loadingSkeleton} aria-label="Loading approver history">
              {Array.from({ length: 5 }).map((_, index) => (
                <article key={`history-skeleton-${index}`} className={styles.skeletonItem} aria-hidden="true">
                  <div className={styles.skeletonMain}>
                    <div className={styles.shimmerLine} style={{ width: `${58 + (index % 2) * 14}%` }} />
                    <div className={styles.shimmerLine} style={{ width: '82%', height: 11 }} />
                    <div className={styles.shimmerLine} style={{ width: `${45 + (index % 3) * 8}%`, height: 11 }} />
                  </div>
                  <div className={styles.skeletonRight}>
                    <div className={styles.shimmerBadge} />
                    <div className={styles.shimmerLine} style={{ width: 90, height: 11 }} />
                    <div className={styles.shimmerButton} />
                  </div>
                </article>
              ))}
            </div>
          ) : historyItems.length === 0 ? (
            <div className={styles.empty}>No additional approver decision history found.</div>
          ) : (
            <div className={styles.list}>
              {historyItems.map((item) => (
                <article key={`${item.contractId}-${item.decidedAt}`} className={styles.item}>
                  <div className={styles.itemMain}>
                    <div className={styles.itemTopRow}>
                      <div className={styles.contractTitle}>{item.contractTitle}</div>
                      <span className={styles.departmentChip}>{item.departmentName ?? 'Unknown department'}</span>
                    </div>
                    <div className={styles.metaRow}>
                      <span>{`Actor: ${item.actorEmail ?? 'Unknown actor'}`}</span>
                      <span className={styles.metaSeparator}>|</span>
                      <span>{timestampFormatter.format(new Date(item.decidedAt))}</span>
                    </div>
                    {item.reason ? <div className={styles.reason}>Reason: {item.reason}</div> : null}
                  </div>
                  <div className={styles.itemRight}>
                    <span className={item.decision === 'REJECTED' ? styles.badgeRejected : styles.badgeApproved}>
                      {item.decision === 'REJECTED' ? 'Rejected' : 'Approved'}
                    </span>
                    <span className={styles.statusLabel}>{item.contractDisplayStatusLabel}</span>
                    <Link
                      href={contractsClient.resolveProtectedContractPath(item.contractId)}
                      className={styles.openButton}
                    >
                      Open Contract
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className={styles.pagination}>
          <div className={styles.paginationMeta}>
            <span className={styles.totalLabel}>{`Total records: ${total}`}</span>
            <span className={styles.totalHint}>Use filters to narrow history by department.</span>
          </div>
          <div className={styles.paginationActions}>
            <button
              type="button"
              className={styles.pageButton}
              disabled={cursorHistory.length <= 1 || isLoading}
              onClick={() => setCursorHistory((previous) => previous.slice(0, previous.length - 1))}
            >
              Previous Page
            </button>
            <button
              type="button"
              className={styles.pageButton}
              disabled={!nextCursor || isLoading}
              onClick={() => {
                if (!nextCursor) {
                  return
                }

                setCursorHistory((previous) => [...previous, nextCursor])
              }}
            >
              Next Page
            </button>
          </div>
        </section>

        <ThirdPartyUploadSidebar
          isOpen={isUploadOpen}
          mode={contractUploadModes.default}
          actorRole={session.role ?? undefined}
          onClose={() => setIsUploadOpen(false)}
          onUploaded={async () => {
            await loadHistory()
          }}
        />
      </main>
    </ProtectedAppShell>
  )
}
