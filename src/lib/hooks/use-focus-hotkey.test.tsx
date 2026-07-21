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

    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(document.activeElement).toBe(input)
  })

  it('focuses the referenced input on Meta+K', () => {
    render(<Harness />)
    const input = screen.getByLabelText('target')

    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(document.activeElement).toBe(input)
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

    expect(document.activeElement).not.toBe(input)
  })

  it('removes its listener on unmount', () => {
    const { unmount } = render(<Harness />)
    const input = screen.getByLabelText('target')
    unmount()

    // Should not throw against a detached ref.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(document.activeElement).not.toBe(input)
  })
})
