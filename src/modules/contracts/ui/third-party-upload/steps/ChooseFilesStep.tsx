'use client'

import type { DragEvent } from 'react'
import { formatFileSize } from '@/lib/format-file-size'
import styles from '../third-party-upload.module.css'

type ChooseFilesStepProps = {
  mainFile: File | null
  isDragging: boolean
  acceptedExtensionsLabel: string
  acceptedFileTypes: string
  onFileSelected: (file: File) => void
  onFileRemoved: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}

export default function ChooseFilesStep({
  mainFile,
  isDragging,
  acceptedExtensionsLabel,
  acceptedFileTypes,
  onFileSelected,
  onFileRemoved,
  onDragOver,
  onDragLeave,
  onDrop,
}: ChooseFilesStepProps) {
  return (
    <div className={styles.chooseFilesStep}>
      <div className={styles.chooseFilesHero}>
        <div className={styles.chooseFilesEyebrow}>Primary Document</div>
        <div className={styles.sectionTitle}>Choose Files</div>
        <p className={styles.helperText}>Upload your contract draft to start intake and review workflow.</p>
        <span className={styles.allowedFileChip}>{`${acceptedExtensionsLabel} only - single main file`}</span>
      </div>

      <div
        className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <span className={styles.dropzoneTitle}>Drag and drop your contract here</span>
        <span className={styles.dropzoneHint}>or browse from your device</span>
        <label className={styles.dropzoneButton} htmlFor="main-contract-upload">
          Choose file
        </label>
        <input
          id="main-contract-upload"
          className={styles.hiddenInput}
          type="file"
          accept={acceptedFileTypes}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              onFileSelected(file)
            }
          }}
        />
      </div>

      {mainFile && (
        <div className={styles.fileCard}>
          <div className={styles.fileMeta}>
            <span className={styles.fileStatus}>Ready to upload</span>
            <span className={styles.fileName}>{mainFile.name}</span>
            <span className={styles.fileSize}>{formatFileSize(mainFile.size)}</span>
          </div>
          <button type="button" onClick={onFileRemoved} className={styles.removeButton}>
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
