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
  return (
    <>
      <div className={`${styles.overlay} ${isOpen ? styles.overlayOpen : ''}`} onClick={onClose} />
      <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`} aria-hidden={!isOpen}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            X
          </button>
        </div>
        <div className={styles.steps}>
          {steps.map((step, index) => (
            <button
              key={step}
              type="button"
              onClick={() => onStepChange(index)}
              className={`${styles.stepPill} ${index === activeStep ? styles.stepPillActive : ''}`}
            >
              {step}
            </button>
          ))}
        </div>
        <div className={styles.content}>{children}</div>
        <div className={styles.footer}>{footer}</div>
      </aside>
    </>
  )
}
