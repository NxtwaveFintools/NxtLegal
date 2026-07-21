# Global Search Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a topbar search bar, reachable from any protected page and from `⌘K` / `Ctrl+K`, that hands a typed query to the Repository page's existing search via `/repository?q=<term>`.

**Architecture:** The bar performs no searching. `RepositoryWorkspace.tsx:248` already seeds its search state from `?q=`, so the entire handoff is a `router.push` to a URL. A shared `useFocusHotkey` hook owns the `⌘K` listener; both the new bar and the Repository page's existing input call it on their own ref, so neither component reaches into the other's DOM.

**Tech Stack:** Next.js App Router (client components), React 19, TypeScript, CSS Modules, Jest + React Testing Library.

**Commands used below:** `npm run type-check`, `npm test -- <path>`, `npm run build`, `npm run dev` (all defined in `package.json`).

**React 19 note:** the hook's parameter is typed `RefObject<HTMLInputElement | null>` because in React 19 `useRef<T>(null)` returns `RefObject<T | null>`. Under React 18 typings this would be `RefObject<T>`. Do not "simplify" the signature — it will stop compiling.

**Design doc:** `docs/superpowers/specs/2026-07-21-global-search-bar-design.md`

---

## ⚠️ Commits Are Manual

The plan template normally ends each task with a `git commit`. **Do not run `git add` or `git commit` in this repo** — the repo owner handles all commits manually. Each task ends with a verification step instead. Report what changed and let them commit.

---

## Refinement From the Spec

The spec said `RepositoryWorkspace` would own "its own small `useEffect`" for `⌘K`. During planning this became a shared `useFocusHotkey` hook instead, for two reasons:

1. `GlobalSearchBar` and `RepositoryWorkspace` need byte-identical hotkey behavior. Two copies would drift.
2. `RepositoryWorkspace` is 1688 lines with heavy data fetching. Testing a hotkey by rendering the whole workspace would be slow and brittle. A hook is testable against a five-line harness.

This does not change the approved approach (B). Ownership is still local — each component calls the hook on a ref it owns, and nothing queries another component's DOM by id.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/hooks/use-focus-hotkey.ts` (create) | Registers a window `keydown` listener that focuses+selects a given input ref on `⌘K`/`Ctrl+K`. Nothing else. |
| `src/lib/hooks/use-focus-hotkey.test.tsx` (create) | Hook behavior against a minimal harness. |
| `src/modules/dashboard/ui/GlobalSearchBar.tsx` (create) | The topbar input: local text state, Enter→navigate, Escape→clear, platform hint badge. |
| `src/modules/dashboard/ui/GlobalSearchBar.test.tsx` (create) | Navigation targets, hotkey focus, Escape. |
| `src/modules/dashboard/ui/dashboard.module.css` (modify) | Four new classes + two responsive overrides. |
| `src/modules/dashboard/ui/ProtectedAppShell.tsx` (modify) | Renders the bar in `.topbarLeft`, omits it on the repository page. |
| `src/modules/dashboard/ui/ProtectedAppShell.test.tsx` (create) | Bar present on `home`, absent on `repository`. |
| `src/modules/contracts/ui/RepositoryWorkspace.tsx` (modify) | Attaches a ref to its existing search input and calls `useFocusHotkey`. |

---

### Task 1: `useFocusHotkey` hook

**Files:**
- Create: `src/lib/hooks/use-focus-hotkey.ts`
- Test: `src/lib/hooks/use-focus-hotkey.test.tsx`

- [x] **Step 1: Write the failing test**

Create `src/lib/hooks/use-focus-hotkey.test.tsx`:

```tsx
/** @jest-environment jsdom */

import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useFocusHotkey } from '@/lib/hooks/use-focus-hotkey'

function Harness() {
  const inputRef = useRef<HTMLInputElement>(null)
  useFocusHotkey(inputRef)
  return <input ref={inputRef} aria-label="target" defaultValue="existing text" />
}

describe('useFocusHotkey', () => {
  it('focuses the referenced input on Ctrl+K', () => {
    render(<Harness />)
    const input = screen.getByLabelText('target')

    expect(input).not.toHaveFocus()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(input).toHaveFocus()
  })

  it('focuses the referenced input on Meta+K', () => {
    render(<Harness />)
    const input = screen.getByLabelText('target')

    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(input).toHaveFocus()
  })

  it('selects existing text so typing replaces it', () => {
    render(<Harness />)
    const input = screen.getByLabelText('target') as HTMLInputElement

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('existing text'.length)
  })

  it('ignores a bare k with no modifier', () => {
    render(<Harness />)
    const input = screen.getByLabelText('target')

    fireEvent.keyDown(window, { key: 'k' })

    expect(input).not.toHaveFocus()
  })

  it('removes its listener on unmount', () => {
    const { unmount } = render(<Harness />)
    const input = screen.getByLabelText('target')
    unmount()

    // Should not throw against a detached ref.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(input).not.toHaveFocus()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/hooks/use-focus-hotkey.test.tsx`
Expected: FAIL — `Cannot find module '@/lib/hooks/use-focus-hotkey'`

- [x] **Step 3: Write the implementation**

Create `src/lib/hooks/use-focus-hotkey.ts`:

```ts
import { useEffect, type RefObject } from 'react'

/**
 * Focuses and selects the referenced input when the user presses the
 * platform search hotkey (Cmd+K on macOS, Ctrl+K elsewhere).
 *
 * `preventDefault` is required: without it Firefox opens its Quick Find bar
 * and Chrome may hand the keystroke to the address bar instead.
 *
 * Usage:
 * ```tsx
 * const inputRef = useRef<HTMLInputElement>(null)
 * useFocusHotkey(inputRef)
 * return <input ref={inputRef} />
 * ```
 *
 * @param inputRef  Ref to the input that should receive focus.
 */
export function useFocusHotkey(inputRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') {
        return
      }

      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inputRef])
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/hooks/use-focus-hotkey.test.tsx`
Expected: PASS, 5 tests

- [x] **Step 5: Verify (do not commit)**

Run: `npm run type-check`
Expected: no errors. Report the new files; the repo owner commits.

---

### Task 2: `GlobalSearchBar` component

**Files:**
- Create: `src/modules/dashboard/ui/GlobalSearchBar.tsx`
- Test: `src/modules/dashboard/ui/GlobalSearchBar.test.tsx`

- [x] **Step 1: Write the failing test**

Create `src/modules/dashboard/ui/GlobalSearchBar.test.tsx`:

```tsx
/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import GlobalSearchBar from '@/modules/dashboard/ui/GlobalSearchBar'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}))

describe('GlobalSearchBar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends an encoded query to the repository page on Enter', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    fireEvent.change(input, { target: { value: 'vendor msa' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockPush).toHaveBeenCalledWith('/repository?q=vendor%20msa')
  })

  it('trims surrounding whitespace from the query', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    fireEvent.change(input, { target: { value: '  nda  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockPush).toHaveBeenCalledWith('/repository?q=nda')
  })

  it('navigates to the bare repository route when the term is only whitespace', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockPush).toHaveBeenCalledWith('/repository')
  })

  it('does not navigate on keystrokes other than Enter', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    fireEvent.change(input, { target: { value: 'nda' } })
    fireEvent.keyDown(input, { key: 'a' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  it('focuses the input on Ctrl+K', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    expect(input).not.toHaveFocus()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(input).toHaveFocus()
  })

  it('clears the value on Escape', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'nda' } })
    expect(input.value).toBe('nda')

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(input.value).toBe('')
    expect(mockPush).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/modules/dashboard/ui/GlobalSearchBar.test.tsx`
Expected: FAIL — `Cannot find module '@/modules/dashboard/ui/GlobalSearchBar'`

- [x] **Step 3: Write the implementation**

Create `src/modules/dashboard/ui/GlobalSearchBar.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFocusHotkey } from '@/lib/hooks/use-focus-hotkey'
import { routeRegistry } from '@/core/config/route-registry'
import styles from './dashboard.module.css'

export default function GlobalSearchBar() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')
  const [shortcutHint, setShortcutHint] = useState('')

  useFocusHotkey(inputRef)

  // The server cannot know the client platform, so the hint is filled in after
  // mount. Rendering it during SSR would cause a hydration mismatch.
  useEffect(() => {
    const isMac = /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
    setShortcutHint(isMac ? '⌘K' : 'Ctrl K')
  }, [])

  const submit = () => {
    const trimmed = term.trim()
    router.push(
      trimmed
        ? `${routeRegistry.protected.repository}?q=${encodeURIComponent(trimmed)}`
        : routeRegistry.protected.repository,
    )
  }

  return (
    <div className={styles.globalSearch}>
      <svg viewBox="0 0 20 20" className={styles.globalSearchIcon} aria-hidden="true" focusable="false">
        <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="m13.2 13.2 3.3 3.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        className={styles.globalSearchInput}
        placeholder="Search contracts…"
        aria-label="Search contracts"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            submit()
            return
          }

          if (event.key === 'Escape') {
            setTerm('')
            event.currentTarget.blur()
          }
        }}
      />
      <span className={styles.globalSearchHint} aria-hidden="true">
        {shortcutHint}
      </span>
    </div>
  )
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/modules/dashboard/ui/GlobalSearchBar.test.tsx`
Expected: PASS, 6 tests

- [x] **Step 5: Verify (do not commit)**

Run: `npm run type-check`
Expected: no errors.

---

### Task 3: Styles

**Files:**
- Modify: `src/modules/dashboard/ui/dashboard.module.css`

No test — CSS Modules class names are hashed at build time and asserting on them is brittle. Task 4 verifies the bar renders; visual correctness is checked by eye in Task 6.

- [x] **Step 1: Add the base classes**

Append after the `.topbarTitle` rule (ends at line 219), before `.topbarTools`:

```css
.globalSearch {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  flex: 0 1 340px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  transition:
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}

.globalSearch:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 24%, transparent);
}

.globalSearchIcon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.globalSearchInput {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
  outline: none;
}

.globalSearchInput::placeholder {
  color: var(--color-text-muted);
}

.globalSearchHint {
  flex-shrink: 0;
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
}
```

- [x] **Step 2: Add the responsive overrides**

Inside the media block that contains `.topbarRight` (starts around line 1493), add:

```css
  .globalSearch {
    flex: 1 1 100%;
  }
```

Inside the narrower media block that contains `.topbarTitle` (starts around line 1607), add:

```css
  .globalSearchHint {
    display: none;
  }
```

- [x] **Step 3: Verify the stylesheet still compiles**

Run: `npm run build`
Expected: build succeeds. A full build is slow; if you prefer, skip it here and rely on the dev-server check in Task 6 — CSS Modules failures surface there too.

---

### Task 4: Wire into `ProtectedAppShell`

**Files:**
- Modify: `src/modules/dashboard/ui/ProtectedAppShell.tsx:229-232`
- Test: `src/modules/dashboard/ui/ProtectedAppShell.test.tsx`

- [x] **Step 1: Write the failing test**

Create `src/modules/dashboard/ui/ProtectedAppShell.test.tsx`. `ThemeToggle` reads `window.matchMedia`, which jsdom does not implement, and `LogoutButton` performs auth calls — both are mocked out, matching how `DashboardClient.test.tsx` mocks its children.

```tsx
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
      </ProtectedAppShell>,
    )

    expect(screen.getByLabelText('Search contracts')).toBeInTheDocument()
  })

  it('omits the search bar on the repository page, which has its own', () => {
    render(
      <ProtectedAppShell session={session} activeNav="repository">
        <div>content</div>
      </ProtectedAppShell>,
    )

    expect(screen.queryByLabelText('Search contracts')).not.toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/modules/dashboard/ui/ProtectedAppShell.test.tsx`
Expected: FAIL on the first test — `Unable to find a label with the text of: Search contracts`

- [x] **Step 3: Add the import**

In `src/modules/dashboard/ui/ProtectedAppShell.tsx`, add after the `ThemeToggle` import (line 7):

```tsx
import GlobalSearchBar from './GlobalSearchBar'
```

- [x] **Step 4: Render the bar in the topbar**

Replace the `.topbarLeft` block (lines 230-232):

```tsx
          <div className={styles.topbarLeft}>
            <span className={styles.topbarTitle}>{activePage.title}</span>
          </div>
```

with:

```tsx
          <div className={styles.topbarLeft}>
            <span className={styles.topbarTitle}>{activePage.title}</span>
            {activeNav === 'repository' ? null : <GlobalSearchBar />}
          </div>
```

- [x] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/modules/dashboard/ui/ProtectedAppShell.test.tsx`
Expected: PASS, 2 tests

- [x] **Step 6: Verify nothing else broke (do not commit)**

Run: `npm test -- src/modules/dashboard`
Expected: PASS, including the existing `DashboardClient.test.tsx`.

---

### Task 5: `⌘K` on the Repository page

**Files:**
- Modify: `src/modules/contracts/ui/RepositoryWorkspace.tsx` (imports, hook call, input ref at line 1402)

The bar is not rendered on this page, so `⌘K` must be wired to the page's own input. `useRef` is already imported at line 4; only the hook import is new.

- [x] **Step 1: Add the hook import**

Add after the `useDebouncedValue` import (line 7):

```tsx
import { useFocusHotkey } from '@/lib/hooks/use-focus-hotkey'
```

- [x] **Step 2: Create the ref and register the hotkey**

Immediately after the `search` / `debouncedSearch` declarations (lines 248-249), add:

```tsx
  const searchInputRef = useRef<HTMLInputElement>(null)
  useFocusHotkey(searchInputRef)
```

- [x] **Step 3: Attach the ref to the existing input**

At line 1402, change:

```tsx
              <input
                className={styles.searchInput}
                placeholder="Search by contract name"
```

to:

```tsx
              <input
                ref={searchInputRef}
                className={styles.searchInput}
                placeholder="Search by contract name"
```

- [x] **Step 4: Verify types and existing tests**

Run: `npm run type-check`
Expected: no errors.

Run: `npm test -- src/modules/contracts`
Expected: PASS — existing repository tests unaffected.

---

### Task 6: Manual verification

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Walk the flow**

Confirm each:

1. `/dashboard` — the bar appears in the topbar beside the "Dashboard" title.
2. Type `agreement`, press Enter → lands on `/repository?q=agreement`, the repository search input is prefilled with `agreement`, and the table is filtered.
3. On `/repository` — the topbar bar is **absent**; only the page's own search input is visible.
4. On `/repository`, press `⌘K` / `Ctrl+K` → the page's search input takes focus, and the browser's own find bar does **not** open.
5. On `/dashboard`, press `⌘K` / `Ctrl+K` → the topbar bar takes focus.
6. Type text, press Escape → the input clears and no navigation happens.
7. Toggle dark mode → the bar, placeholder, and hint badge all remain legible.
8. Narrow the window to mobile width → the bar goes full-width and the hint badge disappears; the topbar does not overflow horizontally.
9. Check the browser console on first load → **no hydration mismatch warning** (this is what the deferred hint label protects against).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS, no new failures.

- [ ] **Step 4: Hand off**

Report the changed files. The repo owner commits.

---

## Deviations During Execution

The code blocks in Tasks 1, 2, and 4 above show what was *planned*. Two things
changed while executing. Where they differ, **the shipped code is correct** and
the blocks above are kept only for the reasoning trail.

**1. No `jest-dom` matchers (Tasks 1, 2, 4).**
The planned tests used `toHaveFocus()` and `toBeInTheDocument()`. These pass at
runtime — `@testing-library/jest-dom` is loaded by `jest.setup.js` — but fail
`npm run type-check` with `Property 'toHaveFocus' does not exist`, because the
matcher types were never added to `tsconfig.json`.

They were never added because **no other test in this repo uses them.** These
would have been the first. Rather than make a project-wide `tsconfig` change to
support a style nothing else uses, the tests use plain assertions:

```tsx
expect(document.activeElement).toBe(input)          // was: expect(input).toHaveFocus()
expect(screen.queryByLabelText('…')).not.toBeNull() // was: …toBeInTheDocument()
```

If jest-dom matchers are ever wanted repo-wide, that is its own change: add
`"types": ["@testing-library/jest-dom"]` to `tsconfig.json` and convert the
suite deliberately.

**2. `useSyncExternalStore` instead of `useState` + `useEffect` (Task 2).**
The planned hydration-safe hint used `setShortcutHint` inside a mount effect.
ESLint rejects this under `react-hooks/set-state-in-effect` — calling `setState`
synchronously in an effect body causes a cascading render.

`useSyncExternalStore` is the correct primitive for a client-only value, and
`ThemeToggle.tsx:20` in this repo already uses it for the same purpose. The
`getServerSnapshot` argument returns `''`, which is precisely the hydration
guarantee the plan wanted — the server and first client paint agree by
construction, rather than by a deferred write.

**3. Visibility keys off a `hideGlobalSearch` prop, not `activeNav` (Task 4).**
Caught in manual testing. Task 4 planned `{activeNav === 'repository' ? null : <GlobalSearchBar />}`.
That hid the bar on **contract detail pages**, because
`app/(protected)/contracts/[contractId]/page.tsx:17` sets
`activeNav = from === 'dashboard' ? 'home' : 'repository'` — a contract reached
from the repository reports `activeNav="repository"` so the sidebar item stays
lit, but it has no search of its own.

`activeNav` answers "which sidebar item is lit", not "does this page own a
search input". `ProtectedAppShell` now takes an explicit optional
`hideGlobalSearch` prop, and `RepositoryWorkspace` is the only caller that
passes it. A regression test in `ProtectedAppShell.test.tsx` covers the contract
detail case (`activeNav="repository"` with no `hideGlobalSearch` → bar visible).

## Post-Implementation Notes

- **Known non-issue carried from the spec:** `RepositoryWorkspace` reads `?q=` only in a `useState` initializer, so a repository→repository navigation with a different `q` would not update the input. Unreachable today because the bar is hidden on that page. If the bar is ever made always-visible, this needs a `useEffect` sync.
- **Out of scope, deliberately:** no autocomplete, no recent searches, no searching users/templates/settings.
