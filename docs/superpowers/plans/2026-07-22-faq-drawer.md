# FAQ Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sidebar-triggered, right-side slide-over drawer showing the Legal & Compliance FAQ (raising requests, TAT, PO process, NxtLegal form fields) as a single-open accordion.

**Architecture:** A new self-contained `FaqDrawer` client component (own CSS Module, own accordion state) is mounted once inside `ProtectedAppShell`, which also gains a new sidebar trigger button (before Settings) and one piece of state to open/close it. No new dependencies; the drawer/overlay pattern mirrors the existing `WorkflowSidebar.tsx`.

**Tech Stack:** Next.js (App Router), React (client components), CSS Modules using the app's existing `--color-*`/`--radius-*` theme tokens, `lucide-react` for icons.

## Global Constraints

- No new npm dependencies (no headless-UI/accordion library) — confirmed absent from `package.json`; this codebase hand-rolls all overlays.
- Styling uses CSS Modules with the existing theme tokens (`--color-surface`, `--color-border`, `--color-accent`, `--color-text`, `--color-text-muted`, `--radius-sm`, `--radius-md`, `--radius-lg`) — not Tailwind utility classes, not hardcoded hex colors.
- Only one accordion section open at a time.
- Sidebar order after this change: **FAQ → Settings → Chat** (FAQ button goes immediately before the existing Settings button in `bottomNav`).
- FAQ content text must be reproduced verbatim from the spec (`docs/superpowers/specs/2026-07-22-faq-drawer-design.md`) — no summarizing or rewording.
- No automated tests for this task (static, presentational content — consistent with `WorkflowSidebar.tsx`, which also has no test file). Verification is `type-check` + `lint` + manual QA.

---

### Task 1: Build the `FaqDrawer` component

**Files:**
- Create: `src/modules/dashboard/ui/FaqDrawer.module.css`
- Create: `src/modules/dashboard/ui/FaqDrawer.tsx`

**Interfaces:**
- Produces: `export default function FaqDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void })` — a React client component. This is the exact signature Task 2 will import and render.

- [ ] **Step 1: Create the CSS Module**

Create `src/modules/dashboard/ui/FaqDrawer.module.css`:

```css
.overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--color-overlay) 86%, transparent);
  backdrop-filter: blur(2px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
  z-index: 60;
}

.overlayOpen {
  opacity: 1;
  pointer-events: auto;
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: min(420px, 92vw);
  max-width: 100%;
  background:
    radial-gradient(130% 90% at 100% -10%, color-mix(in srgb, var(--color-accent) 9%, transparent) 0, transparent 56%),
    linear-gradient(180deg, color-mix(in srgb, var(--color-surface-muted) 56%, transparent) 0, transparent 240px),
    var(--color-surface);
  border-left: 1px solid var(--color-border);
  box-shadow: -22px 0 46px rgb(0 0 0 / 0.14);
  overflow: hidden;
  transform: translateX(100%);
  transition: transform 0.36s cubic-bezier(0.34, 1.2, 0.64, 1);
  z-index: 70;
  display: flex;
  flex-direction: column;
}

.drawerOpen {
  transform: translateX(0);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface) 90%, transparent);
  backdrop-filter: blur(18px);
  flex-shrink: 0;
}

.headerTitleBlock {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--color-accent);
}

.headerTitle {
  font-size: 15px;
  font-weight: 750;
  color: var(--color-text);
  line-height: 1.3;
}

.closeButton {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;
}

.closeButton:hover {
  border-color: color-mix(in srgb, var(--color-accent) 44%, var(--color-border));
  background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
  color: var(--color-accent);
}

.body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: hidden;
}

.question {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}

.question:hover {
  color: var(--color-accent);
}

.chevron {
  flex-shrink: 0;
  color: var(--color-text-muted);
  transition: transform 0.25s ease;
}

.chevronOpen {
  transform: rotate(180deg);
  color: var(--color-accent);
}

.answerPanel {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition:
    max-height 0.36s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.28s ease;
}

.answerPanelOpen {
  max-height: 1400px;
  opacity: 1;
}

.answerContent {
  padding: 0 16px 16px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--color-text-muted);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stepList {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 18px;
  margin: 0;
}

.stepItem::marker {
  color: var(--color-accent);
  font-weight: 700;
}

.stepLabel {
  color: var(--color-text);
  font-weight: 650;
}

.emailList {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 6px;
  padding: 0;
  list-style: none;
}

.emailLink {
  color: var(--color-accent);
  text-decoration: none;
  font-size: 12px;
  word-break: break-all;
}

.emailLink:hover {
  text-decoration: underline;
}

.kvList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kvRow {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  padding: 8px 10px;
}

.kvLabel {
  color: var(--color-text);
  font-weight: 650;
  font-size: 12px;
}

.kvValue {
  color: var(--color-text-muted);
}

.fieldList {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fieldName {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text);
  font-weight: 650;
  font-size: 12.5px;
}

.fieldRequired {
  color: var(--color-danger);
  font-weight: 750;
}

.fieldDesc {
  margin-top: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .drawer,
  .overlay,
  .chevron,
  .answerPanel {
    transition: none;
  }
}
```

- [ ] **Step 2: Create the component**

Create `src/modules/dashboard/ui/FaqDrawer.tsx`:

```tsx
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
          Identify the Point of Contact (POC) from your team responsible for raising new legal
          and compliance task requests. Once identified, request the POC to submit the task on
          NxtLegal by completing the Compliance Request form. Not sure who your POC is? Share
          your team details along with the name of your Head of Department (HOD), and the legal
          team will help identify the right POC.
        </li>
        <li className={styles.stepItem}>
          <span className={styles.stepLabel}>Step 2 — Raise the request on NxtLegal: </span>
          Complete the Template Contract Form on NxtLegal for all new legal and compliance
          requests. Ensure all required fields are filled in accurately. If a document needs to
          be reviewed, upload it within the form. The HOD must log in to NxtLegal to approve the
          task request. HOD approval is mandatory — legal will not have access to the document
          until approved.
        </li>
        <li className={styles.stepItem}>
          <span className={styles.stepLabel}>Step 3 — Additional approval for commercial terms: </span>
          If the agreement or document involves any commercials, also get approval from the Vice
          President of Finance via email.
        </li>
        <li className={styles.stepItem}>
          <span className={styles.stepLabel}>Step 4 — Task pick-up by the legal team: </span>
          Once HOD approval is granted, the legal team will take up the task. Requesters can
          block time on the legal team&apos;s calendar for further discussion, either via Teams
          or offline. Please include the legal team on all related emails:
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
          After all necessary information is shared and the Knowledge Transfer (KT) is complete,
          the legal team will discuss and confirm the expected Turnaround Time (TAT) for the
          task.
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
          Share budget approvals and the quotation/invoice; PO then goes through HOD and Finance
          review before legal adds terms &amp; conditions.
        </li>
        <li className={styles.stepItem}>
          Following HOD approval, the PO is reviewed by the Finance Team to ensure all financial
          details are accurate and aligned.
        </li>
        <li className={styles.stepItem}>
          Only after both HOD and Finance Team approvals are received will the legal team add the
          necessary terms and conditions to the PO, ensuring all compliance and legal
          requirements are met.
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
          Fill in every field completely and clearly — vague entries are the #1 reason requests
          get sent back, which resets the TAT clock.
        </p>
        <div className={styles.fieldList}>
          <div>
            <div className={styles.fieldName}>
              Contract Title &amp; Type <span className={styles.fieldRequired}>*</span>
            </div>
            <p className={styles.fieldDesc}>
              A clear title (e.g. counterparty + agreement type) and the correct type from the
              dropdown (NDA, MSA, PO, IP transfer, etc.)
            </p>
          </div>
          <div>
            <div className={styles.fieldName}>
              Description <span className={styles.fieldRequired}>*</span>
            </div>
            <p className={styles.fieldDesc}>
              The most important field. Cover: background, purpose, requesting team, rationale,
              and who&apos;s requesting it — in detail.
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
              If approval isn&apos;t in place yet, state clearly why. Blank or generic reasons
              will hold up the request.
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
              Name, designation, and contact of the signatory, plus supporting documents (KYC,
              authorization letters, etc.).
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
      <div
        className={`${styles.overlay} ${isOpen ? styles.overlayOpen : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
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
```

- [ ] **Step 3: Type-check and lint**

Run: `npm run type-check`
Expected: no errors related to `FaqDrawer.tsx`.

Run: `npm run lint`
Expected: no errors/warnings related to `FaqDrawer.tsx` or `FaqDrawer.module.css`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/dashboard/ui/FaqDrawer.tsx src/modules/dashboard/ui/FaqDrawer.module.css
git commit -m "feat: add FaqDrawer component with Legal & Compliance FAQ content"
```

---

### Task 2: Wire the FAQ trigger and drawer into `ProtectedAppShell`

**Files:**
- Modify: `src/modules/dashboard/ui/ProtectedAppShell.tsx:1-27` (imports, props are untouched), `:198-225` (`bottomNav` block), `:260-261` (end of returned JSX, just before the closing `</div>` of `.content`... actually the drawer must be a sibling of `.page`'s children, see Step 2 below for exact placement)

**Interfaces:**
- Consumes: `FaqDrawer` from `./FaqDrawer` with props `{ isOpen: boolean; onClose: () => void }` (produced in Task 1).

- [ ] **Step 1: Add imports and state**

In `src/modules/dashboard/ui/ProtectedAppShell.tsx`, add to the top imports (after the existing `useMemo` import line):

```tsx
'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import LogoutButton from '@/components/auth/LogoutButton'
import ThemeToggle from '@/components/theme/ThemeToggle'
import FaqDrawer from './FaqDrawer'
import { routeRegistry } from '@/core/config/route-registry'
import styles from './dashboard.module.css'
```

(This replaces the existing `import { useMemo } from 'react'` line with `import { useMemo, useState } from 'react'`, and adds the `BookOpen` and `FaqDrawer` imports.)

Inside the component body, add the new state right after the `canAccessAdminConsole` line (around line 56):

```tsx
  const canAccessAdminConsole = ['ADMIN', 'LEGAL_ADMIN', 'SUPER_ADMIN'].includes((session.role ?? '').toUpperCase())
  const [isFaqOpen, setIsFaqOpen] = useState(false)
```

- [ ] **Step 2: Add the sidebar trigger button before Settings**

In the `bottomNav` block (currently lines 198–225), add a new button immediately before the existing Settings button:

```tsx
        <div className={styles.bottomNav}>
          <button
            type="button"
            className={styles.navItem}
            aria-label="FAQ"
            data-nav-label="FAQ"
            onClick={() => setIsFaqOpen(true)}
          >
            <span className={styles.navIcon}>
              <BookOpen size={18} aria-hidden="true" />
            </span>
          </button>
          <button type="button" className={styles.navItem} aria-label="Settings" data-nav-label="Settings">
            {/* ...existing Settings SVG unchanged... */}
          </button>
          <button type="button" className={styles.navItem} aria-label="Chat" data-nav-label="Chat">
            {/* ...existing Chat SVG unchanged... */}
          </button>
        </div>
```

(Only the new FAQ button is added; the existing Settings and Chat buttons and their inline SVGs are left exactly as they are today.)

- [ ] **Step 3: Render `FaqDrawer`**

At the end of the component's returned JSX, render `FaqDrawer` as a sibling of the top-level `.page` div's content — i.e. just before the final closing tag of the component, so it overlays everything regardless of `.content` scroll state:

```tsx
      <div className={styles.content}>
        {/* ...header/topbar and children unchanged... */}
      </div>

      <FaqDrawer isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} />
    </div>
  )
}
```

(`<FaqDrawer ... />` goes right after the closing `</div>` of `styles.content` and right before the closing `</div>` of `styles.page` — i.e. it's the third child of `.page`, alongside `.sidebar` and `.content`.)

- [ ] **Step 4: Type-check, lint, and build**

Run: `npm run type-check`
Expected: no errors.

Run: `npm run lint`
Expected: no errors/warnings.

Run: `npm run build`
Expected: build succeeds with no new errors or warnings attributable to this change.

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/ui/ProtectedAppShell.tsx
git commit -m "feat: add FAQ trigger to sidebar and mount FaqDrawer in ProtectedAppShell"
```

---

### Task 3: Manual QA

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts at `http://localhost:3000` with no compile errors.

- [ ] **Step 2: Log in and open the dashboard**

Follow `SETUP.md`'s employee login flow (`npm run test:login` or navigate to `http://localhost:3000/login`) and land on the protected dashboard.

- [ ] **Step 3: Verify sidebar placement**

Confirm the sidebar's bottom group shows, top-to-bottom: FAQ (book icon) → Settings (gear icon) → Chat (speech-bubble icon). Hover the FAQ icon and confirm the tooltip reads "FAQ".

- [ ] **Step 4: Verify drawer open/close**

Click the FAQ icon: confirm the background dims/blurs and the drawer slides in from the right without covering the full viewport, showing the title "Legal & Compliance FAQ" and four collapsed accordion rows. Close it three ways in turn (click the overlay, click the X button, press Escape) and confirm each closes the drawer and the background returns to normal.

- [ ] **Step 5: Verify accordion behavior**

Open the FAQ drawer. Click each of the 4 questions in turn and confirm: only one answer is expanded at a time (opening a second one collapses the first), the chevron rotates when open, and the content matches the spec verbatim — including the 7 legal-team email addresses in Q1 (each a clickable `mailto:` link), the 3-row TAT table in Q2, the 5-step PO process in Q3, and the 6 form fields (with `*` markers on the 5 mandatory ones) in Q4.

- [ ] **Step 6: Verify theming and responsiveness**

Toggle the app's theme switcher between light and dark and confirm the drawer's colors adapt correctly in both (no hardcoded colors that clash). Resize the browser to a narrow/mobile width and confirm the sidebar's horizontal layout still shows the FAQ icon and it still opens the drawer correctly.

No commit for this task — it's verification only. If any issue is found, fix it in the relevant file from Task 1 or Task 2 and re-run the affected verification steps before moving on.
