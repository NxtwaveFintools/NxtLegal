'use client'

import styles from '../third-party-upload.module.css'

type UploadStepProps = {
  isSubmitting: boolean
  successMessage: string | null
  /** 0–100 upload progress; null when not yet started */
  uploadProgress: number | null
  /** Called when the user clicks Cancel */
  onCancel?: () => void
}

export default function UploadStep({ isSubmitting, successMessage, uploadProgress, onCancel }: UploadStepProps) {
  return (
    <div>
      <div className={styles.sectionTitle}>Upload</div>
      <p className={styles.helperText}>Submit the contract and initialize workflow routing.</p>

      {isSubmitting && (
        <div className={styles.uploadProgressSection}>
          <div className={styles.uploadProgressHeader}>
            <span className={styles.helperText}>
              {uploadProgress !== null && uploadProgress < 100
                ? `Uploading… ${uploadProgress}%`
                : uploadProgress === 100
                  ? 'Processing…'
                  : 'Preparing upload…'}
            </span>
            {onCancel && uploadProgress !== null && uploadProgress < 100 && (
              <button type="button" className={styles.cancelButton} onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${uploadProgress ?? 0}%` }}
              role="progressbar"
              aria-valuenow={uploadProgress ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            />
          </div>
        </div>
      )}

      {successMessage && <p className={styles.helperText}>{successMessage}</p>}
    </div>
  )
}
