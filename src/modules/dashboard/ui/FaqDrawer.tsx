'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, ChevronDown, X } from 'lucide-react'
import styles from './FaqDrawer.module.css'

type FaqDrawerProps = {
  isOpen: boolean
  onClose: () => void
}

type FaqItem = {
  id: string
  question: string
  body: ReactNode
}

const legalTeamEmails = [
  'pranjal.sharma@nxtwave.co.in',
  'megha.ahuja@nxtwave.co.in',
  'akash.garg@nxtwave.co.in',
  'vidushi.jha@nxtwave.co.in',
  'madhur.goyal@nxtwave.co.in',
  'alekhya.k@nxtwave.co.in',
  'akhilesh.jhawar@nxtwave.co.in',
]

const faqItems: FaqItem[] = [
  {
    id: 'raise-request',
    question: 'How do I raise a legal / compliance task request?',
    body: (
      <ol className={styles.stepList}>
        <li className={styles.stepItem}>
          <span className={styles.stepLabel}>Step 1 — Identify your POC: </span>
          Identify the Point of Contact (POC) from your team responsible for raising new legal and compliance task
          requests. Once identified, request the POC to submit the task on NxtLegal by completing the Compliance Request
          form. Not sure who your POC is? Share your team details along with the name of your Head of Department (HOD),
          and the legal team will help identify the right POC.
        </li>
        <li className={styles.stepItem}>
          <span className={styles.stepLabel}>Step 2 — Raise the request on NxtLegal: </span>
          Complete the Template Contract Form on NxtLegal for all new legal and compliance requests. Ensure all required
          fields are filled in accurately. If a document needs to be reviewed, upload it within the form. The HOD must
          log in to NxtLegal to approve the task request. HOD approval is mandatory — legal will not have access to the
          document until approved.
        </li>
        <li className={styles.stepItem}>
          <span className={styles.stepLabel}>Step 3 — Additional approval for commercial terms: </span>
          If the agreement or document involves any commercials, also get approval from the Vice President of Finance
          via email.
        </li>
        <li className={styles.stepItem}>
          <span className={styles.stepLabel}>Step 4 — Task pick-up by the legal team: </span>
          Once HOD approval is granted, the legal team will take up the task. Requesters can block time on the legal
          team&apos;s calendar for further discussion, either via Teams or offline. Please include the legal team on all
          related emails:
          <ul className={styles.emailList}>
            {legalTeamEmails.map((email) => (
              <li key={email}>
                <a className={styles.emailLink} href={`mailto:${email}`}>
                  {email}
                </a>
              </li>
            ))}
          </ul>
        </li>
      </ol>
    ),
  },
  {
    id: 'tat',
    question: 'What is the TAT for the completion of the task?',
    body: (
      <>
        <p>
          After all necessary information is shared and the Knowledge Transfer (KT) is complete, the legal team will
          discuss and confirm the expected Turnaround Time (TAT) for the task.
        </p>
        <div className={styles.kvList}>
          <div className={styles.kvRow}>
            <span className={styles.kvLabel}>Standard legal / compliance task</span>
            <span className={styles.kvValue}>
              7 working days from date of HOD approval (once all required info is received)
            </span>
          </div>
          <div className={styles.kvRow}>
            <span className={styles.kvLabel}>Contracts requiring external review</span>
            <span className={styles.kvValue}>10 business days</span>
          </div>
          <div className={styles.kvRow}>
            <span className={styles.kvLabel}>Purchase Orders (PO)</span>
            <span className={styles.kvValue}>As per PO-specific process below</span>
          </div>
        </div>
      </>
    ),
  },
  {
    id: 'po-process',
    question: 'Process for Purchase Orders (POs)',
    body: (
      <ol className={styles.stepList}>
        <li className={styles.stepItem}>
          The PO must first be reviewed and approved by your Head of Department (HOD).
        </li>
        <li className={styles.stepItem}>
          <span className={styles.stepLabel}>Below ₹10 lakhs: </span>
          Reach out to the Finance team directly — they handle this directly.
        </li>
        <li className={styles.stepItem}>
          <span className={styles.stepLabel}>₹10 lakhs and above: </span>
          Share budget approvals and the quotation/invoice; PO then goes through HOD and Finance review before legal
          adds terms &amp; conditions.
        </li>
        <li className={styles.stepItem}>
          Following HOD approval, the PO is reviewed by the Finance Team to ensure all financial details are accurate
          and aligned.
        </li>
        <li className={styles.stepItem}>
          Only after both HOD and Finance Team approvals are received will the legal team add the necessary terms and
          conditions to the PO, ensuring all compliance and legal requirements are met.
        </li>
      </ol>
    ),
  },
  {
    id: 'form-fields',
    question: 'What should I fill in on the NxtLegal request form?',
    body: (
      <>
        <p>
          Fill in every field completely and clearly — vague entries are the #1 reason requests get sent back, which
          resets the TAT clock.
        </p>
        <div className={styles.fieldList}>
          <div>
            <div className={styles.fieldName}>
              Contract Title &amp; Type <span className={styles.fieldRequired}>*</span>
            </div>
            <p className={styles.fieldDesc}>
              A clear title (e.g. counterparty + agreement type) and the correct type from the dropdown (NDA, MSA, PO,
              IP transfer, etc.)
            </p>
          </div>
          <div>
            <div className={styles.fieldName}>
              Description <span className={styles.fieldRequired}>*</span>
            </div>
            <p className={styles.fieldDesc}>
              The most important field. Cover: background, purpose, requesting team, rationale, and who&apos;s
              requesting it — in detail.
            </p>
          </div>
          <div>
            <div className={styles.fieldName}>
              Founder Approval <span className={styles.fieldRequired}>*</span>
            </div>
            <p className={styles.fieldDesc}>Mandatory for every request. Attach the approvals here as well.</p>
          </div>
          <div>
            <div className={styles.fieldName}>
              Reason for No Founder Approval <span className={styles.fieldRequired}>*</span>
            </div>
            <p className={styles.fieldDesc}>
              If approval isn&apos;t in place yet, state clearly why. Blank or generic reasons will hold up the request.
            </p>
          </div>
          <div>
            <div className={styles.fieldName}>
              Counterparty Name <span className={styles.fieldRequired}>*</span>
            </div>
            <p className={styles.fieldDesc}>Full legal name — no abbreviations or trade names.</p>
          </div>
          <div>
            <div className={styles.fieldName}>Counterparty Signatory Details</div>
            <p className={styles.fieldDesc}>
              Name, designation, and contact of the signatory, plus supporting documents (KYC, authorization letters,
              etc.).
            </p>
          </div>
        </div>
      </>
    ),
  },
]

export default function FaqDrawer({ isOpen, onClose }: FaqDrawerProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  return (
    <>
      <div className={`${styles.overlay} ${isOpen ? styles.overlayOpen : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="faq-drawer-title"
        aria-hidden={!isOpen}
      >
        <div className={styles.header}>
          <div className={styles.headerTitleBlock}>
            <BookOpen size={18} aria-hidden="true" />
            <span id="faq-drawer-title" className={styles.headerTitle}>
              Legal &amp; Compliance FAQ
            </span>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close FAQ">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.body}>
          {faqItems.map((item, index) => {
            const isItemOpen = openIndex === index

            return (
              <div key={item.id} className={styles.item}>
                <button
                  type="button"
                  className={styles.question}
                  onClick={() => setOpenIndex(isItemOpen ? null : index)}
                  aria-expanded={isItemOpen}
                  aria-controls={`faq-panel-${item.id}`}
                >
                  <span>{item.question}</span>
                  <ChevronDown
                    size={16}
                    className={`${styles.chevron} ${isItemOpen ? styles.chevronOpen : ''}`}
                    aria-hidden="true"
                  />
                </button>
                <div
                  id={`faq-panel-${item.id}`}
                  className={`${styles.answerPanel} ${isItemOpen ? styles.answerPanelOpen : ''}`}
                >
                  <div className={styles.answerContent}>{item.body}</div>
                </div>
              </div>
            )
          })}
        </div>
      </aside>
    </>
  )
}
