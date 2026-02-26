import { contractStatusLabels, type ContractStatus } from '@/core/constants/contracts'
import styles from './ContractStatusBadge.module.css'

type ContractStatusBadgeProps = {
  status: ContractStatus | string
  displayLabel?: string
}

const statusClassName: Record<ContractStatus, string> = {
  DRAFT: styles.draft,
  UPLOADED: styles.uploaded,
  HOD_PENDING: styles.hodPending,
  UNDER_REVIEW: styles.legalPending,
  PENDING_WITH_INTERNAL_STAKEHOLDERS: styles.legalPending,
  PENDING_WITH_EXTERNAL_STAKEHOLDERS: styles.finalApproved,
  OFFLINE_EXECUTION: styles.finalApproved,
  ON_HOLD: styles.legalQuery,
  COMPLETED: styles.finalApproved,
  EXECUTED: styles.finalApproved,
  VOID: styles.legalQuery,
  REJECTED: styles.legalQuery,
}

export default function ContractStatusBadge({ status, displayLabel }: ContractStatusBadgeProps) {
  const normalized = status as ContractStatus
  const label = displayLabel ?? contractStatusLabels[normalized] ?? status
  const className = statusClassName[normalized] ?? styles.uploaded

  return <span className={`${styles.badge} ${className}`}>{label}</span>
}
