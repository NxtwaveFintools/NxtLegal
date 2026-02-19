'use client'

import styles from '../third-party-upload.module.css'

type ReviewStepProps = {
  mainFileName: string | null
  contractType: string
  counterparty: string
  supportingCount: number
  organizationEntity: string
}

export default function ReviewStep({
  mainFileName,
  contractType,
  counterparty,
  supportingCount,
  organizationEntity,
}: ReviewStepProps) {
  return (
    <div>
      <div className={styles.sectionTitle}>Review</div>
      <p className={styles.helperText}>Confirm the details before upload.</p>
      <div className={styles.summaryRow}>
        <span>Main Document</span>
        <span>{mainFileName || 'Not set'}</span>
      </div>
      <div className={styles.summaryRow}>
        <span>Contract Type</span>
        <span>{contractType || 'Not set'}</span>
      </div>
      <div className={styles.summaryRow}>
        <span>Counterparty</span>
        <span>{counterparty || 'Not set'}</span>
      </div>
      <div className={styles.summaryRow}>
        <span>Supporting Documents</span>
        <span>{supportingCount}</span>
      </div>
      <div className={styles.summaryRow}>
        <span>Organization Entity</span>
        <span>{organizationEntity}</span>
      </div>
    </div>
  )
}
