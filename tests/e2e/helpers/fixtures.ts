/**
 * Playwright Custom Fixtures — NxtLegal
 *
 * Extends the base Playwright test with app-specific helpers
 * for authentication and contract operations.
 */

import { test as base, expect } from '@playwright/test'
import { loginViaUI, clearSession } from './auth'
import { type TestUserKey, CONTRACT_STATUS_LABELS } from './constants'

// ─── Custom Fixture Types ────────────────────────────────────────────────────

interface NxtLegalFixtures {
  /** Login as a specific test user via UI */
  loginAs: (userKey: TestUserKey) => Promise<void>

  /** Switch to a different user (clears session, logs in fresh) */
  switchUser: (userKey: TestUserKey) => Promise<void>

  /** Assert the current contract status badge shows the expected label */
  expectContractStatus: (statusKey: keyof typeof CONTRACT_STATUS_LABELS) => Promise<void>

  /** Wait for a toast/notification message to appear */
  waitForToast: (textPattern: string | RegExp) => Promise<void>
}

// ─── Extended Test ───────────────────────────────────────────────────────────

export const test = base.extend<NxtLegalFixtures>({
  loginAs: async ({ page }, use) => {
    const fn = async (userKey: TestUserKey) => {
      await loginViaUI(page, userKey)
    }
    await use(fn)
  },

  switchUser: async ({ page }, use) => {
    const fn = async (userKey: TestUserKey) => {
      await clearSession(page)
      await loginViaUI(page, userKey)
    }
    await use(fn)
  },

  expectContractStatus: async ({ page }, use) => {
    const fn = async (statusKey: keyof typeof CONTRACT_STATUS_LABELS) => {
      const label = CONTRACT_STATUS_LABELS[statusKey]
      // The status badge is a <span> inside the detail header
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      })
    }
    await use(fn)
  },

  waitForToast: async ({ page }, use) => {
    const fn = async (textPattern: string | RegExp) => {
      // Sonner toasts render as <li> inside [data-sonner-toaster]
      const toaster = page.locator('[data-sonner-toaster]')
      if (typeof textPattern === 'string') {
        await expect(toaster.getByText(textPattern)).toBeVisible({ timeout: 15_000 })
      } else {
        await expect(toaster.locator(`text=${textPattern}`)).toBeVisible({ timeout: 15_000 })
      }
    }
    await use(fn)
  },
})

export { expect }
