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
