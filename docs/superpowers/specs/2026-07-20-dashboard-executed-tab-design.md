# Dashboard "Executed" Tab — Design

**Date:** 2026-07-20
**Status:** Approved, pending implementation plan

## Problem

Contracts that reach `EXECUTED` status are unreachable from the dashboard's My Contracts
tab row. `resolveDashboardStatusFromFilter` maps the `COMPLETED` filter to
`contractStatuses.completed` only, and `EXECUTED` is a distinct status
(`src/core/constants/contracts.ts:14`). The Repository page reports these separately —
Executed 10, Completed 14 — so today those 10 executed contracts surface on the dashboard
only via the `ALL` and `ALL_ASSIGNED` filters, both of which mix them in with everything else.

Users need a dedicated place to see everything that has been executed.

## Decisions

| Question | Decision |
|---|---|
| What the tab lists | Contracts with workflow status `EXECUTED` |
| Which roles see it | All four — Legal Team, Admin, HOD, POC |
| Label | `Executed` |
| Placement | Last in each role's tab row |
| Fallthrough hardening | Yes — make the status mapping exhaustive |

**Why status rather than document kind.** "Executed Documents" could have meant contracts
carrying an `EXECUTED_CONTRACT` document artifact
(`contractDocumentKinds.executedContract`), but that would need a document-kind join and
would diverge from how every other tab works. Status matches the existing pattern and the
`Executed` label already used in `contractStatusLabels` and Repository Status-wise Reporting.

**Why the label is `Executed`, not `Executed Documents`.** Every sibling tab is one or two
words, and Legal Team already carries six tabs. The longer label would be the widest in the
row and risks wrapping on narrower screens.

**Why last in the row.** No existing tab shifts position, so current muscle memory is
undisturbed.

**Why all roles.** Executed is the natural end-state of any contract. Row-level permissions
already scope what each role can see — a POC only ever sees their own — so no role gains
visibility it did not already have. The implementation cost is identical for any subset.

## Architecture

The dashboard filter is a single value threaded through five layers. Adding one is
mechanical and additive; no existing behavior changes.

```
DashboardClient roleConfig.filters
  └─> contractsClient.dashboardContracts({ filter })   [client union]
        └─> dashboardContractsQuerySchema              [zod enum, gates the API]
              └─> contractQueryService                 [domain union]
                    └─> resolveDashboardFilter         [role guard — passes through]
                          └─> resolveDashboardStatusFromFilter  [filter -> ContractStatus]
```

### Change surface

| File | Change |
|---|---|
| `src/core/client/contracts-client.ts:99` | add `\| 'EXECUTED'` to `DashboardContractsFilter` |
| `src/core/domain/contracts/schemas.ts:34` | add `'EXECUTED'` to `dashboardContractsFilterValues` |
| `src/core/domain/contracts/contract-query-repository.ts:56` | add to domain `DashboardContractFilter` |
| `src/core/infra/repositories/supabase-contract-query-repository.ts:5328` | new `EXECUTED` branch + exhaustiveness guard |
| `src/app/api/contracts/dashboard/counts/route.ts:12` | add to that route's duplicated local union |
| `src/modules/dashboard/ui/DashboardClient.tsx:198-250` | append the tab to all 4 role configs |

### What needs no change

- **`resolveDashboardFilter`** (`:5301`) already returns `requestedFilter` unchanged for
  every role when the filter is not `ALL`. No role guard edit required.
- **Count badges.** `loadDashboardCounts` (`DashboardClient.tsx:435`) requests counts for
  whatever `roleConfig.filters` contains, so the `(n)` badge wires itself.
- **Permissions.** The status predicate is the only addition; row-level scoping is untouched.
- **`nonPendingStatuses`** (`:574`, `:880`) already contains `executed`, but it gates
  `shouldExcludeNonPending`, which applies only to `ASSIGNED_TO_ME`. Unaffected.

## The fallthrough hazard

`resolveDashboardStatusFromFilter` currently ends with a bare fallthrough:

```ts
if (filter === 'REJECTED') {
  return contractStatuses.rejected
}

return contractStatuses.onHold   // <- catches ON_HOLD *and* anything unhandled
```

Adding `'EXECUTED'` to the union without adding its branch would make the Executed tab
silently return **On Hold** contracts. Wrong data, no crash, and TypeScript cannot catch it
because the function still satisfies its return type.

The fix is to give `ON_HOLD` an explicit branch and end with a compile-time exhaustiveness
guard, so any future filter added to the union fails the build rather than silently
mis-resolving:

```ts
if (filter === 'ON_HOLD') {
  return contractStatuses.onHold
}

const unhandled: never = filter
throw new Error(`Unhandled dashboard filter: ${String(unhandled)}`)
```

This is in scope because this change is precisely the one that adds to that union.

## Testing

| Test | Guards |
|---|---|
| `resolveDashboardStatusFromFilter('EXECUTED')` → `contractStatuses.executed` | The fallthrough hazard — the single most important assertion here |
| Existing filter mappings still resolve unchanged | The exhaustiveness refactor is behavior-preserving |
| `DashboardClient` renders an `Executed` tab with its count | Tab wiring and count plumbing |
| `dashboardContractsQuerySchema` accepts `EXECUTED` | The API gate opens for the new value |

Existing dashboard tests mock `contractsClient.dashboardCounts` with an explicit counts
object (`DashboardClient.test.tsx:58`); those fixtures need `EXECUTED` added so the new tab
renders a count in tests.

## Out of scope

- Any change to what `COMPLETED` lists. Executed and Completed stay disjoint.
- Executed-specific row actions (e.g. a dedicated "download executed document" button).
- Changes to the Repository page, which already reports Executed separately.
