'use client'

import { useLayoutEffect, useRef } from 'react'
import type { ContractRowPreview } from '@/core/client/contracts-client'
import type { ContractRowPreviewState, RowPreviewAnchor } from './useContractRowPreview'
import styles from './RepositoryWorkspace.module.css'

const CARD_WIDTH = 360
const EDGE_GAP = 20
const MAX_LIST_ITEMS = 5

export type ContractRowPreviewCardProps = {
  id: string
  title: string
  statusLabel: string
  tatLabel: string | null
  canSeeTat: boolean
  anchor: RowPreviewAnchor
  state: ContractRowPreviewState
  preview: ContractRowPreview | null
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' })

function formatDate(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : dateFormatter.format(parsed)
}

function resolveSignerLabel(
  signer: ContractRowPreview['signatories'][number],
  activeRoutingOrder: number | null
): string {
  if (signer.status === 'SIGNED') {
    const signedOn = formatDate(signer.signedAt)
    return signedOn ? `signed ${signedOn}` : 'signed'
  }

  if (activeRoutingOrder !== null && signer.routingOrder > activeRoutingOrder) return 'queued'
  return 'pending'
}

function resolveApproverLabel(approver: ContractRowPreview['additionalApprovers'][number]): string {
  if (approver.status === 'APPROVED') {
    const approvedOn = formatDate(approver.approvedAt)
    return approvedOn ? `approved ${approvedOn}` : 'approved'
  }
  return approver.status.toLowerCase()
}

export default function ContractRowPreviewCard({
  id,
  title,
  statusLabel,
  tatLabel,
  canSeeTat,
  anchor,
  state,
  preview,
  onMouseEnter,
  onMouseLeave,
}: ContractRowPreviewCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)

  // Horizontal placement needs no measurement, so it is resolved during render.
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth
  const flipsLeft = viewportWidth > 0 && anchor.clientX + CARD_WIDTH + EDGE_GAP > viewportWidth
  const left = flipsLeft ? Math.max(EDGE_GAP, anchor.clientX - CARD_WIDTH - EDGE_GAP) : anchor.clientX + EDGE_GAP
  const top = Math.max(EDGE_GAP, anchor.clientY - 40)

  // Clamping the bottom edge needs the rendered height, so it is applied as a
  // direct style write rather than state, which would cascade another render.
  useLayoutEffect(() => {
    const node = cardRef.current
    if (!node) return

    const maxTop = Math.max(EDGE_GAP, window.innerHeight - node.offsetHeight - EDGE_GAP)
    node.style.top = `${Math.min(top, maxTop)}px`
  }, [top, state, preview])

  const unsignedOrders = (preview?.signatories ?? [])
    .filter((signer) => signer.status !== 'SIGNED')
    .map((signer) => signer.routingOrder)
  const activeRoutingOrder = unsignedOrders.length > 0 ? Math.min(...unsignedOrders) : null

  const visibleSigners = (preview?.signatories ?? []).slice(0, MAX_LIST_ITEMS)
  const hiddenSignerCount = (preview?.signatories.length ?? 0) - visibleSigners.length
  const visibleApprovers = (preview?.additionalApprovers ?? []).slice(0, MAX_LIST_ITEMS)
  const hiddenApproverCount = (preview?.additionalApprovers.length ?? 0) - visibleApprovers.length

  return (
    <div
      ref={cardRef}
      id={id}
      role="tooltip"
      className={styles.rowPreviewCard}
      style={{ left, top, width: CARD_WIDTH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.rowPreviewHeader}>
        <p className={styles.rowPreviewTitle}>{title}</p>
        {preview && preview.counterparties.length > 0 ? (
          <p className={styles.rowPreviewCounterparties}>{preview.counterparties.join(', ')}</p>
        ) : null}
        <div className={styles.rowPreviewHeaderMeta}>
          <span>{statusLabel}</span>
          {canSeeTat && tatLabel ? <span className={styles.rowPreviewTat}>{tatLabel}</span> : null}
        </div>
      </div>

      {state === 'loading' ? (
        <div className={styles.rowPreviewSkeletonGroup} data-testid="row-preview-skeleton">
          <span className={styles.rowPreviewSkeletonLine} />
          <span className={styles.rowPreviewSkeletonLine} />
          <span className={styles.rowPreviewSkeletonLine} />
        </div>
      ) : null}

      {state === 'error' ? <p className={styles.rowPreviewMessage}>Couldn&apos;t load details</p> : null}

      {state === 'forbidden' ? (
        <p className={styles.rowPreviewMessage}>You don&apos;t have access to this contract&apos;s details</p>
      ) : null}

      {state === 'ready' && preview ? (
        <>
          {preview.hodApprovedAt ? (
            <p className={styles.rowPreviewHodApproval} data-testid="row-preview-hod-approval">
              HOD approved {formatDate(preview.hodApprovedAt)}
            </p>
          ) : null}

          {preview.description ? (
            <p className={styles.rowPreviewDescription} data-testid="row-preview-description">
              {preview.description}
            </p>
          ) : null}

          {preview.additionalApprovers.length > 0 ? (
            <div className={styles.rowPreviewSection}>
              <div className={styles.rowPreviewSectionHead}>
                <span>APPROVERS</span>
                <span>{`${preview.approvedCount} of ${preview.totalApprovers}`}</span>
              </div>
              {visibleApprovers.map((approver) => (
                <div key={approver.id} className={styles.rowPreviewListRow}>
                  <span>{approver.email}</span>
                  <span className={styles.rowPreviewListMeta}>{resolveApproverLabel(approver)}</span>
                </div>
              ))}
              {hiddenApproverCount > 0 ? (
                <p className={styles.rowPreviewMore}>{`+${hiddenApproverCount} more`}</p>
              ) : null}
            </div>
          ) : null}

          {preview.signatories.length > 0 ? (
            <div className={styles.rowPreviewSection}>
              <div className={styles.rowPreviewSectionHead}>
                <span>SIGNERS</span>
                <span>{`${preview.signedCount} of ${preview.totalSigners}`}</span>
              </div>
              {visibleSigners.map((signer) => (
                <div key={signer.id} className={styles.rowPreviewListRow}>
                  <span>{signer.email}</span>
                  <span className={styles.rowPreviewListMeta} data-testid={`signer-status-${signer.email}`}>
                    {resolveSignerLabel(signer, activeRoutingOrder)}
                  </span>
                </div>
              ))}
              {hiddenSignerCount > 0 ? <p className={styles.rowPreviewMore}>{`+${hiddenSignerCount} more`}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
