'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import styles from './drive.module.css'

type DriveModalProps = {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export default function DriveModal({ title, subtitle, onClose, children, footer }: DriveModalProps) {
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <div className={styles.headerTitle}>{title}</div>
            {subtitle ? <div className={styles.headerSub}>{subtitle}</div> : null}
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>
  )
}
