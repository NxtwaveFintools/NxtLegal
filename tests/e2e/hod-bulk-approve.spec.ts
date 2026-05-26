/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — HOD Bulk Approve workflow
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Covers the complete "Bulk Approve" feature on the Dashboard:
 *
 *   1.  POC logs in and uploads 3 dummy contracts  →  they land in HOD_PENDING
 *   2.  POC logs out (session cleared)
 *   3.  HOD logs in  →  Dashboard defaults to "HOD Pending" tab
 *   4.  HOD sees the bulk UI controls (Select All checkbox + Bulk Approve button)
 *   5.  "Bulk Approve" is disabled until at least one row is selected
 *   6.  HOD checks "Select All"  →  button becomes enabled
 *   7.  HOD clicks "Bulk Approve"  →  confirmation modal appears
 *   8.  HOD clicks "Confirm Approve"  →  success toast fires, contracts disappear
 *
 * ── Test Data Strategy ─────────────────────────────────────────────────────────
 * Contracts are prefixed with "[E2E-AUTO]" via testCounterpartyName().
 * Each run uses a fresh timestamp suffix — no collisions between runs.
 * Contracts are NOT deleted by this spec; they can be cleaned up via the
 * teardown script (tests/e2e/cleanup/teardown.ts) or kept for post-mortem.
 *
 * ── Prerequisites ──────────────────────────────────────────────────────────────
 * - Local Supabase + Next.js dev server running
 * - `npm run seed:test-employee` has been run
 * - tests/e2e/fixtures/sample-contract.docx exists
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { test, expect } from './helpers/fixtures'
import { loginViaUI, loginViaAPI, clearSession } from './helpers/auth'
import { uploadContract } from './helpers/upload'
import { ROUTES, CONTRACT_STATUS_LABELS } from './helpers/constants'

// ─── Number of contracts to upload before bulk-approving ─────────────────────
const BULK_CONTRACT_COUNT = 3

// ─── Shared state (serial test suite) ────────────────────────────────────────
const uploadedCounterpartyNames: string[] = []

// ─── Suite configuration ──────────────────────────────────────────────────────
test.describe.configure({ mode: 'serial' })

test.describe('HOD Bulk Approve: Upload → Dashboard Bulk Approval', () => {
  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 1 — POC uploads N contracts
  // ───────────────────────────────────────────────────────────────────────────

  test(`1. POC uploads ${BULK_CONTRACT_COUNT} contracts that land in HOD Pending`, async ({ page }) => {
    await loginViaUI(page, 'poc')

    for (let i = 0; i < BULK_CONTRACT_COUNT; i++) {
      // Each upload gets a unique counterparty name; small delay avoids timestamp collisions
      if (i > 0) {
        // Introduce a tiny timestamp spread so testCounterpartyName() returns distinct values
        await page.waitForTimeout(50)
      }

      const result = await uploadContract(page, {
        filePath: 'tests/e2e/fixtures/sample-contract.docx',
      })

      uploadedCounterpartyNames.push(result.counterpartyName)
      console.log(`[E2E] Uploaded contract ${i + 1}/${BULK_CONTRACT_COUNT}: "${result.title}"`)
    }

    // All uploads done — we should be on the dashboard
    await expect(page).toHaveURL(/\/dashboard/)
    expect(uploadedCounterpartyNames).toHaveLength(BULK_CONTRACT_COUNT)
  })

  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 2 — Switch to HOD session
  // ───────────────────────────────────────────────────────────────────────────

  test('2. HOD logs in and dashboard shows HOD Pending tab as active', async ({ page }) => {
    // Start fresh — no cookies from the POC session
    await clearSession(page)
    await loginViaAPI(page, 'hod')

    await page.goto(ROUTES.dashboard)

    await page.waitForURL('**/dashboard', { timeout: 30_000 })

    // HOD's default filter is HOD_PENDING; the tab button should be visually active.
    // The tab label is "HOD Pending (N)" where N >= BULK_CONTRACT_COUNT.
    // Use a flexible regex so it matches regardless of the exact count.
    const hodTab = page.getByRole('button', { name: /HOD Pending \(\d+\)/ })
    await expect(hodTab).toBeVisible({ timeout: 15_000 })

    console.log('[E2E] HOD is on the dashboard with HOD Pending tab visible')
  })

  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 3 — Verify the uploaded contracts appear in HOD_PENDING list
  // ───────────────────────────────────────────────────────────────────────────

  test('3. The uploaded contracts appear in the HOD Pending list', async ({ page }) => {
    await clearSession(page)
    await loginViaAPI(page, 'hod')
    await page.goto(ROUTES.dashboard)

    // Wait for the contract list to load (shimmer disappears)
    await page.waitForLoadState('networkidle')

    // At least one of our uploaded counterparty names must be visible
    // (the dashboard may show newest-first or have an existing backlog, so we
    //  check for each uploaded contract specifically)
    for (const counterpartyName of uploadedCounterpartyNames) {
      // Contract titles are formatted as "{ContractType} - {Counterparty}"
      // We search by the counterparty substring which is unique per run
      await expect(page.getByText(counterpartyName).first()).toBeVisible({ timeout: 20_000 })
    }
  })

  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 4 — Bulk UI controls are present and in correct initial state
  // ───────────────────────────────────────────────────────────────────────────

  test('4. Bulk UI controls are visible; Bulk Approve button is initially disabled', async ({ page }) => {
    await clearSession(page)
    await loginViaAPI(page, 'hod')
    await page.goto(ROUTES.dashboard)
    await page.waitForLoadState('networkidle')

    // Wait for contracts to render (select-all checkbox is only rendered when list is non-empty)
    await expect(page.getByRole('checkbox', { name: /select all visible contracts for bulk approval/i })).toBeVisible({
      timeout: 20_000,
    })

    // Bulk Approve button exists but must be disabled (nothing selected yet)
    const bulkBtn = page.getByRole('button', { name: /^Bulk Approve$/i })
    await expect(bulkBtn).toBeVisible({ timeout: 10_000 })
    await expect(bulkBtn).toBeDisabled()
  })

  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 5 — Selecting a single row enables the button
  // ───────────────────────────────────────────────────────────────────────────

  test('5. Selecting one row checkbox enables the Bulk Approve button', async ({ page }) => {
    await clearSession(page)
    await loginViaAPI(page, 'hod')
    await page.goto(ROUTES.dashboard)
    await page.waitForLoadState('networkidle')

    // Wait for the first uploaded contract's row checkbox to be available.
    // aria-label format: "Select {title} for bulk approval"
    // We locate by a partial match on the counterparty name of the first upload.
    const firstCounterparty = uploadedCounterpartyNames[0]
    // Escape special regex characters in the counterparty name (e.g. "[E2E-AUTO]" has [ ] -)
    const escapedCounterparty = firstCounterparty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rowCheckbox = page
      .getByRole('checkbox', { name: new RegExp(`Select.*${escapedCounterparty}.*for bulk approval`, 'i') })
      .first()

    await expect(rowCheckbox).toBeVisible({ timeout: 20_000 })
    await rowCheckbox.check()

    // Button should now read "Bulk Approve (1)" and be enabled
    await expect(page.getByRole('button', { name: /Bulk Approve \(1\)/i })).toBeEnabled({ timeout: 10_000 })
  })

  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 6 — Select All selects every selectable row
  // ───────────────────────────────────────────────────────────────────────────

  test('6. Select All checkbox selects all selectable rows on the page', async ({ page }) => {
    await clearSession(page)
    await loginViaAPI(page, 'hod')
    await page.goto(ROUTES.dashboard)
    await page.waitForLoadState('networkidle')

    const selectAllCheckbox = page.getByRole('checkbox', {
      name: /select all visible contracts for bulk approval/i,
    })
    await expect(selectAllCheckbox).toBeVisible({ timeout: 20_000 })

    await selectAllCheckbox.check()

    // Button count should be ≥ BULK_CONTRACT_COUNT (may be higher if there
    // were already HOD-pending contracts in the DB from prior test runs)
    await expect(page.getByRole('button', { name: /Bulk Approve \(\d+\)/i })).toBeEnabled({ timeout: 10_000 })

    const bulkBtn = page.getByRole('button', { name: /Bulk Approve \(\d+\)/i })
    const btnText = await bulkBtn.textContent()
    const countMatch = btnText?.match(/\((\d+)\)/)
    const selectedCount = countMatch ? parseInt(countMatch[1], 10) : 0
    expect(selectedCount).toBeGreaterThanOrEqual(BULK_CONTRACT_COUNT)

    console.log(`[E2E] Select All selected ${selectedCount} contracts`)
  })

  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 7 — Clicking Bulk Approve opens confirmation modal
  // ───────────────────────────────────────────────────────────────────────────

  test('7. Clicking Bulk Approve opens the confirmation modal', async ({ page }) => {
    await clearSession(page)
    await loginViaAPI(page, 'hod')
    await page.goto(ROUTES.dashboard)
    await page.waitForLoadState('networkidle')

    // Select all
    const selectAllCheckbox = page.getByRole('checkbox', {
      name: /select all visible contracts for bulk approval/i,
    })
    await expect(selectAllCheckbox).toBeVisible({ timeout: 20_000 })
    await selectAllCheckbox.check()

    // Click the now-enabled Bulk Approve button
    const bulkBtn = page.getByRole('button', { name: /Bulk Approve \(\d+\)/i })
    await expect(bulkBtn).toBeEnabled({ timeout: 10_000 })
    await bulkBtn.click()

    // The confirmation dialog must appear
    const modal = page.getByRole('dialog', { name: /confirm bulk contract approval/i })
    await expect(modal).toBeVisible({ timeout: 10_000 })

    // Modal title
    await expect(modal.getByText('Bulk Approve Contracts')).toBeVisible()

    // Modal subtitle mentions the count
    await expect(modal.getByText(/are you sure you want to bulk approve \d+ selected claim/i)).toBeVisible()

    // Both Cancel and Confirm Approve buttons present
    await expect(modal.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Confirm Approve' })).toBeVisible()
  })

  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 8 — Cancel closes the modal without approving
  // ───────────────────────────────────────────────────────────────────────────

  test('8. Cancel in the modal closes it without making any API calls', async ({ page }) => {
    await clearSession(page)
    await loginViaAPI(page, 'hod')
    await page.goto(ROUTES.dashboard)
    await page.waitForLoadState('networkidle')

    // Intercept the action API to verify it is NOT called
    let actionCallCount = 0
    await page.route('**/api/contracts/*/action', () => {
      actionCallCount++
    })

    const selectAllCheckbox = page.getByRole('checkbox', {
      name: /select all visible contracts for bulk approval/i,
    })
    await expect(selectAllCheckbox).toBeVisible({ timeout: 20_000 })
    await selectAllCheckbox.check()

    const bulkBtn = page.getByRole('button', { name: /Bulk Approve \(\d+\)/i })
    await expect(bulkBtn).toBeEnabled({ timeout: 10_000 })
    await bulkBtn.click()

    const modal = page.getByRole('dialog', { name: /confirm bulk contract approval/i })
    await expect(modal).toBeVisible({ timeout: 10_000 })

    // Click Cancel
    await modal.getByRole('button', { name: 'Cancel' }).click()

    // Modal should be gone
    await expect(modal).not.toBeVisible({ timeout: 5_000 })

    // No action API call should have been made
    expect(actionCallCount).toBe(0)

    // Selection should still be in place (user may want to re-open)
    await expect(page.getByRole('button', { name: /Bulk Approve \(\d+\)/i })).toBeEnabled()
  })

  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 9 — Confirm approves all selected contracts
  //            (main acceptance test — runs last to keep DB state clean)
  // ───────────────────────────────────────────────────────────────────────────

  test('9. Confirming bulk approve calls the action API, shows success toast, and clears the list', async ({
    page,
  }) => {
    await clearSession(page)
    await loginViaAPI(page, 'hod')
    await page.goto(ROUTES.dashboard)
    await page.waitForLoadState('networkidle')

    // Record the initial HOD Pending count from the tab label
    const hodTab = page.getByRole('button', { name: /HOD Pending \(\d+\)/i })
    await expect(hodTab).toBeVisible({ timeout: 15_000 })
    const tabTextBefore = await hodTab.textContent()
    const countBefore = parseInt(tabTextBefore?.match(/\((\d+)\)/)?.[1] ?? '0', 10)
    console.log(`[E2E] HOD Pending count before bulk approve: ${countBefore}`)

    // Track how many action API calls are made
    let actionCallCount = 0
    await page.route('**/api/contracts/*/action', async (route) => {
      actionCallCount++
      await route.continue()
    })

    // Select All
    const selectAllCheckbox = page.getByRole('checkbox', {
      name: /select all visible contracts for bulk approval/i,
    })
    await expect(selectAllCheckbox).toBeVisible({ timeout: 20_000 })
    await selectAllCheckbox.check()

    // Read the selected count from the button label before opening the modal
    const bulkBtn = page.getByRole('button', { name: /Bulk Approve \(\d+\)/i })
    await expect(bulkBtn).toBeEnabled({ timeout: 10_000 })
    const btnText = await bulkBtn.textContent()
    const selectedCount = parseInt(btnText?.match(/\((\d+)\)/)?.[1] ?? '0', 10)
    console.log(`[E2E] About to bulk approve ${selectedCount} contracts`)

    // Open the modal
    await bulkBtn.click()
    const modal = page.getByRole('dialog', { name: /confirm bulk contract approval/i })
    await expect(modal).toBeVisible({ timeout: 10_000 })

    // Confirm
    await modal.getByRole('button', { name: 'Confirm Approve' }).click()

    // ── Wait for all action API calls to complete ───────────────────────────
    // The handler fires one POST per selected contract sequentially.
    // We wait for the success toast as the primary completion signal.
    const toaster = page.locator('[data-sonner-toaster]')
    await expect(toaster.getByText(/approved successfully|approved/i)).toBeVisible({ timeout: 60_000 })

    console.log(`[E2E] Success toast visible — ${actionCallCount} action API call(s) made`)

    // The action API should have been called exactly once per selected contract
    expect(actionCallCount).toBe(selectedCount)

    // ── Verify the confirmed contracts leave the HOD Pending list ───────────
    // The list should auto-refresh. We wait for the count badge to decrease.
    // After approval the contracts transition to "Under Review" — no longer HOD_PENDING.
    await page.waitForFunction(
      ([tabLabel, oldCount]: [string, number]) => {
        const buttons = document.querySelectorAll('button')
        for (const btn of buttons) {
          if (btn.textContent?.includes(tabLabel)) {
            const match = btn.textContent.match(/\((\d+)\)/)
            if (match) {
              return parseInt(match[1], 10) < oldCount
            }
          }
        }
        return false
      },
      ['HOD Pending', countBefore] as [string, number],
      { timeout: 30_000 }
    )

    // The uploaded contracts should no longer appear in the HOD Pending list
    for (const counterpartyName of uploadedCounterpartyNames) {
      await expect(page.getByText(counterpartyName).first()).not.toBeVisible({ timeout: 10_000 })
    }

    // Modal should be closed
    await expect(modal).not.toBeVisible({ timeout: 5_000 })

    // Selection should be cleared — Bulk Approve button back to disabled
    await expect(page.getByRole('button', { name: /^Bulk Approve$/i })).toBeDisabled({ timeout: 10_000 })

    console.log('[E2E] ✅ Bulk approve completed — contracts moved out of HOD Pending')
  })

  // ───────────────────────────────────────────────────────────────────────────
  //  PHASE 10 — Post-approval: contracts are now "Under Review"
  // ───────────────────────────────────────────────────────────────────────────

  test('10. Bulk-approved contracts now appear as Under Review in the Repository', async ({ page }) => {
    await clearSession(page)
    await loginViaAPI(page, 'hod')
    await page.goto(ROUTES.dashboard)

    // Navigate to Repository
    await page.getByRole('link', { name: /^Repository$/i }).click()
    await page.waitForLoadState('networkidle')

    // For each contract we uploaded, find its repository row and verify status
    for (const counterpartyName of uploadedCounterpartyNames) {
      const contractRow = page.getByRole('row', {
        name: new RegExp(counterpartyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      })
      await expect(contractRow).toBeVisible({ timeout: 20_000 })
      await expect(contractRow.getByText(CONTRACT_STATUS_LABELS.underReview, { exact: true })).toBeVisible({
        timeout: 15_000,
      })

      console.log(`[E2E] ✅ "${counterpartyName}" is now "Under Review"`)
    }
  })
})
