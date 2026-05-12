/**
 * Playwright Auth Helper — NxtLegal
 *
 * Authenticates test users via the Email/Password login form.
 * The strategy is to perform a real UI login so that session cookies
 * are set by the server, exactly as they would be for a real user.
 *
 * For speed, we also provide an API-level login that POSTs directly
 * to /api/auth/login and captures the Set-Cookie headers, which is
 * useful for setting up authenticated state without navigating the UI.
 */

import { type APIResponse, type Page, expect } from '@playwright/test'
import { TEST_USERS, type TestUserKey, ROUTES, API, COOKIE_NAMES } from './constants'

// ─── UI-Based Login ──────────────────────────────────────────────────────────

/**
 * Log in through the actual login page UI.
 * Waits for redirect to /dashboard after successful login.
 */
export async function loginViaUI(page: Page, userKey: TestUserKey): Promise<void> {
  if (page.url().includes('/dashboard')) {
    return
  }

  const user = TEST_USERS[userKey]

  await page.goto(ROUTES.login)

  // Wait for the login form to be ready
  await page.waitForLoadState('networkidle')

  // Fill email and password fields
  const emailInput = page.locator('input[type="email"]')
  const passwordInput = page.locator('input[type="password"]')

  await emailInput.fill(user.email)
  await passwordInput.fill(user.password)

  // Click the login button
  const loginButton = page.getByRole('button', { name: 'Login with Email' })
  await loginButton.click()

  // Wait for successful navigation to dashboard
  await page.waitForURL('**/dashboard', { timeout: 30_000 })

  // Verify session cookie was set
  const cookies = await page.context().cookies()
  const sessionCookie = cookies.find((c) => c.name === COOKIE_NAMES.session)
  expect(sessionCookie, `Session cookie "${COOKIE_NAMES.session}" should be set after login`).toBeTruthy()
}

// ─── API-Based Login ─────────────────────────────────────────────────────────

/**
 * Log in via the API endpoint directly (faster, no UI navigation).
 * Sets the resulting session cookies on the browser context.
 */
export async function loginViaAPI(page: Page, userKey: TestUserKey): Promise<void> {
  const user = TEST_USERS[userKey]
  const baseURL =
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL || 'http://localhost:3000'

  const maxAttempts = 12
  let response: APIResponse | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = await page.context().request.post(`${baseURL}${API.login}`, {
      data: {
        email: user.email,
        password: user.password,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (response.ok()) {
      break
    }

    if (response.status() !== 429 || attempt === maxAttempts) {
      break
    }

    const retryAfterHeader = response.headers()['retry-after']
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN
    const backoffMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 15000
    await new Promise((resolve) => setTimeout(resolve, backoffMs))
  }

  if (!response) {
    throw new Error(`API login failed for ${user.email}: no response`)
  }

  expect(response.ok(), `API login for ${user.email} should succeed (status ${response.status()})`).toBeTruthy()

  // Cookies are automatically captured by the browser context from Set-Cookie headers
  const cookies = await page.context().cookies()
  const sessionCookie = cookies.find((c) => c.name === COOKIE_NAMES.session)
  expect(sessionCookie, `Session cookie should be set after API login`).toBeTruthy()
}

// ─── Logout ──────────────────────────────────────────────────────────────────

/**
 * Log out the current user via the UI logout button.
 */
export async function logoutViaUI(page: Page): Promise<void> {
  const logoutButton = page.getByRole('button', { name: 'Logout' })

  // The logout button might be in the topbar
  if (await logoutButton.isVisible({ timeout: 5_000 })) {
    await logoutButton.click()
    await page.waitForURL('**/login', { timeout: 15_000 })
  }
}

/**
 * Clear all session cookies from the browser context.
 * Faster than UI logout when switching users.
 */
export async function clearSession(page: Page): Promise<void> {
  await page.context().clearCookies()
}

// ─── Session Verification ────────────────────────────────────────────────────

/**
 * Verify the current session is valid by checking the session endpoint.
 */
export async function verifySession(page: Page): Promise<boolean> {
  const baseURL =
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL || 'http://localhost:3000'
  const response = await page.context().request.get(`${baseURL}${API.session}`)
  return response.ok()
}
