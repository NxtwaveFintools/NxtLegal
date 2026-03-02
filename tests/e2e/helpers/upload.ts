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

  // Wait for the sidebar to be visible
  await expect(page.getByText('Choose Files')).toBeVisible({ timeout: 10_000 })

  // ── Step 1: Choose Files ─────────────────────────────────────────────────
  const fileInput = page.locator('input#main-contract-upload')
  const absolutePath = path.resolve(options.filePath)
  await fileInput.setInputFiles(absolutePath)

  // Verify the file was accepted (file card should appear)
  await expect(page.locator('text=.docx').first()).toBeVisible({ timeout: 5_000 })

  // Click Next to proceed to step 2
  await page.getByRole('button', { name: 'Next' }).click()

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

  // Fill counterparty name
  const counterpartyInput = page.locator('input[list="counterparty-options"]').first()
  await counterpartyInput.fill(counterparty)

  // Upload a supporting document for the counterparty (required for non-N/A)
  const supportingDocsInput = page.locator('input[id^="supporting-docs-"]').first()
  if (await supportingDocsInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await supportingDocsInput.setInputFiles(absolutePath)
  }

  // Fill signatory details
  await page.locator('input#signatory-name').fill(signatory)
  await page.locator('input#signatory-designation').fill(options.signatoryDesignation || 'Director')
  await page.locator('input#signatory-email').fill(options.signatoryEmail || 'test-signatory@example.com')

  // Fill background
  await page
    .locator('textarea#background-of-request')
    .fill(options.background || `${TEST_DATA_PREFIX} Automated E2E test contract upload — ${new Date().toISOString()}`)

  // Set budget approved
  const budgetSelect = page.locator('select#budget-approved')
  if (await budgetSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await budgetSelect.selectOption(options.budgetApproved || 'Yes')
  }

  // Department is auto-selected for POC users (locked to their team)

  // Click Next to proceed to Review
  await page.getByRole('button', { name: 'Next' }).click()

  // ── Step 3: Review ───────────────────────────────────────────────────────
  await expect(page.getByText('Confirm the details before upload.')).toBeVisible({ timeout: 10_000 })

  // Click Next to proceed to Upload step
  await page.getByRole('button', { name: 'Next' }).click()

  // ── Step 4: Upload ───────────────────────────────────────────────────────
  await expect(page.getByText('Submit the contract and initialize workflow routing.')).toBeVisible({
    timeout: 10_000,
  })

  // Click Upload
  await page.getByRole('button', { name: 'Upload' }).click()

  // Wait for the success toast
  await expect(page.locator('[data-sonner-toaster]').getByText(/uploaded.*successfully/i)).toBeVisible({
    timeout: 30_000,
  })

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard', { timeout: 15_000 })

  // Determine the generated title pattern: "{ContractType} - {Counterparty}"
  // We'll use the counterparty name to find the contract later
  const selectedContractType = await contractTypeSelect.locator('option:checked').textContent()
  const title = `${selectedContractType} - ${counterparty}`

  return { title, counterpartyName: counterparty }
}
