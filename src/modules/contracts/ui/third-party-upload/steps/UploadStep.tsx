'use client'

import styles from '../third-party-upload.module.css'

type UploadStepProps = {
  isSubmitting: boolean
  errorMessage: string | null
  successMessage: string | null
}

export default function UploadStep({ isSubmitting, errorMessage, successMessage }: UploadStepProps) {
  return (
    <div>
      <div className={styles.sectionTitle}>Upload</div>
      <p className={styles.helperText}>Submit the contract and initialize workflow routing.</p>
      {isSubmitting && <p className={styles.helperText}>Uploading contract...</p>}
      {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
      {successMessage && <p className={styles.helperText}>{successMessage}</p>}
    </div>
  )
}
