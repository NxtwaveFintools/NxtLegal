# FAQ Drawer — Design Spec

Date: 2026-07-22

## Goal

Give users in-app access to the Legal & Compliance FAQ (raising requests, TAT, PO process,
NxtLegal form fields) without leaving their current dashboard view. Content source: internal
`Legal_Compliance_FAQ` document.

## Non-goals

- No CMS/admin editing of FAQ content — it's static, hardcoded content.
- No search/filter within the FAQ.
- No analytics/tracking of which questions are opened.

## Architecture

Two new files:

- `src/modules/dashboard/ui/FaqDrawer.tsx` — client component, self-contained. Holds its own
  accordion open/closed state. Takes `isOpen: boolean` and `onClose: () => void`. FAQ content
  (4 Q&A sections) is a local const inside this file — not extracted to a separate data module,
  since nothing else consumes it.
- `src/modules/dashboard/ui/FaqDrawer.module.css` — new CSS Module using the app's existing
  theme tokens (`--color-surface`, `--color-border`, `--color-accent`, `--color-text*`,
  `--radius-*`) so the drawer respects light/dark theme automatically via `data-theme`, rather
  than hardcoding colors as the original ask suggested.

One existing file changes:

- `src/modules/dashboard/ui/ProtectedAppShell.tsx` — adds `isFaqOpen` state (`useState`), a new
  sidebar trigger button in `bottomNav` (before Settings), and renders `<FaqDrawer />` once
  alongside existing content.

No new dependencies. No headless-UI/accordion library is added — this codebase has none
(confirmed via package.json), and hand-rolls all its overlays/dialogs already
(`WorkflowSidebar.tsx`, the action dialog in `ContractsWorkspace.tsx`).

## Placement & trigger

In `ProtectedAppShell.tsx`'s `bottomNav` block, a new button is added **before** the existing
Settings button. Resulting order: **FAQ → Settings → Chat**.

- Icon: `BookOpen` from `lucide-react`, `size={18}` (existing icons in this sidebar are ~18px
  raw SVGs; lucide is already a project dependency, used elsewhere e.g. `ContractsWorkspace.tsx`).
- Styled with the existing `.navItem` / `.navIcon` classes so it automatically gets the
  hover-tooltip behavior (`data-nav-label="FAQ"`) already implemented via `.navItem::after` in
  `dashboard.module.css`.
- `aria-label="FAQ"`.
- Not treated as a `activeNav` route — it's a drawer toggle, not a page, so no highlighted/active
  state logic is needed for it.

## Drawer behavior

Mirrors the existing slide-over pattern from `WorkflowSidebar.tsx` /
`third-party-upload.module.css`:

- A fixed, full-viewport `overlay` div: blurred background, click-to-close, fades in/out via
  opacity transition.
- A fixed `aside` anchored to the right edge, `width: min(420px, 92vw)` (narrower than the 56vw
  upload sidebar, since this is read-only reference content), sliding in via
  `transform: translateX(...)` transition (reusing/adapting the already-defined-but-unused
  `slideInRight` keyframe in `globals.css`, or an equivalent transform transition consistent with
  `WorkflowSidebar`'s approach).
- Close triggers: clicking the overlay, a header close (X) button (lucide `X` icon), and the
  Escape key — handled via a `window.addEventListener('keydown', ...)` effect scoped to when
  `isOpen` is true, matching the existing pattern in `ContractsWorkspace.tsx` (`onKey` checking
  `e.key === 'Escape'`).
- No body-scroll lock — consistent with how existing overlays in this codebase behave (none of
  them lock body scroll either).

## Accordion

- Single `useState<number | null>` tracks which of the 4 questions is expanded; opening one
  closes any other (per the "only one open at a time" requirement).
- Each item: a button row (question text + chevron icon that rotates 180° when open) followed by
  an answer panel that collapses/expands via a `max-height` + `opacity` CSS transition — the same
  technique already used for `.dashboardIntro` / `.dashboardIntroCollapsed` in
  `dashboard.module.css`, applied here as `.answerPanel` / `.answerPanelOpen`.
- Content layout per question:
  - **Q1** (raise a request): rendered as a 4-step ordered structure (Step 1–4), each with a short
    paragraph. Step 4 also lists the 7 legal-team email addresses as plain text/mailto links.
  - **Q2** (TAT): intro paragraph + a small 2-column key/value list (Task Type → TAT) for the
    three TAT rows.
  - **Q3** (PO process): rendered as a 5-item ordered list; items 2–3 present the ₹10L threshold
    as two labeled sub-blocks (Below ₹10 lakhs / ₹10 lakhs and above) rather than a table.
  - **Q4** (form fields): each field name is a subheading followed by its guidance text and,
    where applicable, a "(mandatory)" note — no literal `<table>`, since it won't fit the drawer's
    420px width legibly.

## Content (verbatim from task spec)

All four Q&A blocks and their exact copy are as provided in the task's `content_to_insert`
section — reproduced faithfully in the component, not summarized or altered. Email addresses are
rendered as `mailto:` links.

## Accessibility

- Trigger button: `aria-label="FAQ"`.
- Drawer: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the drawer's title.
- Accordion buttons: `aria-expanded` reflects open state; each answer panel has `id` referenced by
  the trigger button's `aria-controls`.
- Escape closes; overlay click closes; close button is keyboard-reachable and first in tab order
  after the drawer opens (no full focus-trap — consistent with existing overlays in this
  codebase, none of which implement a focus trap either).

## Testing

- Manual verification only (per existing convention for UI-only additions like this): open
  drawer from sidebar, confirm placement (FAQ above Settings), confirm only one accordion section
  open at a time, confirm close via overlay/X/Escape, confirm layout holds in both light and dark
  theme and at narrow viewport widths (mobile sidebar layout already collapses to a horizontal
  bar under 768px — the new button just needs to render correctly there, not get special
  handling).
- No new automated tests planned — this is static, presentational content with no business logic
  or data flow to unit test, consistent with how other purely-presentational pieces in this
  codebase (e.g. `WorkflowSidebar`) are handled.
