/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import ProtectedAppShell from '@/modules/dashboard/ui/ProtectedAppShell'

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}))

jest.mock('@/components/theme/ThemeToggle', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('@/components/auth/LogoutButton', () => ({
  __esModule: true,
  default: () => null,
}))

const session = {
  fullName: 'Test User',
  email: 'test.user@nxtwave.co.in',
  team: 'Legal',
  role: 'EMPLOYEE',
}

describe('ProtectedAppShell global search bar', () => {
  it('renders the search bar on the dashboard', () => {
    render(
      <ProtectedAppShell session={session} activeNav="home">
        <div>content</div>
      </ProtectedAppShell>
    )

    expect(screen.queryByLabelText('Search contracts')).not.toBeNull()
  })

  it('omits the search bar when the page declares its own search', () => {
    render(
      <ProtectedAppShell session={session} activeNav="repository" hideGlobalSearch>
        <div>content</div>
      </ProtectedAppShell>
    )

    expect(screen.queryByLabelText('Search contracts')).toBeNull()
  })

  // Regression: a contract opened from the repository reports activeNav="repository"
  // so the sidebar stays highlighted, but that page has no search of its own.
  // Keying visibility off activeNav wrongly hid the bar there.
  it('renders the search bar on a contract opened from the repository', () => {
    render(
      <ProtectedAppShell session={session} activeNav="repository">
        <div>content</div>
      </ProtectedAppShell>
    )

    expect(screen.queryByLabelText('Search contracts')).not.toBeNull()
  })
})
