# Global Search Bar — Design

**Date:** 2026-07-21
**Status:** Approved, not yet implemented

## Revision Log

| Date | Change |
|---|---|
| 2026-07-21 | Original design approved. |

## Problem

Contract search lives only on the Repository page. From the Dashboard, Admin
Console, or Approver History, finding a contract means navigating to Repository
first, then locating the search input, then typing. The intent ("find this
contract") is one action, but it costs three.

## Goal

A search bar in the shared topbar, reachable from any protected page and from a
`⌘K` / `Ctrl+K` shortcut, that hands the typed query off to the Repository
page's existing search.

## Non-Goals

- **Not a second search implementation.** The bar performs no querying, hits no
  endpoint, and holds no results. It is a navigation affordance that transports
  a string to the page that already knows how to search.
- No autocomplete, typeahead dropdown, or inline result preview.
- No recent-searches history.
- No search over anything but contracts (not users, templates, or settings).

## Enabling Constraint

`RepositoryWorkspace.tsx:248` already seeds its search state from the URL:

```ts
const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
```

So `/repository?q=<term>` arrives with the search prefilled and results filtered.
No changes to the repository query path are needed — the handoff is a URL.

Two properties of the existing code make this safe:

1. The URL sync at `RepositoryWorkspace.tsx:557` uses
   `window.history.replaceState`, not the Next router. The repository page
   rewriting its own `?q=` does not trigger a navigation, so there is no
   remount loop when the page normalizes the URL we sent it.
2. The existing `keydown` listener at `RepositoryWorkspace.tsx:598` handles
   `Escape` and is mounted only while a row preview is open. It does not
   conflict with a `⌘K` handler.

## Components

### `GlobalSearchBar.tsx`

New client component at `src/modules/dashboard/ui/GlobalSearchBar.tsx`, beside
`ProtectedAppShell`.

**Interface:** takes no props. Owns its input state and its own shortcut
listener. Depends only on `next/navigation`'s `useRouter` and the shared
stylesheet.

**Behavior:**

| Input | Result |
|---|---|
| `Enter`, non-empty | `router.push('/repository?q=' + encodeURIComponent(term.trim()))` |
| `Enter`, empty or whitespace | `router.push('/repository')` |
| `Escape` | Clear the input, blur it |
| `⌘K` / `Ctrl+K` (anywhere on page) | Focus and select the input, `preventDefault()` |

`preventDefault()` on the shortcut matters: without it, Firefox opens its Quick
Find bar and Chrome may surface the address bar's search mode.

**Rendering:** magnifier icon, placeholder `Search contracts…`, trailing
shortcut hint badge.

### `ProtectedAppShell.tsx` — placement

Rendered inside `.topbarLeft` (line 230), after `.topbarTitle`. That container is
already `flex: 1 1 420px; min-width: 0` (`dashboard.module.css:196`), so the bar
occupies existing slack without a layout change.

**Visibility:** omitted when the page passes `hideGlobalSearch`. The Repository
page sets it, because it has its own search input directly below the topbar and
a second box pointing at the first is redundant and visually confusing.

This is deliberately **not** keyed off `activeNav`. A contract opened from the
repository reports `activeNav="repository"`
(`app/(protected)/contracts/[contractId]/page.tsx:17`) so the sidebar item stays
highlighted, but that page has no search of its own and must still show the bar.
`activeNav` answers "which sidebar item is lit", not "does this page own a
search input" — conflating the two hides the bar on every contract detail page
reached from the repository.

### `RepositoryWorkspace.tsx` — local shortcut

Because the global bar is not mounted on the Repository page, `⌘K` must be
handled there separately. `RepositoryWorkspace` gains a `ref` on its existing
search input (line 1402) and a small `useEffect` that focuses it on `⌘K`.

**Rejected alternative:** a single shortcut hook in `ProtectedAppShell` that
reaches into the repository page via
`document.getElementById('repository-search-input')`. This couples the shell to
another component's DOM through a magic id string. Local ownership is preferred;
double-firing is impossible because the two listeners never mount together.

## Platform Hint and Hydration

The badge reads `⌘K` on macOS and `Ctrl K` elsewhere. The server cannot know the
client platform, so rendering it during SSR would produce a hydration mismatch.

The badge renders empty on first paint, and a `useEffect` sets the label after
mount from `navigator.platform` / `navigator.userAgent`. The modifier check in
the keydown handler uses `event.metaKey || event.ctrlKey`, so the shortcut works
on both platforms regardless of what the badge displays.

## Styling

New classes in `src/modules/dashboard/ui/dashboard.module.css`:
`.globalSearch`, `.globalSearchInput`, `.globalSearchIcon`, `.globalSearchHint`.

Uses existing custom properties (`--color-text`, `--border`, and the surface vars
the topbar already consumes) so light and dark themes follow `ThemeToggle`
without extra work.

Responsive: at the existing breakpoints (`dashboard.module.css:1493` and
`:1607`), the hint badge is hidden and the bar takes full width, matching how
`.topbarTools` and `.topbarPanels` already reflow.

## Testing

React Testing Library, matching the existing suite's patterns, with
`next/navigation` mocked.

`GlobalSearchBar`:
- `Enter` with `vendor msa` pushes `/repository?q=vendor%20msa`
- `Enter` with `   ` pushes `/repository` with no query string
- `⌘K` and `Ctrl+K` each focus the input
- `Escape` clears the value

`ProtectedAppShell`:
- Bar renders when `activeNav="home"`
- Bar is absent when `activeNav="repository"`

`RepositoryWorkspace`:
- `⌘K` focuses the existing search input

## Known Non-Issue

`RepositoryWorkspace`'s search state is a `useState` initializer, so it reads
`?q=` only on mount. A repository-to-repository navigation with a different `q`
would not update the input. This is unreachable via the global bar, which is not
rendered on that page. Recorded here so a future change that makes the bar
always-visible knows to address it.
