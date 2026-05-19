/**
 * Contract Upload Helper — NxtLegal E2E
 *
 * Encapsulates the multi-step contract upload wizard interaction.
 * Used by the critical-path spec to upload a contract as a POC user.
 */

import { type Page, expect } from '@playwright/test'
import { TEST_DATA_PREFIX, testCounterpartyName, testSignatoryName } from './constants'
import * as path from 'path'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UploadContractOptions {
  /** Path to the .docx file to upload (relative to project root) */
  filePath: string
  /** Text to select from the Contract Type dropdown (e.g. "Service Agreement") */
  contractType?: string
  /** Counterparty name override (defaults to auto-generated) */
  counterpartyName?: string
  /** Signatory name override (defaults to auto-generated) */
  signatoryName?: string
  /** Signatory designation */
  signatoryDesignation?: string
  /** Signatory email */
  signatoryEmail?: string
  /** Background of request */
  background?: string
  /** Budget approved — "Yes" or "No" */
  budgetApproved?: string
}

// ─── Upload Flow ─────────────────────────────────────────────────────────────

/**
 * Drives the full ThirdPartyUploadSidebar wizard from open → submit.
 *
 * Precondition: User is logged in and on a page where the upload
 * sidebar trigger is visible (e.g. dashboard).
 *
 * Returns the generated contract title for later lookup.
 */
export async function uploadContract(
  page: Page,
  options: UploadContractOptions
): Promise<{ title: string; counterpartyName: string }> {
  const counterparty = options.counterpartyName || testCounterpartyName()
  const signatory = options.signatoryName || testSignatoryName()

  // ── Open the upload sidebar ──────────────────────────────────────────────
  const uploadTrigger = page.getByRole('button', { name: 'Upload Third-Party Contract' })
  await expect(uploadTrigger).toBeVisible({ timeout: 15_000 })
  await uploadTrigger.click()

  // Wait for the sidebar to be visible (matches both the step-pill button and the
  // section-title div; .first() avoids a strict-mode violation)
  await expect(page.getByText('Choose Files').first()).toBeVisible({ timeout: 10_000 })

  // ── Step 1: Choose Files ─────────────────────────────────────────────────
  const fileInput = page.locator('input#main-contract-upload')
  const absolutePath = path.resolve(options.filePath)
  await fileInput.setInputFiles(absolutePath)

  // Verify the file was accepted (file card should appear)
  await expect(page.locator('text=.docx').first()).toBeVisible({ timeout: 5_000 })

  // Click Next to proceed to step 2 (exact:true avoids matching the Next.js Dev Tools button)
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // ── Step 2: Additional Data ──────────────────────────────────────────────
  await expect(page.locator('select#contract-type')).toBeVisible({ timeout: 10_000 })

  // Select contract type — pick the first available option if not specified
  const contractTypeSelect = page.locator('select#contract-type')
  if (options.contractType) {
    await contractTypeSelect.selectOption({ label: options.contractType })
  } else {
    // Wait for options to load from API, then select the first real option
    await page.waitForFunction(
      () => {
        const select = document.querySelector('select#contract-type') as HTMLSelectElement
        return select && select.options.length > 1
      },
      { timeout: 10_000 }
    )
    await contractTypeSelect.selectOption({ index: 1 })
  }

  // Capture selected contract type text NOW while the element is visible (it's hidden in later steps)
  const selectedContractType = await contractTypeSelect.locator('option:checked').textContent()

  // Fill counterparty name
  const counterpartyInput = page.locator('input[list="counterparty-options"]').first()
  await counterpartyInput.fill(counterparty)

  // Upload a supporting document for the counterparty (required for non-N/A)
  const supportingDocsInput = page.locator('input[id^="supporting-docs-"]').first()
  await expect(supportingDocsInput).toBeAttached({ timeout: 5_000 })
  await supportingDocsInput.setInputFiles(absolutePath)
  await expect(page.getByText(path.basename(absolutePath)).first()).toBeVisible({ timeout: 5_000 })

  // Fill signatory details.
  // The form renders signatory inputs with dynamic IDs: counterparty-{N}-signatory-{field}-{S}
  // For the default single counterparty (index 0) + first signatory (index 0):
  await page.locator('input#counterparty-0-signatory-name-0').fill(signatory)
  await page.locator('input#counterparty-0-signatory-designation-0').fill(options.signatoryDesignation || 'Director')
  await page
    .locator('input#counterparty-0-signatory-email-0')
    .fill(options.signatoryEmail || 'test-signatory@example.com')

  // Fill background
  await page
    .locator('textarea#background-of-request')
    .fill(options.background || `${TEST_DATA_PREFIX} Automated E2E test contract upload — ${new Date().toISOString()}`)

  // Department — locked for POC (shows a read-only input) or selectable if not locked
  const departmentSelect = page.locator('select#department-id')
  if (await departmentSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
    // Wait for the options to populate, then pick the first real option
    await page.waitForFunction(
      () => {
        const select = document.querySelector('select#department-id') as HTMLSelectElement
        return select && select.options.length > 1
      },
      { timeout: 10_000 }
    )
    await departmentSelect.selectOption({ index: 1 })
  }

  // Set budget approved — default to 'No' to avoid triggering the budget-doc upload section
  const budgetSelect = page.locator('select#budget-approved')
  if (await budgetSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await budgetSelect.selectOption({ label: options.budgetApproved || 'No' })
  }

  // Department is auto-selected for POC users (locked to their team)

  // Click Next to proceed to Review
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // ── Step 3: Review ───────────────────────────────────────────────────────
  await expect(page.getByText('Confirm the details before upload.')).toBeVisible({ timeout: 10_000 })

  // Click Next to proceed to Upload step
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // ── Step 4: Upload ───────────────────────────────────────────────────────
  await expect(page.getByText('Submit the contract and initialize workflow routing.')).toBeVisible({
    timeout: 10_000,
  })

  const initResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/contracts/upload/init') && response.request().method() === 'POST',
    { timeout: 60_000 }
  )

  // Click Upload
  await page.getByRole('button', { name: 'Upload', exact: true }).last().click()

  const initResponse = await initResponsePromise
  if (!initResponse.ok()) {
    throw new Error(`Contract upload init failed: ${initResponse.status()} ${await initResponse.text()}`)
  }

  const finalizeResponse = await page.waitForResponse(
    (response) => response.url().includes('/api/contracts/upload/finalize') && response.request().method() === 'POST',
    { timeout: 60_000 }
  )
  if (!finalizeResponse.ok()) {
    throw new Error(`Contract upload finalize failed: ${finalizeResponse.status()} ${await finalizeResponse.text()}`)
  }

  // Wait for the success toast — fires before onClose() + router.push()
  await expect(page.locator('[data-sonner-toaster]').getByText(/successfully/i)).toBeVisible({
    timeout: 30_000,
  })

  // Wait for dashboard (may already be there; waitForURL still resolves if URL matches)
  await page.waitForURL('**/dashboard', { timeout: 15_000 })

  // Determine the generated title pattern: "{ContractType} - {Counterparty}"
  // We'll use the counterparty name to find the contract later
  const title = `${selectedContractType} - ${counterparty}`

  return { title, counterpartyName: counterparty }
}
