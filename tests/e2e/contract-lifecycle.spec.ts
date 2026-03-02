/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CRITICAL PATH E2E — Contract Lifecycle: Upload → HOD Approve
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This spec simulates the most important business workflow:
 *
 *   1. POC logs in via email/password
 *   2. POC uploads a third-party contract through the upload wizard
 *   3. Contract appears in the system with "HOD Pending" status
 *   4. POC logs out
 *   5. HOD logs in
 *   6. HOD navigates to the contract
 *   7. HOD approves the contract
 *   8. Contract status transitions to "Under Review"
 *
 * ── Auth Strategy ──────────────────────────────────────────────────────────────
 * We authenticate through the real login UI (email/password form).
 * This ensures session cookies (employee_session, employee_refresh_token)
 * are set by the server exactly as in production. No cookie injection or
 * auth bypass is used — the robot behaves like a real user.
 *
 * ── Test Data Strategy ─────────────────────────────────────────────────────────
 * - All test contracts are prefixed with "[E2E-AUTO]" for easy identification.
 * - Unique timestamps in counterparty/signatory names prevent collisions.
 * - A sample .docx fixture is stored in tests/e2e/fixtures/.
 * - Teardown: Contracts created by E2E tests can be identified via the prefix
 *   and cleaned up in a separate maintenance script (not part of this spec).
 *   The spec itself does NOT delete data to allow post-mortem inspection.
 *
 * ── Prerequisites ──────────────────────────────────────────────────────────────
 * - Local Supabase instance running with seeded test employees
 *   (run `npm run seed:test-employee` if not done)
 * - At least 1 active contract type and 1 active department/team in DB
 * - The .docx fixture file at tests/e2e/fixtures/sample-contract.docx
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { test, expect } from './helpers/fixtures'
import { loginViaUI, clearSession } from './helpers/auth'
import { uploadContract } from './helpers/upload'
import { TEST_USERS, ROUTES, CONTRACT_STATUS_LABELS, ACTION_LABELS, COOKIE_NAMES } from './helpers/constants'

// ─── Shared State Across Ordered Tests ───────────────────────────────────────

let uploadedContractTitle: string
let uploadedCounterpartyName: string

// ─── Test Configuration ──────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' })

test.describe('Critical Path: Contract Upload → HOD Approval', () => {
  // ─────────────────────────────────────────────────────────────────────────
  //  PHASE 1: POC Login
  // ─────────────────────────────────────────────────────────────────────────

  test('1. POC can log in via email/password', async ({ page }) => {
    await page.goto(ROUTES.login)
    await page.waitForLoadState('networkidle')

    // Fill the login form
    await page.locator('input[type="email"]').fill(TEST_USERS.poc.email)
    await page.locator('input[type="password"]').fill(TEST_USERS.poc.password)

    // Submit
    await page.getByRole('button', { name: 'Login with Email' }).click()

    // Should redirect to dashboard
    await page.waitForURL('**/dashboard', { timeout: 30_000 })

    // Verify session cookie is set
    const cookies = await page.context().cookies()
    const sessionCookie = cookies.find((c) => c.name === COOKIE_NAMES.session)
    expect(sessionCookie).toBeTruthy()

    // Verify dashboard content
    await expect(page.getByText(/welcome/i).first()).toBeVisible({ timeout: 10_000 })
  })

  // ─────────────────────────────────────────────────────────────────────────
  //  PHASE 2: POC Uploads a Contract
  // ─────────────────────────────────────────────────────────────────────────

  test('2. POC can upload a third-party contract', async ({ page }) => {
    // Login first (serial tests don't share browser state)
    await loginViaUI(page, 'poc')

    // Perform the upload
    const result = await uploadContract(page, {
      filePath: 'tests/e2e/fixtures/sample-contract.docx',
    })

    uploadedContractTitle = result.title
    uploadedCounterpartyName = result.counterpartyName

    // Log for debugging
    console.log(`[E2E] Uploaded contract: "${uploadedContractTitle}"`)
    console.log(`[E2E] Counterparty: "${uploadedCounterpartyName}"`)

    // Verify we're back on dashboard
    await expect(page).toHaveURL(/\/dashboard/)
  })

  // ─────────────────────────────────────────────────────────────────────────
  //  PHASE 3: Verify Contract in Repository / Sidebar
  // ─────────────────────────────────────────────────────────────────────────

  test('3. Uploaded contract appears with HOD Pending status', async ({ page }) => {
    await loginViaUI(page, 'poc')

    // Navigate to Repository to find the contract
    await page.locator('button[aria-label="Repository"]').click()
    await page.waitForLoadState('networkidle')

    // Search for or locate the uploaded contract in the sidebar list
    // The contract title should appear in the contract list
    const contractItem = page.getByText(uploadedCounterpartyName).first()
    await expect(contractItem).toBeVisible({ timeout: 20_000 })

    // Click to open the contract detail
    await contractItem.click()

    // Verify the contract status badge shows "HOD Pending"
    await expect(page.getByText(CONTRACT_STATUS_LABELS.hodPending, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  //  PHASE 4: HOD Login & Contract Approval
  // ─────────────────────────────────────────────────────────────────────────

  test('4. HOD can log in and see pending contracts', async ({ page }) => {
    // Clear previous session and login as HOD
    await clearSession(page)
    await loginViaUI(page, 'hod')

    // Verify dashboard shows HOD-specific content
    await expect(page.getByText(/welcome/i).first()).toBeVisible({ timeout: 10_000 })

    // Verify the HOD role badge
    await expect(page.locator('text=HOD').first()).toBeVisible({ timeout: 10_000 })
  })

  test('5. HOD navigates to the uploaded contract', async ({ page }) => {
    await loginViaUI(page, 'hod')

    // Navigate to Repository
    await page.locator('button[aria-label="Repository"]').click()
    await page.waitForLoadState('networkidle')

    // Find the contract uploaded by POC
    const contractItem = page.getByText(uploadedCounterpartyName).first()
    await expect(contractItem).toBeVisible({ timeout: 20_000 })

    // Click to open
    await contractItem.click()

    // Verify it's in HOD Pending status
    await expect(page.getByText(CONTRACT_STATUS_LABELS.hodPending, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    })

    // Verify the Approve (HOD) action button is visible
    await expect(page.getByRole('button', { name: ACTION_LABELS.hodApprove })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('6. HOD approves the contract', async ({ page }) => {
    await loginViaUI(page, 'hod')

    // Navigate to the contract
    await page.locator('button[aria-label="Repository"]').click()
    await page.waitForLoadState('networkidle')

    const contractItem = page.getByText(uploadedCounterpartyName).first()
    await expect(contractItem).toBeVisible({ timeout: 20_000 })
    await contractItem.click()

    // Wait for the detail panel to load
    await expect(page.getByText(CONTRACT_STATUS_LABELS.hodPending, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    })

    // Click the "Approve (HOD)" button
    const approveButton = page.getByRole('button', { name: ACTION_LABELS.hodApprove })
    await expect(approveButton).toBeVisible({ timeout: 10_000 })
    await approveButton.click()

    // The confirmation dialog should appear
    await expect(page.getByRole('dialog', { name: 'Confirm action' })).toBeVisible({
      timeout: 10_000,
    })

    // Confirm the action
    await page.getByRole('button', { name: 'Confirm' }).click()

    // Wait for the action to process — button may show "Processing…"
    // Then verify the status transitions to "Under Review"
    await expect(page.getByText(CONTRACT_STATUS_LABELS.underReview, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    })

    console.log(`[E2E] ✅ Contract "${uploadedContractTitle}" approved by HOD — now "Under Review"`)
  })

  // ─────────────────────────────────────────────────────────────────────────
  //  PHASE 5: Post-Approval Verification
  // ─────────────────────────────────────────────────────────────────────────

  test('7. Contract status persists after page reload', async ({ page }) => {
    await loginViaUI(page, 'hod')

    // Navigate back to the contract
    await page.locator('button[aria-label="Repository"]').click()
    await page.waitForLoadState('networkidle')

    const contractItem = page.getByText(uploadedCounterpartyName).first()
    await expect(contractItem).toBeVisible({ timeout: 20_000 })
    await contractItem.click()

    // Reload the page to verify persistence
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Status should still be "Under Review" after reload
    await expect(page.getByText(CONTRACT_STATUS_LABELS.underReview, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    })

    // The HOD Approve button should no longer be visible
    await expect(page.getByRole('button', { name: ACTION_LABELS.hodApprove })).not.toBeVisible({
      timeout: 5_000,
    })
  })

  test('8. Activity tab records the approval event', async ({ page }) => {
    await loginViaUI(page, 'hod')

    // Navigate to the contract
    await page.locator('button[aria-label="Repository"]').click()
    await page.waitForLoadState('networkidle')

    const contractItem = page.getByText(uploadedCounterpartyName).first()
    await expect(contractItem).toBeVisible({ timeout: 20_000 })
    await contractItem.click()

    // Switch to Activity tab
    await page.getByRole('button', { name: 'Activity' }).click()

    // Verify an approval event exists in the timeline
    await expect(page.getByText(/approv/i).first()).toBeVisible({ timeout: 15_000 })
  })
})
