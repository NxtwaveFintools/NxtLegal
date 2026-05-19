'use client'

import type { ReactNode } from 'react'
import styles from './third-party-upload.module.css'

type WorkflowSidebarProps = {
  isOpen: boolean
  title: string
  steps: string[]
  activeStep: number
  onStepChange: (stepIndex: number) => void
  onClose: () => void
  children: ReactNode
  footer: ReactNode
}

export default function WorkflowSidebar({
  isOpen,
  title,
  steps,
  activeStep,
  onStepChange,
  onClose,
  children,
  footer,
}: WorkflowSidebarProps) {
  const progressPercent = Math.max(0, Math.min(100, Math.round(((activeStep + 1) / steps.length) * 100)))

  return (
    <>
      <div className={`${styles.overlay} ${isOpen ? styles.overlayOpen : ''}`} onClick={onClose} />
      <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`} aria-hidden={!isOpen}>
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <span className={styles.title}>{title}</span>
            <span className={styles.subtitle}>{`Step ${activeStep + 1} of ${steps.length}`}</span>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            X
          </button>
        </div>
        <div className={styles.progressTrackMini} aria-hidden="true">
          <span className={styles.progressFillMini} style={{ width: `${progressPercent}%` }} />
        </div>
        <div className={styles.steps}>
          {steps.map((step, index) => {
            const isActive = index === activeStep
            const isCompleted = index < activeStep

            return (
              <button
                key={step}
                type="button"
                onClick={() => onStepChange(index)}
                className={`${styles.stepPill} ${isActive ? styles.stepPillActive : ''} ${isCompleted ? styles.stepPillDone : ''}`}
              >
                <span className={styles.stepIndex}>{isCompleted ? 'OK' : index + 1}</span>
                <span className={styles.stepLabel}>{step}</span>
              </button>
            )
          })}
        </div>
        <div className={styles.content}>{children}</div>
        <div className={styles.footer}>{footer}</div>
      </aside>
    </>
  )
}
