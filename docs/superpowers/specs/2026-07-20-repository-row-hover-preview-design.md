# Repository Row Hover Preview — Design

**Date:** 2026-07-20
**Status:** Implemented (as-built)
**Requested by:** Legal team

## Revision Log

| Date | Change |
|---|---|
| 2026-07-20 | Original design approved. |
| 2026-07-20 | After Legal reviewed the working card: POC block, HOD name, the requested/effective/termination date line, and the latest-activity line all removed. HOD approval date kept and moved directly beneath the contract name. Description clamp raised from 3 to 7 lines. Approver and signer rows re-keyed on row `id` after duplicate emails were found in production data. Dropping activity removed the `getTimeline` call, taking the endpoint from five queries to four. |

This document describes what shipped. Where the original design differed, the
difference is noted rather than silently rewritten, so the reasoning stays
traceable.

## Problem

In the Repository section, seeing who is signing a contract, who still needs to
approve it, or what the request was actually about requires opening the contract
detail page. Legal reviews many contracts per session, so this is a repeated
context switch to answer questions that are often one glance deep.

## Goal

Hovering a contract row surfaces a compact snapshot of the contract's people and
signing progress, without navigating away from the table.

## Non-Goals

- Not a replacement for the contract detail page. The card is read-only and
  offers no actions.
- Not a mirror of the table. Fields already rendered as columns are excluded.
- No mobile/touch equivalent in this scope. Hover is a pointer interaction; the
  card is suppressed where hover is unavailable.

## Key Constraint Discovered

The repository list query uses a trimmed column set
(`supabase-contract-query-repository.ts:116`, `repositoryContractsSelectMinimal`)
which omits `background_of_request`, `counterparty_name`, and all `signatory_*`
columns. The row mapper at line 6414 reads `row.background_of_request`, so
`backgroundOfRequest` resolves to `null` for repository rows today.

Consequently the description is **not** available client-side and must be
fetched. It is deliberately *not* added to the list select:
`background_of_request` is long free text, and adding it would ship it for all 25
rows on every page load, sort, and filter change to serve a hover-only feature.

## Content

Included — none of these appear as table columns:

| Field | Source |
|---|---|
| Description | `contract.backgroundOfRequest` |
| Counterparties | `getCounterparties()` |
| HOD approval date | `contract.hodApprovedAt` |
| Additional approvers + per-approver status | `getAdditionalApprovers()` |
| Signers + per-signer status | `getSignatories()` |

Excluded as redundant with existing columns: Creator, Assigned To, Department,
Founder Approval, Contract Aging, Effective / Termination / Notice Period /
Auto-Renewal.

**Removed after Legal review:**

- **Signatory POC** (name, designation, email). Legal did not need it, and in
  practice it rendered as `NA · NA / na` because those columns contain literal
  `"NA"` strings. Removing the block sidesteps the symptom; the underlying
  literals remain a separate normalization concern.
- **Department HOD name.** The approval *date* was the useful part; the name was
  not.
- **Compact date line** (requested / effective / termination).
- **Latest activity.** It rendered raw event codes such as
  `contract.legal.collaborator.added`, which read as machine output. A
  `formatContractLogEvent.ts` helper already exists in
  `src/modules/contracts/ui/` and could humanize these if activity is ever
  wanted back; doing so costs one additional query.

Header context repeats title, status, and TAT only — these anchor the card to the
row being hovered and render instantly from data the client already holds.

### Layout

```
┌─ Master Services Agreement ───────────────────────┐
│ Acme Corp, Beta Ltd                               │
│ In Signature                    12 days aging     │
├───────────────────────────────────────────────────┤
│ HOD approved 10 Jun                               │
│ Renewal of annual infra support contract with     │
│ revised pricing and extended SLA terms.           │
├───────────────────────────────────────────────────┤
│ APPROVERS                                 1 of 1  │
│  trishanthreddy@nxtwave.co.in    approved 26 May  │
├───────────────────────────────────────────────────┤
│ SIGNERS                                   2 of 3  │
│  vteja797@gmail.com              signed 26 May    │
│  trishanthreddy@nxtwave.co.in    signed 26 May    │
│  billa.hemanth@nxtwave.co.in     pending          │
└───────────────────────────────────────────────────┘
```

### Display rules

- **HOD approval date is the first element under the header**, above the
  description. It carries no border-top of its own, since the header already
  supplies a divider. DOM order is asserted by test so the placement cannot
  silently drift.
- **Empty sections are omitted entirely**, not rendered with placeholder dashes.
  A contract with no additional approvers shows no APPROVERS block.
- **Description** clamps to 7 lines with ellipsis (`-webkit-line-clamp` plus the
  standard `line-clamp`).
- **Signers and approvers** each cap at 5 entries, followed by `+N more`.
- **TAT is role-gated** by the same `canSeeTatAndAging` predicate used for the
  columns (`RepositoryWorkspace.tsx` — LEGAL_TEAM, LEGAL_ADMIN, ADMIN, HOD). The
  label reuses the existing `formatOverdueLabel`, so the card reads "TAT
  Breached" / "Overdue by N days" exactly as the column does, falling back to
  "N days aging".
- **Card width** is fixed at 360px. There is no max-height; the viewport clamp
  repositions a tall card rather than letting it overflow.

### List keys

Approver and signer rows are keyed on the row **`id`**, never on email.

Emails are not unique in this data: the same person legitimately appears twice in
one approver list (successive approval rounds) and across signer routing orders.
Keying on email produced duplicate React keys in production, which can drop or
duplicate rendered rows. Both `ContractRowPreviewApprover` and
`ContractRowPreviewSigner` therefore carry `id`, and tests assert that a repeated
email still yields distinct ids and renders both rows.

### Signer status derivation

`ContractSignatoryStatus` is only `PENDING | SIGNED`
(`core/constants/contracts.ts:168`). There is no stored "queued" state, so the
three displayed states are derived:

- `SIGNED` → `signed <date>`
- `PENDING` where `routingOrder` equals the lowest `routingOrder` among unsigned
  signers → `pending` (their turn)
- `PENDING` where `routingOrder` is greater than that → `queued` (waiting)

`signedCount` counts `SIGNED`; `totalSigners` counts all signatories.
`approvedCount` counts approvers with status `APPROVED`; `totalApprovers` counts
all non-`SKIPPED` approvers.

## Interaction

Delayed hover with auto-dismiss.

```
mouse enters row
      │
      └─ 400ms dwell timer
           │
           ├─ mouse leaves before 400ms → nothing, no fetch
           │
           └─ still hovering → open card + fetch
                  │
                  └─ mouse leaves → hide after 150ms grace
                     (grace allows moving the pointer into the card)
```

The dwell delay is what makes lazy fetching viable: sweeping the pointer down the
table fires zero requests.

Keyboard focus on a row opens the card (`tabIndex={0}` makes rows reachable);
`Esc` and blur close it. Focus anchors the card to the row's right edge, since
there is no cursor position in a keyboard flow.

### Suppression

The card does not open when:

- `isLoading` is true (shimmer rows are placeholders).
- `openAssignmentDropdownContractId` is set — the card would cover the assignment
  dropdown the user is actively operating.
- The pointer is over an interactive cell child (`button, a, input, select,
  textarea, [role="button"]`), so the card does not fight with existing
  affordances.

Rows retain their existing click-to-open and ctrl/cmd-click-to-new-tab behavior;
the card adds no click handling of its own.

## Backend

No new repository methods. `canAccessContract` requires the contract entity, so
`getById` is unavoidable, and it already carries `backgroundOfRequest` and
`hodApprovedAt`. The remaining three reads already exist on
`ContractQueryRepository`.

### Files

```
core/domain/contracts/contract-query-repository.ts   + ContractRowPreview types
core/domain/contracts/contract-query-service.ts      + getContractRowPreview()
core/config/route-registry.ts                        + contracts.summary
app/api/contracts/[contractId]/summary/route.ts      (new)
core/client/contracts-client.ts                      + summary()
```

Route named `summary` because `preview/route.ts` is already taken by document
preview.

### Service

```ts
getContractRowPreview({ tenantId, contractId, employeeId, role }) {
  const contract = await getById(...)                    // 1 query
  if (!contract) throw NotFoundError
  if (!await canAccessContract(...)) throw AuthorizationError

  const [counterparties, approvers, signatories] = await Promise.all([
    getCounterparties(...), getAdditionalApprovers(...), getSignatories(...),
  ])                                                     // 3 parallel

  // map, computing counts server-side
}
```

Four queries. The detail endpoint (`contract-query-service.ts`) runs eight and
includes `getAvailableActions`, which computes action permissions and is the most
expensive of them. The card needs none of it.

The original design was five queries; removing the activity line removed the
`getTimeline` call. A test asserts `getTimeline` is **not** called, so the saving
does not quietly regress.

Access control is enforced independently at this endpoint rather than relying on
the list's visibility filter, so the card cannot become a side channel exposing
approver names or signer emails.

### Response type

```ts
export type ContractRowPreviewApprover = {
  id: string
  email: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'BYPASSED'
  approvedAt: string | null
  sequenceOrder: number
}

export type ContractRowPreviewSigner = {
  id: string
  email: string
  status: ContractSignatoryStatus
  signedAt: string | null
  routingOrder: number
  recipientType: ContractSignatoryRecipientType
}

export type ContractRowPreview = {
  contractId: string
  description: string | null
  counterparties: string[]
  hodApprovedAt: string | null
  additionalApprovers: ContractRowPreviewApprover[]
  signatories: ContractRowPreviewSigner[]
  approvedCount: number
  totalApprovers: number
  signedCount: number
  totalSigners: number
}
```

`contracts-client.ts` mirrors these as local types with inline string unions,
matching how every other contract shape is declared in that file.

## Frontend

### Files

```
modules/contracts/ui/ContractRowPreviewCard.tsx   (new, presentational)
modules/contracts/ui/useContractRowPreview.ts     (new, behavior)
modules/contracts/ui/RepositoryWorkspaceTable.tsx (wire handlers, portal card)
modules/contracts/ui/RepositoryWorkspace.module.css (card styles)
```

The hook owns the dwell timer, fetching, caching, and abort handling. The card is
pure presentation over `{ row, preview, state }`, making it testable with fixture
data and no network.

### Caching

Cache key is `` `${contractId}:${updatedAt}` ``, held in a `Map` in a ref for the
lifetime of the mounted workspace. Because the key includes `updatedAt`, a
changed contract naturally misses the cache and refetches — no manual
invalidation on sort, filter, or page change, and no stale approver or signer
statuses.

Error responses are not cached, so re-hovering retries.

### Request lifecycle

One `AbortController` per hover. Leaving the row before the response arrives
aborts the request. A cache hit performs no fetch at all.

`summary()` issues its own `fetch` rather than using the file's `fetchGetJson`
helper, which accepts no `AbortSignal` and dedupes in-flight GETs in a shared
URL-keyed `Map` — aborting a shared promise would cancel it for every caller. It
rethrows `AbortError` instead of folding it into `networkErrorResponse`;
otherwise every early mouse-out would flash a false "Couldn't load details".

### States

The card opens immediately on dwell using the title, status, and TAT already
present in the row object, and skeletons the remainder. The user gets feedback at
400ms rather than 400ms plus network latency.

| State | Renders |
|---|---|
| `loading` | Header from row data + skeleton rows |
| `ready` | Full card, empty sections omitted |
| `error` | Header + "Couldn't load details"; cache entry cleared so re-hover retries |
| `forbidden` | Header + "You don't have access to this contract's details" |

`forbidden` is not expected in normal use because the list is visibility-filtered,
but the endpoint enforces access independently and the UI degrades rather than
rendering a broken card.

### Positioning

Rendered through a portal to `document.body` with `position: fixed`, which is
required to escape the table's stacking and overflow context. Opens to the right
of the pointer; flips left when within 380px of the viewport's right edge; clamps
vertically to remain fully visible.

Horizontal placement needs no measurement and is computed during render. The
vertical clamp needs the rendered height, so it is applied in `useLayoutEffect`
as a **direct `node.style.top` write, not `setState`** — the repo's
`react-hooks/set-state-in-effect` lint rule rejects setState in an effect body
because it triggers cascading renders.

### Styling

Uses the stylesheet's existing design tokens (`--color-surface`,
`--color-border`, `--color-text`, `--color-text-muted`, `--shadow-card`,
`--radius-xl`, `--radius-md`) so the card inherits theming rather than hardcoding
values. Fade-in and skeleton shimmer are both disabled under
`prefers-reduced-motion`.

### Accessibility

`role="tooltip"` with `aria-describedby` on the row — not `role="dialog"`, since
the card is non-modal and does not trap focus.

## Error Handling

| Condition | Behavior |
|---|---|
| Network failure / 5xx | `error` state; not cached; re-hover retries |
| 403 | `forbidden` state with explanatory copy |
| 404 (deleted between list and hover) | `error` state; row remains until next list refresh |
| Abort (pointer left early) | Silent; no state change, no error surfaced |
| Missing optional fields | Section omitted |

## Testing

32 tests across four layers: 9 service, 8 hook, 14 component, 1 E2E.

| Layer | Covers |
|---|---|
| Service unit | Access denied throws `CONTRACT_READ_FORBIDDEN`; empty approvers/signers; count correctness; `getTimeline` is *not* called; duplicate approver emails keep distinct ids |
| Hook unit | Quick pointer sweep fires zero fetches; mouse-out aborts in-flight request; cache hit skips refetch; changed `updatedAt` busts cache; errors are not cached; `AbortError` does not surface as an error |
| Component | Empty sections omitted; TAT hidden when `canSeeTatAndAging` is false; signer list caps at 5 with `+N more`; signer status derivation; HOD approval renders above description and approvers (DOM order); no POC block; repeated email renders both rows |
| E2E | `tests/e2e/repository-and-export.spec.ts` test 16 — hover a row, assert the card appears, assert it hides on mouse-out |

Two tests are load-bearing rather than incidental:

- **"quick sweep fires zero fetches"** is the guard on the entire performance
  rationale for lazy loading.
- **"HOD approval renders above description"** pins a placement Legal explicitly
  asked for, which a presence-only assertion would not have caught.

**Assertion style:** this repo loads `@testing-library/jest-dom` in
`jest.setup.js` but never wired its types into tsconfig, and no existing test
uses `toBeInTheDocument`. These tests follow the established `.toBeTruthy()` /
`.toBeNull()` / `.textContent` convention; using jest-dom matchers fails
`npm run type-check`.

## Rejected Alternatives

**Reuse `GET /api/contracts/:contractId`.** No backend work, but eight queries
including `getAvailableActions`, returning documents, actions, and collaborators
the card discards. It would also couple a hover interaction to the module's
heaviest read path, which then changes for unrelated reasons.

**Fold approver/signer aggregates into the repository list query.** The card
would open with no fetch, but every page load would compute this for all 25 rows
to benefit the few actually hovered, on a query already doing substantial
conditional filter work.

**Full mirror of every field in the card.** Self-contained, but tall, slow to
scan, and largely redundant with the row directly under the pointer.

**Click-to-pin card.** More capable for reading and copying, but the row already
has a click handler that opens the contract, so it would need a dedicated trigger
element. Deferred; can be added later without reworking the data layer.

## Known Follow-Ups

- **No max-height on the card.** With a 7-line description plus five approvers
  and five signers, a card can grow tall enough to hit the viewport clamp on a
  laptop screen. The clamp repositions rather than overflowing, so nothing
  breaks, but a `max-height` with internal scrolling is the fix if it proves
  awkward in practice.
- **`"NA"` literals** in `signatory_*` and similar columns are stored as text
  rather than null. Removing the POC block hid the symptom here; normalizing the
  data is tracked separately.
- **Activity could return** in readable form via the existing
  `formatContractLogEvent.ts`, at the cost of one additional query.
